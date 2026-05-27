// Tests for src/lib/twitter/client.ts
/** Safely get nth mock call without non-null assertion. */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { TwitterApiError } from "@/lib/api/errors";
import {
  xFetch,
  type XFetchParams,
  parseCreateTweetResponse,
  parseCreateScheduledTweetResponse,
  parseScheduledMutationResponse,
  parseFetchScheduledResponse,
  resilientApiCall,
} from "@/lib/twitter/client";

// ─── Mock dependencies ───────────────────────────────────────────────────────

vi.mock("@/lib/twitter/headers", () => ({
  getHeaders: vi.fn().mockResolvedValue({
    "user-agent": "Mozilla/5.0 Test",
    "sec-ch-ua": '"Chromium";v="137"',
    accept: "*/*",
  }),
}));

vi.mock("@/lib/twitter/transaction-id", () => ({
  generateTransactionId: vi.fn().mockResolvedValue("fake-tid-123"),
}));

vi.mock("@/lib/twitter/ct0-refresh", () => ({
  refreshCt0: vi.fn().mockResolvedValue(null),
  updateCt0InCookieString: vi.fn(
    (cookies: string, newCt0: string, newTwid?: string) => {
      let result = cookies.replace(/ct0=[^;]+/, `ct0=${newCt0}`);
      if (newTwid) {
        result = result.replace(/twid=[^;]+/, `twid=${newTwid}`);
      }
      return result;
    }
  ),
}));

vi.mock("@/config/constants", () => ({
  X_API_BASE: "https://x.com/i/api",
  X_BEARER_TOKEN:
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
  X_BASE_URL: "https://x.com",
}));

// ─── Import mocked modules ───────────────────────────────────────────────────

import { generateTransactionId, clearTidCache } from "@/lib/twitter/transaction-id";
import { refreshCt0, updateCt0InCookieString } from "@/lib/twitter/ct0-refresh";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely get nth mock call without non-null assertion. */
function getCall(mock: Mock, index: number) {
  const call = mock.mock.calls.at(index);
  if (!call) throw new Error(`No mock call at index ${index}`);
  return call;
}

