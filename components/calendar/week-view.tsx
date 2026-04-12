"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { kstDateStringToUtcMs, weekdayLabel } from "@/lib/client/calendar";
import { cn } from "@/lib/utils";
import type { CalendarEvent, CalendarEventCategory } from "@/lib/client/types";
import { getCategoryBadge, kstTime } from "./month-view";

const HOUR_HEIGHT = 64; // px per hour → 1536px total
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Event layout helpers ──────────────────────────────────────────────────────

type SlottedEvent = {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  col: number;
  totalCols: number;
};

function clipToDay(
  startIso: string,
  endIso: string,
  dayKey: string,
): { startMin: number; endMin: number } {
  const dayStartMs = kstDateStringToUtcMs(dayKey);
  const dayEndMs = dayStartMs + DAY_MS;
  const startMs = Math.max(new Date(startIso).getTime(), dayStartMs);
  const endMs = Math.min(new Date(endIso).getTime(), dayEndMs);
  return {
    startMin: Math.max(0, Math.floor((startMs - dayStartMs) / 60_000)),
    endMin: Math.min(1440, Math.ceil((endMs - dayStartMs) / 60_000)),
  };
}

function layoutTimedEvents(
  events: CalendarEvent[],
  dayKey: string,
): SlottedEvent[] {
  const items = events
    .filter((e) => !e.allDay)
    .map((e) => {
      const { startMin, endMin } = clipToDay(
        e.startDateTime,
        e.endDateTime,
        dayKey,
      );
      return { event: e, startMin, endMin: Math.max(endMin, startMin + 30) };
    })
    .filter((item) => item.endMin > item.startMin)
    .sort(
      (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
    );

  const colEnds: number[] = [];
  const assigned: (SlottedEvent & { col: number })[] = [];

  for (const item of items) {
    let col = colEnds.findIndex((end) => end <= item.startMin);
    if (col === -1) col = colEnds.length;
    colEnds[col] = item.endMin;
    assigned.push({ ...item, col, totalCols: 0 });
  }

  // Determine totalCols per event based on peak overlap
  for (let i = 0; i < assigned.length; i++) {
    let maxCol = assigned[i].col;
    for (let j = 0; j < assigned.length; j++) {
      if (
        assigned[i].startMin < assigned[j].endMin &&
        assigned[j].startMin < assigned[i].endMin
      ) {
        maxCol = Math.max(maxCol, assigned[j].col);
      }
    }
    assigned[i].totalCols = maxCol + 1;
  }

  return assigned;
}

// ── Positioned event block ────────────────────────────────────────────────────

function PositionedEvent({
  item,
  onClick,
}: {
  item: SlottedEvent;
  onClick: () => void;
}) {
  const { event, startMin, endMin, col, totalCols } = item;
  const top = (startMin / 60) * HOUR_HEIGHT;
  const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 18);
  const widthPct = 100 / totalCols;
  const leftPct = (col / totalCols) * 100;
  const badge = getCategoryBadge(event.category);
  const names = event.members.map((m) => m.member.name).join(", ");

  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute",
        top,
        height,
        left: `calc(${leftPct}% + 1px)`,
        width: `calc(${widthPct}% - 2px)`,
      }}
      className={cn(
        "overflow-hidden rounded border px-1 py-0.5 text-left hover:opacity-90 z-10",
        badge.className,
        "border-current/30",
      )}
    >
      {/* 카테고리 + 제목 */}
      <div className="flex items-center gap-0.5 min-w-0">
        <span className="shrink-0 rounded px-0.5 text-[8px] font-semibold leading-[13px] border border-current/30">
          {badge.label}
        </span>
        <span className="text-[10px] font-medium leading-tight truncate">
          {event.title}
        </span>
      </div>
      {/* 시간 (항상 표시) */}
      {height > 24 && (
        <div className="text-[9px] leading-tight opacity-75 mt-0.5">
          {kstTime(event.startDateTime)}
          {names && (
            <span className="ml-1 opacity-80 truncate block">{names}</span>
          )}
        </div>
      )}
    </button>
  );
}

// ── All-day cell ──────────────────────────────────────────────────────────────

