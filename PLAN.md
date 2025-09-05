# AI Gateway Implementation Plan (Updated)

## Project Overview
Implementation of a Cloudflare Workers-based AI Gateway proxy using KV-only storage for global edge performance. The system provides multi-user AI request management with quota enforcement, cost tracking, and failure mode configuration.

**Key Update**: Uses Cloudflare AI Gateway's OpenAI-compatible endpoint (`/compat/chat/completions`) directly instead of the Vercel AI SDK, enabling simpler multi-provider support with a single URL.

## Implementation Strategy: Iterative Development

Each phase delivers a working, demoable system that can be immediately used and tested:

1. **Phase 1**: Basic OpenAI-compatible proxy (no auth/quotas)
2. **Phase 2**: Add simple API key authentication
3. **Phase 3**: Add usage tracking and quota enforcement
4. **Phase 4**: Add admin APIs for user management
5. **Phase 5**: Add organization support and failure modes
6. **Phase 6**: Add monitoring and operational features

---

## Phase 1: Basic OpenAI Proxy (MVP - Day 1)
**Goal**: Create a working OpenAI-compatible endpoint that proxies to Cloudflare AI Gateway
**Demo**: `curl -X POST /v1/chat/completions` works with OpenAI requests

### 1.1 Project Setup
- [ ] Initialize Hono app with TypeScript
- [ ] Configure `wrangler.jsonc` with AI Gateway settings
- [ ] Set up environment variables:
  - `AI_GATEWAY_ACCOUNT_ID`
  - `AI_GATEWAY_ID`
  - `AI_GATEWAY_TOKEN` (for cf-aig-authorization)

### 1.2 Basic Proxy Implementation
```typescript
// src/index.ts - Basic structure
import { Hono } from 'hono';

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// OpenAI-compatible chat completions
app.post('/v1/chat/completions', async (c) => {
  // Proxy to: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions
});

export default app;
```

### 1.3 Core Features
- [ ] Implement `/v1/chat/completions` endpoint
- [ ] Proxy requests to Cloudflare AI Gateway OpenAI-compatible endpoint
- [ ] Handle both streaming and non-streaming responses
- [ ] Support multiple providers via model parameter (e.g., `openai/gpt-4`, `anthropic/claude-3-sonnet`)
- [ ] Forward all OpenAI-compatible headers and parameters

### 1.4 Testing
- [ ] Test with OpenAI models: `{"model": "openai/gpt-4o-mini"}`
- [ ] Test with Anthropic models: `{"model": "anthropic/claude-3-haiku"}`
- [ ] Test streaming responses
- [ ] Verify error handling and status codes

**Deliverable**: Working OpenAI-compatible API that supports multiple providers

---

## Phase 2: API Key Authentication (Day 2-3)
**Goal**: Add simple API key authentication without quotas
**Demo**: Requests require valid `gw_live_xxx` API keys

### 2.1 KV Storage Setup
- [ ] Configure KV namespace: `GATEWAY_KV`
- [ ] Run `npm run cf-typegen` to generate types

### 2.2 API Key System
- [ ] Implement API key generation: `gw_live_` prefix + secure random
- [ ] SHA-256 hash storage in KV: `apikey:{hash} -> {user_id, key_id, status}`
- [ ] Authentication middleware for all `/v1/*` routes

### 2.3 Simple User Storage
```typescript
// KV Structure (minimal)
// user:{user_id}:config -> { user_id, email, status, created_at }
// apikey:{hash} -> { user_id, key_id, status, created_at }
```

### 2.4 Manual User Creation (Temporary)
- [ ] Create script to manually add users and generate API keys
- [ ] Store in KV for testing authentication

### 2.5 Authentication Flow
```typescript
// Middleware: Extract Bearer token, hash it, lookup in KV
app.use('/v1/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  // Hash and lookup in KV
  // Set user context for request
});
```

**Deliverable**: Authenticated OpenAI-compatible API requiring valid API keys

---

## Phase 3: Usage Tracking & Basic Quotas (Day 4-5)
**Goal**: Track usage and enforce simple monthly limits
**Demo**: Users hit quota limits and get rejected

