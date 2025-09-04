# KV-Only Multi-User AI Gateway Architecture

## Executive Summary

This architecture designs a Cloudflare Workers-based AI Gateway proxy using KV-only storage for maximum edge performance and global consistency. The system provides built-in admin APIs that enable immediate manual operations while maintaining a clear migration path to an automated Phoenix control plane. By leveraging KV's global replication, the data plane achieves sub-10ms response times worldwide while remaining fully operational even during configuration updates.

## Design Philosophy

- **KV-Native Architecture**: All data stored in globally replicated KV storage for edge performance
- **API-First Management**: All configuration changes happen via REST APIs
- **Manual-to-Automated Migration**: Start with manual API operations, evolve to Phoenix control plane
- **Failure Mode Configuration**: Per-organization settings for fail-open vs fail-closed behavior
- **Global Edge Performance**: Sub-10ms authentication and quota checks worldwide
- **Simple Data Model**: No complex relationships or discovery APIs needed

## High-Level Architecture

### Phase 1: Manual Control Plane
```
User Request → Proxy Worker → AI Gateway → AI Provider
                    ↑
Manual/Script → Admin API Worker
                    ↓
                KV Storage (Global)
```

### Phase 2: Automated Control Plane
```
User Request → Proxy Worker → AI Gateway → AI Provider
                    ↑
Phoenix App → Admin API Worker
                    ↓
PostgreSQL → KV Storage (Global)
```

## Core Components

### 1. Proxy Worker (Data Plane)

**Primary Functions:**
- Process user AI requests with sub-10ms authentication
- Real-time quota enforcement using KV storage
- Usage tracking for both user and organization quotas
- Automatic quota resets based on month boundaries
- Configurable failure modes (fail-open vs fail-closed)

**Key Features:**
- Zero external dependencies during request processing
- Graceful degradation when admin systems unavailable
- Independent handling of month boundaries and quota resets
- Global edge performance via KV storage

### 2. Admin API Worker (Control Plane Interface)

**Primary Functions:**
- Expose REST APIs for all configuration operations
- Manage user accounts, API keys, and limits in KV storage
- Provide basic usage data from KV (quota info only)
- Handle organization-level failure mode configurations

**Design Principles:**
- Stateless and idempotent operations
- Comprehensive validation and error handling
- Built for both manual operations and future Phoenix integration
- Simple data model with no complex relationships

### 3. KV Storage Architecture

**Data Organization:**
```
# User Configuration
user:{user_id}:config → { monthly_limit_usd, status, org_id, created_at }
user:{user_id}:quota → { month_usage_usd, current_month, request_count }

# API Key Management
apikey:{hash} → { user_id, key_id, name, status }
user:{user_id}:keys:{key_id} → { name, created_at, last_used_at, status }

# Organization Configuration
org:{org_id}:config → { name, monthly_budget_usd, failure_mode }
org:{org_id}:quota → { month_usage_usd, current_month }
```

## Failure Mode Configuration

Organizations can configure how the system behaves when KV storage is unavailable or quota data is missing:

```javascript
// Organization failure mode settings
{
  "failure_mode": "fail_open", // or "fail_closed"
  "fallback_daily_limit": 10.00 // USD limit when quota unavailable
}
```

### Fail-Open Behavior
- Allow requests when quota data unavailable
- Apply temporary daily limit until quota data restored
- Log all grace period usage for later reconciliation

### Fail-Closed Behavior
- Reject requests when quota data unavailable
- Return 503 Service Unavailable with retry headers
- Preserve user quotas during outages

## Admin API Specification

### Authentication
All admin APIs require authentication via admin API keys stored in Worker secrets.

```
Authorization: Bearer admin_key_xxx
```

## User Management APIs

### Create User
```http
POST /admin/users
Content-Type: application/json

{
  "email": "user@company.com",
  "monthly_limit_usd": 100.00,
  "org_id": "uuid"
}
```

