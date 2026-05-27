// src/lib/db/queries/tweets.ts
// Tweet CRUD + CAS status transitions.

import { db } from "@/lib/db/db";
import { TWEET_STATUS, VALID_TRANSITIONS, type TweetStatus } from "@/config/constants";
import { NotFoundError, ConflictError } from "@/lib/api/errors";
import type { Prisma } from "@prisma/client";

export async function getTweets(filters?: {
  accountId?: string;
  status?: TweetStatus;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.accountId) where.accountId = filters.accountId;
  if (filters?.status) where.status = filters.status;

  return db.tweet.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    take: filters?.limit ?? 50,
    skip: filters?.offset ?? 0,
    include: { account: { select: { username: true, avatarUrl: true } } },
  });
}

export async function getTweetById(id: string) {
  const tweet = await db.tweet.findUnique({
    where: { id },
    include: { account: { select: { username: true, avatarUrl: true } } },
  });
  if (!tweet) throw new NotFoundError("Tweet", id);
  return tweet;
}

export async function createTweet(data: Prisma.TweetUncheckedCreateInput) {
  return db.tweet.create({ data });
}

export async function updateTweet(
  id: string,
  data: Prisma.TweetUncheckedUpdateManyInput
) {
  const tweet = await db.tweet.findUnique({ where: { id } });
  if (!tweet) throw new NotFoundError("Tweet", id);

  return db.tweet.update({ where: { id }, data });
}

function getValidTransitions(status: TweetStatus): TweetStatus[] {
  switch (status) {
    case "scheduled": return VALID_TRANSITIONS.scheduled;
    case "x_scheduled": return VALID_TRANSITIONS.x_scheduled;
    case "sending": return VALID_TRANSITIONS.sending;
    case "sent": return VALID_TRANSITIONS.sent;
    case "failed": return VALID_TRANSITIONS.failed;
    case "cancelled": return VALID_TRANSITIONS.cancelled;
  }
}

/**
 * Compare-And-Swap status transition.
 * Only succeeds if current status matches `fromStatus`.
 * Prevents race conditions between concurrent executors.
 */
export async function transitionTweetStatus(
  id: string,
  fromStatus: TweetStatus,
  toStatus: TweetStatus,
  data?: Prisma.TweetUncheckedUpdateManyInput
): Promise<boolean> {
  // Validate transition is allowed
  const allowed = getValidTransitions(fromStatus);
  if (!allowed.includes(toStatus)) {
    throw new ConflictError(
      `Invalid transition: ${fromStatus} → ${toStatus}`
    );
  }

  // CAS: only update if current status matches
  const result = await db.tweet.updateMany({
    where: { id, status: fromStatus },
    data: { status: toStatus, ...data },
  });

  return result.count > 0;
}

export async function deleteTweet(id: string) {
  const tweet = await db.tweet.findUnique({ where: { id } });
  if (!tweet) throw new NotFoundError("Tweet", id);

  // Only allow delete if not currently being sent
  if (tweet.status === TWEET_STATUS.SENDING) {
    throw new ConflictError("Cannot delete tweet currently being sent");
  }

  return db.tweet.delete({ where: { id } });
}

/** Find tweets due for posting (scheduled time has passed). */
export async function getDueTweets(limit = 20) {
  return db.tweet.findMany({
    where: {
      status: TWEET_STATUS.SCHEDULED,
      scheduledAt: { lte: new Date() },
      lockedAt: null,
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    include: { account: true },
  });
}

/** Count X-scheduled tweets per account (for 100-limit check). */
export async function countXScheduledForAccount(accountId: string) {
  return db.tweet.count({
    where: {
      accountId,
      status: TWEET_STATUS.X_SCHEDULED,
    },
  });
}
