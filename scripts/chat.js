#!/usr/bin/env node
/**
 * Chat script to test the AI Gateway chat completions endpoint
 * Usage: node scripts/chat.js [--prod] [--api-key key] [--model model] [message]
 */

const API_ENDPOINT_DEV = 'http://localhost:8787';
const API_ENDPOINT_PROD = 'https://ai-gateway-proxy.favoritechild.workers.dev';

// Default test API key (should be replaced with real key from setup)
const DEFAULT_API_KEY = 'gw_live_demo123456789abcdef';

function getApiEndpoint() {
  return process.argv.includes('--prod') ? API_ENDPOINT_PROD : API_ENDPOINT_DEV;
}

function getApiKey() {
  const keyIndex = process.argv.indexOf('--api-key');
  if (keyIndex !== -1 && process.argv[keyIndex + 1]) {
    return process.argv[keyIndex + 1];
  }
  return DEFAULT_API_KEY;
}

function getModel() {
  const modelIndex = process.argv.indexOf('--model');
  if (modelIndex !== -1 && process.argv[modelIndex + 1]) {
    return process.argv[modelIndex + 1];
  }
  return 'google-ai-studio/gemini-2.0-flash';
}

function getMessage() {
  const args = process.argv
    .slice(2)
    .filter(
      arg =>
        !arg.startsWith('--') &&
        arg !== process.argv[process.argv.indexOf('--api-key') + 1] &&
        arg !== process.argv[process.argv.indexOf('--model') + 1]
    );

  return args.length > 0
    ? args.join(' ')
    : 'Hello! This is a test message from the AI Gateway chat script.';
}

function showHelp() {
  console.log(`
💬 AI Gateway Chat Test Script

Usage: node scripts/chat.js [options] [message]

Options:
  --prod              Use production endpoint instead of localhost
  --api-key <key>     API key to use (default: demo key)
  --model <model>     Model to use (default: google-ai-studio/gemini-2.0-flash)
  --stream           Use streaming response (default: false)
  --interactive      Start interactive chat mode
  --help             Show this help message

Examples:
  node scripts/chat.js "What is the capital of France?"
  node scripts/chat.js --model openai/gpt-4o "Explain quantum computing"
  node scripts/chat.js --model anthropic/claude-3-haiku "Hello world"
  node scripts/chat.js --api-key gw_live_xyz123 "Hello world"
  node scripts/chat.js --prod "Test production endpoint"

Available Models (format: provider/model):
  - google-ai-studio/gemini-2.0-flash (default, latest)
  - openai/gpt-4o-mini (fastest)
  - openai/gpt-4o
  - openai/gpt-4
  - openai/gpt-3.5-turbo
  - anthropic/claude-3-haiku
  - anthropic/claude-3-sonnet
  - groq/mixtral-8x7b-32768
  - mistral/mistral-large-latest
`);
}

async function testChat() {
  if (process.argv.includes('--help')) {
    showHelp();
    return;
  }

  const endpoint = getApiEndpoint();
  const apiKey = getApiKey();
  const model = getModel();
  const message = getMessage();
  const useStreaming = process.argv.includes('--stream');
  const environment = process.argv.includes('--prod') ? 'PRODUCTION' : 'DEVELOPMENT';

  console.log(`💬 AI Gateway Chat Test`);
  console.log(`📍 Environment: ${environment}`);
  console.log(`🔗 Endpoint: ${endpoint}`);
  console.log(`🤖 Model: ${model}`);
  console.log(`🗝️  API Key: ${apiKey.substring(0, 10)}...`);
  console.log(`💭 Message: ${message}`);
  console.log(`🌊 Streaming: ${useStreaming ? 'Yes' : 'No'}`);
  console.log('');

  const requestBody = {
    model: model,
    messages: [
      {
        role: 'user',
        content: message,
      },
    ],
    max_tokens: 500,
    temperature: 0.7,
  };

  if (useStreaming) {
    requestBody.stream = true;
  }

  console.log('📤 Sending request...');
  const startTime = Date.now();

  try {
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseTime = Date.now() - startTime;
    console.log(`⏱️  Response time: ${responseTime}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Request failed (${response.status}):`, errorText);

      // Provide helpful error context
      if (response.status === 401) {
        console.log('\n🔧 Troubleshooting:');
        console.log('   - Check if your API key is valid');
        console.log('   - Run setup script: node scripts/setup.js');
        console.log('   - Check admin metrics: node scripts/admin.js metrics');
      } else if (response.status === 429) {
        console.log('\n🔧 Troubleshooting:');
        console.log('   - You may have exceeded your quota');
        console.log('   - Check usage: node scripts/admin.js user usage <user_id>');
        console.log('   - Reset quota: node scripts/admin.js user reset-quota <user_id>');
      }

      return;
    }

    if (useStreaming) {
      console.log('📨 Streaming response:');
      console.log('---');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices[0]?.delta?.content;
                if (content) {
                  process.stdout.write(content);
                  fullContent += content;
                }
              } catch (_e) {
                // Skip malformed JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      console.log('\n---');
      console.log(`📊 Total characters: ${fullContent.length}`);
    } else {
      const result = await response.json();

      console.log('📨 Response:');
      console.log('---');
      console.log(result.choices[0].message.content);
      console.log('---');

      console.log(`📊 Usage:`);
      console.log(`   Prompt tokens: ${result.usage.prompt_tokens}`);
      console.log(`   Completion tokens: ${result.usage.completion_tokens}`);
      console.log(`   Total tokens: ${result.usage.total_tokens}`);

      if (result.usage.estimated_cost) {
        console.log(`   Estimated cost: $${result.usage.estimated_cost.toFixed(6)}`);
      }
    }

    console.log('\n✅ Chat test completed successfully!');
  } catch (error) {
    console.error('❌ Chat test failed:', error.message);

    console.log('\n🔧 Troubleshooting:');
    console.log('   - Make sure the dev server is running: pnpm dev');
    console.log('   - Check if the endpoint is accessible');
    console.log('   - Verify your API key with: node scripts/admin.js metrics');

    process.exit(1);
  }
}

// Interactive mode for continuous chat
async function interactiveChat() {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const endpoint = getApiEndpoint();
  const apiKey = getApiKey();
  const model = getModel();

  console.log(`💬 Interactive Chat Mode`);
  console.log(`🤖 Model: ${model}`);
  console.log(`Type 'quit' or 'exit' to end the chat`);
  console.log('---');

  const conversation = [];

  function askQuestion() {
    rl.question('You: ', async input => {
      if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
        rl.close();
        return;
      }

      conversation.push({ role: 'user', content: input });

      try {
        const response = await fetch(`${endpoint}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model,
            messages: conversation,
            max_tokens: 500,
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`❌ Error: ${errorText}`);
        } else {
          const result = await response.json();
          const reply = result.choices[0].message.content;
          conversation.push({ role: 'assistant', content: reply });
          console.log(`AI: ${reply}`);
        }
      } catch (error) {
        console.log(`❌ Error: ${error.message}`);
      }

      console.log('---');
      askQuestion();
    });
  }

  askQuestion();
}

// Determine mode
if (process.argv.includes('--interactive')) {
  interactiveChat();
} else {
  testChat();
}
