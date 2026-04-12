import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import {
  calendarEventCreateSchema,
  calendarEventRangeQuerySchema,
} from "@/lib/validation/calendarEvent";

/**
 * GET /api/calendar-events?from=<ISO>&to=<ISO>&memberId=<id?>
 *
 * 반열림 [from, to)와 겹치는 모든 이벤트.
 *  - startDateTime < to AND endDateTime > from
 * range 조회는 페이지네이션 없음. 클라이언트는 from/to로 범위를 한정해야 한다.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = calendarEventRangeQuerySchema.parse(
    Object.fromEntries(searchParams),
  );

  const items = await prisma.calendarEvent.findMany({
    where: {
      deletedAt: null,
      startDateTime: { lt: filters.to },
      endDateTime: { gt: filters.from },
      ...(filters.memberId ? { memberId: filters.memberId } : {}),
    },
    include: {
      member: true,
    },
    orderBy: [{ startDateTime: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({ items });
});

/**
 * POST /api/calendar-events
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = calendarEventCreateSchema.parse(await req.json());

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.calendarEvent.create({
      data: {
        title: input.title,
        memberId: input.memberId ?? null,
        startDateTime: input.startDateTime,
        endDateTime: input.endDateTime,
        allDay: input.allDay,
        note: input.note ?? null,
      },
    });
    await withAudit(tx, {
      entityType: "CalendarEvent",
      entityId: row.id,
      action: "CREATE",
      after: row as unknown as Record<string, unknown>,
      actor,
    });
    return row;
  });

  return NextResponse.json(created, { status: 201 });
});
