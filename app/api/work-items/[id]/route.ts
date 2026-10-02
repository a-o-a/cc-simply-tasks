import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now, ticketSummaries } from "@/lib/db/helpers";
import { loadWorkItemDetail } from "@/lib/db/queries";
import { workItems, workTickets } from "@/lib/db/schema";
import { withErrorHandler, HttpError, readJsonBody } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { workItemUpdateSchema } from "@/lib/validation/workItem";
import { assertDateOrder } from "@/lib/validation/common";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/work-items/:id
 * 상세 조회. soft delete된 레코드는 404. 티켓은 deletedAt:null만 include.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(
  async (_req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
    await ensureSqlitePragma();
    const row = await loadWorkItemDetail(params.id);
    if (!row) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

/**
 * PATCH /api/work-items/:id
 * 부분 업데이트.
 * tickets 배열이 변경되면 기존 티켓을 soft delete 후 새로 생성(전체 대체).
 */
export const PATCH = withErrorHandler(
  async (req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = workItemUpdateSchema.parse(await readJsonBody(req));
    const updatedAt = now();

    const updated = await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, params.id), isNull(workItems.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
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
      assertDateOrder(after.startDate, after.endDate, "endDate", true);
      await tx.update(workItems).set(after).where(eq(workItems.id, params.id));

      // 티켓 값이 바뀐 경우에만 전체 대체하고 관계 변경도 감사 로그에 남긴다.
      let beforeTickets: Array<{ systemName: string; ticketNumber: string }> | undefined;
      let afterTickets: Array<{ systemName: string; ticketNumber: string }> | undefined;
      if (input.tickets !== undefined) {
        const existing = await tx.select().from(workTickets)
          .where(and(eq(workTickets.workItemId, params.id), isNull(workTickets.deletedAt)));
        beforeTickets = ticketSummaries(existing);
        afterTickets = ticketSummaries(input.tickets);
        if (JSON.stringify(beforeTickets) !== JSON.stringify(afterTickets)) {
          await tx
            .update(workTickets)
            .set({ deletedAt: updatedAt, updatedAt })
            .where(and(eq(workTickets.workItemId, params.id), isNull(workTickets.deletedAt)));
          for (const ticket of existing) {
            await withAudit(tx, {
              entityType: "WorkTicket", entityId: ticket.id, action: "DELETE",
              before: ticket, after: { ...ticket, deletedAt: updatedAt, updatedAt }, actor,
            });
          }
          for (const ticket of input.tickets) {
            const ticketRow = {
              id: newId(),
              workItemId: params.id,
              systemName: ticket.systemName,
              ticketNumber: ticket.ticketNumber,
              createdAt: updatedAt,
              updatedAt,
              deletedAt: null,
            };
            await tx.insert(workTickets).values(ticketRow);
            await withAudit(tx, { entityType: "WorkTicket", entityId: ticketRow.id, action: "CREATE", after: ticketRow, actor });
          }
        }
      }

      await withAudit(tx, {
        entityType: "WorkItem",
        entityId: after.id,
        action: "UPDATE",
        before: { ...before, ...(beforeTickets ? { tickets: beforeTickets } : {}) },
        after: { ...after, ...(afterTickets ? { tickets: afterTickets } : {}) },
        actor,
      });
      return after;
    });

    const detail = await loadWorkItemDetail(updated.id);
    if (!detail) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
    return NextResponse.json(detail);
  },
);

/**
 * DELETE /api/work-items/:id
 * soft delete.
 */
export const DELETE = withErrorHandler(
  async (req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const deletedAt = now();

    await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, params.id), isNull(workItems.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      await tx.update(workItems).set(after).where(eq(workItems.id, params.id));
      const tickets = await tx.select().from(workTickets)
        .where(and(eq(workTickets.workItemId, params.id), isNull(workTickets.deletedAt)));
      await tx.update(workTickets).set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(workTickets.workItemId, params.id), isNull(workTickets.deletedAt)));
      for (const ticket of tickets) {
        await withAudit(tx, {
          entityType: "WorkTicket", entityId: ticket.id, action: "DELETE", before: ticket,
          after: { ...ticket, deletedAt, updatedAt: deletedAt }, actor,
        });
      }
      await withAudit(tx, {
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
