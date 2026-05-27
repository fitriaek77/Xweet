// src/lib/validations/tweet.ts
// Tweet request validation schemas.

import { z } from "zod/v4";

const VALID_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "video/mp4",
  "video/quicktime",
] as const;

export const createTweetSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  content: z.string().min(1, "Tweet content is required").max(280, "Tweet exceeds 280 characters"),
  scheduledAt: z.string().datetime("Invalid date format"),
  mediaBase64: z.string().optional(),
  mediaMimeType: z
    .string()
    .optional()
    .refine(
      (v) => !v || VALID_MEDIA_TYPES.includes(v as (typeof VALID_MEDIA_TYPES)[number]),
      "Unsupported media type"
    ),
});

export type CreateTweetInput = z.infer<typeof createTweetSchema>;

export const updateTweetSchema = z.object({
  content: z.string().min(1).max(280).optional(),
  scheduledAt: z.string().datetime().optional(),
  status: z.enum(["scheduled", "cancelled"]).optional(),
});

export type UpdateTweetInput = z.infer<typeof updateTweetSchema>;

export const postNowSchema = z.object({
  executor: z.enum(["manual"]).default("manual"),
});

export type PostNowInput = z.infer<typeof postNowSchema>;
