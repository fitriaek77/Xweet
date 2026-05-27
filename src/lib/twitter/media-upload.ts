// src/lib/twitter/media-upload.ts
// INIT/APPEND/FINALIZE/STATUS pipeline for X media uploads.
// Uses amplify_video for ALL video uploads (15-day expiry vs 24h).
// upload.x.com requires Origin + Referer headers (403 without).
// x-client-transaction-id NOT needed for uploads.

import { X_UPLOAD_BASE, X_BEARER_TOKEN, MEDIA_UPLOAD_CHUNK_SIZE, MEDIA_CATEGORIES } from "@/config/constants";
import { TwitterApiError } from "@/lib/api/errors";
import { getHeaders } from "@/lib/twitter/headers";
import type {
  TwitterMediaUploadInitResponse,
  TwitterMediaUploadFinalizeResponse,
} from "@/types/twitter";

export interface MediaUploadParams {
  cookies: string;
  ct0: string;
  /** Raw media bytes. */
  mediaData: Buffer;
  /** MIME type: "image/png", "video/mp4", "image/gif". */
  mimeType: string;
  /** Media category: "tweet_image", "amplify_video", "tweet_gif". */
  mediaCategory: string;
}

export interface MediaUploadResult {
  mediaId: string;
  mediaKey: string;
  /** Seconds until media expires on X CDN. */
  expiresAfterSecs: number;
}

/** Determine media category from MIME type. */
export function getMediaCategory(mimeType: string): string {
  if (mimeType.startsWith("video/")) return MEDIA_CATEGORIES.VIDEO; // amplify_video (15d)
  if (mimeType === "image/gif") return MEDIA_CATEGORIES.GIF;
  return MEDIA_CATEGORIES.IMAGE;
}

/** Get media key prefix from category. */
function getMediaKeyPrefix(category: string): string {
  if (category === MEDIA_CATEGORIES.VIDEO) return "13_";
  if (category === MEDIA_CATEGORIES.GIF) return "16_";
  return "3_";
}

/**
 * Full media upload pipeline: INIT → APPEND → FINALIZE → STATUS (if needed).
 * All operations complete in <7s for typical media files.
 */
export async function uploadMedia(
  params: MediaUploadParams
): Promise<MediaUploadResult> {
  const { cookies, ct0, mediaData, mimeType, mediaCategory } = params;

  // Step 1: INIT
  const initResult = await mediaInit({
    cookies,
    ct0,
    totalBytes: mediaData.length,
    mimeType,
    mediaCategory,
  });

  const mediaId = initResult.media_id_string;

  // Step 2: APPEND (chunked for large files)
  await mediaAppendChunks({
    cookies,
    ct0,
    mediaId,
    mediaData,
  });

  // Step 3: FINALIZE
  const finalizeResult = await mediaFinalize({
    cookies,
    ct0,
    mediaId,
  });

  // Step 4: STATUS poll (video/GIF only — images are immediately ready)
  if (finalizeResult.processing_info) {
    await pollMediaStatus({
      cookies,
      ct0,
      mediaId,
      processingInfo: finalizeResult.processing_info,
    });
  }

  return {
    mediaId,
    mediaKey: `${getMediaKeyPrefix(mediaCategory)}${mediaId}`,
    expiresAfterSecs: finalizeResult.expires_after_secs,
  };
}

// ─── Upload Headers ───

/** Build headers for upload.x.com — mirrors xFetch()'s anti-detection strategy. */
async function buildUploadHeaders(
  cookies: string,
  ct0: string
): Promise<Record<string, string>> {
  // Merge Chrome fingerprint profile (same as xFetch)
  const headerProfile = await getHeaders();
  const headers: Record<string, string> = { ...headerProfile };

  // Auth flags (mandatory — X returns 404 without these on upload subdomain)
  headers["X-Twitter-Auth-Type"] = "OAuth2Session";
  headers["X-Twitter-Active-User"] = "yes";
  headers["X-Twitter-Client-Language"] = "en";

  // Override with upload-specific values
  headers["Authorization"] = `Bearer ${X_BEARER_TOKEN}`;
  headers["Cookie"] = cookies;
  headers["X-Csrf-Token"] = ct0;
  headers["Origin"] = "https://x.com";
  headers["Referer"] = "https://x.com/compose/post";
  headers["Cache-Control"] = "no-cache";
  headers["Pragma"] = "no-cache";

  return headers;
}

// ─── INIT ───

interface MediaInitParams {
  cookies: string;
  ct0: string;
  totalBytes: number;
  mimeType: string;
  mediaCategory: string;
}

