// src/lib/db/queries/logs.ts
// ScheduleLog queries — audit trail for all tweet operations.

import { db } from "@/lib/db/db";

export async function createLog(data: {
  tweetId?: string;
  accountId?: string;
  action: string;
  detail?: string;
  durationMs?: number;
}) {
  return db.scheduleLog.create({ data });
}

export async function getLogs(filters?: {
  tweetId?: string;
  accountId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.tweetId) where.tweetId = filters.tweetId;
  if (filters?.accountId) where.accountId = filters.accountId;
  if (filters?.action) where.action = filters.action;

  return db.scheduleLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: filters?.limit ?? 50,
    skip: filters?.offset ?? 0,
  });
}
