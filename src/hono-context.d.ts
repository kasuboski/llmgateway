import type { ApiKeyRecord, UserConfig } from './types';

// Augment Hono's Context variables used across the app
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    user: UserConfig;
    apiKey: ApiKeyRecord;
  }
}