const DEFAULT_COOKIES = "auth_token=abc123; ct0=oldct0; twid=oldtwid";
const DEFAULT_CT0 = "oldct0";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTextResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function defaultParams(overrides?: Partial<XFetchParams>): XFetchParams {
  return {
    method: "GET",
    path: "/graphql/test/Endpoint",
    cookies: DEFAULT_COOKIES,
    ct0: DEFAULT_CT0,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("xFetch", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
  });

  // ── Success cases ──────────────────────────────────────────────────────

  describe("success cases", () => {
    it("returns ok result with JSON data on 200", async () => {
      const result = await xFetch(defaultParams());

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: { success: true },
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("makes GET request without body", async () => {
      await xFetch(defaultParams({ method: "GET" }));

      const [, init] = getCall(fetchMock, 0);
      expect(init.method).toBe("GET");
      expect(init.body).toBeNull();
    });

    it("makes POST request with JSON body and Content-Type header", async () => {
      await xFetch(
        defaultParams({
          method: "POST",
          body: { variables: { text: "hello" } },
        })
      );

      const [, init] = getCall(fetchMock, 0);
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ variables: { text: "hello" } }));
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("skips TID generation when skipTid=true", async () => {
      await xFetch(defaultParams({ skipTid: true }));

      expect(generateTransactionId).not.toHaveBeenCalled();

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["x-client-transaction-id"]).toBeUndefined();
    });

    it("includes TID header when skipTid is false (default)", async () => {
      await xFetch(defaultParams());

      expect(generateTransactionId).toHaveBeenCalledWith(
        "GET",
        "/graphql/test/Endpoint"
      );

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["x-client-transaction-id"]).toBe("fake-tid-123");
    });
  });

  // ── URL construction ───────────────────────────────────────────────────

  it("constructs URL from X_API_BASE + path", async () => {
    await xFetch(defaultParams({ path: "/graphql/abc/CreateTweet" }));

    const [url] = getCall(fetchMock, 0);
    expect(url).toBe("https://x.com/i/api/graphql/abc/CreateTweet");
  });

  // ── Header construction (tests buildRequestHeaders indirectly) ─────────

  describe("buildRequestHeaders (via xFetch)", () => {
    it("includes all mandatory anti-detection headers", async () => {
      await xFetch(defaultParams());

      const [, init] = getCall(fetchMock, 0);
      const headers = init.headers as Record<string, string>;

      expect(headers["X-Twitter-Auth-Type"]).toBe("OAuth2Session");
      expect(headers["X-Twitter-Active-User"]).toBe("yes");
      expect(headers["X-Twitter-Client-Language"]).toBe("en");
      expect(headers["Referer"]).toBe("https://x.com/");
      expect(headers["Origin"]).toBe("https://x.com");
      expect(headers["Cache-Control"]).toBe("no-cache");
      expect(headers["Pragma"]).toBe("no-cache");
      expect(headers["Priority"]).toBe("u=1, i");
    });

    it("includes Authorization bearer token", async () => {
      await xFetch(defaultParams());

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["Authorization"]).toMatch(/^Bearer /);
    });

    it("includes Cookie and X-Csrf-Token headers", async () => {
      await xFetch(defaultParams());

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["Cookie"]).toBe(DEFAULT_COOKIES);
      expect(init.headers["X-Csrf-Token"]).toBe(DEFAULT_CT0);
    });

    it("includes Content-Type when body is provided", async () => {
      await xFetch(defaultParams({ method: "POST", body: { foo: "bar" } }));

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("omits Content-Type when no body is provided", async () => {
      await xFetch(defaultParams({ method: "GET" }));

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["Content-Type"]).toBeUndefined();
    });

    it("includes x-client-transaction-id when TID is generated", async () => {
      await xFetch(defaultParams());

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["x-client-transaction-id"]).toBe("fake-tid-123");
    });

    it("excludes x-client-transaction-id when skipTid=true (tid is null)", async () => {
      await xFetch(defaultParams({ skipTid: true }));

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["x-client-transaction-id"]).toBeUndefined();
    });

    it("merges headerProfile keys into headers", async () => {
      await xFetch(defaultParams());

      const [, init] = getCall(fetchMock, 0);
      expect(init.headers["user-agent"]).toBe("Mozilla/5.0 Test");
    });
  });

  // ── 401/403 auto-refresh (tests attemptCt0Refresh indirectly) ─────────

  describe("ct0 auto-refresh on 401/403", () => {
    it("on 401: attempts ct0 refresh and retries with updated cookies", async () => {
      // First call returns 401, second call (retry) returns 200
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ error: "unauthorized" }, 401))
        .mockResolvedValueOnce(makeJsonResponse({ success: true }, 200));

      (refreshCt0 as Mock).mockResolvedValueOnce({
        ct0: "fresh_ct0",
        twid: "fresh_twid",
        ct0MaxAge: 10800,
      });

      const result = await xFetch(
        defaultParams({ cookies: "auth_token=abc123; ct0=oldct0" })
      );

      // Should have called refreshCt0 with auth_token
      expect(refreshCt0).toHaveBeenCalledWith("abc123");

      // Should have updated cookies
      expect(updateCt0InCookieString).toHaveBeenCalledWith(
        "auth_token=abc123; ct0=oldct0",
        "fresh_ct0",
        "fresh_twid"
      );

      // Should have made 2 fetch calls
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Retry should use updated ct0
      const [, retryInit] = getCall(fetchMock, 1);
      expect(retryInit.headers["X-Csrf-Token"]).toBe("fresh_ct0");

      // Result should have updatedCookies
      expect(result.updatedCookies).toBeDefined();
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ success: true });
    });

    it("on 403: attempts ct0 refresh and retries with updated cookies", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ error: "forbidden" }, 403))
        .mockResolvedValueOnce(makeJsonResponse({ success: true }, 200));

      (refreshCt0 as Mock).mockResolvedValueOnce({
        ct0: "fresh_ct0",
        twid: "fresh_twid",
        ct0MaxAge: 10800,
      });

      const result = await xFetch(
        defaultParams({ cookies: "auth_token=abc123; ct0=oldct0" })
      );

      expect(refreshCt0).toHaveBeenCalledWith("abc123");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      expect(result.updatedCookies).toBeDefined();
    });

    it("on 401 when ct0 refresh returns null: does NOT retry, throws TwitterApiError", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({ error: "unauthorized" }, 401)
      );

      (refreshCt0 as Mock).mockResolvedValueOnce(null);

      await expect(
        xFetch(defaultParams({ cookies: "auth_token=abc123; ct0=oldct0" }))
      ).rejects.toThrow(TwitterApiError);

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("on 401 when ct0 refresh returns negative Max-Age: does NOT retry", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({ error: "unauthorized" }, 401)
      );

      (refreshCt0 as Mock).mockResolvedValueOnce({
        ct0: "expired_ct0",
        twid: "some_twid",
        ct0MaxAge: -1,
      });

      await expect(
        xFetch(defaultParams({ cookies: "auth_token=abc123; ct0=oldct0" }))
      ).rejects.toThrow(TwitterApiError);

      // Only one fetch call (no retry)
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("on 401 when cookies have no auth_token: refreshCt0 is not called, throws", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({ error: "unauthorized" }, 401)
      );

      await expect(
        xFetch(
          defaultParams({ cookies: "ct0=oldct0; twid=oldtwid" }) // no auth_token
        )
      ).rejects.toThrow(TwitterApiError);

      // attemptCt0Refresh should return null early, so refreshCt0 never called
      expect(refreshCt0).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("retry on 401 with POST body re-sends the body", async () => {
      const body = { variables: { text: "hello" } };

      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ error: "unauth" }, 401))
        .mockResolvedValueOnce(makeJsonResponse({ success: true }, 200));

      (refreshCt0 as Mock).mockResolvedValueOnce({
        ct0: "fresh_ct0",
        twid: "fresh_twid",
        ct0MaxAge: 10800,
      });

      await xFetch(
        defaultParams({
          method: "POST",
          body,
          cookies: "auth_token=abc; ct0=old",
        })
      );

      // Both calls should have the body
      const [, firstInit] = getCall(fetchMock, 0);
      const [, retryInit] = getCall(fetchMock, 1);
      expect(firstInit.body).toBe(JSON.stringify(body));
      expect(retryInit.body).toBe(JSON.stringify(body));
    });

    it("retry uses same TID as original request", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ error: "unauth" }, 401))
        .mockResolvedValueOnce(makeJsonResponse({ success: true }, 200));

      (refreshCt0 as Mock).mockResolvedValueOnce({
        ct0: "fresh_ct0",
        twid: "fresh_twid",
        ct0MaxAge: 10800,
      });

      await xFetch(
        defaultParams({ cookies: "auth_token=abc; ct0=old" })
      );

      const [, firstInit] = getCall(fetchMock, 0);
      const [, retryInit] = getCall(fetchMock, 1);
      expect(firstInit.headers["x-client-transaction-id"]).toBe("fake-tid-123");
      expect(retryInit.headers["x-client-transaction-id"]).toBe("fake-tid-123");
    });
  });

  // ── Non-ok, non-401/403 responses ──────────────────────────────────────

  describe("error responses", () => {
    it("throws TwitterApiError on non-ok non-401/403 response", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({ errors: ["rate limited"] }, 429)
      );

      try {
        await xFetch(defaultParams());
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TwitterApiError);
        expect((err as TwitterApiError).twitterStatus).toBe(429);
        expect((err as TwitterApiError).message).toContain("429");
        expect((err as TwitterApiError).message).toContain(
          "/graphql/test/Endpoint"
        );
      }
    });

    it("throws TwitterApiError with detail from JSON data", async () => {
      const errorData = { errors: [{ message: "Rate limit exceeded" }] };
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(errorData, 429)
      );

      try {
        await xFetch(defaultParams());
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TwitterApiError);
        expect((err as TwitterApiError).detail).toBe(
          JSON.stringify(errorData)
        );
      }
    });
  });

  // ── safeParseJson fallback ─────────────────────────────────────────────

  describe("safeParseJson fallback", () => {
    it("returns parsed JSON on valid JSON response", async () => {
      fetchMock.mockResolvedValueOnce(makeJsonResponse({ key: "value" }));

      const result = await xFetch(defaultParams());
      expect(result.data).toEqual({ key: "value" });
    });

    it("returns raw text on non-JSON response", async () => {
      fetchMock.mockResolvedValueOnce(makeTextResponse("not json <html>"));

      const result = await xFetch(defaultParams());
      expect(result.data).toBe("not json <html>");
    });

    it("handles non-JSON error body in TwitterApiError detail", async () => {
      fetchMock.mockResolvedValueOnce(makeTextResponse("Server Error", 500));

      try {
        await xFetch(defaultParams());
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TwitterApiError);
        expect((err as TwitterApiError).detail).toBe("Server Error");
      }
    });
  });

  // ── Request signal / timeout ───────────────────────────────────────────

  it("uses AbortSignal.timeout for request", async () => {
    await xFetch(defaultParams());

    const [, init] = getCall(fetchMock, 0);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ── attemptCt0Refresh (tested indirectly via xFetch 401/403 flow) ────────

describe("attemptCt0Refresh (via xFetch)", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns null when cookies contain no auth_token (no retry)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: "unauthorized" }, 401)
    );

    await expect(
      xFetch(defaultParams({ cookies: "ct0=old; twid=old" }))
    ).rejects.toThrow(TwitterApiError);

    expect(refreshCt0).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null when refreshCt0 returns null (no retry)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: "unauthorized" }, 401)
    );
    (refreshCt0 as Mock).mockResolvedValueOnce(null);

    await expect(
      xFetch(defaultParams({ cookies: "auth_token=abc; ct0=old" }))
    ).rejects.toThrow(TwitterApiError);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null when refreshCt0 returns ct0MaxAge < 0 (no retry)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: "unauthorized" }, 401)
    );
    (refreshCt0 as Mock).mockResolvedValueOnce({
      ct0: "expired",
      twid: "twid",
      ct0MaxAge: -5,
    });

    await expect(
      xFetch(defaultParams({ cookies: "auth_token=abc; ct0=old" }))
    ).rejects.toThrow(TwitterApiError);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns updated cookies and ct0 on successful refresh", async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ error: "unauth" }, 401))
      .mockResolvedValueOnce(makeJsonResponse({ ok: true }, 200));

    (refreshCt0 as Mock).mockResolvedValueOnce({
      ct0: "new_ct0_value",
      twid: "new_twid_value",
      ct0MaxAge: 10800,
    });

    const result = await xFetch(
      defaultParams({ cookies: "auth_token=abc; ct0=old" })
    );

    expect(result.ok).toBe(true);
    expect(result.updatedCookies).toBeDefined();
    expect(result.updatedCookies).toContain("ct0=new_ct0_value");
  });
});

