// src/lib/api/rate-limit.ts
// Simple in-memory rate limiter for login endpoint.
// Tracks attempts per IP, blocks after 5 failed attempts for 15 minutes.

interface RateLimitEntry {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Clean up every minute

// Periodic cleanup
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.firstAttemptAt > WINDOW_MS) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const entry = store.get(ip);
  const now = Date.now();

  if (!entry) return { allowed: true, retryAfterMs: 0 };

  // Lockout period active
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now };
  }

  // Window expired — reset
  if (now - entry.firstAttemptAt > WINDOW_MS) {
    store.delete(ip);
    return { allowed: true, retryAfterMs: 0 };
  }

  // Over limit
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + WINDOW_MS;
    return { allowed: false, retryAfterMs: WINDOW_MS };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export function recordFailedAttempt(ip: string): void {
  const entry = store.get(ip);
  const now = Date.now();

  if (!entry || now - entry.firstAttemptAt > WINDOW_MS) {
    store.set(ip, { count: 1, firstAttemptAt: now, lockedUntil: 0 });
  } else {
    entry.count++;
  }
}

export function resetRateLimit(ip: string): void {
  store.delete(ip);
}
