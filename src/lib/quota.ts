/**
 * Quota management utilities for virtual keys, users, and organizations
 */

import type { QuotaRecord } from '../types';

export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

export async function getQuotaRecord(kv: KVNamespace, keyHash: string): Promise<QuotaRecord> {
  const currentMonth = getCurrentMonth();
  const quotaRecord = (await kv.get(`vkey:${keyHash}:quota`, 'json')) as QuotaRecord | null;

  // If no quota record exists or it's from a previous month, create/reset it
  if (!quotaRecord || quotaRecord.current_month !== currentMonth) {
    const newQuotaRecord: QuotaRecord = {
      month_usage_usd: 0,
      current_month: currentMonth,
      request_count: 0,
      last_update: Date.now(),
    };
    await kv.put(`vkey:${keyHash}:quota`, JSON.stringify(newQuotaRecord));
    return newQuotaRecord;
  }

  return quotaRecord;
}

export async function updateQuotaUsage(
  kv: KVNamespace,
  keyHash: string,
  costUsd: number
): Promise<QuotaRecord> {
  const quotaRecord = await getQuotaRecord(kv, keyHash);

  quotaRecord.month_usage_usd += costUsd;
  quotaRecord.request_count += 1;
  quotaRecord.last_update = Date.now();

  await kv.put(`vkey:${keyHash}:quota`, JSON.stringify(quotaRecord));
  return quotaRecord;
}

export async function checkQuotaLimit(
  kv: KVNamespace,
  keyHash: string,
  estimatedCostUsd: number,
  monthlyLimitUsd: number
): Promise<{ allowed: boolean; quotaRecord: QuotaRecord }> {
  const quotaRecord = await getQuotaRecord(kv, keyHash);

  const projectedUsage = quotaRecord.month_usage_usd + estimatedCostUsd;
  const allowed = projectedUsage <= monthlyLimitUsd;

  return { allowed, quotaRecord };
}

export async function getOrganizationQuotaRecord(
  kv: KVNamespace,
  orgId: string
): Promise<QuotaRecord> {
  const currentMonth = getCurrentMonth();
  const quotaRecord = (await kv.get(`org:${orgId}:quota`, 'json')) as QuotaRecord | null;

  // If no quota record exists or it's from a previous month, create/reset it
  if (!quotaRecord || quotaRecord.current_month !== currentMonth) {
    const newQuotaRecord: QuotaRecord = {
      month_usage_usd: 0,
      current_month: currentMonth,
      request_count: 0,
      last_update: Date.now(),
    };
    await kv.put(`org:${orgId}:quota`, JSON.stringify(newQuotaRecord));
    return newQuotaRecord;
  }

  return quotaRecord;
}

export async function updateOrganizationQuotaUsage(
  kv: KVNamespace,
  orgId: string,
  costUsd: number
): Promise<QuotaRecord> {
  const quotaRecord = await getOrganizationQuotaRecord(kv, orgId);

  quotaRecord.month_usage_usd += costUsd;
  quotaRecord.request_count += 1;
  quotaRecord.last_update = Date.now();

  await kv.put(`org:${orgId}:quota`, JSON.stringify(quotaRecord));
  return quotaRecord;
}

export async function getUserQuotaRecord(
  kv: KVNamespace,
  user: string
): Promise<QuotaRecord> {
  const currentMonth = getCurrentMonth();
  const quotaRecord = (await kv.get(`user:${user}:quota`, 'json')) as QuotaRecord | null;

  // If no quota record exists or it's from a previous month, create/reset it
  if (!quotaRecord || quotaRecord.current_month !== currentMonth) {
    const newQuotaRecord: QuotaRecord = {
      month_usage_usd: 0,
      current_month: currentMonth,
      request_count: 0,
      last_update: Date.now(),
    };
    await kv.put(`user:${user}:quota`, JSON.stringify(newQuotaRecord));
    return newQuotaRecord;
  }

  return quotaRecord;
}

export async function updateUserQuotaUsage(
  kv: KVNamespace,
  user: string,
  costUsd: number
): Promise<QuotaRecord> {
  const quotaRecord = await getUserQuotaRecord(kv, user);

  quotaRecord.month_usage_usd += costUsd;
  quotaRecord.request_count += 1;
  quotaRecord.last_update = Date.now();

  await kv.put(`user:${user}:quota`, JSON.stringify(quotaRecord));
  return quotaRecord;
}

export async function checkReactiveQuotaLimit(
  kv: KVNamespace,
  keyHash: string,
  user: string,
  orgId: string,
  keyMonthlyLimitUsd: number,
  userMonthlyLimitUsd: number,
  orgMonthlyBudgetUsd: number
): Promise<{
  allowed: boolean;
  keyQuotaRecord: QuotaRecord;
  userQuotaRecord: QuotaRecord;
  orgQuotaRecord: QuotaRecord;
  reason?: string;
}> {
  // Get current usage records for all three levels
  const keyQuotaRecord = await getQuotaRecord(kv, keyHash);
  const userQuotaRecord = await getUserQuotaRecord(kv, user);
  const orgQuotaRecord = await getOrganizationQuotaRecord(kv, orgId);

  // Virtual key quota check - only check actual current usage
  if (keyQuotaRecord.month_usage_usd >= keyMonthlyLimitUsd) {
    return {
      allowed: false,
      keyQuotaRecord,
      userQuotaRecord,
      orgQuotaRecord,
      reason: 'key_quota_exceeded',
    };
  }

  // User quota check - check aggregate usage across all user's keys
  if (userQuotaRecord.month_usage_usd >= userMonthlyLimitUsd) {
    return {
      allowed: false,
      keyQuotaRecord,
      userQuotaRecord,
      orgQuotaRecord,
      reason: 'user_quota_exceeded',
    };
  }

  // Organization quota check - check aggregate usage across all org's users
  if (orgQuotaRecord.month_usage_usd >= orgMonthlyBudgetUsd) {
    return {
      allowed: false,
      keyQuotaRecord,
      userQuotaRecord,
      orgQuotaRecord,
      reason: 'organization_quota_exceeded',
    };
  }

  return {
    allowed: true,
    keyQuotaRecord,
    userQuotaRecord,
    orgQuotaRecord,
  };
}
