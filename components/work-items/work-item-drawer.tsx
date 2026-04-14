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
import { ApiError, api } from "@/lib/client/api";
import { formatDate, formatDateTime } from "@/lib/client/format";
import { toast } from "@/lib/client/use-toast";
import type {
  AuditLog,
  ListResponse,
  WorkItemDetail,
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
  onClose: () => void;
  onEdit: (item: WorkItemDetail) => void;
  onDeleted: () => void;
  onMutated: () => void;
};

export function WorkItemDrawer({
  workItemId,
  reloadKey,
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

  const loadDetail = React.useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<WorkItemDetail>(`/api/work-items/${id}`);
      setDetail(res);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "상세 조회 실패";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!workItemId) {
      setDetail(null);
      setError(null);
      return;
    }
    void loadDetail(workItemId);
  }, [workItemId, reloadKey, loadDetail]);

  async function handleDelete() {
    if (!detail) return;
    try {
      await api.delete(`/api/work-items/${detail.id}`, detail.updatedAt);
      toast({ title: "작업을 삭제했습니다" });
      setConfirmDelete(false);
      onDeleted();
      onMutated();
    } catch (err) {
      const conflict = err instanceof ApiError && err.code === "CONFLICT";
      toast({
        title: conflict
          ? "다른 사용자가 먼저 수정했습니다"
          : "작업 삭제 실패",
        description:
          err instanceof ApiError && !conflict ? err.message : undefined,
        variant: "destructive",
      });
      if (conflict && workItemId) await loadDetail(workItemId);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl">
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
              onEdit={() => onEdit(detail)}
              onRequestDelete={() => setConfirmDelete(true)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>작업 삭제</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{detail?.title}</span>
              {" "}작업을 삭제하시겠습니까? (soft delete)
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DrawerBody({
  detail,
  onEdit,
  onRequestDelete,
}: {
  detail: WorkItemDetail;
  onEdit: () => void;
  onRequestDelete: () => void;
}) {
  return (
    <>
      <SheetHeader className="pr-12">
        <div className="flex items-center gap-2">
          <StatusBadge status={detail.status} />
          <span className="text-xs text-muted-foreground">
            {detail.category || "미분류"} · {PRIORITY_LABELS[detail.priority]}
          </span>
        </div>
        <SheetTitle className="text-xl">{detail.title}</SheetTitle>
      </SheetHeader>

      <div className="mt-4 flex gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          수정
        </Button>
        <Button variant="outline" size="sm" onClick={onRequestDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          삭제
        </Button>
      </div>

      <Tabs defaultValue="detail" className="mt-6 flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="detail">상세</TabsTrigger>
          <TabsTrigger value="activity">활동</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="detail">
            <DetailPanel detail={detail} />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityPanel workItemId={detail.id} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

function DetailPanel({ detail }: { detail: WorkItemDetail }) {
  const hasRequestInfo =
    detail.requestType || detail.requestor || detail.requestNumber || detail.requestContent;

  return (
    <div className="space-y-5">
      {/* 요청 정보 */}
      {hasRequestInfo && (
        <section className="rounded-md border bg-muted/30 p-3 space-y-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            요청 정보
          </p>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            {detail.requestType && (
              <Field label="요청구분">{detail.requestType}</Field>
            )}
            {detail.requestor && (
              <Field label="요청자">{detail.requestor}</Field>
            )}
            {detail.requestNumber && (
              <Field label="요청번호">{detail.requestNumber}</Field>
            )}
            {detail.requestContent && (
              <div className="col-span-3">
                <dt className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  요청내용
                </dt>
                <dd className="whitespace-pre-wrap text-sm">
                  {detail.requestContent}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* 메타데이터 */}
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
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
        <Field label="생성">{formatDateTime(detail.createdAt)}</Field>
        <Field label="수정">{formatDateTime(detail.updatedAt)}</Field>
      </dl>

      {/* 시스템 연동 */}
      {detail.tickets.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            시스템 연동
          </p>
          <ul className="space-y-1">
            {detail.tickets.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="font-medium shrink-0">{t.systemName}</span>
                <span className="text-muted-foreground">·</span>
                <span>{t.ticketNumber}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 설명 */}
      <section className="space-y-1.5">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          설명
        </p>
        <div className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
          {detail.description?.trim() || (
            <span className="text-muted-foreground">설명 없음</span>
          )}
        </div>
      </section>
    </div>
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
      <dt className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function ActivityPanel({ workItemId }: { workItemId: string }) {
  const [logs, setLogs] = React.useState<AuditLog[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLogs(null);
    setError(null);
    api
      .get<ListResponse<AuditLog>>("/api/audit-logs", {
        query: { entityType: "WorkItem", entityId: workItemId },
      })
      .then((res) => {
        if (!cancelled) setLogs(res.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "활동 로그 조회 실패");
      });
    return () => {
      cancelled = true;
    };
  }, [workItemId]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (logs === null) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>;
  }
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">기록된 활동이 없습니다.</p>;
  }

  return (
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
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-snug">
              {prettyJson(log.afterJson)}
            </pre>
          ) : null}
        </li>
      ))}
    </ol>
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
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-7 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-9 w-40 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
        <div className="h-3 w-4/6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
