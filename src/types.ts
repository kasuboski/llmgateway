// Shared type definitions for the AI Gateway

export interface VirtualKeyConfig {
  key_id: string;                    // Unique identifier for the key
  key_hash: string;                  // SHA-256 hash of the actual key
  org_id: string;                    // Organization this key belongs to
  user: string;                      // REQUIRED: User identifier (email or ID)
  name?: string;                     // Optional friendly name for the key
  monthly_limit_usd: number;         // Monthly spending limit for this key
  status: 'active' | 'revoked';      // Key status
  created_at: string;                // ISO timestamp
}

export interface UserConfig {
  user: string;                      // User identifier (email or ID)
  org_id: string;                    // Organization this user belongs to
  monthly_limit_usd: number;         // Monthly aggregate quota across all user's keys
  created_at: string;                // ISO timestamp
}

export interface QuotaRecord {
  month_usage_usd: number;
  current_month: string; // "2024-01"
  request_count: number;
  last_update: number;
}

export interface OrganizationConfig {
  org_id: string;
  name: string;
  monthly_budget_usd: number;
  failure_mode: 'fail-open' | 'fail-closed';
  provider_keys: {
    openai?: string;
    anthropic?: string;
    [key: string]: string | undefined;
  };
  created_at: string;
}
