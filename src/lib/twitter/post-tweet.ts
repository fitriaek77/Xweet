// src/lib/twitter/post-tweet.ts
// CreateTweet (immediate posting) with correct media_entities format.
// Uses resilientApiCall(factory) so queryIds/TID/headers are re-resolved
// on retry after stale cache clear.

import { xFetch, resilientApiCall, parseCreateTweetResponse, type XFetchResult } from "@/lib/twitter/client";
import { getQueryIds } from "@/lib/twitter/query-id";
import { CREATE_TWEET_FEATURES } from "@/lib/twitter/features";

export interface CreateTweetParams {
  cookies: string;
  ct0: string;
  text: string;
  /** Media IDs from upload pipeline (optional). */
  mediaIds?: string[] | undefined;
}

export interface CreateTweetResult {
  tweetId: string;
  text: string;
  /** Updated cookie string if ct0 was refreshed. */
  updatedCookies?: string | undefined;
}

/**
 * Post a tweet immediately via CreateTweet GraphQL endpoint.
 * Uses media_entities format (NOT media_ids — that returns 422).
 *
 * Wrapped in resilientApiCall(factory) so stale query IDs / TIDs / headers
 * are automatically cleared and re-resolved on retry.
 */
export async function createTweet(
  params: CreateTweetParams
): Promise<CreateTweetResult> {
  const { cookies, ct0, text, mediaIds } = params;

  // Build variables (static — doesn't need re-resolution)
  const variables: Record<string, unknown> = {
    tweet_text: text,
    dark_request: false,
    semantic_annotation_ids: [],
  };

  if (mediaIds && mediaIds.length > 0) {
    variables.media = {
      media_entities: mediaIds.map((id) => ({
        media_id: id,
        tagged_users: [],
      })),
      possibly_sensitive: false,
    };
  }

  // Factory pattern: queryIds resolved INSIDE factory so retry gets fresh values
  const result = await resilientApiCall(async (): Promise<CreateTweetResult> => {
    const queryIds = await getQueryIds(); // re-resolved on each attempt
    const path = `/graphql/${queryIds.CreateTweet}/CreateTweet`;

    const body = {
      variables,
      queryId: queryIds.CreateTweet,
      features: CREATE_TWEET_FEATURES,
    };

    const fetchResult: XFetchResult = await xFetch({
      method: "POST",
      path,
      cookies,
      ct0,
      body,
    });

    return parseLegacyCreateTweetResponse(fetchResult);
  });

  return result;
}

/**
 * Parse the CreateTweet XFetchResult into a CreateTweetResult.
 * Uses the 4-layer response parser for classification, then extracts data.
 */
function parseLegacyCreateTweetResponse(result: XFetchResult): CreateTweetResult {
  const outcome = parseCreateTweetResponse(result.data);

  switch (outcome.kind) {
    case 'success':
      return {
        tweetId: outcome.tweetId,
        text: '', // Text not needed in result — we already have it
        updatedCookies: result.updatedCookies,
      };

    case 'empty_results':
      throw new Error(
        'CreateTweet returned empty tweet_results — possible stale TID or silent rejection'
      );

    case 'graphql_error':
      throw new Error(
        `CreateTweet GraphQL error: ${outcome.error} (class=${outcome.errorClass})`
      );

    case 'unknown_failure':
      throw new Error(
        `CreateTweet unknown failure: ${JSON.stringify(outcome.body)}`
      );
  }
}
