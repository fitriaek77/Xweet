// src/lib/twitter/scheduled-tweet.ts
// Create/Edit/Delete/FetchScheduledTweet operations.
// Key differences from CreateTweet:
//   - Uses post_tweet_request wrapper + media_ids array (NOT media_entities!)
//   - NO queryId in body (causes error 214)
//   - NO features or fieldToggles needed
//   - execute_at is Unix SECONDS (not milliseconds)
//   - FetchScheduledTweets requires {ascending: false}
//
// All operations use resilientApiCall(factory) for automatic stale-data recovery.

import {
  xFetch,
  resilientApiCall,
  parseCreateScheduledTweetResponse,
  parseScheduledMutationResponse,
  parseFetchScheduledResponse,
  type XFetchResult,
} from "@/lib/twitter/client";
import { getQueryIds } from "@/lib/twitter/query-id";
import {
  MAX_X_SCHEDULED_PER_ACCOUNT,
} from "@/config/constants";
import type {
  TwitterScheduledTweetItem,
} from "@/types/twitter";

// ─── CreateScheduledTweet ───

export interface CreateScheduledTweetParams {
  cookies: string;
  ct0: string;
  text: string;
  /** Unix SECONDS for when to post. */
  executeAt: number;
  /** Media IDs from upload pipeline (optional). */
  mediaIds?: string[] | undefined;
}

export interface CreateScheduledTweetResult {
  restId: string;
  updatedCookies?: string | undefined;
}

/** Schedule a tweet via X's CreateScheduledTweet API. */
export async function createScheduledTweet(
  params: CreateScheduledTweetParams
): Promise<CreateScheduledTweetResult> {
  const { cookies, ct0, text, executeAt, mediaIds } = params;

  // Build post_tweet_request (static — doesn't need re-resolution)
  const postTweetRequest: Record<string, unknown> = {
    status: text,
    auto_populate_reply_metadata: false,
    exclude_reply_user_ids: [],
  };

  if (mediaIds && mediaIds.length > 0) {
    postTweetRequest.media_ids = mediaIds;
  }

  // NO queryId in body! (causes error 214)
  // NO features needed!
  const body = {
    variables: {
      execute_at: executeAt,
      post_tweet_request: postTweetRequest,
    },
  };

  return resilientApiCall(async () => {
    const queryIds = await getQueryIds(); // re-resolved on each attempt
    const path = `/graphql/${queryIds.CreateScheduledTweet}/CreateScheduledTweet`;

    const result = await xFetch({
      method: "POST",
      path,
      cookies,
      ct0,
      body,
    });

    return parseScheduledTweetCreateResult(result);
  });
}

function parseScheduledTweetCreateResult(
  result: XFetchResult
): CreateScheduledTweetResult {
  const outcome = parseCreateScheduledTweetResponse(result.data);

  switch (outcome.kind) {
    case 'success':
      return { restId: outcome.restId, updatedCookies: result.updatedCookies };

    case 'graphql_error':
      throw new Error(
        `CreateScheduledTweet GraphQL error: ${outcome.error} (class=${outcome.errorClass})`
      );

    case 'unknown_failure':
      throw new Error(
        `CreateScheduledTweet unknown failure: ${JSON.stringify(outcome.body)}`
      );
  }
}

// ─── FetchScheduledTweets ───

export interface FetchScheduledTweetsResult {
  tweets: TwitterScheduledTweetItem[];
  count: number;
  /** Whether the account has hit the 100-tweet limit. */
  isAtLimit: boolean;
  updatedCookies?: string | undefined;
}

/** Fetch all scheduled tweets for an account. CRITICAL: ascending: false required! */
export async function fetchScheduledTweets(
  cookies: string,
  ct0: string
): Promise<FetchScheduledTweetsResult> {
  const body = {
    variables: {
      ascending: false, // REQUIRED — empty {} gives 422
    },
  };

  return resilientApiCall(async () => {
    const queryIds = await getQueryIds(); // re-resolved on each attempt
    const path = `/graphql/${queryIds.FetchScheduledTweets}/FetchScheduledTweets`;

    const result = await xFetch({
      method: "POST",
      path,
      cookies,
      ct0,
      body,
    });

    return parseFetchResult(result);
  });
}

