#!/usr/bin/env node
// Takes input JSON like https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json

import fs from "fs";

const SUPPORTED_PROVIDERS = [
  "anthropic",
  "openai",
  "groq",
  "mistral",
  "cohere",
  "perplexity",
  "workers-ai",
  "google-ai-studio",
  "grok",
  "deepseek",
  "cerebras",
];

function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error("Usage: node pricing-gen.js <input-json-file>");
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file "${inputFile}" not found`);
    process.exit(1);
  }

  let inputData;
  try {
    const rawData = fs.readFileSync(inputFile, "utf8");
    inputData = JSON.parse(rawData);
  } catch (error) {
    console.error(`Error reading or parsing JSON file: ${error.message}`);
    process.exit(1);
  }

  const modelPricing = {};

  for (const [modelName, modelData] of Object.entries(inputData)) {
    // Skip if not chat mode
    if (modelData.mode !== "chat") {
      continue;
    }

    // Skip if provider not supported
    const provider = modelData.litellm_provider;
    if (!provider || !SUPPORTED_PROVIDERS.includes(provider)) {
      continue;
    }

    // Skip if missing required cost fields
    if (!modelData.input_cost_per_token || !modelData.output_cost_per_token) {
      console.warn(`Warning: Skipping ${modelName} - missing cost data`);
      continue;
    }

    // Generate model key in format: provider/model-name
    // Handle cases where model name already includes provider prefix
    let finalModelName = modelName;
    if (modelName.startsWith(`${provider}/`)) {
      finalModelName = modelName.substring(provider.length + 1);
    }
    const modelKey = `${provider}/${finalModelName}`;

    // Convert per-token costs to per-1M-token costs
    // Round to 2 decimal places to avoid floating point precision issues
    modelPricing[modelKey] = {
      input_cost_per_1m_tokens:
        Math.round(modelData.input_cost_per_token * 1_000_000 * 100) / 100,
      output_cost_per_1m_tokens:
        Math.round(modelData.output_cost_per_token * 1_000_000 * 100) / 100,
    };
  }

  // Output formatted JSON
  console.log(JSON.stringify(modelPricing, null, 2));
}

main();
