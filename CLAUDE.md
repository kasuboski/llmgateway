# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers-based AI Gateway proxy built with Hono, designed to provide multi-user AI request management with KV-only storage architecture for optimal edge performance.

## Development Commands

### Development
```bash
# Start development server
npm run dev
# or
pnpm dev
```

### Deployment
```bash
# Deploy to Cloudflare Workers
npm run deploy
# or
pnpm deploy
```

### Type Generation
```bash
# Generate Cloudflare bindings types
npm run cf-typegen
# or
pnpm cf-typegen
```

## Architecture

This project implements a KV-only multi-user AI Gateway designed for global edge performance:

### Core Components

1. **Hono Web Framework**: Lightweight web framework optimized for Cloudflare Workers
2. **KV Storage**: Global key-value storage for user config, quotas, API keys, and organization data
3. **Cloudflare Workers**: Edge computing platform for sub-10ms response times worldwide

### Data Architecture

The system uses KV storage with a structured key pattern:
- `user:{user_id}:config` - User configuration and limits
- `user:{user_id}:quota` - Monthly usage tracking
- `apikey:{hash}` - API key authentication lookup
- `org:{org_id}:config` - Organization settings and failure modes
- `org:{org_id}:quota` - Organization usage tracking

### Key Features

- **Global Edge Performance**: 2-5ms authentication worldwide via KV storage
- **Failure Mode Configuration**: Organizations can choose fail-open or fail-closed behavior
- **Automatic Quota Resets**: Month boundary detection with automatic quota reset
- **API Key Management**: Secure hashed storage and revocation system
- **Usage Tracking**: Real-time tracking for both user and organization quotas

## File Structure

- `src/index.ts` - Main application entry point with Hono setup
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
After adding KV namespaces, D1 databases, or other Cloudflare services to `wrangler.jsonc`, run `npm run cf-typegen` to generate proper TypeScript types.

### Architecture Reference
The `spec.md` file contains the complete architecture specification including:
- Detailed API specifications for admin endpoints
- KV storage patterns and quota management
- Authentication and security implementation
- Migration path from manual to automated control plane
