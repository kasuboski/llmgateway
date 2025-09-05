/**
 * Cost calculation utilities and pricing models
 */

interface ModelPricing {
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI models
  'openai/gpt-4o-mini': {
    input_cost_per_1m_tokens: 0.15,
    output_cost_per_1m_tokens: 0.6,
  },
  'openai/gpt-4o': {
    input_cost_per_1m_tokens: 2.5,
    output_cost_per_1m_tokens: 10.0,
  },
  'openai/gpt-4': {
    input_cost_per_1m_tokens: 30.0,
    output_cost_per_1m_tokens: 60.0,
  },
  'openai/gpt-3.5-turbo': {
    input_cost_per_1m_tokens: 0.5,
    output_cost_per_1m_tokens: 1.5,
  },
  // Anthropic models
  'anthropic/claude-3-haiku': {
    input_cost_per_1m_tokens: 0.25,
    output_cost_per_1m_tokens: 1.25,
  },
  'anthropic/claude-3-sonnet': {
    input_cost_per_1m_tokens: 3.0,
    output_cost_per_1m_tokens: 15.0,
  },
  'anthropic/claude-3-opus': {
    input_cost_per_1m_tokens: 15.0,
    output_cost_per_1m_tokens: 75.0,
  },
};

export function calculateCostFromUsage(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Fallback pricing for unknown models
    return ((inputTokens + outputTokens) * 0.001) / 1000; // $0.001 per 1K tokens
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input_cost_per_1m_tokens;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_cost_per_1m_tokens;

  return inputCost + outputCost;
}

export function estimateCostFromRequest(
  model: string,
  requestBody: Record<string, unknown>
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return 0.01; // Default estimate for unknown models
  }

  // Rough estimation based on message content
  let estimatedInputTokens = 0;
  if (requestBody.messages && Array.isArray(requestBody.messages)) {
    for (const message of requestBody.messages) {
      if (message.content && typeof message.content === 'string') {
        // Rough approximation: 4 characters = 1 token
        estimatedInputTokens += Math.ceil(message.content.length / 4);
      }
    }
  }

  // Estimate output tokens (conservative estimate)
  const maxTokens = requestBody.max_tokens || 1000;
  const estimatedOutputTokens = Math.min(maxTokens, estimatedInputTokens * 0.5);

  return calculateCostFromUsage(model, estimatedInputTokens, estimatedOutputTokens);
}
