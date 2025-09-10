/**
 * Cost calculation utilities and pricing models
 */

import modelCostsData from './modelCosts.json';

interface ModelPricing {
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = modelCostsData;

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

