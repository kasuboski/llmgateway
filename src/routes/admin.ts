/**
 * Complete Admin API routes for user, organization, and system management
 */

import { Hono } from 'hono';
import { adminAuthMiddleware } from '../lib/auth';
import { generateApiKey, hashApiKey } from '../lib/crypto';
import { getCurrentMonth, getOrganizationQuotaRecord, getQuotaRecord } from '../lib/quota';
import type { ApiKeyRecord, OrganizationConfig, QuotaRecord, UserConfig } from '../types';

// Extend the generated CloudflareBindings to include secrets
interface Env extends CloudflareBindings {
  AI_GATEWAY_TOKEN: string;
  ADMIN_API_KEY: string;
}

const admin = new Hono<{ Bindings: Env }>();

// System metrics endpoint
admin.get('/metrics', adminAuthMiddleware, async c => {
  const { GATEWAY_KV } = c.env;

  try {
    const startTime = Date.now();
    const currentMonth = getCurrentMonth();
    const metrics = {
      timestamp: new Date().toISOString(),
      system: {
        version: '1.0.0',
        uptime: 'N/A (Workers runtime)',
        response_time_ms: 0,
      },
      usage: {
        current_month: currentMonth,
        total_users: 0,
        active_users: 0,
        total_organizations: 0,
        total_requests_this_month: 0,
        total_cost_usd_this_month: 0,
        api_keys: {
          total: 0,
          active: 0,
          revoked: 0,
        },
      },
      top_usage: {
        users: [] as Array<{ user_id: string; usage_usd: number; requests: number }>,
        organizations: [] as Array<{ org_id: string; usage_usd: number }>,
      },
    };

    // Scan KV for all data to build metrics
    const scanResults = await GATEWAY_KV.list();
    const userConfigs: UserConfig[] = [];
    const orgConfigs: OrganizationConfig[] = [];
    const userQuotas: Array<{ userId: string; quota: QuotaRecord }> = [];
    const orgQuotas: Array<{ orgId: string; quota: QuotaRecord }> = [];
    const apiKeys: ApiKeyRecord[] = [];

    // Process all keys
    for (const key of scanResults.keys) {
      if (key.name.startsWith('user:') && key.name.endsWith(':config')) {
        const config = (await GATEWAY_KV.get(key.name, 'json')) as UserConfig;
        if (config) userConfigs.push(config);
      } else if (key.name.startsWith('user:') && key.name.endsWith(':quota')) {
        const quota = (await GATEWAY_KV.get(key.name, 'json')) as QuotaRecord;
        const userId = key.name.split(':')[1];
        if (quota) userQuotas.push({ userId, quota });
      } else if (key.name.startsWith('org:') && key.name.endsWith(':config')) {
        const config = (await GATEWAY_KV.get(key.name, 'json')) as OrganizationConfig;
        if (config) orgConfigs.push(config);
      } else if (key.name.startsWith('org:') && key.name.endsWith(':quota')) {
        const quota = (await GATEWAY_KV.get(key.name, 'json')) as QuotaRecord;
        const orgId = key.name.split(':')[1];
        if (quota) orgQuotas.push({ orgId, quota });
      } else if (key.name.startsWith('apikey:')) {
        const apiKey = (await GATEWAY_KV.get(key.name, 'json')) as ApiKeyRecord;
        if (apiKey) apiKeys.push(apiKey);
      }
    }

    // Calculate metrics
    metrics.usage.total_users = userConfigs.length;
    metrics.usage.active_users = userConfigs.filter(u => u.status === 'active').length;
    metrics.usage.total_organizations = orgConfigs.length;
    metrics.usage.api_keys.total = apiKeys.length;
    metrics.usage.api_keys.active = apiKeys.filter(k => k.status === 'active').length;
    metrics.usage.api_keys.revoked = apiKeys.filter(k => k.status === 'revoked').length;

    const currentMonthUserQuotas = userQuotas.filter(uq => uq.quota.current_month === currentMonth);
    metrics.usage.total_requests_this_month = currentMonthUserQuotas.reduce(
      (sum, uq) => sum + uq.quota.request_count,
      0
    );
    metrics.usage.total_cost_usd_this_month = currentMonthUserQuotas.reduce(
      (sum, uq) => sum + uq.quota.month_usage_usd,
      0
    );

    metrics.top_usage.users = currentMonthUserQuotas
      .map(uq => ({
        user_id: uq.userId,
        usage_usd: uq.quota.month_usage_usd,
        requests: uq.quota.request_count,
      }))
      .sort((a, b) => b.usage_usd - a.usage_usd)
      .slice(0, 10);

    const currentMonthOrgQuotas = orgQuotas.filter(oq => oq.quota.current_month === currentMonth);
    metrics.top_usage.organizations = currentMonthOrgQuotas
      .map(oq => ({
        org_id: oq.orgId,
        usage_usd: oq.quota.month_usage_usd,
      }))
      .sort((a, b) => b.usage_usd - a.usage_usd)
      .slice(0, 10);

    metrics.system.response_time_ms = Date.now() - startTime;
    return c.json(metrics);
  } catch (_error) {
    return c.json({ error: { message: 'Failed to get metrics', type: 'metrics_error' } }, 500);
  }
});

