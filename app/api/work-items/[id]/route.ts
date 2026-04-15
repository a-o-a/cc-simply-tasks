import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { loadWorkItemDetail } from "@/lib/db/queries";
import { workItems, workTickets } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { workItemUpdateSchema } from "@/lib/validation/workItem";

type Params = { params: { id: string } };

/**
 * GET /api/work-items/:id
 * 상세 조회. soft delete된 레코드는 404. 티켓은 deletedAt:null만 include.
 */
export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const row = await loadWorkItemDetail(params.id);
    if (!row) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

/**
 * PATCH /api/work-items/:id
 * 부분 업데이트. If-Match 필수.
 * tickets 배열이 있으면 기존 티켓을 soft delete 후 새로 생성(전체 대체).
 */
export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = workItemUpdateSchema.parse(await req.json());
    const updatedAt = now();

    const updated = db.transaction((tx) => {
      const before = tx
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, params.id), isNull(workItems.deletedAt)))
        .limit(1)
        .get();
      if (!before) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");

      const after = {
        ...before,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.additionalNotes !== undefined
          ? { additionalNotes: input.additionalNotes }
          : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.transferDate !== undefined ? { transferDate: input.transferDate } : {}),
        ...(input.requestType !== undefined ? { requestType: input.requestType } : {}),
        ...(input.requestor !== undefined ? { requestor: input.requestor } : {}),
        ...(input.requestNumber !== undefined ? { requestNumber: input.requestNumber } : {}),
        ...(input.requestContent !== undefined
          ? { requestContent: input.requestContent }
          : {}),
        updatedAt,
      };
      tx.update(workItems).set(after).where(eq(workItems.id, params.id)).run();

      // tickets 배열이 전달된 경우: 기존 soft delete 후 전체 재생성
      if (input.tickets !== undefined) {
        tx
          .update(workTickets)
          .set({ deletedAt: updatedAt, updatedAt })
          .where(and(eq(workTickets.workItemId, params.id), isNull(workTickets.deletedAt)))
          .run();
        if (input.tickets.length > 0) {
          tx.insert(workTickets).values(
            input.tickets.map((ticket) => ({
              id: newId(),
              workItemId: params.id,
              systemName: ticket.systemName,
              ticketNumber: ticket.ticketNumber,
              createdAt: updatedAt,
              updatedAt,
              deletedAt: null,
            })),
          ).run();
        }
      }

      withAudit(tx, {
        entityType: "WorkItem",
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

/**
 * DELETE /api/work-items/:id
 * soft delete. If-Match 필수.
 */
export const DELETE = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const deletedAt = now();

    db.transaction((tx) => {
      const before = tx
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, params.id), isNull(workItems.deletedAt)))
        .limit(1)
        .get();
      if (!before) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      tx.update(workItems).set(after).where(eq(workItems.id, params.id)).run();
      withAudit(tx, {
        entityType: "WorkItem",
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
