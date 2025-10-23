/**
 * OpenAI-compatible chat completions proxy with quota enforcement
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as z from "zod";
import { authMiddleware } from "../lib/auth";
import { calculateCostFromUsage } from "../lib/costs";
import {
  checkReactiveQuotaLimit,
  getCurrentMonth,
  updateOrganizationQuotaUsage,
  updateQuotaUsage,
  updateUserQuotaUsage,
} from "../lib/quota";
import type { OrganizationConfig, QuotaRecord, UserConfig } from "../types";

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

interface VirtualKey {
  key_id: string;
  key_hash: string;
  org_id: string;
  user: string;
  name?: string;
  monthly_limit_usd: number;
}

interface QuotaCheckResult {
  allowed: boolean;
  keyQuotaRecord: QuotaRecord;
  userQuotaRecord: QuotaRecord;
  orgQuotaRecord: QuotaRecord;
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

async function getUserConfig(
  kv: KVNamespace,
  user: string,
): Promise<UserConfig | null> {
  if (!user) return null;

  try {
    return (await kv.get(
      `user:${user}:config`,
      "json",
    )) as UserConfig | null;
  } catch (error) {
    console.error("Failed to get user config:", error);
    return null;
  }
}

function validateOrganizationExists(
  vkey: VirtualKey,
  organizationConfig: OrganizationConfig | null,
): OrganizationValidationResult {
  if (!organizationConfig) {
    return {
      shouldProceed: false,
      errorResponse: Response.json(
        {
          error: {
            message: vkey.org_id
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
  vkey: VirtualKey,
  userConfig: UserConfig,
  organizationConfig: OrganizationConfig,
): Promise<QuotaCheckResult> {
  try {
    return await checkReactiveQuotaLimit(
      kv,
      vkey.key_hash,
      vkey.user,
      vkey.org_id,
      vkey.monthly_limit_usd,
      userConfig.monthly_limit_usd,
      organizationConfig.monthly_budget_usd,
    );
  } catch (error) {
    console.error("Quota check failed:", error);

    if (organizationConfig.failure_mode === "fail-open") {
      console.log(
        `Fail-open mode: allowing request without quota check for key ${vkey.key_id}`,
      );

      return {
        allowed: true,
        keyQuotaRecord: {
          month_usage_usd: 0,
          current_month: getCurrentMonth(),
          request_count: 0,
          last_update: Date.now(),
        },
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
  vkey: VirtualKey,
  userConfig: UserConfig,
  organizationConfig: OrganizationConfig,
): Response {
  if (quotaCheckResult.reason === "key_quota_exceeded") {
    const remainingUsd =
      vkey.monthly_limit_usd -
      quotaCheckResult.keyQuotaRecord!.month_usage_usd;
    return Response.json(
      {
        error: {
          message: `Virtual key monthly quota exceeded. Used: $${quotaCheckResult.keyQuotaRecord!.month_usage_usd.toFixed(4)}, Limit: $${vkey.monthly_limit_usd}, Remaining: $${remainingUsd.toFixed(4)}`,
          type: "key_quota_exceeded",
          details: {
            usage_usd: quotaCheckResult.keyQuotaRecord!.month_usage_usd,
            limit_usd: vkey.monthly_limit_usd,
            remaining_usd: remainingUsd,
            current_month: quotaCheckResult.keyQuotaRecord!.current_month,
          },
        },
      },
      { status: 429 },
    );
  } else if (quotaCheckResult.reason === "user_quota_exceeded") {
    const remainingUserUsd =
      userConfig.monthly_limit_usd -
      quotaCheckResult.userQuotaRecord!.month_usage_usd;
    return Response.json(
      {
        error: {
          message: `User monthly quota exceeded. Used: $${quotaCheckResult.userQuotaRecord!.month_usage_usd.toFixed(4)}, Limit: $${userConfig.monthly_limit_usd}, Remaining: $${remainingUserUsd.toFixed(4)}`,
          type: "user_quota_exceeded",
          details: {
            user: vkey.user,
            usage_usd: quotaCheckResult.userQuotaRecord!.month_usage_usd,
            limit_usd: userConfig.monthly_limit_usd,
            remaining_usd: remainingUserUsd,
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
  vkey: VirtualKey,
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
        key_id: vkey.key_id,
        org_id: vkey.org_id,
        user: vkey.user,
        model: model,
      }),
    },
    body: requestBody,
  });
}

async function processAiGatewayResponse(
  response: Response,
  model: string,
): Promise<{ responseBody: string; actualCost: number }> {
  const responseBody = await response.text();
  let actualCost = 0;

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
      console.warn("Could not parse usage from response, using zero cost");
    }
  }

  return { responseBody, actualCost };
}

async function updateUsageTracking(
  kv: KVNamespace,
  vkey: VirtualKey,
  _organizationConfig: OrganizationConfig,
  actualCost: number,
): Promise<QuotaRecord> {
  try {
    const updatedQuota = await updateQuotaUsage(kv, vkey.key_hash, actualCost);
    await updateUserQuotaUsage(kv, vkey.user, actualCost);
    await updateOrganizationQuotaUsage(kv, vkey.org_id, actualCost);

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
  vkey: VirtualKey,
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
    vkey.monthly_limit_usd.toString(),
  );
  proxyResponse.headers.set(
    "x-gateway-remaining-usd",
    (vkey.monthly_limit_usd - quotaRecord.month_usage_usd).toFixed(4),
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
  describeRoute({
    description:
      "OpenAI-compatible chat completions with three-level quota enforcement",
    tags: ["Chat"],
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["model", "messages"],
            properties: {
              model: {
                type: "string",
                description:
                  'Model in format "provider/model". Examples: "openai/gpt-4o-mini", "anthropic/claude-3-haiku"',
                example: "openai/gpt-4o-mini",
              },
              messages: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    role: {
                      type: "string",
                      enum: ["system", "user", "assistant"],
                    },
                    content: { type: "string" },
                  },
                },
              },
              max_tokens: {
                type: "integer",
                description: "Maximum tokens to generate",
              },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful chat completion response",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "string" },
                object: { type: "string" },
                created: { type: "number" },
                model: { type: "string" },
                choices: { type: "array", items: {} },
                usage: {
                  type: "object",
                  properties: {
                    prompt_tokens: { type: "number" },
                    completion_tokens: { type: "number" },
                    total_tokens: { type: "number" },
                  },
                },
              },
            },
          },
        },
        headers: {
          "x-gateway-usage-usd": {
            schema: { type: "string" },
            description: "Current monthly usage in USD",
          },
          "x-gateway-limit-usd": {
            schema: { type: "string" },
            description: "Monthly quota limit in USD",
          },
          "x-gateway-remaining-usd": {
            schema: { type: "string" },
            description: "Remaining quota in USD",
          },
          "x-gateway-cost-usd": {
            schema: { type: "string" },
            description: "Cost of this request in USD",
          },
        },
      },
      401: {
        description: "Authentication failed or provider key missing",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    type: { type: "string" },
                    details: {},
                  },
                },
              },
            },
          },
        },
      },
      429: {
        description: "Quota exceeded (virtual key, user, or organization)",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    type: { type: "string" },
                    details: {},
                  },
                },
              },
            },
          },
        },
      },
      503: {
        description: "Service error or configuration issue",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    type: { type: "string" },
                    details: {},
                  },
                },
              },
            },
          },
        },
      },
    },
  }),
  authMiddleware,
  zValidator("json", ChatCompletionsSchema),
  async (c) => {
    const {
      AI_GATEWAY_ACCOUNT_ID,
      AI_GATEWAY_ID,
      AI_GATEWAY_TOKEN,
      GATEWAY_KV,
    } = c.env;
    const vkey = c.get("vkey");

    try {
      // 1. Parse and validate request
      const payload = c.req.valid("json");
      const model = payload.model;
      const requestBodyText = JSON.stringify(payload);

      // 2. Get organization and user configs
      const organizationConfig = await getOrganizationConfig(
        GATEWAY_KV,
        vkey.org_id,
      );
      const userConfig = await getUserConfig(GATEWAY_KV, vkey.user);

      // 3. Early validation for organization and user existence
      const orgValidation = validateOrganizationExists(
        vkey,
        organizationConfig,
      );
      if (!orgValidation.shouldProceed) {
        return orgValidation.errorResponse!;
      }

      if (!userConfig) {
        return Response.json(
          {
            error: {
              message: `User configuration not found for user: ${vkey.user}`,
              type: "user_error",
            },
          },
          { status: 503 },
        );
      }

      // After validation, we're guaranteed to have organizationConfig and userConfig
      const validatedOrgConfig = organizationConfig!;
      const validatedUserConfig = userConfig;

      // 4. Validate provider and get API key
      const providerValidation = validateProviderAndApiKey(
        model,
        validatedOrgConfig,
        vkey.org_id,
      );
      if (!providerValidation.isValid) {
        return providerValidation.errorResponse!;
      }

      // 5. Perform quota checking
      let quotaCheckResult: QuotaCheckResult;
      try {
        quotaCheckResult = await performQuotaCheck(
          GATEWAY_KV,
          vkey,
          validatedUserConfig,
          validatedOrgConfig,
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
        return handleQuotaFailure(
          quotaCheckResult,
          vkey,
          validatedUserConfig,
          validatedOrgConfig,
        );
      }

      // 7. Make AI Gateway request
      const aiGatewayUrl = `https://gateway.ai.cloudflare.com/v1/${AI_GATEWAY_ACCOUNT_ID}/${AI_GATEWAY_ID}/compat/chat/completions`;
      const response = await makeAiGatewayRequest(
        aiGatewayUrl,
        providerValidation.apiKey!,
        AI_GATEWAY_TOKEN,
        vkey,
        model,
        requestBodyText,
      );

      // 8. Process response and calculate actual cost
      const { responseBody, actualCost } = await processAiGatewayResponse(
        response,
        model,
      );

      // 9. Create response with current quota info
      const proxyResponse = enhanceResponseWithUsageHeaders(
        response,
        responseBody,
        quotaCheckResult.keyQuotaRecord,
        vkey,
        actualCost,
      );

      // 10. Update usage tracking asynchronously
      c.executionCtx.waitUntil(
        updateUsageTracking(
          GATEWAY_KV,
          vkey,
          validatedOrgConfig,
          actualCost,
        ),
      );

      return proxyResponse;
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
