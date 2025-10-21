#!/usr/bin/env node
/**
 * Admin management script for AI Gateway operations
 * Usage: node scripts/admin.js <command> [options]
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

function showHelp() {
  console.log(`
🔧 AI Gateway Admin CLI

Usage: node scripts/admin.js <command> [options]

Commands:
  metrics                                Show system metrics and usage statistics
  org create <name> [budget]             Create a new organization
  org get <org_id>                       Get organization details
  org usage <org_id>                     Show organization usage
  org vkeys <org_id>                     List virtual keys in organization

  vkey create <org_id> [limit] [user] [name]  Create a new virtual key
  vkey get <key_id>                            Get virtual key details
  vkey usage <key_id>                          Show virtual key usage
  vkey reset-quota <key_id>                    Reset virtual key quota
  vkey update <key_id> <field> <value>         Update virtual key (name, limit, status, user)
  vkey delete <key_id>                         Delete virtual key

Options:
  --prod          Use production endpoint instead of localhost
  --help          Show this help message

Examples:
  node scripts/admin.js metrics
  node scripts/admin.js org create "My Company" 1000
  node scripts/admin.js vkey create org_123 200 alice@company.com "Alice Production Key"
  node scripts/admin.js vkey usage vkey_456
  node scripts/admin.js vkey update vkey_456 status revoked
`);
}

async function getMetrics() {
  const endpoint = getApiEndpoint();
  console.log('📊 Fetching system metrics...');

  try {
    const metrics = await makeRequest(`${endpoint}/admin/metrics`);

    console.log('\n🎯 System Metrics');
    console.log(`Timestamp: ${metrics.timestamp}`);
    console.log('');

    console.log('📈 Entity Counts');
    console.log(`Total Virtual Keys: ${metrics.entities.virtual_keys}`);
    console.log(`Total Organizations: ${metrics.entities.organizations}`);

    if (metrics.note) {
      console.log('');
      console.log(`ℹ️  ${metrics.note}`);
    }
  } catch (error) {
    console.error('❌ Failed to get metrics:', error.message);
  }
}

async function createOrganization(name, budget = 1000) {
  const endpoint = getApiEndpoint();
  console.log(`🏢 Creating organization: ${name}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        monthly_budget_usd: parseFloat(budget),
        failure_mode: 'fail-open',
      }),
    });

    console.log('✅ Organization created successfully');
    console.log(`   ID: ${result.organization.org_id}`);
    console.log(`   Name: ${result.organization.name}`);
    console.log(`   Budget: $${result.organization.monthly_budget_usd}/month`);
    console.log(`   Failure Mode: ${result.organization.failure_mode}`);
  } catch (error) {
    console.error('❌ Failed to create organization:', error.message);
  }
}

async function getOrganization(orgId) {
  const endpoint = getApiEndpoint();
  console.log(`🏢 Getting organization: ${orgId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations/${orgId}`);

    console.log('✅ Organization details:');
    console.log(`   ID: ${result.organization.org_id}`);
    console.log(`   Name: ${result.organization.name}`);
    console.log(`   Budget: $${result.organization.monthly_budget_usd}/month`);
    console.log(`   Failure Mode: ${result.organization.failure_mode}`);
    console.log(`   Created: ${result.organization.created_at}`);
  } catch (error) {
    console.error('❌ Failed to get organization:', error.message);
  }
}

async function getOrganizationUsage(orgId) {
  const endpoint = getApiEndpoint();
  console.log(`📊 Getting organization usage: ${orgId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations/${orgId}/usage`);

    console.log('✅ Organization usage:');
    console.log(`   Organization ID: ${result.organization_id}`);
    console.log(`   Monthly Budget: $${result.monthly_budget_usd}`);
    console.log(`   Current Month: ${result.current_month}`);
    console.log(`   Usage: $${result.month_usage_usd.toFixed(2)}`);
    console.log(`   Remaining: $${result.remaining_budget_usd.toFixed(2)}`);
    console.log(`   Requests: ${result.request_count}`);
    console.log(`   Last Update: ${result.last_update}`);
  } catch (error) {
    console.error('❌ Failed to get organization usage:', error.message);
  }
}

async function getOrganizationVkeys(orgId) {
  const endpoint = getApiEndpoint();
  console.log(`🔑 Getting virtual keys for organization: ${orgId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations/${orgId}/vkeys`);

    console.log(`✅ Found ${result.virtual_keys.length} virtual keys:`);
    result.virtual_keys.forEach((vkey, index) => {
      console.log(`   ${index + 1}. ${vkey.name || vkey.key_id} (${vkey.key_id})`);
      console.log(`      User: ${vkey.user || 'N/A'}`);
      console.log(`      Limit: $${vkey.monthly_limit_usd}/month`);
      console.log(`      Status: ${vkey.status}`);
      console.log(`      Created: ${vkey.created_at}`);
    });
  } catch (error) {
    console.error('❌ Failed to get organization virtual keys:', error.message);
  }
}

async function createVirtualKey(orgId, limit = 100, user = undefined, name = undefined) {
  const endpoint = getApiEndpoint();
  console.log(`🔑 Creating virtual key for org: ${orgId}`);

  try {
    const body = {
      org_id: orgId,
      monthly_limit_usd: parseFloat(limit),
    };

    if (user) body.user = user;
    if (name) body.name = name;

    const result = await makeRequest(`${endpoint}/admin/vkeys`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    console.log('✅ Virtual key created successfully');
    console.log(`   Key ID: ${result.virtual_key.key_id}`);
    console.log(`   Name: ${result.virtual_key.name || 'N/A'}`);
    console.log(`   User: ${result.virtual_key.user || 'N/A'}`);
    console.log(`   Org ID: ${result.virtual_key.org_id}`);
    console.log(`   Limit: $${result.virtual_key.monthly_limit_usd}/month`);
    console.log(`   Status: ${result.virtual_key.status}`);
    console.log(`   🔑 API Key: ${result.api_key}`);
    console.log('   ⚠️  Save this API key - it will not be shown again!');
  } catch (error) {
    console.error('❌ Failed to create virtual key:', error.message);
  }
}

async function getVirtualKey(keyId) {
  const endpoint = getApiEndpoint();
  console.log(`🔑 Getting virtual key: ${keyId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/vkeys/${keyId}`);

    console.log('✅ Virtual key details:');
    console.log(`   Key ID: ${result.virtual_key.key_id}`);
    console.log(`   Name: ${result.virtual_key.name || 'N/A'}`);
    console.log(`   User: ${result.virtual_key.user || 'N/A'}`);
    console.log(`   Organization: ${result.virtual_key.org_id}`);
    console.log(`   Limit: $${result.virtual_key.monthly_limit_usd}/month`);
    console.log(`   Status: ${result.virtual_key.status}`);
    console.log(`   Created: ${result.virtual_key.created_at}`);
  } catch (error) {
    console.error('❌ Failed to get virtual key:', error.message);
  }
}

async function getVirtualKeyUsage(keyId) {
  const endpoint = getApiEndpoint();
  console.log(`📊 Getting virtual key usage: ${keyId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/vkeys/${keyId}/usage`);

    console.log('✅ Virtual key usage:');
    console.log(`   Key ID: ${result.key_id}`);
    console.log(`   Name: ${result.name || 'N/A'}`);
    console.log(`   User: ${result.user || 'N/A'}`);
    console.log(`   Current Month: ${result.usage.current_month}`);
    console.log(`   Usage: $${result.usage.usage_usd.toFixed(2)}`);
    console.log(`   Limit: $${result.usage.limit_usd}`);
    console.log(`   Remaining: $${result.usage.remaining_usd.toFixed(2)}`);
    console.log(`   Requests: ${result.usage.request_count}`);
    console.log(`   Last Update: ${result.usage.last_update}`);
  } catch (error) {
    console.error('❌ Failed to get virtual key usage:', error.message);
  }
}

async function resetVirtualKeyQuota(keyId) {
  const endpoint = getApiEndpoint();
  console.log(`🔄 Resetting quota for virtual key: ${keyId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/vkeys/${keyId}/reset-quota`, {
      method: 'POST',
      body: JSON.stringify({
        reset_reason: 'Manual reset via admin script',
      }),
    });

    console.log('✅ Virtual key quota reset successfully');
    console.log(`   Key ID: ${result.key_id}`);
    console.log(`   New usage: $${result.quota.month_usage_usd}`);
    console.log(`   Current month: ${result.quota.current_month}`);
  } catch (error) {
    console.error('❌ Failed to reset virtual key quota:', error.message);
  }
}

async function updateVirtualKey(keyId, field, value) {
  const endpoint = getApiEndpoint();
  console.log(`✏️  Updating virtual key ${keyId}: ${field} = ${value}`);

  try {
    const body = {};

    // Parse value based on field type
    if (field === 'monthly_limit_usd') {
      body[field] = parseFloat(value);
    } else {
      body[field] = value;
    }

    const result = await makeRequest(`${endpoint}/admin/vkeys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    console.log('✅ Virtual key updated successfully');
    console.log(`   Key ID: ${result.virtual_key.key_id}`);
    console.log(`   Name: ${result.virtual_key.name || 'N/A'}`);
    console.log(`   User: ${result.virtual_key.user || 'N/A'}`);
    console.log(`   Limit: $${result.virtual_key.monthly_limit_usd}/month`);
    console.log(`   Status: ${result.virtual_key.status}`);
  } catch (error) {
    console.error('❌ Failed to update virtual key:', error.message);
  }
}

async function deleteVirtualKey(keyId) {
  const endpoint = getApiEndpoint();
  console.log(`🗑️  Deleting virtual key: ${keyId}`);

  try {
    const _result = await makeRequest(`${endpoint}/admin/vkeys/${keyId}`, {
      method: 'DELETE',
    });

    console.log('✅ Virtual key deleted successfully');
  } catch (error) {
    console.error('❌ Failed to delete virtual key:', error.message);
  }
}

// Main command handler
async function main() {
  const args = process.argv.slice(2);
  const environment = process.argv.includes('--prod') ? 'PRODUCTION' : 'DEVELOPMENT';

  if (args.includes('--help') || args.length === 0) {
    showHelp();
    return;
  }

  console.log(`🔧 AI Gateway Admin CLI`);
  console.log(`📍 Environment: ${environment}`);
  console.log(`🔗 Endpoint: ${getApiEndpoint()}`);
  console.log(`🗝️  Admin Key: ${getAdminApiKey().substring(0, 10)}...`);
  console.log('');

  const [command, subcommand, ...params] = args.filter(arg => !arg.startsWith('--'));

  try {
    switch (command) {
      case 'metrics':
        await getMetrics();
        break;

      case 'org':
        switch (subcommand) {
          case 'create':
            if (!params[0]) {
              console.error('❌ Organization name is required');
              return;
            }
            await createOrganization(params[0], params[1]);
            break;
          case 'get':
            if (!params[0]) {
              console.error('❌ Organization ID is required');
              return;
            }
            await getOrganization(params[0]);
            break;
          case 'usage':
            if (!params[0]) {
              console.error('❌ Organization ID is required');
              return;
            }
            await getOrganizationUsage(params[0]);
            break;
          case 'vkeys':
            if (!params[0]) {
              console.error('❌ Organization ID is required');
              return;
            }
            await getOrganizationVkeys(params[0]);
            break;
          default:
            console.error(`❌ Unknown org subcommand: ${subcommand}`);
            console.log('   Available: create, get, usage, vkeys');
        }
        break;

      case 'vkey':
        switch (subcommand) {
          case 'create':
            if (!params[0]) {
              console.error('❌ Organization ID is required');
              return;
            }
            // vkey create <org_id> [limit] [user] [name]
            await createVirtualKey(params[0], params[1], params[2], params[3]);
            break;
          case 'get':
            if (!params[0]) {
              console.error('❌ Key ID is required');
              return;
            }
            await getVirtualKey(params[0]);
            break;
          case 'usage':
            if (!params[0]) {
              console.error('❌ Key ID is required');
              return;
            }
            await getVirtualKeyUsage(params[0]);
            break;
          case 'reset-quota':
            if (!params[0]) {
              console.error('❌ Key ID is required');
              return;
            }
            await resetVirtualKeyQuota(params[0]);
            break;
          case 'update':
            if (!params[0] || !params[1] || !params[2]) {
              console.error('❌ Key ID, field, and value are required');
              console.log('   Example: vkey update vkey_123 name "New Name"');
              console.log('   Fields: name, monthly_limit_usd, status, user');
              return;
            }
            await updateVirtualKey(params[0], params[1], params[2]);
            break;
          case 'delete':
            if (!params[0]) {
              console.error('❌ Key ID is required');
              return;
            }
            await deleteVirtualKey(params[0]);
            break;
          default:
            console.error(`❌ Unknown vkey subcommand: ${subcommand}`);
            console.log('   Available: create, get, usage, reset-quota, update, delete');
        }
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('   Available commands: metrics, org, vkey');
        console.log('   Use --help for full usage information');
    }
  } catch (error) {
    console.error('❌ Command failed:', error.message);
    process.exit(1);
  }
}

// Run the CLI
main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
