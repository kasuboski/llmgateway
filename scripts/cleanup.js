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

async function getSystemMetrics() {
  const endpoint = getApiEndpoint();
  console.log('🔍 Getting system metrics...');

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

async function getAllOrganizations() {
  const endpoint = getApiEndpoint();

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations`);
    return result.organizations || [];
  } catch (error) {
    console.error('❌ Failed to list organizations:', error.message);
    return [];
  }
}

async function deleteOrganization(orgId) {
  const endpoint = getApiEndpoint();

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations/${orgId}`, {
      method: 'DELETE',
    });
    return result;
  } catch (error) {
    throw new Error(`Failed to delete organization ${orgId}: ${error.message}`);
  }
}

async function confirmCleanup(orgCount) {
  console.log('\n⚠️  WARNING: This will delete ALL data from KV storage!');
  console.log(`   - ${orgCount} organization(s) and all their settings`);
  console.log('   - All associated users and their quotas');
  console.log('   - All virtual keys and their quotas');
  console.log('   - All usage tracking data');

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
  const metrics = await getSystemMetrics();

  if (!metrics) {
    console.log('\n❌ Cannot proceed - system is not accessible');
    console.log('   Make sure the gateway is running:');
    console.log('   ADMIN_API_KEY="admin_test_key_123" pnpm dev');
    process.exit(1);
  }

  // Get all organizations
  console.log('\n🔍 Listing all organizations...');
  const organizations = await getAllOrganizations();

  if (organizations.length === 0) {
    console.log('\n✅ No organizations found - KV storage is already clean!');
    console.log('   Run the setup script to create demo data:');
    console.log('   node scripts/setup.js');
    return;
  }

  console.log(`📋 Found ${organizations.length} organization(s):`);
  organizations.forEach((org, idx) => {
    console.log(`   ${idx + 1}. ${org.name} (${org.org_id})`);
  });

  await confirmCleanup(organizations.length);

  console.log('\n🚀 Starting cleanup process...');
  console.log('   Using cascade delete - each org deletion will remove:');
  console.log('   - All users in the organization');
  console.log('   - All virtual keys for those users');
  console.log('   - All quota data\n');

  let totalDeleted = 0;
  let totalVkeys = 0;
  let totalUsers = 0;

  for (const org of organizations) {
    try {
      console.log(`🗑️  Deleting ${org.name} (${org.org_id})...`);
      const result = await deleteOrganization(org.org_id);

      console.log(`   ✅ Deleted ${result.deleted_virtual_keys} virtual keys, ${result.deleted_users} users`);
      totalDeleted++;
      totalVkeys += result.deleted_virtual_keys;
      totalUsers += result.deleted_users;
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
    }
  }

  console.log('\n🎉 Cleanup completed successfully!');
  console.log(`📊 Summary:`);
  console.log(`   - Organizations deleted: ${totalDeleted}/${organizations.length}`);
  console.log(`   - Users deleted: ${totalUsers}`);
  console.log(`   - Virtual keys deleted: ${totalVkeys}`);
  console.log('');
  console.log('✅ KV storage is now clean!');
  console.log('   Run the setup script to create demo data:');
  console.log('   node scripts/setup.js');
}

// Run the cleanup
cleanup().catch(error => {
  console.error('❌ Cleanup failed:', error.message);
  process.exit(1);
});
