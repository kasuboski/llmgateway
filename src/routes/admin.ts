/**
 * Complete Admin API routes for user, organization, and system management
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import * as z from 'zod';
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

// Schemas
const CreateUserSchema = z.object({
  email: z.string().email(),
  org_id: z.string().min(1),
  monthly_limit_usd: z.number().positive().optional(),
});

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  monthly_limit_usd: z.number().positive().optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

const CreateOrganizationSchema = z.object({
  name: z.string().min(1),
  monthly_budget_usd: z.number().positive().optional(),
  failure_mode: z.enum(['fail-open', 'fail-closed']).optional(),
  provider_keys: z.record(z.string()).optional(),
});

const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).optional(),
  monthly_budget_usd: z.number().positive().optional(),
  failure_mode: z.enum(['fail-open', 'fail-closed']).optional(),
  provider_keys: z.record(z.string()).optional(),
});

// Param Schemas
const UserIdParamSchema = z.object({
  user_id: z.string().min(1),
});

const UserKeyParamSchema = z.object({
  user_id: z.string().min(1),
  key_id: z.string().min(1),
});

const OrgIdParamSchema = z.object({
  org_id: z.string().min(1),
});

// System metrics endpoint
admin.get('/metrics', adminAuthMiddleware, async c => {
  const { GATEWAY_KV } = c.env;
  const { mode } = c.req.query(); // Get the 'mode' query parameter

  if (mode === 'exact') {
    // --- This is the potentially slow logic ---
    async function getExactCount(prefix: string): Promise<number> {
      let count = 0;
      let cursor: string | undefined;
      do {
        const result = await GATEWAY_KV.list({ prefix, cursor });
        count += result.keys.length;
        cursor = result.list_complete ? undefined : result.cursor;
      } while (cursor);
      return count;
    }

    const userCount = await getExactCount('user:');
    const orgCount = await getExactCount('org:');
    const apiKeyCount = await getExactCount('apikey:');

    return c.json({
      timestamp: new Date().toISOString(),
      entities: {
        users: userCount,
        organizations: orgCount,
        api_keys: apiKeyCount,
      },
    });
  }
  // --- This is the default fast, estimated logic ---
  async function getCountEstimate(prefix: string): Promise<string | number> {
    const result = await GATEWAY_KV.list({ prefix, limit: 1000 });
    if (result.keys.length < 1000) {
      return result.keys.length; // It's an exact count
    }
    return '1000+'; // It's an estimate
  }

  const userCount = await getCountEstimate('user:');
  const orgCount = await getCountEstimate('org:');
  const apiKeyCount = await getCountEstimate('apikey:');

  return c.json({
    timestamp: new Date().toISOString(),
    system: {
      version: '1.0.0',
    },
    entities: {
      users: userCount,
      organizations: orgCount,
      api_keys: apiKeyCount,
    },
    note: 'Counts are exact up to 1,000. "1000+" indicates more records exist. For an exact count, use ?mode=exact (may be slow).',
  });
});

// User Management APIs
admin.post('/users', zValidator('json', CreateUserSchema), async c => {
  const { GATEWAY_KV } = c.env;

  try {
    const { email, org_id, monthly_limit_usd = 10 } = c.req.valid('json');

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
    await GATEWAY_KV.put(`user:${userId}:apikey:${keyId}`, keyHash);
    await GATEWAY_KV.put(`apikey:${keyId}`, keyHash);

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

admin.get('/users/:user_id', zValidator('param', UserIdParamSchema), async c => {
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

admin.patch(
  '/users/:user_id',
  zValidator('param', UserIdParamSchema),
  zValidator('json', UpdateUserSchema),
  async c => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param('user_id');

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        'json'
      )) as UserConfig | null;

      if (!userConfig) {
        return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
      }

      const { email, monthly_limit_usd, status } = c.req.valid('json');

      if (email !== undefined) userConfig.email = email;
      if (monthly_limit_usd !== undefined) userConfig.monthly_limit_usd = monthly_limit_usd;
      if (status !== undefined) userConfig.status = status;

      await GATEWAY_KV.put(`user:${userId}:config`, JSON.stringify(userConfig));

      return c.json({ user: userConfig, message: 'User updated successfully' });
    } catch (error) {
      console.error('Update user error:', error);
      return c.json({ error: { message: 'Failed to update user', type: 'server_error' } }, 500);
    }
  }
);

admin.delete('/users/:user_id', zValidator('param', UserIdParamSchema), async c => {
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
admin.post('/users/:user_id/api-keys', zValidator('param', UserIdParamSchema), async c => {
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
    await GATEWAY_KV.put(`user:${userId}:apikey:${keyId}`, keyHash);
    await GATEWAY_KV.put(`apikey:${keyId}`, keyHash);

    return c.json({
      api_key: apiKey,
      key_id: keyId,
      message: 'API key created successfully. Save the key - it will not be shown again.',
    });
  } catch (error) {
    console.error('Create API key error:', error);
    return c.json(
      {
        error: { message: 'Failed to create API key', type: 'server_error' },
      },
      500
    );
  }
});

admin.get('/users/:user_id/api-keys', zValidator('param', UserIdParamSchema), async c => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param('user_id');

  try {
    const userConfig = (await GATEWAY_KV.get(`user:${userId}:config`, 'json')) as UserConfig | null;
    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
    }

    // Get all API keys for this user using the index
    const apiKeys = [];
    let cursor: string | undefined;

    do {
      const result = await GATEWAY_KV.list({ prefix: `user:${userId}:apikey:`, cursor });

      for (const key of result.keys) {
        const keyHash = await GATEWAY_KV.get(key.name);
        if (keyHash) {
          const apiKeyRecord = (await GATEWAY_KV.get(
            `apikey:${keyHash}`,
            'json'
          )) as ApiKeyRecord | null;
          if (apiKeyRecord) {
            apiKeys.push({
              key_id: apiKeyRecord.key_id,
              status: apiKeyRecord.status,
              created_at: apiKeyRecord.created_at,
            });
          }
        }
      }

      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return c.json({
      user_id: userId,
      api_keys: apiKeys.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    });
  } catch (error) {
    console.error('Get API keys error:', error);
    return c.json({ error: { message: 'Failed to get API keys', type: 'server_error' } }, 500);
  }
});

admin.delete(
  '/users/:user_id/api-keys/:key_id',
  zValidator('param', UserKeyParamSchema),
  async c => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param('user_id');
    const keyId = c.req.param('key_id');

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        'json'
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json({ error: { message: 'User not found', type: 'not_found' } }, 404);
      }

      // Find the API key using the index
      const keyHash = await GATEWAY_KV.get(`user:${userId}:apikey:${keyId}`);
      let foundApiKey = false;

      if (keyHash) {
        const apiKeyRecord = (await GATEWAY_KV.get(
          `apikey:${keyHash}`,
          'json'
        )) as ApiKeyRecord | null;
        if (apiKeyRecord && apiKeyRecord.user_id === userId && apiKeyRecord.key_id === keyId) {
          // Found the API key, update its status to revoked
          apiKeyRecord.status = 'revoked';
          await GATEWAY_KV.put(`apikey:${keyHash}`, JSON.stringify(apiKeyRecord));
          foundApiKey = true;
        }
      }

      if (!foundApiKey) {
        return c.json({ error: { message: 'API key not found', type: 'not_found' } }, 404);
      }

      return c.json({
        message: 'API key revoked successfully',
        key_id: keyId,
        user_id: userId,
      });
    } catch (error) {
      console.error('Revoke API key error:', error);
      return c.json(
        {
          error: { message: 'Failed to revoke API key', type: 'server_error' },
        },
        500
      );
    }
  }
);

// Usage APIs
admin.get('/users/:user_id/usage', zValidator('param', UserIdParamSchema), async c => {
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
    return c.json(
      {
        error: { message: 'Failed to get user usage', type: 'server_error' },
      },
      500
    );
  }
});

admin.post('/users/:user_id/reset-quota', zValidator('param', UserIdParamSchema), async c => {
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
admin.post(
  '/organizations',
  adminAuthMiddleware,
  zValidator('json', CreateOrganizationSchema),
  async c => {
    const { GATEWAY_KV } = c.env;

    try {
      const {
        name,
        monthly_budget_usd = 100,
        failure_mode = 'fail-closed',
        provider_keys = {},
      } = c.req.valid('json');

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
        {
          error: {
            message: 'Failed to create organization',
            type: 'server_error',
          },
        },
        500
      );
    }
  }
);

admin.get(
  '/organizations/:org_id',
  adminAuthMiddleware,
  zValidator('param', OrgIdParamSchema),
  async c => {
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
      return c.json(
        {
          error: {
            message: 'Failed to get organization',
            type: 'server_error',
          },
        },
        500
      );
    }
  }
);

admin.patch(
  '/organizations/:org_id',
  adminAuthMiddleware,
  zValidator('param', OrgIdParamSchema),
  zValidator('json', UpdateOrganizationSchema),
  async c => {
    const { GATEWAY_KV } = c.env;
    const orgId = c.req.param('org_id');

    try {
      const body = c.req.valid('json');
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
      if (body.provider_keys !== undefined) organizationConfig.provider_keys = body.provider_keys;

      await GATEWAY_KV.put(`org:${orgId}:config`, JSON.stringify(organizationConfig));

      return c.json({
        message: 'Organization updated successfully',
        organization: organizationConfig,
      });
    } catch (error) {
      console.error('Update organization error:', error);
      return c.json(
        {
          error: {
            message: 'Failed to update organization',
            type: 'server_error',
          },
        },
        500
      );
    }
  }
);

admin.get(
  '/organizations/:org_id/users',
  adminAuthMiddleware,
  zValidator('param', OrgIdParamSchema),
  async c => {
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
        {
          error: {
            message: 'Failed to get organization users',
            type: 'server_error',
          },
        },
        500
      );
    }
  }
);

admin.get(
  '/organizations/:org_id/usage',
  adminAuthMiddleware,
  zValidator('param', OrgIdParamSchema),
  async c => {
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
        remaining_budget_usd:
          organizationConfig.monthly_budget_usd - orgQuotaRecord.month_usage_usd,
        request_count: orgQuotaRecord.request_count,
        last_update: new Date(orgQuotaRecord.last_update).toISOString(),
      });
    } catch (error) {
      console.error('Get organization usage error:', error);
      return c.json(
        {
          error: {
            message: 'Failed to get organization usage',
            type: 'server_error',
          },
        },
        500
      );
    }
  }
);

export default admin;