// User Management APIs
admin.post('/users', async c => {
  const { GATEWAY_KV } = c.env;

  try {
    const body = await c.req.json();
    const { email, org_id, monthly_limit_usd = 10 } = body;

    if (!email) {
      return c.json({ error: { message: 'Email is required', type: 'validation_error' } }, 400);
    }

    if (!org_id) {
      return c.json(
        { error: { message: 'Organization ID is required', type: 'validation_error' } },
        400
      );
    }

    const organizationConfig = (await GATEWAY_KV.get(
      `org:${org_id}:config`,
      'json'
    )) as OrganizationConfig | null;
    if (!organizationConfig) {
      return c.json({ error: { message: 'Organization not found', type: 'not_found' } }, 404);
    }

    const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);

    const user: UserConfig = {
      user_id: userId,
      org_id: org_id,
      email: email,
      monthly_limit_usd: monthly_limit_usd,
      status: 'active',
      created_at: new Date().toISOString(),
    };

    const apiKeyRecord: ApiKeyRecord = {
      user_id: userId,
      key_id: keyId,
      status: 'active',
      created_at: new Date().toISOString(),
    };

    await GATEWAY_KV.put(`user:${userId}:config`, JSON.stringify(user));
    await GATEWAY_KV.put(`apikey:${keyHash}`, JSON.stringify(apiKeyRecord));

    return c.json({
      user: user,
      api_key: apiKey,
      message: 'User created successfully. Save the API key - it will not be shown again.',
    });
  } catch (error) {
    console.error('Create user error:', error);
    return c.json({ error: { message: 'Failed to create user', type: 'server_error' } }, 500);
  }
});

admin.get('/users/:user_id', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;

    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    return c.json({ user: userConfig });
  } catch (error) {
    console.error('Get user error:', error);
    return c.json({ error: { message: 'Failed to get user', type: 'server_error' } }, 500);
  }
});

admin.patch('/users/:user_id', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;

    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    const body = await c.req.json();
    const { email, monthly_limit_usd, status } = body;

    if (email !== undefined) userConfig.email = email;
    if (monthly_limit_usd !== undefined) userConfig.monthly_limit_usd = monthly_limit_usd;
    if (status !== undefined) userConfig.status = status;

    await GATEWAY_KV.put(`user:${userId}:config`, JSON.stringify(userConfig));

    return c.json({ user: userConfig, message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    return c.json({ error: { message: 'Failed to update user', type: 'server_error' } }, 500);
  }
});

admin.delete('/users/:user_id', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;

    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    await GATEWAY_KV.delete(`user:${userId}:config`);
    await GATEWAY_KV.delete(`user:${userId}:quota`);

    return c.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    return c.json({ error: { message: 'Failed to delete user', type: 'server_error' } }, 500);
  }
});

