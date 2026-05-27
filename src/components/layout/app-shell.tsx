"use client";

import { useState, useCallback, useEffect } from "react";
import { Header } from "./header";
import { TabNav } from "./tab-nav";
import { ComposePanel } from "@/components/features/compose-panel";
import { SchedulePanel } from "@/components/features/schedule-panel";
import { AccountsPanel } from "@/components/features/accounts-panel";
import { SettingsPanel } from "@/components/features/settings-panel";
import { LoginForm } from "@/components/features/login-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const TABS = ["Compose", "Schedule", "Accounts", "Settings"] as const;
type Tab = (typeof TABS)[number];

export function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>("Compose");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  // Check if already logged in on mount
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch("/api/accounts");
        if (res.ok) {
          setIsAuthenticated(true);
        }
      } catch {
        // Not authenticated — show login
      } finally {
        setChecking(false);
      }
    }
    void checkSession();
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setIsAuthenticated(false);
      toast.success("Logged out");
    } catch {
      toast.error("Failed to logout");
    }
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoginForm onSuccess={() => { setIsAuthenticated(true); }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header onLogout={handleLogout} />
      <TabNav tabs={TABS} active={activeTab} onChange={setActiveTab} />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6">
        {activeTab === "Compose" && <ComposePanel />}
        {activeTab === "Schedule" && <SchedulePanel />}
        {activeTab === "Accounts" && <AccountsPanel />}
        {activeTab === "Settings" && <SettingsPanel />}
      </main>
      <footer className="mt-auto border-t py-4 text-center text-sm text-muted-foreground">
        Xweet — Multi-Account X Scheduler
      </footer>
    </div>
  );
}
