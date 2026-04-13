"use client";

import * as React from "react";
import {
  GanttChartSquare,
  LayoutGrid,
  ListChecks,
  Plus,
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, api } from "@/lib/client/api";
import { toast } from "@/lib/client/use-toast";
import type {
  ListResponse,
  Member,
  WorkItemDetail,
  WorkItemListItem,
} from "@/lib/client/types";
import {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  type Category,
  type Priority,
  type Status,
} from "@/lib/enums";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "@/lib/enum-labels";
import { cn } from "@/lib/utils";
import { GanttView } from "./gantt-view";
import { KanbanView } from "./kanban-view";
import { TableView } from "./table-view";
import { WorkItemDrawer } from "./work-item-drawer";
import { WorkItemFormDialog } from "./work-item-form-dialog";

/**
 * 작업 페이지 클라이언트 — Phase 4 Step 4.
 *
 * 책임:
 *  - 멤버 + 작업 목록 fetch
 *  - 필터 (status / assignee / category / priority / ticket)
 *  - 보기 모드 토글 (table / kanban) — localStorage에 저장
 *  - 생성/수정 다이얼로그 + 상세 드로어 트리거
 *
 * 1차 범위는 첫 페이지(50건)만 보여준다. 페이지네이션 next는 후속 단계에서.
 */

type ViewMode = "table" | "kanban" | "gantt";
const VIEW_KEY = "cc-simply-tasks:work-items-view";

interface Filters {
  status: Status[];
  assigneeId: string[];
  category: Category[];
  priority: Priority[];
  ticket: string;
  transferDate: string;
}

const EMPTY_FILTERS: Filters = {
  status: ["DRAFT", "IN_PROGRESS", "READY_TO_TRANSFER"],
  assigneeId: [],
  category: [],
  priority: [],
  ticket: "",
  transferDate: "",
};

export function WorkItemsClient() {
  const [view, setView] = React.useState<ViewMode>("table");
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = React.useState<WorkItemListItem[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkItemListItem | null>(null);
  const [drawerId, setDrawerId] = React.useState<string | null>(null);

  // 보기 모드 복원
  React.useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "kanban" || saved === "table" || saved === "gantt") {
      setView(saved);
    }
  }, []);

  function changeView(next: ViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  const loadMembers = React.useCallback(async () => {
    try {
      const res = await api.get<ListResponse<Member>>("/api/team-members");
      setMembers(res.items);
    } catch (err) {
      // 멤버 조회 실패는 치명적이지 않음 — 토스트만
      toast({
        title: "멤버 목록 조회 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }, []);

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<WorkItemListItem>>(
        "/api/work-items",
        {
          query: {
            status: filters.status.length > 0 ? filters.status.join(",") : undefined,
            assigneeId: filters.assigneeId.length > 0 ? filters.assigneeId.join(",") : undefined,
            category: filters.category.length > 0 ? filters.category.join(",") : undefined,
            priority: filters.priority.length > 0 ? filters.priority.join(",") : undefined,
            ticket: filters.ticket.trim() || undefined,
            transferDate: filters.transferDate || undefined,
          },
        },
      );
      setItems(res.items);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "목록 조회 실패";
      setError(message);
      toast({
        title: "작업 목록 조회 실패",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  React.useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  React.useEffect(() => {
    void loadItems();
  }, [loadItems]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEditFromList(item: WorkItemListItem) {
    setEditing(item);
    setFormOpen(true);
  }

  function openEditFromDrawer(item: WorkItemDetail) {
    setEditing(item);
    setFormOpen(true);
  }

  function openDrawer(item: WorkItemListItem) {
    setDrawerId(item.id);
  }

  const updateItemStatus = React.useCallback(
    async (id: string, status: Status) => {
      const originalItem = items.find((item) => item.id === id);
      if (!originalItem) return;

      // Optimistic update
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status } : item
        )
      );

      try {
        const updated = await api.patch<WorkItemListItem>(
          `/api/work-items/${id}`,
          { status },
          originalItem.updatedAt,
        );
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, ...updated, assignee: item.assignee } : item
          )
        );
        toast({
          title: "상태 변경됨",
          description: `${originalItem.title}의 상태가 ${STATUS_LABELS[status]}으로 변경되었습니다.`,
        });
      } catch (err) {
        // Rollback
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: originalItem.status } : item
          )
        );
        const message = err instanceof ApiError ? err.message : "상태 변경 실패";
        toast({
          title: "상태 변경 실패",
          description: message,
          variant: "destructive",
        });
      }
    },
    [items],
  );

  return (
    <div className="px-8 py-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            담당자별/이관일별로 작업을 관리합니다. 카드/행을 클릭하면 상세가 열립니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={changeView} />
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            작업 추가
          </Button>
        </div>
      </header>

      <FilterBar
        filters={filters}
        members={members}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
      />

      <section className="mt-4">
        {loading ? (
          <SkeletonBlock />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadItems()} />
        ) : items.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : view === "table" ? (
          <TableView items={items} onOpen={openDrawer} />
        ) : view === "kanban" ? (
          <KanbanView
            items={items}
            visibleStatuses={filters.status.length > 0 ? filters.status : STATUSES}
            onOpen={openDrawer}
            onUpdate={updateItemStatus}
          />
        ) : (
          <GanttView items={items} onOpen={openDrawer} />
        )}
      </section>

      <WorkItemFormDialog
        open={formOpen}
        editing={editing}
        members={members}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void loadItems();
        }}
      />

      <WorkItemDrawer
        workItemId={drawerId}
        onClose={() => setDrawerId(null)}
        onEdit={(item) => {
          // 드로어를 닫지 않고 수정 다이얼로그 오픈 (저장 후 둘 다 갱신)
          openEditFromDrawer(item);
        }}
        onDeleted={() => setDrawerId(null)}
        onMutated={() => void loadItems()}
      />
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  return (
    <div className="flex items-center rounded-md border bg-card p-0.5">
      <ToggleButton
        active={value === "table"}
        onClick={() => onChange("table")}
        label="테이블"
      >
        <TableIcon className="h-4 w-4" />
      </ToggleButton>
      <ToggleButton
        active={value === "kanban"}
        onClick={() => onChange("kanban")}
        label="칸반"
      >
        <LayoutGrid className="h-4 w-4" />
      </ToggleButton>
      <ToggleButton
        active={value === "gantt"}
        onClick={() => onChange("gantt")}
        label="간트"
      >
        <GanttChartSquare className="h-4 w-4" />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {label}
    </button>
  );
}

