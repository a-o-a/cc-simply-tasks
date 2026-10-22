"use client";

import * as React from "react";
import { formatDate } from "@/lib/client/format";
import type { WorkCategory, WorkItemListItem } from "@/lib/client/types";
import { PRIORITY_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

/**
 * 작업 테이블 보기.
 * 행 클릭 또는 제목 버튼의 키보드 조작으로 드로어를 엽니다.
 */
export function TableView({
  items,
  categories,
  onOpen,
}: {
  items: WorkItemListItem[];
  categories: WorkCategory[];
  onOpen: (item: WorkItemListItem) => void;
}) {
  const categoryNameByCode = React.useMemo(
    () => Object.fromEntries(categories.map((c) => [c.code, c.name])),
    [categories],
  );

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">분류</th>
            <th className="px-4 py-3 font-medium">상태</th>
            <th className="px-4 py-3 font-medium">제목</th>
            <th className="px-4 py-3 font-medium">담당자</th>
            <th className="px-4 py-3 font-medium">우선순위</th>
            <th className="px-4 py-3 font-medium">시작</th>
            <th className="px-4 py-3 font-medium">종료</th>
            <th className="px-4 py-3 font-medium">이관일</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => onOpen(item)}
              className={cn(
                "cursor-pointer border-b transition-colors last:border-0",
                "hover:bg-accent/40",
              )}
            >
              <td className="px-4 py-3 text-muted-foreground">
                {(item.category && categoryNameByCode[item.category]) || item.category || "—"}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-3 font-medium">
                <button type="button" className="max-w-md break-words rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={(event) => { event.stopPropagation(); onOpen(item); }}>
                  {item.title}
                </button>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {item.assignee?.name ?? "미배정"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {PRIORITY_LABELS[item.priority]}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(item.startDate) || "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(item.endDate) || "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(item.transferDate) || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
