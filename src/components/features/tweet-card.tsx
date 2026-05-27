"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Play, XCircle, RotateCcw, Trash2, ImageIcon, Film } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { TweetItem } from "@/hooks/use-tweets";
import type { TweetStatus } from "@/config/constants";

// ─── Status Badge ───

function getStatusStyle(status: TweetStatus): string {
  switch (status) {
    case "scheduled": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
    case "x_scheduled": return "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400";
    case "sending": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
    case "sent": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "failed": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    case "cancelled": return "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400";
  }
}

function getStatusLabel(status: TweetStatus): string {
  switch (status) {
    case "scheduled": return "Scheduled";
    case "x_scheduled": return "X Scheduled";
    case "sending": return "Sending";
    case "sent": return "Sent";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

function StatusBadge({ status }: { status: TweetStatus }) {
  const style = getStatusStyle(status);
  const label = getStatusLabel(status);
  return (
    <Badge variant="outline" className={`text-[11px] font-medium ${style}`}>
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
    tweet.status === "scheduled" || tweet.status === "x_scheduled" || tweet.status === "failed";
  const canDelete =
    tweet.status === "sent" ||
    tweet.status === "cancelled" ||
    tweet.status === "failed";
  const isLoading = actionLoading === tweet.id;

  const scheduledDate = new Date(tweet.scheduledAt);

  return (
    <Card className="py-0 transition-colors hover:bg-muted/30">
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

        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
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
                aria-label="Post tweet now"
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
                aria-label="Cancel scheduled tweet"
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
                aria-label="Retry posting tweet"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </Button>
            )}
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isLoading}
                    className="h-7 text-xs gap-1 text-destructive hover:text-destructive ml-auto"
                    aria-label="Delete tweet"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this tweet?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove the tweet record. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onDelete?.(tweet.id)}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
