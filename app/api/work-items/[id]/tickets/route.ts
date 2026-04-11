import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { workTicketCreateSchema } from "@/lib/validation/workTicket";

type Params = { params: { id: string } };

/**
 * GET /api/work-items/:id/tickets
 * 해당 작업의 티켓 목록 (soft delete 제외).
 */
export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const parent = await prisma.workItem.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");

    const items = await prisma.workTicket.findMany({
      where: { workItemId: params.id, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ items, nextCursor: null });
  },
);

/**
 * POST /api/work-items/:id/tickets
 * 티켓 추가. 유니크(workItemId,systemName,ticketNumber) 충돌 시 CONFLICT.
 */
export const POST = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = workTicketCreateSchema.parse(await req.json());

    const created = await prisma.$transaction(async (tx) => {
      const parent = await tx.workItem.findFirst({
        where: { id: params.id, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");

      const row = await tx.workTicket.create({
        data: {
          workItemId: params.id,
          systemName: input.systemName,
          ticketNumber: input.ticketNumber,
          ticketUrl: input.ticketUrl ?? null,
        },
      });
      await withAudit(tx, {
        entityType: "WorkTicket",
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
