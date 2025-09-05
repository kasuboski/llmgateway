/**
 * Cryptographic utilities for API key generation and hashing
 */

export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateApiKey(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  const key = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  return `gw_live_${key}`;
}

export function generateRequestId(): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}
