"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserCircle } from "lucide-react";
import type { AccountItem } from "@/hooks/use-accounts";

interface AccountSelectorProps {
  accounts: AccountItem[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function AccountSelector({
  accounts,
  value,
  onChange,
  disabled,
}: AccountSelectorProps) {
  const activeAccounts = accounts.filter((a) => a.isActive);

  if (accounts.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-md border border-dashed px-3 py-2">
        <UserCircle className="h-4 w-4" />
        No accounts yet — add one in Accounts tab
      </div>
    );
  }

  if (activeAccounts.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-md border border-dashed px-3 py-2">
        <UserCircle className="h-4 w-4" />
        No active accounts — activate one in Accounts tab
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={onChange} {...(disabled !== undefined && { disabled })}>
      <SelectTrigger className="w-full" aria-label="Select account">
        <SelectValue placeholder="Select account" />
      </SelectTrigger>
      <SelectContent>
        {activeAccounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            @{account.username}
            {account.displayName ? ` — ${account.displayName}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
