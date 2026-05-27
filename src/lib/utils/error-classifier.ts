// src/lib/utils/error-classifier.ts
// Table-driven 7-class error taxonomy for X API errors.

import { TwitterApiError } from "@/lib/api/errors";

export type ErrorClass =
  | 'stale_cache'      // Clear caches → retry once
  | 'transient'        // Jittered retry up to 3x
  | 'auth_failure'     // ct0 refresh → retry once
  | 'rate_limit'       // Wait + circuit breaker
  | 'stealth_ban'      // Mark account inactive
  | 'duplicate_posted' // Phantom success → recover
  | 'terminal';        // Fail the tweet

export type RetryDecision = 'clear_and_continue' | 'continue' | 'bail';

const ERROR_PATTERNS: [RegExp, ErrorClass][] = [
  // Stale cache (query IDs, headers, TID)
  [/code\D+48\b/i, 'stale_cache'],
  [/HTTP 404/, 'stale_cache'],
  [/Query not found/i, 'stale_cache'],
  [/code\D+344\b/, 'stale_cache'],

  // Transient
  [/HTTP 226/, 'transient'],
  [/code\D+226\b/, 'transient'],
  [/might be automated/i, 'transient'],
  [/code\D+131\b/, 'transient'],  // X internal error
  [/code\D+239\b/, 'transient'],  // Bad guest token
  [/code\D+253\b/, 'transient'],  // JSON parsing error

  // Auth failure
  [/HTTP 401/, 'auth_failure'],
  [/Could not authenticate/i, 'auth_failure'],

  // Rate limit
  [/HTTP 429/, 'rate_limit'],
  [/code\D+88\b/, 'rate_limit'],
  [/Rate limit exceeded/i, 'rate_limit'],

  // Stealth ban
  [/code\D+353\b/, 'stealth_ban'],
  [/suspended/i, 'stealth_ban'],
  [/code\D+64\b/, 'stealth_ban'],

  // Duplicate (phantom success)
  [/code\D+187\b/, 'duplicate_posted'],

  // Terminal
  [/GRAPHQL_VALIDATION_FAILED/, 'terminal'],
  [/code\D+214\b/, 'terminal'],
];

/**
 * Classify an X API error string into one of 7 error classes.
 * Falls back to 'terminal' for unrecognized errors.
 */
export function classifyError(error: string): ErrorClass {
  for (const [pattern, cls] of ERROR_PATTERNS) {
    if (pattern.test(error)) return cls;
  }
  return 'terminal';
}

/**
 * Determine retry decision based on error class and attempt number.
 */
export function shouldRetry(attempt: number, errorClass: ErrorClass): RetryDecision {
  if (errorClass === 'stale_cache' && attempt === 0) return 'clear_and_continue';
  if (errorClass === 'transient' && attempt < 3) return 'continue';
  if (errorClass === 'auth_failure' && attempt === 0) return 'continue';
  return 'bail';
}

/**
 * Backward compatibility wrapper — still used in tweet-service.ts with withRetry().
 * Returns true for errors that are worth retrying (stale_cache, transient, auth_failure, rate_limit).
 * Also checks HTTP status codes directly for 429, 500, 502, 503, 504.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof TwitterApiError)) return false;

  // Check HTTP status for transient server errors
  const transientStatuses = [429, 500, 502, 503, 504];
  if (transientStatuses.includes(error.twitterStatus)) return true;

  // Check error code patterns in detail/message
  const errorStr = error.detail || error.message;
  const cls = classifyError(errorStr);
  return cls === 'transient' || cls === 'stale_cache' || cls === 'auth_failure' || cls === 'rate_limit';
}
