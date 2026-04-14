"use client";

import * as React from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { formatDate } from "@/lib/client/format";
import type { WorkItemListItem, WorkSystem } from "@/lib/client/types";
import { STATUSES, type Status } from "@/lib/enums";
import { STATUS_LABELS } from "@/lib/enum-labels";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/enums";

const PRIORITY_BORDER: Record<Priority, string> = {
  LOW: "border-l-4 border-l-slate-200",
  NORMAL: "border-l-4 border-l-blue-200",
  HIGH: "border-l-4 border-l-red-300",
};

/**
 * 칸반 보기 — 상태별 컬럼.
 *
 * 드래그 앤 드롭으로 상태 변경 가능.
 */
function KanbanCard({
  item,
  systemNameByCode,
  onOpen,
}: {
  item: WorkItemListItem;
  systemNameByCode: Record<string, string>;
  onOpen: (item: WorkItemListItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: item.id });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(item)}
      className={cn(
        "rounded-md border bg-background p-3 text-left text-sm shadow-sm transition-colors hover:bg-accent/40",
        PRIORITY_BORDER[item.priority],
        isDragging && "opacity-50",
      )}
    >
      {/* 제목 */}
      <div className="line-clamp-2 font-medium leading-snug">{item.title}</div>

      {/* 요청번호 */}
      {item.requestNumber && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          # {item.requestNumber}
        </div>
      )}

      {/* 시스템 연동 */}
      {item.tickets.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.tickets.map((t) => (
            <span
              key={t.systemName}
              className="inline-flex items-center rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
            >
              {systemNameByCode[t.systemName] ?? t.systemName}
            </span>
          ))}
        </div>
      )}

      {/* 담당자 + 이관일 */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{item.assignee?.name ?? "미배정"}</span>
        {item.transferDate && (
          <span className={cn((() => {
            const today = new Date().toDateString();
            const transfer = new Date(item.transferDate!).toDateString();
            if (transfer === today) return "text-blue-600 font-semibold";
            if (new Date(item.transferDate!) < new Date()) return "text-red-600 font-semibold";
            return "";
          })())}>
            이관 {formatDate(item.transferDate)}
          </span>
        )}
      </div>
    </button>
  );
}

function KanbanColumn({
  status,
  items,
  systemNameByCode,
  onOpen,
}: {
  status: Status;
  items: WorkItemListItem[];
  systemNameByCode: Record<string, string>;
  onOpen: (item: WorkItemListItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card",
        isOver && "bg-accent/20",
      )}
    >
      <header className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">{STATUS_LABELS[status]}</span>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </header>
      <div className="flex flex-col gap-2 p-2">
        {items.length === 0 ? (
          <p className="px-1 py-3 text-xs text-muted-foreground">비어 있음</p>
        ) : (
          items.map((item) => (
            <KanbanCard key={item.id} item={item} systemNameByCode={systemNameByCode} onOpen={onOpen} />
          ))
        )}
      </div>
    </section>
  );
}

export function KanbanView({
  items,
  visibleStatuses,
  systems,
  onOpen,
  onUpdate,
}: {
  items: WorkItemListItem[];
  visibleStatuses: readonly Status[];
  systems: WorkSystem[];
  onOpen: (item: WorkItemListItem) => void;
  onUpdate: (id: string, status: Status) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = React.useState(false);
  const [canRight, setCanRight] = React.useState(false);
  const isDragging = React.useRef(false);
  const dragStartX = React.useRef(0);
  const dragStartLeft = React.useRef(0);

  // 스크롤 위치에 따라 화살표 표시 여부 갱신
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
  }, [updateArrows]);

  // 배경 클릭-드래그 스크롤
  function handleMouseDown(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return; // 카드/컬럼 버튼은 제외
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartLeft.current = scrollRef.current?.scrollLeft ?? 0;
  }

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !scrollRef.current) return;
      scrollRef.current.scrollLeft = dragStartLeft.current - (e.clientX - dragStartX.current);
    };
    const onMouseUp = () => { isDragging.current = false; };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function scrollBy(px: number) {
    scrollRef.current?.scrollBy({ left: px, behavior: "smooth" });
  }

  const systemNameByCode = React.useMemo(
    () => Object.fromEntries(systems.map((s) => [s.code, s.name])),
    [systems],
  );

  const grouped = React.useMemo(() => {
    const map = new Map<Status, WorkItemListItem[]>();
    for (const s of STATUSES) map.set(s, []);
    for (const item of items) {
      map.get(item.status)?.push(item);
    }
    return map;
  }, [items]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const itemId = active.id as string;
    const newStatus = over.id as Status;
    const item = items.find((i) => i.id === itemId);
    if (!item || item.status === newStatus) return;
    onUpdate(itemId, newStatus);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="relative">
        {/* 좌측 화살표 */}
        {canLeft && (
          <button
            onClick={() => scrollBy(-320)}
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center pl-1 pr-4 bg-gradient-to-r from-background via-background/70 to-transparent"
          >
            <ChevronLeft className="h-5 w-5 text-muted-foreground" />
          </button>
        )}

        {/* 우측 화살표 */}
        {canRight && (
          <button
            onClick={() => scrollBy(320)}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center pr-1 pl-4 bg-gradient-to-l from-background via-background/70 to-transparent"
          >
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        )}

        {/* 스크롤 컨테이너 (스크롤바 숨김) */}
        <div
          ref={scrollRef}
          onMouseDown={handleMouseDown}
          className="overflow-x-auto px-1 pb-3 cursor-grab active:cursor-grabbing"
          style={{ scrollbarWidth: "none" }}
        >
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${Math.max(visibleStatuses.length, 1)}, 330px)`,
            }}
          >
            {visibleStatuses.map((status) => {
              const list = grouped.get(status) ?? [];
              return (
                <KanbanColumn
                  key={status}
                  status={status}
                  items={list}
                  systemNameByCode={systemNameByCode}
                  onOpen={onOpen}
                />
              );
            })}
          </div>
        </div>
      </div>
    </DndContext>
  );
}
