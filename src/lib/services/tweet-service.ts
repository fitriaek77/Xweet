// src/lib/services/tweet-service.ts
// Tweet lifecycle: create, schedule, publish, cancel.
// Orchestrates scheduling decision tree, posting, and status transitions.
// Media is stored in Backblaze B2 (S3-compatible), not in PostgreSQL.

import {
  createTweet,
  getTweetById,
  getTweets,
  updateTweet,
  deleteTweet,
  transitionTweetStatus,
  countXScheduledForAccount,
} from "@/lib/db/queries/tweets";
import {
  acquirePostingLock,
  releasePostingLock,
} from "@/lib/db/queries/locks";
import { createLog } from "@/lib/db/queries/logs";
import { decryptCookies } from "@/lib/services/encryption-service";
import { parseCookieString, refreshCt0, updateCt0InCookieString } from "@/lib/twitter/ct0-refresh";
import { createTweet as xCreateTweet } from "@/lib/twitter/post-tweet";
import {
  createScheduledTweet,
  deleteScheduledTweet,
} from "@/lib/twitter/scheduled-tweet";
import { uploadMedia as xUploadMedia, getMediaCategory } from "@/lib/twitter/media-upload";
import {
  recordSuccess,
  recordFailure,
  getCircuitState,
} from "@/lib/twitter/circuit-breaker";
import {
  uploadMedia as b2UploadMedia,
  downloadMedia as b2DownloadMedia,
  deleteMedia as b2DeleteMedia,
  generateMediaKey,
} from "@/lib/storage/b2";
import { TWEET_STATUS, MAX_X_SCHEDULED_PER_ACCOUNT, type TweetStatus } from "@/config/constants";
import {
  NotFoundError,
  ValidationError,
  CircuitOpenError,
  AppError,
} from "@/lib/api/errors";
import { withRetry } from "@/lib/utils/retry";
import { isTransientError, classifyError } from "@/lib/utils/error-classifier";

/** Helper: decrypt cookies and parse them, or throw. */
async function getDecryptedAndParsed(accountId: string) {
  const cookies = await decryptCookies(accountId);
  if (!cookies) throw new NotFoundError("Account cookies", accountId);
  const parsed = parseCookieString(cookies);
  if (!parsed) throw new ValidationError("Cannot parse account cookies");
  return { cookies, ct0: parsed.ct0, authToken: parsed.authToken, twid: parsed.twid };
}

// ─── Create Tweet ───

/** Create a new tweet and schedule it. */
export async function scheduleNewTweet(data: {
  accountId: string;
  content: string;
  scheduledAt: Date;
  mediaData?: Buffer | undefined;
  mediaMimeType?: string | undefined;
}) {
  const { accountId, content, scheduledAt, mediaData, mediaMimeType } = data;

  // Check circuit breaker
  const circuit = await getCircuitState(accountId);
  if (circuit.isOpen) {
    throw new CircuitOpenError(accountId, circuit.cooldownUntil ?? new Date());
  }

  // Determine media category
  const mediaCategory = mediaMimeType
    ? getMediaCategory(mediaMimeType)
    : undefined;

  // Upload media to B2 if present (instead of storing raw bytes in DB)
  let mediaKey: string | undefined;
  if (mediaData && mediaMimeType) {
    // Create a placeholder tweet ID first to use in the B2 key
    const placeholderId = crypto.randomUUID();
    mediaKey = generateMediaKey(placeholderId, mediaMimeType);
    await b2UploadMedia(mediaKey, mediaData, mediaMimeType);
  }

  // Create tweet in DB (no raw bytes — just the B2 object key)
  const tweet = await createTweet({
    accountId,
    content,
    scheduledAt,
    ...(mediaKey !== undefined && { mediaKey }),
    ...(mediaMimeType !== undefined && { mediaMimeType }),
    ...(mediaCategory !== undefined && { mediaCategory }),
  });

  // If we used a placeholder ID in the key, we could rename the B2 object
  // to use the real tweet ID. However, this adds complexity and an extra API call.
  // The random suffix makes the key unique regardless, so we keep it as-is.

  await createLog({
    tweetId: tweet.id,
    accountId,
    action: "create",
    detail: `Tweet created, scheduled for ${scheduledAt.toISOString()}` +
      (mediaKey ? ` with media (${mediaKey})` : ""),
  });

  // Attempt to schedule via X (Layer 1) — fire-and-forget so the API
  // responds quickly. The tweet stays "scheduled" if X scheduling fails,
  // and the cron tick will retry it later.
  // Timeout after 15s to prevent the background task from hanging the server.
  // NOTE: .catch() must be attached immediately to prevent unhandled rejection
  // killing the process when background X-scheduling fails (e.g. fake cookies).
  const xSchedulePromise = attemptXScheduling(tweet.id, accountId).catch(() => {
    // Already logged inside attemptXScheduling — suppress unhandled rejection
  });
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => { resolve(); }, 15_000);
  });
  Promise.race([xSchedulePromise, timeoutPromise]).catch(() => {
    // Suppress any remaining unhandled rejection
  });

  return getTweetById(tweet.id);
}

