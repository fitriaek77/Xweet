// Tests for src/lib/twitter/scheduled-tweet.ts
/** Safely get nth mock call without non-null assertion. */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures these are available when vi.mock factories execute
const { mockXFetch, mockGetQueryIds } = vi.hoisted(() => ({
  mockXFetch: vi.fn(),
  mockGetQueryIds: vi.fn(),
}));

vi.mock("@/lib/twitter/client", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("importOriginal failed");
  return {
    ...actual,
    xFetch: mockXFetch,
  };
});

vi.mock("@/lib/twitter/query-id", () => ({
  getQueryIds: mockGetQueryIds,
}));

// We need the real FALLBACK_QUERY_IDS for reference
import { FALLBACK_QUERY_IDS as _FALLBACK_QUERY_IDS, MAX_X_SCHEDULED_PER_ACCOUNT } from "@/config/constants";
import {
  createScheduledTweet,
  fetchScheduledTweets,
  editScheduledTweet,
  deleteScheduledTweet,
} from "@/lib/twitter/scheduled-tweet";
import type { XFetchResult } from "@/lib/twitter/client";

// ─── Helpers ───

/** Safely get first arg of nth mock call without non-null assertion. */
function getCallFirstArg(mock: ReturnType<typeof vi.fn>, index: number) {
  const call = mock.mock.calls.at(index);
  if (!call) throw new Error(`No mock call at index ${index}`);
  return call[0];
}

const COOKIES = "auth_token=abc123; ct0=token123; twid=user1";
const CT0 = "token123";
const MOCK_QUERY_IDS = {
  CreateTweet: "testCreateTweet",
  CreateScheduledTweet: "testCreateScheduled",
  FetchScheduledTweets: "testFetchScheduled",
  EditScheduledTweet: "testEditScheduled",
  DeleteScheduledTweet: "testDeleteScheduled",
};

function makeSuccessResult(data: unknown, updatedCookies?: string): XFetchResult {
  return { ok: true, status: 200, data, updatedCookies };
}

function makeValidScheduledTweetResponse(restId: string) {
  return {
    data: {
      create_scheduled_tweet: {
        scheduled_tweet: {
          rest_id: restId,
        },
      },
    },
  };
}

function makeValidMutationDoneResponse() {
  return {
    data: {
      scheduledtweet_put: "Done",
    },
  };
}

function makeValidDeleteDoneResponse() {
  return {
    data: {
      scheduledtweet_delete: "Done",
    },
  };
}