**Response: 201 Created**
```json
{
  "user_id": "uuid",
  "email": "user@company.com",
  "monthly_limit_usd": 100.00,
  "status": "active",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**KV Operations:**
```javascript
async function createUser(userData) {
  const userId = crypto.randomUUID();
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Store user configuration
  await kv.put(`user:${userId}:config`, JSON.stringify({
    user_id: userId,
    email: userData.email,
    monthly_limit_usd: userData.monthly_limit_usd,
    org_id: userData.org_id,
    status: 'active',
    created_at: new Date().toISOString()
  }));

  // Initialize quota tracking
  await kv.put(`user:${userId}:quota`, JSON.stringify({
    month_usage_usd: 0.00,
    current_month: currentMonth,
    request_count: 0,
    last_update: Date.now()
  }));

  return { user_id: userId, ...userData };
}
```

### Update User Limits
```http
PATCH /admin/users/{user_id}
Content-Type: application/json

{
  "monthly_limit_usd": 150.00,
  "status": "active"
}
```

**Implementation:**
```javascript
async function updateUserLimit(userId, updates) {
  const configKey = `user:${userId}:config`;
  const existingConfig = await kv.get(configKey, 'json');

  if (!existingConfig) {
    throw new Error('User not found');
  }

  const updatedConfig = {
    ...existingConfig,
    ...updates,
    updated_at: new Date().toISOString()
  };

  await kv.put(configKey, JSON.stringify(updatedConfig));

  return {
    user_id: userId,
    previous_limit: existingConfig.monthly_limit_usd,
    new_limit: updates.monthly_limit_usd,
    updated_at: updatedConfig.updated_at
  };
}
```

### Get User Details
```http
GET /admin/users/{user_id}
```

**Response: 200 OK**
```json
{
  "user_id": "uuid",
  "email": "user@company.com",
  "monthly_limit_usd": 100.00,
  "current_usage_usd": 23.45,
  "status": "active",
  "created_at": "2024-01-15T10:30:00Z"
}
```

## API Key Management

### Generate API Key
```http
POST /admin/users/{user_id}/api-keys
Content-Type: application/json

