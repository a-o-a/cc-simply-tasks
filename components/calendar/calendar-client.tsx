"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { ApiError, api, TODOS_CHANGED_EVENT, WORK_ITEMS_CHANGED_EVENT } from "@/lib/client/api";
import { useRequestController } from "@/lib/client/use-request-controller";
import {
  eventDayKeys,
  kstMonthGrid,
} from "@/lib/client/calendar";
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
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [membersError, setMembersError] = React.useState<string | null>(null);
  const [membersReloadKey, setMembersReloadKey] = React.useState(0);
  const [liveInterrupted, setLiveInterrupted] = React.useState(false);
  const { beginRequest, cancelRequest } = useRequestController();
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const request = beginRequest();
    setLoading(true);
    setLoadError(null);
    try {
      const fromDate = utcMsToKstDateString(gridFromMs);
      const toDate = utcMsToKstDateString(gridToMs - 1);
      const [eventsRes, workRes, todoRes] = await Promise.all([
        api.get<ListResponse>("/api/calendar-events", {
          signal: request.signal,
          query: {
            from: new Date(gridFromMs).toISOString(),
            to: new Date(gridToMs).toISOString(),
          },
        }),
        api.getAllPages<WorkItemListItem>("/api/work-items", {
          signal: request.signal,
          query: { transferDate: fromDate, transferDateTo: toDate, pageSize: 100 },
        }),
        api.getAllPages<TodoItem>("/api/todos", {
          signal: request.signal,
          query: {
            status: "OPEN",
            dueDateFrom: fromDate,
            dueDateTo: toDate,
            pageSize: 100,
          },
        }),
      ]);
      if (!request.isCurrent()) return;
      setEvents(eventsRes.items);
      setTransferItems(workRes);
      setOpenTodos(todoRes);
    } catch (err) {
      if (!request.isCurrent()) return;
      setLoadError(err instanceof ApiError ? err.message : "캘린더를 불러오지 못했습니다.");
      cancelRequest();
      setLoading(false);
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [gridFromMs, gridToMs, beginRequest, cancelRequest]);

  React.useEffect(() => {
    const controller = new AbortController();
    setMembersError(null);
    api.getAllPages<Member>("/api/team-members", { signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted) setMembers(items);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setMembersError(err instanceof ApiError ? err.message : "팀원 목록을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, [membersReloadKey]);

  React.useEffect(() => {
    void loadEvents();
    return () => {
      cancelRequest();
      if (refreshTimer.current !== null) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [loadEvents, cancelRequest]);

  const latestLoad = React.useRef(loadEvents);
  React.useEffect(() => {
    latestLoad.current = loadEvents;
  }, [loadEvents]);

  const refreshEvents = React.useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void latestLoad.current();
    }, 100);
  }, []);

  // 같은 탭의 작업 변경과 SSE를 함께 반영하고 연속 알림은 한 번만 조회한다.
  React.useEffect(() => {
    const es = new EventSource("/api/calendar-events/stream");
    let connected = false;
    es.onmessage = refreshEvents;
    es.onopen = () => {
      setLiveInterrupted(false);
      if (connected) refreshEvents();
      connected = true;
    };
    es.onerror = () => {
      setLiveInterrupted(true);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshEvents();
    };
    window.addEventListener(WORK_ITEMS_CHANGED_EVENT, refreshEvents);
    window.addEventListener(TODOS_CHANGED_EVENT, refreshEvents);
    window.addEventListener("focus", refreshEvents);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      es.close();
      window.removeEventListener(WORK_ITEMS_CHANGED_EVENT, refreshEvents);
      window.removeEventListener(TODOS_CHANGED_EVENT, refreshEvents);
      window.removeEventListener("focus", refreshEvents);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshEvents]);

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
  const { handleDragEnd } = useCalendarDrag(setEvents, refreshEvents);

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
      <div className="flex h-full flex-col overflow-hidden">
        {/* ── 헤더 ── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-4 md:px-8 md:py-6">
          {/* 왼쪽: 타이틀 */}
          <h1 className="text-xl font-semibold">캘린더</h1>

          {/* 가운데: 월 선택 + 오늘 + 팀원 필터 */}
          <div className="order-last flex w-full flex-wrap items-center justify-center gap-2 md:order-none md:w-auto md:flex-1 md:gap-3">
            <div className="flex items-center rounded-md border bg-card">
              <Button variant="ghost" size="icon" onClick={gotoPrev} aria-label="이전 달">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-28 px-2 text-center text-sm font-medium tabular-nums md:min-w-40 md:px-3">
                {headerLabel}
              </span>
              <Button variant="ghost" size="icon" onClick={gotoNext} aria-label="다음 달">
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
          <div className="ml-auto flex items-center gap-3 md:ml-0">
            {loading && (
              <span className="text-xs text-muted-foreground" role="status">불러오는 중…</span>
            )}
            <Button variant="ghost" size="icon" onClick={refreshEvents} disabled={loading} aria-label="캘린더 새로고침">
              <RefreshCw className="h-4 w-4" />
            </Button>
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

        {loadError && (
          <div className="mx-8 flex items-center justify-between gap-3 rounded-md border border-destructive/40 px-3 py-2 text-sm" role="alert">
            <span>{loadError} 현재 표시된 내용은 최신 상태가 아닐 수 있습니다.</span>
            <Button variant="outline" size="sm" onClick={refreshEvents}>다시 시도</Button>
          </div>
        )}
        {membersError && (
          <div className="mx-8 flex items-center justify-between gap-3 text-xs text-muted-foreground" role="alert">
            <span>{membersError} 팀원 필터를 사용할 수 없습니다.</span>
            <Button variant="ghost" size="sm" onClick={() => setMembersReloadKey((key) => key + 1)}>다시 시도</Button>
          </div>
        )}
        {liveInterrupted && (
          <p className="mx-8 text-xs text-muted-foreground" role="status">실시간 연결을 다시 연결하는 중입니다. 새로고침으로 최신 내용을 확인할 수 있습니다.</p>
        )}

        {/* 캘린더 영역 */}
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 md:px-8 md:py-6" aria-busy={loading}>
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
          refreshEvents();
        }}
        onDeleted={() => {
          setDialogState({ mode: "closed" });
          refreshEvents();
        }}
      />
    </DndContext>
  );
}
