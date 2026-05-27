// prisma/prisma.config.ts
// Prisma 7+ configuration — tells the CLI which connection string to use.
// DATABASE_URL_UNPOOLED is used for migrations and db push (direct connection).
// DATABASE_URL (pooled via PgBouncer) is used at runtime by the app.

import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "schema.prisma"),

  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
});
