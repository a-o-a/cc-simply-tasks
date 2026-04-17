import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { todoChecklist, todos } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import {
  todoChecklistCreateSchema,
  todoChecklistReorderSchema,
} from "@/lib/validation/todo";

type Params = { params: { id: string } };

/** POST — 체크리스트 항목 추가 */
export const POST = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = todoChecklistCreateSchema.parse(await req.json());
    const timestamp = now();

    const created = await db.transaction(async (tx) => {
      const parent = await tx
        .select({ id: todos.id })
        .from(todos)
        .where(and(eq(todos.id, params.id), isNull(todos.deletedAt)))
        .limit(1);
      if (!parent[0])
        throw new HttpError("NOT_FOUND", "TODO를 찾을 수 없습니다");

      const row = {
        id: newId(),
        todoId: params.id,
        content: input.content,
        done: input.done ?? false,
        order: input.order ?? 0,
        assigneeId: input.assigneeId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      } satisfies typeof todoChecklist.$inferInsert;
      await tx.insert(todoChecklist).values(row);
      // 부모 updatedAt도 갱신 (If-Match 동기화)
      await tx
        .update(todos)
        .set({ updatedAt: timestamp })
        .where(eq(todos.id, params.id));
      await withAudit(tx, {
        entityType: "TodoChecklist",
        entityId: row.id,
        action: "CREATE",
        after: row as unknown as Record<string, unknown>,
        actor,
      });
      return row;
    });

    return NextResponse.json(created, { status: 201 });
  },
);

/** PATCH — reorder (ids 배열 순서대로 order 0..N-1 재설정) */
export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const { ids } = todoChecklistReorderSchema.parse(await req.json());
    const timestamp = now();

    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(todoChecklist)
        .where(
          and(
            eq(todoChecklist.todoId, params.id),
            isNull(todoChecklist.deletedAt),
            inArray(todoChecklist.id, ids),
          ),
        );
      const map = new Map(existing.map((row) => [row.id, row]));
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        const before = map.get(id);
        if (!before) continue;
        if (before.order === i) continue;
        const after = { ...before, order: i, updatedAt: timestamp };
        await tx
          .update(todoChecklist)
          .set({ order: i, updatedAt: timestamp })
          .where(eq(todoChecklist.id, id));
        await withAudit(tx, {
          entityType: "TodoChecklist",
          entityId: id,
          action: "UPDATE",
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
          actor,
        });
      }
      await tx
        .update(todos)
        .set({ updatedAt: timestamp })
        .where(eq(todos.id, params.id));
    });

    return new NextResponse(null, { status: 204 });
  },
);
