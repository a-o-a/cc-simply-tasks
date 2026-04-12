"use client";

import * as React from "react";
import {
  DndContext,
  DragEndEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { formatDate } from "@/lib/client/format";
import type { WorkItemListItem } from "@/lib/client/types";
import { STATUSES, type Status } from "@/lib/enums";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";

/**
 * 칸반 보기 — 상태별 컬럼.
 *
 * 드래그 앤 드롭으로 상태 변경 가능.
 */
function KanbanCard({
  item,
  onOpen,
}: {
  item: WorkItemListItem;
  onOpen: (item: WorkItemListItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: item.id,
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
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
        isDragging && "opacity-50",
      )}
    >
      <div className="line-clamp-2 font-medium">{item.title}</div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{item.assignee?.name ?? "미배정"}</span>
        <span>{PRIORITY_LABELS[item.priority]}</span>
      </div>
      {item.transferDate ? (
        <div className="mt-1 text-[11px] text-muted-foreground">
          이관 {formatDate(item.transferDate)}
        </div>
      ) : null}
    </button>
  );
}

function KanbanColumn({
  status,
  items,
  onOpen,
}: {
  status: Status;
  items: WorkItemListItem[];
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
            <KanbanCard key={item.id} item={item} onOpen={onOpen} />
          ))
        )}
      </div>
    </section>
  );
}

export function KanbanView({
  items,
  onOpen,
  onUpdate,
}: {
  items: WorkItemListItem[];
  onOpen: (item: WorkItemListItem) => void;
  onUpdate: (id: string, status: Status) => void;
}) {
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
    <DndContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {STATUSES.map((status) => {
          const list = grouped.get(status) ?? [];
          return (
            <KanbanColumn
              key={status}
              status={status}
              items={list}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    </DndContext>
  );
}
