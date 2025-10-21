# AI Gateway - KV-Only Virtual Key AI Proxy

A production-ready Cloudflare Workers-based AI Gateway that provides virtual key-based AI request management with quota enforcement, API key management, and global edge performance through KV-only storage architecture.

## 🚀 Features

- **Global Edge Performance**: 2-5ms authentication worldwide via Cloudflare KV storage
- **Virtual Key Management**: API keys act as primary entities with built-in quota and configuration
- **User Linkage**: Optional user field for grouping keys and analytics rollup
- **Quota Enforcement**: Real-time usage tracking per virtual key with automatic monthly resets
- **Failure Modes**: Organization-level fail-open or fail-closed behavior
- **OpenAI Compatible**: Drop-in replacement for OpenAI API endpoints
- **Simplified Architecture**: Direct key-to-config lookup without user indirection

## 📋 Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare Workers account
- Wrangler CLI installed globally (`pnpm install -g wrangler`)

### 1. Clone and Install
```bash
git clone <repository-url>
cd llmgateway
pnpm install
```

### 2. Configure Environment
```bash
# Copy and configure your Cloudflare settings
cp .env.example .env
# Edit .env with your Cloudflare account details
```

### 3. Deploy Worker
```bash
# Deploy to Cloudflare Workers
pnpm run deploy
```

### 4. Start Development Server
```bash
# Start local development (uses .env file)
pnpm run dev
```

The server will be available at `http://localhost:8787`

## 🏗️ Architecture Overview

### Core Components

1. **Proxy Worker** (`src/index.ts`, `src/routes/chat.ts`)
   - OpenAI-compatible API endpoints
   - Real-time quota enforcement per virtual key
   - Authentication and usage tracking
   - Global edge performance

2. **Admin API** (`src/routes/admin.ts`, `src/routes/admin/vkeys.ts`)
   - Virtual key management
   - Organization management
   - Usage monitoring and metrics
   - System health checks

3. **KV Storage Architecture**
   ```
   vkey:{key_hash}:config   → Virtual key configuration, limits, and metadata
   vkey:{key_hash}:quota    → Monthly usage tracking per key
   vkey:id:{key_id}         → Index for key_id lookups
   org:{org_id}:config      → Organization settings and provider keys
   org:{org_id}:quota       → Organization usage tracking
   ```

### Virtual Key Model

Virtual keys are the primary entities in this system. Each virtual key:
- Has its own monthly quota and configuration
- Belongs to an organization
- Optionally links to a user identifier for grouping/analytics
- Acts as both authentication token and usage tracking entity

**Benefits:**
- Simpler authentication (1 KV lookup instead of 2)
- Better performance (2-3ms faster per request)
- More flexible user management (user is just a string field)
- Easier analytics rollup via Cloudflare Analytics API

### Data Flow

```
API Request → Auth (vkey lookup) → Quota Check → AI Gateway → AI Provider
                ↓                       ↓
           KV Lookup (vkey)      Usage Tracking (vkey + org)
```

## 🔧 Configuration

### Environment Variables
- `ADMIN_API_KEY`: Admin authentication key for management operations
- `AI_GATEWAY_TOKEN`: Cloudflare AI Gateway authentication token
- `AI_GATEWAY_ACCOUNT_ID`: Your Cloudflare account ID
- `AI_GATEWAY_ID`: Your Cloudflare AI Gateway ID

### Failure Modes

Organizations can configure how the system behaves during outages:

- **fail-open**: Allow requests when quota data unavailable
- **fail-closed**: Reject requests when quota data unavailable

## 📚 API Reference

### Admin API Endpoints

#### System Metrics
- `GET /admin/metrics` - System-wide metrics (virtual key counts, org counts)
  - Query param: `?mode=exact` for precise counts (slower)

#### Organization Management
- `POST /admin/organizations` - Create organization
  ```json
  {
    "name": "My Company",
    "monthly_budget_usd": 1000,
    "failure_mode": "fail-closed",
    "provider_keys": {
      "openai": "sk-...",
      "anthropic": "sk-ant-..."
    }
  }
  ```

- `GET /admin/organizations/{org_id}` - Get organization details
- `PATCH /admin/organizations/{org_id}` - Update organization
- `GET /admin/organizations/{org_id}/usage` - Get organization usage
- `GET /admin/organizations/{org_id}/vkeys` - List all virtual keys for organization

#### Virtual Key Management
- `POST /admin/vkeys` - Create virtual key
  ```json
  {
    "org_id": "org_123",
    "user": "alice@company.com",  // Optional
    "name": "Alice's Production Key",  // Optional
    "monthly_limit_usd": 100
  }
  ```
  Returns the API key (shown only once)

- `GET /admin/vkeys/{key_id}` - Get virtual key details
- `PATCH /admin/vkeys/{key_id}` - Update virtual key
  ```json
  {
    "name": "Updated Key Name",
    "monthly_limit_usd": 200,
    "status": "active",  // or "revoked"
    "user": "bob@company.com"
  }
  ```

- `DELETE /admin/vkeys/{key_id}` - Delete virtual key
- `GET /admin/vkeys/{key_id}/usage` - Get key usage
  ```json
  {
    "key_id": "vkey_123",
    "name": "Alice's Key",
    "user": "alice@company.com",
    "usage": {
      "current_month": "2025-01",
      "usage_usd": 45.23,
      "limit_usd": 100,
      "remaining_usd": 54.77,
      "request_count": 1523,
      "last_update": "2025-01-15T10:30:00Z"
    }
  }
  ```

