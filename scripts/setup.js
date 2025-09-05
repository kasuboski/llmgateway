#!/usr/bin/env node
/**
 * Setup script to initialize the AI Gateway with demo organizations and users
 * Usage: node scripts/setup.js [--prod]
 */

const API_ENDPOINT_DEV = 'http://localhost:8787';
const API_ENDPOINT_PROD = 'https://ai-gateway-proxy.favoritechild.workers.dev';

function getAdminApiKey() {
  const isProd = process.argv.includes('--prod');

  if (isProd) {
    if (!process.env.ADMIN_API_KEY) {
      console.error('❌ ADMIN_API_KEY environment variable is required for production');
      console.error('   Set it with: export ADMIN_API_KEY="your_admin_key"');
      process.exit(1);
    }
    return process.env.ADMIN_API_KEY;
  }

  return process.env.ADMIN_API_KEY || 'admin_test_key_123';
}

function getApiEndpoint() {
  return process.argv.includes('--prod') ? API_ENDPOINT_PROD : API_ENDPOINT_DEV;
}

async function makeRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${getAdminApiKey()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function createOrganization(orgData) {
  const endpoint = getApiEndpoint();
  console.log(`📋 Creating organization: ${orgData.name}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations`, {
      method: 'POST',
      body: JSON.stringify(orgData),
    });

    console.log(`✅ Organization created: ${result.organization.org_id}`);
    return result.organization;
  } catch (error) {
    console.error(`❌ Failed to create organization ${orgData.name}:`, error.message);
    throw error;
  }
}

async function createUser(userData) {
  const endpoint = getApiEndpoint();
  console.log(`👤 Creating user: ${userData.email}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/users`, {
      method: 'POST',
      body: JSON.stringify(userData),
    });

    console.log(`✅ User created: ${result.user.user_id}`);
    console.log(`🔑 API Key: ${result.api_key}`);
    console.log(`⚠️  Save this API key - it won't be shown again!`);

    return {
      user: result.user,
      api_key: result.api_key,
    };
  } catch (error) {
    console.error(`❌ Failed to create user ${userData.email}:`, error.message);
    throw error;
  }
}

