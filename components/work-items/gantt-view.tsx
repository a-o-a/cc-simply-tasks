"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/client/api";
import { eventDayKeys } from "@/lib/client/calendar";
import type { CalendarEvent, WorkItemListItem } from "@/lib/client/types";
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
  WAITING: "var(--status-waiting)",
  IN_PROGRESS: "var(--status-in-progress)",
  INTERNAL_TEST: "var(--status-internal-test)",
  BUSINESS_TEST: "var(--status-business-test)",
  QA_TEST: "var(--status-qa-test)",
  TRANSFER_READY: "var(--status-transfer-ready)",
  TRANSFERRED: "var(--status-transferred)",
  HOLDING: "var(--status-holding)",
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

  // 휴일 날짜 세트 (yyyy-mm-dd)
  const [holidayDates, setHolidayDates] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const from = new Date(window.startMs).toISOString();
    const to = new Date(window.startMs + window.totalDays * DAY_MS).toISOString();
    api
      .get<{ items: CalendarEvent[] }>("/api/calendar-events", {
        query: { from, to },
      })
      .then((res) => {
        const dates = new Set<string>();
        for (const ev of res.items) {
          if (ev.category !== "HOLIDAY") continue;
          for (const key of eventDayKeys(ev)) dates.add(key);
        }
        setHolidayDates(dates);
      })
      .catch(() => {});
  }, [window.startMs, window.totalDays]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = React.useState(false);
  const [canRight, setCanRight] = React.useState(false);
  const isDragging = React.useRef(false);
  const dragStartX = React.useRef(0);
  const dragStartLeft = React.useRef(0);

  // 크로스헤어: 호버 중인 열(날짜 인덱스)과 행(담당자 key)
  const [hoveredCol, setHoveredCol] = React.useState<number | null>(null);
  const [hoveredGroupKey, setHoveredGroupKey] = React.useState<string | null>(null);

  const updateArrows = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows, scheduled]);

  // 배경 클릭-드래그 스크롤
  function handleMouseDown(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartLeft.current = scrollRef.current?.scrollLeft ?? 0;
  }

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !scrollRef.current) return;
      scrollRef.current.scrollLeft =
        dragStartLeft.current - (e.clientX - dragStartX.current);
    };
    const onMouseUp = () => {
      isDragging.current = false;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // 마우스 위치 → 열 인덱스 계산 (스크롤 컨테이너 기준)
  function handleContainerMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const rect = el.getBoundingClientRect();
    const xFromTrackStart = e.clientX - rect.left + el.scrollLeft - LABEL_WIDTH;
    if (xFromTrackStart < 0) {
      setHoveredCol(null);
      return;
    }
    setHoveredCol(Math.floor(xFromTrackStart / COL_WIDTH));
  }

  function handleContainerMouseLeave() {
    setHoveredCol(null);
    setHoveredGroupKey(null);
  }

  function scrollBy(px: number) {
    scrollRef.current?.scrollBy({ left: px, behavior: "smooth" });
  }

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

  // 오늘 열 인덱스
  const todayMs = toDayStart(new Date().toISOString());
  const todayCol = Math.floor((todayMs - window.startMs) / DAY_MS);
  const todayInRange = todayCol >= 0 && todayCol < totalDays;

  return (
    <div className="relative">
      {/* 좌측 화살표 — 담당자 고정 영역 오른쪽에 아이콘만 */}
      {canLeft && (
        <button
          onClick={() => scrollBy(-320)}
          className="absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-6 w-6 rounded-full bg-card border shadow-sm hover:bg-accent"
          style={{ left: LABEL_WIDTH + 4 }}
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {/* 우측 화살표 */}
      {canRight && (
        <button
          onClick={() => scrollBy(320)}
          className="absolute right-0 top-0 bottom-0 z-20 flex items-center pr-1 pl-4 bg-gradient-to-l from-card via-card/70 to-transparent"
        >
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      )}

      <div
        ref={scrollRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={handleContainerMouseLeave}
        className="overflow-x-auto rounded-lg border bg-card cursor-grab active:cursor-grabbing"
      >
        <div style={{ width: LABEL_WIDTH + trackWidth }}>
          {/* 헤더: 일자 눈금 */}
          <div className="flex border-b">
            <div
              className="sticky left-0 z-10 shrink-0 border-r bg-card px-3 py-2 text-xs font-medium text-muted-foreground"
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
                const isSaturday = date.getUTCDay() === 6;
                const isSunday = date.getUTCDay() === 0;
                const dateKey = date.toISOString().slice(0, 10);
                const isHoliday = !isSunday && holidayDates.has(dateKey);
                const isHovered = hoveredCol === i;
                const isToday = i === todayCol;
                return (
                  <div
                    key={i}
                    className={cn(
                      "relative shrink-0 border-r text-center text-[10px] leading-tight transition-colors",
                      isSaturday && "bg-blue-50 dark:bg-blue-950/30 text-blue-500 dark:text-blue-400",
                      (isSunday || isHoliday) && "bg-red-50 dark:bg-red-950/30 text-red-500 dark:text-red-400",
                      isFirst && "font-semibold",
                      isToday && "bg-gray-200 dark:bg-gray-600/50 text-gray-700 dark:text-gray-200 font-semibold",
                      isHovered && !isToday && "bg-primary/10 text-primary font-semibold",
                    )}
                    style={{ width: COL_WIDTH }}
                    title={date.toISOString().slice(0, 10)}
                  >
                    <div className="pt-1">
                      {isFirst ? `${date.getUTCMonth() + 1}월` : ""}
                    </div>
                    <div className="pb-1">{day}</div>
                    {/* 오늘 세로선 상단 */}
                    {isToday && (
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 h-1.5 bg-gray-400 dark:bg-gray-500 rounded-t" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 행 */}
          {groups.map((group) => {
            const isRowHovered = hoveredGroupKey === group.key;
            return (
              <div
                key={group.key}
                className="flex items-stretch border-b last:border-0"
                onMouseEnter={() => setHoveredGroupKey(group.key)}
                onMouseLeave={() => setHoveredGroupKey(null)}
              >
                {/* 담당자 고정 레이블 */}
                <div
                  className={cn(
                    "sticky left-0 z-10 shrink-0 border-r px-3 py-3 text-sm font-medium transition-colors",
                    isRowHovered ? "bg-accent" : "bg-card",
                  )}
                  style={{ width: LABEL_WIDTH }}
                >
                  {group.label}
                  <div className="text-xs text-muted-foreground">
                    {group.items.length}건
                  </div>
                </div>

                {/* 타임라인 트랙 */}
                <div
                  className="relative flex items-center"
                  style={{ width: trackWidth, minHeight: 56 }}
                >
                  {/* 날짜 열 배경 (weekend + 크로스헤어 열 하이라이트) */}
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: totalDays }).map((_, i) => {
                      const date = new Date(window.startMs + i * DAY_MS);
                      const isSaturday = date.getUTCDay() === 6;
                      const isSunday = date.getUTCDay() === 0;
                      const dateKey = date.toISOString().slice(0, 10);
                      const isHoliday = !isSunday && holidayDates.has(dateKey);
                      const isColHovered = hoveredCol === i;
                      const isToday = i === todayCol;
                      return (
                        <div
                          key={i}
                          className={cn(
                            "relative shrink-0 border-r border-border/30 transition-colors",
                            isSaturday && "bg-blue-50/50 dark:bg-blue-950/20",
                            (isSunday || isHoliday) && "bg-red-50/50 dark:bg-red-950/20",
                            isToday && "bg-gray-200/60 dark:bg-gray-600/30",
                            isRowHovered && !isColHovered && !isToday && "bg-primary/[0.03]",
                            isColHovered && !isRowHovered && !isToday && "bg-primary/[0.06]",
                            isColHovered && isRowHovered && !isToday && "bg-primary/[0.12]",
                          )}
                          style={{ width: COL_WIDTH }}
                        >
                          {/* 오늘 세로선 */}
                          {isToday && (
                            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-gray-500/60 dark:bg-gray-400/60" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 일정 바 */}
                  <div className="relative flex flex-col gap-1 py-1.5 w-full">
                    {group.items.map((item) => {
                      const startCol = Math.floor(
                        (item.startMs - window.startMs) / DAY_MS,
                      );
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
            );
          })}
        </div>
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