function FilterBar({
  filters,
  members,
  onChange,
  onReset,
}: {
  filters: Filters;
  members: Member[];
  onChange: (next: Filters) => void;
  onReset: () => void;
}) {
  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value });
  }

  function toggleStatus(status: Status) {
    const newStatus = filters.status.includes(status)
      ? filters.status.filter((s) => s !== status)
      : [...filters.status, status];
    set("status", newStatus);
  }

  function toggleAssignee(id: string) {
    const newAssignee = filters.assigneeId.includes(id)
      ? filters.assigneeId.filter((a) => a !== id)
      : [...filters.assigneeId, id];
    set("assigneeId", newAssignee);
  }

  function toggleCategory(category: Category) {
    const newCategory = filters.category.includes(category)
      ? filters.category.filter((c) => c !== category)
      : [...filters.category, category];
    set("category", newCategory);
  }

  function togglePriority(priority: Priority) {
    const newPriority = filters.priority.includes(priority)
      ? filters.priority.filter((p) => p !== priority)
      : [...filters.priority, priority];
    set("priority", newPriority);
  }

  const hasAny =
    filters.status.length > 0 ||
    filters.assigneeId.length > 0 ||
    filters.category.length > 0 ||
    filters.priority.length > 0 ||
    filters.ticket;

  return (
    <div className="mt-4 grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-5">
      <div className="space-y-1.5">
        <Label className="text-xs">상태</Label>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={cn(
                "inline-flex items-center rounded px-2 py-1 text-xs",
                filters.status.includes(s)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">담당자</Label>
        <div className="flex flex-wrap gap-1">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => toggleAssignee(m.id)}
              className={cn(
                "inline-flex items-center rounded px-2 py-1 text-xs",
                filters.assigneeId.includes(m.id)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">분류</Label>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => toggleCategory(c)}
              className={cn(
                "inline-flex items-center rounded px-2 py-1 text-xs",
                filters.category.includes(c)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">우선순위</Label>
        <div className="flex flex-wrap gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => togglePriority(p)}
              className={cn(
                "inline-flex items-center rounded px-2 py-1 text-xs",
                filters.priority.includes(p)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">티켓 번호</Label>
        <div className="flex gap-2">
          <Input
            value={filters.ticket}
            onChange={(e) => set("ticket", e.target.value)}
            placeholder="ABC-1234"
          />
          {hasAny ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="shrink-0"
            >
              초기화
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">이관일 (부터)</Label>
        <DatePicker
          value={filters.transferDate}
          onChange={(v) => set("transferDate", v)}
          placeholder="날짜 선택"
        />
      </div>
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-16 text-center">
      <p className="text-sm font-medium">목록을 불러오지 못했습니다</p>
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-16 text-center">
      <ListChecks className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">조건에 맞는 작업이 없습니다</p>
        <p className="mt-1 text-xs text-muted-foreground">
          새 작업을 추가하거나 필터를 초기화해보세요.
        </p>
      </div>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        작업 추가
      </Button>
    </div>
  );
}
