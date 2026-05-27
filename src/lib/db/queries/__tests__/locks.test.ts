// Tests for src/lib/db/queries/locks.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock functions ───
const { mockFindMany, mockUpdateMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db/db", () => ({
  db: {
    tweet: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("@/config/constants", () => ({
  STALE_LOCK_THRESHOLD_MS: 5 * 60 * 1000, // 5 min
}));

// Import after mocks are set up
import {
  acquirePostingLock,
  releasePostingLock,
  findStaleLocks,
  recoverStaleLocks,
} from "@/lib/db/queries/locks";

// ─── Shared fixtures ───
const staleTweet = {
  id: "tweet-1",
  accountId: "acc-1",
  content: "Stale tweet",
  status: "sending",
  lockedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
  lockedBy: "cron",
  account: { username: "testuser" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── acquirePostingLock ───
describe("acquirePostingLock", () => {
  it("returns true when lock is acquired (CAS succeeds)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const result = await acquirePostingLock("tweet-1", "cron");
    expect(result).toBe(true);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "tweet-1", lockedAt: null },
      data: { lockedAt: expect.any(Date), lockedBy: "cron" },
    });
  });

  it("returns false when tweet is already locked", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const result = await acquirePostingLock("tweet-1", "manual");
    expect(result).toBe(false);
  });

  it("sets lockedBy to the provided executor", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await acquirePostingLock("tweet-1", "manual");
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockedBy: "manual" }),
      })
    );
  });

  it("sets lockedAt to current date", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const before = new Date();
    await acquirePostingLock("tweet-1", "cron");
    const call = mockUpdateMany.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toHaveProperty('data');
    const callData = (call?.[0] as { data: { lockedAt: Date } }).data;
    expect(callData.lockedAt).toBeInstanceOf(Date);
    expect(callData.lockedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime()
    );
  });
});

// ─── releasePostingLock ───
describe("releasePostingLock", () => {
  it("releases lock by executor", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await releasePostingLock("tweet-1", "cron");
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "tweet-1", lockedBy: "cron" },
      data: { lockedAt: null, lockedBy: null },
    });
  });

  it("only releases lock held by the same executor", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    await releasePostingLock("tweet-1", "manual");
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "tweet-1", lockedBy: "manual" },
      data: { lockedAt: null, lockedBy: null },
    });
  });
});

// ─── findStaleLocks ───
describe("findStaleLocks", () => {
  it("finds tweets in sending status with locks older than threshold", async () => {
    mockFindMany.mockResolvedValue([staleTweet]);
    const result = await findStaleLocks();
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        status: "sending",
        lockedAt: { lt: expect.any(Date) },
      },
      include: { account: { select: { username: true } } },
    });
    expect(result).toEqual([staleTweet]);
  });

  it("returns empty array when no stale locks", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await findStaleLocks();
    expect(result).toEqual([]);
  });

  it("uses threshold to compute the cutoff date", async () => {
    mockFindMany.mockResolvedValue([]);
    const beforeCall = Date.now();
    await findStaleLocks();
    const call = mockFindMany.mock.calls[0];
    expect(call).toBeDefined();
    const callArg = call?.[0] as { where: { lockedAt: { lt: Date } } };
    const threshold = callArg.where.lockedAt.lt;
    // Threshold should be approximately (now - 5 min)
    const expectedThreshold = new Date(beforeCall - 5 * 60 * 1000);
    // Allow 1 second tolerance
    expect(Math.abs(threshold.getTime() - expectedThreshold.getTime())).toBeLessThan(1000);
  });
});

// ─── recoverStaleLocks ───
describe("recoverStaleLocks", () => {
  it("recovers stale locks and returns count of recovered tweets", async () => {
    const staleTweet2 = { ...staleTweet, id: "tweet-2" };
    mockFindMany.mockResolvedValue([staleTweet, staleTweet2]);
    mockUpdateMany.mockResolvedValue({ count: 1 }); // Each updateMany returns count: 1

    const result = await recoverStaleLocks();
    expect(result).toBe(2);
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
  });

  it("resets status to scheduled and clears lock fields", async () => {
    mockFindMany.mockResolvedValue([staleTweet]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await recoverStaleLocks();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "tweet-1", status: "sending" },
      data: { status: "scheduled", lockedAt: null, lockedBy: null },
    });
  });

  it("only counts tweets where CAS update succeeded", async () => {
    const staleTweet2 = { ...staleTweet, id: "tweet-2" };
    mockFindMany.mockResolvedValue([staleTweet, staleTweet2]);
    // First update succeeds, second fails (already recovered by another process)
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await recoverStaleLocks();
    expect(result).toBe(1);
  });

  it("returns 0 when no stale locks found", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await recoverStaleLocks();
    expect(result).toBe(0);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
