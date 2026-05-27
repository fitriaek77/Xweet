// src/lib/auth/session.ts
// Session management — single admin, HTTP-only cookie.

import crypto from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_ENCODING = "hex" as const;

/**
 * Generate a cryptographically random session token.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString(TOKEN_ENCODING);
}

/**
 * Hash a session token for storage.
 * We store only the hash — if DB leaks, tokens aren't exposed.
 */
export async function hashToken(token: string): Promise<string> {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Verify a plain-text password against a bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.compare(password, hash);
}

/**
 * Hash a password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(password, 12);
}
