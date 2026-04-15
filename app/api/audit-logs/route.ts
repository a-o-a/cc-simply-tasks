import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { parsePagination, slicePageAfterCursor } from "@/lib/pagination";
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

  const rows = await db
    .select()
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));

  const { items, nextCursor } = slicePageAfterCursor(rows, cursor, take);
  return NextResponse.json({ items, nextCursor });
});
