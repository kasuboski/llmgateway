#!/usr/bin/env node
/**
 * Setup script to initialize the AI Gateway with demo organizations and virtual keys
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
  console.log(`👤 Creating user: ${userData.user}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/users`, {
      method: 'POST',
      body: JSON.stringify(userData),
    });

    console.log(`✅ User created: ${result.user.user}`);
    return result.user;
  } catch (error) {
    console.error(`❌ Failed to create user ${userData.user}:`, error.message);
    throw error;
  }
}

async function createVirtualKey(vkeyData) {
  const endpoint = getApiEndpoint();
  console.log(`🔑 Creating virtual key: ${vkeyData.name || vkeyData.user || 'unnamed'}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/vkeys`, {
      method: 'POST',
      body: JSON.stringify(vkeyData),
    });

    console.log(`✅ Virtual key created: ${result.virtual_key.key_id}`);
    console.log(`🔑 API Key: ${result.api_key}`);
    console.log(`⚠️  Save this API key - it won't be shown again!`);

    return {
      vkey: result.virtual_key,
      api_key: result.api_key,
    };
  } catch (error) {
    console.error(`❌ Failed to create virtual key:`, error.message);
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
      `📊 Current state: ${metrics.entities.virtual_keys || 0} virtual keys, ${metrics.entities.organizations || 0} orgs`
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
    user: 'demo@example.com',
    org_id: demoOrg.org_id,
    monthly_limit_usd: 300.0,
  });

  console.log('');

  const testUser = await createUser({
    user: 'test@example.com',
    org_id: testOrg.org_id,
    monthly_limit_usd: 150.0,
  });

  console.log('');

  const adminUser = await createUser({
    user: 'admin@example.com',
    org_id: demoOrg.org_id,
    monthly_limit_usd: 500.0,
  });

  console.log('');

  // Create demo virtual keys
  const demoKey = await createVirtualKey({
    org_id: demoOrg.org_id,
    user: demoUser.user,
    name: 'Demo User Key',
    monthly_limit_usd: 100.0,
  });

  console.log('');

  const testKey = await createVirtualKey({
    org_id: testOrg.org_id,
    user: testUser.user,
    name: 'Test User Key',
    monthly_limit_usd: 50.0,
  });

  console.log('');

  const adminKey = await createVirtualKey({
    org_id: demoOrg.org_id,
    user: adminUser.user,
    name: 'Admin User Key',
    monthly_limit_usd: 200.0,
  });

  // Summary
  console.log('\n🎉 Setup completed successfully!');
  console.log('\n📋 Summary:');
  console.log(`   Organizations created: 2`);
  console.log(`   Users created: 3`);
  console.log(`   Virtual keys created: 3`);
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
  console.log(`   1. ${demoUser.user}`);
  console.log(`      Organization: ${demoUser.org_id}`);
  console.log(`      Monthly Limit: $${demoUser.monthly_limit_usd}`);
  console.log(`   2. ${testUser.user}`);
  console.log(`      Organization: ${testUser.org_id}`);
  console.log(`      Monthly Limit: $${testUser.monthly_limit_usd}`);
  console.log(`   3. ${adminUser.user}`);
  console.log(`      Organization: ${adminUser.org_id}`);
  console.log(`      Monthly Limit: $${adminUser.monthly_limit_usd}`);
  console.log('');

  console.log('🔑 Virtual Keys:');
  console.log(`   1. ${demoKey.vkey.name} (${demoKey.vkey.key_id})`);
  console.log(`      User: ${demoKey.vkey.user}`);
  console.log(`      Limit: $${demoKey.vkey.monthly_limit_usd}/month`);
  console.log(`      API Key: ${demoKey.api_key}`);
  console.log('');
  console.log(`   2. ${testKey.vkey.name} (${testKey.vkey.key_id})`);
  console.log(`      User: ${testKey.vkey.user}`);
  console.log(`      Limit: $${testKey.vkey.monthly_limit_usd}/month`);
  console.log(`      API Key: ${testKey.api_key}`);
  console.log('');
  console.log(`   3. ${adminKey.vkey.name} (${adminKey.vkey.key_id})`);
  console.log(`      User: ${adminKey.vkey.user}`);
  console.log(`      Limit: $${adminKey.vkey.monthly_limit_usd}/month`);
  console.log(`      API Key: ${adminKey.api_key}`);
  console.log('');

  console.log('🧪 Next Steps:');
  console.log("   1. Save the API keys above (they won't be shown again)");
  console.log('   2. Test the chat endpoint with: node scripts/chat.js');
  console.log('   3. Manage virtual keys with: node scripts/admin.js --help');
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
