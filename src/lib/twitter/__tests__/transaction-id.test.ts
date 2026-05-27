// Tests for src/lib/twitter/transaction-id.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import at top level to avoid module caching issues
import { generateTransactionId, clearTidCache } from "@/lib/twitter/transaction-id";

describe("generateTransactionId", () => {
  beforeEach(() => {
    clearTidCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when both layers fail (no network)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const tid = await generateTransactionId("POST", "/2/tweet/create");
    expect(tid).toBeNull();
  });

  it("generates TID from pair-dict when CDN is available", async () => {
    const mockPairs = [
      {
        verification: "dGVzdHZlcmlmaWNhdGlvbg==",
        animationKey: "abc123def456",
      },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPairs),
    }));

    const tid = await generateTransactionId("POST", "/2/tweet/create");
    
    expect(tid).toBeTruthy();
    expect(tid).not.toBeNull();
    if (tid) {
      // Should be base64-encoded (alphanumeric + / +)
      expect(tid).toMatch(/^[A-Za-z0-9+/]+$/);
    }
  });

  it("caches pair data and reuses it", async () => {
    const mockPairs = [
      {
        verification: "dGVzdHZlcmlmaWNhdGlvbg==",
        animationKey: "abc123def456",
      },
    ];

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: true, json: () => Promise.resolve(mockPairs) };
    }));

    await generateTransactionId("POST", "/path1");
    await generateTransactionId("POST", "/path2");
    // Only one fetch call because pairs are cached
    expect(callCount).toBe(1);
  });

  it("returns null when fetch returns non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
    );
    
    const tid = await generateTransactionId("POST", "/test");
    expect(tid).toBeNull();
  });

  it("returns different TIDs for different paths", async () => {
    const mockPairs = [
      {
        verification: "dGVzdHZlcmlmaWNhdGlvbg==",
        animationKey: "abc123def456",
      },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPairs),
    }));

    const tid1 = await generateTransactionId("POST", "/path1");
    const tid2 = await generateTransactionId("POST", "/path2");
    // Different paths produce different TIDs (different hash input)
    expect(tid1).not.toBe(tid2);
  });
});

describe("clearTidCache", () => {
  it("clears the pair cache and LQM cache", () => {
    // Just verify the function doesn't throw
    expect(() => { clearTidCache(); }).not.toThrow();
  });

  it("allows re-fetching after cache is cleared", async () => {
    const mockPairs = [
      {
        verification: "dGVzdHZlcmlmaWNhdGlvbg==",
        animationKey: "abc123",
      },
    ];

    // First, populate cache
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPairs),
    }));

    const tid1 = await generateTransactionId("POST", "/test");
    expect(tid1).toBeTruthy();

    // Clear cache
    clearTidCache();

    // After clearing, should still work with new fetch
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPairs),
    }));

    const tid2 = await generateTransactionId("POST", "/test");
    expect(tid2).toBeTruthy();
  });
});
