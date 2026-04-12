"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  kstMonthEnd,
  kstMonthGrid,
  kstMonthStart,
  utcMsToKstDateString,
  weekdayLabel,
} from "@/lib/client/calendar";
import { cn } from "@/lib/utils";
import type { Member } from "@/lib/client/types";

type Props = {
  /** 메인 뷰의 현재 커서 — 미니 캘린더 초기값으로 동기화됨. */
  cursor: { year: number; month0: number };
  today: string;
  selectedDate: string;
  members: Member[];
  selectedMemberIds: Set<string>;
  onDateClick: (dayKey: string) => void;
  onMemberToggle: (memberId: string) => void;
  onClearMembers: () => void;
};

export function CalendarSidebar({
  cursor,
  today,
  selectedDate,
  members,
  selectedMemberIds,
  onDateClick,
  onMemberToggle,
  onClearMembers,
}: Props) {
  // 미니 캘린더 자체 커서 (메인 커서 변경 시 동기화)
  const [miniCursor, setMiniCursor] = React.useState(cursor);

  React.useEffect(() => {
    setMiniCursor(cursor);
  }, [cursor.year, cursor.month0]); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = kstMonthGrid(miniCursor.year, miniCursor.month0);
  const monthStartMs = kstMonthStart(miniCursor.year, miniCursor.month0);
  const monthEndMs = kstMonthEnd(miniCursor.year, miniCursor.month0);

  function prevMini() {
    setMiniCursor((c) =>
      c.month0 === 0
        ? { year: c.year - 1, month0: 11 }
        : { year: c.year, month0: c.month0 - 1 },
    );
  }
  function nextMini() {
    setMiniCursor((c) =>
      c.month0 === 11
        ? { year: c.year + 1, month0: 0 }
        : { year: c.year, month0: c.month0 + 1 },
    );
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-card/50 px-3 py-4">
      {/* ── 미니 캘린더 ─────────────────────────────── */}
      <div>
        {/* 헤더 */}
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={prevMini}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="이전 달"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-medium">
            {miniCursor.year}년 {miniCursor.month0 + 1}월
          </span>
          <button
            onClick={nextMini}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="다음 달"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 요일 헤더 */}
        <div className="mb-1 grid grid-cols-7 text-center text-[10px] text-muted-foreground">
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className={cn(i === 0 && "text-rose-500", i === 6 && "text-blue-500")}
            >
              {weekdayLabel(i)}
            </div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div className="grid grid-cols-7 gap-y-0.5">
          {grid.map((dayMs, idx) => {
            const dayKey = utcMsToKstDateString(dayMs);
            const inMonth = dayMs >= monthStartMs && dayMs < monthEndMs;
            const isToday = dayKey === today;
            const isSelected = dayKey === selectedDate;
            const dayNum = Number(dayKey.slice(8, 10));
            const colIdx = idx % 7;

            return (
              <button
                key={dayKey}
                onClick={() => onDateClick(dayKey)}
                className={cn(
                  "h-6 w-full rounded text-center text-[11px] transition-colors",
                  !inMonth && "text-muted-foreground/40",
                  inMonth && !isSelected && colIdx === 0 && "text-rose-500",
                  inMonth && !isSelected && colIdx === 6 && "text-blue-500",
                  isToday && !isSelected && "font-bold",
                  isSelected
                    ? "rounded-full bg-primary text-primary-foreground font-bold"
                    : "hover:bg-accent",
                )}
              >
                {dayNum}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 구분선 ──────────────────────────────────── */}
      {members.length > 0 && <div className="border-t" />}

      {/* ── 팀원 필터 ────────────────────────────────── */}
      {members.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              팀원 필터
            </span>
            {selectedMemberIds.size > 0 && (
              <button
                onClick={onClearMembers}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                전체
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {members.map((m) => {
              const active = selectedMemberIds.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => onMemberToggle(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      active ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="truncate">{m.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
