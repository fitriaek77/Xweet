// src/lib/utils/retry.ts
// Exponential backoff with jitter — for X API calls.

import { randomInt } from "node:crypto";

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Execute a function with retry and exponential backoff + jitter.
 * Jitter range: 80-130% of calculated delay (from Tweetfess pattern).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (opts.shouldRetry && !opts.shouldRetry(error)) {
        throw error;
      }

      // Don't sleep on last attempt
      if (attempt === opts.maxAttempts) break;

      // Exponential backoff with jitter (80-130%)
      const baseDelay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs
      );
      const jitter = baseDelay * (0.8 + Math.random() * 0.5); // 80-130%
      const delay = Math.round(jitter);

      await sleep(delay);
    }
  }

  throw lastError;
}

const RETRY_DELAYS = [1000, 2000, 4000];

/** Wait before retry with jittered exponential backoff using crypto.randomInt. */
export async function waitBeforeRetry(failedAttempt: number): Promise<void> {
  const base = RETRY_DELAYS.at(failedAttempt) ?? 4000;
  const jitter = Math.round(base * (0.8 + randomInt(501) / 1000));
  await new Promise(resolve => setTimeout(resolve, jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
