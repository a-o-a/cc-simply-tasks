"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/client/api";
import {
  eventDayKeys,
  kstAddDays,
  kstMonthGrid,
  kstWeekContaining,
  kstWeekFetchRange,
} from "@/lib/client/calendar";
import { toast } from "@/lib/client/use-toast";
import type { CalendarEvent, Member, WorkItemListItem } from "@/lib/client/types";
import { utcMsToKstDateString } from "@/lib/client/calendar";
import { cn } from "@/lib/utils";
import { MemberFilter } from "@/components/member-filter";
import { EventFormDialog } from "./event-form-dialog";
import { MonthView, getCategoryBadge } from "./month-view";
import { WeekView } from "./week-view";
import { useCalendarDrag, type DragData } from "./use-calendar-drag";

type ListResponse = { items: CalendarEvent[] };
type ViewMode = "month" | "week";

// ── 오늘 KST 날짜 ──────────────────────────────────────────────────────────────

function todayKst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function cursorFromDateStr(dateStr: string): { year: number; month0: number } {
  const [y, m] = dateStr.split("-").map(Number);
  return { year: y, month0: m - 1 };
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export function CalendarClient() {
  const today = React.useMemo(todayKst, []);

  const [cursor, setCursor] = React.useState(() => cursorFromDateStr(today));
  const [selectedDate, setSelectedDate] = React.useState(today);
  const [viewMode, setViewMode] = React.useState<ViewMode>("month");

  const [events, setEvents] = React.useState<CalendarEvent[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [transferItems, setTransferItems] = React.useState<WorkItemListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedMemberIds, setSelectedMemberIds] = React.useState(
    new Set<string>(),
  );
  const [activeDragData, setActiveDragData] = React.useState<DragData | null>(
    null,
  );

  const [dialogState, setDialogState] = React.useState<
    | { mode: "closed" }
    | { mode: "create"; defaultDate: string }
    | { mode: "edit"; event: CalendarEvent }
  >({ mode: "closed" });

  // ── 패치 범위 ───────────────────────────────────────────────────────────────

  const { fromMs: gridFromMs, toMs: gridToMs } = React.useMemo(() => {
    if (viewMode === "week") return kstWeekFetchRange(selectedDate);
    const grid = kstMonthGrid(cursor.year, cursor.month0);
    return { fromMs: grid[0], toMs: grid[41] + 24 * 60 * 60 * 1000 };
  }, [viewMode, selectedDate, cursor]);

  // ── 데이터 로드 ─────────────────────────────────────────────────────────────

  const loadEvents = React.useCallback(async () => {
    setLoading(true);
    try {
      const fromDate = utcMsToKstDateString(gridFromMs);
      const toDate = utcMsToKstDateString(gridToMs - 1);
      const [eventsRes, workRes] = await Promise.all([
        api.get<ListResponse>("/api/calendar-events", {
          query: {
            from: new Date(gridFromMs).toISOString(),
            to: new Date(gridToMs).toISOString(),
          },
        }),
        api.get<{ items: WorkItemListItem[]; nextCursor: string | null }>("/api/work-items", {
          query: { transferDate: fromDate, transferDateTo: toDate },
        }),
      ]);
      setEvents(eventsRes.items);
      setTransferItems(workRes.items);
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

  // ── 필터링 & dayMap ─────────────────────────────────────────────────────────

  const filteredEvents = React.useMemo(() => {
    if (selectedMemberIds.size === 0) return events;
    return events.filter((e) =>
      e.category === "HOLIDAY" ||
      e.members.some((m) => selectedMemberIds.has(m.member.id)),
    );
  }, [events, selectedMemberIds]);

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of filteredEvents) {
      for (const key of eventDayKeys(event)) {
        const list = map.get(key) ?? [];
        list.push(event);
        map.set(key, list);
      }
    }
    return map;
  }, [filteredEvents]);

  const transfersByDay = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const item of transferItems) {
      if (!item.transferDate) continue;
      const key = utcMsToKstDateString(new Date(item.transferDate).getTime());
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [transferItems]);

  // ── 그리드 / 주 계산 ────────────────────────────────────────────────────────

  const grid = React.useMemo(
    () => kstMonthGrid(cursor.year, cursor.month0),
    [cursor],
  );

  const weekDates = React.useMemo(
    () => kstWeekContaining(selectedDate),
    [selectedDate],
  );

  // ── 네비게이션 ──────────────────────────────────────────────────────────────

  function gotoPrev() {
    if (viewMode === "month") {
      setCursor((c) =>
        c.month0 === 0
          ? { year: c.year - 1, month0: 11 }
          : { year: c.year, month0: c.month0 - 1 },
      );
    } else {
      const d = kstAddDays(selectedDate, -7);
      setSelectedDate(d);
      setCursor(cursorFromDateStr(d));
    }
  }
  function gotoNext() {
    if (viewMode === "month") {
      setCursor((c) =>
        c.month0 === 11
          ? { year: c.year + 1, month0: 0 }
          : { year: c.year, month0: c.month0 + 1 },
      );
    } else {
      const d = kstAddDays(selectedDate, 7);
      setSelectedDate(d);
      setCursor(cursorFromDateStr(d));
    }
  }
  function gotoToday() {
    setSelectedDate(today);
    setCursor(cursorFromDateStr(today));
  }
  function handleDateSelect(dayKey: string) {
    setSelectedDate(dayKey);
    setCursor(cursorFromDateStr(dayKey));
  }
  function switchView(mode: ViewMode) {
    setViewMode(mode);
  }

  // ── 팀원 필터 ───────────────────────────────────────────────────────────────

  function toggleMember(memberId: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }
  function clearMembers() {
    setSelectedMemberIds(new Set());
  }

  // ── 드래그 앤 드롭 ──────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const { handleDragEnd } = useCalendarDrag(setEvents, loadEvents);

  const activeEvent = React.useMemo(
    () =>
      activeDragData
        ? (events.find((e) => e.id === activeDragData.eventId) ?? null)
        : null,
    [activeDragData, events],
  );

  // ── 헤더 라벨 ──────────────────────────────────────────────────────────────

  const headerLabel = React.useMemo(() => {
    if (viewMode === "month") {
      return `${cursor.year}년 ${cursor.month0 + 1}월`;
    }
    const startDay = Number(weekDates[0].slice(8, 10));
    const endDay = Number(weekDates[6].slice(8, 10));
    const startMonth = Number(weekDates[0].slice(5, 7));
    const endMonth = Number(weekDates[6].slice(5, 7));
    const year = Number(weekDates[3].slice(0, 4));
    if (startMonth === endMonth) {
      return `${year}년 ${startMonth}월 ${startDay}일 – ${endDay}일`;
    }
    return `${year}년 ${startMonth}월 ${startDay}일 – ${endMonth}월 ${endDay}일`;
  }, [viewMode, cursor, weekDates]);

  // ── 렌더 ────────────────────────────────────────────────────────────────────

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) =>
        setActiveDragData((e.active.data.current as DragData) ?? null)
      }
      onDragEnd={(e) => {
        setActiveDragData(null);
        void handleDragEnd(e);
      }}
      onDragCancel={() => setActiveDragData(null)}
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* ── 헤더 ── */}
        <header className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
          {/* 년월 네비게이션 */}
          <div className="flex items-center rounded-md border bg-card">
            <Button variant="ghost" size="icon" onClick={gotoPrev} aria-label="이전">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[13rem] px-3 text-center text-sm font-medium tabular-nums">
              {headerLabel}
            </span>
            <Button variant="ghost" size="icon" onClick={gotoNext} aria-label="다음">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* 팀원 필터 */}
          <MemberFilter
            members={members}
            selectedIds={selectedMemberIds}
            onToggle={toggleMember}
            onClear={clearMembers}
          />

          <div className="flex-1" />

          {/* 뷰 토글 */}
          <div className="flex overflow-hidden rounded-md border text-sm">
            <button
              onClick={() => switchView("month")}
              className={cn(
                "px-3 py-1.5 transition-colors",
                viewMode === "month"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              월
            </button>
            <button
              onClick={() => switchView("week")}
              className={cn(
                "border-l px-3 py-1.5 transition-colors",
                viewMode === "week"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              주
            </button>
          </div>

          <Button variant="outline" onClick={gotoToday}>
            오늘
          </Button>

          {loading && (
            <span className="text-xs text-muted-foreground">불러오는 중…</span>
          )}

          <Button
            onClick={() =>
              setDialogState({ mode: "create", defaultDate: selectedDate })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            이벤트 추가
          </Button>
        </header>

          {/* 캘린더 영역 */}
          <div className="flex-1 overflow-hidden p-4">
            {viewMode === "month" ? (
              <MonthView
                grid={grid}
                cursor={cursor}
                today={today}
                eventsByDay={eventsByDay}
                transfersByDay={transfersByDay}
                onAddClick={(dayKey) =>
                  setDialogState({ mode: "create", defaultDate: dayKey })
                }
                onEventClick={(event) =>
                  setDialogState({ mode: "edit", event })
                }
              />
            ) : (
              <WeekView
                weekDates={weekDates}
                today={today}
                eventsByDay={eventsByDay}
                transfersByDay={transfersByDay}
                onAddClick={(dayKey) =>
                  setDialogState({ mode: "create", defaultDate: dayKey })
                }
                onEventClick={(event) =>
                  setDialogState({ mode: "edit", event })
                }
              />
            )}
          </div>
      </div>

      {/* ── 드래그 오버레이 ── */}
      <DragOverlay dropAnimation={null}>
        {activeEvent ? (
          <div className="pointer-events-none min-w-[8rem] rounded border bg-card px-2 py-1 text-xs font-medium opacity-90 shadow-lg">
            <span
              className={cn(
                "mr-1 rounded px-1 text-[9px] font-semibold",
                getCategoryBadge(activeEvent.category).className,
              )}
            >
              {getCategoryBadge(activeEvent.category).label}
            </span>
            {activeEvent.title}
          </div>
        ) : null}
      </DragOverlay>

      {/* ── 이벤트 폼 다이얼로그 ── */}
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
    </DndContext>
  );
}
