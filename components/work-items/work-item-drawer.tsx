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
import { ApiError, api, emitWorkItemsChanged, isAbortError } from "@/lib/client/api";
import { useRequestController } from "@/lib/client/use-request-controller";
import { LoadingState, QueryError } from "@/components/ui/query-state";
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
  const deletingRef = React.useRef(false);
  const { beginRequest, cancelRequest } = useRequestController();

  const loadDetail = React.useCallback(async (id: string) => {
    const request = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<WorkItemDetail>(`/api/work-items/${id}`, { signal: request.signal });
      if (request.isCurrent()) setDetail(res);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      const message = err instanceof ApiError ? err.message : "상세 조회 실패";
      setError(message);
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  React.useEffect(() => {
    setConfirmDelete(false);
    if (!workItemId) {
      setDetail(null);
      setError(null);
      return;
    }
    void loadDetail(workItemId);
    return cancelRequest;
  }, [workItemId, reloadKey, loadDetail, cancelRequest]);

  async function handleDelete() {
    if (!detail || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await api.delete(`/api/work-items/${detail.id}`);
      toast({ title: "작업을 삭제했습니다" });
      emitWorkItemsChanged();
      setConfirmDelete(false);
      onDeleted();
      onMutated();
    } catch (err) {
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
      <Sheet open={open} onOpenChange={(o) => { if (!o && !deletingRef.current) onClose(); }}>
        <SheetContent className="w-full sm:max-w-2xl gap-2">
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
              onRequestDelete={() => setConfirmDelete(true)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDelete} onOpenChange={(next) => { if (!deletingRef.current) setConfirmDelete(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>작업 삭제</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{detail?.title}</span>
              {" "}작업을 삭제하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
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
        <SheetDescription>작업 상세 정보와 변경 기록을 확인합니다.</SheetDescription>
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
            <ActivityPanel key={`${detail.id}:${detail.updatedAt}`} workItemId={detail.id} />
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
  const [actorError, setActorError] = React.useState<string | null>(null);
  const [actorReloadKey, setActorReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setActors(null);
    setActorError(null);
    const query = { entityType: "WorkItem", entityId: detail.id, pageSize: 1 };
    Promise.all([
      api.get<ListResponse<AuditLog>>("/api/audit-logs", { signal: controller.signal, query: { ...query, action: "CREATE" } }),
      api.get<ListResponse<AuditLog>>("/api/audit-logs", { signal: controller.signal, query: { ...query, action: "UPDATE" } }),
    ])
      .then(([created, updated]) => {
        if (controller.signal.aborted) return;
        setActors({
          creator: created.items[0]?.actorName ?? null,
          modifier: updated.items[0]?.actorName ?? null,
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted && !isAbortError(error)) setActorError("등록자·수정자를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [detail.id, detail.updatedAt, actorReloadKey]);

  return (
    <div className="mt-4 space-y-3">
      {actorError && <QueryError message={actorError} onRetry={() => setActorReloadKey((key) => key + 1)} />}
      {/* 기본 정보 */}
      <Section title="기본 정보">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
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
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
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
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="등록자">{actors?.creator ?? "—"}</Field>
          <Field label="등록일시">{formatDateTime(detail.createdAt)}</Field>
          <Field label="수정자">{actors?.modifier ?? "—"}</Field>
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
  const [logs, setLogs] = React.useState<AuditLog[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failedCursor, setFailedCursor] = React.useState<string | undefined>();
  const { beginRequest, cancelRequest } = useRequestController();

  const loadLogs = React.useCallback(async (cursor?: string) => {
    const request = beginRequest();
    if (!cursor) setLogs(null);
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<ListResponse<AuditLog>>("/api/audit-logs", {
        signal: request.signal,
        query: { entityType: "WorkItem", entityId: workItemId, pageSize: 30, cursor },
      });
      if (!request.isCurrent()) return;
      setLogs((previous) => cursor ? [...(previous ?? []), ...response.items] : response.items);
      setNextCursor(response.nextCursor);
    } catch (error) {
      if (!request.isCurrent() || isAbortError(error)) return;
      setError(error instanceof ApiError ? error.message : "활동 로그 조회 실패");
      setFailedCursor(cursor);
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [workItemId, beginRequest]);

  React.useEffect(() => {
    void loadLogs();
    return cancelRequest;
  }, [loadLogs, cancelRequest]);

  if (logs === null && !error) {
    return <LoadingState message="활동 기록을 불러오는 중…" />;
  }
  if (logs?.length === 0 && !error) {
    return <p className="text-sm text-muted-foreground">기록된 활동이 없습니다.</p>;
  }

  return (
    <div className="space-y-3" aria-busy={loading}>
      {error && <QueryError message={error} onRetry={() => void loadLogs(failedCursor)} />}
    <ol className="space-y-3">
      {logs?.map((log) => (
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
      {nextCursor && <Button type="button" className="w-full" variant="outline" disabled={loading} onClick={() => void loadLogs(nextCursor)}>{loading ? "불러오는 중…" : "활동 더보기"}</Button>}
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