// ── Response parsing tests ──────────────────────────────────────────────────

describe("parseCreateTweetResponse", () => {
  it("returns success when rest_id is present", () => {
    const body = {
      data: {
        create_tweet: {
          tweet_results: {
            result: { rest_id: "1234567890" },
          },
        },
      },
    };

    const result = parseCreateTweetResponse(body);

    expect(result).toEqual({ kind: "success", tweetId: "1234567890" });
  });

  it("returns success even when errors[] exists alongside tweetId", () => {
    const body = {
      data: {
        create_tweet: {
          tweet_results: {
            result: { rest_id: "123" },
          },
        },
      },
      errors: [{ message: "warning" }],
    };

    const result = parseCreateTweetResponse(body);

    expect(result).toEqual({ kind: "success", tweetId: "123" });
  });

  it("returns empty_results when tweet_results is empty object", () => {
    const body = {
      data: {
        create_tweet: {
          tweet_results: {},
        },
      },
    };

    const result = parseCreateTweetResponse(body);

    expect(result).toEqual({ kind: "empty_results" });
  });

  it("returns graphql_error when errors array is present", () => {
    const body = {
      errors: [{ message: "code: 344" }],
    };

    const result = parseCreateTweetResponse(body);

    expect(result.kind).toBe("graphql_error");
    if (result.kind === "graphql_error") {
      expect(result.errorClass).toBe("stale_cache");
    }
  });

  it("returns unknown_failure when body has no recognizable structure", () => {
    const body = { random: "data" };

    const result = parseCreateTweetResponse(body);

    expect(result).toEqual({ kind: "unknown_failure", body });
  });

  it("handles null body gracefully", () => {
    const result = parseCreateTweetResponse(null);

    expect(result.kind).toBe("unknown_failure");
  });

  it("handles undefined body gracefully", () => {
    const result = parseCreateTweetResponse(undefined);

    expect(result.kind).toBe("unknown_failure");
  });
});

