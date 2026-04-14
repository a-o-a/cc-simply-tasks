"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, ListChecks, Loader2 } from "lucide-react";
import { ApiError, api } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import {
  kstDateStringToUtcMs,
  kstWeekContaining,
  utcMsToKstDateString,
} from "@/lib/client/calendar";
import { toast } from "@/lib/client/use-toast";
import type {
  AuditLog,
  CalendarEvent,
  ListResponse,
  Member,
  WorkCategory,
  WorkItemListItem,
  WorkSystem,
} from "@/lib/client/types";
import { STATUSES, type Status } from "@/lib/enums";
import { STATUS_LABELS } from "@/lib/enum-labels";

type WorkItemCounts = { byStatus: Record<string, number>; total: number };
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/work-items/status-badge";
import { WorkItemDrawer } from "@/components/work-items/work-item-drawer";
import { WorkItemFormDialog } from "@/components/work-items/work-item-form-dialog";

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
  const todayKst = React.useMemo(() => utcMsToKstDateString(Date.now()), []);
  const weekDates = React.useMemo(() => kstWeekContaining(todayKst), [todayKst]);

  const [counts, setCounts] = React.useState<WorkItemCounts | null>(null);
  const [dueThisWeek, setDueThisWeek] = React.useState<WorkItemListItem[] | null>(null);
  const [inProgress, setInProgress] = React.useState<WorkItemListItem[] | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [categories, setCategories] = React.useState<WorkCategory[]>([]);
  const [systems, setSystems] = React.useState<WorkSystem[]>([]);
  const [logs, setLogs] = React.useState<AuditLog[] | null>(null);
  const [calEvents, setCalEvents] = React.useState<CalendarEvent[] | null>(null);

  // 드로어 + 수정 폼
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerReloadKey, setDrawerReloadKey] = React.useState(0);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkItemListItem | null>(null);

  const loadWorkItems = React.useCallback(async () => {
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];
    const [countsRes, dueRes, inProgressRes] = await Promise.all([
      api.get<WorkItemCounts>("/api/work-items/count"),
      api.get<ListResponse<WorkItemListItem>>("/api/work-items", {
        query: {
          scope: "active",
          transferDate: weekStart,
          transferDateTo: weekEnd,
          pageSize: "200",
        },
      }),
      api.get<ListResponse<WorkItemListItem>>("/api/work-items", {
        query: { scope: "active", status: "IN_PROGRESS", pageSize: "200" },
      }),
    ]);
    setCounts(countsRes);
    setDueThisWeek(
      dueRes.items
        .filter((item) => item.status !== "HOLDING")
        .sort((a, b) => {
          const ad = utcMsToKstDateString(new Date(a.transferDate!).getTime());
          const bd = utcMsToKstDateString(new Date(b.transferDate!).getTime());
          return ad.localeCompare(bd);
        }),
    );
    setInProgress(inProgressRes.items);
  }, [weekDates]);

  React.useEffect(() => {
    let cancelled = false;
    const todayFromMs = kstDateStringToUtcMs(todayKst);
    const todayToMs = todayFromMs + DAY_MS;

    Promise.all([
      loadWorkItems(),
      api.get<ListResponse<AuditLog>>("/api/audit-logs"),
      api.get<{ items: CalendarEvent[] }>("/api/calendar-events", {
        query: {
          from: new Date(todayFromMs).toISOString(),
          to: new Date(todayToMs).toISOString(),
        },
      }),
      api.get<ListResponse<Member>>("/api/team-members"),
      api.get<{ items: WorkCategory[] }>("/api/work-categories"),
      api.get<{ items: WorkSystem[] }>("/api/work-systems"),
    ])
      .then(([, logsRes, calRes, membersRes, catRes, sysRes]) => {
        if (cancelled) return;
        setLogs(logsRes.items.slice(0, 10));
        setMembers(membersRes.items);
        setCategories(catRes.items);
        setSystems(sysRes.items);
        // 종일 우선 → 카테고리 순 → 제목 asc
        const sorted = calRes.items.slice().sort((a, b) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
          const catDiff = (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99);
          if (catDiff !== 0) return catDiff;
          return a.title.localeCompare(b.title, "ko");
        });
        setCalEvents(sorted);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: "대시보드 데이터 조회 실패",
          description: err instanceof ApiError ? err.message : undefined,
          variant: "destructive",
        });
        setCounts({ byStatus: {}, total: 0 });
        setDueThisWeek([]);
        setInProgress([]);
        setLogs([]);
        setCalEvents([]);
      });
    return () => { cancelled = true; };
  }, [todayKst, loadWorkItems]);

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
      <header>
        <h1 className="text-xl font-semibold">홈</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {todayKst} · {weekDates[0].slice(5).replace("-", "/")} – {weekDates[6].slice(5).replace("-", "/")} 주
        </p>
      </header>

      {/* 작업 현황 통계 */}
      <StatusStats counts={counts} />

      {/* 3열: 이번주 이관 예정 | 진행중인 작업 | 오늘 일정 */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 이번주 이관 예정 */}
        <section className="rounded-lg border bg-card">
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
              <SkeletonRows />
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
        <section className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">진행중인 작업</h2>
            </div>
            <span className="text-xs text-muted-foreground">{inProgress?.length ?? "—"}건</span>
          </header>
          <div className="p-2">
            {inProgress === null ? (
              <SkeletonRows />
            ) : inProgress.length === 0 ? (
              <EmptyRow icon={<Loader2 className="h-4 w-4" />}>
                진행중인 작업이 없습니다.
              </EmptyRow>
            ) : (
              <ul>
                {inProgress.map((item) => (
                  <li key={item.id}>
                    <button
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
        <section className="rounded-lg border bg-card">
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
            {calEvents === null ? (
              <SkeletonRows />
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
                        <span className={cn("shrink-0 rounded px-1 text-[9px] font-semibold leading-[14px]", badge.className)}>
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
      <section className="rounded-lg border bg-card">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">최근 활동</h2>
          </div>
        </header>
        <div className="p-2">
          {logs === null ? (
            <SkeletonRows />
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
                  {/*
                  {summarizeAuditLog(log) ? (
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground/65">
                      {summarizeAuditLog(log)}
                    </div>
                  ) : null}
                   */}
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
          void loadWorkItems();
        }}
        onMutated={() => void loadWorkItems()}
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
          void loadWorkItems();
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

function prettifyAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "비어 있음";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (Array.isArray(value)) return `${value.length}개`;
  if (typeof value === "object") return "변경됨";
  return String(value);
}

function summarizeAuditLog(log: AuditLog): string | null {
  try {
    const before = log.beforeJson ? JSON.parse(log.beforeJson) as Record<string, unknown> : {};
    const after = log.afterJson ? JSON.parse(log.afterJson) as Record<string, unknown> : {};
    const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])];
    const preferredKeys = [
      "title",
      "name",
      "status",
      "category",
      "priority",
      "requestNumber",
      "requestor",
      "role",
      "startDateTime",
      "endDateTime",
      "startDate",
      "endDate",
      "transferDate",
    ];
    const key = preferredKeys.find((item) => keys.includes(item)) ?? keys[0];
    if (!key) return null;

    if (log.action === "CREATE") {
      return `${key}: ${prettifyAuditValue(after[key])}`;
    }
    if (log.action === "DELETE") {
      return `${key}: ${prettifyAuditValue(before[key])}`;
    }
    return `${key}: ${prettifyAuditValue(before[key])} -> ${prettifyAuditValue(after[key])}`;
  } catch {
    return null;
  }
}

function SkeletonRows() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-6 animate-pulse rounded bg-muted" />
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
