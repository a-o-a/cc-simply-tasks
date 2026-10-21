import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { assertAssignableMembers } from "@/lib/db/member-validation";
import { contains, newId, now } from "@/lib/db/helpers";
import { hydrateTodos, loadTodoDetail } from "@/lib/db/queries";
import { todoChecklist, todos, type TodoRow } from "@/lib/db/schema";

import { withErrorHandler, readJsonBody } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, createCursorPagination } from "@/lib/pagination";
import {
  todoCreateSchema,
  todoListQuerySchema,
} from "@/lib/validation/todo";

/**
 * GET /api/todos
 *   ?status, ?assigneeId, ?title, ?include=checklist, ?cursor, ?pageSize
 * soft delete 제외.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
      ? lte(todos.dueDate, new Date(`${filters.dueDateTo}T23:59:59.999+09:00`))
      : undefined,
  ].filter(Boolean);

  const pagination = createCursorPagination<TodoRow>("todos", [
    { column: todos.order, value: (row) => row.order, direction: "asc" },
    { column: todos.createdAt, value: (row) => row.createdAt, direction: "desc" },
    { column: todos.id, value: (row) => row.id, direction: "desc" },
  ]);
  const afterCursor = await pagination.condition(cursor, async (id) => {
    const [row] = await db.select().from(todos).where(and(...conditions, eq(todos.id, id))).limit(1);
    return row;
  });
  const rows = await db
    .select()
    .from(todos)
    .where(and(...conditions, afterCursor))
    .orderBy(...pagination.orderBy)
    .limit(take + 1);

  const { items: pageItems, nextCursor } = pagination.page(rows, take);
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
  const input = todoCreateSchema.parse(await readJsonBody(req));
  const timestamp = now();

  const createdId = await db.transaction(async (tx) => {
    await assertAssignableMembers(tx, [
      { id: input.assigneeId, path: ["assigneeId"] },
      ...(input.checklist ?? []).map((item, index) => ({ id: item.assigneeId, path: ["checklist", index, "assigneeId"] })),
    ]);
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
