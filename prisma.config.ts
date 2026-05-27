// prisma.config.ts (project root — Prisma 7 CLI looks here)
// Connection strings moved from schema.prisma to this file in Prisma 7+.
// Uses defineConfig + env from prisma/config (Prisma 7 requirement).
// __dirname doesn't exist in ESM ("module": "esnext") — use relative paths.

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    // Direct/unpooled connection for CLI commands (migrations, introspection, push).
    // Falls back to DATABASE_URL for local dev where there's no pooling.
    url: env("DATABASE_URL_UNPOOLED") || env("DATABASE_URL") || "file:./dev.db",
  },
});
