"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  kstMonthEnd,
  kstMonthStart,
  utcMsToKstDateString,
  weekdayLabel,
} from "@/lib/client/calendar";
import { cn } from "@/lib/utils";
import type { CalendarEvent, CalendarEventCategory } from "@/lib/client/types";

// Record는 알려진 타입만 커버 — 구 값(MEETING 등)은 catOrder() 헬퍼로 안전하게 조회
export const CATEGORY_ORDER: Record<CalendarEventCategory, number> = {
  HOLIDAY: 0,
  WORK:    1,
  ABSENCE: 2,
  ETC:     3,
};
const CATEGORY_ORDER_FALLBACK: Record<string, number> = {
  ...CATEGORY_ORDER,
  MEETING: 1, VACATION: 2, ANNIVERSARY: 3,
};
export function catOrder(cat: string): number {
  return CATEGORY_ORDER_FALLBACK[cat] ?? 99;
}

/** 종일 우선 → 카테고리 → 제목 asc */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.slice().sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    const catDiff = catOrder(a.category) - catOrder(b.category);
    if (catDiff !== 0) return catDiff;
    return a.title.localeCompare(b.title, "ko");
  });
}

const CATEGORY_BADGE_MAP: Record<string, { label: string; className: string }> = {
  HOLIDAY: { label: "휴일", className: "bg-rose-500/20 text-rose-400" },
  WORK:    { label: "업무", className: "bg-blue-500/20 text-blue-400" },
  ABSENCE: { label: "부재", className: "bg-amber-500/20 text-amber-400" },
  ETC:     { label: "기타", className: "bg-zinc-500/20 text-zinc-400" },
  // 구 카테고리 폴백
  ANNIVERSARY: { label: "기타", className: "bg-zinc-500/20 text-zinc-400" },
  MEETING:     { label: "업무", className: "bg-blue-500/20 text-blue-400" },
  VACATION:    { label: "부재", className: "bg-amber-500/20 text-amber-400" },
};
const FALLBACK_BADGE = { label: "기타", className: "bg-zinc-500/20 text-zinc-400" };

export const CATEGORY_BADGE: Record<CalendarEventCategory, { label: string; className: string }> =
  CATEGORY_BADGE_MAP as Record<CalendarEventCategory, { label: string; className: string }>;

export function getCategoryBadge(category: string) {
  return CATEGORY_BADGE_MAP[category] ?? FALLBACK_BADGE;
}

export function kstTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Props = {
  grid: number[];
  cursor: { year: number; month0: number };
  today: string;
  eventsByDay: Map<string, CalendarEvent[]>;
  onAddClick: (dayKey: string) => void;
  onEventClick: (event: CalendarEvent) => void;
};

// ── Draggable event chip ──────────────────────────────────────────────────────

function DraggableChip({
  event,
  dayKey,
  onClick,
}: {
  event: CalendarEvent;
  dayKey: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${event.id}__${dayKey}`,
    data: {
      eventId: event.id,
      originalStartDateTime: event.startDateTime,
      originalEndDateTime: event.endDateTime,
      updatedAt: event.updatedAt,
      sourceDayKey: dayKey,
    },
  });

  const badge = getCategoryBadge(event.category);
  const names = event.members.map((m) => m.member.name);
  const memberText = names.join(", ");

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col rounded bg-muted/60 px-1 py-0.5 text-left hover:bg-muted touch-none select-none",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span
          className={cn(
            "shrink-0 rounded px-1 text-[9px] font-semibold leading-[14px]",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="text-[11px] font-medium leading-tight text-foreground break-all">
          {event.title}
        </span>
      </div>
      {(!event.allDay || memberText) && (
        <span className="text-[10px] leading-tight text-muted-foreground pl-0.5 break-all">
          {!event.allDay &&
            `${kstTime(event.startDateTime)}${memberText ? " · " : ""}`}
          {memberText}
        </span>
      )}
    </button>
  );
}

// ── Droppable day cell ────────────────────────────────────────────────────────

function DroppableCell({
  dayKey,
  className,
  children,
}: {
  dayKey: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && "ring-2 ring-primary/30 ring-inset")}
    >
      {children}
    </div>
  );
}

// ── Month grid ────────────────────────────────────────────────────────────────

export function MonthView({
  grid,
  cursor,
  today,
  eventsByDay,
  onAddClick,
  onEventClick,
}: Props) {
  const monthStartMs = kstMonthStart(cursor.year, cursor.month0);
  const monthEndMs = kstMonthEnd(cursor.year, cursor.month0);

  return (
    <div className="h-full overflow-auto">
      <div className="overflow-hidden rounded-lg border bg-card">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "px-2 py-2 text-center",
                i === 0 && "text-rose-500",
                i === 6 && "text-blue-500",
              )}
            >
              {weekdayLabel(i)}
            </div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7">
          {grid.map((dayMs, idx) => {
            const dayKey = utcMsToKstDateString(dayMs);
            const inMonth = dayMs >= monthStartMs && dayMs < monthEndMs;
            const isToday = dayKey === today;
            const rawEvents = eventsByDay.get(dayKey) ?? [];
            const dayEvents = sortEvents(rawEvents);
            const dayNum = Number(dayKey.slice(8, 10));
            const colIdx = idx % 7;
            const isSunday = colIdx === 0;
            const holidayEvents = dayEvents.filter((e) => e.category === "HOLIDAY");
            const isHoliday = isSunday || holidayEvents.length > 0;
            const chipEvents = dayEvents.filter((e) => e.category !== "HOLIDAY");

            return (
              <DroppableCell
                key={dayKey}
                dayKey={dayKey}
                className={cn(
                  "group relative min-h-[110px] border-b border-r p-1.5",
                  idx >= 35 && "border-b-0",
                  (idx + 1) % 7 === 0 && "border-r-0",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                  isHoliday && inMonth && "bg-rose-500/5",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 shrink-0 items-center justify-center text-xs",
                        colIdx === 0 && inMonth && "text-rose-500",
                        colIdx === 6 && inMonth && "text-blue-500",
                        isToday &&
                          "rounded-full bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {dayNum}
                    </span>
                    {holidayEvents.length > 0 && (
                      <span className="truncate text-[10px] font-medium text-rose-400 leading-tight">
                        {holidayEvents.map((e) => e.title).join(" · ")}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onAddClick(dayKey)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                    aria-label="이벤트 추가"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-1 space-y-0.5">
                  {chipEvents.map((event) => (
                    <DraggableChip
                      key={`${event.id}__${dayKey}`}
                      event={event}
                      dayKey={dayKey}
                      onClick={() => onEventClick(event)}
                    />
                  ))}
                </div>
              </DroppableCell>
            );
          })}
        </div>
      </div>
    </div>
  );
}