/** Try to schedule tweet via X CreateScheduledTweet (Layer 1). */
async function attemptXScheduling(
  tweetId: string,
  accountId: string
): Promise<void> {
  try {
    // Check if account has room for more X-scheduled tweets
    const xScheduledCount = await countXScheduledForAccount(accountId);
    if (xScheduledCount >= MAX_X_SCHEDULED_PER_ACCOUNT) {
      await createLog({
        tweetId,
        accountId,
        action: "x_schedule",
        detail: `Overflow: ${xScheduledCount}/${MAX_X_SCHEDULED_PER_ACCOUNT} X-scheduled tweets`,
      });
      return; // Will be picked up by cron tick
    }

    let { cookies, ct0 } = await getDecryptedAndParsed(accountId);
    const tweet = await getTweetById(tweetId);

    // Proactive ct0 refresh (same reason as publishTweet)
    try {
      const freshCt0 = await refreshCt0(cookies.match(/auth_token=([^;]+)/)?.[1] ?? "");
      if (freshCt0 && freshCt0.ct0MaxAge > 0) {
        ct0 = freshCt0.ct0;
        cookies = updateCt0InCookieString(cookies, freshCt0.ct0, freshCt0.twid);
        const { encryptAndStoreCookies } = await import("@/lib/services/encryption-service");
        await encryptAndStoreCookies(accountId, cookies);
      }
    } catch {
      // Best-effort — proceed with existing ct0
    }

    // Upload media to X if needed (download from B2 first)
    let mediaIds: string[] | undefined;
    if (tweet.mediaKey && tweet.mediaMimeType) {
      // Download from B2
      const mediaBuffer = await b2DownloadMedia(tweet.mediaKey);

      const uploadResult = await xUploadMedia({
        cookies,
        ct0,
        mediaData: mediaBuffer,
        mimeType: tweet.mediaMimeType,
        mediaCategory: tweet.mediaCategory ?? getMediaCategory(tweet.mediaMimeType),
      });

      await updateTweet(tweetId, {
        mediaId: uploadResult.mediaId,
      });

      mediaIds = [uploadResult.mediaId];
    }

    // Call CreateScheduledTweet
    const executeAt = Math.floor(tweet.scheduledAt.getTime() / 1000);
    const result = await createScheduledTweet({
      cookies,
      ct0,
      text: tweet.content,
      executeAt,
      mediaIds,
    });

    // Update DB: scheduled → x_scheduled
    const transitioned = await transitionTweetStatus(
      tweetId,
      TWEET_STATUS.SCHEDULED,
      TWEET_STATUS.X_SCHEDULED,
      { scheduledTweetRestId: result.restId }
    );

    if (transitioned) {
      await createLog({
        tweetId,
        accountId,
        action: "x_schedule",
        detail: `X-scheduled with rest_id ${result.restId}`,
      });

      if (result.updatedCookies) {
        const { encryptAndStoreCookies } = await import(
          "@/lib/services/encryption-service"
        );
        await encryptAndStoreCookies(accountId, result.updatedCookies);
      }
    }
  } catch (error) {
    await createLog({
      tweetId,
      accountId,
      action: "x_schedule",
      detail: `X-scheduling failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    // Don't throw — tweet stays "scheduled" for cron tick
  }
}

// ─── Publish Tweet (immediate) ───

/** Publish a tweet immediately via CreateTweet. */
export async function publishTweet(
  tweetId: string,
  executor: "cron" | "manual"
): Promise<{ success: boolean; tweetId: string; error?: string }> {
  const tweet = await getTweetById(tweetId);

  // Check circuit breaker
  const circuit = await getCircuitState(tweet.accountId);
  if (circuit.isOpen) {
    return {
      success: false,
      tweetId: tweet.id,
      error: `Circuit open until ${circuit.cooldownUntil?.toISOString()}`,
    };
  }

  // Acquire posting lock
  const locked = await acquirePostingLock(tweetId, executor);
  if (!locked) {
    return {
      success: false,
      tweetId: tweet.id,
      error: "Tweet is already being processed",
    };
  }

  // Transition to "sending"
  const transitioned = await transitionTweetStatus(
    tweetId,
    TWEET_STATUS.SCHEDULED,
    TWEET_STATUS.SENDING
  );

  if (!transitioned) {
    await releasePostingLock(tweetId, executor);
    return {
      success: false,
      tweetId: tweet.id,
      error: "Status transition failed — may already be sending",
    };
  }

  try {
    let { cookies, ct0 } = await getDecryptedAndParsed(tweet.accountId);

    // Proactive ct0 refresh — X returns 200 with empty tweet_results when ct0 is stale
    // instead of a proper 401/403, so we can't rely on xFetch auto-refresh alone.
    try {
      const freshCt0 = await refreshCt0(cookies.match(/auth_token=([^;]+)/)?.[1] ?? "");
      if (freshCt0 && freshCt0.ct0MaxAge > 0) {
        ct0 = freshCt0.ct0;
        cookies = updateCt0InCookieString(cookies, freshCt0.ct0, freshCt0.twid);
        // Persist fresh cookies for next time
        const { encryptAndStoreCookies } = await import("@/lib/services/encryption-service");
        await encryptAndStoreCookies(tweet.accountId, cookies);
      }
    } catch {
      // Best-effort — proceed with existing ct0
    }

    // Upload media to X if needed (download from B2 first)
    let mediaIds: string[] | undefined;
    if (tweet.mediaKey && tweet.mediaMimeType) {
      // Download from B2
      const mediaBuffer = await b2DownloadMedia(tweet.mediaKey);

      const uploadResult = await withRetry(
        () =>
          xUploadMedia({
            cookies,
            ct0,
            mediaData: mediaBuffer,
            mimeType: tweet.mediaMimeType ?? "image/png",
            mediaCategory:
              tweet.mediaCategory ?? getMediaCategory(tweet.mediaMimeType ?? "image/png"),
          }),
        { maxAttempts: 2, shouldRetry: isTransientError }
      );

      await updateTweet(tweetId, {
        mediaId: uploadResult.mediaId,
      });

      mediaIds = [uploadResult.mediaId];
    }

    // Post tweet
    const result = await withRetry(
      () =>
        xCreateTweet({
          cookies,
          ct0,
          text: tweet.content,
          mediaIds,
        }),
      { maxAttempts: 2, shouldRetry: isTransientError }
    );

    // Success → transition to "sent" and clean up B2 media
    const b2Key = tweet.mediaKey;
    await transitionTweetStatus(tweetId, TWEET_STATUS.SENDING, TWEET_STATUS.SENT, {
      postedAt: new Date(),
      tweetId: result.tweetId,
      mediaKey: null, // Clear B2 key — media no longer needed
    });

    // Delete media from B2 (best-effort)
    if (b2Key) {
      await b2DeleteMedia(b2Key);
    }

    await recordSuccess(tweet.accountId);
    await releasePostingLock(tweetId, executor);

    await createLog({
      tweetId: tweet.id,
      accountId: tweet.accountId,
      action: "post_success",
      detail: `Posted as X tweet ${result.tweetId}`,
    });

    if (result.updatedCookies) {
      const { encryptAndStoreCookies } = await import(
        "@/lib/services/encryption-service"
      );
      await encryptAndStoreCookies(tweet.accountId, result.updatedCookies);
    }

    return { success: true, tweetId: result.tweetId };
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    const errorClass = classifyError(message);

    // Phantom success recovery: error 187 means the tweet IS on X already
    if (errorClass === 'duplicate_posted') {
      await transitionTweetStatus(tweetId, TWEET_STATUS.SENDING, TWEET_STATUS.SENT, {
        postedAt: new Date(),
      });
      await recordSuccess(tweet.accountId);
      await releasePostingLock(tweetId, executor);
      await createLog({
        tweetId: tweet.id,
        accountId: tweet.accountId,
        action: "post_success",
        detail: "Phantom success recovered (error 187 — duplicate already posted)",
      });
      return { success: true, tweetId: 'recovered-duplicate' };
    }

    // Increment retry count
    const currentRetryCount = tweet.retryCount;
    await transitionTweetStatus(tweetId, TWEET_STATUS.SENDING, TWEET_STATUS.FAILED, {
      failureReason: message,
      retryCount: currentRetryCount + 1,
    });

    const circuitResult = await recordFailure(tweet.accountId, errorClass);
    await releasePostingLock(tweetId, executor);

    await createLog({
      tweetId: tweet.id,
      accountId: tweet.accountId,
      action: "post_failure",
      detail: message,
    });

    return {
      success: false,
      tweetId: tweet.id,
      error: circuitResult.isOpen
        ? `Circuit opened: ${message}`
        : message,
    };
  }
}

// ─── Cancel Tweet ───

/** Cancel a scheduled tweet. Also removes from X if X-scheduled. */
export async function cancelTweet(tweetId: string): Promise<void> {
  const tweet = await getTweetById(tweetId);

  // If X-scheduled, delete from X first
  if (tweet.status === TWEET_STATUS.X_SCHEDULED && tweet.scheduledTweetRestId) {
    try {
      const { cookies, ct0 } = await getDecryptedAndParsed(tweet.accountId);
      await deleteScheduledTweet(
        cookies,
        ct0,
        tweet.scheduledTweetRestId
      );
    } catch {
      // Best effort — still cancel in DB even if X delete fails
    }
  }

  // Delete media from B2 (best-effort)
  if (tweet.mediaKey) {
    await b2DeleteMedia(tweet.mediaKey);
  }

  // Transition current status to cancelled
  const fromStatus = tweet.status as TweetStatus;
  await transitionTweetStatus(tweetId, fromStatus, TWEET_STATUS.CANCELLED, {
    mediaKey: null, // Clear B2 key
  });

  await createLog({
    tweetId,
    accountId: tweet.accountId,
    action: "cancel",
    detail: "Tweet cancelled" +
      (tweet.mediaKey ? ` (B2 media deleted: ${tweet.mediaKey})` : ""),
  });
}

// ─── List / Get ───

/** List tweets with optional filters. */
export async function listTweets(filters?: {
  accountId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  return getTweets(filters as Parameters<typeof getTweets>[0]);
}

/** Get a single tweet by ID. */
export async function getTweet(id: string) {
  return getTweetById(id);
}

/** Remove a tweet from DB (only if not sending). Also cleans up B2 media. */
export async function removeTweet(id: string) {
  const tweet = await getTweetById(id);

  // Delete media from B2 (best-effort)
  if (tweet.mediaKey) {
    await b2DeleteMedia(tweet.mediaKey);
  }

  return deleteTweet(id);
}
