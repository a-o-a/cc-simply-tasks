import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { todoChecklist, todos } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { todoChecklistUpdateSchema } from "@/lib/validation/todo";

type Params = { params: { id: string; itemId: string } };

export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = todoChecklistUpdateSchema.parse(await req.json());
    const updatedAt = now();

    const updated = await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(todoChecklist)
        .where(
          and(
            eq(todoChecklist.id, params.itemId),
            eq(todoChecklist.todoId, params.id),
            isNull(todoChecklist.deletedAt),
          ),
        )
        .limit(1);
      const before = beforeRows[0];
      if (!before)
        throw new HttpError("NOT_FOUND", "체크리스트 항목을 찾을 수 없습니다");

      const after = {
        ...before,
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.done !== undefined ? { done: input.done } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        updatedAt,
      };
      await tx
        .update(todoChecklist)
        .set(after)
        .where(eq(todoChecklist.id, params.itemId));
      // 부모 updatedAt도 갱신
      await tx
        .update(todos)
        .set({ updatedAt })
        .where(eq(todos.id, params.id));
      await withAudit(tx, {
        entityType: "TodoChecklist",
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
        .from(todoChecklist)
        .where(
          and(
            eq(todoChecklist.id, params.itemId),
            eq(todoChecklist.todoId, params.id),
            isNull(todoChecklist.deletedAt),
          ),
        )
        .limit(1);
      const before = beforeRows[0];
      if (!before)
        throw new HttpError("NOT_FOUND", "체크리스트 항목을 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      await tx
        .update(todoChecklist)
        .set(after)
        .where(eq(todoChecklist.id, params.itemId));
      await tx
        .update(todos)
        .set({ updatedAt: deletedAt })
        .where(eq(todos.id, params.id));
      await withAudit(tx, {
        entityType: "TodoChecklist",
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
