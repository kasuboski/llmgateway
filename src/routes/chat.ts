/**
 * OpenAI-compatible chat completions proxy with quota enforcement
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import * as z from "zod";
import { authMiddleware } from "../lib/auth";
import { calculateCostFromUsage, estimateCostFromRequest } from "../lib/costs";
import {
  checkHierarchicalQuotaLimit,
  getCurrentMonth,
  updateOrganizationQuotaUsage,
  updateQuotaUsage,
} from "../lib/quota";
import type { OrganizationConfig, QuotaRecord } from "../types";

const chat = new Hono<{ Bindings: CloudflareBindings }>();

// Helper function return types
interface OrganizationValidationResult {
  shouldProceed: boolean;
  errorResponse?: Response;
}

interface ProviderValidationResult {
  isValid: boolean;
  provider?: string;
  apiKey?: string;
  errorResponse?: Response;
}

interface User {
  user_id: string;
  org_id: string;
  email: string;
  monthly_limit_usd: number;
}

interface QuotaCheckResult {
  allowed: boolean;
  userQuotaRecord: QuotaRecord | null;
  orgQuotaRecord: QuotaRecord | null;
  reason?: string;
}

// Helper functions for chat completions handling

async function getOrganizationConfig(
  kv: KVNamespace,
  orgId: string,
): Promise<OrganizationConfig | null> {
  if (!orgId) return null;

  try {
    return (await kv.get(
      `org:${orgId}:config`,
      "json",
    )) as OrganizationConfig | null;
  } catch (error) {
    console.error("Failed to get organization config:", error);
    return null;
  }
}

function validateOrganizationExists(
  user: User,
  organizationConfig: OrganizationConfig | null,
): OrganizationValidationResult {
  if (!organizationConfig) {
    return {
      shouldProceed: false,
      errorResponse: Response.json(
        {
          error: {
            message: user.org_id
              ? "Organization configuration not found"
              : "Organization ID required - all requests must be associated with an organization",
            type: "organization_error",
          },
        },
        { status: 503 },
      ),
    };
  }
  return { shouldProceed: true };
}

function validateProviderAndApiKey(
  model: string,
  organizationConfig: OrganizationConfig,
  orgId: string,
): ProviderValidationResult {
  if (!model.includes("/")) {
    return {
      isValid: false,
      errorResponse: Response.json(
        {
          error: {
            message:
              'Model must be in format "provider/model". Examples: "openai/gpt-4o-mini", "google-ai-studio/gemini-2.0-flash", "anthropic/claude-3-haiku"',
            type: "invalid_model_format",
          },
        },
        { status: 400 },
      ),
    };
  }

  const [provider] = model.split("/", 2);
  const apiKey = organizationConfig.provider_keys?.[provider];

  if (!apiKey) {
    return {
      isValid: false,
      errorResponse: Response.json(
        {
          error: {
            message: `No ${provider} API key configured for organization ${orgId}. Please configure API key for provider: ${provider}`,
            type: "provider_key_missing",
          },
        },
        { status: 401 },
      ),
    };
  }

  return { isValid: true, provider, apiKey };
}

async function performQuotaCheck(
  kv: KVNamespace,
  user: User,
  organizationConfig: OrganizationConfig,
  estimatedCost: number,
): Promise<QuotaCheckResult> {
  try {
    return await checkHierarchicalQuotaLimit(
      kv,
      user.user_id,
      user.org_id,
      estimatedCost,
      user.monthly_limit_usd,
      organizationConfig.monthly_budget_usd,
    );
  } catch (error) {
    console.error("Hierarchical quota check failed:", error);

    if (organizationConfig.failure_mode === "fail-open") {
      console.log(
        `Fail-open mode: allowing request without quota check for user ${user.user_id}`,
      );

      return {
        allowed: true,
        userQuotaRecord: {
          month_usage_usd: 0,
          current_month: getCurrentMonth(),
          request_count: 0,
          last_update: Date.now(),
        },
        orgQuotaRecord: {
          month_usage_usd: 0,
          current_month: getCurrentMonth(),
          request_count: 0,
          last_update: Date.now(),
        },
      };
    } else {
      throw error; // Re-throw to be handled by caller
    }
  }
}

function handleQuotaFailure(
  quotaCheckResult: QuotaCheckResult,
  user: User,
  organizationConfig: OrganizationConfig,
): Response {
  if (quotaCheckResult.reason === "user_quota_exceeded") {
    const remainingUsd =
      user.monthly_limit_usd -
      quotaCheckResult.userQuotaRecord!.month_usage_usd;
    return Response.json(
      {
        error: {
          message: `User monthly quota exceeded. Used: $${quotaCheckResult.userQuotaRecord!.month_usage_usd.toFixed(4)}, Limit: $${user.monthly_limit_usd}, Remaining: $${remainingUsd.toFixed(4)}`,
          type: "user_quota_exceeded",
          details: {
            usage_usd: quotaCheckResult.userQuotaRecord!.month_usage_usd,
            limit_usd: user.monthly_limit_usd,
            remaining_usd: remainingUsd,
            current_month: quotaCheckResult.userQuotaRecord!.current_month,
          },
        },
      },
      { status: 429 },
    );
  } else if (quotaCheckResult.reason === "organization_quota_exceeded") {
    const remainingOrgUsd =
      organizationConfig.monthly_budget_usd -
      quotaCheckResult.orgQuotaRecord!.month_usage_usd;
    return Response.json(
      {
        error: {
          message: `Organization monthly budget exceeded. Used: $${quotaCheckResult.orgQuotaRecord!.month_usage_usd.toFixed(4)}, Budget: $${organizationConfig.monthly_budget_usd}, Remaining: $${remainingOrgUsd.toFixed(4)}`,
          type: "organization_quota_exceeded",
          details: {
            org_usage_usd: quotaCheckResult.orgQuotaRecord!.month_usage_usd,
            org_budget_usd: organizationConfig.monthly_budget_usd,
            org_remaining_usd: remainingOrgUsd,
            current_month: quotaCheckResult.orgQuotaRecord!.current_month,
          },
        },
      },
      { status: 429 },
    );
  }

  // Default error case
  return Response.json(
    {
      error: {
        message: "Quota check failed",
        type: "quota_error",
      },
    },
    { status: 503 },
  );
}

async function makeAiGatewayRequest(
  aiGatewayUrl: string,
  providerApiKey: string,
  gatewayToken: string,
  user: User,
  model: string,
  requestBody: string,
): Promise<Response> {
  return fetch(aiGatewayUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerApiKey}`,
      "Content-Type": "application/json",
      ...(gatewayToken && {
        "cf-aig-authorization": `Bearer ${gatewayToken}`,
      }),
      "cf-aig-metadata": JSON.stringify({
        user_id: user.user_id,
        org_id: user.org_id,
        email: user.email,
        model: model,
      }),
    },
    body: requestBody,
  });
}

async function processAiGatewayResponse(
  response: Response,
  model: string,
  estimatedCost: number,
): Promise<{ responseBody: string; actualCost: number }> {
  const responseBody = await response.text();
  let actualCost = estimatedCost;

  if (response.ok) {
    try {
      const responseData = JSON.parse(responseBody);
      if (responseData.usage) {
        const { prompt_tokens = 0, completion_tokens = 0 } = responseData.usage;
        actualCost = calculateCostFromUsage(
          model,
          prompt_tokens,
          completion_tokens,
        );
      }
    } catch (_e) {
      console.warn("Could not parse usage from response, using estimated cost");
    }
  }

  return { responseBody, actualCost };
}

async function updateUsageTracking(
  kv: KVNamespace,
  user: User,
  _organizationConfig: OrganizationConfig,
  actualCost: number,
): Promise<QuotaRecord> {
  try {
    const updatedQuota = await updateQuotaUsage(kv, user.user_id, actualCost);
    await updateOrganizationQuotaUsage(kv, user.org_id, actualCost);

    return updatedQuota;
  } catch (error) {
    console.error(
      "Failed to update usage tracking (continuing anyway):",
      error,
    );
    return {
      month_usage_usd: 0,
      current_month: getCurrentMonth(),
      request_count: 0,
      last_update: Date.now(),
    };
  }
}

function enhanceResponseWithUsageHeaders(
  response: Response,
  responseBody: string,
  quotaRecord: QuotaRecord,
  user: User,
  actualCost: number,
): Response {
  const proxyResponse = new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  proxyResponse.headers.set(
    "x-gateway-usage-usd",
    quotaRecord.month_usage_usd.toFixed(4),
  );
  proxyResponse.headers.set(
    "x-gateway-limit-usd",
    user.monthly_limit_usd.toString(),
  );
  proxyResponse.headers.set(
    "x-gateway-remaining-usd",
    (user.monthly_limit_usd - quotaRecord.month_usage_usd).toFixed(4),
  );
  proxyResponse.headers.set(
    "x-gateway-request-count",
    quotaRecord.request_count.toString(),
  );
  proxyResponse.headers.set(
    "x-gateway-current-month",
    quotaRecord.current_month,
  );
  proxyResponse.headers.set("x-gateway-cost-usd", actualCost.toFixed(6));

  return proxyResponse;
}

// Schema for Chat Completions request validation
const ChatCompletionsSchema = z.object({
  model: z.string(),
  messages: z
    .array(
      z
        .object({
          content: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
  max_tokens: z.number().int().positive().optional(),
});

// OpenAI-compatible chat completions proxy with quota enforcement
chat.post(
  "/chat/completions",
  authMiddleware,
  zValidator("json", ChatCompletionsSchema),
  async (c) => {
    const {
      AI_GATEWAY_ACCOUNT_ID,
      AI_GATEWAY_ID,
      AI_GATEWAY_TOKEN,
      GATEWAY_KV,
    } = c.env;
    const user = c.get("user");

    try {
      // 1. Parse and validate request
      const payload = c.req.valid("json");
      const model = payload.model;
      const requestBodyText = JSON.stringify(payload);
      const estimatedCost = estimateCostFromRequest(model, payload);

      // 2. Get organization config
      const organizationConfig = await getOrganizationConfig(
        GATEWAY_KV,
        user.org_id,
      );

      // 3. Early validation for organization existence
      const orgValidation = validateOrganizationExists(
        user,
        organizationConfig,
      );
      if (!orgValidation.shouldProceed) {
        return orgValidation.errorResponse!;
      }

      // After validation, we're guaranteed to have organizationConfig
      const validatedOrgConfig = organizationConfig!;

      // 4. Validate provider and get API key
      const providerValidation = validateProviderAndApiKey(
        model,
        validatedOrgConfig,
        user.org_id,
      );
      if (!providerValidation.isValid) {
        return providerValidation.errorResponse!;
      }

      // 5. Perform quota checking
      let quotaCheckResult: QuotaCheckResult;
      try {
        quotaCheckResult = await performQuotaCheck(
          GATEWAY_KV,
          user,
          validatedOrgConfig,
          estimatedCost,
        );
      } catch (_error) {
        // Handle fail-closed case for quota check failures
        return c.json(
          {
            error: {
              message: "Quota service temporarily unavailable",
              type: "service_error",
            },
          },
          503,
        );
      }

      // 6. Handle quota failures
      if (!quotaCheckResult.allowed) {
        return handleQuotaFailure(quotaCheckResult, user, validatedOrgConfig);
      }

      // 7. Make AI Gateway request
      const aiGatewayUrl = `https://gateway.ai.cloudflare.com/v1/${AI_GATEWAY_ACCOUNT_ID}/${AI_GATEWAY_ID}/compat/chat/completions`;
      const response = await makeAiGatewayRequest(
        aiGatewayUrl,
        providerValidation.apiKey!,
        AI_GATEWAY_TOKEN,
        user,
        model,
        requestBodyText,
      );

      // 8. Process response and calculate actual cost
      const { responseBody, actualCost } = await processAiGatewayResponse(
        response,
        model,
        estimatedCost,
      );

      // 9. Update usage tracking
      const updatedQuota = await updateUsageTracking(
        GATEWAY_KV,
        user,
        validatedOrgConfig,
        actualCost,
      );

      // 10. Return enhanced response
      return enhanceResponseWithUsageHeaders(
        response,
        responseBody,
        updatedQuota,
        user,
        actualCost,
      );
    } catch (error) {
      console.error("AI Gateway proxy error:", error);
      return c.json(
        {
          error: {
            message: "Failed to proxy request to AI Gateway",
            type: "proxy_error",
          },
        },
        502,
      );
    }
  },
);

export default chat;
