import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { loadTodoDetail } from "@/lib/db/queries";
import { todoChecklist, todos } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { todoUpdateSchema } from "@/lib/validation/todo";

type Params = { params: { id: string } };

export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const row = await loadTodoDetail(params.id);
    if (!row) throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = todoUpdateSchema.parse(await req.json());
    const updatedAt = now();

    const updated = await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(todos)
        .where(and(eq(todos.id, params.id), isNull(todos.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");

      const after = {
        ...before,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        updatedAt,
      };
      await tx.update(todos).set(after).where(eq(todos.id, params.id));

      await withAudit(tx, {
        entityType: "Todo",
        entityId: after.id,
        action: "UPDATE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });
      return after;
    });

    return NextResponse.json(updated);
  },
);

export const DELETE = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const deletedAt = now();

    await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(todos)
        .where(and(eq(todos.id, params.id), isNull(todos.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      await tx.update(todos).set(after).where(eq(todos.id, params.id));
      // 자식 체크리스트도 soft delete
      await tx
        .update(todoChecklist)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(eq(todoChecklist.todoId, params.id), isNull(todoChecklist.deletedAt)),
        );
      await withAudit(tx, {
        entityType: "Todo",
        entityId: after.id,
        action: "DELETE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });
    });

    return new NextResponse(null, { status: 204 });
  },
);
