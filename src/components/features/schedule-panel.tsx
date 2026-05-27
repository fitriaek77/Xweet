"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TweetCard } from "./tweet-card";
import { useTweets } from "@/hooks/use-tweets";
import { useAccounts } from "@/hooks/use-accounts";


const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "x_scheduled", label: "X Scheduled" },
  { value: "sending", label: "Sending" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export function SchedulePanel() {
  const { tweets, loading, fetchTweets, postNow, cancelTweet, deleteTweet } =
    useTweets();
  const { accounts, fetchAccounts } = useAccounts();
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const loadTweets = useCallback(() => {
    const filters: { accountId?: string; status?: string } = {};
    if (filterAccount !== "all") filters.accountId = filterAccount;
    if (filterStatus !== "all") filters.status = filterStatus;
    void fetchTweets(filters);
  }, [filterAccount, filterStatus, fetchTweets]);

  useEffect(() => {
    loadTweets();
  }, [loadTweets]);

  const handlePostNow = useCallback(
    async (id: string) => {
      setActionLoading(id);
      await postNow(id);
      setActionLoading(null);
      loadTweets();
    },
    [postNow, loadTweets]
  );

  const handleCancel = useCallback(
    async (id: string) => {
      setActionLoading(id);
      await cancelTweet(id);
      setActionLoading(null);
      loadTweets();
    },
    [cancelTweet, loadTweets]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setActionLoading(id);
      await deleteTweet(id);
      setActionLoading(null);
      loadTweets();
    },
    [deleteTweet, loadTweets]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Scheduled Tweets
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={loadTweets}
            disabled={loading}
            className="gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Select value={filterAccount} onValueChange={setFilterAccount}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts
                .filter((a) => a.isActive)
                .map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    @{a.username}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {loading && tweets.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : tweets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No tweets found. Compose one!
          </p>
        ) : (
          <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
            {tweets.map((tweet) => (
              <TweetCard
                key={tweet.id}
                tweet={tweet}
                onPostNow={handlePostNow}
                onCancel={handleCancel}
                onDelete={handleDelete}
                actionLoading={actionLoading}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
