// src/lib/utils/date.ts
// Timezone-aware date formatting for scheduled tweet display.

import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";

/**
 * Format a date for display in the UI.
 */
export function formatDate(date: Date | string, pattern = "MMM d, yyyy h:mm a"): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "Invalid date";
  return format(d, pattern);
}

/**
 * Get relative time string (e.g. "in 5 minutes", "3 hours ago").
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "Invalid date";
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Check if a scheduled time is in the past.
 */
export function isPast(date: Date | string): boolean {
  const d = typeof date === "string" ? parseISO(date) : date;
  return d.getTime() < Date.now();
}

/**
 * Convert a Date to Unix seconds (for X API execute_at).
 */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Create a Date from Unix seconds (from X API).
 */
export function fromUnixSeconds(seconds: number): Date {
  return new Date(seconds * 1000);
}
