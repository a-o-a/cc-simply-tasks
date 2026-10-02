"use client";

import * as React from "react";
import { SquareCheck, ChevronDown, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberFilter } from "@/components/member-filter";
import { ApiError, api, emitTodosChanged, isAbortError } from "@/lib/client/api";
import { useRequestController } from "@/lib/client/use-request-controller";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import { LoadingState, QueryError } from "@/components/ui/query-state";
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
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerMode, setDrawerMode] = React.useState<"edit" | "create">("edit");
  const [filterVisible, setFilterVisible] = React.useState(true);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [failedCursor, setFailedCursor] = React.useState<string | undefined>();
  const [memberError, setMemberError] = React.useState<string | null>(null);
  const [memberReloadKey, setMemberReloadKey] = React.useState(0);
  const [pendingIds, setPendingIds] = React.useState(new Set<string>());
  const pendingIdsRef = React.useRef(new Set<string>());
  const { beginRequest, cancelRequest } = useRequestController();
  const titleFilter = useDebouncedValue(filters.title);

  React.useEffect(() => {
    const controller = new AbortController();
    setMemberError(null);
    api.getAllPages<Member>("/api/team-members", { signal: controller.signal })
      .then(setMembers)
      .catch((error) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setMemberError(error instanceof ApiError ? error.message : "팀원을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, [memberReloadKey]);

  const loadItems = React.useCallback(async (cursor?: string) => {
    const request = beginRequest();
    setLoadingMore(Boolean(cursor));
    setLoading(!cursor);
    setError(null);
    try {
      const res = await api.get<ListResponse<TodoItem>>("/api/todos", {
        signal: request.signal,
        query: {
          include: "checklist",
          status: filters.status.length ? filters.status.join(",") : undefined,
          assigneeId: filters.assigneeId.length
            ? filters.assigneeId.join(",")
            : undefined,
          title: titleFilter || undefined,
          pageSize: PAGE_SIZE,
          cursor,
        },
      });
      if (!request.isCurrent()) return;
      if (cursor && res.nextCursor === cursor) {
        throw new ApiError("BAD_RESPONSE", "다음 목록을 불러오지 못했습니다. 다시 시도해주세요.", 200);
      }
      setItems((prev) => cursor ? Array.from(new Map([...prev, ...res.items].map((item) => [item.id, item])).values()) : res.items);
      setNextCursor(res.nextCursor);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      setError(err instanceof ApiError ? err.message : "할 일을 불러오지 못했습니다.");
      setFailedCursor(cursor);
    } finally {
      if (request.isCurrent()) {
        setLoadingMore(false);
        setLoading(false);
      }
    }
  }, [filters.status, filters.assigneeId, titleFilter, beginRequest]);

  React.useEffect(() => {
    setExpanded(new Set());
    void loadItems();
    return cancelRequest;
  }, [loadItems, cancelRequest]);

  function startMutation(id: string) {
    if (pendingIdsRef.current.has(id)) return false;
    pendingIdsRef.current.add(id);
    setPendingIds(new Set(pendingIdsRef.current));
    return true;
  }

  function finishMutation(id: string) {
    pendingIdsRef.current.delete(id);
    setPendingIds(new Set(pendingIdsRef.current));
  }

  const closeDrawer = React.useCallback(() => {
    setDrawerId(null);
    setDrawerMode("edit");
  }, []);

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
    if (!startMutation(todoId)) return;
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
      emitTodosChanged();
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
      finishMutation(todoId);
    }
  }

  async function toggleTodoStatus(todo: TodoItem) {
    if (!startMutation(todo.id)) return;
    const next = todo.status === "DONE" ? "OPEN" : "DONE";
    setItems((prev) =>
      prev.map((t) => (t.id === todo.id ? { ...t, status: next } : t)),
    );
    try {
      await api.patch(`/api/todos/${todo.id}`, { status: next });
      emitTodosChanged();
      void loadItems();
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
      finishMutation(todo.id);
    }
  }

  return (
    <div className="px-8 py-6">
      <header className="flex items-center">
        <h1 className="text-xl font-semibold">할 일</h1>
        <div className="flex-1" />
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          TODO 추가
        </Button>
      </header>

      {memberError && <div className="mt-4"><QueryError message={memberError} onRetry={() => setMemberReloadKey((key) => key + 1)} /></div>}
      {filterVisible && (
        <div className="mt-4 flex items-start gap-4 rounded-lg border bg-card p-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">상태</Label>
            <div className="flex flex-wrap gap-1">
              {TODO_STATUSES.map((s) => {
                const active = filters.status.includes(s);
                return (
                  <button
                    type="button"
                    aria-pressed={active}
                    key={s}
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
          <div className="flex-1 space-y-1.5">
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
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">제목</Label>
            <Input
              aria-label="할 일 제목 검색"
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
          aria-expanded={filterVisible}
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
        aria-busy={loading || loadingMore}
        className={cn(
          "mt-4 rounded-lg border bg-card",
          loading && "pointer-events-none opacity-60",
        )}
      >
        {error && <QueryError message={error} onRetry={() => void loadItems(failedCursor)} />}
        {loading ? (
          <LoadingState message="할 일을 불러오는 중…" />
        ) : items.length === 0 && !error ? (
          <EmptyState onCreate={openCreate} />
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
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={todo.status === "DONE"}
                        disabled={pendingIds.has(todo.id)}
                        onChange={() => void toggleTodoStatus(todo)}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded-sm border-input"
                        aria-label={`${todo.title} 완료`}
                      />
                      {total > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(todo.id)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
                          aria-label={isExpanded ? "접기" : "펼치기"}
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
                        disabled={pendingIds.has(todo.id)}
                        className="flex-1 truncate text-left text-sm font-medium hover:underline"
                      >
                        {todo.title}
                      </button>
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
                      <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                        {todo.assignee?.name ?? "—"}
                      </span>
                      <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {todo.dueDate ? formatDate(todo.dueDate) : ""}
                      </span>
                    </div>
                    {isExpanded && total > 0 && (
                      <ul className="border-t bg-muted/30 px-3 py-2">
                        {todo.checklist!.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center gap-2 px-6 py-1.5"
                          >
                            <input
                              type="checkbox"
                              checked={item.done}
                              disabled={pendingIds.has(todo.id)}
                              aria-label={`${item.content} 완료`}
                              onChange={() => toggleChecklistItem(todo.id, item)}
                              className="h-4 w-4 cursor-pointer rounded-sm border-input"
                            />
                            <span
                              className={cn(
                                "flex-1 text-sm",
                                item.done && "text-muted-foreground line-through",
                              )}
                            >
                              {item.content}
                            </span>
                            <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
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
                  disabled={loadingMore}
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
        onMutated={() => void loadItems()}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <SquareCheck className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">등록된 TODO가 없습니다</p>
        <p className="mt-1 text-xs text-muted-foreground">
          새 TODO를 추가해보세요.
        </p>
      </div>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        TODO 추가
      </Button>
    </div>
  );
}
