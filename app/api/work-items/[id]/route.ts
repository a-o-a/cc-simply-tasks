import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { assertIfMatch } from "@/lib/optimisticLock";
import { workItemUpdateSchema } from "@/lib/validation/workItem";

type Params = { params: { id: string } };

/**
 * GET /api/work-items/:id
 * 상세 조회. soft delete된 레코드는 404. 티켓은 deletedAt:null만 include.
 */
export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const row = await prisma.workItem.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        assignee: true,
        tickets: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!row) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

/**
 * PATCH /api/work-items/:id
 * 부분 업데이트. If-Match 필수.
 */
export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = workItemUpdateSchema.parse(await req.json());

    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.workItem.findFirst({
        where: { id: params.id, deletedAt: null },
      });
      if (!before) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
      assertIfMatch(req, before.updatedAt);

      const after = await tx.workItem.update({
        where: { id: params.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.order !== undefined ? { order: input.order } : {}),
          ...(input.assigneeId !== undefined
            ? { assigneeId: input.assigneeId }
            : {}),
          ...(input.startDate !== undefined
            ? { startDate: input.startDate }
            : {}),
          ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
          ...(input.transferDate !== undefined
            ? { transferDate: input.transferDate }
            : {}),
        },
      });

      await withAudit(tx, {
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

    await prisma.$transaction(async (tx) => {
      const before = await tx.workItem.findFirst({
        where: { id: params.id, deletedAt: null },
      });
      if (!before) throw new HttpError("NOT_FOUND", "작업을 찾을 수 없습니다");
      assertIfMatch(req, before.updatedAt);

      const after = await tx.workItem.update({
        where: { id: params.id },
        data: { deletedAt: new Date() },
      });
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
