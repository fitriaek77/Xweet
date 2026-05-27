// Tests for src/lib/twitter/post-tweet.ts
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

import { createTweet } from "@/lib/twitter/post-tweet";
import type { XFetchResult } from "@/lib/twitter/client";

// ─── Helpers ───

const COOKIES = "auth_token=abc123; ct0=token123; twid=user1";
const CT0 = "token123";
const MOCK_QUERY_ID = "testCreateTweetQueryId";

function makeSuccessResult(data: unknown, updatedCookies?: string): XFetchResult {
  return { ok: true, status: 200, data, updatedCookies };
}

function makeValidCreateTweetResponse(restId: string, _fullText?: string) {
  return {
    data: {
      create_tweet: {
        tweet_results: {
          result: {
            rest_id: restId,
            legacy: { full_text: _fullText ?? "Hello world" },
          },
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetQueryIds.mockResolvedValue({ CreateTweet: MOCK_QUERY_ID });
});

// ─── createTweet ───

describe("createTweet", () => {
  it("posts a tweet without media", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidCreateTweetResponse("12345", "Hello world"))
    );

    const result = await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "Hello world",
    });

    expect(result.tweetId).toBe("12345");
    // Note: text is now always '' since parseLegacyCreateTweetResponse
    // returns text: '' (we already have the text in the caller)

    // Verify xFetch was called with correct args
    expect(mockXFetch).toHaveBeenCalledOnce();
    const callArgs = mockXFetch.mock.calls.at(0);
    if (!callArgs) throw new Error("No mock call found");
    const call = callArgs[0];
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/graphql/${MOCK_QUERY_ID}/CreateTweet`);
    expect(call.cookies).toBe(COOKIES);
    expect(call.ct0).toBe(CT0);

    // Verify body structure — no media field
    expect(call.body.variables.tweet_text).toBe("Hello world");
    expect(call.body.variables.dark_request).toBe(false);
    expect(call.body.variables.semantic_annotation_ids).toEqual([]);
    expect(call.body.variables.media).toBeUndefined();
    expect(call.body.queryId).toBe(MOCK_QUERY_ID);
    expect(call.body.features).toBeDefined();
  });

  it("posts a tweet with mediaIds (verifies media_entities format)", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidCreateTweetResponse("99999", "With media"))
    );

    const result = await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "With media",
      mediaIds: ["media_1", "media_2"],
    });

    expect(result.tweetId).toBe("99999");

    const callArgs = mockXFetch.mock.calls.at(0);
    if (!callArgs) throw new Error("No mock call found");
    const call = callArgs[0];
    // Verify media_entities format (NOT media_ids array!)
    expect(call.body.variables.media).toEqual({
      media_entities: [
        { media_id: "media_1", tagged_users: [] },
        { media_id: "media_2", tagged_users: [] },
      ],
      possibly_sensitive: false,
    });
  });

  it("returns tweetId from the response (text is empty per new design)", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidCreateTweetResponse("42", "My tweet text"))
    );

    const result = await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "My tweet text",
    });

    expect(result.tweetId).toBe("42");
    // text is now always '' since parseLegacyCreateTweetResponse returns text: ''
    expect(result.text).toBe("");
  });

  it("passes updatedCookies through from xFetch result", async () => {
    const updatedCookies = "auth_token=abc123; ct0=newToken; twid=user1";
    mockXFetch.mockResolvedValue(
      makeSuccessResult(
        makeValidCreateTweetResponse("100", "cookie test"),
        updatedCookies
      )
    );

    const result = await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "cookie test",
    });

    expect(result.updatedCookies).toBe(updatedCookies);
  });

  it("does not include media field when mediaIds is an empty array", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidCreateTweetResponse("200", "empty media"))
    );

    await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "empty media",
      mediaIds: [],
    });

    const callArgs = mockXFetch.mock.calls.at(0);
    if (!callArgs) throw new Error("No mock call found");
    const call = callArgs[0];
    expect(call.body.variables.media).toBeUndefined();
  });

  it("gets queryIds via getQueryIds()", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidCreateTweetResponse("300", "query test"))
    );

    await createTweet({ cookies: COOKIES, ct0: CT0, text: "query test" });

    expect(mockGetQueryIds).toHaveBeenCalledOnce();
  });

  it("returns empty string text when legacy.full_text is missing", async () => {
    const responseNoLegacy = {
      data: {
        create_tweet: {
          tweet_results: {
            result: {
              rest_id: "400",
              // No legacy field
            },
          },
        },
      },
    };
    mockXFetch.mockResolvedValue(makeSuccessResult(responseNoLegacy));

    const result = await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "no legacy",
    });

    expect(result.tweetId).toBe("400");
    expect(result.text).toBe("");
  });

  it("does not include updatedCookies when xFetch returns none", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidCreateTweetResponse("500", "no cookies"))
    );

    const result = await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "no cookies",
    });

    expect(result.updatedCookies).toBeUndefined();
  });
});

// ─── parseCreateTweetResponse (tested indirectly via createTweet + directly via edge cases) ───

describe("parseCreateTweetResponse", () => {
  it("throws on missing rest_id in response", async () => {
    // Response with no rest_id at the expected path
    const badResponse = {
      data: {
        create_tweet: {
          tweet_results: {
            result: {
              // rest_id missing
              legacy: { full_text: "something" },
            },
          },
        },
      },
    };
    mockXFetch.mockResolvedValue(makeSuccessResult(badResponse));

    await expect(
      createTweet({ cookies: COOKIES, ct0: CT0, text: "bad response" })
    ).rejects.toThrow("CreateTweet unknown failure");
  });

  it("throws when entire data structure is null", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult(null));

    await expect(
      createTweet({ cookies: COOKIES, ct0: CT0, text: "null data" })
    ).rejects.toThrow("CreateTweet unknown failure");
  });

  it("throws when create_tweet is missing", async () => {
    mockXFetch.mockResolvedValue(makeSuccessResult({ data: {} }));

    await expect(
      createTweet({ cookies: COOKIES, ct0: CT0, text: "no create_tweet" })
    ).rejects.toThrow("CreateTweet unknown failure");
  });

  it("extracts tweetId from rest_id correctly", async () => {
    mockXFetch.mockResolvedValue(
      makeSuccessResult(makeValidCreateTweetResponse("600", "Extracted text!"))
    );

    const result = await createTweet({
      cookies: COOKIES,
      ct0: CT0,
      text: "Extracted text!",
    });

    expect(result.tweetId).toBe("600");
  });
});
