// src/config/constants.ts
// App-wide constants — no magic numbers or strings elsewhere.

// ─── Tweet Status Lifecycle ───
export const TWEET_STATUS = {
  SCHEDULED: "scheduled",
  X_SCHEDULED: "x_scheduled",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type TweetStatus = (typeof TWEET_STATUS)[keyof typeof TWEET_STATUS];

// Valid CAS transitions: from → to[]
export const VALID_TRANSITIONS: Record<TweetStatus, TweetStatus[]> = {
  scheduled: ["x_scheduled", "sending", "cancelled"],
  x_scheduled: ["sent", "cancelled"],
  sending: ["sent", "failed", "scheduled"], // scheduled = stale recovery
  sent: [],
  failed: ["scheduled", "cancelled"], // scheduled = retry
  cancelled: [],
};

// ─── Scheduling ───
export const MAX_X_SCHEDULED_PER_ACCOUNT = 100;
export const CRON_TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
export const CRON_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000; // 15 min
export const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
export const MAX_RETRIES = 3;

// Cron time-budget: Vercel hobby plan = 10s function timeout.
// We use 8s with a 2s safety margin for overhead (DB queries, etc.).
// Pro plan can safely increase this via env var if needed.
export const CRON_BUDGET_MS = 8000; // 8 seconds — safe for hobby plan 10s limit
export const CRON_DISPATCH_BATCH = 5; // Reduced from 20 — fits within budget
export const CRON_RETRY_BATCH = 3; // Reduced from 10 — fits within budget

// ─── Circuit Breaker ───
export const CIRCUIT_FAILURE_THRESHOLD = 3;
export const CIRCUIT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

// ─── Cookie / Auth ───
export const SESSION_COOKIE_NAME = "session_token";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Encryption ───
export const AES_ALGORITHM = "aes-256-gcm";
export const KEY_LENGTH = 32; // bytes
export const IV_LENGTH = 16; // bytes
export const AUTH_TAG_LENGTH = 16; // bytes

// ─── X API ───
export const X_BASE_URL = "https://x.com";
export const X_API_BASE = "https://x.com/i/api";
export const X_UPLOAD_BASE = "https://upload.x.com/i";
export const X_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// Fallback queryIds — live-verified 2026-05-27.
// Updated by GraphQL.json (primary) and placeholder.json (secondary).
export const FALLBACK_QUERY_IDS = {
  CreateTweet: "5CdvsV_zjv4L64XFifAglw",
  CreateScheduledTweet: "LCVzRQGxOaGnOnYH01NQXg",
  FetchScheduledTweets: "IT6ymOhStwEVyRHEpMzCgA",
  EditScheduledTweet: "_mHkQ5LHpRRjSXKOcG6eZw",
  DeleteScheduledTweet: "CTOVqej0JBXAZSwkp1US0g",
} as const;

// ─── Media Upload ───
export const MEDIA_CATEGORIES = {
  IMAGE: "tweet_image",
  VIDEO: "amplify_video",
  GIF: "tweet_gif",
} as const;

export const MEDIA_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks

// ─── External Resources ───
export const FA0311_RAW_BASE = "https://raw.githubusercontent.com/fa0311";
export const FA0311_JSDELIVR_BASE = "https://cdn.jsdelivr.net/gh/fa0311";

// ─── GraphQL.json (fa0311/TwitterInternalAPIDocument) ───
export const GRAPHQL_JSON_DEVELOP_URL =
  "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/develop/docs/json/GraphQL.json";
export const GRAPHQL_JSON_MASTER_URL =
  "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/GraphQL.json";
export const GRAPHQL_JSON_CACHE_MS = 6 * 60 * 60 * 1000; // 6h

// Cache durations
export const HEADERS_CACHE_MS = 24 * 60 * 60 * 1000; // 24h
export const QUERY_ID_CACHE_MS = 4 * 60 * 60 * 1000; // 4h
export const PAIR_DICT_CACHE_MS = 4 * 60 * 60 * 1000; // 4h

// ─── App Info ───
export const APP_NAME = "Xweet";
export const APP_DESCRIPTION = "Multi-Account X Scheduler";
