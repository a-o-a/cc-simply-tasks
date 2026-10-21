"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  SquareChartGantt,
  LayoutGrid,
  ListChecks,
  Plus,
  SlidersHorizontal,
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberFilter } from "@/components/member-filter";
import { ApiError, api, emitWorkItemsChanged, isAbortError } from "@/lib/client/api";
import { useRequestController } from "@/lib/client/use-request-controller";
import { useWorkReferences } from "@/lib/client/use-work-references";
import { LoadingState, QueryError } from "@/components/ui/query-state";
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
 *  - 팀원 + 작업 목록 fetch
 *  - 필터 (status / assignee / category / priority / ticket)
 *  - 보기 모드 토글 (table / kanban / gantt) — localStorage에 저장
 *  - 생성/수정 다이얼로그 + 상세 드로어 트리거
 *
 * 테이블은 50건 단위 커서 페이지, 보드·간트는 필터에 맞는 전체 목록을 조회한다.
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
  "HOLDING",
];

interface Filters {
  status: Status[];
  assigneeId: string[];
  category: string[];
  priority: Priority[];
  transferDate: string;
  title: string;
  systemCode: string[];
  requestType: string;
  requestor: string;
  requestNumber: string;
}

function defaultFilters(scope: WorkScope): Filters {
  return {
    status: scope === "active" ? [] : ["TRANSFERRED"],
    assigneeId: [],
    category: [],
    priority: [],
    transferDate: "",
    title: "",
    systemCode: [],
    requestType: "",
    requestor: "",
    requestNumber: "",
  };
}

