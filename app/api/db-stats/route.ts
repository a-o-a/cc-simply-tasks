import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import {
  auditLogs as auditLogsTable,
  calendarEventMembers as calendarEventMembersTable,
  calendarEvents as calendarEventsTable,
  settings as settingsTable,
  teamMembers as teamMembersTable,
  todoChecklist as todoChecklistTable,
  todos as todosTable,
  workCategories as workCategoriesTable,
  workItems as workItemsTable,
  workSystems as workSystemsTable,
  workTickets as workTicketsTable,
} from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";

/**
 * GET /api/db-stats
 * 각 테이블의 레코드 수 반환 (deletedAt 무관 전체).
 */
export const GET = withErrorHandler(async () => {
  await ensureSqlitePragma();

  const countTable = async (table: any) => {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(table);
    return Number(rows[0]?.count ?? 0);
  };

  const [
    teamMembers,
    workItems,
    workTickets,
    calendarEvents,
    calendarEventMembers,
    todos,
    todoChecklist,
    settings,
    workCategories,
    workSystems,
    auditLogs,
  ] = await Promise.all([
    countTable(teamMembersTable),
    countTable(workItemsTable),
    countTable(workTicketsTable),
    countTable(calendarEventsTable),
    countTable(calendarEventMembersTable),
    countTable(todosTable),
    countTable(todoChecklistTable),
    countTable(settingsTable),
    countTable(workCategoriesTable),
    countTable(workSystemsTable),
    countTable(auditLogsTable),
  ]);

  return NextResponse.json({
    tables: [
      { name: "TeamMember",          label: "팀원",           count: teamMembers },
      { name: "WorkItem",            label: "작업",           count: workItems },
      { name: "WorkTicket",          label: "작업 티켓",       count: workTickets },
      { name: "CalendarEvent",       label: "캘린더 이벤트",   count: calendarEvents },
      { name: "CalendarEventMember", label: "이벤트 참여자",   count: calendarEventMembers },
      { name: "Todo",                label: "할 일",           count: todos },
      { name: "TodoChecklist",       label: "할 일 체크리스트", count: todoChecklist },
      { name: "WorkCategory",        label: "작업 분류",       count: workCategories },
      { name: "WorkSystem",          label: "작업 시스템",     count: workSystems },
      { name: "Setting",             label: "설정",            count: settings },
      { name: "AuditLog",            label: "감사 로그",       count: auditLogs },
    ],
  });
});
