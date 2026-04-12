"use client";

import * as React from "react";
import type { WorkItemListItem } from "@/lib/client/types";
import { STATUS_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";

/**
 * Gantt 보기 — 담당자별 가로 타임라인.
 *
 * 1차 범위:
 *  - 시간 축: 가시 작업의 startDate/endDate 범위를 둘러싸는 윈도우
 *    (없으면 오늘 ±14일). 1일 = 32px.
 *  - 행: 담당자 그룹 + 마지막에 "미배정" 그룹
 *  - 일정 정보가 전혀 없는 작업은 본 뷰에 표시하지 않음 (테이블/칸반에서 확인)
 *  - 드래그/리사이즈는 후속 (reorder API와 함께 검토)
 *
 * 시간 처리는 KST 자정 기준의 단순 일(day) 그리드.
 * 한 작업의 길이는 (endDate - startDate + 1) 일. endDate가 없으면 startDate 단일 일.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const COL_WIDTH = 32; // 1일 = 32px
const LABEL_WIDTH = 160;

type ScheduledItem = WorkItemListItem & {
  // KST 자정 기준 epoch ms
  startMs: number;
  endMs: number;
};

const STATUS_BG: Record<string, string> = {
  DRAFT: "var(--status-draft)",
  IN_PROGRESS: "var(--status-in-progress)",
  READY_TO_TRANSFER: "var(--status-ready)",
  TRANSFERRED: "var(--status-transferred)",
  CANCELED: "var(--status-canceled)",
};

export function GanttView({
  items,
  onOpen,
}: {
  items: WorkItemListItem[];
  onOpen: (item: WorkItemListItem) => void;
}) {
  const scheduled = React.useMemo(() => buildScheduled(items), [items]);
  const groups = React.useMemo(() => groupByAssignee(scheduled), [scheduled]);
  const window = React.useMemo(() => computeWindow(scheduled), [scheduled]);

  if (scheduled.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card py-16 text-center">
        <p className="text-sm font-medium">일정이 설정된 작업이 없습니다</p>
        <p className="text-xs text-muted-foreground">
          작업의 시작일/종료일을 입력하면 Gantt에 표시됩니다.
        </p>
      </div>
    );
  }

  const totalDays = window.totalDays;
  const trackWidth = totalDays * COL_WIDTH;

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div style={{ width: LABEL_WIDTH + trackWidth }}>
        {/* 헤더: 일자 눈금 */}
        <div className="flex border-b">
          <div
            className="shrink-0 border-r bg-card px-3 py-2 text-xs font-medium text-muted-foreground"
            style={{ width: LABEL_WIDTH }}
          >
            담당자
          </div>
          <div className="flex" style={{ width: trackWidth }}>
            {Array.from({ length: totalDays }).map((_, i) => {
              const ms = window.startMs + i * DAY_MS;
              const date = new Date(ms);
              const day = date.getUTCDate();
              const isFirst = day === 1 || i === 0;
              const isWeekend =
                date.getUTCDay() === 0 || date.getUTCDay() === 6;
              return (
                <div
                  key={i}
                  className={cn(
                    "shrink-0 border-r text-center text-[10px] leading-tight",
                    isWeekend && "bg-muted/30",
                    isFirst && "font-semibold text-foreground",
                  )}
                  style={{ width: COL_WIDTH }}
                  title={date.toISOString().slice(0, 10)}
                >
                  <div className="pt-1 text-muted-foreground">
                    {isFirst ? `${date.getUTCMonth() + 1}월` : ""}
                  </div>
                  <div className="pb-1">{day}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 행 */}
        {groups.map((group) => (
          <div key={group.key} className="flex items-stretch border-b last:border-0">
            <div
              className="shrink-0 border-r px-3 py-3 text-sm font-medium"
              style={{ width: LABEL_WIDTH }}
            >
              {group.label}
              <div className="text-xs text-muted-foreground">
                {group.items.length}건
              </div>
            </div>
            <div
              className="relative"
              style={{ width: trackWidth, minHeight: 56 }}
            >
              {/* weekend background */}
              <div className="absolute inset-0 flex">
                {Array.from({ length: totalDays }).map((_, i) => {
                  const date = new Date(window.startMs + i * DAY_MS);
                  const isWeekend =
                    date.getUTCDay() === 0 || date.getUTCDay() === 6;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "shrink-0 border-r border-border/30",
                        isWeekend && "bg-muted/20",
                      )}
                      style={{ width: COL_WIDTH }}
                    />
                  );
                })}
              </div>

              {/* bars */}
              <div className="relative flex flex-col gap-1 py-1.5">
                {group.items.map((item) => {
                  const startCol =
                    Math.floor((item.startMs - window.startMs) / DAY_MS);
                  const spanDays = Math.max(
                    1,
                    Math.floor((item.endMs - item.startMs) / DAY_MS) + 1,
                  );
                  return (
                    <button
                      key={item.id}
                      onClick={() => onOpen(item)}
                      title={`${item.title} · ${STATUS_LABELS[item.status]}`}
                      className="group relative flex h-6 items-center overflow-hidden rounded text-left text-[11px] font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                      style={{
                        marginLeft: startCol * COL_WIDTH,
                        width: spanDays * COL_WIDTH - 2,
                        background: `hsl(${STATUS_BG[item.status] ?? STATUS_BG.DRAFT})`,
                      }}
                    >
                      <span className="truncate px-1.5">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildScheduled(items: WorkItemListItem[]): ScheduledItem[] {
  const out: ScheduledItem[] = [];
  for (const item of items) {
    if (!item.startDate && !item.endDate) continue;
    const start = item.startDate ?? item.endDate!;
    const end = item.endDate ?? item.startDate!;
    out.push({
      ...item,
      startMs: toDayStart(start),
      endMs: toDayStart(end),
    });
  }
  return out;
}

function toDayStart(iso: string): number {
  // KST 자정 기준 day key. en-CA로 yyyy-mm-dd 추출 후 UTC epoch 만들기.
  const ymd = new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

type Group = { key: string; label: string; items: ScheduledItem[] };

function groupByAssignee(items: ScheduledItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const item of items) {
    const key = item.assigneeId ?? "__unassigned__";
    const label = item.assignee?.name ?? "미배정";
    let group = map.get(key);
    if (!group) {
      group = { key, label, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }
  // 정렬: 미배정은 마지막
  return [...map.values()].sort((a, b) => {
    if (a.key === "__unassigned__") return 1;
    if (b.key === "__unassigned__") return -1;
    return a.label.localeCompare(b.label, "ko");
  });
}

function computeWindow(items: ScheduledItem[]): {
  startMs: number;
  totalDays: number;
} {
  const todayMs = toDayStart(new Date().toISOString());
  if (items.length === 0) {
    return { startMs: todayMs - 14 * DAY_MS, totalDays: 28 };
  }
  let minMs = items[0].startMs;
  let maxMs = items[0].endMs;
  for (const it of items) {
    if (it.startMs < minMs) minMs = it.startMs;
    if (it.endMs > maxMs) maxMs = it.endMs;
  }
  // 양쪽 패딩 7일
  const startMs = Math.min(minMs, todayMs) - 7 * DAY_MS;
  const endMs = Math.max(maxMs, todayMs) + 7 * DAY_MS;
  const totalDays = Math.floor((endMs - startMs) / DAY_MS) + 1;
  return { startMs, totalDays };
}
