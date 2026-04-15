import { NextResponse } from "next/server";
import { isNull, sql } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { workItems } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";

/**
 * GET /api/work-items/count
 * 삭제되지 않은 작업의 상태별 카운트를 반환.
 * { byStatus: Record<string, number>, total: number }
 */
export const GET = withErrorHandler(async () => {
  await ensureSqlitePragma();

  const grouped = await db
    .select({
      status: workItems.status,
      count: sql<number>`count(*)`,
    })
    .from(workItems)
    .where(isNull(workItems.deletedAt))
    .groupBy(workItems.status);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    byStatus[row.status] = Number(row.count);
    total += Number(row.count);
  }

  return NextResponse.json({ byStatus, total });
});
