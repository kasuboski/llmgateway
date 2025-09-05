/**
 * Quota management utilities for users and organizations
 */

import type { QuotaRecord } from '../types';

export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

export async function getQuotaRecord(kv: KVNamespace, userId: string): Promise<QuotaRecord> {
  const currentMonth = getCurrentMonth();
  const quotaRecord = (await kv.get(`user:${userId}:quota`, 'json')) as QuotaRecord | null;

  // If no quota record exists or it's from a previous month, create/reset it
  if (!quotaRecord || quotaRecord.current_month !== currentMonth) {
    const newQuotaRecord: QuotaRecord = {
      month_usage_usd: 0,
      current_month: currentMonth,
      request_count: 0,
      last_update: Date.now(),
    };
    await kv.put(`user:${userId}:quota`, JSON.stringify(newQuotaRecord));
    return newQuotaRecord;
  }

  return quotaRecord;
}

export async function updateQuotaUsage(
  kv: KVNamespace,
  userId: string,
  costUsd: number
): Promise<QuotaRecord> {
  const quotaRecord = await getQuotaRecord(kv, userId);

  quotaRecord.month_usage_usd += costUsd;
  quotaRecord.request_count += 1;
  quotaRecord.last_update = Date.now();

  await kv.put(`user:${userId}:quota`, JSON.stringify(quotaRecord));
  return quotaRecord;
}

export async function checkQuotaLimit(
  kv: KVNamespace,
  userId: string,
  estimatedCostUsd: number,
  monthlyLimitUsd: number
): Promise<{ allowed: boolean; quotaRecord: QuotaRecord }> {
  const quotaRecord = await getQuotaRecord(kv, userId);

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

export async function checkHierarchicalQuotaLimit(
  kv: KVNamespace,
  userId: string,
  orgId: string,
  estimatedCostUsd: number,
  userMonthlyLimitUsd: number,
  orgMonthlyBudgetUsd: number
): Promise<{
  allowed: boolean;
  userQuotaRecord: QuotaRecord;
  orgQuotaRecord: QuotaRecord;
  reason?: string;
}> {
  // Check user quota
  const userQuotaRecord = await getQuotaRecord(kv, userId);
  const projectedUserUsage = userQuotaRecord.month_usage_usd + estimatedCostUsd;

  // Check organization quota
  const orgQuotaRecord = await getOrganizationQuotaRecord(kv, orgId);
  const projectedOrgUsage = orgQuotaRecord.month_usage_usd + estimatedCostUsd;

  // User quota check
  if (projectedUserUsage > userMonthlyLimitUsd) {
    return {
      allowed: false,
      userQuotaRecord,
      orgQuotaRecord,
      reason: 'user_quota_exceeded',
    };
  }

  // Organization quota check
  if (projectedOrgUsage > orgMonthlyBudgetUsd) {
    return {
      allowed: false,
      userQuotaRecord,
      orgQuotaRecord,
      reason: 'organization_quota_exceeded',
    };
  }

  return {
    allowed: true,
    userQuotaRecord,
    orgQuotaRecord,
  };
}