async function mediaInit(
  params: MediaInitParams
): Promise<TwitterMediaUploadInitResponse> {
  const { cookies, ct0, totalBytes, mimeType, mediaCategory } = params;

  const formData = new FormData();
  formData.append("command", "INIT");
  formData.append("total_bytes", totalBytes.toString());
  formData.append("media_type", mimeType);
  formData.append("media_category", mediaCategory);

  const resp = await fetch(`${X_UPLOAD_BASE}/media/upload.json`, {
    method: "POST",
    headers: await buildUploadHeaders(cookies, ct0),
    body: formData,
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new TwitterApiError(
      `Media INIT failed: ${resp.status}`,
      resp.status,
      text
    );
  }

  return (await resp.json()) as TwitterMediaUploadInitResponse;
}

// ─── APPEND ───

interface MediaAppendParams {
  cookies: string;
  ct0: string;
  mediaId: string;
  mediaData: Buffer;
}

async function mediaAppendChunks(
  params: MediaAppendParams
): Promise<void> {
  const { cookies, ct0, mediaId, mediaData } = params;

  const totalChunks = Math.ceil(mediaData.length / MEDIA_UPLOAD_CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * MEDIA_UPLOAD_CHUNK_SIZE;
    const end = Math.min(start + MEDIA_UPLOAD_CHUNK_SIZE, mediaData.length);
    const chunk = mediaData.subarray(start, end);

    const formData = new FormData();
    formData.append("command", "APPEND");
    formData.append("media_id", mediaId);
    formData.append("segment_index", i.toString());
    formData.append("media_data", chunk.toString("base64"));

    const resp = await fetch(`${X_UPLOAD_BASE}/media/upload.json`, {
      method: "POST",
      headers: await buildUploadHeaders(cookies, ct0),
      body: formData,
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new TwitterApiError(
        `Media APPEND failed at chunk ${i}: ${resp.status}`,
        resp.status,
        text
      );
    }
  }
}

// ─── FINALIZE ───

interface MediaFinalizeParams {
  cookies: string;
  ct0: string;
  mediaId: string;
}

async function mediaFinalize(
  params: MediaFinalizeParams
): Promise<TwitterMediaUploadFinalizeResponse> {
  const { cookies, ct0, mediaId } = params;

  const formData = new FormData();
  formData.append("command", "FINALIZE");
  formData.append("media_id", mediaId);

  const resp = await fetch(`${X_UPLOAD_BASE}/media/upload.json`, {
    method: "POST",
    headers: await buildUploadHeaders(cookies, ct0),
    body: formData,
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new TwitterApiError(
      `Media FINALIZE failed: ${resp.status}`,
      resp.status,
      text
    );
  }

  return (await resp.json()) as TwitterMediaUploadFinalizeResponse;
}

// ─── STATUS ───

interface ProcessingInfo {
  state: "in_progress" | "succeeded" | "failed";
  check_after_secs?: number;
  error?: { code: number; message: string };
}

interface PollStatusParams {
  cookies: string;
  ct0: string;
  mediaId: string;
  processingInfo: ProcessingInfo;
}

/** Poll STATUS endpoint until video/GIF processing completes. */
async function pollMediaStatus(
  params: PollStatusParams
): Promise<void> {
  const { cookies, ct0, mediaId, processingInfo } = params;

  let state = processingInfo.state;
  let checkAfter = processingInfo.check_after_secs ?? 1;
  let attempts = 0;
  const maxAttempts = 15; // ~30s max (2s * 15)

  while (state === "in_progress" && attempts < maxAttempts) {
    attempts++;

    // Wait before polling
    await sleep(checkAfter * 1000);

    const resp = await fetch(
      `${X_UPLOAD_BASE}/media/upload.json?command=STATUS&media_id=${mediaId}`,
      {
        method: "GET",
        headers: await buildUploadHeaders(cookies, ct0),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!resp.ok) {
      throw new TwitterApiError(
        `Media STATUS poll failed: ${resp.status}`,
        resp.status
      );
    }

    const data = (await resp.json()) as {
      processing_info: ProcessingInfo;
    };
    state = data.processing_info.state;
    checkAfter = data.processing_info.check_after_secs ?? 1;

    if (state === "failed") {
      const error = data.processing_info.error;
      throw new TwitterApiError(
        `Media processing failed: ${error?.message ?? "unknown"}`,
        502,
        JSON.stringify(error)
      );
    }
  }

  if (state === "in_progress") {
    throw new TwitterApiError(
      "Media processing timed out",
      504,
      `mediaId: ${mediaId}`
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