### 3.1 Usage Tracking System
```typescript
// Extended KV Structure
// user:{user_id}:config -> { user_id, email, monthly_limit_usd, status }
// user:{user_id}:quota -> { month_usage_usd, current_month, request_count }
```

### 3.2 Cost Calculation
- [ ] Implement token-based cost calculation from model responses (AI Gateway doesn't provide cost in headers)
- [ ] Create custom pricing configuration per organization/model
- [ ] Use `cf-aig-custom-cost` header to send custom pricing to AI Gateway for consistency
- [ ] Add fallback cost estimation for responses without token data
- [ ] Store cost per request for tracking

### 3.3 Quota Enforcement
- [ ] Pre-request quota check (fail if would exceed limit)
- [ ] Post-request usage update (atomic increment)
- [ ] Month boundary detection and automatic reset
- [ ] Return usage headers in responses

### 3.4 Usage Headers
```typescript
// Response headers
'x-gateway-usage-usd': '23.45',
'x-gateway-limit-usd': '100.00',
'x-gateway-remaining-usd': '76.55'
```

**Deliverable**: Usage-tracked API with monthly quota enforcement

---

## Phase 4: Admin API (Day 6-8)
**Goal**: REST APIs for user and API key management
**Demo**: Create users, generate API keys, view usage via API calls

### 4.1 Admin Authentication
- [ ] Admin API keys stored in Worker secrets
- [ ] Separate authentication for `/admin/*` routes

### 4.2 User Management APIs
```http
POST /admin/users
GET /admin/users/{user_id}
PATCH /admin/users/{user_id}
DELETE /admin/users/{user_id}
```

### 4.3 API Key Management
```http
POST /admin/users/{user_id}/api-keys
GET /admin/users/{user_id}/api-keys
DELETE /admin/users/{user_id}/api-keys/{key_id}
```

### 4.4 Usage APIs
```http
GET /admin/users/{user_id}/usage
POST /admin/users/{user_id}/reset-quota
```

### 4.5 Implementation Details
- [ ] Full CRUD operations on user configs
- [ ] API key generation with secure key return (one-time only)
- [ ] Usage data aggregation from quota KV records
- [ ] Input validation and error handling

**Deliverable**: Full admin API for user lifecycle management

---

## Phase 5: Organizations & Failure Modes (Day 9-11)
**Goal**: Multi-tenant organizations with configurable failure handling
**Demo**: Organizations with multiple users, fail-open/fail-closed modes

### 5.1 Organization Data Model
```typescript
// Extended KV Structure
// org:{org_id}:config -> { org_id, name, monthly_budget_usd, failure_mode, fallback_daily_limit }
// org:{org_id}:quota -> { month_usage_usd, current_month }
// user:{user_id}:config -> { user_id, org_id, email, monthly_limit_usd, status }
```

### 5.2 Organization APIs
```http
POST /admin/organizations
GET /admin/organizations/{org_id}
PATCH /admin/organizations/{org_id}
GET /admin/organizations/{org_id}/users
GET /admin/organizations/{org_id}/usage
```

### 5.3 Failure Mode Implementation
- [ ] **Fail-Open**: Allow requests when KV unavailable, apply daily limits
- [ ] **Fail-Closed**: Reject requests when KV unavailable
- [ ] Grace period tracking for later reconciliation
- [ ] Configurable fallback limits per organization

### 5.4 Enhanced Quota Logic
- [ ] Organization-level quota tracking alongside user quotas
- [ ] Hierarchical quota checking (user + org limits)
- [ ] Better error messages with organization context

**Deliverable**: Multi-tenant system with configurable failure modes

---

## Phase 6: Monitoring & Operations (Day 12-14)
**Goal**: Production-ready monitoring and operational tools
**Demo**: Health checks, metrics, bulk operations

### 6.1 Health & Monitoring
```http
GET /admin/health - System health checks
GET /admin/metrics - Basic usage metrics
```

### 6.2 Operational APIs
- [ ] Bulk user import/export
- [ ] Organization usage aggregation

### 6.3 Enhanced Error Handling
- [ ] Structured error responses
- [ ] Request ID tracking

### 6.4 Custom Metadata Support
- [ ] Use `cf-aig-metadata` headers for request tracking
- [ ] Add user_id and org_id to all AI Gateway requests
- [ ] Enhanced analytics via custom metadata

**Deliverable**: Production-ready system with full operational capabilities

---

## Technical Architecture

### Cloudflare AI Gateway Integration
```typescript
// Core proxy logic using OpenAI-compatible endpoint
const aiGatewayUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat/chat/completions`;

const response = await fetch(aiGatewayUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'cf-aig-authorization': `Bearer ${gatewayToken}`,
    'cf-aig-metadata': JSON.stringify({ user_id, org_id }),
    'cf-aig-custom-cost': customCost, // If needed
    ...forwardedHeaders
  },
  body: requestBody
});
```

### KV Data Patterns
```typescript
// Optimized for edge performance
type UserConfig = {
  user_id: string;
  org_id: string;
  email: string;
  monthly_limit_usd: number;
  status: 'active' | 'suspended';
  created_at: string;
};

