// src/lib/db/queries/accounts.ts
// Account CRUD operations.

import { db } from "@/lib/db/db";
import { NotFoundError } from "@/lib/api/errors";

export async function getAccounts() {
  return db.account.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      isActive: true,
      failureCount: true,
      circuitOpenUntil: true,
      lastPostedAt: true,
      lastCt0RefreshAt: true,
      createdAt: true,
    },
  });
}

export async function getAccountById(id: string) {
  const account = await db.account.findUnique({ where: { id } });
  if (!account) throw new NotFoundError("Account", id);
  return account;
}

export async function createAccount(data: {
  username: string;
  encryptedCookies: string;
  displayName?: string;
  userId?: string;
  avatarUrl?: string;
}) {
  return db.account.create({ data });
}

export async function updateAccount(
  id: string,
  data: Partial<{
    displayName: string;
    avatarUrl: string;
    userId: string;
    encryptedCookies: string;
    isActive: boolean;
    lastPostedAt: Date;
    lastCt0RefreshAt: Date;
    cookieUpdatedAt: Date;
    failureCount: number;
    circuitOpenUntil: Date | null;
  }>
) {
  const account = await db.account.findUnique({ where: { id } });
  if (!account) throw new NotFoundError("Account", id);

  return db.account.update({ where: { id }, data });
}

export async function deleteAccount(id: string) {
  const account = await db.account.findUnique({ where: { id } });
  if (!account) throw new NotFoundError("Account", id);

  return db.account.delete({ where: { id } });
}
