// src/lib/storage/b2.ts
// Backblaze B2 object storage via S3-compatible API.
// Stores media files (images, videos, GIFs) for scheduled tweets.
// After a tweet is posted or cancelled, the B2 object is deleted
// to keep storage costs minimal.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// ─── S3 Client (Backblaze B2) ───

const B2_REGION = process.env.B2_BUCKET_REGION ?? "us-west-004";

const client = new S3Client({
  endpoint: `https://s3.${B2_REGION}.backblazeb2.com`,
  region: B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID ?? "",
    secretAccessKey: process.env.B2_APP_KEY ?? "",
  },
});

const BUCKET = process.env.B2_BUCKET_NAME ?? "";

// ─── Upload ───

/**
 * Upload a media file to B2.
 * @param key  Object key, e.g. "media/{tweetId}-{random}.png"
 * @param data Raw file bytes
 * @param mimeType MIME type, e.g. "image/png"
 */
export async function uploadMedia(
  key: string,
  data: Buffer,
  mimeType: string
): Promise<void> {
  if (!BUCKET) throw new Error("B2_BUCKET_NAME is not configured");

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: mimeType,
    })
  );
}

// ─── Download ───

/**
 * Download a media file from B2.
 * Used before uploading to X's media pipeline.
 */
export async function downloadMedia(key: string): Promise<Buffer> {
  if (!BUCKET) throw new Error("B2_BUCKET_NAME is not configured");

  const res = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );

  if (!res.Body) {
    throw new Error("Empty response body from B2");
  }
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

// ─── Delete ───

/**
 * Delete a media file from B2.
 * Called after successful posting or cancellation.
 * Best-effort: errors are logged but not thrown.
 */
export async function deleteMedia(key: string): Promise<void> {
  if (!BUCKET) {
    process.stderr.write("[b2] B2_BUCKET_NAME not configured, skipping delete\n");
    return;
  }

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );
  } catch (err) {
    process.stderr.write(`[b2] Failed to delete ${key}: ${String(err)}\n`);
    // Best-effort — don't throw
  }
}

// ─── Key Generation ───

/**
 * Generate a unique B2 object key for a tweet's media.
 * Format: media/{tweetId}-{random8hex}.{ext}
 * The prefix "media/" matches the B2 app key restriction.
 */
export function generateMediaKey(
  tweetId: string,
  mimeType: string
): string {
  const ext = mimeTypeToExtension(mimeType);
  const random = crypto.randomUUID().slice(0, 8);
  return `media/${tweetId}-${random}.${ext}`;
}

/** Map MIME type to file extension for B2 key naming. */
function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    default: return "bin";
  }
}
