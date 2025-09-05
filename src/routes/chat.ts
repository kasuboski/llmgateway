/**
 * OpenAI-compatible chat completions proxy with quota enforcement
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import * as z from 'zod';
import { authMiddleware } from '../lib/auth';
import { calculateCostFromUsage, estimateCostFromRequest } from '../lib/costs';
import {
  checkHierarchicalQuotaLimit,
  checkQuotaLimit,
  getCurrentMonth,
  updateOrganizationQuotaUsage,
  updateQuotaUsage,
} from '../lib/quota';
import type { OrganizationConfig, QuotaRecord } from '../types';

// Extend the generated CloudflareBindings to include AI binding and secrets
interface Env extends CloudflareBindings {
  AI: Ai;
  AI_GATEWAY_TOKEN: string;
  ADMIN_API_KEY: string;
}

const chat = new Hono<{ Bindings: Env }>();

// Schema for Chat Completions request validation
const ChatCompletionsSchema = z.object({
  model: z.string(),
  messages: z
    .array(
      z
        .object({
          content: z.string().optional(),
        })
        .passthrough()
    )
    .optional(),
  max_tokens: z.number().int().positive().optional(),
});

// OpenAI-compatible chat completions proxy with quota enforcement
chat.post(
  '/chat/completions',
  authMiddleware,
  zValidator('json', ChatCompletionsSchema),
  async c => {
    const { AI_GATEWAY_ACCOUNT_ID, AI_GATEWAY_ID, AI_GATEWAY_TOKEN, GATEWAY_KV } = c.env;
    const user = c.get('user');

    try {
      // Use validated JSON for logic
      const payload = c.req.valid('json');
      const model = payload.model;
      // Clone the raw request to preserve all fields when proxying to AI Gateway
      const requestBodyText = await c.req.raw.clone().text();

      // Estimate cost for quota check
      const estimatedCost = estimateCostFromRequest(model, payload);

      // Get organization config for failure mode and budget checking
      let organizationConfig: OrganizationConfig | null = null;
      let quotaCheckResult: {
        allowed: boolean;
        userQuotaRecord: QuotaRecord | null;
        orgQuotaRecord: QuotaRecord | null;
        reason?: string;
      };

      try {
        organizationConfig = (await GATEWAY_KV.get(
          `org:${user.org_id}:config`,
          'json'
        )) as OrganizationConfig | null;
      } catch (error) {
        console.error('Failed to get organization config:', error);
      }

      if (!organizationConfig) {
        // Organization config not found - handle based on default failure mode
        if (user.org_id) {
          // If we have an org_id but can't find the config, assume fail-closed behavior
          return c.json(
            {
              error: {
                message: 'Organization configuration not found',
                type: 'organization_error',
              },
            },
            503
          );
        } else {
          // Fallback to single-user quota check for backward compatibility
          const { allowed, quotaRecord } = await checkQuotaLimit(
            GATEWAY_KV,
            user.user_id,
            estimatedCost,
            user.monthly_limit_usd
          );

          quotaCheckResult = {
            allowed,
            userQuotaRecord: quotaRecord,
            orgQuotaRecord: {
              month_usage_usd: 0,
              current_month: quotaRecord.current_month,
              request_count: 0,
              last_update: Date.now(),
            },
          };
        }
      } else {
        // Use hierarchical quota checking with failure mode support
        try {
          quotaCheckResult = await checkHierarchicalQuotaLimit(
            GATEWAY_KV,
            user.user_id,
            user.org_id,
            estimatedCost,
            user.monthly_limit_usd,
            organizationConfig.monthly_budget_usd
          );
        } catch (error) {
          console.error('Hierarchical quota check failed:', error);

          // Handle failure based on organization's failure mode
          if (organizationConfig.failure_mode === 'fail-open') {
            // Fail-open: Allow request without quota check since KV is unavailable
            console.log(
              `Fail-open mode: allowing request without quota check for user ${user.user_id}`
            );

            quotaCheckResult = {
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
            // fail-closed: reject the request
            return c.json(
              {
                error: {
                  message: 'Quota service temporarily unavailable',
                  type: 'service_error',
                },
              },
              503
            );
          }
        }
      }

      // Check quota result
      if (!quotaCheckResult.allowed) {
        if (quotaCheckResult.reason === 'user_quota_exceeded') {
          const remainingUsd =
            user.monthly_limit_usd - quotaCheckResult.userQuotaRecord.month_usage_usd;
          return c.json(
            {
              error: {
                message: `User monthly quota exceeded. Used: $${quotaCheckResult.userQuotaRecord.month_usage_usd.toFixed(4)}, Limit: $${user.monthly_limit_usd}, Remaining: $${remainingUsd.toFixed(4)}`,
                type: 'user_quota_exceeded',
                details: {
                  usage_usd: quotaCheckResult.userQuotaRecord.month_usage_usd,
                  limit_usd: user.monthly_limit_usd,
                  remaining_usd: remainingUsd,
                  current_month: quotaCheckResult.userQuotaRecord.current_month,
                },
              },
            },
            429
          );
        } else if (quotaCheckResult.reason === 'organization_quota_exceeded') {
          const remainingOrgUsd =
            organizationConfig!.monthly_budget_usd -
            quotaCheckResult.orgQuotaRecord.month_usage_usd;
          return c.json(
            {
              error: {
                message: `Organization monthly budget exceeded. Used: $${quotaCheckResult.orgQuotaRecord.month_usage_usd.toFixed(4)}, Budget: $${organizationConfig!.monthly_budget_usd}, Remaining: $${remainingOrgUsd.toFixed(4)}`,
                type: 'organization_quota_exceeded',
                details: {
                  org_usage_usd: quotaCheckResult.orgQuotaRecord.month_usage_usd,
                  org_budget_usd: organizationConfig!.monthly_budget_usd,
                  org_remaining_usd: remainingOrgUsd,
                  current_month: quotaCheckResult.orgQuotaRecord.current_month,
                },
              },
            },
            429
          );
        }
      }

      // Parse provider from model in format "provider/model"
      if (!model.includes('/')) {
        return c.json(
          {
            error: {
              message:
                'Model must be in format "provider/model". Examples: "openai/gpt-4o-mini", "google-ai-studio/gemini-2.0-flash", "anthropic/claude-3-haiku"',
              type: 'invalid_model_format',
            },
          },
          400
        );
      }

      const [provider, _modelName] = model.split('/', 2);

      // Get provider API key from organization config
      let providerApiKey: string | undefined;
      if (organizationConfig?.provider_keys) {
        providerApiKey = organizationConfig.provider_keys[provider];
      }

      if (!providerApiKey) {
        return c.json(
          {
            error: {
              message: `No ${provider} API key configured for organization ${user.org_id}. Please configure API key for provider: ${provider}`,
              type: 'provider_key_missing',
            },
          },
          401
        );
      }

      // Use unified AI Gateway compat endpoint
      const aiGatewayUrl = `https://gateway.ai.cloudflare.com/v1/${AI_GATEWAY_ACCOUNT_ID}/${AI_GATEWAY_ID}/compat/chat/completions`;

      // Proxy the request through AI Gateway
      const response = await fetch(aiGatewayUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${providerApiKey}`,
          'Content-Type': 'application/json',
          // Add AI Gateway token if available
          ...(AI_GATEWAY_TOKEN && {
            'cf-aig-authorization': `Bearer ${AI_GATEWAY_TOKEN}`,
          }),
          // Add metadata for tracking
          'cf-aig-metadata': JSON.stringify({
            user_id: user.user_id,
            org_id: user.org_id,
            email: user.email,
            model: model,
          }),
        },
        body: requestBodyText,
      });

      // Calculate actual cost from response if possible
      let actualCost = estimatedCost;

      if (response.ok) {
        try {
          // Try to get usage information from response
          const responseClone = response.clone();
          const responseData = await responseClone.json();

          if (responseData.usage) {
            const { prompt_tokens = 0, completion_tokens = 0 } = responseData.usage;
            actualCost = calculateCostFromUsage(model, prompt_tokens, completion_tokens);
          }
        } catch (_e) {
          // If we can't parse response, use estimated cost
          console.warn('Could not parse usage from response, using estimated cost');
        }
      }

      // Update quota usage with actual cost - both user and organization
      // Handle KV failures gracefully (especially during fail-open scenarios)
      let updatedQuota: QuotaRecord | null;
      try {
        updatedQuota = await updateQuotaUsage(GATEWAY_KV, user.user_id, actualCost);

        // Update organization quota if organization exists
        if (organizationConfig) {
          await updateOrganizationQuotaUsage(GATEWAY_KV, user.org_id, actualCost);
        }
      } catch (error) {
        console.error('Failed to update usage tracking (continuing anyway):', error);
        // Create placeholder quota for response headers
        updatedQuota = {
          month_usage_usd: 0,
          current_month: getCurrentMonth(),
          request_count: 0,
          last_update: Date.now(),
        };
      }

      // Create response with usage headers
      const proxyResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      // Add usage headers
      proxyResponse.headers.set('x-gateway-usage-usd', updatedQuota.month_usage_usd.toFixed(4));
      proxyResponse.headers.set('x-gateway-limit-usd', user.monthly_limit_usd.toString());
      proxyResponse.headers.set(
        'x-gateway-remaining-usd',
        (user.monthly_limit_usd - updatedQuota.month_usage_usd).toFixed(4)
      );
      proxyResponse.headers.set('x-gateway-request-count', updatedQuota.request_count.toString());
      proxyResponse.headers.set('x-gateway-current-month', updatedQuota.current_month);
      proxyResponse.headers.set('x-gateway-cost-usd', actualCost.toFixed(6));

      return proxyResponse;
    } catch (error) {
      console.error('AI Gateway proxy error:', error);
      return c.json(
        {
          error: {
            message: 'Failed to proxy request to AI Gateway',
            type: 'proxy_error',
          },
        },
        502
      );
    }
  }
);

export default chat;
