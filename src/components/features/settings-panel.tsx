"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  SettingsIcon,
  KeyRound,
  Activity,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

interface HealthData {
  status: string;
  database: boolean;
  uptime: number;
  timestamp: string;
}

export function SettingsPanel() {
  return (
    <div className="space-y-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <SettingsIcon className="h-5 w-5" />
        Settings
      </h2>
      <PasswordSection />
      <HealthSection />
    </div>
  );
}

// ─── Change Password ───

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);

  const handleChangePassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (newPassword !== confirmPassword) {
        toast.error("Passwords do not match");
        return;
      }
      if (newPassword.length < 8) {
        toast.error("Password must be at least 8 characters");
        return;
      }

      setChanging(true);
      try {
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error || "Failed to change password");
          return;
        }

        toast.success("Password changed successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } catch {
        toast.error("Network error");
      } finally {
        setChanging(false);
      }
    },
    [currentPassword, newPassword, confirmPassword]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Change Password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div className="space-y-2">
            <Label htmlFor="current-pw">Current Password</Label>
            <Input
              id="current-pw"
              type="password"
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); }}
              disabled={changing}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-pw">New Password</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); }}
              disabled={changing}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pw">Confirm New Password</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); }}
              disabled={changing}
            />
          </div>
          <Button
            type="submit"
            disabled={
              changing ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
          >
            {changing && <Loader2 className="h-4 w-4 animate-spin" />}
            {changing ? "Updating…" : "Change Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Health Check ───

function HealthSection() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health");
      const json = await res.json();
      if (json.ok) {
        setHealth(json.data as HealthData);
        toast.success("Health check passed");
      } else {
        toast.error(json.error || "Health check failed");
      }
    } catch {
      toast.error("Network error running health check");
    } finally {
      setLoading(false);
    }
  }, []);

  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            System Health
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={checkHealth}
            disabled={loading}
            className="gap-1"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Activity className="h-3 w-3" />
            )}
            {loading ? "Checking…" : "Run Health Check"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {health ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              {health.database ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-sm">Database</span>
              <Badge
                variant={health.database ? "default" : "destructive"}
                className="text-[11px]"
              >
                {health.database ? "Connected" : "Down"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Uptime:</span>
              <span className="text-sm font-medium">
                {formatUptime(health.uptime)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Badge
                variant={health.status === "ok" ? "default" : "destructive"}
                className="text-[11px]"
              >
                {health.status}
              </Badge>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click &quot;Run Health Check&quot; to see system status.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
