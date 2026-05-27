// src/types/models.ts
// Domain model types — derived from Prisma schema + Zod.
// These are the shapes used in the UI, not raw DB rows.

export interface AccountView {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  failureCount: number;
  circuitOpenUntil: Date | null;
  lastPostedAt: Date | null;
  lastCt0RefreshAt: Date | null;
  createdAt: Date;
}

export interface TweetView {
  id: string;
  accountId: string;
  content: string;
  scheduledAt: Date;
  status: TweetStatus;
  postedAt: Date | null;
  tweetId: string | null;
  failureReason: string | null;
  retryCount: number;
  mediaMimeType: string | null;
  mediaCategory: string | null;
  mediaId: string | null;
  hasMedia: boolean;
  createdAt: Date;
  account: { username: string; avatarUrl: string | null };
}

export type TweetStatus =
  | "scheduled"
  | "x_scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface LogView {
  id: string;
  tweetId: string | null;
  accountId: string | null;
  action: string;
  detail: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  database: boolean;
  uptime: number;
  lastCronTick: Date | null;
  lastCronMaintenance: Date | null;
}
