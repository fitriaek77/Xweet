// GET /api/health
import { success, handleApiError } from "@/lib/api/response";
import { db } from "@/lib/db/db";

export async function GET() {
  try {
    let dbOk = false;
    try {
      await db.admin.count();
      dbOk = true;
    } catch {
      dbOk = false;
    }

    return success({
      status: dbOk ? "ok" : "degraded",
      database: dbOk,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
