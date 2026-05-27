// Tests for src/lib/twitter/media-upload.ts
/** Safely get nth mock call without non-null assertion. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getMediaCategory, uploadMedia } from "@/lib/twitter/media-upload";

describe("getMediaCategory", () => {
  it("returns 'amplify_video' for video/mp4", () => {
    expect(getMediaCategory("video/mp4")).toBe("amplify_video");
  });

  it("returns 'amplify_video' for video/quicktime", () => {
    expect(getMediaCategory("video/quicktime")).toBe("amplify_video");
  });

  it("returns 'amplify_video' for any video/* type", () => {
    expect(getMediaCategory("video/webm")).toBe("amplify_video");
  });

  it("returns 'tweet_gif' for image/gif", () => {
    expect(getMediaCategory("image/gif")).toBe("tweet_gif");
  });

  it("returns 'tweet_image' for image/png", () => {
    expect(getMediaCategory("image/png")).toBe("tweet_image");
  });

  it("returns 'tweet_image' for image/jpeg", () => {
    expect(getMediaCategory("image/jpeg")).toBe("tweet_image");
  });

  it("returns 'tweet_image' for unknown types", () => {
    expect(getMediaCategory("application/pdf")).toBe("tweet_image");
  });
});

describe("uploadMedia", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads image successfully (no processing needed)", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 123, media_id_string: "123", expires_after_secs: 3600 }),
    };
    const appendResp = { ok: true };
    const finalizeResp = {
      ok: true,
      json: () => Promise.resolve({
        media_id: 123,
        media_id_string: "123",
        size: 1024,
        expires_after_secs: 3600,
      }),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(initResp)     // INIT
      .mockResolvedValueOnce(appendResp)   // APPEND
      .mockResolvedValueOnce(finalizeResp); // FINALIZE

    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadMedia({
      cookies: "auth_token=abc; ct0=def",
      ct0: "def",
      mediaData: Buffer.from("test image data"),
      mimeType: "image/png",
      mediaCategory: "tweet_image",
    });

    expect(result.mediaId).toBe("123");
    expect(result.mediaKey).toBe("3_123"); // image prefix
    expect(result.expiresAfterSecs).toBe(3600);
    expect(fetchMock).toHaveBeenCalledTimes(3); // INIT + APPEND + FINALIZE
  });

  it("uploads video with processing poll", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 456, media_id_string: "456", expires_after_secs: 86400 }),
    };
    const appendResp = { ok: true };
    const finalizeResp = {
      ok: true,
      json: () => Promise.resolve({
        media_id: 456,
        media_id_string: "456",
        size: 5242880,
        expires_after_secs: 86400,
        processing_info: { state: "in_progress", check_after_secs: 1 },
      }),
    };
    const statusResp = {
      ok: true,
      json: () => Promise.resolve({
        processing_info: { state: "succeeded" },
      }),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(initResp)      // INIT
      .mockResolvedValueOnce(appendResp)    // APPEND
      .mockResolvedValueOnce(finalizeResp)  // FINALIZE
      .mockResolvedValueOnce(statusResp);   // STATUS poll

    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadMedia({
      cookies: "auth_token=abc; ct0=def",
      ct0: "def",
      mediaData: Buffer.from("fake video"),
      mimeType: "video/mp4",
      mediaCategory: "amplify_video",
    });

    expect(result.mediaId).toBe("456");
    expect(result.mediaKey).toBe("13_456"); // video prefix
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uploads GIF with tweet_gif category", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 789, media_id_string: "789", expires_after_secs: 3600 }),
    };
    const appendResp = { ok: true };
    const finalizeResp = {
      ok: true,
      json: () => Promise.resolve({
        media_id: 789,
        media_id_string: "789",
        size: 2048,
        expires_after_secs: 3600,
      }),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(initResp)
      .mockResolvedValueOnce(appendResp)
      .mockResolvedValueOnce(finalizeResp);

    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadMedia({
      cookies: "auth_token=abc; ct0=def",
      ct0: "def",
      mediaData: Buffer.from("fake gif"),
      mimeType: "image/gif",
      mediaCategory: "tweet_gif",
    });

    expect(result.mediaKey).toBe("16_789"); // GIF prefix
  });

  it("throws TwitterApiError on INIT failure", async () => {
    const initResp = {
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(initResp));

    await expect(
      uploadMedia({
        cookies: "auth_token=abc; ct0=def",
        ct0: "def",
        mediaData: Buffer.from("test"),
        mimeType: "image/png",
        mediaCategory: "tweet_image",
      })
    ).rejects.toThrow("Media INIT failed");
  });

  it("throws TwitterApiError on APPEND failure", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 123, media_id_string: "123", expires_after_secs: 3600 }),
    };
    const appendResp = {
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server Error"),
    };

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(initResp)
      .mockResolvedValueOnce(appendResp)
    );

    await expect(
      uploadMedia({
        cookies: "auth_token=abc; ct0=def",
        ct0: "def",
        mediaData: Buffer.from("test"),
        mimeType: "image/png",
        mediaCategory: "tweet_image",
      })
    ).rejects.toThrow("Media APPEND failed");
  });

  it("throws TwitterApiError on FINALIZE failure", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 123, media_id_string: "123", expires_after_secs: 3600 }),
    };
    const appendResp = { ok: true };
    const finalizeResp = {
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server Error"),
    };

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(initResp)
      .mockResolvedValueOnce(appendResp)
      .mockResolvedValueOnce(finalizeResp)
    );

    await expect(
      uploadMedia({
        cookies: "auth_token=abc; ct0=def",
        ct0: "def",
        mediaData: Buffer.from("test"),
        mimeType: "image/png",
        mediaCategory: "tweet_image",
      })
    ).rejects.toThrow("Media FINALIZE failed");
  });

  it("throws TwitterApiError on STATUS poll failure", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 123, media_id_string: "123", expires_after_secs: 3600 }),
    };
    const appendResp = { ok: true };
    const finalizeResp = {
      ok: true,
      json: () => Promise.resolve({
        media_id: 123,
        media_id_string: "123",
        size: 1024,
        expires_after_secs: 3600,
        processing_info: { state: "in_progress", check_after_secs: 0 },
      }),
    };
    const statusResp = {
      ok: false,
      status: 500,
    };

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(initResp)
      .mockResolvedValueOnce(appendResp)
      .mockResolvedValueOnce(finalizeResp)
      .mockResolvedValueOnce(statusResp)
    );

    await expect(
      uploadMedia({
        cookies: "auth_token=abc; ct0=def",
        ct0: "def",
        mediaData: Buffer.from("test"),
        mimeType: "video/mp4",
        mediaCategory: "amplify_video",
      })
    ).rejects.toThrow("Media STATUS poll failed");
  });

  it("throws on processing failed state", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 123, media_id_string: "123", expires_after_secs: 3600 }),
    };
    const appendResp = { ok: true };
    const finalizeResp = {
      ok: true,
      json: () => Promise.resolve({
        media_id: 123,
        media_id_string: "123",
        size: 1024,
        expires_after_secs: 3600,
        processing_info: { state: "in_progress", check_after_secs: 0 },
      }),
    };
    const statusResp = {
      ok: true,
      json: () => Promise.resolve({
        processing_info: { state: "failed", error: { code: 1, message: "Invalid media" } },
      }),
    };

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(initResp)
      .mockResolvedValueOnce(appendResp)
      .mockResolvedValueOnce(finalizeResp)
      .mockResolvedValueOnce(statusResp)
    );

    await expect(
      uploadMedia({
        cookies: "auth_token=abc; ct0=def",
        ct0: "def",
        mediaData: Buffer.from("test"),
        mimeType: "video/mp4",
        mediaCategory: "amplify_video",
      })
    ).rejects.toThrow("Media processing failed");
  });

  it("chunks large files into multiple APPEND calls", async () => {
    // Create a buffer larger than MEDIA_UPLOAD_CHUNK_SIZE (2MB)
    const largeData = Buffer.alloc(3 * 1024 * 1024); // 3MB → 2 chunks

    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 999, media_id_string: "999", expires_after_secs: 3600 }),
    };
    const appendResp1 = { ok: true };
    const appendResp2 = { ok: true };
    const finalizeResp = {
      ok: true,
      json: () => Promise.resolve({
        media_id: 999,
        media_id_string: "999",
        size: largeData.length,
        expires_after_secs: 3600,
      }),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(initResp)
      .mockResolvedValueOnce(appendResp1)
      .mockResolvedValueOnce(appendResp2)
      .mockResolvedValueOnce(finalizeResp);

    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadMedia({
      cookies: "auth_token=abc; ct0=def",
      ct0: "def",
      mediaData: largeData,
      mimeType: "image/png",
      mediaCategory: "tweet_image",
    });

    expect(result.mediaId).toBe("999");
    // INIT + 2 APPENDs + FINALIZE = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("includes correct headers in upload requests", async () => {
    const initResp = {
      ok: true,
      json: () => Promise.resolve({ media_id: 123, media_id_string: "123", expires_after_secs: 3600 }),
    };
    const appendResp = { ok: true };
    const finalizeResp = {
      ok: true,
      json: () => Promise.resolve({
        media_id: 123, media_id_string: "123", size: 100, expires_after_secs: 3600,
      }),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(initResp)
      .mockResolvedValueOnce(appendResp)
      .mockResolvedValueOnce(finalizeResp);

    vi.stubGlobal("fetch", fetchMock);

    await uploadMedia({
      cookies: "my_cookies",
      ct0: "my_ct0",
      mediaData: Buffer.from("test"),
      mimeType: "image/png",
      mediaCategory: "tweet_image",
    });

    // Check INIT call headers
    const initCall = fetchMock.mock.calls.at(0);
    if (!initCall) throw new Error("No mock call found");
    const initHeaders = initCall[1]?.headers as Record<string, string>;
    expect(initHeaders["Cookie"]).toBe("my_cookies");
    expect(initHeaders["X-Csrf-Token"]).toBe("my_ct0");
    expect(initHeaders["Authorization"]).toContain("Bearer");
    expect(initHeaders["Origin"]).toBe("https://x.com");
    expect(initHeaders["Referer"]).toBe("https://x.com/compose/post");
  });
});
