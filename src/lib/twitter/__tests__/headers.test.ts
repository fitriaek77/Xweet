// Tests for src/lib/twitter/headers.ts (unit tests for extractProfile logic)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import module once at top level to avoid module caching issues
import { getHeaders, clearHeaderCache } from "@/lib/twitter/headers";

describe("getHeaders", () => {
  beforeEach(() => {
    clearHeaderCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to hardcoded headers when all fetches fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const headers = await getHeaders();
    expect(headers["user-agent"]).toContain("Chrome");
    expect(headers["sec-fetch-site"]).toBe("same-origin");
  });

  it("extracts chrome-fetch profile from header.json", async () => {
    const mockData = {
      "chrome-fetch": {
        host: "x.com",
        connection: "keep-alive",
        "user-agent": "TestAgent/1.0",
        referer: "https://example.com/test",
        accept: "*/*",
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const headers = await getHeaders();
    
    // host and connection should be stripped
    expect(headers["host"]).toBeUndefined();
    expect(headers["connection"]).toBeUndefined();
    // referer should be replaced
    expect(headers["referer"]).toBe("https://x.com/");
    // Other headers should pass through
    expect(headers["user-agent"]).toBe("TestAgent/1.0");
    expect(headers["accept"]).toBe("*/*");
  });

  it("falls back to chrome profile if chrome-fetch not available", async () => {
    const mockData = {
      chrome: {
        "user-agent": "ChromeAgent/2.0",
        accept: "text/html",
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const headers = await getHeaders();
    expect(headers["user-agent"]).toBe("ChromeAgent/2.0");
  });

  it("tries jsDelivr fallback when GitHub fetch fails", async () => {
    const mockData = {
      "chrome-fetch": {
        "user-agent": "FallbackAgent/1.0",
      },
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false }) // GitHub fails
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockData) }); // jsDelivr succeeds

    vi.stubGlobal("fetch", fetchMock);
    const headers = await getHeaders();
    expect(headers["user-agent"]).toBe("FallbackAgent/1.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches headers and returns cached on second call", async () => {
    const mockData = {
      "chrome-fetch": { "user-agent": "CachedAgent/1.0" },
    };

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: true, json: () => Promise.resolve(mockData) };
    }));

    await getHeaders();
    await getHeaders();
    // Should only fetch once because of caching
    expect(callCount).toBe(1);
  });

  it("returns hardcoded headers when both CDN sources return non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
    );
    const headers = await getHeaders();
    expect(headers["user-agent"]).toContain("Chrome");
  });
});

describe("clearHeaderCache", () => {
  it("clears the cache so next call re-fetches", async () => {
    let callCount = 0;
    const mockData1 = {
      "chrome-fetch": { "user-agent": "First/1.0" },
    };
    const mockData2 = {
      "chrome-fetch": { "user-agent": "Second/2.0" },
    };

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: true, json: () => Promise.resolve(callCount === 1 ? mockData1 : mockData2) };
    }));

    const headers1 = await getHeaders();
    expect(headers1["user-agent"]).toBe("First/1.0");
    expect(callCount).toBe(1);
    
    // Without clearing, should return cached
    const headersCached = await getHeaders();
    expect(headersCached["user-agent"]).toBe("First/1.0");
    expect(callCount).toBe(1);
    
    clearHeaderCache();
    
    const headers2 = await getHeaders();
    expect(headers2["user-agent"]).toBe("Second/2.0");
    expect(callCount).toBe(2);
  });
});
