// src/lib/services/encryption-service.ts
// High-level encryption service for X cookie storage.
// Cookies are always encrypted at write time — no {PLAINTEXT} migration.

import { encrypt, decrypt, isEncrypted } from "@/lib/utils/crypto";
import { db } from "@/lib/db/db";

/**
 * Encrypt and store cookies for an account.
 * Always encrypts immediately — no {PLAINTEXT} prefix.
 */
export async function encryptAndStoreCookies(
  accountId: string,
  rawCookies: string
): Promise<void> {
  const encrypted = encrypt(rawCookies);

  await db.account.update({
    where: { id: accountId },
    data: {
      encryptedCookies: encrypted,
      cookieUpdatedAt: new Date(),
    },
  });
}

/**
 * Decrypt and retrieve cookies for an account.
 * Only handles properly encrypted values (iv:authTag:ciphertext format).
 * Throws if the value is not encrypted — plaintext storage is no longer supported.
 */
export async function decryptCookies(
  accountId: string
): Promise<string | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { encryptedCookies: true },
  });

  if (!account) return null;

  const value = account.encryptedCookies;

  // Encrypted (iv:authTag:ciphertext format) — decrypt
  if (isEncrypted(value)) {
    return decrypt(value);
  }

  // Not encrypted — this is an error. Plaintext storage is no longer supported.
  throw new Error(
    `[encryption] Account ${accountId} has unencrypted cookies — this should never happen. ` +
    `Cookies must be encrypted at write time.`
  );
}
