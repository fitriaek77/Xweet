// Tests for src/config/constants.ts
import { describe, it, expect } from "vitest";
import {
  TWEET_STATUS,
  VALID_TRANSITIONS,
  MAX_X_SCHEDULED_PER_ACCOUNT,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOLDOWN_MS,
  SESSION_COOKIE_NAME,
  AES_ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  FALLBACK_QUERY_IDS,
  MEDIA_CATEGORIES,
  MEDIA_UPLOAD_CHUNK_SIZE,
  APP_NAME,
} from "@/config/constants";

describe("TWEET_STATUS", () => {
  it("has all expected statuses", () => {
    expect(TWEET_STATUS.SCHEDULED).toBe("scheduled");
    expect(TWEET_STATUS.X_SCHEDULED).toBe("x_scheduled");
    expect(TWEET_STATUS.SENDING).toBe("sending");
    expect(TWEET_STATUS.SENT).toBe("sent");
    expect(TWEET_STATUS.FAILED).toBe("failed");
    expect(TWEET_STATUS.CANCELLED).toBe("cancelled");
  });
});

describe("VALID_TRANSITIONS", () => {
  it("allows scheduled → x_scheduled", () => {
    expect(VALID_TRANSITIONS.scheduled).toContain("x_scheduled");
  });

  it("allows scheduled → sending", () => {
    expect(VALID_TRANSITIONS.scheduled).toContain("sending");
  });

  it("allows scheduled → cancelled", () => {
    expect(VALID_TRANSITIONS.scheduled).toContain("cancelled");
  });

  it("allows x_scheduled → sent", () => {
    expect(VALID_TRANSITIONS.x_scheduled).toContain("sent");
  });

  it("allows x_scheduled → cancelled", () => {
    expect(VALID_TRANSITIONS.x_scheduled).toContain("cancelled");
  });

  it("allows sending → sent", () => {
    expect(VALID_TRANSITIONS.sending).toContain("sent");
  });

  it("allows sending → failed", () => {
    expect(VALID_TRANSITIONS.sending).toContain("failed");
  });

  it("allows sending → scheduled (stale recovery)", () => {
    expect(VALID_TRANSITIONS.sending).toContain("scheduled");
  });

  it("allows failed → scheduled (retry)", () => {
    expect(VALID_TRANSITIONS.failed).toContain("scheduled");
  });

  it("allows failed → cancelled", () => {
    expect(VALID_TRANSITIONS.failed).toContain("cancelled");
  });

  it("sent has no outgoing transitions", () => {
    expect(VALID_TRANSITIONS.sent).toEqual([]);
  });

  it("cancelled has no outgoing transitions", () => {
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
  });

  it("every status has a transitions entry", () => {
    const statuses = Object.values(TWEET_STATUS);
    const transitionKeys = Object.keys(VALID_TRANSITIONS);
    for (const status of statuses) {
      expect(transitionKeys).toContain(status);
    }
  });
});

describe("Constants values", () => {
  it("MAX_X_SCHEDULED_PER_ACCOUNT is 100", () => {
    expect(MAX_X_SCHEDULED_PER_ACCOUNT).toBe(100);
  });

  it("CIRCUIT_FAILURE_THRESHOLD is 3", () => {
    expect(CIRCUIT_FAILURE_THRESHOLD).toBe(3);
  });

  it("CIRCUIT_COOLDOWN_MS is 30 minutes", () => {
    expect(CIRCUIT_COOLDOWN_MS).toBe(30 * 60 * 1000);
  });

  it("SESSION_COOKIE_NAME is session_token", () => {
    expect(SESSION_COOKIE_NAME).toBe("session_token");
  });

  it("AES settings are correct", () => {
    expect(AES_ALGORITHM).toBe("aes-256-gcm");
    expect(KEY_LENGTH).toBe(32);
    expect(IV_LENGTH).toBe(16);
    expect(AUTH_TAG_LENGTH).toBe(16);
  });

  it("FALLBACK_QUERY_IDS has all required keys", () => {
    expect(FALLBACK_QUERY_IDS).toHaveProperty("CreateTweet");
    expect(FALLBACK_QUERY_IDS).toHaveProperty("CreateScheduledTweet");
    expect(FALLBACK_QUERY_IDS).toHaveProperty("FetchScheduledTweets");
    expect(FALLBACK_QUERY_IDS).toHaveProperty("EditScheduledTweet");
    expect(FALLBACK_QUERY_IDS).toHaveProperty("DeleteScheduledTweet");
  });

  it("MEDIA_CATEGORIES has all categories", () => {
    expect(MEDIA_CATEGORIES.IMAGE).toBe("tweet_image");
    expect(MEDIA_CATEGORIES.VIDEO).toBe("amplify_video");
    expect(MEDIA_CATEGORIES.GIF).toBe("tweet_gif");
  });

  it("MEDIA_UPLOAD_CHUNK_SIZE is 2MB", () => {
    expect(MEDIA_UPLOAD_CHUNK_SIZE).toBe(2 * 1024 * 1024);
  });

  it("APP_NAME is Xweet", () => {
    expect(APP_NAME).toBe("Xweet");
  });
});