function makeValidFetchResponse(
  tweets: Array<{ rest_id: string; [key: string]: unknown }>
) {
  return {
    data: {
      viewer: {
        scheduled_tweet_list: tweets,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetQueryIds.mockResolvedValue(MOCK_QUERY_IDS);
});

// ─── createScheduledTweet ───

describe("createScheduledTweet", () => {
  it("creates a scheduled tweet without media", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidScheduledTweetResponse("sched_1"))
    );

    const result = await createScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "Scheduled post",
      executeAt: 1700000000,
    });

    expect(result.restId).toBe("sched_1");

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.method).toBe("POST");
    // Path now uses query IDs from getQueryIds
    expect(call.path).toBe(
      `/graphql/${MOCK_QUERY_IDS.CreateScheduledTweet}/CreateScheduledTweet`
    );
    expect(call.cookies).toBe(COOKIES);
    expect(call.ct0).toBe(CT0);

    // Verify body: no queryId in body (causes error 214)
    expect(call.body.queryId).toBeUndefined();
    expect(call.body.features).toBeUndefined();

    // Verify variables
    expect(call.body.variables.execute_at).toBe(1700000000);
    expect(call.body.variables.post_tweet_request.status).toBe("Scheduled post");
    expect(call.body.variables.post_tweet_request.auto_populate_reply_metadata).toBe(false);
    expect(call.body.variables.post_tweet_request.exclude_reply_user_ids).toEqual([]);
    expect(call.body.variables.post_tweet_request.media_ids).toBeUndefined();
  });

  it("creates a scheduled tweet with mediaIds (verify media_ids ARRAY format, NOT media_entities)", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidScheduledTweetResponse("sched_2"))
    );

    const result = await createScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "With media",
      executeAt: 1700000000,
      mediaIds: ["m1", "m2"],
    });

    expect(result.restId).toBe("sched_2");

    const call = getCallFirstArg(mockXFetch, 0);
    // Key difference from createTweet: media_ids is a flat array, NOT media_entities
    expect(call.body.variables.post_tweet_request.media_ids).toEqual(["m1", "m2"]);
  });

  it("returns restId from the response", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidScheduledTweetResponse("rest_id_xyz"))
    );

    const result = await createScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "test",
      executeAt: 1700000000,
    });

    expect(result.restId).toBe("rest_id_xyz");
  });

  it("passes updatedCookies through from xFetch result", async () => {
    const updatedCookies = "auth_token=abc123; ct0=newCt0; twid=user1";
    mockXFetch.mockResolvedValue(
      makeSuccessResult(
        makeValidScheduledTweetResponse("sched_3"),
        updatedCookies
      )
    );

    const result = await createScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "cookie test",
      executeAt: 1700000000,
    });

    expect(result.updatedCookies).toBe(updatedCookies);
  });

  it("does not include updatedCookies when xFetch returns none", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidScheduledTweetResponse("sched_4"))
    );

    const result = await createScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "no cookies",
      executeAt: 1700000000,
    });

    expect(result.updatedCookies).toBeUndefined();
  });

  it("does not include media_ids when mediaIds is an empty array", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidScheduledTweetResponse("sched_5"))
    );

    await createScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "empty media",
      executeAt: 1700000000,
      mediaIds: [],
    });

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.body.variables.post_tweet_request.media_ids).toBeUndefined();
  });

  it("uses getQueryIds for path (resolved inside factory)", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidScheduledTweetResponse("sched_6"))
    );

    await createScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "query ids test",
      executeAt: 1700000000,
    });

    // createScheduledTweet now uses getQueryIds inside the factory
    expect(mockGetQueryIds).toHaveBeenCalled();
    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.path).toContain(MOCK_QUERY_IDS.CreateScheduledTweet);
  });
});

// ─── parseScheduledTweetResponse ───

describe("parseScheduledTweetResponse", () => {
  it("throws on missing rest_id in response", async () => {
    const badResponse = {
      data: {
        create_scheduled_tweet: {
          scheduled_tweet: {
            // rest_id missing
          },
        },
      },
    };
    mockXFetch.mockResolvedValue(makeSuccessResult(badResponse));

    await expect(
      createScheduledTweet({
        cookies: COOKIES,
        ct0: CT0,
        text: "bad",
        executeAt: 1700000000,
      })
    ).rejects.toThrow("CreateScheduledTweet unknown failure");
  });

  it("throws when data is null", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(null));

    await expect(
      createScheduledTweet({
        cookies: COOKIES,
        ct0: CT0,
        text: "null",
        executeAt: 1700000000,
      })
    ).rejects.toThrow("CreateScheduledTweet unknown failure");
  });

  it("throws when create_scheduled_tweet is missing", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult({ data: {} }));

    await expect(
      createScheduledTweet({
        cookies: COOKIES,
        ct0: CT0,
        text: "missing",
        executeAt: 1700000000,
      })
    ).rejects.toThrow("CreateScheduledTweet unknown failure");
  });

  it("throws when scheduled_tweet is missing", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult({ data: { create_scheduled_tweet: {} } })
    );

    await expect(
      createScheduledTweet({
        cookies: COOKIES,
        ct0: CT0,
        text: "missing tweet",
        executeAt: 1700000000,
      })
    ).rejects.toThrow("CreateScheduledTweet unknown failure");
  });
});