async function checkSystemHealth() {
  const endpoint = getApiEndpoint();
  console.log('🏥 Checking system health...');

  try {
    const metrics = await makeRequest(`${endpoint}/admin/metrics`);
    console.log('✅ System is healthy');
    console.log(
      `📊 Current state: ${metrics.usage.total_users} users, ${metrics.usage.total_organizations} orgs`
    );
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function setup() {
  const endpoint = getApiEndpoint();
  const environment = process.argv.includes('--prod') ? 'PRODUCTION' : 'DEVELOPMENT';

  console.log(`🚀 AI Gateway Setup Script`);
  console.log(`📍 Environment: ${environment}`);
  console.log(`🔗 Endpoint: ${endpoint}`);
  console.log(`🗝️  Admin Key: ${getAdminApiKey().substring(0, 10)}...`);
  console.log('');

  // Check system health
  const isHealthy = await checkSystemHealth();
  if (!isHealthy) {
    console.log('❌ System health check failed. Make sure the dev server is running.');
    console.log('   Run: ADMIN_API_KEY="admin_test_key_123" pnpm dev');
    process.exit(1);
  }

  console.log('\n🏗️  Setting up demo environment...');

  // Create demo organizations with provider keys
  const providerKeys = {};

  // Add Gemini API key if provided
  if (process.env.GEMINI_API_KEY) {
    providerKeys['google-ai-studio'] = process.env.GEMINI_API_KEY;
    console.log('✅ Using GEMINI_API_KEY from environment');
  } else {
    console.log(
      '⚠️  No GEMINI_API_KEY found in environment - organizations will be created without Google AI Studio access'
    );
  }

  // Add OpenAI API key if provided
  if (process.env.OPENAI_API_KEY) {
    providerKeys.openai = process.env.OPENAI_API_KEY;
    console.log('✅ Using OPENAI_API_KEY from environment');
  }

  const demoOrg = await createOrganization({
    name: 'Demo Corporation',
    monthly_budget_usd: 1000.0,
    failure_mode: 'fail-open',
    provider_keys: providerKeys,
  });

  const testOrg = await createOrganization({
    name: 'Test Organization',
    monthly_budget_usd: 500.0,
    failure_mode: 'fail-closed',
    provider_keys: providerKeys,
  });

  console.log('');

  // Create demo users
  const demoUser = await createUser({
    email: 'demo@example.com',
    org_id: demoOrg.org_id,
    monthly_limit_usd: 100.0,
  });

  console.log('');

  const testUser = await createUser({
    email: 'test@example.com',
    org_id: testOrg.org_id,
    monthly_limit_usd: 50.0,
  });

  console.log('');

  const adminUser = await createUser({
    email: 'admin@example.com',
    org_id: demoOrg.org_id,
    monthly_limit_usd: 200.0,
  });

  // Summary
  console.log('\n🎉 Setup completed successfully!');
  console.log('\n📋 Summary:');
  console.log(`   Organizations created: 2`);
  console.log(`   Users created: 3`);
  console.log(`   API keys generated: 3`);
  console.log('');

  console.log('🏢 Organizations:');
  console.log(`   1. ${demoOrg.name} (${demoOrg.org_id})`);
  console.log(`      Budget: $${demoOrg.monthly_budget_usd}/month, Mode: ${demoOrg.failure_mode}`);
  console.log(
    `      Provider Keys: ${Object.keys(demoOrg.provider_keys || {}).join(', ') || 'None'}`
  );
  console.log(`   2. ${testOrg.name} (${testOrg.org_id})`);
  console.log(`      Budget: $${testOrg.monthly_budget_usd}/month, Mode: ${testOrg.failure_mode}`);
  console.log(
    `      Provider Keys: ${Object.keys(testOrg.provider_keys || {}).join(', ') || 'None'}`
  );
  console.log('');

  console.log('👥 Users:');
  console.log(`   1. ${demoUser.user.email} (${demoUser.user.user_id})`);
  console.log(`      Limit: $${demoUser.user.monthly_limit_usd}/month`);
  console.log(`      API Key: ${demoUser.api_key}`);
  console.log('');
  console.log(`   2. ${testUser.user.email} (${testUser.user.user_id})`);
  console.log(`      Limit: $${testUser.user.monthly_limit_usd}/month`);
  console.log(`      API Key: ${testUser.api_key}`);
  console.log('');
  console.log(`   3. ${adminUser.user.email} (${adminUser.user.user_id})`);
  console.log(`      Limit: $${adminUser.user.monthly_limit_usd}/month`);
  console.log(`      API Key: ${adminUser.api_key}`);
  console.log('');

  console.log('🧪 Next Steps:');
  console.log("   1. Save the API keys above (they won't be shown again)");
  console.log('   2. Test the chat endpoint with: node scripts/chat.js');
  console.log('   3. Manage users with: node scripts/admin.js --help');
  console.log('   4. Check metrics with: node scripts/admin.js metrics');

  console.log('\n🔑 Provider API Keys:');
  if (process.env.GEMINI_API_KEY) {
    console.log('   ✅ Google AI Studio: Configured (Gemini models available)');
  } else {
    console.log('   ❌ Google AI Studio: Not configured');
    console.log('      Set GEMINI_API_KEY environment variable and re-run setup');
  }
  if (process.env.OPENAI_API_KEY) {
    console.log('   ✅ OpenAI: Configured (GPT models available)');
  } else {
    console.log('   ❌ OpenAI: Not configured');
    console.log('      Set OPENAI_API_KEY environment variable and re-run setup');
  }

  console.log('\n💡 Tip: You can check the current state anytime with:');
  console.log('   node scripts/admin.js metrics');
}

// Run the setup
setup().catch(error => {
  console.error('❌ Setup failed:', error.message);
  process.exit(1);
});
