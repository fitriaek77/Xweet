// src/lib/db/queries/settings.ts
// Key-Value settings — flexible, no migrations needed.
// Values are stored as-is; encryption is handled at the service layer.

import { db } from "@/lib/db/db";

export async function getSetting(key: string): Promise<string | null> {
  const setting = await db.setting.findUnique({ where: { key } });
  if (!setting) return null;

  return setting.value;
}

export async function setSetting(key: string, value: string) {
  return db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function deleteSetting(key: string) {
  return db.setting.delete({ where: { key } }).catch(() => null);
}

/** Get all settings (for admin UI display). */
export async function getAllSettings() {
  return db.setting.findMany({ orderBy: { key: "asc" } });
}
