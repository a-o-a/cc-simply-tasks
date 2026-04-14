import { NextResponse } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler } from "@/lib/http";

/**
 * GET /api/work-items/count
 * 삭제되지 않은 작업의 상태별 카운트를 반환.
 * { byStatus: Record<string, number>, total: number }
 */
export const GET = withErrorHandler(async () => {
  await ensureSqlitePragma();

  const grouped = await prisma.workItem.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
    total += row._count._all;
  }

  return NextResponse.json({ byStatus, total });
});
