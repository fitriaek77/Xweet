// Tests for src/lib/twitter/query-id.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearQueryIdCache } from "@/lib/twitter/query-id";

describe("getQueryIds", () => {
  beforeEach(() => {
    clearQueryIdCache();
    vi.restoreAllMocks();
  });

  it("returns hardcoded fallback when all fetches fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const { getQueryIds } = await import("@/lib/twitter/query-id");
    const ids = await getQueryIds();
    expect(ids.CreateTweet).toBe("5CdvsV_zjv4L64XFifAglw");
    expect(ids.CreateScheduledTweet).toBe("LCVzRQGxOaGnOnYH01NQXg");
    expect(ids.FetchScheduledTweets).toBe("IT6ymOhStwEVyRHEpMzCgA");
    expect(ids.EditScheduledTweet).toBe("_mHkQ5LHpRRjSXKOcG6eZw");
    expect(ids.DeleteScheduledTweet).toBe("CTOVqej0JBXAZSwkp1US0g");
  });

  it("fetches and extracts queryIds from placeholder.json", async () => {
    // GraphQL.json expects an array — return array format for all fetches
    const graphqlArray = [
      { exports: { operationName: "CreateTweet", queryId: "newCreateTweet" } },
      { exports: { operationName: "CreateScheduledTweet", queryId: "newCreateScheduled" } },
      { exports: { operationName: "FetchScheduledTweets", queryId: "newFetchScheduled" } },
      { exports: { operationName: "EditScheduledTweet", queryId: "newEditScheduled" } },
      { exports: { operationName: "DeleteScheduledTweet", queryId: "newDeleteScheduled" } },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(graphqlArray),
    }));

    const { getQueryIds } = await import("@/lib/twitter/query-id");
    const ids = await getQueryIds();
    expect(ids.CreateTweet).toBe("newCreateTweet");
    expect(ids.CreateScheduledTweet).toBe("newCreateScheduled");
  });

  it("uses hardcoded fallback for missing keys in response", async () => {
    // GraphQL.json with only CreateTweet
    const graphqlArray = [
      { exports: { operationName: "CreateTweet", queryId: "newCreateTweet" } },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(graphqlArray),
    }));

    const { getQueryIds } = await import("@/lib/twitter/query-id");
    const ids = await getQueryIds();
    expect(ids.CreateTweet).toBe("newCreateTweet");
    expect(ids.CreateScheduledTweet).toBe("LCVzRQGxOaGnOnYH01NQXg"); // fallback
  });

  it("caches queryIds and returns cached on second call", async () => {
    let callCount = 0;
    const graphqlArray = [
      { exports: { operationName: "CreateTweet", queryId: `query-1` } },
    ];

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: () => Promise.resolve(graphqlArray),
      };
    }));

    const { getQueryIds } = await import("@/lib/twitter/query-id");
    const ids1 = await getQueryIds();
    const ids2 = await getQueryIds();
    expect(ids1.CreateTweet).toBe("query-1");
    expect(ids2.CreateTweet).toBe("query-1"); // cached
    // Multiple fetch calls happen in the first getQueryIds() (GraphQL.json + placeholder.json sources)
    // but the second call should use the cache and not make any new fetches
    const callsAfterFirst = callCount;
    await getQueryIds();
    expect(callCount).toBe(callsAfterFirst); // no new fetches on cached call
  });

  it("tries jsDelivr fallback when GitHub fetch fails", async () => {
    const graphqlArray = [
      { exports: { operationName: "CreateTweet", queryId: "fallbackQuery" } },
    ];

    // First call (GraphQL.json develop GitHub) fails, second (jsDelivr) succeeds
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("GitHub failed"))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(graphqlArray) });

    vi.stubGlobal("fetch", fetchMock);
    const { getQueryIds } = await import("@/lib/twitter/query-id");
    const ids = await getQueryIds();
    expect(ids.CreateTweet).toBe("fallbackQuery");
    // Multiple fetch calls expected (GraphQL sources + placeholder sources)
    expect(fetchMock).toHaveBeenCalled();
  });
});
