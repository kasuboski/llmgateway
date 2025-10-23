# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers-based AI Gateway proxy built with Hono, designed to provide virtual key-based AI request management with KV-only storage architecture for optimal edge performance.

## Development Commands
We use pnpm NOT npm.

### Development
```bash
# Start development server
pnpm dev
```

### Deployment
```bash
# Deploy to Cloudflare Workers
pnpm deploy
```

### Type Generation
```bash
# Generate Cloudflare bindings types
pnpm cf-typegen
```

## Architecture

This project implements a KV-only virtual key-based AI Gateway designed for global edge performance:

### Core Components

1. **Hono Web Framework**: Lightweight web framework optimized for Cloudflare Workers
2. **KV Storage**: Global key-value storage for virtual key config, quotas, and organization data
3. **Cloudflare Workers**: Edge computing platform for sub-10ms response times worldwide

### Data Architecture

The system uses KV storage with a structured key pattern:
- `vkey:{key_hash}:config` - Virtual key configuration, limits, and metadata
- `vkey:{key_hash}:quota` - Monthly usage tracking per virtual key
- `vkey:id:{key_id}` - Index for key_id lookups
- `user:{user}:config` - User configuration and aggregate quota limits
- `user:{user}:quota` - User aggregate usage tracking (across all keys)
- `org:{org_id}:config` - Organization settings, provider keys, and failure modes
- `org:{org_id}:quota` - Organization usage tracking (across all users)

### Three-Level Quota System

The system implements hierarchical quota tracking and enforcement:

**1. Virtual Key Level (Individual Key)**
- Each virtual key has its own monthly quota
- Tracks usage for individual API keys
- First level of quota enforcement

**2. User Level (Aggregate Across Keys)**
- Each user has a monthly quota limit
- Aggregates usage across all keys owned by the user
- Enables tracking users who have multiple API keys
- Second level of quota enforcement

**3. Organization Level (Company-Wide Budget)**
- Organizations have monthly budget limits
- Aggregates usage across all users in the organization
- Provides company-wide spending control
- Third level of quota enforcement

### Virtual Key Model

Virtual keys are the primary entities:
- Each virtual key has its own quota, configuration, and status
- Keys belong to an organization
- **Required** `user` field - every virtual key must be associated with a user
- Keys act as both authentication tokens and usage tracking entities

Each request checks quotas in order:
1. Virtual key quota (has this specific key exceeded its limit?)
2. User quota (has this user exceeded their aggregate limit across all keys?)
3. Organization quota (has the organization exceeded its budget?)

This design provides:
- **1 KV lookup** for authentication (direct key-to-config)
- **Better performance**: 2-3ms faster per request
- **Hierarchical quota control**: Prevent abuse at multiple levels
- **Aggregate tracking**: Monitor usage across keys, users, and organizations

### Key Features

- **Global Edge Performance**: 2-5ms authentication worldwide via KV storage
- **Three-Level Quota System**: Track and enforce quotas at virtual key, user, and organization levels
- **Virtual Key Management**: Direct key-to-config mapping for optimal performance
- **User Management**: Required user association with aggregate quota tracking
- **Failure Mode Configuration**: Organizations can choose fail-open or fail-closed behavior
- **Automatic Quota Resets**: Month boundary detection with automatic quota reset
- **API Key Management**: Secure hashed storage and revocation system
- **Hierarchical Usage Tracking**: Real-time tracking at all three levels (vkey, user, org)

## File Structure

- `src/index.ts` - Main application entry point with Hono setup
- `src/lib/` - Core utility libraries and business logic
  - `auth.ts` - Authentication middleware and utilities
  - `crypto.ts` - Cryptographic functions (API key generation, hashing)
  - `errors.ts` - Error handling utilities
  - `costs.ts` - AI model cost calculation utilities
  - `quota.ts` - Usage quota management and tracking
- `src/routes/` - API route handlers
  - `admin.ts` - Admin router with system metrics
  - `admin/vkeys.ts` - Virtual key management endpoints
  - `admin/users.ts` - User management endpoints and aggregate usage tracking
  - `admin/organizations.ts` - Organization management endpoints
  - `chat.ts` - OpenAI-compatible chat completions proxy with three-level quota enforcement
- `src/types.ts` - TypeScript type definitions
- `wrangler.jsonc` - Cloudflare Workers configuration
- `spec.md` - Detailed architecture specification and implementation guide
- `package.json` - Dependencies (Hono framework)
- `tsconfig.json` - TypeScript configuration with ESNext targets
- `docs/` - Knowledge base for Claude Code. Seach these files for platform references.

## Development Notes

### TypeScript Configuration
- Uses ESNext module resolution with bundler strategy
- Strict type checking enabled
- JSX configured for Hono's JSX runtime

### Cloudflare Bindings
After adding KV namespaces, D1 databases, or other Cloudflare services to `wrangler.jsonc`, run `pnpm run cf-typegen` to generate proper TypeScript types.

### Architecture Reference
The `README.md` file contains the complete architecture specification including:
- Three-level quota system (virtual key, user, organization)
- Detailed API specifications for admin endpoints
- Virtual key management and creation (user required)
- User management and aggregate usage tracking
- KV storage patterns and quota management
- Authentication and security implementation
- Hierarchical quota enforcement and tracking
