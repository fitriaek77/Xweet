// src/lib/utils/crypto.ts
// AES-256-GCM encryption helpers for cookie storage.
// Key derived from ENCRYPTION_KEY env var via PBKDF2.

import crypto from "node:crypto";
import { AES_ALGORITHM, KEY_LENGTH, IV_LENGTH, AUTH_TAG_LENGTH } from "@/config/constants";

let _key: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_key) return _key;

  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error("ENCRYPTION_KEY env var is required for encryption");
  }

  _key = Buffer.from(hexKey, "hex");
  if (_key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars)`);
  }
  return _key;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns: iv:authTag:ciphertext (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Input format: iv:authTag:ciphertext (all hex-encoded).
 */
export function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const parts = encoded.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format — expected iv:authTag:ciphertext");
  }

  const ivHex = parts[0];
  const authTagHex = parts[1];
  const ciphertextHex = parts[2];
  if (!ivHex || !authTagHex || ciphertextHex === undefined) {
    throw new Error("Invalid encrypted format — empty parts");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: ${iv.length}, expected ${IV_LENGTH}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: ${authTag.length}, expected ${AUTH_TAG_LENGTH}`);
  }

  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check if a value is encrypted (has iv:authTag:ciphertext format).
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}
