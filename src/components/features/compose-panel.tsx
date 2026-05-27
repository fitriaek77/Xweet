"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PenLine, Loader2, Calendar } from "lucide-react";
import { toast } from "sonner";
import { AccountSelector } from "./account-selector";
import { MediaPicker } from "./media-picker";
import { useAccounts } from "@/hooks/use-accounts";
import { useTweets } from "@/hooks/use-tweets";

function getDefaultScheduleTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Get the minimum datetime-local value (now) for the schedule input. */
function getMinScheduleTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MAX_CHARS = 280;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (base64) resolve(base64);
      else reject(new Error("Failed to convert file to base64"));
    };
    reader.onerror = () => { reject(new Error(reader.error?.message ?? "File read error")); };
    reader.readAsDataURL(file);
  });
}

export function ComposePanel() {
  const { accounts, loading: accountsLoading, fetchAccounts } = useAccounts();
  const { createTweet } = useTweets();

  const [selectedAccount, setSelectedAccount] = useState("");
  const [content, setContent] = useState("");
  const [scheduledAt, setScheduledAt] = useState(getDefaultScheduleTime);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  // Auto-select first ACTIVE account — validate that selection is still active
  const effectiveAccount = useMemo(() => {
    if (selectedAccount) {
      const match = accounts.find((a) => a.id === selectedAccount && a.isActive);
      if (match) return selectedAccount;
      // Selected account is no longer active — reset selection
    }
    const firstActive = accounts.find((a) => a.isActive);
    return firstActive?.id ?? "";
  }, [selectedAccount, accounts]);

  const charCount = content.length;
  const isFutureTime = new Date(scheduledAt) > new Date();
  const isValid = charCount > 0 && charCount <= MAX_CHARS && effectiveAccount && isFutureTime;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid || submitting) return;

      setSubmitting(true);
      try {
        const isoDate = new Date(scheduledAt).toISOString();

        let mediaBase64: string | undefined;
        let mediaMimeType: string | undefined;

        if (mediaFile) {
          mediaBase64 = await fileToBase64(mediaFile);
          mediaMimeType = mediaFile.type;
        }

        const ok = await createTweet({
          accountId: effectiveAccount,
          content,
          scheduledAt: isoDate,
          ...(mediaBase64 !== undefined && { mediaBase64 }),
          ...(mediaMimeType !== undefined && { mediaMimeType }),
        });
        if (ok) {
          setContent("");
          setScheduledAt(getDefaultScheduleTime());
          setMediaFile(null);
        }
      } catch {
        toast.error("Failed to process media file");
      } finally {
        setSubmitting(false);
      }
    },
    [isValid, submitting, effectiveAccount, content, scheduledAt, mediaFile, createTweet]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine className="h-5 w-5" />
          Compose Tweet
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Account Selector */}
          <div className="space-y-2">
            <Label htmlFor="account-select">Account</Label>
            {accountsLoading ? (
              <div className="h-9 rounded-md bg-muted animate-pulse" />
            ) : (
              <AccountSelector
                accounts={accounts}
                value={effectiveAccount}
                onChange={setSelectedAccount}
                disabled={submitting}
              />
            )}
          </div>

          {/* Tweet Content */}
          <div className="space-y-2">
            <Label htmlFor="tweet-content">Tweet</Label>
            <Textarea
              id="tweet-content"
              placeholder="What's happening?"
              value={content}
              onChange={(e) => { setContent(e.target.value); }}
              disabled={submitting}
              rows={4}
              className="resize-none"
            />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                {charCount}/{MAX_CHARS}
              </span>
              {charCount > MAX_CHARS && (
                <span className="text-destructive font-medium">Over limit</span>
              )}
            </div>
          </div>

          {/* Media Picker */}
          <div className="space-y-2">
            <Label>Media</Label>
            <MediaPicker
              file={mediaFile}
              onChange={setMediaFile}
              disabled={submitting}
            />
          </div>

          {/* Schedule Time */}
          <div className="space-y-2">
            <Label htmlFor="schedule-time" className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Schedule For
            </Label>
            <Input
              id="schedule-time"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => { setScheduledAt(e.target.value); }}
              min={getMinScheduleTime()}
              disabled={submitting}
            />
            {!isFutureTime && scheduledAt && (
              <p className="text-xs text-destructive">
                Schedule time must be in the future
              </p>
            )}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full"
            disabled={!isValid || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scheduling…
              </>
            ) : (
              "Schedule Tweet"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
