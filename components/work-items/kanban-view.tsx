"use client";

import * as React from "react";
import { formatDate } from "@/lib/client/format";
import type { WorkItemListItem } from "@/lib/client/types";
import { STATUSES, type Status } from "@/lib/enums";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/enum-labels";

/**
 * 칸반 보기 — 상태별 컬럼.
 *
 * 1차 범위에서는 드래그 앤 드롭 없음. 카드 클릭 → 드로어. 상태 변경은 드로어/폼에서.
 * 드래그 앤 드롭은 reorder API와 함께 Phase 4 후속에서 검토.
 */
export function KanbanView({
  items,
  onOpen,
}: {
  items: WorkItemListItem[];
  onOpen: (item: WorkItemListItem) => void;
}) {
  const grouped = React.useMemo(() => {
    const map = new Map<Status, WorkItemListItem[]>();
    for (const s of STATUSES) map.set(s, []);
    for (const item of items) {
      map.get(item.status)?.push(item);
    }
    return map;
  }, [items]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {STATUSES.map((status) => {
        const list = grouped.get(status) ?? [];
        return (
          <section
            key={status}
            className="flex min-w-0 flex-col rounded-lg border bg-card"
          >
            <header className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">
                {STATUS_LABELS[status]}
              </span>
              <span className="text-xs text-muted-foreground">{list.length}</span>
            </header>
            <div className="flex flex-col gap-2 p-2">
              {list.length === 0 ? (
                <p className="px-1 py-3 text-xs text-muted-foreground">비어 있음</p>
              ) : (
                list.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onOpen(item)}
                    className="rounded-md border bg-background p-3 text-left text-sm shadow-sm transition-colors hover:bg-accent/40"
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
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
