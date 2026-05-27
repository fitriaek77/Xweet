// Tests for src/lib/validations/tweet.ts
import { describe, it, expect } from "vitest";
import { createTweetSchema, updateTweetSchema, postNowSchema } from "@/lib/validations/tweet";

describe("createTweetSchema", () => {
  it("validates valid tweet data", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello world!",
      scheduledAt: "2024-06-15T14:30:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("validates tweet with media", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "With image",
      scheduledAt: "2024-06-15T14:30:00Z",
      mediaBase64: "aGVsbG8=",
      mediaMimeType: "image/png",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty accountId", () => {
    const result = createTweetSchema.safeParse({
      accountId: "",
      content: "Hello",
      scheduledAt: "2024-06-15T14:30:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "",
      scheduledAt: "2024-06-15T14:30:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content over 280 characters", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "a".repeat(281),
      scheduledAt: "2024-06-15T14:30:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts content exactly 280 characters", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "a".repeat(280),
      scheduledAt: "2024-06-15T14:30:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello",
      scheduledAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported media type", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello",
      scheduledAt: "2024-06-15T14:30:00Z",
      mediaMimeType: "application/pdf",
    });
    expect(result.success).toBe(false);
  });

  it("accepts image/png media type", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello",
      scheduledAt: "2024-06-15T14:30:00Z",
      mediaMimeType: "image/png",
    });
    expect(result.success).toBe(true);
  });

  it("accepts image/jpeg media type", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello",
      scheduledAt: "2024-06-15T14:30:00Z",
      mediaMimeType: "image/jpeg",
    });
    expect(result.success).toBe(true);
  });

  it("accepts image/gif media type", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello",
      scheduledAt: "2024-06-15T14:30:00Z",
      mediaMimeType: "image/gif",
    });
    expect(result.success).toBe(true);
  });

  it("accepts video/mp4 media type", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello",
      scheduledAt: "2024-06-15T14:30:00Z",
      mediaMimeType: "video/mp4",
    });
    expect(result.success).toBe(true);
  });

  it("accepts video/quicktime media type", () => {
    const result = createTweetSchema.safeParse({
      accountId: "clx123",
      content: "Hello",
      scheduledAt: "2024-06-15T14:30:00Z",
      mediaMimeType: "video/quicktime",
    });
    expect(result.success).toBe(true);
  });
});

describe("updateTweetSchema", () => {
  it("validates partial update with content", () => {
    const result = updateTweetSchema.safeParse({
      content: "Updated content",
    });
    expect(result.success).toBe(true);
  });

  it("validates partial update with status", () => {
    const result = updateTweetSchema.safeParse({
      status: "cancelled",
    });
    expect(result.success).toBe(true);
  });

  it("validates scheduled status", () => {
    const result = updateTweetSchema.safeParse({
      status: "scheduled",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateTweetSchema.safeParse({
      status: "invalid_status",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = updateTweetSchema.safeParse({
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content over 280 chars", () => {
    const result = updateTweetSchema.safeParse({
      content: "a".repeat(281),
    });
    expect(result.success).toBe(false);
  });

  it("validates empty object", () => {
    const result = updateTweetSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("postNowSchema", () => {
  it("validates manual executor", () => {
    const result = postNowSchema.safeParse({
      executor: "manual",
    });
    expect(result.success).toBe(true);
  });

  it("defaults to manual executor", () => {
    const result = postNowSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executor).toBe("manual");
    }
  });

  it("rejects invalid executor", () => {
    const result = postNowSchema.safeParse({
      executor: "cron",
    });
    expect(result.success).toBe(false);
  });
});