// API Key Management
admin.post('/users/:user_id/api-keys', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;
    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);

    const apiKeyRecord: ApiKeyRecord = {
      user_id: userId,
      key_id: keyId,
      status: 'active',
      created_at: new Date().toISOString(),
    };

    await GATEWAY_KV.put(`apikey:${keyHash}`, JSON.stringify(apiKeyRecord));

    return c.json({
      api_key: apiKey,
      key_id: keyId,
      message: 'API key created successfully. Save the key - it will not be shown again.',
    });
  } catch (error) {
    console.error('Create API key error:', error);
    return c.json({ error: { message: 'Failed to create API key', type: 'server_error' } }, 500);
  }
});

admin.get('/users/:user_id/api-keys', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;
    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    return c.json({
      message: 'API key listing requires key indexing. Use KV console to view apikey:* entries.',
      user_id: userId,
    });
  } catch (error) {
    console.error('Get API keys error:', error);
    return c.json({ error: { message: 'Failed to get API keys', type: 'server_error' } }, 500);
  }
});

admin.delete('/users/:user_id/api-keys/:key_id', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');
  const keyId = c.req.param('key_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;
    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    return c.json({
      message: `To revoke key ${keyId}, update the corresponding apikey:* record in KV to set status: 'revoked'`,
      key_id: keyId,
      user_id: userId,
    });
  } catch (error) {
    console.error('Revoke API key error:', error);
    return c.json({ error: { message: 'Failed to revoke API key', type: 'server_error' } }, 500);
  }
});

// Usage APIs
admin.get('/users/:user_id/usage', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;
    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    const quotaRecord = await getQuotaRecord(GATEWAY_KV, userId);
    const remainingUsd = userConfig.monthly_limit_usd - quotaRecord.month_usage_usd;

    return c.json({
      user_id: userId,
      email: userConfig.email,
      usage: {
        current_month: quotaRecord.current_month,
        usage_usd: quotaRecord.month_usage_usd,
        limit_usd: userConfig.monthly_limit_usd,
        remaining_usd: remainingUsd,
        request_count: quotaRecord.request_count,
        last_update: new Date(quotaRecord.last_update).toISOString(),
      },
    });
  } catch (error) {
    console.error('Get user usage error:', error);
    return c.json({ error: { message: 'Failed to get user usage', type: 'server_error' } }, 500);
  }
});

admin.post('/users/:user_id/reset-quota', async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;
    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    const currentMonth = getCurrentMonth();
    const resetQuotaRecord: QuotaRecord = {
      month_usage_usd: 0,
      current_month: currentMonth,
      request_count: 0,
      last_update: Date.now(),
    };

    await GATEWAY_KV.put(`user:${userId}:quota`, JSON.stringify(resetQuotaRecord));

    return c.json({
      message: 'User quota reset successfully',
      user_id: userId,
      quota: resetQuotaRecord,
    });
  } catch (error) {
    console.error('Reset quota error:', error);
    return c.json({ error: { message: 'Failed to reset quota', type: 'server_error' } }, 500);
  }
});

// Organization Management
admin.post('/organizations', adminAuthMiddleware, async c => {
  const { GATEWAY_KV } = c.env;

  try {
    const body = await c.req.json();
    const {
      name,
      monthly_budget_usd = 100,
      failure_mode = 'fail-closed',
      provider_keys = {},
    } = body;

    if (!name) {
      return c.json(
        { error: { message: 'Organization name is required', type: 'validation_error' } },
        400
      );
    }

    const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const organizationConfig: OrganizationConfig = {
      org_id: orgId,
      name,
      monthly_budget_usd,
      failure_mode,
      provider_keys,
      created_at: new Date().toISOString(),
    };

    await GATEWAY_KV.put(`org:${orgId}:config`, JSON.stringify(organizationConfig));

    return c.json(
      {
        message: 'Organization created successfully',
        organization: organizationConfig,
      },
      201
    );
  } catch (error) {
    console.error('Create organization error:', error);
    return c.json(
      { error: { message: 'Failed to create organization', type: 'server_error' } },
      500
    );
  }
});

