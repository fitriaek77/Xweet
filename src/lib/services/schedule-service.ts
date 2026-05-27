// src/lib/services/schedule-service.ts
// Scheduling orchestration — the single cron tick handles ALL tasks:
//   1. Recover stale locks (5 min timeout)
//   2. Recover stale "posting" status (2 min)
//   3. Dispatch due tweets (batch of 5)
//   4. Retry failed tweets (batch of 3)
//   5. Refresh stale ct0 (>4h old)
//   6. Sync X-scheduled tweets
//   7. Refresh cache pre-emptively
//   8. Time-budget guard (8s max)
//
// Merged from 2 crons into 1 — maintenance tasks add ~200ms, well within budget.
// Single cron simplifies ops (1 URL, 1 secret) and makes maintenance more responsive.

import { getDueTweets, transitionTweetStatus } from "@/lib/db/queries/tweets";
import { recoverStaleLocks } from "@/lib/db/queries/locks";
import { createLog } from "@/lib/db/queries/logs";
import { publishTweet } from "@/lib/services/tweet-service";
import {
  TWEET_STATUS,
  MAX_RETRIES,
  CRON_BUDGET_MS,
  CRON_DISPATCH_BATCH,
  CRON_RETRY_BATCH,
} from "@/config/constants";

// ─── Helpers ───

/** Check if we've exceeded the time budget. Returns true if budget remains. */
function withinBudget(startTime: number): boolean {
  return Date.now() - startTime < CRON_BUDGET_MS;
}

const POSTING_STALE_MS = 2 * 60 * 1000; // 2 minutes
const CT0_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Recover tweets stuck in "sending" state for too long (possible server crash). */
export async function recoverStalePostings(): Promise<number> {
  const { db } = await import("@/lib/db/db");
  const staleCutoff = new Date(Date.now() - POSTING_STALE_MS);
  const result = await db.tweet.updateMany({
    where: {
      status: TWEET_STATUS.SENDING,
      updatedAt: { lte: staleCutoff },
    },
    data: {
      status: TWEET_STATUS.FAILED,
      failureReason: "[Auto-recovered] Posting timed out — possible server crash.",
    },
  });
  return result.count;
}

// ─── Single Cron Tick: All Tasks ───

