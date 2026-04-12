"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, ListChecks } from "lucide-react";
import { ApiError, api } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { utcMsToKstDateString } from "@/lib/client/calendar";
import { toast } from "@/lib/client/use-toast";
import type {
  AuditLog,
  ListResponse,
  WorkItemListItem,
} from "@/lib/client/types";
import { STATUSES, type Status } from "@/lib/enums";
import { STATUS_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/work-items/status-badge";

/**
 * 홈 대시보드 — Phase 4 Step 7.
 *
 * 구성:
 *  1. 상태별 카운트 카드 (5개)
 *  2. 오늘 이관 예정 작업 (transferDate가 오늘인 작업)
 *  3. 최근 활동 (audit-logs 최근 10건)
 *
 * 1차 범위에서는 work items 첫 페이지만으로 카운트를 산정한다 (50건).
 * 정확한 전체 카운트는 후속 단계에서 dedicated count API로 분리.
 */

const STATUS_VAR: Record<Status, string> = {
  DRAFT: "--status-draft",
  IN_PROGRESS: "--status-in-progress",
  READY_TO_TRANSFER: "--status-ready",
  TRANSFERRED: "--status-transferred",
  CANCELED: "--status-canceled",
};

export function DashboardClient() {
  const [items, setItems] = React.useState<WorkItemListItem[] | null>(null);
  const [logs, setLogs] = React.useState<AuditLog[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<ListResponse<WorkItemListItem>>("/api/work-items"),
      api.get<ListResponse<AuditLog>>("/api/audit-logs"),
    ])
      .then(([itemsRes, logsRes]) => {
        if (cancelled) return;
        setItems(itemsRes.items);
        setLogs(logsRes.items.slice(0, 10));
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: "대시보드 데이터 조회 실패",
          description: err instanceof ApiError ? err.message : undefined,
          variant: "destructive",
        });
        setItems([]);
        setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusCounts = React.useMemo(() => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
      Status,
      number
    >;
    for (const item of items ?? []) counts[item.status] += 1;
    return counts;
  }, [items]);

  const todayKst = React.useMemo(
    () => utcMsToKstDateString(Date.now()),
    [],
  );
  const dueToday = React.useMemo(
    () =>
      (items ?? []).filter(
        (item) =>
          item.transferDate &&
          utcMsToKstDateString(new Date(item.transferDate).getTime()) ===
            todayKst &&
          item.status !== "TRANSFERRED" &&
          item.status !== "CANCELED",
      ),
    [items, todayKst],
  );

  return (
    <div className="px-8 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">홈</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          오늘 ({todayKst}) 기준의 작업 현황입니다.
        </p>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUSES.map((status) => (
          <Link
            key={status}
            href={`/work-items?status=${status}`}
            className="group rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40"
          >
            <div
              className="text-xs font-medium"
              style={{ color: `hsl(var(${STATUS_VAR[status]}))` }}
            >
              {STATUS_LABELS[status]}
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-3xl font-semibold tabular-nums">
                {items === null ? "—" : statusCounts[status]}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* 오늘 이관 예정 */}
        <section className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">오늘 이관 예정</h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {dueToday.length}건
            </span>
          </header>
          <div className="p-2">
            {items === null ? (
              <SkeletonRows />
            ) : dueToday.length === 0 ? (
              <EmptyRow icon={<CalendarClock className="h-4 w-4" />}>
                오늘 이관 예정인 작업이 없습니다.
              </EmptyRow>
            ) : (
              <ul>
                {dueToday.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent/40"
                  >
                    <StatusBadge status={item.status} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.assignee?.name ?? "미배정"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 최근 활동 */}
        <section className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">최근 활동</h2>
            </div>
            <Link
              href="/work-items"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              전체 보기
            </Link>
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
                  <li key={log.id} className="px-2 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {log.entityType} · {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {log.actorName ?? "익명"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: "생성",
  UPDATE: "수정",
  DELETE: "삭제",
  RESTORE: "복원",
};

function SkeletonRows() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-6 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function EmptyRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground",
      )}
    >
      {icon}
      {children}
    </div>
  );
}

