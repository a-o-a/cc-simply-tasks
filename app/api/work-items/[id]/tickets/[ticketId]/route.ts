import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { assertIfMatch } from "@/lib/optimisticLock";
import { workTicketUpdateSchema } from "@/lib/validation/workTicket";

type Params = { params: { id: string; ticketId: string } };

/**
 * PATCH /api/work-items/:id/tickets/:ticketId
 */
export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = workTicketUpdateSchema.parse(await req.json());

    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.workTicket.findFirst({
        where: {
          id: params.ticketId,
          workItemId: params.id,
          deletedAt: null,
        },
      });
      if (!before) throw new HttpError("NOT_FOUND", "티켓을 찾을 수 없습니다");
      assertIfMatch(req, before.updatedAt);

      const after = await tx.workTicket.update({
        where: { id: params.ticketId },
        data: {
          ...(input.systemName !== undefined
            ? { systemName: input.systemName }
            : {}),
          ...(input.ticketNumber !== undefined
            ? { ticketNumber: input.ticketNumber }
            : {}),
          ...(input.ticketUrl !== undefined
            ? { ticketUrl: input.ticketUrl }
            : {}),
        },
      });
      await withAudit(tx, {
        entityType: "WorkTicket",
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
 * DELETE /api/work-items/:id/tickets/:ticketId
 * soft delete.
 */
export const DELETE = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);

    await prisma.$transaction(async (tx) => {
      const before = await tx.workTicket.findFirst({
        where: {
          id: params.ticketId,
          workItemId: params.id,
          deletedAt: null,
        },
      });
      if (!before) throw new HttpError("NOT_FOUND", "티켓을 찾을 수 없습니다");
      assertIfMatch(req, before.updatedAt);

      const after = await tx.workTicket.update({
        where: { id: params.ticketId },
        data: { deletedAt: new Date() },
      });
      await withAudit(tx, {
        entityType: "WorkTicket",
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