/** Cron tick handler — runs every 5 min. Handles dispatch + retry + maintenance. */
export async function executeCronTick(): Promise<{
  dispatched: number;
  staleRecovered: number;
  stalePostingsRecovered: number;
  retried: number;
  ct0Refreshed: number;
  synced: number;
  errors: string[];
  budgetExceeded: boolean;
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  let dispatched = 0;
  let retried = 0;
  let ct0Refreshed = 0;
  let synced = 0;
  let budgetExceeded = false;

  // ── Step 1: Recover stale locks (tweets stuck in "sending" > 5 min) ──
  const staleRecovered = await recoverStaleLocks();
  if (staleRecovered > 0) {
    await createLog({
      action: "stale_recovery",
      detail: `Recovered ${staleRecovered} stale locks`,
    });
  }

  // ── Step 2: Recover stale postings (>2 min — possible server crash) ──
  const stalePostings = await recoverStalePostings();
  if (stalePostings > 0) {
    await createLog({
      action: "stale_posting_recovery",
      detail: `Recovered ${stalePostings} stale postings`,
    });
  }

  // ── Step 3: Dispatch due tweets (status="scheduled" AND scheduledAt ≤ now) ──
  const dueTweets = await getDueTweets(CRON_DISPATCH_BATCH);

  for (const tweet of dueTweets) {
    if (!withinBudget(startTime)) {
      budgetExceeded = true;
      process.stderr.write(
        `[cron] Time budget exceeded (${Date.now() - startTime}ms > ${CRON_BUDGET_MS}ms). ` +
          `Stopping dispatch after ${dispatched}/${dueTweets.length} tweets. Next tick will continue.\n`
      );
      break;
    }

    try {
      const result = await publishTweet(tweet.id, "cron");

      if (result.success) {
        dispatched++;
      } else {
        errors.push(`Tweet ${tweet.id}: ${result.error}`);
      }
    } catch (error) {
      errors.push(
        `Tweet ${tweet.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ── Step 4: Retry failed tweets (retryCount < maxRetries) ──
  if (withinBudget(startTime)) {
    const failedTweets = await getRetryableTweets();
    for (const tweet of failedTweets) {
      if (!withinBudget(startTime)) {
        budgetExceeded = true;
        process.stderr.write(
          `[cron] Time budget exceeded during retry phase (${Date.now() - startTime}ms). ` +
            `Stopping after ${retried}/${failedTweets.length} retries.\n`
        );
        break;
      }

      try {
        // Reset to scheduled for retry
        const reset = await transitionTweetStatus(
          tweet.id,
          TWEET_STATUS.FAILED,
          TWEET_STATUS.SCHEDULED
        );

        if (reset) {
          const result = await publishTweet(tweet.id, "cron");
          if (result.success) {
            retried++;
          } else {
            errors.push(`Retry ${tweet.id}: ${result.error}`);
          }
        }
      } catch (error) {
        errors.push(
          `Retry ${tweet.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // ── Step 5: Refresh stale ct0 (>4h old) ──
  if (withinBudget(startTime)) {
    try {
      ct0Refreshed = await refreshStaleCt0(errors);
    } catch (error) {
      errors.push(`ct0 refresh: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Step 6: Sync X-scheduled tweets ──
  if (withinBudget(startTime)) {
    try {
      synced = await syncXScheduledTweets(errors);
    } catch (error) {
      errors.push(`sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Step 7: Pre-emptive cache refresh (best-effort) ──
  if (withinBudget(startTime)) {
    try {
      // Pre-warm query ID cache for next tick
      const { getQueryIds } = await import("@/lib/twitter/query-id");
      await getQueryIds();
    } catch {
      // Best-effort — don't count as error
    }
  }

  if (budgetExceeded) {
    await createLog({
      action: "cron_budget_exceeded",
      detail: `Cron tick hit ${CRON_BUDGET_MS}ms budget. dispatched=${dispatched}, retried=${retried}`,
    });
  }

  return {
    dispatched,
    staleRecovered,
    stalePostingsRecovered: stalePostings,
    retried,
    ct0Refreshed,
    synced,
    errors,
    budgetExceeded,
  };
}

/**
 * Execute maintenance tasks only (ct0 refresh + X-schedule sync).
 * Exported for separate testing. Called as part of executeCronTick().
 */
export async function executeCronMaintenance(): Promise<{
  ct0Refreshed: number;
  synced: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const ct0Refreshed = await refreshStaleCt0(errors);
  const synced = await syncXScheduledTweets(errors);
  return { ct0Refreshed, synced, errors };
}

/** Get tweets eligible for retry. */
async function getRetryableTweets() {
  const { db } = await import("@/lib/db/db");
  return db.tweet.findMany({
    where: {
      status: TWEET_STATUS.FAILED,
      retryCount: { lt: MAX_RETRIES },
    },
    orderBy: { scheduledAt: "asc" },
    take: CRON_RETRY_BATCH,
    include: { account: true },
  });
}

// ─── Maintenance Helpers ───

/** Refresh ct0 for accounts where lastCt0RefreshAt > 4h ago. */
async function refreshStaleCt0(errors: string[]): Promise<number> {
  const { db } = await import("@/lib/db/db");
  const { refreshAccountCt0 } = await import("@/lib/services/account-service");

  const staleAccounts = await db.account.findMany({
    where: {
      isActive: true,
      OR: [
        { lastCt0RefreshAt: { lt: new Date(Date.now() - CT0_STALE_MS) } },
        { lastCt0RefreshAt: null },
      ],
    },
    select: { id: true, username: true },
  });

  let refreshed = 0;

  for (const account of staleAccounts) {
    try {
      const result = await refreshAccountCt0(account.id);
      if (result.success) {
        refreshed++;
      } else {
        errors.push(`@${account.username}: ${result.error}`);
      }
    } catch (error) {
      errors.push(
        `@${account.username}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return refreshed;
}

/** Sync X-scheduled tweets — check if X has posted them. */
async function syncXScheduledTweets(errors: string[]): Promise<number> {
  const { db } = await import("@/lib/db/db");

  const xScheduledTweets = await db.tweet.findMany({
    where: { status: TWEET_STATUS.X_SCHEDULED },
    include: { account: true },
  });

  let synced = 0;

  for (const tweet of xScheduledTweets) {
    try {
      if (await syncSingleTweet(tweet)) {
        synced++;
      }
    } catch (error) {
      errors.push(
        `Sync ${tweet.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return synced;
}

/** Check if X has posted a scheduled tweet, update DB if so. */
async function syncSingleTweet(tweet: {
  id: string;
  accountId: string;
  scheduledTweetRestId: string | null;
  mediaKey?: string | null;
}): Promise<boolean> {
  if (!tweet.scheduledTweetRestId) return false;

  const { decryptCookies } = await import("@/lib/services/encryption-service");
  const { parseCookieString } = await import("@/lib/twitter/ct0-refresh");
  const { fetchScheduledTweets } = await import(
    "@/lib/twitter/scheduled-tweet"
  );
  const { deleteMedia: b2DeleteMedia } = await import("@/lib/storage/b2");

  const cookies = await decryptCookies(tweet.accountId);
  if (!cookies) return false;
  const parsed = parseCookieString(cookies);
  if (!parsed) return false;

  const result = await fetchScheduledTweets(cookies, parsed.ct0);

  // Check if our scheduled tweet is still in X's list
  const found = result.tweets.some(
    (t) => t.rest_id === tweet.scheduledTweetRestId
  );

  if (!found) {
    // X removed it — means it was posted (or deleted on X's side)
    // Clean up B2 media before transitioning
    if (tweet.mediaKey) {
      await b2DeleteMedia(tweet.mediaKey);
    }

    const transitioned = await transitionTweetStatus(
      tweet.id,
      TWEET_STATUS.X_SCHEDULED,
      TWEET_STATUS.SENT,
      {
        postedAt: new Date(),
        mediaKey: null,
      }
    );

    if (transitioned) {
      await createLog({
        tweetId: tweet.id,
        accountId: tweet.accountId,
        action: "sync",
        detail: "X posted the scheduled tweet (sync detected)",
      });
      return true;
    }
  }

  return false;
}
