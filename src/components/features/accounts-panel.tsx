"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import {
  Users,
  Plus,
  ShieldCheck,
  RefreshCw,
  Loader2,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useAccounts } from "@/hooks/use-accounts";
import { formatDistanceToNow } from "date-fns";

export function AccountsPanel() {
  const {
    accounts,
    loading,
    fetchAccounts,
    addAccount,
    updateAccount,
    deleteAccount,
    verifyAccount,
    refreshCt0,
  } = useAccounts();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newCookies, setNewCookies] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [adding, setAdding] = useState(false);
  const [actionIds, setActionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    const ok = await addAccount({
      username: newUsername,
      cookies: newCookies,
      ...(newDisplayName && { displayName: newDisplayName }),
    });
    setAdding(false);
    if (ok) {
      setNewUsername("");
      setNewCookies("");
      setNewDisplayName("");
      setDialogOpen(false);
    }
  }, [newUsername, newCookies, newDisplayName, addAccount]);

  const handleToggleActive = useCallback(
    async (id: string, isActive: boolean) => {
      setActionIds((prev) => new Set(prev).add(id));
      await updateAccount(id, { isActive: !isActive });
      setActionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    },
    [updateAccount]
  );

  const handleVerify = useCallback(
    async (id: string) => {
      setActionIds((prev) => new Set(prev).add(id));
      await verifyAccount(id);
      setActionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    },
    [verifyAccount]
  );

  const handleRefreshCt0 = useCallback(
    async (id: string) => {
      setActionIds((prev) => new Set(prev).add(id));
      await refreshCt0(id);
      setActionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    },
    [refreshCt0]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setActionIds((prev) => new Set(prev).add(id));
      await deleteAccount(id);
      setActionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    },
    [deleteAccount]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5" />
          X Accounts
        </h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add X Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-username">Username</Label>
                <Input
                  id="add-username"
                  placeholder="e.g. elonmusk"
                  value={newUsername}
                  onChange={(e) => { setNewUsername(e.target.value); }}
                  disabled={adding}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-displayname">Display Name (optional)</Label>
                <Input
                  id="add-displayname"
                  placeholder="e.g. Elon Musk"
                  value={newDisplayName}
                  onChange={(e) => { setNewDisplayName(e.target.value); }}
                  disabled={adding}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-cookies">Cookies</Label>
                <Textarea
                  id="add-cookies"
                  placeholder="auth_token=xxx; ct0=xxx; twid=xxx"
                  value={newCookies}
                  onChange={(e) => { setNewCookies(e.target.value); }}
                  disabled={adding}
                  rows={4}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground leading-tight">
                  Log into x.com → F12 → Application → Cookies → x.com.
                  Copy <code className="font-mono bg-muted px-1 rounded">auth_token</code>,{" "}
                  <code className="font-mono bg-muted px-1 rounded">ct0</code>, and{" "}
                  <code className="font-mono bg-muted px-1 rounded">twid</code> values.
                  Format: <code className="font-mono bg-muted px-1 rounded">auth_token=xxx; ct0=xxx; twid=xxx</code>
                </p>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={adding}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                onClick={handleAdd}
                disabled={adding || !newUsername || !newCookies}
              >
                {adding && <Loader2 className="h-4 w-4 animate-spin" />}
                {adding ? "Adding…" : "Add Account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading && accounts.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="h-6 w-24 bg-muted animate-pulse rounded" />
                <div className="h-4 w-40 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No accounts yet. Add one to get started!
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              isActive={actionIds.has(account.id)}
              onToggleActive={handleToggleActive}
              onVerify={handleVerify}
              onRefreshCt0={handleRefreshCt0}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Account Card ───

interface AccountCardProps {
  account: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    isActive: boolean;
    failureCount: number;
    circuitOpenUntil: string | null;
    lastPostedAt: string | null;
    lastCt0RefreshAt: string | null;
  };
  isActive: boolean;
  onToggleActive: (id: string, current: boolean) => void;
  onVerify: (id: string) => void;
  onRefreshCt0: (id: string) => void;
  onDelete: (id: string) => void;
}

function AccountCard({
  account,
  isActive: isActioning,
  onToggleActive,
  onVerify,
  onRefreshCt0,
  onDelete,
}: AccountCardProps) {
  const circuitOpen = account.circuitOpenUntil
    ? new Date(account.circuitOpenUntil) > new Date()
    : false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs">
                {account.username[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">
                @{account.username}
              </p>
              {account.displayName && (
                <p className="text-xs text-muted-foreground truncate">
                  {account.displayName}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={account.isActive ? "default" : "secondary"}
              className="text-[11px]"
            >
              {account.isActive ? "Active" : "Inactive"}
            </Badge>
            <Switch
              checked={account.isActive}
              onCheckedChange={() => { onToggleActive(account.id, account.isActive); }}
              disabled={isActioning}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Circuit breaker */}
        {circuitOpen && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-md px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>
              Circuit open — cooldown until{" "}
              {account.circuitOpenUntil
                ? formatDistanceToNow(new Date(account.circuitOpenUntil), { addSuffix: true })
                : "soon"}
            </span>
          </div>
        )}

        {/* Info */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {account.failureCount > 0 && (
            <span>Failures: {account.failureCount}</span>
          )}
          {account.lastPostedAt && (
            <span>
              Last posted:{" "}
              {formatDistanceToNow(new Date(account.lastPostedAt), {
                addSuffix: true,
              })}
            </span>
          )}
          {account.lastCt0RefreshAt && (
            <span>
              ct0 refresh:{" "}
              {formatDistanceToNow(new Date(account.lastCt0RefreshAt), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onVerify(account.id); }}
            disabled={isActioning}
            className="h-7 text-xs gap-1"
          >
            {isActioning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            Verify
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onRefreshCt0(account.id); }}
            disabled={isActioning}
            className="h-7 text-xs gap-1"
          >
            {isActioning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh ct0
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={isActioning}
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive ml-auto"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete @{account.username}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the account and all its scheduled tweets.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => { onDelete(account.id); }}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