admin.get('/organizations/:org_id', adminAuthMiddleware, async c => {
  const { GATEWAY_KV } = c.env;
  const orgId = c.req.param('org_id');

  try {
    const organizationConfig = (await GATEWAY_KV.get(
      `org:${orgId}:config`,
      'json'
    )) as OrganizationConfig | null;
    if (!organizationConfig) {
      return c.json({ error: { message: 'Organization not found', type: 'not_found' } }, 404);
    }

    return c.json({ organization: organizationConfig });
  } catch (error) {
    console.error('Get organization error:', error);
    return c.json({ error: { message: 'Failed to get organization', type: 'server_error' } }, 500);
  }
});

admin.patch('/organizations/:org_id', adminAuthMiddleware, async c => {
  const { GATEWAY_KV } = c.env;
  const orgId = c.req.param('org_id');

  try {
    const body = await c.req.json();
    const organizationConfig = (await GATEWAY_KV.get(
      `org:${orgId}:config`,
      'json'
    )) as OrganizationConfig | null;
    if (!organizationConfig) {
      return c.json({ error: { message: 'Organization not found', type: 'not_found' } }, 404);
    }

    if (body.name !== undefined) organizationConfig.name = body.name;
    if (body.monthly_budget_usd !== undefined)
      organizationConfig.monthly_budget_usd = body.monthly_budget_usd;
    if (body.failure_mode !== undefined) organizationConfig.failure_mode = body.failure_mode;

    await GATEWAY_KV.put(`org:${orgId}:config`, JSON.stringify(organizationConfig));

    return c.json({
      message: 'Organization updated successfully',
      organization: organizationConfig,
    });
  } catch (error) {
    console.error('Update organization error:', error);
    return c.json(
      { error: { message: 'Failed to update organization', type: 'server_error' } },
      500
    );
  }
});

admin.get('/organizations/:org_id/users', adminAuthMiddleware, async c => {
  const { GATEWAY_KV } = c.env;
  const orgId = c.req.param('org_id');

  try {
    const organizationConfig = (await GATEWAY_KV.get(
      `org:${orgId}:config`,
      'json'
    )) as OrganizationConfig | null;
    if (!organizationConfig) {
      return c.json({ error: { message: 'Organization not found', type: 'not_found' } }, 404);
    }

    const { keys } = await GATEWAY_KV.list({ prefix: 'user:' });
    const userConfigs = [];

    for (const key of keys) {
      if (key.name.endsWith(':config')) {
        const userConfig = (await GATEWAY_KV.get(key.name, 'json')) as UserConfig | null;
        if (userConfig && userConfig.org_id === orgId) {
          userConfigs.push(userConfig);
        }
      }
    }

    return c.json({
      organization_id: orgId,
      users: userConfigs,
    });
  } catch (error) {
    console.error('Get organization users error:', error);
    return c.json(
      { error: { message: 'Failed to get organization users', type: 'server_error' } },
      500
    );
  }
});

admin.get('/organizations/:org_id/usage', adminAuthMiddleware, async c => {
  const { GATEWAY_KV } = c.env;
  const orgId = c.req.param('org_id');

  try {
    const organizationConfig = (await GATEWAY_KV.get(
      `org:${orgId}:config`,
      'json'
    )) as OrganizationConfig | null;
    if (!organizationConfig) {
      return c.json({ error: { message: 'Organization not found', type: 'not_found' } }, 404);
    }

    const orgQuotaRecord = await getOrganizationQuotaRecord(GATEWAY_KV, orgId);

    return c.json({
      organization_id: orgId,
      monthly_budget_usd: organizationConfig.monthly_budget_usd,
      current_month: orgQuotaRecord.current_month,
      month_usage_usd: orgQuotaRecord.month_usage_usd,
      remaining_budget_usd: organizationConfig.monthly_budget_usd - orgQuotaRecord.month_usage_usd,
      request_count: orgQuotaRecord.request_count,
      last_update: new Date(orgQuotaRecord.last_update).toISOString(),
    });
  } catch (error) {
    console.error('Get organization usage error:', error);
    return c.json(
      { error: { message: 'Failed to get organization usage', type: 'server_error' } },
      500
    );
  }
});

export default admin;
