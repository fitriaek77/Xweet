// Tests for src/lib/db/queries/tweets.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ConflictError } from "@/lib/api/errors";

// ─── Hoisted mock functions (available inside vi.mock factories) ───
const { mockFindMany, mockFindUnique, mockCreate, mockUpdate, mockUpdateMany, mockDelete, mockCount } =
  vi.hoisted(() => ({
    mockFindMany: vi.fn(),
    mockFindUnique: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockUpdateMany: vi.fn(),
    mockDelete: vi.fn(),
    mockCount: vi.fn(),
  }));

vi.mock("@/lib/db/db", () => ({
  db: {
    tweet: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      delete: mockDelete,
      count: mockCount,
    },
  },
}));

// Import after mocks are set up
import {
  getTweets,
  getTweetById,
  createTweet,
  updateTweet,
  transitionTweetStatus,
  deleteTweet,
  getDueTweets,
  countXScheduledForAccount,
} from "@/lib/db/queries/tweets";

// ─── Shared fixtures ───
const fakeTweet = {
  id: "tweet-1",
  accountId: "acc-1",
  content: "Hello world",
  status: "scheduled",
  scheduledAt: new Date("2025-01-01T10:00:00Z"),
  postedAt: null,
  tweetId: null,
  failureReason: null,
  retryCount: 0,
  mediaMimeType: null,
  mediaCategory: null,
  mediaId: null,
  lockedAt: null,
  lockedBy: null,
  createdAt: new Date("2025-01-01T09:00:00Z"),
  account: { username: "testuser", avatarUrl: null },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getTweets ───
describe("getTweets", () => {
  it("calls findMany with default limit/offset when no filters", async () => {
    mockFindMany.mockResolvedValue([fakeTweet]);
    const result = await getTweets();
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { scheduledAt: "asc" },
      take: 50,
      skip: 0,
      include: { account: { select: { username: true, avatarUrl: true } } },
    });
    expect(result).toEqual([fakeTweet]);
  });

  it("applies accountId filter", async () => {
    mockFindMany.mockResolvedValue([fakeTweet]);
    await getTweets({ accountId: "acc-1" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: "acc-1" },
      })
    );
  });

  it("applies status filter", async () => {
    mockFindMany.mockResolvedValue([]);
    await getTweets({ status: "sent" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "sent" },
      })
    );
  });

  it("applies both accountId and status filters", async () => {
    mockFindMany.mockResolvedValue([]);
    await getTweets({ accountId: "acc-1", status: "scheduled" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: "acc-1", status: "scheduled" },
      })
    );
  });

  it("applies custom limit and offset", async () => {
    mockFindMany.mockResolvedValue([]);
    await getTweets({ limit: 10, offset: 20 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 20,
      })
    );
  });
});

// ─── getTweetById ───
describe("getTweetById", () => {
  it("returns tweet when found", async () => {
    mockFindUnique.mockResolvedValue(fakeTweet);
    const result = await getTweetById("tweet-1");
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "tweet-1" },
      include: { account: { select: { username: true, avatarUrl: true } } },
    });
    expect(result).toEqual(fakeTweet);
  });

  it("throws NotFoundError when tweet not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(getTweetById("nonexistent")).rejects.toThrow(NotFoundError);
    await expect(getTweetById("nonexistent")).rejects.toThrow(
      "Tweet not found: nonexistent"
    );
  });
});

// ─── createTweet ───
describe("createTweet", () => {
  it("creates and returns a new tweet", async () => {
    const data = {
      accountId: "acc-1",
      content: "New tweet",
      scheduledAt: new Date("2025-01-01T10:00:00Z"),
      status: "scheduled",
    };
    const created = { ...fakeTweet, ...data };
    mockCreate.mockResolvedValue(created);

    const result = await createTweet(data);
    expect(mockCreate).toHaveBeenCalledWith({ data });
    expect(result).toEqual(created);
  });
});

