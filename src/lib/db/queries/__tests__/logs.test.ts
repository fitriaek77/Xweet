// Tests for src/lib/db/queries/logs.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock functions ───
const { mockCreate, mockFindMany } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/db/db", () => ({
  db: {
    scheduleLog: {
      create: mockCreate,
      findMany: mockFindMany,
    },
  },
}));

// Import after mocks are set up
import { createLog, getLogs } from "@/lib/db/queries/logs";

// ─── Shared fixtures ───
const fakeLog = {
  id: "log-1",
  tweetId: "tweet-1",
  accountId: "acc-1",
  action: "send",
  detail: "Tweet sent successfully",
  durationMs: 1234,
  createdAt: new Date("2025-01-01T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createLog ───
describe("createLog", () => {
  it("creates a log entry with all fields", async () => {
    const data = {
      tweetId: "tweet-1",
      accountId: "acc-1",
      action: "send",
      detail: "Tweet sent successfully",
      durationMs: 1234,
    };
    mockCreate.mockResolvedValue(fakeLog);

    const result = await createLog(data);
    expect(mockCreate).toHaveBeenCalledWith({ data });
    expect(result).toEqual(fakeLog);
  });

  it("creates a log entry with only required action field", async () => {
    const data = { action: "cron_tick" };
    const minimalLog = {
      id: "log-2",
      tweetId: null,
      accountId: null,
      action: "cron_tick",
      detail: null,
      durationMs: null,
      createdAt: new Date("2025-01-01T10:00:00Z"),
    };
    mockCreate.mockResolvedValue(minimalLog);

    const result = await createLog(data);
    expect(mockCreate).toHaveBeenCalledWith({ data });
    expect(result.action).toBe("cron_tick");
  });

  it("creates a log entry with partial optional fields", async () => {
    const data = {
      tweetId: "tweet-2",
      action: "fail",
      detail: "Rate limited",
    };
    mockCreate.mockResolvedValue({
      ...fakeLog,
      tweetId: "tweet-2",
      action: "fail",
      detail: "Rate limited",
    });

    await createLog(data);
    expect(mockCreate).toHaveBeenCalledWith({ data });
  });
});

// ─── getLogs ───
describe("getLogs", () => {
  it("calls findMany with default limit/offset when no filters", async () => {
    mockFindMany.mockResolvedValue([fakeLog]);
    const result = await getLogs();
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 50,
      skip: 0,
    });
    expect(result).toEqual([fakeLog]);
  });

  it("applies tweetId filter", async () => {
    mockFindMany.mockResolvedValue([fakeLog]);
    await getLogs({ tweetId: "tweet-1" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tweetId: "tweet-1" },
      })
    );
  });

  it("applies accountId filter", async () => {
    mockFindMany.mockResolvedValue([fakeLog]);
    await getLogs({ accountId: "acc-1" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: "acc-1" },
      })
    );
  });

  it("applies action filter", async () => {
    mockFindMany.mockResolvedValue([]);
    await getLogs({ action: "send" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: "send" },
      })
    );
  });

  it("applies multiple filters together", async () => {
    mockFindMany.mockResolvedValue([]);
    await getLogs({ tweetId: "tweet-1", accountId: "acc-1", action: "send" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tweetId: "tweet-1",
          accountId: "acc-1",
          action: "send",
        },
      })
    );
  });

  it("applies custom limit and offset", async () => {
    mockFindMany.mockResolvedValue([]);
    await getLogs({ limit: 10, offset: 5 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 5,
      })
    );
  });

  it("returns empty array when no logs match", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await getLogs({ action: "nonexistent" });
    expect(result).toEqual([]);
  });
});
