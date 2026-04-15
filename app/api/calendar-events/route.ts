import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, exists, gt, inArray, isNull, lt } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { hydrateCalendarEvents } from "@/lib/db/queries";
import { calendarEventMembers, calendarEvents } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { emitCalendarChanged } from "@/lib/calendar-bus";
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

  const items = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        isNull(calendarEvents.deletedAt),
        lt(calendarEvents.startDateTime, filters.to),
        gt(calendarEvents.endDateTime, filters.from),
        filters.memberId
          ? exists(
              db
                .select({ eventId: calendarEventMembers.eventId })
                .from(calendarEventMembers)
                .where(
                  and(
                    eq(calendarEventMembers.eventId, calendarEvents.id),
                    eq(calendarEventMembers.memberId, filters.memberId),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(calendarEvents.startDateTime), asc(calendarEvents.id));

  return NextResponse.json({ items: await hydrateCalendarEvents(items) });
});

/**
 * POST /api/calendar-events
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = calendarEventCreateSchema.parse(await req.json());
  const timestamp = now();

  const created = await db.transaction(async (tx) => {
    const row = {
      id: newId(),
      title: input.title,
      category: input.category,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      allDay: input.allDay,
      note: input.note ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    } satisfies typeof calendarEvents.$inferInsert;
    await tx.insert(calendarEvents).values(row);
    if (input.memberIds.length > 0) {
      await tx.insert(calendarEventMembers).values(
        input.memberIds.map((memberId) => ({
          eventId: row.id,
          memberId,
        })),
      );
    }
    await withAudit(tx, {
      entityType: "CalendarEvent",
      entityId: row.id,
      action: "CREATE",
      after: {
        ...row,
        memberIds: input.memberIds,
      } as unknown as Record<string, unknown>,
      actor,
    });
    return row;
  });

  emitCalendarChanged();
  return NextResponse.json(created, { status: 201 });
});