// ─── updateTweet ───
describe("updateTweet", () => {
  it("updates tweet when found", async () => {
    const updateData = { content: "Updated content" };
    const updated = { ...fakeTweet, ...updateData };
    mockFindUnique.mockResolvedValue(fakeTweet);
    mockUpdate.mockResolvedValue(updated);

    const result = await updateTweet("tweet-1", updateData);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "tweet-1" } });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "tweet-1" },
      data: updateData,
    });
    expect(result).toEqual(updated);
  });

  it("throws NotFoundError when tweet not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(updateTweet("nonexistent", { content: "x" })).rejects.toThrow(
      NotFoundError
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ─── transitionTweetStatus ───
describe("transitionTweetStatus", () => {
  it("returns true for valid transition when CAS succeeds", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const result = await transitionTweetStatus(
      "tweet-1",
      "scheduled",
      "sending"
    );
    expect(result).toBe(true);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "tweet-1", status: "scheduled" },
      data: { status: "sending" },
    });
  });

  it("returns false for valid transition when CAS fails (status changed)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const result = await transitionTweetStatus(
      "tweet-1",
      "scheduled",
      "sending"
    );
    expect(result).toBe(false);
  });

  it("passes extra data along with status change", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await transitionTweetStatus("tweet-1", "sending", "sent", {
      postedAt: new Date("2025-01-01T10:05:00Z"),
      tweetId: "x-tweet-123",
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "tweet-1", status: "sending" },
      data: {
        status: "sent",
        postedAt: new Date("2025-01-01T10:05:00Z"),
        tweetId: "x-tweet-123",
      },
    });
  });

  it("throws ConflictError for invalid transition: scheduled → sent", async () => {
    await expect(
      transitionTweetStatus("tweet-1", "scheduled", "sent")
    ).rejects.toThrow(ConflictError);
    await expect(
      transitionTweetStatus("tweet-1", "scheduled", "sent")
    ).rejects.toThrow("Invalid transition: scheduled → sent");
  });

  it("throws ConflictError for invalid transition: sent → scheduled", async () => {
    await expect(
      transitionTweetStatus("tweet-1", "sent", "scheduled")
    ).rejects.toThrow(ConflictError);
  });

  it("throws ConflictError for invalid transition: cancelled → anything", async () => {
    await expect(
      transitionTweetStatus("tweet-1", "cancelled", "scheduled")
    ).rejects.toThrow(ConflictError);
  });

  it("allows scheduled → x_scheduled transition", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const result = await transitionTweetStatus(
      "tweet-1",
      "scheduled",
      "x_scheduled"
    );
    expect(result).toBe(true);
  });

  it("allows failed → scheduled (retry) transition", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const result = await transitionTweetStatus(
      "tweet-1",
      "failed",
      "scheduled"
    );
    expect(result).toBe(true);
  });

  it("allows sending → scheduled (stale recovery) transition", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const result = await transitionTweetStatus(
      "tweet-1",
      "sending",
      "scheduled"
    );
    expect(result).toBe(true);
  });
});

// ─── deleteTweet ───
describe("deleteTweet", () => {
  it("deletes tweet when status is not sending", async () => {
    mockFindUnique.mockResolvedValue(fakeTweet); // status: "scheduled"
    mockDelete.mockResolvedValue(fakeTweet);

    const result = await deleteTweet("tweet-1");
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "tweet-1" } });
    expect(result).toEqual(fakeTweet);
  });

  it("throws ConflictError when tweet status is sending", async () => {
    const sendingTweet = { ...fakeTweet, status: "sending" };
    mockFindUnique.mockResolvedValue(sendingTweet);

    await expect(deleteTweet("tweet-1")).rejects.toThrow(ConflictError);
    await expect(deleteTweet("tweet-1")).rejects.toThrow(
      "Cannot delete tweet currently being sent"
    );
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when tweet not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(deleteTweet("nonexistent")).rejects.toThrow(NotFoundError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("allows delete when status is failed", async () => {
    const failedTweet = { ...fakeTweet, status: "failed" };
    mockFindUnique.mockResolvedValue(failedTweet);
    mockDelete.mockResolvedValue(failedTweet);

    const result = await deleteTweet("tweet-1");
    expect(result).toEqual(failedTweet);
    expect(mockDelete).toHaveBeenCalled();
  });
});

// ─── getDueTweets ───
describe("getDueTweets", () => {
  it("finds tweets with scheduled status, past scheduledAt, and no lock", async () => {
    mockFindMany.mockResolvedValue([fakeTweet]);
    const result = await getDueTweets();
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        status: "scheduled",
        scheduledAt: { lte: expect.any(Date) },
        lockedAt: null,
      },
      orderBy: { scheduledAt: "asc" },
      take: 20,
      include: { account: true },
    });
    expect(result).toEqual([fakeTweet]);
  });

  it("respects custom limit", async () => {
    mockFindMany.mockResolvedValue([]);
    await getDueTweets(5);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
  });
});

// ─── countXScheduledForAccount ───
describe("countXScheduledForAccount", () => {
  it("counts x_scheduled tweets for an account", async () => {
    mockCount.mockResolvedValue(42);
    const result = await countXScheduledForAccount("acc-1");
    expect(mockCount).toHaveBeenCalledWith({
      where: {
        accountId: "acc-1",
        status: "x_scheduled",
      },
    });
    expect(result).toBe(42);
  });

  it("returns 0 when no x_scheduled tweets exist", async () => {
    mockCount.mockResolvedValue(0);
    const result = await countXScheduledForAccount("acc-1");
    expect(result).toBe(0);
  });
});
