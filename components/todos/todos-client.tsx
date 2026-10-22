"use client";

import * as React from "react";
import { CheckSquare, ChevronDown, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberFilter } from "@/components/member-filter";
import { ApiError, api, emitTodosChanged } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { toast } from "@/lib/client/use-toast";
import type {
  ListResponse,
  Member,
  TodoChecklistItem,
  TodoItem,
} from "@/lib/client/types";
import { TODO_STATUSES, type TodoStatus } from "@/lib/enums";
import { TODO_STATUS_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";
import { TodoDrawer } from "./todo-drawer";

interface Filters {
  status: TodoStatus[];
  assigneeId: string[];
  title: string;
}

const PAGE_SIZE = 30;

const DEFAULT_FILTERS: Filters = {
  status: ["OPEN"],
  assigneeId: [],
  title: "",
};

export function TodosClient() {
  const [items, setItems] = React.useState<TodoItem[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [debouncedTitle, setDebouncedTitle] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerMode, setDrawerMode] = React.useState<"edit" | "create">("edit");
  const [filterVisible, setFilterVisible] = React.useState(true);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const requestControllerRef = React.useRef<AbortController | null>(null);
  const latestLoadItems = React.useRef<(() => Promise<void>) | null>(null);
  const pendingWrites = React.useRef(new Set<string>());
  const [pendingIds, setPendingIds] = React.useState(new Set<string>());
  const searchPending = filters.title !== debouncedTitle;

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTitle(filters.title), 250);
    return () => window.clearTimeout(timer);
  }, [filters.title]);

  const loadMembers = React.useCallback(async () => {
    try {
      setMembers(await api.getAll<Member>("/api/team-members"));
    } catch (err) {
      toast({
        title: "팀원 조회 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }, []);

  const loadItems = React.useCallback(async (cursor?: string) => {
    const requestId = ++requestIdRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoadingMore(Boolean(cursor));
    setLoading(!cursor);
    setError(null);
    try {
      const res = await api.get<ListResponse<TodoItem>>("/api/todos", {
        signal: controller.signal,
        query: {
          include: "checklist",
          status: filters.status.length ? filters.status.join(",") : undefined,
          assigneeId: filters.assigneeId.length
            ? filters.assigneeId.join(",")
            : undefined,
          title: debouncedTitle || undefined,
          pageSize: PAGE_SIZE,
          cursor,
        },
      });
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      setItems((prev) => cursor
        ? [...prev, ...res.items.filter((item) => !prev.some((existing) => existing.id === item.id))]
        : res.items);
      setNextCursor(res.nextCursor);
    } catch (err) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : "TODO를 불러오지 못했습니다");
    } finally {
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        setLoadingMore(false);
        setLoading(false);
      }
    }
  }, [filters.status, filters.assigneeId, debouncedTitle]);

  React.useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  React.useEffect(() => {
    latestLoadItems.current = loadItems;
    setExpanded(new Set());
    void loadItems();
    return () => {
      requestControllerRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, [loadItems]);

  const reloadItems = React.useCallback(() => { void latestLoadItems.current?.(); }, []);
  const closeDrawer = React.useCallback(() => {
    setDrawerId(null);
    setDrawerMode("edit");
  }, []);

  function beginWrite(id: string) {
    if (pendingWrites.current.has(id)) return false;
    pendingWrites.current.add(id);
    setPendingIds(new Set(pendingWrites.current));
    return true;
  }

  function endWrite(id: string) {
    pendingWrites.current.delete(id);
    setPendingIds(new Set(pendingWrites.current));
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setDrawerMode("create");
    setDrawerId(null);
  }

  function openEdit(id: string) {
    setDrawerMode("edit");
    setDrawerId(id);
  }

  /** 인라인 체크박스 토글 — 낙관적 업데이트 */
  async function toggleChecklistItem(
    todoId: string,
    item: TodoChecklistItem,
  ) {
    if (!beginWrite(item.id)) return;
    const nextDone = !item.done;
    setItems((prev) =>
      prev.map((todo) =>
        todo.id === todoId
          ? {
              ...todo,
              checklist: todo.checklist?.map((c) =>
                c.id === item.id ? { ...c, done: nextDone } : c,
              ),
            }
          : todo,
      ),
    );
    try {
      await api.patch(`/api/todos/${todoId}/checklist/${item.id}`, {
        done: nextDone,
      });
    } catch (err) {
      // 롤백
      setItems((prev) =>
        prev.map((todo) =>
          todo.id === todoId
            ? {
                ...todo,
                checklist: todo.checklist?.map((c) =>
                  c.id === item.id ? { ...c, done: item.done } : c,
                ),
              }
            : todo,
        ),
      );
      toast({
        title: "체크 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      endWrite(item.id);
    }
  }

  async function toggleTodoStatus(todo: TodoItem) {
    if (!beginWrite(todo.id)) return;
    const next = todo.status === "DONE" ? "OPEN" : "DONE";
    setItems((prev) =>
      prev.map((t) => (t.id === todo.id ? { ...t, status: next } : t)),
    );
    try {
      await api.patch(`/api/todos/${todo.id}`, { status: next });
      emitTodosChanged();
      reloadItems();
    } catch (err) {
      setItems((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, status: todo.status } : t)),
      );
      toast({
        title: "상태 변경 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      endWrite(todo.id);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-8">
      <header className="flex items-center">
        <h1 className="text-xl font-semibold">할 일</h1>
        <div className="flex-1" />
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          TODO 추가
        </Button>
      </header>

      {filterVisible && (
        <div className="mt-4 grid gap-4 rounded-lg border bg-card p-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <Label className="text-xs">상태</Label>
            <div className="flex flex-wrap gap-1">
              {TODO_STATUSES.map((s) => {
                const active = filters.status.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        status: active
                          ? f.status.filter((x) => x !== s)
                          : [...f.status, s],
                      }))
                    }
                    className={cn(
                      "inline-flex items-center rounded-sm px-2 py-1 text-xs transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                    )}
                  >
                    {TODO_STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label className="text-xs">담당자</Label>
            <div>
              <MemberFilter
                members={members}
                selectedIds={new Set(filters.assigneeId)}
                onToggle={(id) =>
                  setFilters((f) => ({
                    ...f,
                    assigneeId: f.assigneeId.includes(id)
                      ? f.assigneeId.filter((x) => x !== id)
                      : [...f.assigneeId, id],
                  }))
                }
                onClear={() => setFilters((f) => ({ ...f, assigneeId: [] }))}
                className="h-7 px-2 text-xs"
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="todo-title-filter" className="text-xs">제목</Label>
            <Input
              id="todo-title-filter"
              maxLength={300}
              value={filters.title}
              onChange={(e) =>
                setFilters((f) => ({ ...f, title: e.target.value }))
              }
              placeholder=""
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}

      <div className="mt-1.5 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFilterVisible((v) => !v)}
        >
          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
          {filterVisible ? "필터 숨기기" : "필터 보기"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFilters(DEFAULT_FILTERS)}
        >
          초기화
        </Button>
      </div>

      <section
        className="mt-4 rounded-lg border bg-card"
        aria-busy={loading || loadingMore || searchPending}
      >
        {loading || searchPending ? (
          <p role="status" className="px-4 py-12 text-center text-sm text-muted-foreground">TODO를 불러오는 중...</p>
        ) : error ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm font-medium">TODO를 불러오지 못했습니다</p>
            <p className="break-words text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={reloadItems}>다시 시도</Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState onCreate={openCreate} onReset={() => setFilters({ status: [], assigneeId: [], title: "" })}
            filtered={Boolean(filters.title || filters.status.length || filters.assigneeId.length)} />
        ) : (
          <>
            <ul className="divide-y">
              {items.map((todo) => {
                const isExpanded = expanded.has(todo.id);
                const total = todo.checklist?.length ?? 0;
                const done =
                  todo.checklist?.filter((c) => c.done).length ?? 0;
                return (
                  <li key={todo.id}>
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={todo.status === "DONE"}
                        onChange={() => void toggleTodoStatus(todo)}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded-sm border-input"
                        disabled={pendingIds.has(todo.id)}
                        aria-label={`${todo.title} 완료`}
                      />
                      {total > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(todo.id)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
                          aria-label={`${todo.title} 체크리스트 ${isExpanded ? "접기" : "펼치기"}`}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      ) : (
                        <span className="h-6 w-6 shrink-0" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        onClick={() => openEdit(todo.id)}
                        className="min-w-0 flex-1 break-words text-left text-sm font-medium hover:underline"
                      >
                        {todo.title}
                      </button>
                      <div className="flex w-full flex-wrap items-center gap-2 pl-12 sm:w-auto sm:pl-0">
                      <span
                        className={cn(
                          "shrink-0 rounded-sm px-1.5 py-0.5 text-[11px]",
                          todo.status === "DONE"
                            ? "bg-muted text-muted-foreground"
                            : "bg-primary/10 text-primary",
                        )}
                      >
                        {TODO_STATUS_LABELS[todo.status]}
                      </span>
                      {total > 0 && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {done}/{total}
                        </span>
                      )}
                      <span className="max-w-32 truncate text-xs text-muted-foreground sm:w-24">
                        {todo.assignee?.name ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums sm:w-24">
                        {todo.dueDate ? formatDate(todo.dueDate) : ""}
                      </span>
                      </div>
                    </div>
                    {isExpanded && total > 0 && (
                      <ul className="border-t bg-muted/30 px-3 py-2">
                        {todo.checklist!.map((item) => (
                          <li
                            key={item.id}
                            className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 py-1.5 sm:grid-cols-[1rem_minmax(0,1fr)_6rem] sm:px-6"
                          >
                            <input
                              type="checkbox"
                              checked={item.done}
                              disabled={pendingIds.has(item.id)}
                              aria-label={`${item.content} 완료`}
                              onChange={() => toggleChecklistItem(todo.id, item)}
                              className="h-4 w-4 cursor-pointer rounded-sm border-input"
                            />
                            <span
                              className={cn(
                                "min-w-0 break-words text-sm",
                                item.done && "text-muted-foreground line-through",
                              )}
                            >
                              {item.content}
                            </span>
                            <span className="col-start-2 max-w-full truncate text-xs text-muted-foreground sm:col-start-3">
                              {item.assignee?.name ?? "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            {nextCursor && (
              <div className="border-t px-3 py-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void loadItems(nextCursor)}
                  disabled={loadingMore || searchPending}
                >
                  {loadingMore ? "불러오는 중..." : "더보기"}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <TodoDrawer
        mode={drawerMode}
        todoId={drawerId}
        members={members}
        open={drawerMode === "create" || drawerId !== null}
        onClose={closeDrawer}
        onMutated={reloadItems}
      />
    </div>
  );
}

function EmptyState({ onCreate, onReset, filtered }: { onCreate: () => void; onReset: () => void; filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <CheckSquare className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">{filtered ? "조건에 맞는 TODO가 없습니다" : "등록된 TODO가 없습니다"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {filtered ? "필터를 해제하거나 새 TODO를 추가해보세요." : "새 TODO를 추가해보세요."}
        </p>
      </div>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        TODO 추가
      </Button>
      {filtered && <Button variant="outline" onClick={onReset}>필터 해제</Button>}
    </div>
  );
}
