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
  kstMonthGrid,
} from "@/lib/client/calendar";
import { toast } from "@/lib/client/use-toast";
import type { CalendarEvent, Member, TodoItem, WorkItemListItem } from "@/lib/client/types";
import { utcMsToKstDateString } from "@/lib/client/calendar";
import { cn } from "@/lib/utils";
import { MemberFilter } from "@/components/member-filter";
import { EventFormDialog } from "./event-form-dialog";
import { MonthView, getCategoryBadge } from "./month-view";
import { useCalendarDrag, type DragData } from "./use-calendar-drag";

type ListResponse = { items: CalendarEvent[] };

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
  const [today] = React.useState(todayKst);

  const [cursor, setCursor] = React.useState(() => cursorFromDateStr(today));
  const [selectedDate, setSelectedDate] = React.useState(today);

  const [events, setEvents] = React.useState<CalendarEvent[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [transferItems, setTransferItems] = React.useState<WorkItemListItem[]>([]);
  const [openTodos, setOpenTodos] = React.useState<TodoItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef<AbortController | null>(null);
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
    const grid = kstMonthGrid(cursor.year, cursor.month0);
    return { fromMs: grid[0], toMs: grid[41] + 24 * 60 * 60 * 1000 };
  }, [cursor]);

  // ── 데이터 로드 ─────────────────────────────────────────────────────────────

  const loadEvents = React.useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    setEvents([]);
    setTransferItems([]);
    setOpenTodos([]);
    try {
      const fromDate = utcMsToKstDateString(gridFromMs);
      const toDate = utcMsToKstDateString(gridToMs - 1);
      const [eventsRes, workRes, todoRes] = await Promise.all([
        api.get<ListResponse>("/api/calendar-events", {
          signal: controller.signal,
          query: {
            from: new Date(gridFromMs).toISOString(),
            to: new Date(gridToMs).toISOString(),
          },
        }),
        api.getAll<WorkItemListItem>("/api/work-items", {
          signal: controller.signal,
          query: { transferDate: fromDate, transferDateTo: toDate },
        }),
        api.getAll<TodoItem>("/api/todos", {
          signal: controller.signal,
          query: {
            status: "OPEN",
            dueDateFrom: fromDate,
            dueDateTo: toDate,
          },
        }),
      ]);
      if (controller.signal.aborted) return;
      setEvents(eventsRes.items);
      setTransferItems(workRes);
      setOpenTodos(todoRes);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : "캘린더를 불러오지 못했습니다");
      toast({
        title: "캘린더 조회 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [gridFromMs, gridToMs]);

  const loadMembers = React.useCallback(async () => {
    try {
      setMembers(await api.getAll<Member>("/api/team-members"));
    } catch {
      // 실패해도 캘린더는 동작
    }
  }, []);

  React.useEffect(() => {
    void loadMembers();
  }, [loadMembers]);
  React.useEffect(() => {
    void loadEvents();
    return () => requestRef.current?.abort();
  }, [loadEvents]);

  // ── SSE: 다른 클라이언트의 변경을 실시간으로 반영 ────────────────────────────
  React.useEffect(() => {
    const es = new EventSource("/api/calendar-events/stream");
    es.onmessage = () => void loadEvents();
    es.onerror = () => {
      // EventSource는 에러 시 자동 재연결. 별도 처리 불필요.
    };
    return () => es.close();
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
      for (const key of eventDayKeys(event, { fromMs: gridFromMs, toMs: gridToMs })) {
        const list = map.get(key) ?? [];
        list.push(event);
        map.set(key, list);
      }
    }
    return map;
  }, [filteredEvents, gridFromMs, gridToMs]);

  const transfersByDay = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const item of transferItems) {
      if (!item.transferDate) continue;
      const key = utcMsToKstDateString(new Date(item.transferDate).getTime());
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [transferItems]);

  const openTodosByDay = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const todo of openTodos) {
      if (!todo.dueDate) continue;
      const key = utcMsToKstDateString(new Date(todo.dueDate).getTime());
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [openTodos]);

  // ── 그리드 계산 ─────────────────────────────────────────────────────────────

  const grid = React.useMemo(
    () => kstMonthGrid(cursor.year, cursor.month0),
    [cursor],
  );

  // ── 네비게이션 ──────────────────────────────────────────────────────────────

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
    setSelectedDate(today);
    setCursor(cursorFromDateStr(today));
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

  const headerLabel = `${cursor.year}년 ${cursor.month0 + 1}월`;

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
      <div className="flex min-h-full flex-col">
        {/* ── 헤더 ── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-4 md:px-8 md:py-6">
          {/* 왼쪽: 타이틀 */}
          <h1 className="text-xl font-semibold">캘린더</h1>

          {/* 가운데: 월 선택 + 오늘 + 팀원 필터 */}
          <div className="order-3 flex w-full flex-wrap items-center gap-2 md:order-none md:w-auto md:flex-1 md:justify-center md:gap-3">
            <div className="flex items-center rounded-md border bg-card">
              <Button variant="ghost" size="icon" onClick={gotoPrev} aria-label="이전">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[7rem] px-2 text-center text-sm font-medium tabular-nums">
                {headerLabel}
              </span>
              <Button variant="ghost" size="icon" onClick={gotoNext} aria-label="다음">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="outline" onClick={gotoToday}>
              오늘
            </Button>

            <MemberFilter
              members={members}
              selectedIds={selectedMemberIds}
              onToggle={toggleMember}
              onClear={clearMembers}
            />
          </div>

          {/* 오른쪽: 로딩 + 이벤트 추가 */}
          <div className="ml-auto flex items-center gap-3">
            {loading && (
              <span role="status" className="text-xs text-muted-foreground">불러오는 중…</span>
            )}
            <Button
              onClick={() =>
                setDialogState({ mode: "create", defaultDate: selectedDate })
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              이벤트 추가
            </Button>
          </div>
        </header>

        {/* 캘린더 영역 */}
        {error && <div role="alert" className="mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive p-4 md:mx-8">
          <p className="text-sm">캘린더 조회 실패: {error}</p>
          <Button variant="outline" onClick={() => void loadEvents()}>다시 시도</Button>
        </div>}
        <div aria-busy={loading} className="min-h-0 flex-1 overflow-x-auto px-4 pb-4 md:px-8 md:pb-6">
          <div className="min-w-[700px]">
          <MonthView
            grid={grid}
            cursor={cursor}
            today={today}
            eventsByDay={eventsByDay}
            transfersByDay={transfersByDay}
            openTodosByDay={openTodosByDay}
            onAddClick={(dayKey) =>
              setDialogState({ mode: "create", defaultDate: dayKey })
            }
            onEventClick={(event) =>
              setDialogState({ mode: "edit", event })
            }
          />
          </div>
        </div>
      </div>

      {/* ── 드래그 오버레이 ── */}
      <DragOverlay dropAnimation={null}>
        {activeEvent ? (
          <div className="pointer-events-none min-w-[8rem] rounded-sm border bg-card px-2 py-1 text-xs font-medium opacity-90 shadow-lg">
            <span
              className={cn(
                "mr-1 rounded-sm px-1 text-[9px] font-semibold",
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
