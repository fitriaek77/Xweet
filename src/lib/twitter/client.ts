// src/lib/twitter/client.ts
// xFetch() — centralized X API request builder.
// Injects anti-detection headers, ct0, TID, and handles 401/403 auto-refresh.

import { X_API_BASE, X_BEARER_TOKEN } from "@/config/constants";
import { getHeaders, clearHeaderCache } from "@/lib/twitter/headers";
import { generateTransactionId, clearTidCache } from "@/lib/twitter/transaction-id";
import { refreshCt0, updateCt0InCookieString } from "@/lib/twitter/ct0-refresh";
import { TwitterApiError } from "@/lib/api/errors";
import { classifyError, shouldRetry, type ErrorClass } from "@/lib/utils/error-classifier";
import { clearQueryIdCache } from "@/lib/twitter/query-id";
import { randomInt } from "node:crypto";

export interface XFetchParams {
  method: "GET" | "POST";
  /** API path, e.g. '/graphql/.../CreateTweet' */
  path: string;
  /** Raw cookie string (auth_token=...; ct0=...; twid=...) */
  cookies: string;
  /** JSON body for POST requests */
  body?: Record<string, unknown> | undefined;
  /** Current ct0 (CSRF token) */
  ct0: string;
  /** Skip TID injection (e.g., for upload endpoints) */
  skipTid?: boolean | undefined;
}

export interface XFetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Updated cookie string if ct0 was refreshed */
  updatedCookies?: string | undefined;
}

/**
 * Centralized X API request builder.
 * - Injects anti-detection headers from header.json
 * - Injects fresh ct0 + twid from account cookies
 * - Generates and injects x-client-transaction-id
 * - Handles 401/403 with automatic ct0 refresh attempt
 */
export async function xFetch(params: XFetchParams): Promise<XFetchResult> {
  const { method, path, body, skipTid = false } = params;
  let { cookies, ct0 } = params;

  const url = `${X_API_BASE}${path}`;
  const headerProfile = await getHeaders();

  // Generate TID (skip for upload endpoints)
  let tid: string | null = null;
  if (!skipTid) {
    tid = await generateTransactionId(method, path);
  }

  // Build headers
  const headers = buildRequestHeaders({
    cookies,
    ct0,
    tid,
    headerProfile,
    hasBody: !!body,
  });

  // Execute request
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(8000),
  });

  // Auto-refresh ct0 on 401/403
  if (resp.status === 401 || resp.status === 403) {
    const refreshed = await attemptCt0Refresh(cookies);
    if (refreshed) {
      cookies = refreshed.cookies;
      ct0 = refreshed.ct0;

      // Retry with fresh ct0
      const retryHeaders = buildRequestHeaders({
        cookies,
        ct0,
        tid,
        headerProfile,
        hasBody: !!body,
      });

      const retryResp = await fetch(url, {
        method,
        headers: retryHeaders,
        body: body ? JSON.stringify(body) : null,
        signal: AbortSignal.timeout(8000),
      });

      const retryData = await safeParseJson(retryResp);

      return {
        ok: retryResp.ok,
        status: retryResp.status,
        data: retryData,
        updatedCookies: refreshed.cookies,
      };
    }
  }

  const data = await safeParseJson(resp);

  if (!resp.ok) {
    throw new TwitterApiError(
      `X API error: ${resp.status} ${path}`,
      resp.status,
      typeof data === "string" ? data : JSON.stringify(data)
    );
  }

  return { ok: true, status: resp.status, data };
}

/**
 * Build the full set of anti-detection headers.
 * header.json uses lowercase keys; we merge them with our explicit headers.
 * Our explicit headers take precedence over profile headers.
 */
