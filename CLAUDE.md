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
- `org:{org_id}:config` - Organization settings, provider keys, and failure modes
- `org:{org_id}:quota` - Organization usage tracking

### Virtual Key Model

Virtual keys are the primary entities:
- Each virtual key has its own quota, configuration, and status
- Keys belong to an organization
- Optional `user` field for grouping and analytics rollup
- Keys act as both authentication tokens and usage tracking entities

This design simplifies the architecture:
- **1 KV lookup** instead of 2 (direct key-to-config)
- **Better performance**: 2-3ms faster per request
- **Flexible user management**: User is just an optional string field
- **Simpler analytics**: Roll up by user via Cloudflare Analytics API

### Key Features

- **Global Edge Performance**: 2-5ms authentication worldwide via KV storage
- **Virtual Key Management**: Direct key-to-config mapping for optimal performance
- **Failure Mode Configuration**: Organizations can choose fail-open or fail-closed behavior
- **Automatic Quota Resets**: Month boundary detection with automatic quota reset
- **API Key Management**: Secure hashed storage and revocation system
- **Usage Tracking**: Real-time tracking for both virtual key and organization quotas
- **User Linkage**: Optional user field for grouping keys and analytics

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
  - `admin/organizations.ts` - Organization management endpoints
  - `chat.ts` - OpenAI-compatible chat completions proxy
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
- Detailed API specifications for admin endpoints
- Virtual key management and creation
- KV storage patterns and quota management
- Authentication and security implementation
- User analytics and rollup strategies
