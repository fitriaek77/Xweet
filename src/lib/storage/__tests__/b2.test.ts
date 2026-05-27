// Tests for src/lib/storage/b2.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Set B2 env vars before module import — must be hoisted
vi.hoisted(() => {
  process.env.B2_BUCKET_NAME = "test-bucket";
  process.env.B2_KEY_ID = "test-key-id";
  process.env.B2_APP_KEY = "test-app-key";
});

// Mock @aws-sdk/client-s3 before importing b2 module
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mockSend;
    constructor(_opts: unknown) {}
  }
  class MockPutObjectCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  class MockGetObjectCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  class MockDeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
  };
});

// Import after mocking
import {
  uploadMedia,
  downloadMedia,
  deleteMedia,
  generateMediaKey,
} from "@/lib/storage/b2";

// ─── BUCKET is set via process.env.B2_BUCKET_NAME ───
// We need to control it for each test. The module reads it at import time,
// so we set the env var before importing.

describe("b2 storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset process.env.B2_BUCKET_NAME for each test
    process.env.B2_BUCKET_NAME = "test-bucket";
  });

  // ─── uploadMedia ───

  describe("uploadMedia", () => {
    it("uploads media to B2 successfully", async () => {
      mockSend.mockResolvedValueOnce({});

      await uploadMedia("media/test.png", Buffer.from([1, 2, 3]), "image/png");

      expect(mockSend).toHaveBeenCalledOnce();
      const uploadCall = mockSend.mock.calls.at(0);
      if (!uploadCall) throw new Error("Expected send to have been called");
      const cmd = uploadCall[0];
      expect(cmd.input.Bucket).toBe("test-bucket");
      expect(cmd.input.Key).toBe("media/test.png");
      expect(cmd.input.ContentType).toBe("image/png");
    });

    it("throws when B2_BUCKET_NAME is not configured", async () => {
      delete process.env.B2_BUCKET_NAME;
      // Re-import to get the updated BUCKET value
      vi.resetModules();

      const { uploadMedia: freshUpload } = await import("@/lib/storage/b2");

      await expect(
        freshUpload("media/test.png", Buffer.from([1]), "image/png")
      ).rejects.toThrow("B2_BUCKET_NAME is not configured");
    });
  });

  // ─── downloadMedia ───

  describe("downloadMedia", () => {
    it("downloads media and returns Buffer", async () => {
      const bytes = new Uint8Array([4, 5, 6]);
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToByteArray: vi.fn().mockResolvedValue(bytes),
        },
      });

      const result = await downloadMedia("media/test.png");

      expect(result).toBeInstanceOf(Buffer);
      expect(Array.from(result)).toEqual([4, 5, 6]);
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("throws when response body is empty", async () => {
      mockSend.mockResolvedValueOnce({ Body: null });

      await expect(downloadMedia("media/test.png")).rejects.toThrow(
        "Empty response body from B2"
      );
    });

    it("throws when B2_BUCKET_NAME is not configured", async () => {
      delete process.env.B2_BUCKET_NAME;
      vi.resetModules();

      const { downloadMedia: freshDownload } = await import("@/lib/storage/b2");

      await expect(freshDownload("media/test.png")).rejects.toThrow(
        "B2_BUCKET_NAME is not configured"
      );
    });
  });

  // ─── deleteMedia ───

  describe("deleteMedia", () => {
    it("deletes media from B2 successfully", async () => {
      mockSend.mockResolvedValueOnce({});

      await deleteMedia("media/test.png");

      expect(mockSend).toHaveBeenCalledOnce();
      const deleteCall = mockSend.mock.calls.at(0);
      if (!deleteCall) throw new Error("Expected send to have been called");
      const cmd = deleteCall[0];
      expect(cmd.input.Bucket).toBe("test-bucket");
      expect(cmd.input.Key).toBe("media/test.png");
    });

    it("skips delete when B2_BUCKET_NAME is not configured", async () => {
      delete process.env.B2_BUCKET_NAME;
      vi.resetModules();

      const { deleteMedia: freshDelete } = await import("@/lib/storage/b2");
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await freshDelete("media/test.png");

      expect(mockSend).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledWith(
        "[b2] B2_BUCKET_NAME not configured, skipping delete\n"
      );

      stderrSpy.mockRestore();
    });

    it("catches and logs delete errors without throwing", async () => {
      mockSend.mockRejectedValueOnce(new Error("S3 delete failed"));
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      // Should NOT throw
      await deleteMedia("media/test.png");

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("[b2] Failed to delete media/test.png")
      );

      stderrSpy.mockRestore();
    });
  });

  // ─── generateMediaKey ───

  describe("generateMediaKey", () => {
    it("generates key with correct format for image/png", () => {
      const key = generateMediaKey("tweet-123", "image/png");
      expect(key).toMatch(/^media\/tweet-123-[0-9a-f-]{8}\.png$/);
    });

    it("generates key with correct format for image/jpeg", () => {
      const key = generateMediaKey("tweet-123", "image/jpeg");
      expect(key).toMatch(/^media\/tweet-123-[0-9a-f-]{8}\.jpg$/);
    });

    it("generates key with correct format for image/gif", () => {
      const key = generateMediaKey("tweet-123", "image/gif");
      expect(key).toMatch(/^media\/tweet-123-[0-9a-f-]{8}\.gif$/);
    });

    it("generates key with correct format for video/mp4", () => {
      const key = generateMediaKey("tweet-123", "video/mp4");
      expect(key).toMatch(/^media\/tweet-123-[0-9a-f-]{8}\.mp4$/);
    });

    it("generates key with correct format for video/quicktime", () => {
      const key = generateMediaKey("tweet-123", "video/quicktime");
      expect(key).toMatch(/^media\/tweet-123-[0-9a-f-]{8}\.mov$/);
    });

    it("falls back to .bin for unknown mime types", () => {
      const key = generateMediaKey("tweet-123", "application/octet-stream");
      expect(key).toMatch(/^media\/tweet-123-[0-9a-f-]{8}\.bin$/);
    });

    it("generates unique keys on consecutive calls", () => {
      const key1 = generateMediaKey("tweet-123", "image/png");
      const key2 = generateMediaKey("tweet-123", "image/png");
      // The random part should differ
      expect(key1).not.toBe(key2);
    });
  });
});
