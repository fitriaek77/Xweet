// src/lib/twitter/transaction-id-pair.ts
// Pair-dict primary method for TID generation.
// Fetches pair.json from GitHub CDN (fa0311's x-client-transaction-id-pair-dict repo).

import { randomInt } from "node:crypto";
import {
  FA0311_RAW_BASE,
  FA0311_JSDELIVR_BASE,
  PAIR_DICT_CACHE_MS,
} from "@/config/constants";
import { buildTransactionId } from "@/lib/twitter/transaction-id-shared";

// ─── Types ───

interface PairEntry {
  /** Base64-encoded verification bytes from pair.json */
  verification: string;
  /** Hex-encoded animation key from pair.json */
  animationKey: string;
}

// ─── Cache ───

let cachedPairs: PairEntry[] | null = null;
let cachedPairsAt = 0;

// ─── CDN paths ───

const GITHUB_PATH = "x-client-transaction-id-pair-dict/main/pair.json";
const JSDELIVR_PATH = "x-client-transaction-id-pair-dict@main/pair.json";

// ─── Fetch ───

/** Fetch pair.json from fa0311 CDN with jsDelivr fallback. */
async function fetchPairJson(): Promise<PairEntry[] | null> {
  // Try GitHub raw first
  try {
    const githubUrl = `${FA0311_RAW_BASE}/${GITHUB_PATH}`;
    const resp = await fetch(githubUrl, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const pairs = (await resp.json()) as PairEntry[];
      if (Array.isArray(pairs) && pairs.length > 0) return pairs;
    }
  } catch {
    // GitHub unavailable — try jsDelivr
  }

  // Fallback to jsDelivr mirror
  try {
    const jsdelivrUrl = `${FA0311_JSDELIVR_BASE}/${JSDELIVR_PATH}`;
    const resp = await fetch(jsdelivrUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const pairs = (await resp.json()) as PairEntry[];
      if (Array.isArray(pairs) && pairs.length > 0) return pairs;
    }
  } catch {
    // jsDelivr also unavailable
  }

  return null;
}

// ─── Public ───

/**
 * Generate a TID via the pair-dict method.
 * Zero x.com fetches — uses pre-computed pairs from fa0311's CDN.
 * Produces ~94-char TIDs.
 */
export async function generateFromPair(
  method: string,
  path: string,
): Promise<string | null> {
  // Refresh cache if stale
  if (!cachedPairs || Date.now() - cachedPairsAt >= PAIR_DICT_CACHE_MS) {
    try {
      const pairs = await fetchPairJson();
      if (pairs) {
        // Drastic-change guard: if new count < 50% of cached count, keep old cache
        if (cachedPairs && pairs.length < cachedPairs.length * 0.5) {
          process.stderr.write(
            `[TID] pair-dict drastic change: ${pairs.length} new vs ${cachedPairs.length} cached — keeping cache\n`,
          );
        } else {
          cachedPairs = pairs;
          cachedPairsAt = Date.now();
        }
      }
    } catch {
      // CDN unavailable — try stale cache
    }
  }

  if (!cachedPairs || cachedPairs.length === 0) return null;

  // Crypto-secure random selection
  const pair = cachedPairs[randomInt(cachedPairs.length)];
  if (!pair) return null;

  // Decode verification base64 → keyBytes
  const keyBytes = Array.from(Buffer.from(pair.verification, "base64"));

  return buildTransactionId(method, path, keyBytes, pair.animationKey);
}

/** Clear the pair-dict cache. */
export function clearPairCache(): void {
  cachedPairs = null;
  cachedPairsAt = 0;
}
