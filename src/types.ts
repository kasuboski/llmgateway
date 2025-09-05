// Shared type definitions for the AI Gateway

export interface UserConfig {
  user_id: string;
  org_id: string;
  email: string;
  monthly_limit_usd: number;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface ApiKeyRecord {
  user_id: string;
  key_id: string;
  status: 'active' | 'revoked';
  created_at: string;
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