// ─── fetchScheduledTweets ───

describe("fetchScheduledTweets", () => {
  it("returns tweets list", async () => {
    const tweets = [
      { rest_id: "st_1", scheduled_tweet: { execute_at: 1700001000, status: "scheduled", tweet: { rest_id: "1", legacy: { full_text: "First" } } } },
      { rest_id: "st_2", scheduled_tweet: { execute_at: 1700002000, status: "scheduled", tweet: { rest_id: "2", legacy: { full_text: "Second" } } } },
    ];
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidFetchResponse(tweets))
    );

    const result = await fetchScheduledTweets(COOKIES, CT0);

    expect(result.tweets).toHaveLength(2);
    const firstTweet = result.tweets[0];
    const secondTweet = result.tweets[1];
    if (!firstTweet || !secondTweet) throw new Error("Expected tweets");
    expect(firstTweet.rest_id).toBe("st_1");
    expect(secondTweet.rest_id).toBe("st_2");
  });

  it("includes ascending: false in the request body", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidFetchResponse([]))
    );

    await fetchScheduledTweets(COOKIES, CT0);

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.body.variables.ascending).toBe(false);
  });

  it("uses POST method for fetch", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidFetchResponse([]))
    );

    await fetchScheduledTweets(COOKIES, CT0);

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.method).toBe("POST");
  });

  it("builds path using getQueryIds FetchScheduledTweets", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidFetchResponse([]))
    );

    await fetchScheduledTweets(COOKIES, CT0);

    expect(mockGetQueryIds).toHaveBeenCalledOnce();
    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.path).toBe(
      `/graphql/${MOCK_QUERY_IDS.FetchScheduledTweets}/FetchScheduledTweets`
    );
  });

  it("isAtLimit when count >= 100", async () => {
    // Generate 100 tweets
    const tweets = Array.from({ length: MAX_X_SCHEDULED_PER_ACCOUNT }, (_, i) => ({
      rest_id: `st_${i}`,
      scheduled_tweet: {
        execute_at: 1700000000 + i,
        status: "scheduled",
        tweet: { rest_id: `${i}`, legacy: { full_text: `Tweet ${i}` } },
      },
    }));
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidFetchResponse(tweets))
    );

    const result = await fetchScheduledTweets(COOKIES, CT0);

    expect(result.count).toBe(100);
    expect(result.isAtLimit).toBe(true);
  });

  it("is not at limit when count < 100", async () => {
    const tweets = Array.from({ length: 50 }, (_, i) => ({
      rest_id: `st_${i}`,
      scheduled_tweet: {
        execute_at: 1700000000 + i,
        status: "scheduled",
        tweet: { rest_id: `${i}`, legacy: { full_text: `Tweet ${i}` } },
      },
    }));
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidFetchResponse(tweets))
    );

    const result = await fetchScheduledTweets(COOKIES, CT0);

    expect(result.count).toBe(50);
    expect(result.isAtLimit).toBe(false);
  });

  it("passes updatedCookies through", async () => {
    const updatedCookies = "auth_token=abc123; ct0=freshToken; twid=user1";
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidFetchResponse([]), updatedCookies)
    );

    const result = await fetchScheduledTweets(COOKIES, CT0);

    expect(result.updatedCookies).toBe(updatedCookies);
  });

  it("returns empty tweets array when response has no scheduled_tweets_list", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult({ data: { viewer: {} } })
    );

    const result = await fetchScheduledTweets(COOKIES, CT0);

    expect(result.tweets).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.isAtLimit).toBe(false);
  });

  it("returns empty tweets array when viewer is missing", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult({ data: {} })
    );

    const result = await fetchScheduledTweets(COOKIES, CT0);

    expect(result.tweets).toEqual([]);
  });
});

// ─── editScheduledTweet ───