function buildRequestHeaders(opts: {
  cookies: string;
  ct0: string;
  tid: string | null;
  headerProfile: Record<string, string>;
  hasBody: boolean;
}): Record<string, string> {
  const { cookies, ct0, tid, headerProfile, hasBody } = opts;

  // Start with header profile (lowercase keys from chrome-fetch)
  const headers: Record<string, string> = { ...headerProfile };

  // Override with anti-detection headers (MANDATORY for CreateTweet — Error 344 without)
  headers["X-Twitter-Auth-Type"] = "OAuth2Session";
  headers["X-Twitter-Active-User"] = "yes";
  headers["X-Twitter-Client-Language"] = "en";
  headers["Referer"] = "https://x.com/";
  headers["Origin"] = "https://x.com";
  headers["Cache-Control"] = "no-cache";
  headers["Pragma"] = "no-cache";
  headers["Priority"] = "u=1, i";

  // Auth headers
  headers["Authorization"] = `Bearer ${X_BEARER_TOKEN}`;
  headers["Cookie"] = cookies;
  headers["X-Csrf-Token"] = ct0;

  // Content-Type for POST with body
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  // TID (mandatory for CreateTweet, not needed for upload)
  if (tid) {
    headers["x-client-transaction-id"] = tid;
  }

  return headers;
}

/** Attempt ct0 refresh by extracting auth_token from cookies. */
async function attemptCt0Refresh(
  cookies: string
): Promise<{ cookies: string; ct0: string } | null> {
  const authTokenMatch = cookies.match(/auth_token=([^;]+)/);
  if (!authTokenMatch?.[1]) return null;

  const result = await refreshCt0(authTokenMatch[1]);
  if (!result || result.ct0MaxAge < 0) return null;

  const updatedCookies = updateCt0InCookieString(
    cookies,
    result.ct0,
    result.twid
  );

  return { cookies: updatedCookies, ct0: result.ct0 };
}

/** Safely parse JSON response, return raw text on failure. */
async function safeParseJson(
  resp: Response
): Promise<unknown> {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// P1.2 — 4-layer response parsing (discriminated unions)
// ---------------------------------------------------------------------------

/** Outcome of a CreateTweet API call. */
export type CreateTweetOutcome =
  | { kind: 'success'; tweetId: string }
  | { kind: 'empty_results' }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

/** Outcome of a CreateScheduledTweet API call. */
export type CreateScheduledTweetOutcome =
  | { kind: 'success'; restId: string }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

/** Outcome of a scheduled tweet mutation (put/delete). */
export type ScheduledMutationOutcome =
  | { kind: 'done' }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

/** Outcome of a FetchScheduledTweets API call. */
export type FetchScheduledOutcome =
  | { kind: 'list'; items: unknown[] }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown };

/**
 * Parse a CreateTweet response body into a discriminated union.
 *
 * Layer 1: tweetId present → success (even if errors[] exists)
 * Layer 2: empty tweet_results → empty_results
 * Layer 3: GraphQL errors[] → graphql_error with classification
 * Layer 4: Anything else → unknown_failure
 */
export function parseCreateTweetResponse(body: unknown): CreateTweetOutcome {
  const data = (body ?? {}) as Record<string, unknown>;

  // Layer 1: tweetId present = success (even if errors[])
  const dataField = data.data as Record<string, unknown> | undefined;
  const createTweet = dataField?.create_tweet as Record<string, unknown> | undefined;
  const tweetResults = createTweet?.tweet_results as Record<string, unknown> | undefined;
  const result = tweetResults?.result as Record<string, unknown> | undefined;
  const restId = result?.rest_id;
  if (typeof restId === 'string') return { kind: 'success', tweetId: restId };

  // Layer 2: empty tweet_results
  if (tweetResults && Object.keys(tweetResults).length === 0) {
    return { kind: 'empty_results' };
  }

  // Layer 3: GraphQL errors
  const errors = data.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const errorStr = JSON.stringify(errors);
    return { kind: 'graphql_error', error: errorStr, errorClass: classifyError(errorStr) };
  }

  // Layer 4: unknown
  return { kind: 'unknown_failure', body };
}

/**
 * Parse a CreateScheduledTweet response body into a discriminated union.
 */
