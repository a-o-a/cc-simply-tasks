import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { assertAssignableMembers } from "@/lib/db/member-validation";
import { now, newId } from "@/lib/db/helpers";
import { loadTodoDetail } from "@/lib/db/queries";
import { todoChecklist, todos } from "@/lib/db/schema";
import { withErrorHandler, HttpError, readJsonBody } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { todoUpdateSchema } from "@/lib/validation/todo";
import { computeDiff } from "@/lib/diff";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(
  async (_req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
    await ensureSqlitePragma();
    const row = await loadTodoDetail(params.id);
    if (!row) throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

export const PATCH = withErrorHandler(
  async (req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = todoUpdateSchema.parse(await readJsonBody(req));
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
      await assertAssignableMembers(tx, [{ id: input.assigneeId, previousId: before.assigneeId, path: ["assigneeId"] }]);
      await tx.update(todos).set(after).where(eq(todos.id, params.id));

      // Supplying checklist replaces the active child list in the same transaction.
      // Existing child endpoints remain available for quick individual edits.
      if (input.checklist !== undefined) {
        const existing = await tx.select().from(todoChecklist)
          .where(and(eq(todoChecklist.todoId, params.id), isNull(todoChecklist.deletedAt)));
        const byId = new Map(existing.map((item) => [item.id, item]));
        const submittedIds = new Set(input.checklist.flatMap((item) => item.id ? [item.id] : []));
        if ([...submittedIds].some((id) => !byId.has(id))) {
          throw new HttpError("BAD_REQUEST", "체크리스트 항목이 이 할 일에 속하지 않거나 삭제되었습니다");
        }

        await assertAssignableMembers(tx, input.checklist.map((item, index) => ({
          id: item.assigneeId,
          previousId: item.id ? byId.get(item.id)?.assigneeId : undefined,
          path: ["checklist", index, "assigneeId"],
        })));

        for (const item of existing) {
          if (submittedIds.has(item.id)) continue;
          const removed = { ...item, deletedAt: updatedAt, updatedAt };
          await tx.update(todoChecklist).set(removed).where(eq(todoChecklist.id, item.id));
          await withAudit(tx, { entityType: "TodoChecklist", entityId: item.id, action: "DELETE", before: item, after: removed, actor });
        }
        for (let index = 0; index < input.checklist.length; index += 1) {
          const item = input.checklist[index];
          const old = item.id ? byId.get(item.id)! : undefined;
          const child = {
            id: old?.id ?? newId(), todoId: params.id, content: item.content,
            done: item.done, order: item.order ?? index, assigneeId: item.assigneeId ?? null,
            createdAt: old?.createdAt ?? updatedAt, updatedAt, deletedAt: null,
          };
          if (old) {
            const diff = computeDiff(old, child);
            if (Object.keys(diff.after).length === 0) continue;
            await tx.update(todoChecklist).set(child).where(eq(todoChecklist.id, child.id));
          } else {
            await tx.insert(todoChecklist).values(child);
          }
          await withAudit(tx, {
            entityType: "TodoChecklist", entityId: child.id, action: old ? "UPDATE" : "CREATE",
            before: old, after: child, actor,
          });
        }
      }

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

    const detail = await loadTodoDetail(updated.id);
    if (!detail) throw new HttpError("NOT_FOUND", "할 일을 찾을 수 없습니다");
    return NextResponse.json(detail);
  },
);

export const DELETE = withErrorHandler(
  async (req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
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
      const children = await tx.select().from(todoChecklist)
        .where(and(eq(todoChecklist.todoId, params.id), isNull(todoChecklist.deletedAt)));
      // 자식 체크리스트도 soft delete
      await tx
        .update(todoChecklist)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(eq(todoChecklist.todoId, params.id), isNull(todoChecklist.deletedAt)),
        );
      for (const child of children) {
        await withAudit(tx, {
          entityType: "TodoChecklist", entityId: child.id, action: "DELETE", before: child,
          after: { ...child, deletedAt, updatedAt: deletedAt }, actor,
        });
      }
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
