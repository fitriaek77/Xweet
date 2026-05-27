// src/lib/twitter/transaction-id.ts
// Transaction ID (TID) generation for X API anti-bot detection.
// Rewritten using twt's proven pattern — produces ~94-char TIDs.
//
// Layer 1 (primary): pair-dict (zero x.com fetches, ~94-char)
// Layer 2 (fallback): live SVG (~500ms, ~94-char)
// Layer 3 (graceful): null — caller handles missing TID

import { generateFromPair, clearPairCache } from "@/lib/twitter/transaction-id-pair";
import { generateFromLiveSvg, clearHtmlCache } from "@/lib/twitter/transaction-id-html";

/**
 * Generate an x-client-transaction-id for X API requests.
 * Fallback chain: pair-dict → live-SVG → null (caller handles).
 *
 * Returns null if both layers fail — media upload works without TID;
 * CreateTweet fails without TID → triggers scheduling fallback.
 */
export async function generateTransactionId(
  method: string,
  path: string,
): Promise<string | null> {
  // Layer 1: pair-dict (zero x.com fetches, ~94-char)
  const pairId = await generateFromPair(method, path);
  if (pairId) {
    if (pairId.length < 90) {
    process.stderr.write(
      `[TID] pair-dict TID suspiciously short: ${pairId.length} chars\n`,
    );
    }
    return pairId;
  }

  // Layer 2: live SVG (~500ms, ~94-char)
  try {
    const svgId = await generateFromLiveSvg(method, path);
    if (svgId) {
      if (svgId.length < 90) {
    process.stderr.write(
      `[TID] live-SVG TID suspiciously short: ${svgId.length} chars\n`,
    );
      }
      return svgId;
    }
  } catch (e) {
    process.stderr.write(`[TID] live SVG failed: ${String(e)}\n`);
  }

  // Layer 3: skip TID (graceful degradation)
  process.stderr.write("[TID] all methods failed — proceeding without TID\n");
  return null;
}

/** Force-clear all TID caches. */
export function clearTidCache(): void {
  clearPairCache();
  clearHtmlCache();
}