describe("editScheduledTweet", () => {
  it("calls xFetch with correct path and body", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(makeValidMutationDoneResponse()));

    await editScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      scheduledTweetRestId: "sched_rest_1",
      text: "Updated text",
      executeAt: 1800000000,
    });

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.method).toBe("POST");
    // Path now uses query IDs from getQueryIds
    expect(call.path).toBe(
      `/graphql/${MOCK_QUERY_IDS.EditScheduledTweet}/EditScheduledTweet`
    );
    expect(call.cookies).toBe(COOKIES);
    expect(call.ct0).toBe(CT0);

    // Verify body structure
    expect(call.body.variables.scheduled_tweet_id).toBe("sched_rest_1");
    expect(call.body.variables.execute_at).toBe(1800000000);
    expect(call.body.variables.post_tweet_request.status).toBe("Updated text");
    expect(call.body.variables.post_tweet_request.auto_populate_reply_metadata).toBe(false);
    expect(call.body.variables.post_tweet_request.exclude_reply_user_ids).toEqual([]);
    expect(call.body.variables.post_tweet_request.media_ids).toBeUndefined();
  });

  it("includes media_ids array with mediaIds", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(makeValidMutationDoneResponse()));

    await editScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      scheduledTweetRestId: "sched_rest_2",
      text: "With media edit",
      executeAt: 1800000000,
      mediaIds: ["media_a", "media_b"],
    });

    const call = getCallFirstArg(mockXFetch, 0);
    // media_ids is a flat array (same as createScheduledTweet)
    expect(call.body.variables.post_tweet_request.media_ids).toEqual([
      "media_a",
      "media_b",
    ]);
  });

  it("uses getQueryIds for path (resolved inside factory)", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(makeValidMutationDoneResponse()));

    await editScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      scheduledTweetRestId: "sched_rest_3",
      text: "query ids test",
      executeAt: 1800000000,
    });

    expect(mockGetQueryIds).toHaveBeenCalled();
    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.path).toContain(MOCK_QUERY_IDS.EditScheduledTweet);
  });

  it("does not include media_ids when mediaIds is empty array", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(makeValidMutationDoneResponse()));

    await editScheduledTweet({
      cookies: COOKIES,
      ct0: CT0,
      scheduledTweetRestId: "sched_rest_4",
      text: "empty mediaIds",
      executeAt: 1800000000,
      mediaIds: [],
    });

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.body.variables.post_tweet_request.media_ids).toBeUndefined();
  });
});

// ─── deleteScheduledTweet ───

describe("deleteScheduledTweet", () => {
  it("calls xFetch with correct path and body", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(makeValidDeleteDoneResponse()));

    await deleteScheduledTweet(COOKIES, CT0, "sched_delete_1");

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.method).toBe("POST");
    // Path now uses query IDs from getQueryIds
    expect(call.path).toBe(
      `/graphql/${MOCK_QUERY_IDS.DeleteScheduledTweet}/DeleteScheduledTweet`
    );
    expect(call.cookies).toBe(COOKIES);
    expect(call.ct0).toBe(CT0);
    expect(call.body.variables.scheduled_tweet_id).toBe("sched_delete_1");
  });

  it("uses getQueryIds for path (resolved inside factory)", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(makeValidDeleteDoneResponse()));

    await deleteScheduledTweet(COOKIES, CT0, "sched_delete_2");

    // deleteScheduledTweet now uses getQueryIds inside the factory
    expect(mockGetQueryIds).toHaveBeenCalled();
    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.path).toContain(MOCK_QUERY_IDS.DeleteScheduledTweet);
  });

  it("passes the correct scheduled_tweet_rest_id in variables", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(makeValidDeleteDoneResponse()));

    await deleteScheduledTweet(COOKIES, CT0, "unique_rest_id_999");

    const call = getCallFirstArg(mockXFetch, 0);
    expect(call.body.variables.scheduled_tweet_id).toBe("unique_rest_id_999");
  });
});