function AllDayCell({
  events,
  dayKey,
  onAddClick,
  onEventClick,
}: {
  events: CalendarEvent[];
  dayKey: string;
  onAddClick: () => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  return (
    <div className="group relative min-h-[2.5rem] border-r last:border-r-0 p-1 space-y-0.5">
      {events.map((ev) => {
        const badge = getCategoryBadge(ev.category);
        return (
          <button
            key={ev.id}
            onClick={() => onEventClick(ev)}
            className={cn(
              "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:opacity-80",
              badge.className,
            )}
          >
            <span className="text-[9px] font-semibold">{badge.label}</span>
            <span className="text-[10px] font-medium truncate">{ev.title}</span>
          </button>
        );
      })}
      <button
        onClick={onAddClick}
        className="absolute right-0.5 top-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
        aria-label="이벤트 추가"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────────────────────────

type Props = {
  weekDates: string[]; // 7 KST date strings, Sun–Sat
  today: string;
  eventsByDay: Map<string, CalendarEvent[]>;
  onAddClick: (dayKey: string) => void;
  onEventClick: (event: CalendarEvent) => void;
};

export function WeekView({
  weekDates,
  today,
  eventsByDay,
  onAddClick,
  onEventClick,
}: Props) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Scroll to 8 AM on mount
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT - 8;
    }
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden border rounded-lg bg-card">
      {/* Day header */}
      <div
        className="grid shrink-0 border-b"
        style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}
      >
        <div className="border-r" />
        {weekDates.map((d, i) => {
          const dayNum = Number(d.slice(8, 10));
          const month = Number(d.slice(5, 7));
          const isToday = d === today;
          const colIdx = i;
          return (
            <div
              key={d}
              className={cn(
                "border-r last:border-r-0 py-2 text-center",
                colIdx === 0 && "text-rose-500",
                colIdx === 6 && "text-blue-500",
              )}
            >
              <div className="text-[10px] text-muted-foreground">
                {weekdayLabel(i)}
              </div>
              <div
                className={cn(
                  "mx-auto mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium",
                  isToday && "bg-primary text-primary-foreground",
                )}
              >
                {dayNum}
              </div>
              <div className="text-[9px] text-muted-foreground">{month}월</div>
            </div>
          );
        })}
      </div>

      {/* All-day strip */}
      <div
        className="grid shrink-0 border-b"
        style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}
      >
        <div className="border-r flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">종일</span>
        </div>
        {weekDates.map((d) => {
          const allDayEvs = (eventsByDay.get(d) ?? []).filter((e) => e.allDay);
          return (
            <AllDayCell
              key={d}
              events={allDayEvs}
              dayKey={d}
              onAddClick={() => onAddClick(d)}
              onEventClick={onEventClick}
            />
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div
          className="relative"
          style={{ height: HOUR_HEIGHT * 24 }}
        >
          {/* Hour lines */}
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={`line-${h}`}
              className="absolute border-t border-border/40 pointer-events-none"
              style={{ top: h * HOUR_HEIGHT, left: 56, right: 0 }}
            />
          ))}
          {/* Half-hour guides */}
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={`half-${h}`}
              className="absolute border-t border-border/15 pointer-events-none"
              style={{ top: h * HOUR_HEIGHT + HOUR_HEIGHT / 2, left: 56, right: 0 }}
            />
          ))}
          {/* Time labels */}
          {Array.from({ length: 24 }, (_, h) =>
            h === 0 ? null : (
              <div
                key={`label-${h}`}
                className="absolute w-14 pr-2 text-right text-[10px] leading-none text-muted-foreground pointer-events-none select-none"
                style={{ top: h * HOUR_HEIGHT - 6 }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ),
          )}
          {/* Day columns */}
          <div
            className="absolute inset-0 left-14 grid"
            style={{ gridTemplateColumns: "repeat(7, 1fr)" }}
          >
            {weekDates.map((d, i) => {
              const timedEvs = (eventsByDay.get(d) ?? []).filter(
                (e) => !e.allDay,
              );
              const slotted = layoutTimedEvents(timedEvs, d);
              return (
                <div
                  key={d}
                  className={cn(
                    "relative h-full border-r last:border-r-0",
                    i === 0 && "bg-rose-500/3",
                  )}
                >
                  {slotted.map((item) => (
                    <PositionedEvent
                      key={item.event.id}
                      item={item}
                      onClick={() => onEventClick(item.event)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
