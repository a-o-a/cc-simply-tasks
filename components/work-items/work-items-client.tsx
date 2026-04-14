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
  WorkSystem,
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
type WorkScope = "active" | "transferred";
const VIEW_KEY = "cc-simply-tasks:work-items-view";
const SCOPE_KEY = "cc-simply-tasks:work-items-scope";
const ACTIVE_STATUSES: Status[] = [
  "WAITING",
  "IN_PROGRESS",
  "INTERNAL_TEST",
  "BUSINESS_TEST",
  "QA_TEST",
  "TRANSFER_READY",
];

interface Filters {
  status: Status[];
  assigneeId: string[];
  category: string[];
  priority: Priority[];
  transferDate: string;
}

function defaultFilters(scope: WorkScope): Filters {
  return {
    status: scope === "active" ? [] : ["TRANSFERRED"],
    assigneeId: [],
    category: [],
    priority: [],
    transferDate: "",
  };
}

export function WorkItemsClient() {
  const [view, setView] = React.useState<ViewMode>("table");
  const [scope, setScope] = React.useState<WorkScope>("active");
  const [filters, setFilters] = React.useState<Filters>(() => defaultFilters("active"));
  const [items, setItems] = React.useState<WorkItemListItem[]>([]);
  const [transferredPageIndex, setTransferredPageIndex] = React.useState(0);
  const [transferredPageCursors, setTransferredPageCursors] = React.useState<(string | null)[]>([null]);
  const [transferredNextCursor, setTransferredNextCursor] = React.useState<string | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [categories, setCategories] = React.useState<WorkCategory[]>([]);
  const [systems, setSystems] = React.useState<WorkSystem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkItemListItem | null>(null);
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerReloadKey, setDrawerReloadKey] = React.useState(0);

  // 보기 모드 복원
  React.useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "kanban" || saved === "table" || saved === "gantt") {
      setView(saved);
    }
    const savedScope = window.localStorage.getItem(SCOPE_KEY);
    if (savedScope === "active" || savedScope === "transferred") {
      setScope(savedScope);
      setFilters(defaultFilters(savedScope));
    }
  }, []);

  function changeView(next: ViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  function changeScope(next: WorkScope) {
    setScope(next);
    if (next === "transferred") {
      setView("table");
    }
    setFilters(defaultFilters(next));
    setTransferredPageIndex(0);
    setTransferredPageCursors([null]);
    setTransferredNextCursor(null);
    window.localStorage.setItem(SCOPE_KEY, next);
  }

  function handleFilterChange(next: Filters) {
    setFilters(next);
    if (scope === "transferred") {
      setTransferredPageIndex(0);
      setTransferredPageCursors([null]);
      setTransferredNextCursor(null);
    }
  }

  function handleReset() {
    setFilters(defaultFilters(scope));
    if (scope === "transferred") {
      setTransferredPageIndex(0);
      setTransferredPageCursors([null]);
      setTransferredNextCursor(null);
    }
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

  const loadSystems = React.useCallback(async () => {
    try {
      const res = await api.get<{ items: WorkSystem[] }>("/api/work-systems");
      setSystems(res.items);
    } catch {
      // 시스템 조회 실패는 치명적이지 않음 — 조용히 무시
    }
  }, []);

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cursor =
        scope === "transferred"
          ? transferredPageCursors[transferredPageIndex] ?? undefined
          : undefined;
      const res = await api.get<ListResponse<WorkItemListItem>>(
        "/api/work-items",
        {
          query: {
            scope,
            cursor,
            pageSize: 50,
            status:
              scope === "active" && filters.status.length > 0
                ? filters.status.join(",")
                : undefined,
            assigneeId: filters.assigneeId.length > 0 ? filters.assigneeId.join(",") : undefined,
            category: filters.category.length > 0 ? filters.category.join(",") : undefined,
            priority: filters.priority.length > 0 ? filters.priority.join(",") : undefined,
            transferDate: filters.transferDate || undefined,
          },
        },
      );
      setItems(res.items);
      if (scope === "transferred") {
        setTransferredNextCursor(res.nextCursor);
      }
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
  }, [filters, scope, transferredPageCursors, transferredPageIndex]);

  React.useEffect(() => {
    void loadMembers();
    void loadCategories();
    void loadSystems();
  }, [loadMembers, loadCategories, loadSystems]);

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

  const tableItems = React.useMemo(() => {
    if (scope === "transferred") return items;
    return items.slice().sort((a, b) => {
      const createdDiff =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (createdDiff !== 0) return createdDiff;
      return b.id.localeCompare(a.id);
    });
  }, [items, scope]);

  return (
    <div className="px-8 py-6">
      <header className="flex items-center">
        <h1 className="text-xl font-semibold">작업</h1>
        <div className="flex flex-1 items-center justify-center gap-3">
          <ScopeToggle value={scope} onChange={changeScope} />
          <ViewToggle value={view} onChange={changeView} scope={scope} />
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          작업 추가
        </Button>
      </header>

      <FilterBar
        scope={scope}
        filters={filters}
        members={members}
        categories={categories}
        onChange={handleFilterChange}
        onReset={handleReset}
      />

      <section className={cn("mt-4", loading && "pointer-events-none opacity-60")}>
        {error ? (
          <ErrorState message={error} onRetry={() => void loadItems()} />
        ) : items.length === 0 && !loading ? (
          <EmptyState onCreate={openCreate} scope={scope} />
        ) : scope === "transferred" || view === "table" ? (
          <TableView items={tableItems} onOpen={openDrawer} />
        ) : view === "kanban" ? (
          <KanbanView
            items={items}
            visibleStatuses={filters.status.length > 0 ? filters.status : ACTIVE_STATUSES}
            onOpen={openDrawer}
            onUpdate={updateItemStatus}
          />
        ) : (
          <GanttView items={items} onOpen={openDrawer} />
        )}
      </section>

      {scope === "transferred" && !error && items.length > 0 ? (
        <TransferredPagination
          page={transferredPageIndex + 1}
          hasPrevious={transferredPageIndex > 0}
          hasNext={Boolean(transferredNextCursor)}
          onPrevious={() => setTransferredPageIndex((p) => Math.max(0, p - 1))}
          onNext={() => {
            if (!transferredNextCursor) return;
            setTransferredPageCursors((prev) => {
              if (prev[transferredPageIndex + 1] === transferredNextCursor) return prev;
              const next = prev.slice(0, transferredPageIndex + 1);
              next.push(transferredNextCursor);
              return next;
            });
            setTransferredPageIndex((p) => p + 1);
          }}
        />
      ) : null}

      <WorkItemFormDialog
        open={formOpen}
        editing={editing}
        members={members}
        categories={categories}
        systems={systems}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void loadItems();
          // 드로어가 열려 있으면 최신 detail 재로드 (updatedAt 동기화)
          if (drawerId) setDrawerReloadKey((k) => k + 1);
        }}
      />

      <WorkItemDrawer
        workItemId={drawerId}
        reloadKey={drawerReloadKey}
        onClose={() => setDrawerId(null)}
        onEdit={(item) => {
          openEditFromDrawer(item);
        }}
        onDeleted={() => setDrawerId(null)}
        onMutated={() => void loadItems()}
      />
    </div>
  );
}

