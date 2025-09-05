/**
 * Authentication utilities and middleware
 */

import { createMiddleware } from 'hono/factory';
import type { ApiKeyRecord, UserConfig } from '../types';
import { generateRequestId, hashApiKey } from './crypto';
import { createErrorResponse } from './errors';

// Extend the generated CloudflareBindings to include secrets
interface Env extends CloudflareBindings {
  AI_GATEWAY_TOKEN: string;
  ADMIN_API_KEY: string;
}

// Admin authentication middleware for /admin/* routes
export const adminAuthMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      createErrorResponse('Missing Authorization header', 'auth_error', c.get('requestId')),
      401
    );
  }

  const token = authHeader.replace('Bearer ', '');

  if (token !== c.env.ADMIN_API_KEY) {
    return c.json(
      createErrorResponse('Invalid admin API key', 'auth_error', c.get('requestId')),
      401
    );
  }

  await next();
});

// Authentication middleware for /v1/* routes
export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      createErrorResponse('Missing Authorization header', 'auth_error', c.get('requestId')),
      401
    );
  }

  const token = authHeader.replace('Bearer ', '');

  if (!token.startsWith('gw_live_')) {
    return c.json({ error: { message: 'Invalid API key format', type: 'auth_error' } }, 401);
  }

  try {
    // Hash the API key and look it up in KV
    const keyHash = await hashApiKey(token);
    const apiKeyRecord = (await c.env.GATEWAY_KV.get(
      `apikey:${keyHash}`,
      'json'
    )) as ApiKeyRecord | null;

    if (!apiKeyRecord) {
      return c.json({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401);
    }

    if (apiKeyRecord.status !== 'active') {
      return c.json({ error: { message: 'API key revoked', type: 'auth_error' } }, 401);
    }

    // Get user config
    const userConfig = (await c.env.GATEWAY_KV.get(
      `user:${apiKeyRecord.user_id}:config`,
      'json'
    )) as UserConfig | null;

    if (!userConfig) {
      return c.json({ error: { message: 'User not found', type: 'auth_error' } }, 401);
    }

    if (userConfig.status !== 'active') {
      return c.json({ error: { message: 'User suspended', type: 'auth_error' } }, 401);
    }

    // Set user context for the request
    c.set('user', userConfig);
    c.set('apiKey', apiKeyRecord);

    await next();
  } catch (error) {
    console.error('Authentication error:', error);
    return c.json({ error: { message: 'Authentication failed', type: 'auth_error' } }, 500);
  }
});

// Request ID middleware - adds request ID to all requests
export const requestIdMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const requestId = generateRequestId();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  await next();
});
