#!/usr/bin/env node
/**
 * Cleanup script to reset KV storage and start fresh
 * Usage: node scripts/cleanup.js [--prod]
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

async function getAllKvKeys() {
  const endpoint = getApiEndpoint();
  console.log('🔍 Getting system metrics to identify all KV keys...');

  try {
    const metrics = await makeRequest(`${endpoint}/admin/metrics`);
    console.log(
      `📊 Found ${metrics.entities.virtual_keys || 0} virtual keys, ${metrics.entities.organizations || 0} organizations`
    );
    return metrics;
  } catch (error) {
    console.error('❌ Failed to get metrics:', error.message);
    console.log(
      'ℹ️  This might mean the KV storage is already clean or the admin API is not accessible'
    );
    return null;
  }
}

async function confirmCleanup() {
  console.log('\n⚠️  WARNING: This will delete ALL data from KV storage!');
  console.log('   - All virtual key configurations and quotas');
  console.log('   - All organization settings');
  console.log('   - All usage data');

  // In a real environment, you'd use readline for interactive confirmation
  // For script automation, we'll require explicit confirmation via flag
  if (!process.argv.includes('--confirm')) {
    console.log('\n❌ Cleanup cancelled. Add --confirm flag to proceed.');
    console.log('   Example: node scripts/cleanup.js --confirm');
    process.exit(1);
  }

  console.log('\n✅ Confirmation flag detected. Proceeding with cleanup...');
}

async function cleanup() {
  const endpoint = getApiEndpoint();
  const environment = process.argv.includes('--prod') ? 'PRODUCTION' : 'DEVELOPMENT';

  console.log(`🧹 AI Gateway KV Cleanup Script`);
  console.log(`📍 Environment: ${environment}`);
  console.log(`🔗 Endpoint: ${endpoint}`);
  console.log(`🗝️  Admin Key: ${getAdminApiKey().substring(0, 10)}...`);
  console.log('');

  // Get current state
  const metrics = await getAllKvKeys();

  await confirmCleanup();

  console.log('\n🚀 Starting cleanup process...');

  // Note: Since we don't have direct KV access in the script environment,
  // we'd need to implement cleanup endpoints in the admin API.
  // For now, we'll provide manual cleanup instructions.

  console.log('\n📋 Manual Cleanup Instructions:');
  console.log('   The current admin API does not expose bulk delete endpoints.');
  console.log('   To clean up KV storage, use the Cloudflare Dashboard:');
  console.log('');
  console.log('   1. Go to Cloudflare Dashboard > Workers & Pages > KV');
  console.log('   2. Select your GATEWAY_KV namespace');
  console.log('   3. Delete keys matching these patterns:');
  console.log('      - vkey:*  (virtual key configs and quotas)');
  console.log('      - user:*  (user configs and quotas)');
  console.log('      - org:*   (organization configs and quotas)');
  console.log('');
  console.log('   Or use wrangler CLI:');
  console.log('   wrangler kv:key list --binding GATEWAY_KV');
  console.log('   wrangler kv:key delete --binding GATEWAY_KV "key-name"');
  console.log('');

  if (metrics && (metrics.entities.virtual_keys !== '0' || metrics.entities.organizations !== '0')) {
    console.log(`📊 Current state before cleanup:`);
    console.log(`   - Virtual Keys: ${metrics.entities.virtual_keys}`);
    console.log(`   - Organizations: ${metrics.entities.organizations}`);
  }

  console.log('\n✅ Cleanup information provided.');
  console.log('ℹ️  After manual cleanup, run the setup script to reinitialize.');
}

// Run the cleanup
cleanup().catch(error => {
  console.error('❌ Cleanup failed:', error.message);
  process.exit(1);
});
