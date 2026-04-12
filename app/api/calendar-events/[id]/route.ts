import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { assertIfMatch } from "@/lib/optimisticLock";
import { calendarEventUpdateSchema } from "@/lib/validation/calendarEvent";

type Params = { params: { id: string } };

/**
 * GET /api/calendar-events/:id
 */
export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const row = await prisma.calendarEvent.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { member: true },
    });
    if (!row) throw new HttpError("NOT_FOUND", "이벤트를 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

/**
 * PATCH /api/calendar-events/:id
 */
export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = calendarEventUpdateSchema.parse(await req.json());

    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.calendarEvent.findFirst({
        where: { id: params.id, deletedAt: null },
      });
      if (!before) throw new HttpError("NOT_FOUND", "이벤트를 찾을 수 없습니다");
      assertIfMatch(req, before.updatedAt);

      const after = await tx.calendarEvent.update({
        where: { id: params.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
          ...(input.startDateTime !== undefined
            ? { startDateTime: input.startDateTime }
            : {}),
          ...(input.endDateTime !== undefined
            ? { endDateTime: input.endDateTime }
            : {}),
          ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      });
      await withAudit(tx, {
        entityType: "CalendarEvent",
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
 * DELETE /api/calendar-events/:id
 * soft delete.
 */
export const DELETE = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);

    await prisma.$transaction(async (tx) => {
      const before = await tx.calendarEvent.findFirst({
        where: { id: params.id, deletedAt: null },
      });
      if (!before) throw new HttpError("NOT_FOUND", "이벤트를 찾을 수 없습니다");
      assertIfMatch(req, before.updatedAt);

      const after = await tx.calendarEvent.update({
        where: { id: params.id },
        data: { deletedAt: new Date() },
      });
      await withAudit(tx, {
        entityType: "CalendarEvent",
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
