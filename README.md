# AI Gateway - KV-Only Multi-User AI Proxy

A production-ready Cloudflare Workers-based AI Gateway that provides multi-user AI request management with quota enforcement, API key management, and global edge performance through KV-only storage architecture.

## 🚀 Features

- **Global Edge Performance**: 2-5ms authentication worldwide via Cloudflare KV storage
- **Multi-User Management**: Complete user and organization management with quotas
- **API Key Management**: Secure API key generation, authentication, and revocation
- **Quota Enforcement**: Real-time usage tracking with automatic monthly resets
- **Failure Modes**: Organization-level fail-open or fail-closed behavior
- **OpenAI Compatible**: Drop-in replacement for OpenAI API endpoints
- **Manual Control Plane**: Ready-to-use scripts for immediate operations

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

## 🛠️ Management Scripts

The AI Gateway includes comprehensive management scripts for all operations:

### Setup & Cleanup

#### Initialize Demo Environment
```bash
# Create demo organizations and users with API keys
node scripts/setup.js

# For production
node scripts/setup.js --prod
```

This creates:
- 2 demo organizations (Demo Corporation, Test Organization)
- 3 demo users with different quota limits
- API keys for immediate testing

#### Clean Environment
```bash
# Show cleanup instructions (safe)
node scripts/cleanup.js

# Show cleanup with confirmation
node scripts/cleanup.js --confirm
```

### User & Organization Management

#### System Metrics
```bash
# View system-wide metrics and usage
node scripts/admin.js metrics
```

#### Organization Operations
```bash
# Create organization
node scripts/admin.js org create "My Company" 1000

# Get organization details
node scripts/admin.js org get org_123

# View organization usage
node scripts/admin.js org usage org_123

# List organization users
node scripts/admin.js org users org_123
```

#### User Operations
```bash
# Create user
node scripts/admin.js user create user@company.com org_123 200

# Get user details
node scripts/admin.js user get user_456

# View user usage and quota
node scripts/admin.js user usage user_456

# Reset user quota (emergency)
node scripts/admin.js user reset-quota user_456

# Delete user
node scripts/admin.js user delete user_456
```

#### API Key Management
```bash
# Generate new API key for user
node scripts/admin.js apikey create user_456

# Note: API key listing and revocation require direct KV access
# Use Cloudflare Dashboard or wrangler CLI for advanced operations
```

### Testing the Gateway

#### Chat Completions Test
```bash
# Basic test with demo API key
node scripts/chat.js "Hello, world!"

# Test with specific API key
node scripts/chat.js --api-key "gw_live_xyz123" "What is AI?"

# Test with different model
node scripts/chat.js --model "openai/gpt-4" "Explain quantum computing"

# Test with streaming response
node scripts/chat.js --stream "Tell me a story"

# Interactive chat mode
node scripts/chat.js --interactive

# Production testing
node scripts/chat.js --prod --api-key "your_prod_key" "Test message"
```

## 🏗️ Architecture Overview

### Core Components

1. **Proxy Worker** (`src/index.ts`, `src/routes/chat.ts`)
   - OpenAI-compatible API endpoints
   - Real-time quota enforcement
   - Authentication and usage tracking
   - Global edge performance

2. **Admin API** (`src/routes/admin.ts`)
   - User and organization management
   - API key generation and revocation
   - Usage monitoring and metrics
   - System health checks

3. **KV Storage Architecture**
   ```
   user:{user_id}:config    → User configuration and limits
   user:{user_id}:quota     → Monthly usage tracking
   apikey:{hash}            → API key authentication lookup
   org:{org_id}:config      → Organization settings
   org:{org_id}:quota       → Organization usage tracking
   ```

### Data Flow

```
User Request → Authentication → Quota Check → AI Gateway → AI Provider
                ↓                    ↓
           KV Lookup          Usage Tracking
```

## 📊 Typical Workflow

### 1. Initial Setup
```bash
# Start development environment (uses .env file)
pnpm run dev

# Initialize with demo data
node scripts/setup.js

# Check system status
node scripts/admin.js metrics
```

### 2. Production Deployment
```bash
# Deploy to Cloudflare Workers
pnpm run deploy

# Setup production environment
node scripts/setup.js --prod

# Verify production metrics
node scripts/admin.js metrics --prod
```

### 3. Daily Operations
```bash
# Monitor system health
node scripts/admin.js metrics

# Check user usage
node scripts/admin.js user usage user_456

# Create new user
node scripts/admin.js user create newuser@company.com org_123 100

# Test API functionality
node scripts/chat.js --api-key "user_api_key" "Test message"
```

### 4. User Management Lifecycle
```bash
# 1. Create organization
node scripts/admin.js org create "New Client" 5000

# 2. Create user in organization
node scripts/admin.js user create admin@newclient.com org_new_id 500

# 3. User tests with provided API key
node scripts/chat.js --api-key "generated_key" "Hello"

# 4. Monitor usage
node scripts/admin.js user usage user_new_id

# 5. Adjust limits as needed (requires direct API call - not implemented in script)
# For now, delete and recreate user with new limits if needed
```

## 🔧 Configuration

### Environment Variables
- `ADMIN_API_KEY`: Admin authentication key for management operations
- `AI_GATEWAY_TOKEN`: Cloudflare AI Gateway authentication token
- `AI_GATEWAY_ACCOUNT_ID`: Your Cloudflare account ID
- `AI_GATEWAY_ID`: Your Cloudflare AI Gateway ID

### Failure Modes

Organizations can configure how the system behaves during outages:

- **fail-open**: Allow requests when quota data unavailable (with temporary limits)
- **fail-closed**: Reject requests when quota data unavailable

## 📈 Monitoring & Metrics

The system provides comprehensive metrics through the admin API:

- **System Health**: Response times, uptime status
- **Usage Statistics**: Total users, organizations, requests, costs
- **Top Users**: Highest usage by cost and request volume
- **API Key Status**: Active, revoked, and total key counts

Access metrics with:
```bash
node scripts/admin.js metrics
```

## 🔒 Security Features

- **Hashed API Keys**: SHA-256 hashing for secure storage
- **Admin Authentication**: Separate admin API key for management operations
- **Quota Enforcement**: Prevent runaway costs with user and organization limits
- **Audit Trail**: Usage tracking for compliance and monitoring

## 🚀 Production Deployment

### Cloudflare Workers Setup
1. Configure `wrangler.jsonc` with your account details
2. Set up KV namespace bindings
3. Configure environment variables
4. Deploy with `pnpm run deploy`

### AI Gateway Configuration
1. Create AI Gateway in Cloudflare Dashboard
2. Configure provider connections (OpenAI, etc.)
3. Set up authentication tokens
4. Update environment variables

## 📚 API Reference

### Admin API Endpoints
- `GET /admin/metrics` - System metrics and usage
- `POST /admin/organizations` - Create organization
- `GET /admin/organizations/{id}` - Get organization
- `POST /admin/users` - Create user
- `GET /admin/users/{id}` - Get user details
- `GET /admin/users/{id}/usage` - Get user usage

### Chat API Endpoints
- `POST /v1/chat/completions` - OpenAI-compatible chat completions
