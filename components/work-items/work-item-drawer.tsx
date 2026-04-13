"use client";

import * as React from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  WorkTicket,
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
 *  - 상세: 메타데이터(상태/담당자/기간/이관일/설명)
 *  - 티켓: 외부 시스템 티켓 추가/삭제
 *  - 활동: AuditLog 타임라인 (`/api/audit-logs?entityType=WorkItem&entityId=...`)
 *
 * 외부에서는 `workItemId`만 넘기고, 드로어 내부에서 GET /api/work-items/:id 로
 * 상세를 별도 fetch한다 (목록의 부분 데이터를 신뢰하지 않음).
 */

type Props = {
  workItemId: string | null;
  onClose: () => void;
  onEdit: (item: WorkItemDetail) => void;
  onDeleted: () => void;
  /** 상세에서 수정/삭제가 일어나면 부모 목록도 다시 불러오게 한다. */
  onMutated: () => void;
};

export function WorkItemDrawer({
  workItemId,
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
  }, [workItemId, loadDetail]);

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
              onTicketsChanged={() => {
                void loadDetail(detail.id);
                onMutated();
              }}
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
              {" "}작업을 삭제하시겠습니까? 연결된 티켓도 함께 숨겨집니다 (soft delete).
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
  onTicketsChanged,
}: {
  detail: WorkItemDetail;
  onEdit: () => void;
  onRequestDelete: () => void;
  onTicketsChanged: () => void;
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
          <TabsTrigger value="tickets">티켓 ({detail.tickets.length})</TabsTrigger>
          <TabsTrigger value="activity">활동</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="detail">
            <DetailPanel detail={detail} />
          </TabsContent>
          <TabsContent value="tickets">
            <TicketsPanel detail={detail} onChanged={onTicketsChanged} />
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
  return (
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

      <div className="col-span-3">
        <dt className="mb-1 text-xs font-medium uppercase text-muted-foreground">
          설명
        </dt>
        <dd className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
          {detail.description?.trim() || (
            <span className="text-muted-foreground">설명 없음</span>
          )}
        </dd>
      </div>
    </dl>
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

function TicketsPanel({
  detail,
  onChanged,
}: {
  detail: WorkItemDetail;
  onChanged: () => void;
}) {
  const [systemName, setSystemName] = React.useState("");
  const [ticketNumber, setTicketNumber] = React.useState("");
  const [ticketUrl, setTicketUrl] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function addTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!systemName.trim() || !ticketNumber.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/work-items/${detail.id}/tickets`, {
        systemName: systemName.trim(),
        ticketNumber: ticketNumber.trim(),
        ticketUrl: ticketUrl.trim() || null,
      });
      toast({ title: "티켓을 추가했습니다" });
      setSystemName("");
      setTicketNumber("");
      setTicketUrl("");
      onChanged();
    } catch (err) {
      const conflict = err instanceof ApiError && err.code === "CONFLICT";
      toast({
        title: conflict ? "이미 등록된 티켓입니다" : "티켓 추가 실패",
        description:
          !conflict && err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteTicket(t: WorkTicket) {
    try {
      await api.delete(
        `/api/work-items/${detail.id}/tickets/${t.id}`,
        t.updatedAt,
      );
      toast({ title: "티켓을 삭제했습니다" });
      onChanged();
    } catch (err) {
      toast({
        title: "티켓 삭제 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      {detail.tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          연결된 외부 티켓이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {detail.tickets.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {t.systemName} · {t.ticketNumber}
                </div>
                {t.ticketUrl ? (
                  <a
                    href={t.ticketUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate">{t.ticketUrl}</span>
                  </a>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="티켓 삭제"
                onClick={() => deleteTicket(t)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={addTicket}
        className="space-y-3 rounded-md border bg-muted/30 p-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="t-sys" className="text-xs">시스템</Label>
            <Input
              id="t-sys"
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              placeholder="Jira"
              maxLength={50}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-num" className="text-xs">티켓 번호</Label>
            <Input
              id="t-num"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              placeholder="ABC-1234"
              maxLength={100}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-url" className="text-xs">URL (선택)</Label>
          <Input
            id="t-url"
            type="url"
            value={ticketUrl}
            onChange={(e) => setTicketUrl(e.target.value)}
            placeholder="https://..."
            maxLength={1000}
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={
              submitting || !systemName.trim() || !ticketNumber.trim()
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            {submitting ? "추가 중..." : "티켓 추가"}
          </Button>
        </div>
      </form>
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