- `POST /admin/vkeys/{key_id}/reset-quota` - Emergency quota reset

### Chat API Endpoints
- `POST /v1/chat/completions` - OpenAI-compatible chat completions
  - Uses virtual key from `Authorization: Bearer gw_live_...` header
  - Returns usage headers:
    - `x-gateway-usage-usd`: Current month usage
    - `x-gateway-limit-usd`: Monthly limit
    - `x-gateway-remaining-usd`: Remaining budget
    - `x-gateway-request-count`: Request count
    - `x-gateway-current-month`: Current month
    - `x-gateway-cost-usd`: This request's cost

## 💡 Usage Examples

### 1. Create Organization and Virtual Keys

```bash
# Create organization
curl -X POST https://your-worker.workers.dev/admin/organizations \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "monthly_budget_usd": 5000,
    "failure_mode": "fail-closed",
    "provider_keys": {
      "openai": "sk-...",
      "anthropic": "sk-ant-..."
    }
  }'

# Create virtual key for Alice
curl -X POST https://your-worker.workers.dev/admin/vkeys \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org_1234567890_abc123",
    "user": "alice@acme.com",
    "name": "Alice Production Key",
    "monthly_limit_usd": 500
  }'
# Save the returned api_key!

# Create virtual key for Bob
curl -X POST https://your-worker.workers.dev/admin/vkeys \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org_1234567890_abc123",
    "user": "bob@acme.com",
    "name": "Bob Development Key",
    "monthly_limit_usd": 100
  }'
```

### 2. Make AI Requests

```bash
# Make chat completion request
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer gw_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### 3. Monitor Usage

```bash
# Check virtual key usage
curl https://your-worker.workers.dev/admin/vkeys/vkey_123/usage \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"

# Check organization usage
curl https://your-worker.workers.dev/admin/organizations/org_123/usage \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"

# System metrics
curl https://your-worker.workers.dev/admin/metrics \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"
```

### 4. Key Management

```bash
# Update key limit
curl -X PATCH https://your-worker.workers.dev/admin/vkeys/vkey_123 \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"monthly_limit_usd": 1000}'

# Revoke key
curl -X PATCH https://your-worker.workers.dev/admin/vkeys/vkey_123 \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "revoked"}'

# Delete key
curl -X DELETE https://your-worker.workers.dev/admin/vkeys/vkey_123 \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"
```

## 📊 User Analytics and Rollup

While virtual keys are the primary tracking entity, the optional `user` field enables analytics:

### Via Cloudflare Analytics API
Use Cloudflare's Analytics API to query aggregated metrics by user:
- Filter by `cf-aig-metadata.user` to see all requests for a user
- Roll up costs and usage across multiple keys per user
- Build custom dashboards and reports

### Via KV Queries (Optional)
For real-time rollup, you can:
1. List all keys: `GET /admin/vkeys?user=alice@company.com`
2. Query usage for each key
3. Aggregate usage client-side

This approach keeps the gateway fast while enabling flexible analytics.

## 🔒 Security Features

- **Hashed API Keys**: SHA-256 hashing for secure storage
- **Admin Authentication**: Separate admin API key for management operations
- **Quota Enforcement**: Prevent runaway costs with per-key and organization limits
- **Key Revocation**: Instantly disable keys without data deletion
- **Audit Trail**: Usage tracking for compliance and monitoring via Cloudflare Analytics

## 🚀 Production Deployment

### Cloudflare Workers Setup
1. Configure `wrangler.jsonc` with your account details
2. Set up KV namespace bindings
3. Configure environment variables (secrets)
4. Deploy with `pnpm run deploy`

### AI Gateway Configuration
1. Create AI Gateway in Cloudflare Dashboard
2. Configure provider connections (OpenAI, Anthropic, etc.)
3. Set up authentication tokens
4. Update environment variables in organization configs

## 🏗️ File Structure

```
src/
├── index.ts                    # Main application entry point
├── types.ts                    # TypeScript type definitions
├── hono-context.d.ts          # Hono context augmentation
├── lib/
│   ├── auth.ts                # Authentication middleware
│   ├── crypto.ts              # API key generation & hashing
│   ├── quota.ts               # Quota management
│   ├── costs.ts               # AI model cost calculation
│   └── errors.ts              # Error handling
└── routes/
    ├── admin.ts               # Admin router
    ├── chat.ts                # Chat completions proxy
    └── admin/
        ├── vkeys.ts           # Virtual key management
        └── organizations.ts   # Organization management
```

## 📝 Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Generate TypeScript types
pnpm cf-typegen

# Deploy to production
pnpm deploy
```

## 🧪 Testing

```bash
# Health check
curl http://localhost:8787/health

# Test chat completion
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer gw_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "test"}]
  }'
```

## 📖 Further Reading

- See `CLAUDE.md` for development guidelines and architecture details
- Cloudflare Workers documentation: https://developers.cloudflare.com/workers/
- Cloudflare KV documentation: https://developers.cloudflare.com/kv/
- Cloudflare AI Gateway: https://developers.cloudflare.com/ai-gateway/

## 📄 License

[Your License Here]
