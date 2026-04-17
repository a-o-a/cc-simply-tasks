import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { contains, newId, now } from "@/lib/db/helpers";
import { hydrateTodos, loadTodoDetail } from "@/lib/db/queries";
import { todoChecklist, todos } from "@/lib/db/schema";

import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, slicePageAfterCursor } from "@/lib/pagination";
import {
  todoCreateSchema,
  todoListQuerySchema,
} from "@/lib/validation/todo";

/**
 * GET /api/todos
 *   ?status, ?assigneeId, ?title, ?include=checklist, ?cursor, ?pageSize
 * soft delete 제외.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = todoListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);

  const conditions = [
    isNull(todos.deletedAt),
    filters.status?.length ? inArray(todos.status, filters.status) : undefined,
    filters.assigneeId?.length
      ? inArray(todos.assigneeId, filters.assigneeId)
      : undefined,
    filters.title ? contains(todos.title, filters.title) : undefined,
    filters.dueDateFrom || filters.dueDateTo ? isNotNull(todos.dueDate) : undefined,
    filters.dueDateFrom
      ? gte(todos.dueDate, new Date(`${filters.dueDateFrom}T00:00:00+09:00`))
      : undefined,
    filters.dueDateTo
      ? lte(todos.dueDate, new Date(`${filters.dueDateTo}T23:59:59+09:00`))
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(todos)
    .where(and(...conditions))
    .orderBy(asc(todos.order), desc(todos.createdAt), desc(todos.id));

  const { items: pageItems, nextCursor } = slicePageAfterCursor(rows, cursor, take);
  const withChecklist = filters.include?.includes("checklist") ?? false;
  const items = await hydrateTodos(pageItems, { includeChecklist: withChecklist });
  return NextResponse.json({ items, nextCursor });
});

/**
 * POST /api/todos
 * checklist 배열이 있으면 같은 트랜잭션에서 생성.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = todoCreateSchema.parse(await req.json());
  const timestamp = now();

  const createdId = await db.transaction(async (tx) => {
    const row = {
      id: newId(),
      title: input.title,
      note: input.note ?? null,
      status: input.status,
      dueDate: input.dueDate ?? null,
      order: input.order ?? 0,
      assigneeId: input.assigneeId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    } satisfies typeof todos.$inferInsert;
    await tx.insert(todos).values(row);

    await withAudit(tx, {
      entityType: "Todo",
      entityId: row.id,
      action: "CREATE",
      after: row as unknown as Record<string, unknown>,
      actor,
    });

    if (input.checklist?.length) {
      for (let i = 0; i < input.checklist.length; i += 1) {
        const item = input.checklist[i];
        const childRow = {
          id: newId(),
          todoId: row.id,
          content: item.content,
          done: item.done ?? false,
          order: item.order ?? i,
          assigneeId: item.assigneeId ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        } satisfies typeof todoChecklist.$inferInsert;
        await tx.insert(todoChecklist).values(childRow);
        await withAudit(tx, {
          entityType: "TodoChecklist",
          entityId: childRow.id,
          action: "CREATE",
          after: childRow as unknown as Record<string, unknown>,
          actor,
        });
      }
    }

    return row.id;
  });

  const created = await loadTodoDetail(createdId);
  return NextResponse.json(created, { status: 201 });
});
