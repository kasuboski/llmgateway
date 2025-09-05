#!/usr/bin/env node
/**
 * Admin management script for AI Gateway operations
 * Usage: node scripts/admin.js <command> [options]
 */

const API_ENDPOINT_DEV = 'http://localhost:8787';
const API_ENDPOINT_PROD = 'https://ai-gateway-proxy.favoritechild.workers.dev';
const ADMIN_API_KEY = 'admin_test_key_123';

function getApiEndpoint() {
  return process.argv.includes('--prod') ? API_ENDPOINT_PROD : API_ENDPOINT_DEV;
}

async function makeRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${ADMIN_API_KEY}`,
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
  metrics                     Show system metrics and usage statistics
  org create <name> [budget]  Create a new organization
  org get <org_id>           Get organization details
  org usage <org_id>         Show organization usage
  org users <org_id>         List users in organization
  
  user create <email> <org_id> [limit]  Create a new user
  user get <user_id>                    Get user details
  user usage <user_id>                  Show user usage
  user reset-quota <user_id>            Reset user quota
  user delete <user_id>                 Delete user
  
  apikey create <user_id>               Generate new API key for user

Note: Some operations require direct KV access via Cloudflare Dashboard:
  - Listing/revoking API keys
  - Updating user/org settings
  - Bulk operations

Options:
  --prod          Use production endpoint instead of localhost
  --help          Show this help message

Examples:
  node scripts/admin.js metrics
  node scripts/admin.js org create "My Company" 1000
  node scripts/admin.js user create admin@company.com org_123 200
  node scripts/admin.js user usage user_456
`);
}

