import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { loadCalendarEventDetail } from "@/lib/db/queries";
import { calendarEventMembers, calendarEvents } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { emitCalendarChanged } from "@/lib/calendar-bus";
import { calendarEventUpdateSchema } from "@/lib/validation/calendarEvent";

type Params = { params: { id: string } };

/**
 * GET /api/calendar-events/:id
 */
export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const row = await loadCalendarEventDetail(params.id);
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
    const updatedAt = now();

    db.transaction((tx) => {
      const before = tx
        .select()
        .from(calendarEvents)
        .where(and(eq(calendarEvents.id, params.id), isNull(calendarEvents.deletedAt)))
        .limit(1)
        .get();
      if (!before) throw new HttpError("NOT_FOUND", "이벤트를 찾을 수 없습니다");

      // memberIds가 제공된 경우 기존 팀원 교체
      if (input.memberIds !== undefined) {
        tx.delete(calendarEventMembers).where(eq(calendarEventMembers.eventId, params.id)).run();
        if (input.memberIds.length > 0) {
          tx.insert(calendarEventMembers).values(
            input.memberIds.map((memberId) => ({ eventId: params.id, memberId })),
          ).run();
        }
      }

      const after = {
        ...before,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.startDateTime !== undefined
          ? { startDateTime: input.startDateTime }
          : {}),
        ...(input.endDateTime !== undefined ? { endDateTime: input.endDateTime } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        updatedAt,
      };
      tx.update(calendarEvents).set(after).where(eq(calendarEvents.id, params.id)).run();
      withAudit(tx, {
        entityType: "CalendarEvent",
        entityId: after.id,
        action: "UPDATE",
        before: before as unknown as Record<string, unknown>,
        after: {
          ...after,
          ...(input.memberIds !== undefined ? { memberIds: input.memberIds } : {}),
        } as unknown as Record<string, unknown>,
        actor,
      });
    });

    const updated = await loadCalendarEventDetail(params.id);
    if (!updated) throw new HttpError("NOT_FOUND", "이벤트를 찾을 수 없습니다");
    emitCalendarChanged();
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
    const deletedAt = now();

    db.transaction((tx) => {
      const before = tx
        .select()
        .from(calendarEvents)
        .where(and(eq(calendarEvents.id, params.id), isNull(calendarEvents.deletedAt)))
        .limit(1)
        .get();
      if (!before) throw new HttpError("NOT_FOUND", "이벤트를 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      tx.update(calendarEvents).set(after).where(eq(calendarEvents.id, params.id)).run();
      withAudit(tx, {
        entityType: "CalendarEvent",
        entityId: after.id,
        action: "DELETE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });
    });

    emitCalendarChanged();
    return new NextResponse(null, { status: 204 });
  },
);
