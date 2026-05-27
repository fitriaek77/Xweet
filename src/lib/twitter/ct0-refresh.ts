// src/lib/twitter/ct0-refresh.ts
// Auto-refresh ct0 (CSRF token) by GET'ing x.com with auth_token.
// ~325ms, no TLS fingerprinting needed.

import { X_BASE_URL } from "@/config/constants";

export interface Ct0Result {
  ct0: string;
  twid: string;
  /** Max-Age of ct0 cookie (negative = expired/invalid). */
  ct0MaxAge: number;
}

/**
 * Refresh ct0 by fetching x.com with the account's auth_token.
 * Returns fresh ct0, twid, and ct0MaxAge for validity checking.
 *
 * Fallback chain:
 *   1. GET x.com → parse Set-Cookie headers
 *   2. If ct0 empty or Max-Age < 0 → auth_token expired (mark inactive)
 *   3. If timeout (>3s) → return null (caller uses last-known ct0)
 */
export async function refreshCt0(
  authToken: string
): Promise<Ct0Result | null> {
  try {
    const resp = await fetch(X_BASE_URL, {
      method: "GET",
      headers: {
        Cookie: `auth_token=${authToken}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "manual", // Don't follow redirects
      signal: AbortSignal.timeout(3000),
    });

    const setCookieHeaders = resp.headers.getSetCookie();
    return parseCt0FromHeaders(setCookieHeaders);
  } catch {
    // Timeout or network error
    return null;
  }
}

/** Parse ct0 and twid from Set-Cookie headers. */
function parseCt0FromHeaders(
  setCookieHeaders: string[]
): Ct0Result | null {
  let ct0 = "";
  let twid = "";
  let ct0MaxAge = 0;

  for (const header of setCookieHeaders) {
    if (header.startsWith("ct0=")) {
      ct0 = header.split(";")[0]?.split("=")[1] ?? "";
      ct0MaxAge = parseMaxAge(header);
    }
    if (header.startsWith("twid=")) {
      twid = header.split(";")[0]?.split("=")[1] ?? "";
    }
  }

  if (!ct0) return null;

  return { ct0, twid, ct0MaxAge };
}

/** Extract Max-Age value from a Set-Cookie header string. */
function parseMaxAge(setCookieHeader: string): number {
  const match = setCookieHeader.match(/Max-Age=(-?\d+)/i);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

/**
 * Extract auth_token and ct0 from a raw cookie string.
 * Returns { authToken, ct0 } or null if missing.
 */
export function parseCookieString(
  rawCookies: string
): { authToken: string; ct0: string; twid: string } | null {
  const cookies = Object.fromEntries(
    rawCookies.split(";").map((c) => {
      const parts = c.trim().split("=");
      const k = parts[0]?.trim() ?? "";
      const v = parts.slice(1).join("=").trim();
      return [k, v];
    })
  );

  const authToken = cookies["auth_token"];
  const ct0 = cookies["ct0"];
  const twid = cookies["twid"];

  if (!authToken || !ct0) return null;

  return { authToken, ct0, twid: twid ?? "" };
}

/**
 * Update ct0 in a raw cookie string with a fresh value.
 */
export function updateCt0InCookieString(
  rawCookies: string,
  newCt0: string,
  newTwid?: string
): string {
  const parts = rawCookies
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean);

  // Replace ct0
  const withoutCt0 = parts.filter(
    (p) => !p.startsWith("ct0=")
  );
  withoutCt0.push(`ct0=${newCt0}`);

  // Replace twid if provided
  if (newTwid) {
    const withoutTwid = withoutCt0.filter(
      (p) => !p.startsWith("twid=")
    );
    withoutTwid.push(`twid=${newTwid}`);
    return withoutTwid.join("; ");
  }

  return withoutCt0.join("; ");
}