async function getMetrics() {
  const endpoint = getApiEndpoint();
  console.log('📊 Fetching system metrics...');

  try {
    const metrics = await makeRequest(`${endpoint}/admin/metrics`);

    console.log('\n🎯 System Metrics');
    console.log(`Timestamp: ${metrics.timestamp}`);
    console.log(`Response Time: ${metrics.system.response_time_ms}ms`);
    console.log('');

    console.log('📈 Usage Overview');
    console.log(`Current Month: ${metrics.usage.current_month}`);
    console.log(`Total Users: ${metrics.usage.total_users}`);
    console.log(`Active Users: ${metrics.usage.active_users}`);
    console.log(`Total Organizations: ${metrics.usage.total_organizations}`);
    console.log(`Total Requests: ${metrics.usage.total_requests_this_month}`);
    console.log(`Total Cost: $${metrics.usage.total_cost_usd_this_month.toFixed(2)}`);
    console.log('');

    console.log('🔑 API Keys');
    console.log(`Total: ${metrics.usage.api_keys.total}`);
    console.log(`Active: ${metrics.usage.api_keys.active}`);
    console.log(`Revoked: ${metrics.usage.api_keys.revoked}`);

    if (metrics.top_usage.users.length > 0) {
      console.log('');
      console.log('👥 Top Users by Usage');
      metrics.top_usage.users.slice(0, 5).forEach((user, index) => {
        console.log(
          `${index + 1}. ${user.user_id}: $${user.usage_usd.toFixed(2)} (${user.requests} requests)`
        );
      });
    }

    if (metrics.top_usage.organizations.length > 0) {
      console.log('');
      console.log('🏢 Top Organizations by Usage');
      metrics.top_usage.organizations.slice(0, 5).forEach((org, index) => {
        console.log(`${index + 1}. ${org.org_id}: $${org.usage_usd.toFixed(2)}`);
      });
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

async function getOrganizationUsers(orgId) {
  const endpoint = getApiEndpoint();
  console.log(`👥 Getting users for organization: ${orgId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/organizations/${orgId}/users`);

    console.log(`✅ Found ${result.users.length} users:`);
    result.users.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.email} (${user.user_id})`);
      console.log(`      Limit: $${user.monthly_limit_usd}/month`);
      console.log(`      Status: ${user.status}`);
      console.log(`      Created: ${user.created_at}`);
    });
  } catch (error) {
    console.error('❌ Failed to get organization users:', error.message);
  }
}

async function createUser(email, orgId, limit = 100) {
  const endpoint = getApiEndpoint();
  console.log(`👤 Creating user: ${email}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/users`, {
      method: 'POST',
      body: JSON.stringify({
        email,
        org_id: orgId,
        monthly_limit_usd: parseFloat(limit),
      }),
    });

    console.log('✅ User created successfully');
    console.log(`   ID: ${result.user.user_id}`);
    console.log(`   Email: ${result.user.email}`);
    console.log(`   Org ID: ${result.user.org_id}`);
    console.log(`   Limit: $${result.user.monthly_limit_usd}/month`);
    console.log(`   Status: ${result.user.status}`);
    console.log(`   🔑 API Key: ${result.api_key}`);
    console.log('   ⚠️  Save this API key - it will not be shown again!');
  } catch (error) {
    console.error('❌ Failed to create user:', error.message);
  }
}

async function getUser(userId) {
  const endpoint = getApiEndpoint();
  console.log(`👤 Getting user: ${userId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/users/${userId}`);

    console.log('✅ User details:');
    console.log(`   ID: ${result.user.user_id}`);
    console.log(`   Email: ${result.user.email}`);
    console.log(`   Organization: ${result.user.org_id}`);
    console.log(`   Limit: $${result.user.monthly_limit_usd}/month`);
    console.log(`   Status: ${result.user.status}`);
    console.log(`   Created: ${result.user.created_at}`);
  } catch (error) {
    console.error('❌ Failed to get user:', error.message);
  }
}

async function getUserUsage(userId) {
  const endpoint = getApiEndpoint();
  console.log(`📊 Getting user usage: ${userId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/users/${userId}/usage`);

    console.log('✅ User usage:');
    console.log(`   User ID: ${result.user_id}`);
    console.log(`   Email: ${result.email}`);
    console.log(`   Current Month: ${result.usage.current_month}`);
    console.log(`   Usage: $${result.usage.usage_usd.toFixed(2)}`);
    console.log(`   Limit: $${result.usage.limit_usd}`);
    console.log(`   Remaining: $${result.usage.remaining_usd.toFixed(2)}`);
    console.log(`   Requests: ${result.usage.request_count}`);
    console.log(`   Last Update: ${result.usage.last_update}`);
  } catch (error) {
    console.error('❌ Failed to get user usage:', error.message);
  }
}

async function resetUserQuota(userId) {
  const endpoint = getApiEndpoint();
  console.log(`🔄 Resetting quota for user: ${userId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/users/${userId}/reset-quota`, {
      method: 'POST',
      body: JSON.stringify({
        reset_reason: 'Manual reset via admin script',
      }),
    });

    console.log('✅ User quota reset successfully');
    console.log(`   User ID: ${result.user_id}`);
    console.log(`   New usage: $${result.quota.month_usage_usd}`);
    console.log(`   Current month: ${result.quota.current_month}`);
  } catch (error) {
    console.error('❌ Failed to reset user quota:', error.message);
  }
}

async function deleteUser(userId) {
  const endpoint = getApiEndpoint();
  console.log(`🗑️  Deleting user: ${userId}`);

  try {
    const _result = await makeRequest(`${endpoint}/admin/users/${userId}`, {
      method: 'DELETE',
    });

    console.log('✅ User deleted successfully');
  } catch (error) {
    console.error('❌ Failed to delete user:', error.message);
  }
}

async function createApiKey(userId) {
  const endpoint = getApiEndpoint();
  console.log(`🔑 Creating API key for user: ${userId}`);

  try {
    const result = await makeRequest(`${endpoint}/admin/users/${userId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    console.log('✅ API key created successfully');
    console.log(`   Key ID: ${result.key_id}`);
    console.log(`   🔑 API Key: ${result.api_key}`);
    console.log('   ⚠️  Save this API key - it will not be shown again!');
  } catch (error) {
    console.error('❌ Failed to create API key:', error.message);
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
          case 'users':
            if (!params[0]) {
              console.error('❌ Organization ID is required');
              return;
            }
            await getOrganizationUsers(params[0]);
            break;
          default:
            console.error(`❌ Unknown org subcommand: ${subcommand}`);
            console.log('   Available: create, get, usage, users');
        }
        break;

      case 'user':
        switch (subcommand) {
          case 'create':
            if (!params[0] || !params[1]) {
              console.error('❌ Email and org_id are required');
              return;
            }
            await createUser(params[0], params[1], params[2]);
            break;
          case 'get':
            if (!params[0]) {
              console.error('❌ User ID is required');
              return;
            }
            await getUser(params[0]);
            break;
          case 'usage':
            if (!params[0]) {
              console.error('❌ User ID is required');
              return;
            }
            await getUserUsage(params[0]);
            break;
          case 'reset-quota':
            if (!params[0]) {
              console.error('❌ User ID is required');
              return;
            }
            await resetUserQuota(params[0]);
            break;
          case 'delete':
            if (!params[0]) {
              console.error('❌ User ID is required');
              return;
            }
            await deleteUser(params[0]);
            break;
          default:
            console.error(`❌ Unknown user subcommand: ${subcommand}`);
            console.log('   Available: create, get, usage, reset-quota, delete');
        }
        break;

      case 'apikey':
        switch (subcommand) {
          case 'create':
            if (!params[0]) {
              console.error('❌ User ID is required');
              return;
            }
            await createApiKey(params[0]);
            break;
          case 'list':
            console.log(
              'ℹ️  API key listing requires direct KV access. Use the admin dashboard or Cloudflare KV console.'
            );
            break;
          case 'revoke':
            console.log(
              'ℹ️  API key revocation requires direct KV access. Update the apikey:* record status to "revoked" in KV.'
            );
            break;
          default:
            console.error(`❌ Unknown apikey subcommand: ${subcommand}`);
            console.log('   Available: create, list, revoke');
        }
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('   Available commands: metrics, org, user, apikey');
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