describe("parseCreateScheduledTweetResponse", () => {
  it("returns success when rest_id is present", () => {
    const body = {
      data: {
        create_scheduled_tweet: {
          scheduled_tweet: { rest_id: "sched_123" },
        },
      },
    };

    const result = parseCreateScheduledTweetResponse(body);

    expect(result).toEqual({ kind: "success", restId: "sched_123" });
  });

  it("returns graphql_error when createResult exists but no restId, with top-level errors", () => {
    const body = {
      data: {
        create_scheduled_tweet: {},
      },
      errors: [{ message: "code: 88" }],
    };

    const result = parseCreateScheduledTweetResponse(body);

    expect(result.kind).toBe("graphql_error");
  });

  it("returns unknown_failure when createResult exists but no restId and no errors", () => {
    const body = {
      data: {
        create_scheduled_tweet: {},
      },
    };

    const result = parseCreateScheduledTweetResponse(body);

    expect(result).toEqual({ kind: "unknown_failure", body });
  });

  it("returns graphql_error for top-level errors without createResult", () => {
    const body = {
      errors: [{ message: "code: 131" }],
    };

    const result = parseCreateScheduledTweetResponse(body);

    expect(result.kind).toBe("graphql_error");
  });

  it("returns unknown_failure for empty body", () => {
    const result = parseCreateScheduledTweetResponse({});

    expect(result).toEqual({ kind: "unknown_failure", body: {} });
  });

  it("handles null body gracefully", () => {
    const result = parseCreateScheduledTweetResponse(null);

    expect(result.kind).toBe("unknown_failure");
  });
});