export function WorkItemsClient() {
  const [view, setView] = React.useState<ViewMode>("table");
  const [scope, setScope] = React.useState<WorkScope>("active");
  const [filters, setFilters] = React.useState<Filters>(() => defaultFilters("active"));
  const [items, setItems] = React.useState<WorkItemListItem[]>([]);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageCursors, setPageCursors] = React.useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const { members, categories, systems, error: referenceError, reload: reloadReferences } = useWorkReferences();
  const { beginRequest, cancelRequest } = useRequestController();
  const allItemsView = scope === "active" && view !== "table";
  const [loading, setLoading] = React.useState(true);
  const [filterVisible, setFilterVisible] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkItemListItem | null>(null);
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerReloadKey, setDrawerReloadKey] = React.useState(0);
  const updatingIdsRef = React.useRef(new Set<string>());

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
      if (savedScope === "transferred") setView("table");
    }
    setReady(true);
  }, []);

  function resetPagination() {
    setPageIndex(0);
    setPageCursors([null]);
    setNextCursor(null);
  }

  function changeView(next: ViewMode) {
    setView(next);
    resetPagination();
    window.localStorage.setItem(VIEW_KEY, next);
  }

  function changeScope(next: WorkScope) {
    setScope(next);
    if (next === "transferred") {
      setView("table");
    }
    setFilters(defaultFilters(next));
    resetPagination();
    window.localStorage.setItem(SCOPE_KEY, next);
  }

  function handleFilterChange(next: Filters) {
    setFilters(next);
    resetPagination();
  }

  function handleReset() {
    setFilters(defaultFilters(scope));
    resetPagination();
  }

  const loadItems = React.useCallback(async () => {
    if (!ready) return;
    const request = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const options = {
        signal: request.signal,
        query: {
            scope,
            cursor: allItemsView ? undefined : pageCursors[pageIndex] ?? undefined,
            pageSize: allItemsView ? 100 : 50,
            status:
              scope === "active" && filters.status.length > 0
                ? filters.status.join(",")
                : undefined,
            assigneeId: filters.assigneeId.length > 0 ? filters.assigneeId.join(",") : undefined,
            category: filters.category.length > 0 ? filters.category.join(",") : undefined,
            priority: filters.priority.length > 0 ? filters.priority.join(",") : undefined,
            transferDate: filters.transferDate || undefined,
            title: filters.title || undefined,
            systemCode: filters.systemCode.length > 0 ? filters.systemCode.join(",") : undefined,
            requestType: filters.requestType || undefined,
            requestor: filters.requestor || undefined,
            requestNumber: filters.requestNumber || undefined,
        },
      };
      const result = allItemsView
        ? { items: await api.getAllPages<WorkItemListItem>("/api/work-items", options), nextCursor: null }
        : await api.get<ListResponse<WorkItemListItem>>("/api/work-items", options);
      if (!request.isCurrent()) return;
      setItems(result.items);
      setNextCursor(result.nextCursor);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      const message = err instanceof ApiError ? err.message : "목록 조회 실패";
      setError(message);
      toast({
        title: "작업 목록 조회 실패",
        description: message,
        variant: "destructive",
      });
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [filters, scope, pageCursors, pageIndex, allItemsView, ready, beginRequest]);

  React.useEffect(() => {
    void loadItems();
    return cancelRequest;
  }, [loadItems, cancelRequest]);
  const latestLoadItems = React.useRef(loadItems);
  React.useEffect(() => {
    latestLoadItems.current = loadItems;
  }, [loadItems]);

  function openCreate() {
    setEditing(null);
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
      if (!originalItem || updatingIdsRef.current.has(id)) return;
      updatingIdsRef.current.add(id);

      // Optimistic update
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status } : item
        )
      );

      try {
        const updated = await api.patch<WorkItemListItem>(
          `/api/work-items/${id}`,
          { status }
        );
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, ...updated } : item
          )
        );
        emitWorkItemsChanged();
        void latestLoadItems.current();
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
      } finally {
        updatingIdsRef.current.delete(id);
      }
    },
    [items],
  );

  return (
    <div className="px-4 py-4 md:px-8 md:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">작업</h1>
        <div className="order-last flex w-full flex-wrap items-center justify-center gap-3 md:order-none md:w-auto md:flex-1">
          <ScopeToggle value={scope} onChange={changeScope} />
          <ViewToggle value={view} onChange={changeView} scope={scope} />
        </div>
        <Button className="ml-auto md:ml-0" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          작업 추가
        </Button>
      </header>

      {referenceError && <div className="mt-4"><QueryError message={referenceError} onRetry={() => void reloadReferences()} /></div>}
      {filterVisible && (
        <FilterBar
          scope={scope}
          filters={filters}
          members={members}
          categories={categories}
          systems={systems}
          onChange={handleFilterChange}
        />
      )}
      <div className="mt-1.5 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFilterVisible((v) => !v)}
          aria-expanded={filterVisible}
        >
          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
          {filterVisible ? "필터 숨기기" : "필터 보기"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleReset}>
          초기화
        </Button>
      </div>

      <section aria-busy={loading} className={cn("mt-4", loading && "pointer-events-none opacity-60")}>
        {error ? (
          <QueryError message={error} onRetry={() => void loadItems()} />
        ) : loading ? (
          <LoadingState message={allItemsView ? "전체 작업을 불러오는 중…" : "작업을 불러오는 중…"} />
        ) : items.length === 0 && !loading ? (
          <EmptyState onCreate={openCreate} scope={scope} />
        ) : scope === "transferred" || view === "table" ? (
          <TableView items={items} categories={categories} onOpen={openDrawer} />
        ) : view === "kanban" ? (
          <KanbanView
            items={items}
            visibleStatuses={filters.status.length > 0 ? filters.status : ACTIVE_STATUSES}
            systems={systems}
            onOpen={openDrawer}
            onUpdate={updateItemStatus}
          />
        ) : (
          <GanttView items={items} onOpen={openDrawer} />
        )}
      </section>
      {allItemsView && !loading && !error && items.length > 0 && <p role="status" className="mt-3 text-xs text-muted-foreground">조건에 맞는 전체 작업 {items.length}건</p>}

      {!allItemsView && !error && (items.length > 0 || pageIndex > 0) ? (
        <WorkPagination
          page={pageIndex + 1}
          count={items.length}
          loading={loading}
          hasPrevious={pageIndex > 0}
          hasNext={Boolean(nextCursor)}
          onPrevious={() => setPageIndex((p) => Math.max(0, p - 1))}
          onNext={() => {
            if (!nextCursor) return;
            setPageCursors((prev) => {
              if (prev[pageIndex + 1] === nextCursor) return prev;
              const next = prev.slice(0, pageIndex + 1);
              next.push(nextCursor);
              return next;
            });
            setPageIndex((p) => p + 1);
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
        onSaved={(updated) => {
          setFormOpen(false);
          // 저장된 서버 응답으로 목록과 열린 드로어를 갱신합니다.
          if (updated) {
            setItems((prev) =>
              prev.map((item) =>
                item.id === updated.id
                  ? { ...item, ...updated }
                  : item,
              ),
            );
          }
          void loadItems();
          // 드로어가 열려 있으면 최신 detail 재로드 (updatedAt 동기화)
          if (drawerId) setDrawerReloadKey((k) => k + 1);
        }}
      />

      <WorkItemDrawer
        workItemId={drawerId}
        reloadKey={drawerReloadKey}
        categories={categories}
        systems={systems}
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
        <SquareChartGantt className="h-4 w-4" />
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
        "inline-flex h-7 items-center gap-1.5 rounded-xs px-2 text-xs font-medium transition-colors",
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
  systems,
  onChange,
}: {
  scope: WorkScope;
  filters: Filters;
  members: Member[];
  categories: WorkCategory[];
  systems: WorkSystem[];
  onChange: (next: Filters) => void;
}) {
  // 텍스트 입력은 로컬 state — Enter/blur-sm 시 필터 반영
  const [localTitle, setLocalTitle] = React.useState(filters.title);
  const [localRequestType, setLocalRequestType] = React.useState(filters.requestType);
  const [localRequestor, setLocalRequestor] = React.useState(filters.requestor);
  const [localRequestNumber, setLocalRequestNumber] = React.useState(filters.requestNumber);

  // 외부(초기화)에서 filters가 비워지면 로컬도 동기화
  React.useEffect(() => { setLocalTitle(filters.title); }, [filters.title]);
  React.useEffect(() => { setLocalRequestType(filters.requestType); }, [filters.requestType]);
  React.useEffect(() => { setLocalRequestor(filters.requestor); }, [filters.requestor]);
  React.useEffect(() => { setLocalRequestNumber(filters.requestNumber); }, [filters.requestNumber]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    if (filters[key] !== value) onChange({ ...filters, [key]: value });
  }

  function applyText(key: "title" | "requestType" | "requestor" | "requestNumber", value: string) {
    if (filters[key] !== value) onChange({ ...filters, [key]: value });
  }

  function textInputProps(
    key: "title" | "requestType" | "requestor" | "requestNumber",
    local: string,
    setLocal: (v: string) => void,
  ) {
    return {
      value: local,
      "aria-label": { title: "작업 제목 검색", requestType: "요청구분 검색", requestor: "요청자 검색", requestNumber: "요청번호 검색" }[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLocal(e.target.value),
      onBlur: () => applyText(key, local),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) applyText(key, local);
      },
    };
  }

  function toggleStatus(status: Status) {
    const next = filters.status.includes(status)
      ? filters.status.filter((s) => s !== status)
      : [...filters.status, status];
    set("status", next);
  }

  function toggleCategory(code: string) {
    const next = filters.category.includes(code)
      ? filters.category.filter((c) => c !== code)
      : [...filters.category, code];
    set("category", next);
  }

  function togglePriority(priority: Priority) {
    const next = filters.priority.includes(priority)
      ? filters.priority.filter((p) => p !== priority)
      : [...filters.priority, priority];
    set("priority", next);
  }

  function toggleSystem(code: string) {
    const next = filters.systemCode.includes(code)
      ? filters.systemCode.filter((c) => c !== code)
      : [...filters.systemCode, code];
    set("systemCode", next);
  }

  const chipCls = (active: boolean) =>
    cn(
      "inline-flex items-center rounded-sm px-2 py-1 text-xs transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    );

  return (
    <div className="mt-4 rounded-lg border bg-card p-3 space-y-3">
      {/* 1행: 분류 / 상태 / 담당자 / 우선순위 / 이관일 */}
      <div className="grid grid-cols-2 gap-3 md:flex md:divide-x md:divide-border md:gap-0 [&>div]:min-w-0 max-md:[&>div]:px-0">
        {/* 분류 */}
        <div className="form-field flex-1 pr-3">
          <Label className="text-xs">분류</Label>
          <div className="flex flex-wrap gap-1">
            {categories.length === 0 ? (
              <span className="text-xs text-muted-foreground">설정에서 분류를 추가하세요</span>
            ) : (
              categories.map((c) => (
                <button type="button" key={c.code} aria-pressed={filters.category.includes(c.code)} onClick={() => toggleCategory(c.code)} className={chipCls(filters.category.includes(c.code))}>
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 상태 */}
        <div className="form-field flex-1 px-3">
          <Label className="text-xs">상태</Label>
          {scope === "active" ? (
            <div className="flex flex-wrap gap-1">
              {ACTIVE_STATUSES.map((s) => (
                <button type="button" key={s} aria-pressed={filters.status.includes(s)} onClick={() => toggleStatus(s)} className={chipCls(filters.status.includes(s))}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              <button type="button" disabled className="inline-flex items-center rounded-sm px-2 py-1 text-xs bg-primary text-primary-foreground">
                {STATUS_LABELS.TRANSFERRED}
              </button>
            </div>
          )}
        </div>

        {/* 담당자 */}
        <div className="form-field flex-1 px-3">
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
              className="h-7 px-2 text-xs"
            />
          </div>
        </div>

        {/* 우선순위 */}
        <div className="form-field flex-1 px-3">
          <Label className="text-xs">우선순위</Label>
          <div className="flex flex-wrap gap-1">
            {PRIORITIES.map((p) => (
              <button type="button" key={p} aria-pressed={filters.priority.includes(p)} onClick={() => togglePriority(p)} className={chipCls(filters.priority.includes(p))}>
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* 이관일 */}
        <div className="form-field flex-1 pl-3">
          <Label className="text-xs">이관일</Label>
          <DatePicker value={filters.transferDate} onChange={(v) => set("transferDate", v)} placeholder="날짜 선택" className="h-7 text-xs" />
        </div>
      </div>

      {/* 가로 구분선 */}
      <div className="border-t border-border" />

      {/* 2행: 제목 / 시스템 / 요청구분 / 요청자 / 요청번호 */}
      <div className="grid grid-cols-2 gap-3 md:flex md:divide-x md:divide-border md:gap-0 [&>div]:min-w-0 max-md:[&>div]:px-0">
        {/* 제목 */}
        <div className="form-field flex-1 pr-3">
          <Label className="text-xs">제목</Label>
          <Input
            placeholder=""
            className="h-7 text-xs"
            {...textInputProps("title", localTitle, setLocalTitle)}
          />
        </div>

        {/* 시스템 */}
        <div className="form-field flex-1 px-3">
          <Label className="text-xs">시스템</Label>
          <div>
            <SystemFilter
              systems={systems}
              selectedCodes={new Set(filters.systemCode)}
              onToggle={(code) => toggleSystem(code)}
              onClear={() => set("systemCode", [])}
            />
          </div>
        </div>

        {/* 요청구분 */}
        <div className="form-field flex-1 px-3">
          <Label className="text-xs">요청구분</Label>
          <Input
            placeholder=""
            className="h-7 text-xs"
            {...textInputProps("requestType", localRequestType, setLocalRequestType)}
          />
        </div>

        {/* 요청자 */}
        <div className="form-field flex-1 px-3">
          <Label className="text-xs">요청자</Label>
          <Input
            placeholder=""
            className="h-7 text-xs"
            {...textInputProps("requestor", localRequestor, setLocalRequestor)}
          />
        </div>

        {/* 요청번호 */}
        <div className="form-field flex-1 pl-3">
          <Label className="text-xs">요청번호</Label>
          <Input
            placeholder=""
            className="h-7 text-xs"
            {...textInputProps("requestNumber", localRequestNumber, setLocalRequestNumber)}
          />
        </div>
      </div>
    </div>
  );
}

function SystemFilter({
  systems,
  selectedCodes,
  onToggle,
  onClear,
}: {
  systems: WorkSystem[];
  selectedCodes: Set<string>;
  onToggle: (code: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const count = selectedCodes.size;

  const triggerLabel =
    count === 0
      ? "시스템"
      : count === 1
        ? (systems.find((s) => selectedCodes.has(s.code))?.name ?? `${count}개`)
        : `${count}개 선택`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
            count > 0
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-input bg-background text-foreground hover:bg-accent",
          )}
        >
          <span className="max-w-[8rem] truncate">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          avoidCollisions={false}
          className="z-50 min-w-[10rem] rounded-md border bg-popover p-1.5 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <button
            onClick={onClear}
            className={cn(
              "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent",
              count === 0 ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground",
            )}
          >
            전체
          </button>
          {systems.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">등록된 시스템 없음</p>
          )}
          {systems.map((s) => {
            const selected = selectedCodes.has(s.code);
            return (
              <button
                key={s.code}
                onClick={() => onToggle(s.code)}
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent",
                  selected ? "bg-primary/10 text-primary font-medium" : "text-foreground",
                )}
              >
                <span>{s.name}</span>
                {selected && <Check className="h-3 w-3 shrink-0" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function WorkPagination({
  page,
  count,
  loading,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  page: number;
  count: number;
  loading: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <p role="status" className="text-xs text-muted-foreground">
        {loading ? "불러오는 중…" : `이번 페이지 ${count}건 · 50건씩 조회`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={loading || !hasPrevious}
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
          disabled={loading || !hasNext}
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
