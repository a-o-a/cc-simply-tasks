import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { loadTodoDetail } from "@/lib/db/queries";
import { teamMembers, todoChecklist, todos } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { todoUpdateSchema } from "@/lib/validation/todo";

type Params = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    const routeParams = await params;
    await ensureSqlitePragma();
    const row = await loadTodoDetail(routeParams.id);
    if (!row) throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    const routeParams = await params;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = todoUpdateSchema.parse(await req.json());

    const updated = await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(todos)
        .where(and(eq(todos.id, routeParams.id), isNull(todos.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");
      if (input.expectedUpdatedAt && input.expectedUpdatedAt.getTime() !== before.updatedAt.getTime()) {
        throw new HttpError("CONFLICT", "다른 곳에서 이 TODO가 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요");
      }
      const updatedAt = new Date(Math.max(now().getTime(), before.updatedAt.getTime() + 1));

      const existingChecklist = await tx.select().from(todoChecklist).where(
        and(eq(todoChecklist.todoId, routeParams.id), isNull(todoChecklist.deletedAt)),
      );
      const checklistById = new Map(existingChecklist.map((item) => [item.id, item]));
      if (input.checklist?.some((item) => item.id && !checklistById.has(item.id))) {
        throw new HttpError("BAD_REQUEST", "이 TODO에 속하지 않거나 삭제된 체크리스트 항목입니다");
      }

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
      await tx.update(todos).set(after).where(eq(todos.id, routeParams.id));

      await withAudit(tx, {
        entityType: "Todo",
        entityId: after.id,
        action: "UPDATE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });

      if (input.checklist !== undefined) {
        const retainedIds = new Set(input.checklist.map((item) => item.id));
        for (const previous of existingChecklist) {
          if (retainedIds.has(previous.id)) continue;
          const removed = { ...previous, updatedAt, deletedAt: updatedAt };
          await tx.update(todoChecklist).set(removed).where(eq(todoChecklist.id, previous.id));
          await withAudit(tx, {
            entityType: "TodoChecklist", entityId: previous.id, action: "DELETE",
            before: previous, after: removed, actor,
          });
        }

        for (const [order, item] of input.checklist.entries()) {
          const previous = item.id ? checklistById.get(item.id) : undefined;
          const values = {
            content: item.content,
            done: item.done,
            assigneeId: item.assigneeId ?? null,
            order,
          };
          if (previous) {
            if (previous.content === values.content && previous.done === values.done &&
                previous.assigneeId === values.assigneeId && previous.order === order) continue;
            const next = { ...previous, ...values, updatedAt };
            await tx.update(todoChecklist).set(next).where(eq(todoChecklist.id, previous.id));
            await withAudit(tx, {
              entityType: "TodoChecklist", entityId: previous.id, action: "UPDATE",
              before: previous, after: next, actor,
            });
          } else {
            const next = {
              id: newId(), todoId: routeParams.id, ...values,
              createdAt: updatedAt, updatedAt, deletedAt: null,
            };
            await tx.insert(todoChecklist).values(next);
            await withAudit(tx, {
              entityType: "TodoChecklist", entityId: next.id, action: "CREATE",
              after: next, actor,
            });
          }
        }
      }

      // Return the committed draft without requiring a second client request.
      const checklist = await tx.select().from(todoChecklist).where(
        and(eq(todoChecklist.todoId, routeParams.id), isNull(todoChecklist.deletedAt)),
      ).orderBy(asc(todoChecklist.order), asc(todoChecklist.createdAt));
      const assigneeIds = [...new Set([after.assigneeId, ...checklist.map((item) => item.assigneeId)]
        .filter((id): id is string => id !== null))];
      const assignees = assigneeIds.length
        ? await tx.select().from(teamMembers).where(inArray(teamMembers.id, assigneeIds))
        : [];
      const assigneeById = new Map(assignees.map((member) => [member.id, member]));
      return {
        ...after,
        assignee: after.assigneeId ? assigneeById.get(after.assigneeId) ?? null : null,
        checklist: checklist.map((item) => ({
          ...item,
          assignee: item.assigneeId ? assigneeById.get(item.assigneeId) ?? null : null,
        })),
      };
    });

    return NextResponse.json(updated);
  },
);

export const DELETE = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    const routeParams = await params;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const deletedAt = now();

    await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(todos)
        .where(and(eq(todos.id, routeParams.id), isNull(todos.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      await tx.update(todos).set(after).where(eq(todos.id, routeParams.id));
      // 자식 체크리스트도 soft delete
      await tx
        .update(todoChecklist)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(eq(todoChecklist.todoId, routeParams.id), isNull(todoChecklist.deletedAt)),
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
