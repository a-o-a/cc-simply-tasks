import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { auditLogs, type AuditLogRow } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { parsePagination, createCursorPagination } from "@/lib/pagination";
import { auditLogListQuerySchema } from "@/lib/validation/auditLog";

/**
 * GET /api/audit-logs
 *   ?entityType, ?entityId, ?action, ?actorName, ?cursor, ?pageSize
 *
 * 읽기 전용. 감사 로그는 withAudit 헬퍼로만 생성된다 (write API 없음).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = auditLogListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);
  const conditions = [
    filters.entityType ? eq(auditLogs.entityType, filters.entityType) : undefined,
    filters.entityId ? eq(auditLogs.entityId, filters.entityId) : undefined,
    filters.action ? eq(auditLogs.action, filters.action) : undefined,
    filters.actorName ? eq(auditLogs.actorName, filters.actorName) : undefined,
  ].filter(Boolean);

  const pagination = createCursorPagination<AuditLogRow>("audit-logs", [
    { column: auditLogs.createdAt, value: (row) => row.createdAt, direction: "desc" },
    { column: auditLogs.id, value: (row) => row.id, direction: "desc" },
  ]);
  const afterCursor = await pagination.condition(cursor, async (id) => {
    const [row] = await db.select().from(auditLogs).where(and(...conditions, eq(auditLogs.id, id))).limit(1);
    return row;
  });
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions, afterCursor))
    .orderBy(...pagination.orderBy)
    .limit(take + 1);

  const { items, nextCursor } = pagination.page(rows, take);
  return NextResponse.json({ items, nextCursor });
});
