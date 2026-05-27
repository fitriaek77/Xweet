"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";

// ─── Types ───

export interface AccountItem {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  failureCount: number;
  circuitOpenUntil: string | null;
  lastPostedAt: string | null;
  lastCt0RefreshAt: string | null;
  createdAt: string;
}

// ─── Hook ───

export function useAccounts() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Failed to load accounts");
        return;
      }
      setAccounts(json.data as AccountItem[]);
    } catch {
      toast.error("Network error loading accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  const addAccount = useCallback(
    async (data: { username: string; cookies: string; displayName?: string }) => {
      try {
        const res = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error || "Failed to add account");
          return false;
        }
        toast.success("Account added!");
        await fetchAccounts();
        return true;
      } catch {
        toast.error("Network error adding account");
        return false;
      }
    },
    [fetchAccounts]
  );

  const updateAccount = useCallback(
    async (id: string, data: { displayName?: string; cookies?: string; isActive?: boolean }) => {
      try {
        const res = await fetch(`/api/accounts/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error || "Failed to update account");
          return false;
        }
        toast.success("Account updated");
        await fetchAccounts();
        return true;
      } catch {
        toast.error("Network error updating account");
        return false;
      }
    },
    [fetchAccounts]
  );

  const deleteAccount = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
        if (res.status === 204) {
          toast.success("Account removed");
          await fetchAccounts();
          return true;
        }
        const json = await res.json();
        toast.error(json.error || "Failed to remove account");
        return false;
      } catch {
        toast.error("Network error removing account");
        return false;
      }
    },
    [fetchAccounts]
  );

  const verifyAccount = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}/verify`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Verification failed");
        return false;
      }
      const result = json.data as { valid: boolean; ct0?: string; error?: string };
      if (result.valid) {
        toast.success("Cookies verified — account is valid");
      } else {
        toast.error(result.error || "Cookies are invalid");
      }
      return result.valid;
    } catch {
      toast.error("Network error verifying account");
      return false;
    }
  }, []);

  const refreshCt0 = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}/refresh-ct0`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "ct0 refresh failed");
        return false;
      }
      const result = json.data as { success: boolean; ct0?: string; error?: string };
      if (result.success) {
        toast.success("ct0 refreshed successfully");
      } else {
        toast.error(result.error || "ct0 refresh failed");
      }
      await fetchAccounts();
      return result.success;
    } catch {
      toast.error("Network error refreshing ct0");
      return false;
    }
  }, [fetchAccounts]);

  return {
    accounts,
    loading,
    fetchAccounts,
    addAccount,
    updateAccount,
    deleteAccount,
    verifyAccount,
    refreshCt0,
  };
}
