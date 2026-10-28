import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { inclusiveCursorCondition, parsePagination, slicePageAfterCursor } from "@/lib/pagination";
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
  const conditions = [
    filters.entityType ? eq(auditLogs.entityType, filters.entityType) : undefined,
    filters.entityId ? eq(auditLogs.entityId, filters.entityId) : undefined,
    filters.action ? eq(auditLogs.action, filters.action) : undefined,
    filters.actorName ? eq(auditLogs.actorName, filters.actorName) : undefined,
  ].filter(Boolean);

  const anchor = db.$with("page_cursor").as(db
    .select({ createdAt: auditLogs.createdAt, id: auditLogs.id })
    .from(auditLogs)
    .where(and(...conditions, cursor ? eq(auditLogs.id, cursor) : undefined))
    .limit(1));
  const boundary = inclusiveCursorCondition([
    { column: auditLogs.createdAt, anchor: anchor.createdAt, direction: "desc" },
    { column: auditLogs.id, anchor: anchor.id, direction: "desc" },
  ]);
  const query = cursor
    ? db.with(anchor).select(getTableColumns(auditLogs)).from(auditLogs).innerJoin(anchor, boundary)
    : db.select(getTableColumns(auditLogs)).from(auditLogs);
  const rows = await query.where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(take + (cursor ? 2 : 1));

  const { items, nextCursor } = slicePageAfterCursor(rows, cursor, take);
  return NextResponse.json({ items, nextCursor });
});
