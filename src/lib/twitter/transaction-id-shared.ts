// src/lib/twitter/transaction-id-shared.ts
// Core `buildTransactionId()` algorithm from twt.
// Produces ~94-char TIDs using SHA-256 + XOR + Base64.

import { createHash, randomInt } from "node:crypto";

/** Epoch offset: 2023-05-01 00:00:00 UTC in milliseconds. */
export const EPOCH_OFFSET_MS = 1682924400 * 1000;

/** X transaction constants used in hash input. */
export const X_TX_CONSTANTS = {
  keyword: "obfiowerehiring",
  additionalRandom: 3,
} as const;

/**
 * Build a transaction ID from the given parameters.
 *
 * This is the core algorithm that produces ~94-char TIDs matching
 * X's expected format. It combines:
 *   - keyBytes: decoded from verification base64 (from pair.json or live HTML)
 *   - animationKey: hex string (from pair.json or computed from SVG)
 *   - current time (relative to EPOCH_OFFSET_MS)
 *   - method and path for request binding
 *   - SHA-256 hash for integrity
 *   - random XOR mask for uniqueness
 *
 * IMPORTANT: Uses `crypto.createHash` and `crypto.randomInt` — Node.js only.
 * All route handlers using TID must use `export const runtime = 'nodejs'` (the default).
 */
export function buildTransactionId(
  method: string,
  path: string,
  keyBytes: number[],
  animationKey: string,
): string {
  const timeNow = Math.floor((Date.now() - EPOCH_OFFSET_MS) / 1000);
  const timeNowBytes = [
    timeNow & 0xff,
    (timeNow >> 8) & 0xff,
    (timeNow >> 16) & 0xff,
    (timeNow >> 24) & 0xff,
  ];

  const data = `${method}!${path}!${timeNow}${X_TX_CONSTANTS.keyword}${animationKey}`;
  const hashBytes = Array.from(
    createHash("sha256").update(data).digest(),
  ).slice(0, 16);

  const randomNum = randomInt(256);

  const bytesArr = [
    ...keyBytes,
    ...timeNowBytes,
    ...hashBytes,
    X_TX_CONSTANTS.additionalRandom,
  ];
  const out = Buffer.from([
    randomNum,
    ...bytesArr.map((item) => item ^ randomNum),
  ]);

  return out.toString("base64").replace(/=/g, "");
}
