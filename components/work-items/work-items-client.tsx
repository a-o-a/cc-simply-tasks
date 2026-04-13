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
import { Label } from "@/components/ui/label";
import { MemberFilter } from "@/components/member-filter";
import { ApiError, api } from "@/lib/client/api";
import { toast } from "@/lib/client/use-toast";
import type {
  ListResponse,
  Member,
  WorkCategory,
  WorkItemDetail,
  WorkItemListItem,
} from "@/lib/client/types";
import {
  PRIORITIES,
  STATUSES,
  type Priority,
  type Status,
} from "@/lib/enums";
import {
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
  category: string[];
  priority: Priority[];
  transferDate: string;
}

const EMPTY_FILTERS: Filters = {
  status: ["WAITING", "IN_PROGRESS", "INTERNAL_TEST", "BUSINESS_TEST", "QA_TEST", "TRANSFER_READY"],
  assigneeId: [],
  category: [],
  priority: [],
  transferDate: "",
};

export function WorkItemsClient() {
  const [view, setView] = React.useState<ViewMode>("table");
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = React.useState<WorkItemListItem[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [categories, setCategories] = React.useState<WorkCategory[]>([]);
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
      toast({
        title: "멤버 목록 조회 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }, []);

  const loadCategories = React.useCallback(async () => {
    try {
      const res = await api.get<{ items: WorkCategory[] }>("/api/work-categories");
      setCategories(res.items);
    } catch {
      // 분류 조회 실패는 치명적이지 않음 — 조용히 무시
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
    void loadCategories();
  }, [loadMembers, loadCategories]);

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
      <header className="flex items-center">
        <h1 className="text-xl font-semibold">작업</h1>
        <div className="flex flex-1 justify-center">
          <ViewToggle value={view} onChange={changeView} />
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          작업 추가
        </Button>
      </header>

      <FilterBar
        filters={filters}
        members={members}
        categories={categories}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
      />

      <section className={cn("mt-4", loading && "pointer-events-none opacity-60")}>
        {error ? (
          <ErrorState message={error} onRetry={() => void loadItems()} />
        ) : items.length === 0 && !loading ? (
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
        categories={categories}
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
  categories,
  onChange,
  onReset,
}: {
  filters: Filters;
  members: Member[];
  categories: WorkCategory[];
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

function toggleCategory(code: string) {
    const newCategory = filters.category.includes(code)
      ? filters.category.filter((c) => c !== code)
      : [...filters.category, code];
    set("category", newCategory);
  }

  function togglePriority(priority: Priority) {
    const newPriority = filters.priority.includes(priority)
      ? filters.priority.filter((p) => p !== priority)
      : [...filters.priority, priority];
    set("priority", newPriority);
  }

  return (
    <div className="mt-4 rounded-lg border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-5">
        {/* 분류 */}
        <div className="space-y-1.5">
          <Label className="text-xs">분류</Label>
          <div className="flex flex-wrap gap-1">
            {categories.length === 0 ? (
              <span className="text-xs text-muted-foreground">설정에서 분류를 추가하세요</span>
            ) : (
              categories.map((c) => (
                <button
                  key={c.code}
                  onClick={() => toggleCategory(c.code)}
                  className={cn(
                    "inline-flex items-center rounded px-2 py-1 text-xs",
                    filters.category.includes(c.code)
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 상태 */}
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

        {/* 담당자 */}
        <div className="space-y-1.5">
          <Label className="text-xs">담당자</Label>
          <div className="flex flex-wrap gap-1">
            <MemberFilter
              members={members}
              selectedIds={new Set(filters.assigneeId)}
              onToggle={(id) => {
                const next = filters.assigneeId.includes(id)
                  ? filters.assigneeId.filter((a) => a !== id)
                  : [...filters.assigneeId, id];
                set("assigneeId", next);
              }}
              onClear={() => set("assigneeId", [])}
            />
          </div>
        </div>

        {/* 우선순위 */}
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

        {/* 이관일 */}
        <div className="space-y-1.5">
          <Label className="text-xs">이관일</Label>
          <DatePicker
            value={filters.transferDate}
            onChange={(v) => set("transferDate", v)}
            placeholder="날짜 선택"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          초기화
        </Button>
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