{
  "name": "Development Key"
}
```

**Response: 201 Created**
```json
{
  "key_id": "uuid",
  "api_key": "gw_live_xxx...",
  "name": "Development Key",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**KV Implementation:**
```javascript
async function generateAPIKey(userId, keyData) {
  const keyId = crypto.randomUUID();
  const apiKey = `gw_live_${crypto.randomUUID().replace(/-/g, '')}`;

  // Hash the API key for secure storage
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const keyRecord = {
    key_id: keyId,
    user_id: userId,
    name: keyData.name,
    status: 'active',
    created_at: new Date().toISOString(),
    last_used_at: null
  };

  // Store API key lookup (for authentication)
  await kv.put(`apikey:${keyHash}`, JSON.stringify({
    user_id: userId,
    key_id: keyId,
    name: keyData.name,
    created_at: keyRecord.created_at,
    status: 'active'
  }));

  // Store user's key record
  await kv.put(`user:${userId}:keys:${keyId}`, JSON.stringify(keyRecord));

  return { ...keyRecord, api_key: apiKey }; // Only return raw key once
}
```

### Revoke API Key
```http
DELETE /admin/users/{user_id}/api-keys/{key_id}
```

**Implementation:**
```javascript
async function revokeAPIKey(userId, keyId) {
  const keyRecord = await kv.get(`user:${userId}:keys:${keyId}`, 'json');
  if (!keyRecord) {
    throw new Error('API key not found');
  }

  const revokedRecord = {
    ...keyRecord,
    status: 'revoked',
    revoked_at: new Date().toISOString()
  };

  await kv.put(`user:${userId}:keys:${keyId}`, JSON.stringify(revokedRecord));

  return {
    key_id: keyId,
    revoked_at: revokedRecord.revoked_at,
    status: 'revoked'
  };
}
```

## Organization Management

### Create Organization
```http
POST /admin/organizations
Content-Type: application/json

{
  "name": "Acme Corporation",
  "monthly_budget_usd": 10000.00,
  "failure_mode": "fail_open"
}
```

**KV Implementation:**
```javascript
async function createOrganization(orgData) {
  const orgId = crypto.randomUUID();
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Store organization configuration
  await kv.put(`org:${orgId}:config`, JSON.stringify({
    org_id: orgId,
    name: orgData.name,
    monthly_budget_usd: orgData.monthly_budget_usd,
    failure_mode: orgData.failure_mode || 'fail_closed',
    fallback_daily_limit: orgData.fallback_daily_limit || 10.00,
    created_at: new Date().toISOString()
  }));

  // Initialize organization quota
  await kv.put(`org:${orgId}:quota`, JSON.stringify({
    month_usage_usd: 0.00,
    current_month: currentMonth,
    last_update: Date.now()
  }));

  return { org_id: orgId, ...orgData };
}
```

### Update Organization Settings
```http
PATCH /admin/organizations/{org_id}
Content-Type: application/json

{
  "monthly_budget_usd": 15000.00,
  "failure_mode": "fail_open"
}
```

## Quota Management APIs

### Reset User Quota
```http
POST /admin/users/{user_id}/reset-quota
Content-Type: application/json

{
  "reset_reason": "Manual adjustment for billing error"
}
```

**KV Implementation:**
```javascript
async function resetUserQuota(userId, resetReason) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  const currentQuota = await kv.get(`user:${userId}:quota`, 'json');

  const resetQuota = {
    month_usage_usd: 0.00,
    current_month: currentMonth,
    request_count: 0,
    last_update: Date.now()
  };

  await kv.put(`user:${userId}:quota`, JSON.stringify(resetQuota));

  return {
    user_id: userId,
    previous_usage: currentQuota?.month_usage_usd || 0,
    new_usage: 0.00,
    reset_at: new Date().toISOString(),
    reset_reason: resetReason
  };
}
```

## Proxy Worker Implementation

### Authentication with Failure Mode Support
```javascript
async function authenticateRequest(apiKey) {
  try {
    // Hash the provided API key
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    // Look up API key
    const keyData = await kv.get(`apikey:${keyHash}`, 'json');

    if (!keyData || keyData.status !== 'active') {
      return { valid: false, error: 'Invalid or revoked API key' };
    }

    return {
      valid: true,
      user_id: keyData.user_id,
      key_id: keyData.key_id
    };

  } catch (error) {
    return { valid: false, error: 'Authentication failed' };
  }
}
```

### Quota Enforcement with Automatic Reset and Failure Mode
```javascript
async function checkQuota(userId, requestCostUSD) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const quotaKey = `user:${userId}:quota`;

  try {
    // Get current quota
    let quota = await kv.get(quotaKey, 'json');

    // Handle month boundary reset
    if (!quota || quota.current_month !== currentMonth) {
      quota = {
        month_usage_usd: 0.00,
        current_month: currentMonth,
        request_count: 0,
        last_update: Date.now()
      };

      await kv.put(quotaKey, JSON.stringify(quota));
    }

    // Get user config and org config
    const userConfig = await kv.get(`user:${userId}:config`, 'json');
    const orgConfig = await kv.get(`org:${userConfig.org_id}:config`, 'json');

    const monthlyLimit = userConfig?.monthly_limit_usd || 100.00;

    // Check if request would exceed limit
    const projectedUsage = quota.month_usage_usd + requestCostUSD;
    if (projectedUsage > monthlyLimit) {
      return {
        allowed: false,
        current_usage: quota.month_usage_usd,
        monthly_limit: monthlyLimit,
        requested_amount: requestCostUSD
      };
    }

    return {
      allowed: true,
      current_usage: quota.month_usage_usd,
      monthly_limit: monthlyLimit
    };

  } catch (error) {
    // Apply organization failure mode
    const userConfig = await kv.get(`user:${userId}:config`, 'json');
    const orgConfig = await kv.get(`org:${userConfig?.org_id}:config`, 'json');

    if (orgConfig?.failure_mode === 'fail_open') {
      return {
        allowed: true,
        grace_mode: true,
        daily_limit: orgConfig.fallback_daily_limit || 10.00
      };
    } else {
      return { allowed: false, error: 'Quota service unavailable' };
    }
  }
}
```

### Usage Tracking
```javascript
async function trackUsage(userId, requestCostUSD, requestData) {
  const quotaKey = `user:${userId}:quota`;
  const orgQuotaKey = `org:${requestData.org_id}:quota`;

  try {
    // Update user quota
    const quota = await kv.get(quotaKey, 'json');
    const updatedQuota = {
      ...quota,
      month_usage_usd: quota.month_usage_usd + requestCostUSD,
      request_count: quota.request_count + 1,
      last_update: Date.now()
    };

    await kv.put(quotaKey, JSON.stringify(updatedQuota));

    // Update organization quota
    const orgQuota = await kv.get(orgQuotaKey, 'json');
    const updatedOrgQuota = {
      ...orgQuota,
      month_usage_usd: (orgQuota?.month_usage_usd || 0) + requestCostUSD,
      last_update: Date.now()
    };

    await kv.put(orgQuotaKey, JSON.stringify(updatedOrgQuota));

    // Update API key last used timestamp
    if (requestData.key_id) {
      const keyRecord = await kv.get(`user:${userId}:keys:${requestData.key_id}`, 'json');
      if (keyRecord) {
        keyRecord.last_used_at = new Date().toISOString();
        await kv.put(`user:${userId}:keys:${requestData.key_id}`, JSON.stringify(keyRecord));
      }
    }

  } catch (error) {
    console.error(`Failed to track usage for user ${userId}:`, error);
  }
}
```

## System Administration APIs

### Health Check
```http
GET /admin/health
```

**Response: 200 OK**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Implementation:**
```javascript
async function healthCheck() {
  try {
    // Simple KV connectivity test
    const testKey = 'system:health_check';
    const testValue = Date.now().toString();

    await kv.put(testKey, testValue);
    const retrieved = await kv.get(testKey);

    if (retrieved === testValue) {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        status: 'unhealthy',
        error: 'KV read/write test failed',
        timestamp: new Date().toISOString()
      };
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}
```

## Usage Data APIs

### Get User Usage
```http
GET /admin/users/{user_id}/usage
```

**Response: 200 OK**
```json
{
  "user_id": "uuid",
  "current_usage_usd": 23.45,
  "request_count": 156,
  "monthly_limit_usd": 100.00,
  "current_month": "2024-01"
}
```

**Implementation:**
```javascript
async function getUserUsage(userId) {
  const quota = await kv.get(`user:${userId}:quota`, 'json');
  const userConfig = await kv.get(`user:${userId}:config`, 'json');

  if (!quota || !userConfig) {
    throw new Error('User not found');
  }

  return {
    user_id: userId,
    current_usage_usd: quota.month_usage_usd,
    request_count: quota.request_count,
    monthly_limit_usd: userConfig.monthly_limit_usd,
    current_month: quota.current_month
  };
}
```

### Get Organization Usage
```http
GET /admin/organizations/{org_id}/usage
```

**Response: 200 OK**
```json
{
  "org_id": "uuid",
  "current_usage_usd": 1234.56,
  "monthly_budget_usd": 10000.00,
  "current_month": "2024-01"
}
```

## Scheduled Operations

### Monthly Quota Reset Worker
```javascript
// Cron trigger: "0 0 1 * *" (1st of every month at midnight UTC)
export default {
  async scheduled(event, env, ctx) {
    await handleMonthlyReset(env);
  }
};

async function handleMonthlyReset(env) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  // This is a background process that will eventually reset all quotas
  // Individual quotas are also reset on-demand during request processing
  console.log(`Monthly reset triggered for ${currentMonth}`);

  // The actual reset happens automatically during request processing
  // when month boundary is detected
}
```

## Operational Procedures

### Initial Setup
```bash
# 1. Deploy Workers
wrangler deploy proxy-worker
wrangler deploy admin-api-worker

# 2. Create first organization
curl -X POST https://admin-api.example.com/admin/organizations \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "monthly_budget_usd": 5000.00,
    "failure_mode": "fail_open"
  }'

# 3. Create first user
curl -X POST https://admin-api.example.com/admin/users \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@mycompany.com",
    "monthly_limit_usd": 1000.00,
    "org_id": "$ORG_ID"
  }'
```

### Daily Operations
```bash
# Check system health
curl https://admin-api.example.com/admin/health \
  -H "Authorization: Bearer $ADMIN_KEY"

# Get user usage
curl https://admin-api.example.com/admin/users/$USER_ID/usage \
  -H "Authorization: Bearer $ADMIN_KEY"

# Increase user limit
curl -X PATCH https://admin-api.example.com/admin/users/$USER_ID \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"monthly_limit_usd": 500.00}'

# Reset user quota (emergency)
curl -X POST https://admin-api.example.com/admin/users/$USER_ID/reset-quota \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reset_reason": "Billing correction"}'
```

## Migration Path to Phoenix Control Plane

### Phase 1: Manual Operations (Immediate)
- Deploy Workers with KV-only admin APIs
- Use Postman/curl for user management
- Build shell scripts for common operations
- Monitor via direct API calls to admin endpoints

### Phase 2: Simple Automation (1-3 months)
- Create CLI tools that call admin APIs
- Build simple web dashboard consuming admin APIs
- Implement alerting via scheduled workers

### Phase 3: Phoenix Control Plane (3-6 months)
- Deploy Phoenix app that consumes existing admin APIs
- Migrate user management UI to LiveView
- Phoenix queries AI Gateway directly for detailed analytics
- Add PostgreSQL for complex queries and control plane data
- Workers remain unchanged - continue using KV storage

### Phase 4: Hybrid Architecture (6+ months)
- Phoenix handles complex control plane operations using PostgreSQL
- Workers continue using KV for real-time operations
- Phoenix queries AI Gateway APIs directly for usage analytics
- Maintain KV storage for performance-critical authentication and quota checking

## Security Considerations

### Admin API Security
- Admin API keys stored in Worker secrets
- Rate limiting on all admin endpoints
- Comprehensive audit logging
- API key rotation procedures

### Data Protection
- User API keys hashed with SHA-256
- Secure handling of AI provider credentials
- Regular security audits of admin operations

## Cost Analysis

### KV-Only Architecture Costs
- **Workers Requests**: $0.50 per million requests
- **Workers CPU Time**: $12.50 per million GB-seconds
- **KV Operations**: $0.50 per million reads, $5.00 per million writes
- **KV Storage**: $0.50 per GB-month
- **Total Monthly (10K requests)**: ~$5-10/month

### Performance Benefits
- **Global Edge Performance**: 2-5ms authentication worldwide
- **No Database Connection Limits**: KV scales automatically
- **Zero Cold Start Dependencies**: No database connections to establish
- **Consistent Global Latency**: Same performance from any Cloudflare edge location

## Advantages of KV-Only Architecture

### Performance Benefits
- **Global Edge Performance**: 2-5ms authentication worldwide
- **No Database Connection Limits**: KV scales automatically
- **Zero Cold Start Dependencies**: No database connections to establish
- **Consistent Global Latency**: Same performance from any Cloudflare edge location

### Operational Benefits
- **Simplified Infrastructure**: One storage system to manage
- **Automatic Global Replication**: KV handles multi-region consistency
- **Cost Predictability**: Linear scaling with usage
- **Reduced Failure Modes**: Fewer systems that can fail

### Development Benefits
- **API Compatibility**: Same admin APIs work in manual and automated phases
- **Easy Testing**: Mock KV operations simpler than database mocking
- **Clear Migration Path**: Add PostgreSQL without changing worker code
- **Simple Data Model**: No complex relationships or joins needed

## Conclusion

This KV-only architecture provides immediate operational control with global edge performance while preserving flexibility for future enhancement. The manual control plane enables teams to start managing AI costs and access controls immediately, while the admin API design ensures smooth migration to sophisticated control plane management as organizational needs grow.

The architecture delivers production-ready AI gateway functionality from day one with minimal operational complexity, while maintaining clear upgrade paths as requirements evolve. The failure mode configuration ensures reliable operation during edge cases, and the simple data model eliminates the complexity of traditional database management.