function parseFetchResult(
  result: XFetchResult
): FetchScheduledTweetsResult {
  const outcome = parseFetchScheduledResponse(result.data);

  switch (outcome.kind) {
    case 'list':
      return {
        tweets: outcome.items as TwitterScheduledTweetItem[],
        count: (outcome.items as TwitterScheduledTweetItem[]).length,
        isAtLimit: (outcome.items as TwitterScheduledTweetItem[]).length >= MAX_X_SCHEDULED_PER_ACCOUNT,
        updatedCookies: result.updatedCookies,
      };

    case 'graphql_error':
      throw new Error(
        `FetchScheduledTweets GraphQL error: ${outcome.error} (class=${outcome.errorClass})`
      );

    case 'unknown_failure':
      throw new Error(
        `FetchScheduledTweets unknown failure: ${JSON.stringify(outcome.body)}`
      );
  }
}

// ─── EditScheduledTweet ───

export interface EditScheduledTweetParams {
  cookies: string;
  ct0: string;
  /** The rest_id from CreateScheduledTweet. */
  scheduledTweetRestId: string;
  text: string;
  /** Unix SECONDS. */
  executeAt: number;
  mediaIds?: string[] | undefined;
}

/** Edit an existing scheduled tweet. */
export async function editScheduledTweet(
  params: EditScheduledTweetParams
): Promise<void> {
  const { cookies, ct0, scheduledTweetRestId, text, executeAt, mediaIds } =
    params;

  const postTweetRequest: Record<string, unknown> = {
    status: text,
    auto_populate_reply_metadata: false,
    exclude_reply_user_ids: [],
  };

  if (mediaIds && mediaIds.length > 0) {
    postTweetRequest.media_ids = mediaIds;
  }

  const body = {
    variables: {
      scheduled_tweet_id: scheduledTweetRestId,
      execute_at: executeAt, // REQUIRED (live-verified!)
      post_tweet_request: postTweetRequest,
    },
  };

  await resilientApiCall(async () => {
    const queryIds = await getQueryIds(); // re-resolved on each attempt
    const path = `/graphql/${queryIds.EditScheduledTweet}/EditScheduledTweet`;

    const result = await xFetch({ method: "POST", path, cookies, ct0, body });

    const outcome = parseScheduledMutationResponse(result.data, 'scheduledtweet_put');

    switch (outcome.kind) {
      case 'done':
        return; // success

      case 'graphql_error':
        throw new Error(
          `EditScheduledTweet GraphQL error: ${outcome.error} (class=${outcome.errorClass})`
        );

      case 'unknown_failure':
        throw new Error(
          `EditScheduledTweet unknown failure: ${JSON.stringify(outcome.body)}`
        );
    }
  });
}

// ─── DeleteScheduledTweet ───

/** Delete a scheduled tweet from X's system. */
export async function deleteScheduledTweet(
  cookies: string,
  ct0: string,
  scheduledTweetRestId: string
): Promise<void> {
  const body = {
    variables: {
      scheduled_tweet_id: scheduledTweetRestId,
    },
  };

  await resilientApiCall(async () => {
    const queryIds = await getQueryIds(); // re-resolved on each attempt
    const path = `/graphql/${queryIds.DeleteScheduledTweet}/DeleteScheduledTweet`;

    const result = await xFetch({ method: "POST", path, cookies, ct0, body });

    const outcome = parseScheduledMutationResponse(result.data, 'scheduledtweet_delete');

    switch (outcome.kind) {
      case 'done':
        return; // success

      case 'graphql_error':
        throw new Error(
          `DeleteScheduledTweet GraphQL error: ${outcome.error} (class=${outcome.errorClass})`
        );

      case 'unknown_failure':
        throw new Error(
          `DeleteScheduledTweet unknown failure: ${JSON.stringify(outcome.body)}`
        );
    }
  });
}
