import { NextResponse, type NextRequest } from "next/server";
import { and, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { todos } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { todoListQuerySchema } from "@/lib/validation/todo";

/**
 * GET /api/todos/count
 *   ?status, ?assigneeId, ?dueDateFrom, ?dueDateTo
 * soft delete 제외 TODO 건수를 반환.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = todoListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );

  const conditions = [
    isNull(todos.deletedAt),
    filters.status?.length ? inArray(todos.status, filters.status) : undefined,
    filters.assigneeId?.length
      ? inArray(todos.assigneeId, filters.assigneeId)
      : undefined,
    filters.dueDateFrom || filters.dueDateTo ? isNotNull(todos.dueDate) : undefined,
    filters.dueDateFrom
      ? gte(todos.dueDate, new Date(`${filters.dueDateFrom}T00:00:00+09:00`))
      : undefined,
    filters.dueDateTo
      ? lte(todos.dueDate, new Date(`${filters.dueDateTo}T23:59:59+09:00`))
      : undefined,
  ].filter(Boolean);

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(todos)
    .where(and(...conditions));

  return NextResponse.json({ count: Number(row?.count ?? 0) });
});
