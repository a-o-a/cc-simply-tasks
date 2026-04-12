"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/client/api";
import {
  eventDayKeys,
  kstDateStringToUtcMs,
  kstMonthEnd,
  kstMonthGrid,
  kstMonthStart,
  utcMsToKstDateString,
  weekdayLabel,
} from "@/lib/client/calendar";
import { toast } from "@/lib/client/use-toast";
import type { CalendarEvent, Member } from "@/lib/client/types";
import { cn } from "@/lib/utils";
import { EventFormDialog } from "./event-form-dialog";

/**
 * 캘린더 페이지 — 월 보기.
 *
 * - KST 기준 1달 그리드(6주 = 42칸), 일요일 시작
 * - 그리드 상단의 from/to 범위를 그대로 GET /api/calendar-events 의 from/to에 사용
 * - 셀의 [+] → 해당 일을 default로 한 생성 모달
 * - 이벤트 칩 클릭 → 수정 모달
 * - 1차 범위에서는 주/일 보기는 생략 (Phase 5+)
 */

type ListResponse = { items: CalendarEvent[] };

export function CalendarClient() {
  const today = React.useMemo(
    () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
    [],
  );

  const [cursor, setCursor] = React.useState(() => {
    const d = new Date();
    return {
      year: Number(
        d.toLocaleDateString("en-US", { timeZone: "Asia/Seoul", year: "numeric" }),
      ),
      month0:
        Number(
          d.toLocaleDateString("en-US", { timeZone: "Asia/Seoul", month: "numeric" }),
        ) - 1,
    };
  });

  const [events, setEvents] = React.useState<CalendarEvent[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [dialogState, setDialogState] = React.useState<
    | { mode: "closed" }
    | { mode: "create"; defaultDate: string }
    | { mode: "edit"; event: CalendarEvent }
  >({ mode: "closed" });

  const grid = React.useMemo(
    () => kstMonthGrid(cursor.year, cursor.month0),
    [cursor],
  );

  const monthStartMs = React.useMemo(
    () => kstMonthStart(cursor.year, cursor.month0),
    [cursor],
  );
  const monthEndMs = React.useMemo(
    () => kstMonthEnd(cursor.year, cursor.month0),
    [cursor],
  );

  // 그리드 전체 범위로 fetch (월 경계 일부가 잘리지 않도록)
  const gridFromMs = grid[0];
  const gridToMs = grid[grid.length - 1] + 24 * 60 * 60 * 1000;

  const loadEvents = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ListResponse>("/api/calendar-events", {
        query: {
          from: new Date(gridFromMs).toISOString(),
          to: new Date(gridToMs).toISOString(),
        },
      });
      setEvents(res.items);
    } catch (err) {
      toast({
        title: "캘린더 조회 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [gridFromMs, gridToMs]);

  const loadMembers = React.useCallback(async () => {
    try {
      const res = await api.get<{ items: Member[] }>("/api/team-members");
      setMembers(res.items);
    } catch {
      // 실패해도 캘린더는 동작
    }
  }, []);

  React.useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  React.useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // dayKey → events
  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      for (const key of eventDayKeys(event)) {
        const list = map.get(key) ?? [];
        list.push(event);
        map.set(key, list);
      }
    }
    return map;
  }, [events]);

  function gotoPrev() {
    setCursor((c) =>
      c.month0 === 0
        ? { year: c.year - 1, month0: 11 }
        : { year: c.year, month0: c.month0 - 1 },
    );
  }
  function gotoNext() {
    setCursor((c) =>
      c.month0 === 11
        ? { year: c.year + 1, month0: 0 }
        : { year: c.year, month0: c.month0 + 1 },
    );
  }
  function gotoToday() {
    const d = new Date();
    setCursor({
      year: Number(
        d.toLocaleDateString("en-US", { timeZone: "Asia/Seoul", year: "numeric" }),
      ),
      month0:
        Number(
          d.toLocaleDateString("en-US", { timeZone: "Asia/Seoul", month: "numeric" }),
        ) - 1,
    });
  }

  return (
    <div className="px-8 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">캘린더</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            팀의 일정을 한눈에. 모든 시각은 KST 기준입니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={gotoToday}>
            오늘
          </Button>
          <div className="flex items-center rounded-md border bg-card">
            <Button variant="ghost" size="icon" onClick={gotoPrev} aria-label="이전 달">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm font-medium tabular-nums">
              {cursor.year}년 {cursor.month0 + 1}월
            </span>
            <Button variant="ghost" size="icon" onClick={gotoNext} aria-label="다음 달">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button
            onClick={() => setDialogState({ mode: "create", defaultDate: today })}
          >
            <Plus className="mr-2 h-4 w-4" />
            이벤트 추가
          </Button>
        </div>
      </header>

      <div className="mt-6 overflow-hidden rounded-lg border bg-card">
        {/* 요일 헤더 */}
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

        {/* 셀 */}
        <div className="grid grid-cols-7">
          {grid.map((dayMs, idx) => {
            const dayKey = utcMsToKstDateString(dayMs);
            const inMonth = dayMs >= monthStartMs && dayMs < monthEndMs;
            const isToday = dayKey === today;
            const dayEvents = eventsByDay.get(dayKey) ?? [];
            const dayNum = Number(dayKey.slice(8, 10));
            const colIdx = idx % 7;

            return (
              <div
                key={dayKey}
                className={cn(
                  "group relative min-h-[110px] border-b border-r p-1.5 last:border-r-0",
                  idx >= 35 && "border-b-0",
                  (idx + 1) % 7 === 0 && "border-r-0",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center text-xs",
                      colIdx === 0 && inMonth && "text-rose-500",
                      colIdx === 6 && inMonth && "text-blue-500",
                      isToday &&
                        "rounded-full bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {dayNum}
                  </span>
                  <button
                    onClick={() =>
                      setDialogState({ mode: "create", defaultDate: dayKey })
                    }
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                    aria-label="이벤트 추가"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-1 space-y-0.5">
                  {dayEvents.slice(0, 3).map((event) => (
                    <button
                      key={event.id}
                      onClick={() =>
                        setDialogState({ mode: "edit", event })
                      }
                      className="block w-full truncate rounded bg-primary/10 px-1.5 py-0.5 text-left text-[11px] font-medium text-primary hover:bg-primary/20"
                      title={event.title}
                    >
                      {event.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 ? (
                    <div className="px-1.5 text-[10px] text-muted-foreground">
                      +{dayEvents.length - 3}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">불러오는 중...</p>
      ) : null}

      <EventFormDialog
        open={dialogState.mode !== "closed"}
        editing={dialogState.mode === "edit" ? dialogState.event : null}
        defaultDate={
          dialogState.mode === "create" ? dialogState.defaultDate : undefined
        }
        members={members}
        onClose={() => setDialogState({ mode: "closed" })}
        onSaved={() => {
          setDialogState({ mode: "closed" });
          void loadEvents();
        }}
        onDeleted={() => {
          setDialogState({ mode: "closed" });
          void loadEvents();
        }}
      />
    </div>
  );
}
