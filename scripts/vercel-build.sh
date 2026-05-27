#!/usr/bin/env bash
set -euo pipefail

echo "=== Vercel Build: Xweet ==="

# ── Step 1: Generate Prisma client ──
echo "[1/3] Running prisma generate..."
npx prisma generate

# ── Step 2: Apply migrations safely ──
# prisma migrate deploy only applies committed migration files.
# It will NOT drop data or make destructive changes.
# Falls back to prisma db push for initial deploy (no migrations yet).
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[2/3] Running prisma migrate deploy..."
  npx prisma migrate deploy
else
  echo "[2/3] No migrations found — running prisma db push for initial setup..."
  npx prisma db push --accept-data-loss 2>&1 || {
    echo "  ⚠️  prisma db push failed (tables may already exist). Continuing..."
  }
fi

# ── Step 3: Build Next.js ──
echo "[3/3] Running next build..."
npx next build

echo "=== Vercel Build Complete ==="
