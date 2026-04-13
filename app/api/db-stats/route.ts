import { NextResponse } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler } from "@/lib/http";

/**
 * GET /api/db-stats
 * 각 테이블의 레코드 수 반환 (deletedAt 무관 전체).
 */
export const GET = withErrorHandler(async () => {
  await ensureSqlitePragma();

  const [
    teamMembers,
    workItems,
    workTickets,
    calendarEvents,
    calendarEventMembers,
    settings,
    workCategories,
    workSystems,
    auditLogs,
  ] = await Promise.all([
    prisma.teamMember.count(),
    prisma.workItem.count(),
    prisma.workTicket.count(),
    prisma.calendarEvent.count(),
    prisma.calendarEventMember.count(),
    prisma.setting.count(),
    prisma.workCategory.count(),
    prisma.workSystem.count(),
    prisma.auditLog.count(),
  ]);

  return NextResponse.json({
    tables: [
      { name: "TeamMember",          label: "팀원",           count: teamMembers },
      { name: "WorkItem",            label: "작업",           count: workItems },
      { name: "WorkTicket",          label: "작업 티켓",       count: workTickets },
      { name: "CalendarEvent",       label: "캘린더 이벤트",   count: calendarEvents },
      { name: "CalendarEventMember", label: "이벤트 참여자",   count: calendarEventMembers },
      { name: "WorkCategory",        label: "작업 분류",       count: workCategories },
      { name: "WorkSystem",          label: "작업 시스템",     count: workSystems },
      { name: "Setting",             label: "설정",            count: settings },
      { name: "AuditLog",            label: "감사 로그",       count: auditLogs },
    ],
  });
});
