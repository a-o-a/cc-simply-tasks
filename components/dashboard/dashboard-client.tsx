"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, ListChecks, Loader2, RefreshCw } from "lucide-react";
import { api, TODOS_CHANGED_EVENT, WORK_ITEMS_CHANGED_EVENT } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import {
  kstDateStringToUtcMs,
  kstWeekContaining,
  utcMsToKstDateString,
} from "@/lib/client/calendar";
import { useWorkReferences } from "@/lib/client/use-work-references";
import type {
  AuditLog,
  CalendarEvent,
  ListResponse,
  WorkItemListItem,
} from "@/lib/client/types";
import { STATUSES, type Status } from "@/lib/enums";
import { STATUS_LABELS } from "@/lib/enum-labels";

type WorkItemCounts = { byStatus: Record<string, number>; total: number };
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/work-items/status-badge";
import { WorkItemDrawer } from "@/components/work-items/work-item-drawer";
import { WorkItemFormDialog } from "@/components/work-items/work-item-form-dialog";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/ui/query-state";
import { useDashboardData } from "./use-dashboard-data";

const DAY_MS = 24 * 60 * 60 * 1000;

const CAT_ORDER: Record<string, number> = {
  HOLIDAY: 0, WORK: 1, ABSENCE: 2, ETC: 3,
  MEETING: 1, VACATION: 2, ANNIVERSARY: 3,
};

const CAT_BADGE: Record<string, { label: string; className: string }> = {
  HOLIDAY: { label: "휴일", className: "bg-rose-500/20 text-rose-400" },
  WORK:    { label: "업무", className: "bg-blue-500/20 text-blue-400" },
  ABSENCE: { label: "부재", className: "bg-amber-500/20 text-amber-400" },
  ETC:     { label: "기타", className: "bg-zinc-500/20 text-zinc-400" },
  MEETING:     { label: "업무", className: "bg-blue-500/20 text-blue-400" },
  VACATION:    { label: "부재", className: "bg-amber-500/20 text-amber-400" },
  ANNIVERSARY: { label: "기타", className: "bg-zinc-500/20 text-zinc-400" },
};
const FALLBACK_BADGE = { label: "기타", className: "bg-zinc-500/20 text-zinc-400" };
function catBadge(cat: string) { return CAT_BADGE[cat] ?? FALLBACK_BADGE; }

function kstTimeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function DashboardClient() {
  const [todayKst] = React.useState(() => utcMsToKstDateString(Date.now()));
  const weekDates = React.useMemo(() => kstWeekContaining(todayKst), [todayKst]);

  const { members, categories, systems, error: referencesError, reload: reloadReferences } = useWorkReferences();

  // 드로어 + 수정 폼
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerReloadKey, setDrawerReloadKey] = React.useState(0);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkItemListItem | null>(null);

  const loadWorkItems = React.useCallback(async (signal: AbortSignal) => {
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];
    const [countsRes, dueRes, inProgressRes] = await Promise.all([
      api.get<WorkItemCounts>("/api/work-items/count", { signal }),
      api.getAllPages<WorkItemListItem>("/api/work-items", {
        signal,
        query: {
          scope: "active",
          transferDate: weekStart,
          transferDateTo: weekEnd,
          pageSize: 100,
        },
      }),
      api.getAllPages<WorkItemListItem>("/api/work-items", {
        signal,
        query: { scope: "active", status: "IN_PROGRESS", pageSize: 100 },
      }),
    ]);
    return {
      counts: countsRes,
      dueThisWeek: dueRes
        .filter((item) => item.status !== "HOLDING" && item.transferDate !== null)
        .sort((a, b) => {
          const ad = utcMsToKstDateString(new Date(a.transferDate!).getTime());
          const bd = utcMsToKstDateString(new Date(b.transferDate!).getTime());
          return ad.localeCompare(bd);
        }),
      inProgress: inProgressRes,
    };
  }, [weekDates]);

  const loadLogs = React.useCallback(async (signal: AbortSignal) => {
    const res = await api.get<ListResponse<AuditLog>>("/api/audit-logs", { signal, query: { pageSize: 10 } });
    return res.items;
  }, []);

  const loadCalendarEvents = React.useCallback(async (signal: AbortSignal) => {
    const todayFromMs = kstDateStringToUtcMs(todayKst);
    const todayToMs = todayFromMs + DAY_MS;

    const res = await api.get<{ items: CalendarEvent[] }>("/api/calendar-events", {
      signal,
      query: {
        from: new Date(todayFromMs).toISOString(),
        to: new Date(todayToMs).toISOString(),
      },
    });
    return res.items.slice().sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      const catDiff = (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99);
      if (catDiff !== 0) return catDiff;
      return a.title.localeCompare(b.title, "ko");
    });
  }, [todayKst]);

  const work = useDashboardData(loadWorkItems, "작업 현황을 불러오지 못했습니다.");
  const activity = useDashboardData(loadLogs, "활동 로그를 불러오지 못했습니다.");
  const calendar = useDashboardData(loadCalendarEvents, "오늘 일정을 불러오지 못했습니다.");
  const { reload: reloadWork } = work;
  const { reload: reloadActivity } = activity;
  const { reload: reloadCalendar } = calendar;
  const counts = work.data?.counts ?? null;
  const dueThisWeek = work.data?.dueThisWeek ?? null;
  const inProgress = work.data?.inProgress ?? null;
  const logs = activity.data;
  const calEvents = calendar.data;
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshWorkItems = React.useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void reloadWork();
      void reloadActivity();
    }, 100);
  }, [reloadWork, reloadActivity]);

  React.useEffect(() => {
    const reload = () => {
      refreshWorkItems();
      void reloadCalendar();
    };
    const reloadWhenVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener(WORK_ITEMS_CHANGED_EVENT, refreshWorkItems);
    window.addEventListener(TODOS_CHANGED_EVENT, reloadActivity);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reloadWhenVisible);
    return () => {
      if (refreshTimer.current !== null) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      window.removeEventListener(WORK_ITEMS_CHANGED_EVENT, refreshWorkItems);
      window.removeEventListener(TODOS_CHANGED_EVENT, reloadActivity);
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reloadWhenVisible);
    };
  }, [refreshWorkItems, reloadCalendar, reloadActivity]);

  React.useEffect(() => {
    const es = new EventSource("/api/calendar-events/stream");
    let connected = false;
    const reload = () => {
      void reloadCalendar();
      void reloadActivity();
    };
    es.onmessage = reload;
    es.onopen = () => {
      if (connected) reload();
      connected = true;
    };
    return () => es.close();
  }, [reloadCalendar, reloadActivity]);

  // 이관일 라벨
  function transferDateLabel(transferDate: string) {
    const d = utcMsToKstDateString(new Date(transferDate).getTime());
    if (d === todayKst) return { text: "오늘", className: "text-primary font-semibold" };
    const tomorrow = utcMsToKstDateString(kstDateStringToUtcMs(todayKst) + DAY_MS);
    if (d === tomorrow) return { text: "내일", className: "text-amber-500 font-medium" };
    const [, m, dd] = d.split("-");
    return { text: `${Number(m)}/${Number(dd)}`, className: "text-muted-foreground" };
  }

  return (
    <div className="px-8 py-6 space-y-6">
      {/* 헤더 */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">홈</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {todayKst} · {weekDates[0].slice(5).replace("-", "/")} – {weekDates[6].slice(5).replace("-", "/")} 주
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(work.loading || activity.loading || calendar.loading) && <span role="status" className="text-xs text-muted-foreground">불러오는 중…</span>}
          <Button variant="outline" size="sm" onClick={() => { refreshWorkItems(); void reloadCalendar(); }} disabled={work.loading || activity.loading || calendar.loading}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            새로고침
          </Button>
        </div>
      </header>

      {work.error && <QueryError message={`${work.error}${work.data ? " 현재 표시된 내용은 최신 상태가 아닐 수 있습니다." : ""}`} onRetry={refreshWorkItems} />}
      {referencesError && <QueryError message={referencesError} onRetry={() => void reloadReferences()} />}

      {/* 작업 현황 통계 */}
      <div aria-busy={work.loading}><StatusStats counts={counts} /></div>

      {/* 3열: 이번주 이관 예정 | 진행중인 작업 | 오늘 일정 */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 이번주 이관 예정 */}
        <section className="rounded-lg border bg-card" aria-busy={work.loading}>
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">이번주 이관 예정</h2>
              <span className="text-xs text-muted-foreground">
                ({weekDates[0].slice(5).replace("-", "/")} – {weekDates[6].slice(5).replace("-", "/")})
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{dueThisWeek?.length ?? "—"}건</span>
          </header>
          <div className="p-2">
            {dueThisWeek === null ? (
              work.error ? <EmptyRow icon={<CalendarClock className="h-4 w-4" />}>작업을 조회하지 못했습니다.</EmptyRow> : <SkeletonRows />
            ) : dueThisWeek.length === 0 ? (
              <EmptyRow icon={<CalendarClock className="h-4 w-4" />}>
                이번주 이관 예정인 작업이 없습니다.
              </EmptyRow>
            ) : (
              <ul>
                {dueThisWeek.map((item) => {
                  const dateLabel = transferDateLabel(item.transferDate!);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setDrawerId(item.id)}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent/40 text-left"
                      >
                        <span className={cn("w-9 shrink-0 text-right text-xs tabular-nums", dateLabel.className)}>
                          {dateLabel.text}
                        </span>
                        <StatusBadge status={item.status} />
                        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.assignee?.name ?? "미배정"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* 진행중인 작업 */}
        <section className="rounded-lg border bg-card" aria-busy={work.loading}>
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">진행중인 작업</h2>
            </div>
            <span className="text-xs text-muted-foreground">{inProgress?.length ?? "—"}건</span>
          </header>
          <div className="p-2">
            {inProgress === null ? (
              work.error ? <EmptyRow icon={<Loader2 className="h-4 w-4" />}>작업을 조회하지 못했습니다.</EmptyRow> : <SkeletonRows />
            ) : inProgress.length === 0 ? (
              <EmptyRow icon={<Loader2 className="h-4 w-4" />}>
                진행중인 작업이 없습니다.
              </EmptyRow>
            ) : (
              <ul>
                {inProgress.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setDrawerId(item.id)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent/40 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.assignee?.name ?? "미배정"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 오늘 일정 */}
        <section className="rounded-lg border bg-card" aria-busy={calendar.loading}>
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">오늘 일정</h2>
            </div>
            <Link
              href="/calendar"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              캘린더
            </Link>
          </header>
          <div className="p-2">
            {calendar.error && <QueryError message={calendar.error} onRetry={() => void reloadCalendar()} />}
            {calEvents === null ? (
              calendar.error ? null : <SkeletonRows />
            ) : calEvents.length === 0 ? (
              <EmptyRow icon={<CalendarDays className="h-4 w-4" />}>
                오늘 일정이 없습니다.
              </EmptyRow>
            ) : (
              <ul className="space-y-0.5">
                {calEvents.map((ev) => {
                  const badge = catBadge(ev.category);
                  const names = ev.members.map((m) => m.member.name).join(", ");
                  return (
                    <li
                      key={ev.id}
                      className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("shrink-0 rounded-sm px-1 text-[9px] font-semibold leading-[14px]", badge.className)}>
                          {badge.label}
                        </span>
                        <span className="truncate font-medium">{ev.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 pl-0.5 text-xs text-muted-foreground">
                        <span>{ev.allDay ? "종일" : kstTimeStr(ev.startDateTime)}</span>
                        {names && <><span>·</span><span className="truncate">{names}</span></>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* 최근 활동 */}
      <section className="rounded-lg border bg-card" aria-busy={activity.loading}>
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">최근 활동</h2>
          </div>
        </header>
        <div className="p-2">
          {activity.error && <QueryError message={activity.error} onRetry={() => void reloadActivity()} />}
          {logs === null ? (
            activity.error ? null : <SkeletonRows />
          ) : logs.length === 0 ? (
            <EmptyRow icon={<ListChecks className="h-4 w-4" />}>
              기록된 활동이 없습니다.
            </EmptyRow>
          ) : (
            <ul className="divide-y">
              {logs.map((log) => (
                <li key={log.id} className="px-2 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[12px] text-foreground/75">
                      <span className="font-medium text-foreground/65">
                        {log.actorName ?? "익명"}
                      </span>
                      {" · "}
                      <span>{ENTITY_LABELS[log.entityType] ?? log.entityType}</span>
                      {" "}
                      <span className="text-muted-foreground/80">
                        #{shortEntityId(log.entityId)}
                      </span>
                      {" · "}
                      <span>{ACTION_LABELS[log.action] ?? log.action}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/80">
                      {formatDateTime(log.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 작업 상세 드로어 */}
      <WorkItemDrawer
        workItemId={drawerId}
        reloadKey={drawerReloadKey}
        categories={categories}
        systems={systems}
        onClose={() => setDrawerId(null)}
        onEdit={(item) => {
          setEditing(item);
          setFormOpen(true);
        }}
        onDeleted={() => {
          setDrawerId(null);
          refreshWorkItems();
        }}
        onMutated={refreshWorkItems}
      />

      <WorkItemFormDialog
        open={formOpen}
        editing={editing}
        members={members}
        categories={categories}
        systems={systems}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refreshWorkItems();
          if (drawerId) setDrawerReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}

// ── 작업 현황 통계 ────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<Status, { bar: string; text: string }> = {
  WAITING:        { bar: "bg-muted-foreground/30",   text: "text-muted-foreground" },
  IN_PROGRESS:    { bar: "bg-blue-500",              text: "text-blue-500" },
  INTERNAL_TEST:  { bar: "bg-violet-500",            text: "text-violet-500" },
  BUSINESS_TEST:  { bar: "bg-amber-500",             text: "text-amber-500" },
  QA_TEST:        { bar: "bg-orange-500",            text: "text-orange-500" },
  TRANSFER_READY: { bar: "bg-cyan-500",              text: "text-cyan-500" },
  TRANSFERRED:    { bar: "bg-emerald-500",           text: "text-emerald-500" },
  HOLDING:        { bar: "bg-red-500",               text: "text-red-500" },
};

function StatusStats({ counts }: { counts: WorkItemCounts | null }) {
  const total = counts?.total ?? 0;

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">{counts === null ? "—" : total}</span>
        <span className="text-sm text-muted-foreground">건 전체</span>
      </div>
      {/* 진행 바 */}
      {counts !== null && total > 0 && (
        <div className="mb-4 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
          {STATUSES.map((s) => {
            const cnt = counts.byStatus[s] ?? 0;
            if (cnt === 0) return null;
            return (
              <div
                key={s}
                className={cn("h-full transition-all", STATUS_STYLE[s].bar)}
                style={{ width: `${(cnt / total) * 100}%` }}
                title={`${STATUS_LABELS[s]}: ${cnt}건`}
              />
            );
          })}
        </div>
      )}
      {/* 상태별 카드 */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {STATUSES.map((s) => {
          const cnt = counts?.byStatus[s] ?? 0;
          const style = STATUS_STYLE[s];
          return (
            <div key={s} className="flex flex-col gap-1 rounded-md bg-muted/40 px-2 py-2">
              <span className="text-[10px] text-muted-foreground leading-tight">{STATUS_LABELS[s]}</span>
              <span className={cn("text-lg font-bold tabular-nums leading-none", counts === null ? "text-muted-foreground" : style.text)}>
                {counts === null ? "—" : cnt}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 공통 ────────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  CREATE: "생성",
  UPDATE: "수정",
  DELETE: "삭제",
  RESTORE: "복원",
};

const ENTITY_LABELS: Record<string, string> = {
  WorkItem: "작업",
  WorkTicket: "티켓",
  CalendarEvent: "일정",
  TeamMember: "팀원",
  WorkSystem: "시스템",
  WorkCategory: "분류",
};

function shortEntityId(id: string) {
  return id.length > 8 ? id.slice(-8) : id;
}

function SkeletonRows() {
  return (
    <div className="space-y-2 p-2" role="status">
      <span className="sr-only">불러오는 중…</span>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-6 animate-pulse rounded-sm bg-muted" aria-hidden="true" />
      ))}
    </div>
  );
}

function EmptyRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}
