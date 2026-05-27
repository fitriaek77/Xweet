// src/lib/services/lock-service.ts
// Distributed posting lock — wraps DB queries with logging.
// Prevents concurrent execution on the same tweet/account.

import {
  acquirePostingLock,
  releasePostingLock,
  findStaleLocks,
  recoverStaleLocks,
} from "@/lib/db/queries/locks";
import { createLog } from "@/lib/db/queries/logs";

/** Acquire posting lock with logging. */
export async function acquireLock(
  tweetId: string,
  executor: string
): Promise<boolean> {
  const acquired = await acquirePostingLock(tweetId, executor);

  if (acquired) {
    await createLog({
      tweetId,
      action: "lock_acquire",
      detail: `Lock acquired by ${executor}`,
    });
  }

  return acquired;
}

/** Release posting lock with logging. */
export async function releaseLock(
  tweetId: string,
  executor: string
): Promise<void> {
  await releasePostingLock(tweetId, executor);

  await createLog({
    tweetId,
    action: "lock_release",
    detail: `Lock released by ${executor}`,
  });
}

/** Find stale locks (tweets stuck in "sending" > threshold). */
export async function getStaleLocks() {
  return findStaleLocks();
}

/** Recover stale locks — reset to "scheduled" for retry. */
export async function recoverLocks(): Promise<number> {
  const count = await recoverStaleLocks();

  if (count > 0) {
    await createLog({
      action: "stale_recovery",
      detail: `Recovered ${count} stale locks`,
    });
  }

  return count;
}
