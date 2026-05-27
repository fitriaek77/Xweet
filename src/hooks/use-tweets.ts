"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { TweetStatus } from "@/config/constants";

// ─── Types ───

export interface TweetItem {
  id: string;
  accountId: string;
  content: string;
  scheduledAt: string;
  status: TweetStatus;
  postedAt: string | null;
  tweetId: string | null;
  failureReason: string | null;
  retryCount: number;
  hasMedia: boolean;
  mediaMimeType: string | null;
  createdAt: string;
  account: { username: string; avatarUrl: string | null };
}

interface TweetFilters {
  accountId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// ─── Hook ───

export function useTweets() {
  const [tweets, setTweets] = useState<TweetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchTweets = useCallback(async (filters?: TweetFilters): Promise<boolean> => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters?.accountId) params.set("accountId", filters.accountId);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.limit) params.set("limit", String(filters.limit));
      if (filters?.offset) params.set("offset", String(filters.offset));

      const qs = params.toString();
      const url = `/api/tweets${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { signal: controller.signal });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Failed to load tweets");
        return false;
      }
      setTweets(json.data as TweetItem[]);
      return true;
    } catch (err) {
      // Don't show error for aborted requests
      if (err instanceof DOMException && err.name === "AbortError") return true;
      toast.error("Network error loading tweets");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const createTweet = useCallback(
    async (data: {
      accountId: string;
      content: string;
      scheduledAt: string;
      mediaBase64?: string;
      mediaMimeType?: string;
    }) => {
      try {
        const res = await fetch("/api/tweets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error || "Failed to schedule tweet");
          return false;
        }
        toast.success("Tweet scheduled!");
        return true;
      } catch {
        toast.error("Network error scheduling tweet");
        return false;
      }
    },
    []
  );

  const updateTweet = useCallback(
    async (id: string, data: { content?: string; scheduledAt?: string; status?: string }) => {
      try {
        const res = await fetch(`/api/tweets/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error || "Failed to update tweet");
          return false;
        }
        toast.success("Tweet updated");
        return true;
      } catch {
        toast.error("Network error updating tweet");
        return false;
      }
    },
    []
  );

  const deleteTweet = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tweets/${id}`, { method: "DELETE" });
      if (res.status === 204) {
        toast.success("Tweet deleted");
        return true;
      }
      const json = await res.json();
      toast.error(json.error || "Failed to delete tweet");
      return false;
    } catch {
      toast.error("Network error deleting tweet");
      return false;
    }
  }, []);

  const postNow = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tweets/${id}/post-now`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Failed to post tweet");
        return false;
      }
      const result = json.data as { posted: boolean; error?: string };
      if (result.posted) {
        toast.success("Tweet posted!");
      } else {
        toast.error(result.error || "Post failed");
      }
      return result.posted;
    } catch {
      toast.error("Network error posting tweet");
      return false;
    }
  }, []);

  const cancelTweet = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tweets/${id}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Failed to cancel tweet");
        return false;
      }
      toast.success("Tweet cancelled");
      return true;
    } catch {
      toast.error("Network error cancelling tweet");
      return false;
    }
  }, []);

  return {
    tweets,
    loading,
    fetchTweets,
    createTweet,
    updateTweet,
    deleteTweet,
    postNow,
    cancelTweet,
  };
}
