"use client";

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api, emitWorkItemsChanged } from "@/lib/client/api";
import { formatDate, formatDateTime } from "@/lib/client/format";
import { toast } from "@/lib/client/use-toast";
import type {
  AuditLog,
  ListResponse,
  WorkCategory,
  WorkItemDetail,
  WorkSystem,
} from "@/lib/client/types";
import {
  MEMBER_ROLE_LABELS,
  PRIORITY_LABELS,
} from "@/lib/enum-labels";
import { StatusBadge } from "./status-badge";

/**
 * 작업 상세 드로어 — 우측 슬라이드 패널.
 *
 * 탭:
 *  - 상세: 요청정보 + 메타데이터 + 시스템 연동 + 설명
 *  - 활동: AuditLog 타임라인
 */

type Props = {
  workItemId: string | null;
  /** 이 값이 바뀌면 현재 열린 상세를 다시 fetch한다. 폼 저장 후 드로어 갱신용. */
  reloadKey?: number;
  categories: WorkCategory[];
  systems: WorkSystem[];
  onClose: () => void;
  onEdit: (item: WorkItemDetail) => void;
  onDeleted: () => void;
  onMutated: () => void;
};

export function WorkItemDrawer({
  workItemId,
  reloadKey,
  categories,
  systems,
  onClose,
  onEdit,
  onDeleted,
  onMutated,
}: Props) {
  const open = workItemId !== null;
  const [detail, setDetail] = React.useState<WorkItemDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const deletingRef = React.useRef(false);
  const requestRef = React.useRef<AbortController | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  const loadDetail = React.useCallback(async (id: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setDetail(null);
    setError(null);
    try {
      const res = await api.get<WorkItemDetail>(`/api/work-items/${id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDetail(res);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof ApiError ? err.message : "상세 조회 실패";
      setError(message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!workItemId) {
      requestRef.current?.abort();
      setDetail(null);
      setError(null);
      return;
    }
    void loadDetail(workItemId);
    return () => requestRef.current?.abort();
  }, [workItemId, reloadKey, loadDetail]);

  async function handleDelete() {
    if (!detail || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/work-items/${detail.id}`);
      toast({ title: "작업을 삭제했습니다" });
      emitWorkItemsChanged();
      setConfirmDelete(false);
      onDeleted();
      onMutated();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "작업을 삭제하지 못했습니다");
      toast({
        title: "작업 삭제 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && !deletingRef.current && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl gap-2"
          onOpenAutoFocus={() => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocusRef.current?.isConnected) {
              event.preventDefault();
              returnFocusRef.current.focus();
            }
          }}>
          {loading ? (
            <DrawerSkeleton />
          ) : error ? (
            <div className="flex flex-col items-start gap-3">
              <SheetHeader>
                <SheetTitle>오류</SheetTitle>
                <SheetDescription>{error}</SheetDescription>
              </SheetHeader>
              <Button
                variant="outline"
                onClick={() => workItemId && void loadDetail(workItemId)}
              >
                다시 시도
              </Button>
            </div>
          ) : detail ? (
            <DrawerBody
              detail={detail}
              categories={categories}
              systems={systems}
              onEdit={() => onEdit(detail)}
              onRequestDelete={() => { setDeleteError(null); setConfirmDelete(true); }}
            />
          ) : <DrawerSkeleton />}
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDelete} onOpenChange={(value) => { if (!deletingRef.current) setConfirmDelete(value); }}>
        <DialogContent hideCloseButton={deleting}>
          <DialogHeader>
            <DialogTitle>작업 삭제</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{detail?.title}</span>
              {" "}작업을 삭제하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              취소
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? "삭제 중…" : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DrawerBody({
  detail,
  categories,
  systems,
  onEdit,
  onRequestDelete,
}: {
  detail: WorkItemDetail;
  categories: WorkCategory[];
  systems: WorkSystem[];
  onEdit: () => void;
  onRequestDelete: () => void;
}) {
  const categoryName = React.useMemo(() => {
    if (!detail.category) return null;
    return categories.find((c) => c.code === detail.category)?.name ?? detail.category;
  }, [categories, detail.category]);

  return (
    <>
      <SheetHeader className="pr-12">
        {categoryName && (
          <p className="text-xs text-muted-foreground">{categoryName}</p>
        )}
        <SheetTitle className="text-xl">{detail.title}</SheetTitle>
        <SheetDescription className="sr-only">
          작업 상세 정보와 변경 이력을 확인하고 수정합니다.
        </SheetDescription>
      </SheetHeader>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          수정
        </Button>
        <Button variant="outline" size="sm" onClick={onRequestDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          삭제
        </Button>
      </div>

      <Tabs defaultValue="detail" className="mt-3 flex min-h-0 flex-1 flex-col">
        <TabsList className="h-auto w-full justify-start gap-0 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger
            value="detail"
            className="-mb-px rounded-b-none rounded-t-md border border-border border-b-0 bg-muted px-5 py-2 text-sm font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            상세
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="-mb-px rounded-b-none rounded-t-md border border-border border-b-0 bg-muted px-5 py-2 text-sm font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            활동
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="detail">
            <DetailPanel detail={detail} systems={systems} />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityPanel workItemId={detail.id} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

function DetailPanel({ detail, systems }: { detail: WorkItemDetail; systems: WorkSystem[] }) {
  const systemNameByCode = React.useMemo(
    () => Object.fromEntries(systems.map((s) => [s.code, s.name])),
    [systems],
  );
  const hasRequestInfo =
    detail.requestType || detail.requestor || detail.requestNumber || detail.requestContent;

  const [actors, setActors] = React.useState<{
    creator: string | null;
    modifier: string | null;
  } | null>(null);
  const [actorsError, setActorsError] = React.useState<string | null>(null);
  const actorsRequestRef = React.useRef<AbortController | null>(null);

  const loadActors = React.useCallback(async () => {
    actorsRequestRef.current?.abort();
    const controller = new AbortController();
    actorsRequestRef.current = controller;
    setActors(null);
    setActorsError(null);
    try {
      const [created, updated] = await Promise.all(["CREATE", "UPDATE"].map((action) =>
        api.get<ListResponse<AuditLog>>("/api/audit-logs", {
          signal: controller.signal,
          query: { entityType: "WorkItem", entityId: detail.id, action, pageSize: 1 },
        }),
      ));
      if (controller.signal.aborted) return;
      setActors({ creator: created.items[0]?.actorName ?? null, modifier: updated.items[0]?.actorName ?? null });
    } catch (err) {
      if (controller.signal.aborted) return;
      setActorsError(err instanceof ApiError ? err.message : "작성자 정보 조회 실패");
    }
  }, [detail.id]);

  React.useEffect(() => {
    void loadActors();
    return () => actorsRequestRef.current?.abort();
  }, [loadActors, detail.updatedAt]);

  return (
    <div className="mt-4 space-y-3">
      {/* 기본 정보 */}
      <Section title="기본 정보">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <Field label="상태"><StatusBadge status={detail.status} /></Field>
          <Field label="우선순위">{PRIORITY_LABELS[detail.priority]}</Field>
          <Field label="담당자">
            {detail.assignee ? (
              <span>
                {detail.assignee.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {MEMBER_ROLE_LABELS[detail.assignee.role]}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">미배정</span>
            )}
          </Field>
          <Field label="시작일">{formatDate(detail.startDate) || "—"}</Field>
          <Field label="종료일">{formatDate(detail.endDate) || "—"}</Field>
          <Field label="이관일">{formatDate(detail.transferDate) || "—"}</Field>
        </dl>
      </Section>

      {/* 요청 정보 */}
      {hasRequestInfo && (
        <Section title="요청 정보">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
            {detail.requestType && (
              <Field label="요청구분">{detail.requestType}</Field>
            )}
            {detail.requestor && (
              <Field label="요청자">{detail.requestor}</Field>
            )}
            {detail.requestNumber && (
              <Field label="요청번호">{detail.requestNumber}</Field>
            )}
          </dl>
          {detail.requestContent && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">요청내용</p>
              <p className="whitespace-pre-wrap text-sm">{detail.requestContent}</p>
            </div>
          )}
        </Section>
      )}

      {/* 시스템 연동 */}
      {detail.tickets.length > 0 && (
        <Section title="시스템 연동">
          <ul className="space-y-1.5">
            {detail.tickets.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="font-medium shrink-0">{systemNameByCode[t.systemName] ?? t.systemName}</span>
                {t.ticketNumber ? (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="text-muted-foreground">{t.ticketNumber}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 추가 사항 */}
      <Section title="추가 사항">
        {detail.additionalNotes ? (
          <div className="whitespace-pre-wrap text-sm">{detail.additionalNotes}</div>
        ) : (
          <p className="text-sm text-muted-foreground">추가 사항 없음</p>
        )}
      </Section>

      {/* 설명 */}
      <Section title="설명">
        {detail.description?.trim() ? (
          <p className="whitespace-pre-wrap text-sm">{detail.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">설명 없음</p>
        )}
      </Section>

      {/* 등록 / 수정 */}
      <Section title="등록 / 수정">
        {actorsError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>작성자 정보 조회 실패: {actorsError}</span>
          <Button variant="outline" size="sm" onClick={() => void loadActors()}>다시 시도</Button>
        </div>}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="등록자">{actorsError ? "조회 실패" : actors === null ? "불러오는 중…" : actors.creator ?? "—"}</Field>
          <Field label="등록일시">{formatDateTime(detail.createdAt)}</Field>
          <Field label="수정자">{actorsError ? "조회 실패" : actors === null ? "불러오는 중…" : actors.modifier ?? "—"}</Field>
          <Field label="수정일시">{formatDateTime(detail.updatedAt)}</Field>
        </dl>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ActivityPanel({ workItemId }: { workItemId: string }) {
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ message: string; cursor?: string; restart: boolean } | null>(null);
  const requestRef = React.useRef<AbortController | null>(null);

  const loadLogs = React.useCallback(async (cursor?: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    if (!cursor) {
      setLogs([]);
      setNextCursor(null);
    }
    try {
      const res = await api.get<ListResponse<AuditLog>>("/api/audit-logs", {
        signal: controller.signal,
        query: { entityType: "WorkItem", entityId: workItemId, cursor },
      });
      if (controller.signal.aborted) return;
      setLogs((previous) => cursor
        ? [...new Map([...previous, ...res.items].map((log) => [log.id, log])).values()]
        : res.items);
      setNextCursor(res.nextCursor);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError({
        message: err instanceof ApiError ? err.message : "활동 로그 조회 실패",
        cursor,
        restart: Boolean(cursor && err instanceof ApiError && err.code === "BAD_REQUEST"),
      });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [workItemId]);

  React.useEffect(() => {
    void loadLogs();
    return () => requestRef.current?.abort();
  }, [loadLogs]);

  if (!error && !loading && logs.length === 0) {
    return <p className="text-sm text-muted-foreground">기록된 활동이 없습니다.</p>;
  }

  return (
    <div className="space-y-3" aria-busy={loading}>
      <ol className="space-y-3">
        {logs.map((log) => (
          <li key={log.id} className="rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {ACTION_LABELS[log.action] ?? log.action}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(log.createdAt)}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {log.actorName ?? "익명"}
            </div>
            {log.afterJson ? (
              <pre className="mt-2 max-h-40 overflow-auto rounded-sm bg-muted/40 p-2 text-[11px] leading-snug">
                {prettyJson(log.afterJson)}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
        <span>활동 로그 조회 실패: {error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void loadLogs(error.restart ? undefined : error.cursor)}>
          {error.restart ? "처음부터 다시 조회" : "다시 시도"}
        </Button>
      </div>}
      {loading && <p role="status" className="text-sm text-muted-foreground">불러오는 중…</p>}
      {nextCursor && !error && <Button variant="outline" disabled={loading} onClick={() => void loadLogs(nextCursor)}>더 보기</Button>}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: "생성",
  UPDATE: "수정",
  DELETE: "삭제",
  RESTORE: "복원",
};

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4">
      <SheetHeader className="sr-only">
        <SheetTitle>작업 불러오는 중</SheetTitle>
        <SheetDescription>작업 상세 정보를 가져오고 있습니다.</SheetDescription>
      </SheetHeader>
      <div className="h-4 w-24 animate-pulse rounded-sm bg-muted" />
      <div className="h-7 w-2/3 animate-pulse rounded-sm bg-muted" />
      <div className="h-9 w-40 animate-pulse rounded-sm bg-muted" />
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded-sm bg-muted" />
        <div className="h-3 w-5/6 animate-pulse rounded-sm bg-muted" />
        <div className="h-3 w-4/6 animate-pulse rounded-sm bg-muted" />
      </div>
    </div>
  );
}
