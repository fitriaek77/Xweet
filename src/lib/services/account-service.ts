// src/lib/services/account-service.ts
// Account management: CRUD, cookie handling, verification, ct0 refresh.
// Orchestrates encryption-service, ct0-refresh, circuit-breaker.

import {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
} from "@/lib/db/queries/accounts";
import {
  encryptAndStoreCookies,
  decryptCookies,
} from "@/lib/services/encryption-service";
import { refreshCt0, parseCookieString } from "@/lib/twitter/ct0-refresh";
import {
  getCircuitState,
  recordSuccess,
  recordFailure,
  closeCircuit,
} from "@/lib/twitter/circuit-breaker";
import { createLog } from "@/lib/db/queries/logs";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { encrypt } from "@/lib/utils/crypto";

// ─── CRUD ───

/** List all active accounts (no encrypted cookies exposed). */
export async function listAccounts() {
  return getAccounts();
}

/** Get a single account by ID (includes encrypted cookies). */
export async function getAccount(id: string) {
  return getAccountById(id);
}

/** Add a new X account with raw cookies (encrypted immediately at write time). */
export async function addAccount(data: {
  username: string;
  cookies: string;
  displayName?: string | undefined;
}) {
  const { username, cookies: rawCookies, displayName } = data;

  // Parse cookies to extract auth_token and ct0
  const parsed = parseCookieString(rawCookies);
  if (!parsed) {
    throw new ValidationError(
      "Invalid cookie format — must contain auth_token and ct0"
    );
  }

  // Encrypt immediately at write time — no {PLAINTEXT} prefix
  const encrypted = encrypt(rawCookies);
  const account = await createAccount({
    username,
    encryptedCookies: encrypted,
    ...(displayName !== undefined && { displayName }),
  });

  await createLog({
    accountId: account.id,
    action: "create",
    detail: `Account @${username} added`,
  });

  return account;
}

/** Update an account (display name, cookies, or active status). */
export async function modifyAccount(
  id: string,
  data: { displayName?: string | undefined; cookies?: string | undefined; isActive?: boolean | undefined }
) {
  const { displayName, cookies: rawCookies, isActive } = data;

  if (rawCookies) {
    const parsed = parseCookieString(rawCookies);
    if (!parsed) {
      throw new ValidationError(
        "Invalid cookie format — must contain auth_token and ct0"
      );
    }
    await encryptAndStoreCookies(id, rawCookies);
  }

  const updateData: Record<string, unknown> = {};
  if (displayName !== undefined) updateData.displayName = displayName;
  if (isActive !== undefined) updateData.isActive = isActive;

  return updateAccount(id, updateData);
}

/** Remove an account and all its tweets. */
export async function removeAccount(id: string) {
  // Clean up X-scheduled drafts and B2 media before cascade-deleting
  const { db } = await import("@/lib/db/db");
  const tweets = await db.tweet.findMany({
    where: { accountId: id },
    select: {
      id: true,
      status: true,
      scheduledTweetRestId: true,
      mediaKey: true,
    },
  });

  // Cancel X-scheduled drafts
  for (const tweet of tweets) {
    if (tweet.status === "x_scheduled" && tweet.scheduledTweetRestId) {
      try {
        const cookies = await decryptCookies(id);
        if (cookies) {
          const parsed = parseCookieString(cookies);
          if (parsed) {
            const { deleteScheduledTweet } = await import("@/lib/twitter/scheduled-tweet");
            await deleteScheduledTweet(cookies, parsed.ct0, tweet.scheduledTweetRestId);
          }
        }
      } catch {
        // Best-effort — proceed with deletion
      }
    }

    // Delete B2 media
    if (tweet.mediaKey) {
      try {
        const { deleteMedia: b2DeleteMedia } = await import("@/lib/storage/b2");
        await b2DeleteMedia(tweet.mediaKey);
      } catch {
        // Best-effort
      }
    }
  }

  await deleteAccount(id);

  await createLog({
    accountId: id,
    action: "delete",
    detail: "Account removed",
  });
}

// ─── Cookie / Verification ───

/** Get decrypted cookies for an account. */
export async function getDecryptedCookies(accountId: string): Promise<string> {
  const cookies = await decryptCookies(accountId);
  if (!cookies) {
    throw new NotFoundError("Account", accountId);
  }
  return cookies;
}

/** Verify an account's cookies by attempting ct0 refresh. */
export async function verifyAccount(accountId: string): Promise<{
  valid: boolean;
  ct0?: string;
  twid?: string;
  error?: string;
}> {
  const cookies = await getDecryptedCookies(accountId);
  const parsed = parseCookieString(cookies);

  if (!parsed) {
    return { valid: false, error: "Cannot parse cookies" };
  }

  const result = await refreshCt0(parsed.authToken);

  if (!result) {
    await recordFailure(accountId);
    return { valid: false, error: "ct0 refresh failed (timeout or network)" };
  }

  if (result.ct0MaxAge < 0) {
    await recordFailure(accountId);
    return {
      valid: false,
      error: "auth_token expired (ct0 Max-Age < 0) — re-paste cookies",
    };
  }

  // Valid — update cookies with fresh ct0
  const { updateCt0InCookieString } = await import("@/lib/twitter/ct0-refresh");
  const updatedCookies = updateCt0InCookieString(cookies, result.ct0, result.twid);
  await encryptAndStoreCookies(accountId, updatedCookies);
  await recordSuccess(accountId);

  return {
    valid: true,
    ct0: result.ct0,
    twid: result.twid,
  };
}

/** Refresh ct0 for a single account. */
export async function refreshAccountCt0(accountId: string): Promise<{
  success: boolean;
  ct0?: string;
  error?: string;
}> {
  const verifyResult = await verifyAccount(accountId);

  if (verifyResult.valid) {
    await createLog({
      accountId,
      action: "ct0_refresh",
      detail: "ct0 refreshed successfully",
    });
    return {
      success: true,
      ...(verifyResult.ct0 !== undefined && { ct0: verifyResult.ct0 }),
    };
  }

  await createLog({
    accountId,
    action: "ct0_refresh",
    detail: `ct0 refresh failed: ${verifyResult.error}`,
  });

  return {
    success: false,
    ...(verifyResult.error !== undefined && { error: verifyResult.error }),
  };
}

// ─── Circuit Breaker ───

/** Get circuit state for an account. */
export async function getAccountCircuitState(accountId: string) {
  return getCircuitState(accountId);
}

/** Manually close circuit (admin action). */
export async function resetCircuit(accountId: string) {
  await closeCircuit(accountId);

  await createLog({
    accountId,
    action: "lock_release",
    detail: "Circuit manually closed by admin",
  });
}