describe("parseScheduledMutationResponse", () => {
  it("returns done for scheduledtweet_put = 'Done'", () => {
    const body = {
      data: {
        scheduledtweet_put: "Done",
      },
    };

    const result = parseScheduledMutationResponse(body, "scheduledtweet_put");

    expect(result).toEqual({ kind: "done" });
  });

  it("returns done for scheduledtweet_delete = 'Done'", () => {
    const body = {
      data: {
        scheduledtweet_delete: "Done",
      },
    };

    const result = parseScheduledMutationResponse(body, "scheduledtweet_delete");

    expect(result).toEqual({ kind: "done" });
  });

  it("returns graphql_error when errors are present", () => {
    const body = {
      errors: [{ message: "code: 64" }],
    };

    const result = parseScheduledMutationResponse(body, "scheduledtweet_put");

    expect(result.kind).toBe("graphql_error");
  });

  it("returns unknown_failure when mutation value is not 'Done'", () => {
    const body = {
      data: {
        scheduledtweet_put: "NotDone",
      },
    };

    const result = parseScheduledMutationResponse(body, "scheduledtweet_put");

    expect(result).toEqual({ kind: "unknown_failure", body });
  });

  it("returns unknown_failure for empty body", () => {
    const result = parseScheduledMutationResponse({}, "scheduledtweet_put");

    expect(result).toEqual({ kind: "unknown_failure", body: {} });
  });

  it("handles null body gracefully", () => {
    const result = parseScheduledMutationResponse(null, "scheduledtweet_delete");

    expect(result.kind).toBe("unknown_failure");
  });
});

describe("parseFetchScheduledResponse", () => {
  it("returns list with items when scheduled_tweet_list is present", () => {
    const items = [{ rest_id: "1" }, { rest_id: "2" }];
    const body = {
      data: {
        viewer: {
          scheduled_tweet_list: items,
        },
      },
    };

    const result = parseFetchScheduledResponse(body);

    expect(result).toEqual({ kind: "list", items });
  });

  it("returns list with empty array when viewer exists but no scheduled_tweet_list", () => {
    const body = {
      data: {
        viewer: {},
      },
    };

    const result = parseFetchScheduledResponse(body);

    expect(result).toEqual({ kind: "list", items: [] });
  });

  it("returns list with empty array when data exists but no viewer", () => {
    const body = {
      data: {},
    };

    const result = parseFetchScheduledResponse(body);

    expect(result).toEqual({ kind: "list", items: [] });
  });

  it("returns graphql_error when errors are present and no data", () => {
    const body = {
      errors: [{ message: "code: 88" }],
    };

    const result = parseFetchScheduledResponse(body);

    expect(result.kind).toBe("graphql_error");
  });

  it("returns unknown_failure for empty body with no data or errors", () => {
    const result = parseFetchScheduledResponse({});

    expect(result).toEqual({ kind: "unknown_failure", body: {} });
  });

  it("handles null body gracefully", () => {
    const result = parseFetchScheduledResponse(null);

    expect(result.kind).toBe("unknown_failure");
  });
});

