import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  calendarEventMembers,
  calendarEvents,
  teamMembers,
  workItems,
  workTickets,
  type CalendarEventRow,
  type TeamMemberRow,
  type WorkItemRow,
} from "./schema";

type WorkTicketSummary = {
  systemName: string;
  ticketNumber: string;
};

export async function hydrateWorkItems(
  rows: WorkItemRow[],
  mode: "list" | "detail",
) {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const assigneeIds = [...new Set(rows.map((row) => row.assigneeId).filter(Boolean))] as string[];

  const [assignees, tickets] = await Promise.all([
    assigneeIds.length
      ? db
          .select()
          .from(teamMembers)
          .where(inArray(teamMembers.id, assigneeIds))
      : Promise.resolve([] as TeamMemberRow[]),
    db
      .select()
      .from(workTickets)
      .where(and(inArray(workTickets.workItemId, ids), isNull(workTickets.deletedAt)))
      .orderBy(asc(workTickets.createdAt)),
  ]);

  const assigneeMap = new Map(assignees.map((row) => [row.id, row]));
  const ticketsByWorkItem = new Map<string, typeof tickets>();
  for (const ticket of tickets) {
    const current = ticketsByWorkItem.get(ticket.workItemId) ?? [];
    current.push(ticket);
    ticketsByWorkItem.set(ticket.workItemId, current);
  }

  return rows.map((row) => ({
    ...row,
    assignee: row.assigneeId ? assigneeMap.get(row.assigneeId) ?? null : null,
    tickets:
      mode === "detail"
        ? ticketsByWorkItem.get(row.id) ?? []
        : (ticketsByWorkItem.get(row.id) ?? []).map<WorkTicketSummary>((ticket) => ({
            systemName: ticket.systemName,
            ticketNumber: ticket.ticketNumber,
          })),
  }));
}

export async function hydrateCalendarEvents(rows: CalendarEventRow[]) {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const memberRows = await db
    .select({
      eventId: calendarEventMembers.eventId,
      memberId: calendarEventMembers.memberId,
      member: teamMembers,
    })
    .from(calendarEventMembers)
    .innerJoin(teamMembers, eq(teamMembers.id, calendarEventMembers.memberId))
    .where(inArray(calendarEventMembers.eventId, ids))
    .orderBy(asc(calendarEventMembers.eventId), asc(calendarEventMembers.memberId));

  const membersByEvent = new Map<
    string,
    Array<{ eventId: string; memberId: string; member: TeamMemberRow }>
  >();
  for (const row of memberRows) {
    const current = membersByEvent.get(row.eventId) ?? [];
    current.push(row);
    membersByEvent.set(row.eventId, current);
  }

  return rows.map((row) => ({
    ...row,
    members: membersByEvent.get(row.id) ?? [],
  }));
}

export async function loadWorkItemDetail(id: string) {
  const rows = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.id, id), isNull(workItems.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const [detail] = await hydrateWorkItems([row], "detail");
  return detail ?? null;
}

export async function loadCalendarEventDetail(id: string) {
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const [detail] = await hydrateCalendarEvents([row]);
  return detail ?? null;
}