type QuotaRecord = {
  month_usage_usd: number;
  current_month: string; // "2024-01"
  request_count: number;
  last_update: number;
};
```

### Streaming Support
- [ ] Proper handling of streaming responses from AI Gateway
- [ ] Stream-through architecture (don't buffer)
- [ ] Usage tracking on stream completion
- [ ] Error handling during streaming

## Development Workflow

### Phase Testing Strategy
1. **Unit Tests**: KV operations, quota calculations, auth logic
2. **Integration Tests**: End-to-end request flows
3. **Load Testing**: Concurrent request handling
4. **Manual Testing**: cURL commands for each API

### Environment Setup
```bash
# Development
npm run dev              # Start local development server
wrangler kv:namespace create "GATEWAY_KV" # Create KV namespace
npm run cf-typegen       # Generate types

# Production
npm run deploy           # Deploy to Cloudflare Workers
```

### Configuration
```toml
# wrangler.jsonc
{
  "name": "ai-gateway-proxy",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "vars": {
    "AI_GATEWAY_ACCOUNT_ID": "your-account-id",
    "AI_GATEWAY_ID": "your-gateway-id"
  },
  "kv_namespaces": [
    { "binding": "GATEWAY_KV", "id": "your-kv-id" }
  ]
}
```

## Success Metrics

### Phase 1 Success Criteria
- [ ] OpenAI-compatible requests work with multiple providers
- [ ] Response format matches OpenAI API exactly
- [ ] Streaming and non-streaming both functional

### Phase 2 Success Criteria
- [ ] Authentication required for all requests
- [ ] Invalid keys properly rejected
- [ ] Performance: <10ms auth overhead

### Phase 3 Success Criteria
- [ ] Usage tracking accurate to the cent
- [ ] Quota enforcement prevents overruns
- [ ] Month boundaries handled automatically

### Phase 4 Success Criteria
- [ ] All user lifecycle operations via API
- [ ] API keys generated securely and stored hashed
- [ ] Admin operations complete in <200ms

### Phase 5 Success Criteria
- [ ] Multi-tenant isolation working
- [ ] Failure modes behave as configured
- [ ] Organization quotas aggregated correctly

### Phase 6 Success Criteria
- [ ] System health monitoring active
- [ ] Operational procedures documented
- [ ] Performance targets met (<50ms proxy overhead)

## Migration & Evolution

### Immediate Benefits (Phase 1-2)
- Working OpenAI-compatible API with multiple providers
- Simple authentication and user management
- No complex dependencies or external services

### Medium Term (Phase 3-4)
- Full quota management and cost control
- Complete admin API for manual operations
- Ready for simple dashboard integration

### Long Term (Phase 5-6)
- Multi-tenant SaaS capabilities
- Production monitoring and operations
- Foundation for Phoenix control plane integration

**Total Development Time**: 10-14 days for full implementation
**Time to First Demo**: 1 day (Phase 1)
**Time to Production Ready**: 14 days (all phases)
