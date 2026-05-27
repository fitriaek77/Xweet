// src/lib/twitter/headers.ts
// Fetches and caches Chrome header profile from fa0311/latest-user-agent.
// Daily refresh with jsDelivr CDN fallback.
// Uses "chrome-fetch" profile — designed for fetch() API calls.

import {
  FA0311_RAW_BASE,
  FA0311_JSDELIVR_BASE,
  HEADERS_CACHE_MS,
} from "@/config/constants";

/** Chrome header profile (lowercase keys from header.json). */
export type HeaderProfile = Record<string, string>;

/** Full header.json structure: { profileName: { key: value, ... } } */
type HeaderJson = Record<string, HeaderProfile>;

let cachedHeaders: HeaderProfile | null = null;
let cachedAt = 0;

const GITHUB_PATH = "latest-user-agent/main/header.json";
const JSDELIVR_PATH = "latest-user-agent@main/header.json";

/** Headers to strip from the profile (testing artifacts + compression). */
const REMOVE_KEYS = new Set(["host", "connection", "accept-encoding"]);

/** Fetch header.json from fa0311 GitHub CDN, fallback to jsDelivr. */
async function fetchHeaderJson(): Promise<HeaderProfile | null> {
  const githubUrl = `${FA0311_RAW_BASE}/${GITHUB_PATH}`;
  const resp = await fetch(githubUrl, { signal: AbortSignal.timeout(5000) });

  if (resp.ok) {
    const data = (await resp.json()) as HeaderJson;
    return extractProfile(data);
  }

  // Fallback: jsDelivr mirror
  const jsdelivrUrl = `${FA0311_JSDELIVR_BASE}/${JSDELIVR_PATH}`;
  const fallbackResp = await fetch(jsdelivrUrl, {
    signal: AbortSignal.timeout(5000),
  });

  if (fallbackResp.ok) {
    const data = (await fallbackResp.json()) as HeaderJson;
    return extractProfile(data);
  }

  return null;
}

/** Extract chrome-fetch profile and clean it up. */
function extractProfile(data: HeaderJson): HeaderProfile | null {
  // Try chrome-fetch first (designed for fetch() calls)
  const profile = data["chrome-fetch"] ?? data["chrome"] ?? null;
  if (!profile) return null;

  return Object.fromEntries(
    Object.entries(profile)
      .filter(([key]) => !REMOVE_KEYS.has(key))
      .map(([key, value]) => [key, key === "referer" ? "https://x.com/" : value])
  );
}

/** Hardcoded Chrome UA fallback. */
const HARDCODED_HEADERS: HeaderProfile = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="137", "Google Chrome";v="137", "Not/A)Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "accept": "*/*",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "priority": "u=1, i",
};

/**
 * Get the cached Chrome header profile.
 * Refreshes daily (HEADERS_CACHE_MS). Falls back gracefully:
 *   1. Cached profile (if still fresh)
 *   2. Fetch from fa0311 GitHub CDN
 *   3. Fetch from jsDelivr mirror
 *   4. Stale cache
 *   5. Hardcoded Chrome UA
 */
export async function getHeaders(): Promise<HeaderProfile> {
  // Return cached if fresh
  if (cachedHeaders && Date.now() - cachedAt < HEADERS_CACHE_MS) {
    return cachedHeaders;
  }

  try {
    const fresh = await fetchHeaderJson();
    if (fresh) {
      cachedHeaders = fresh;
      cachedAt = Date.now();
      return fresh;
    }
  } catch {
    // Network error — fall through
  }

  // Stale cache is better than nothing
  if (cachedHeaders) {
    return cachedHeaders;
  }

  // Last resort: hardcoded
  return HARDCODED_HEADERS;
}

/** Force-clear the cache (e.g., on header-related errors). */
export function clearHeaderCache(): void {
  cachedHeaders = null;
  cachedAt = 0;
}
