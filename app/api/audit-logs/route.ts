import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler } from "@/lib/http";
import { parsePagination, toPage } from "@/lib/pagination";
import { auditLogListQuerySchema } from "@/lib/validation/auditLog";

/**
 * GET /api/audit-logs
 *   ?entityType, ?entityId, ?action, ?actorName, ?cursor, ?pageSize
 *
 * 읽기 전용. 감사 로그는 withAudit 헬퍼로만 생성된다 (write API 없음).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = auditLogListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actorName ? { actorName: filters.actorName } : {}),
    },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const { items, nextCursor } = toPage(rows, take);
  return NextResponse.json({ items, nextCursor });
});