export function parseCreateScheduledTweetResponse(body: unknown): CreateScheduledTweetOutcome {
  const data = (body ?? {}) as Record<string, unknown>;

  // Layer 1: rest_id present
  const dataField = data.data as Record<string, unknown> | undefined;
  const createResult = dataField?.create_scheduled_tweet as Record<string, unknown> | undefined;
  const scheduledTweet = createResult?.scheduled_tweet as Record<string, unknown> | undefined;
  const restId = scheduledTweet?.rest_id;
  if (typeof restId === 'string') return { kind: 'success', restId };

  // Layer 2: empty data — check for errors
  if (createResult && !restId) {
    const errors = data.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const errorStr = JSON.stringify(errors);
      return { kind: 'graphql_error', error: errorStr, errorClass: classifyError(errorStr) };
    }
    return { kind: 'unknown_failure', body };
  }

  // Layer 3: GraphQL errors at top level
  const errors = data.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const errorStr = JSON.stringify(errors);
    return { kind: 'graphql_error', error: errorStr, errorClass: classifyError(errorStr) };
  }

  return { kind: 'unknown_failure', body };
}

/**
 * Parse a scheduled tweet mutation (put/delete) response body.
 */
function getMutationValue(
  data: Record<string, unknown>,
  key: 'scheduledtweet_put' | 'scheduledtweet_delete'
): unknown {
  if (key === 'scheduledtweet_put') return data.scheduledtweet_put;
  return data.scheduledtweet_delete;
}

export function parseScheduledMutationResponse(
  body: unknown,
  key: 'scheduledtweet_put' | 'scheduledtweet_delete'
): ScheduledMutationOutcome {
  const data = (body ?? {}) as Record<string, unknown>;

  // Layer 1: "Done" response
  const dataObj = data.data as Record<string, unknown> | undefined;
  if (dataObj && getMutationValue(dataObj, key) === 'Done') return { kind: 'done' };

  // Layer 2: check for errors
  const errors = data.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const errorStr = JSON.stringify(errors);
    return { kind: 'graphql_error', error: errorStr, errorClass: classifyError(errorStr) };
  }

  return { kind: 'unknown_failure', body };
}

/**
 * Parse a FetchScheduledTweets response body into a discriminated union.
 */
export function parseFetchScheduledResponse(body: unknown): FetchScheduledOutcome {
  const data = (body ?? {}) as Record<string, unknown>;

  // Layer 1: scheduled_tweet_list array (missing list/viewer treated as empty)
  const dataField = data.data as Record<string, unknown> | undefined;
  const viewer = dataField?.viewer as Record<string, unknown> | undefined;
  const items = viewer?.scheduled_tweet_list;
  if (Array.isArray(items) || dataField) return { kind: 'list', items: Array.isArray(items) ? items : [] };

  // Layer 2: check for errors
  const errors = data.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const errorStr = JSON.stringify(errors);
    return { kind: 'graphql_error', error: errorStr, errorClass: classifyError(errorStr) };
  }

  return { kind: 'unknown_failure', body };
}

// ---------------------------------------------------------------------------
// P1.3 — resilientApiCall (factory pattern with automatic retry)
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [1000, 2000, 4000];

async function waitBeforeRetry(failedAttempt: number): Promise<void> {
  const base = RETRY_DELAYS.at(failedAttempt) ?? 4000;
  // Crypto-secure jitter: 80-130% of base delay (matching retry.ts)
  const jitter = Math.round(base * (0.8 + randomInt(501) / 1000));
  await new Promise(resolve => setTimeout(resolve, jitter));
}

/**
 * Execute an API call with automatic retry and stale-data recovery.
 *
 * CRITICAL: `factory` is called fresh on EACH attempt. Query IDs, TIDs, and
 * headers are re-resolved from (potentially cleared) caches on retry.
 * Do NOT resolve these outside the factory — that defeats the entire purpose.
 */
export async function resilientApiCall<T>(
  factory: () => Promise<T>,
  attempt = 0
): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    const errorStr = error instanceof Error ? error.message : String(error);
    const errorClass = classifyError(errorStr);
    const decision = shouldRetry(attempt, errorClass);

    switch (decision) {
      case 'clear_and_continue':
        clearQueryIdCache();
        clearTidCache();
        clearHeaderCache();
        process.stderr.write(`[resilientApiCall] Stale data detected, clearing caches and retrying (attempt ${attempt})\n`);
        return resilientApiCall(factory, attempt + 1);

      case 'continue':
        await waitBeforeRetry(attempt);
        process.stderr.write(`[resilientApiCall] Transient error, retrying (attempt ${attempt})\n`);
        return resilientApiCall(factory, attempt + 1);

      case 'bail':
        throw error;
    }
  }
}
