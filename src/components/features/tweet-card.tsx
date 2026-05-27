"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Play, XCircle, RotateCcw, Trash2, ImageIcon, Film } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { TweetItem } from "@/hooks/use-tweets";
import type { TweetStatus } from "@/config/constants";

// ─── Status Badge ───

const STATUS_STYLES: Record<TweetStatus, string> = {
  scheduled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  x_scheduled: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
  sending: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  sent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

const STATUS_LABELS: Record<TweetStatus, string> = {
  scheduled: "Scheduled",
  x_scheduled: "X Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: TweetStatus }) {
  let style: string;
  let label: string;
  switch (status) {
    case "scheduled":
      style = STATUS_STYLES.scheduled;
      label = STATUS_LABELS.scheduled;
      break;
    case "x_scheduled":
      style = STATUS_STYLES.x_scheduled;
      label = STATUS_LABELS.x_scheduled;
      break;
    case "sending":
      style = STATUS_STYLES.sending;
      label = STATUS_LABELS.sending;
      break;
    case "sent":
      style = STATUS_STYLES.sent;
      label = STATUS_LABELS.sent;
      break;
    case "failed":
      style = STATUS_STYLES.failed;
      label = STATUS_LABELS.failed;
      break;
    case "cancelled":
      style = STATUS_STYLES.cancelled;
      label = STATUS_LABELS.cancelled;
      break;
  }
  return (
    <Badge variant="outline" className={`text-[11px] ${style}`}>
      {label}
    </Badge>
  );
}

// ─── Tweet Card ───

interface TweetCardProps {
  tweet: TweetItem;
  onPostNow?: (id: string) => void;
  onCancel?: (id: string) => void;
  onDelete?: (id: string) => void;
  actionLoading?: string | null;
}

export function TweetCard({
  tweet,
  onPostNow,
  onCancel,
  onDelete,
  actionLoading,
}: TweetCardProps) {
  const isActionable =
    tweet.status === "scheduled" ||
    tweet.status === "x_scheduled" ||
    tweet.status === "failed";
  const canCancel =
    tweet.status === "scheduled" || tweet.status === "x_scheduled";
  const canPostNow =
    tweet.status === "scheduled" || tweet.status === "failed";
  const canDelete =
    tweet.status === "sent" ||
    tweet.status === "cancelled" ||
    tweet.status === "failed";
  const isLoading = actionLoading === tweet.id;

  const scheduledDate = new Date(tweet.scheduledAt);

  return (
    <Card className="py-0">
      <CardContent className="p-4 gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="text-xs">
                {tweet.account.username[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium truncate">
              @{tweet.account.username}
            </span>
          </div>
          <StatusBadge status={tweet.status} />
        </div>

        <p className="text-sm whitespace-pre-wrap break-words">
          {tweet.content.length > 200
            ? tweet.content.slice(0, 200) + "…"
            : tweet.content}
        </p>

        {tweet.hasMedia && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {tweet.mediaMimeType?.startsWith("video/") ? (
              <Film className="h-3.5 w-3.5" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            <span>Media attached</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span title={format(scheduledDate, "PPpp")}>
            {formatDistanceToNow(scheduledDate, { addSuffix: true })}
          </span>
          {tweet.failureReason && (
            <span className="text-destructive truncate max-w-[200px]" title={tweet.failureReason}>
              {tweet.failureReason}
            </span>
          )}
          {tweet.retryCount > 0 && (
            <span>Retries: {tweet.retryCount}</span>
          )}
        </div>

        {isActionable && (
          <div className="flex flex-wrap gap-2 pt-1">
            {canPostNow && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPostNow?.(tweet.id)}
                disabled={isLoading}
                className="h-7 text-xs gap-1"
              >
                <Play className="h-3 w-3" />
                Post Now
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCancel?.(tweet.id)}
                disabled={isLoading}
                className="h-7 text-xs gap-1"
              >
                <XCircle className="h-3 w-3" />
                Cancel
              </Button>
            )}
            {tweet.status === "failed" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPostNow?.(tweet.id)}
                disabled={isLoading}
                className="h-7 text-xs gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete?.(tweet.id)}
                disabled={isLoading}
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