function ScopeToggle({
  value,
  onChange,
}: {
  value: WorkScope;
  onChange: (next: WorkScope) => void;
}) {
  return (
    <div className="flex items-center rounded-md border bg-card p-0.5">
      <ToggleButton
        active={value === "active"}
        onClick={() => onChange("active")}
        label="진행 작업"
      >
        <ListChecks className="h-4 w-4" />
      </ToggleButton>
      <ToggleButton
        active={value === "transferred"}
        onClick={() => onChange("transferred")}
        label="이관 완료"
      >
        <TableIcon className="h-4 w-4" />
      </ToggleButton>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
  scope,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  scope: WorkScope;
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
        disabled={scope === "transferred"}
      >
        <LayoutGrid className="h-4 w-4" />
      </ToggleButton>
      <ToggleButton
        active={value === "gantt"}
        onClick={() => onChange("gantt")}
        label="간트"
        disabled={scope === "transferred"}
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
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
      )}
    >
      {children}
      {label}
    </button>
  );
}

function FilterBar({
  scope,
  filters,
  members,
  categories,
  onChange,
  onReset,
}: {
  scope: WorkScope;
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
          {scope === "active" ? (
            <div className="flex flex-wrap gap-1">
              {ACTIVE_STATUSES.map((s) => (
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
          ) : (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                disabled
                className="inline-flex items-center rounded px-2 py-1 text-xs bg-primary text-primary-foreground opacity-100"
              >
                {STATUS_LABELS.TRANSFERRED}
              </button>
            </div>
          )}
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

function TransferredPagination({
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">
        이관 완료 작업 50건씩 조회
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={!hasPrevious}
        >
          이전
        </Button>
        <span className="min-w-12 text-center text-sm font-medium">
          {page} 페이지
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!hasNext}
        >
          다음
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  onCreate,
  scope,
}: {
  onCreate: () => void;
  scope: WorkScope;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-16 text-center">
      <ListChecks className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">조건에 맞는 작업이 없습니다</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {scope === "active"
            ? "새 작업을 추가하거나 필터를 초기화해보세요."
            : "아직 이관 완료된 작업이 없거나 필터 조건에 맞는 완료 건이 없습니다."}
        </p>
      </div>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        작업 추가
      </Button>
    </div>
  );
}
