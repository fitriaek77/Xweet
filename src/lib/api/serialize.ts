// src/lib/api/serialize.ts
// Sanitize tweet data before sending to the client.
// Strips internal fields (mediaKey = B2 object key) and adds
// convenience fields (hasMedia).

type TweetRow = Record<string, unknown>;

export interface SerializedTweet {
  id: string;
  accountId: string;
  content: string;
  scheduledAt: string;
  status: string;
  postedAt: string | null;
  tweetId: string | null;
  scheduledTweetRestId: string | null;
  failureReason: string | null;
  retryCount: number;
  maxRetries: number;
  mediaMimeType: string | null;
  mediaCategory: string | null;
  mediaId: string | null;
  hasMedia: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
  account: { username: string; avatarUrl: string | null };
}

/**
 * Strip internal fields from a tweet before sending to the client.
 * - Removes `mediaKey` (B2 object key — internal implementation detail)
 * - Adds `hasMedia` convenience field (derived from mediaMimeType)
 * - Serializes Date objects to ISO strings
 */
export function sanitizeTweet(tweet: TweetRow): SerializedTweet {
  const hasMedia = Boolean(tweet.mediaKey ?? tweet.mediaMimeType);

  const { mediaKey: _mediaKey, ...rest } = tweet;

  return {
    ...(rest as Record<string, unknown>),
    hasMedia,
  } as SerializedTweet;
}

/**
 * Sanitize an array of tweets.
 */
export function sanitizeTweets(tweets: TweetRow[]): SerializedTweet[] {
  return tweets.map(sanitizeTweet);
}

// ─── Account Serialization ───

type AccountRow = Record<string, unknown>;

export interface SerializedAccount {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  failureCount: number;
  circuitOpenUntil: string | null;
  lastPostedAt: string | null;
  lastCt0RefreshAt: string | null;
  createdAt: string;
}

/**
 * Strip encryptedCookies and other internal fields from an account
 * before sending to the client.
 */
export function sanitizeAccount(account: AccountRow): SerializedAccount {
  const {
    id, username, displayName, avatarUrl, isActive,
    failureCount, circuitOpenUntil, lastPostedAt, lastCt0RefreshAt, createdAt,
  } = account;
  return {
    id, username, displayName, avatarUrl, isActive,
    failureCount, circuitOpenUntil, lastPostedAt, lastCt0RefreshAt, createdAt,
  } as SerializedAccount;
}