// ── resilientApiCall tests ──────────────────────────────────────────────────

// Mock the cache-clearing functions
vi.mock("@/lib/twitter/query-id", () => ({
  clearQueryIdCache: vi.fn(),
}));

vi.mock("@/lib/twitter/headers", () => ({
  getHeaders: vi.fn().mockResolvedValue({
    "user-agent": "Mozilla/5.0 Test",
    "sec-ch-ua": '"Chromium";v="137"',
    accept: "*/*",
  }),
  clearHeaderCache: vi.fn(),
}));

vi.mock("@/lib/twitter/transaction-id", () => ({
  generateTransactionId: vi.fn().mockResolvedValue("fake-tid-123"),
  clearTidCache: vi.fn(),
}));

import { clearQueryIdCache } from "@/lib/twitter/query-id";
import { clearHeaderCache } from "@/lib/twitter/headers";

describe("resilientApiCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the result on success", async () => {
    const factory = vi.fn().mockResolvedValue("success-value");

    const result = await resilientApiCall(factory);

    expect(result).toBe("success-value");
    expect(factory).toHaveBeenCalledOnce();
  });

  it("bails on terminal errors (throws)", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("GRAPHQL_VALIDATION_FAILED"));

    await expect(resilientApiCall(factory)).rejects.toThrow(
      "GRAPHQL_VALIDATION_FAILED"
    );
  });

  it("clears caches and retries on stale_cache error (attempt 0)", async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error("code: 48")) // stale_cache
      .mockResolvedValueOnce("recovered");

    const result = await resilientApiCall(factory);

    expect(result).toBe("recovered");
    expect(clearQueryIdCache).toHaveBeenCalledOnce();
    expect(clearTidCache).toHaveBeenCalledOnce();
    expect(clearHeaderCache).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does NOT clear caches on stale_cache at attempt > 0 (bails)", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("code: 48"));

    await expect(resilientApiCall(factory, 1)).rejects.toThrow("code: 48");
    expect(clearQueryIdCache).not.toHaveBeenCalled();
  });

  it("retries on transient error (attempt < 3)", async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error("code: 131")) // transient
      .mockResolvedValueOnce("transient-recovered");

    const result = await resilientApiCall(factory);

    expect(result).toBe("transient-recovered");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("bails on transient error at attempt >= 3", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("code: 131"));

    await expect(resilientApiCall(factory, 3)).rejects.toThrow("code: 131");
  });

  it("retries on auth_failure at attempt 0", async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error("Could not authenticate you")) // auth_failure
      .mockResolvedValueOnce("auth-recovered");

    const result = await resilientApiCall(factory);

    expect(result).toBe("auth-recovered");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("bails on auth_failure at attempt > 0", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("Could not authenticate you"));

    await expect(resilientApiCall(factory, 1)).rejects.toThrow(
      "Could not authenticate you"
    );
  });

  it("bails on rate_limit errors", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("HTTP 429"));

    await expect(resilientApiCall(factory)).rejects.toThrow("HTTP 429");
  });

  it("bails on stealth_ban errors", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("code: 353"));

    await expect(resilientApiCall(factory)).rejects.toThrow("code: 353");
  });

  it("bails on duplicate_posted errors", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("code: 187"));

    await expect(resilientApiCall(factory)).rejects.toThrow("code: 187");
  });

  it("handles non-Error throws (string)", async () => {
    const factory = vi.fn().mockRejectedValue("string-error");

    await expect(resilientApiCall(factory)).rejects.toBe("string-error");
  });
});
