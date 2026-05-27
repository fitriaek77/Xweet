// src/lib/db/queries/locks.ts
// Posting lock — prevents concurrent execution on same tweet/account.

import { db } from "@/lib/db/db";
import { STALE_LOCK_THRESHOLD_MS } from "@/config/constants";

/**
 * Acquire posting lock for a tweet.
 * Uses CAS: only acquires if lockedAt is NULL.
 * Returns true if lock acquired, false if already locked.
 */
export async function acquirePostingLock(
  tweetId: string,
  executor: string // "cron" | "manual"
): Promise<boolean> {
  const result = await db.tweet.updateMany({
    where: { id: tweetId, lockedAt: null },
    data: { lockedAt: new Date(), lockedBy: executor },
  });
  return result.count > 0;
}

/**
 * Release posting lock.
 * Only the executor that acquired the lock can release it.
 */
export async function releasePostingLock(
  tweetId: string,
  executor: string
): Promise<void> {
  await db.tweet.updateMany({
    where: { id: tweetId, lockedBy: executor },
    data: { lockedAt: null, lockedBy: null },
  });
}

/**
 * Find stale locks (tweet stuck in "sending" > threshold).
 * Called by tick cron to recover stuck tweets.
 */
export async function findStaleLocks() {
  const threshold = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS);

  return db.tweet.findMany({
    where: {
      OR: [
        // Stale locks in "sending" status
        { status: "sending", lockedAt: { lt: threshold } },
        // Stale locks in "scheduled" status (crash between lock + transition)
        { status: "scheduled", lockedAt: { lt: threshold }, lockedBy: { not: null } },
      ],
    },
    include: { account: { select: { username: true } } },
  });
}

/**
 * Release all stale locks and reset tweets to "scheduled" for retry.
 * Returns count of recovered tweets.
 */
export async function recoverStaleLocks(): Promise<number> {
  const stale = await findStaleLocks();
  let recovered = 0;

  for (const tweet of stale) {
    const ok = await db.tweet.updateMany({
      where: { id: tweet.id, status: tweet.status as string },
      data: {
        status: "scheduled",
        lockedAt: null,
        lockedBy: null,
        retryCount: { increment: 1 },
      },
    });
    if (ok.count > 0) recovered++;
  }

  return recovered;
}
