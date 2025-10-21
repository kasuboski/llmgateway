/**
 * Authentication utilities and middleware
 */

import { createMiddleware } from 'hono/factory';
import type { VirtualKeyConfig } from '../types';
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
    // Hash the API key and look up the virtual key config directly
    const keyHash = await hashApiKey(token);
    const vkeyConfig = (await c.env.GATEWAY_KV.get(
      `vkey:${keyHash}:config`,
      'json'
    )) as VirtualKeyConfig | null;

    if (!vkeyConfig) {
      return c.json({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401);
    }

    if (vkeyConfig.status !== 'active') {
      return c.json({ error: { message: 'API key revoked', type: 'auth_error' } }, 401);
    }

    // Set virtual key context for the request
    c.set('vkey', vkeyConfig);

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
