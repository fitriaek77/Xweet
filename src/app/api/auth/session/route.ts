// GET /api/auth/session — lightweight session check
// Returns 200 with session info if authenticated, 401 otherwise.
// Unlike hitting /api/accounts, this doesn't query the accounts table.

import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success } from "@/lib/api/response";

export const GET = withAuth(async (_req: NextRequest) => {
  return success({ authenticated: true });
});
