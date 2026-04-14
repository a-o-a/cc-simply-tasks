"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MemberFilter } from "@/components/member-filter";
import { ApiError, api } from "@/lib/client/api";
import { fromDateInputValue, toDateInputValue } from "@/lib/client/format";
import { toast } from "@/lib/client/use-toast";
import type {
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

/**
 * 작업 생성/수정 다이얼로그.
 *
 * - editing이 null이면 생성, 있으면 수정
 * - 수정 시 `If-Match: editing.updatedAt` 자동 처리
 * - tickets 배열을 payload에 포함해 한 트랜잭션으로 sync
 */

type Props = {
  open: boolean;
  editing: WorkItemListItem | WorkItemDetail | null;
  members: Member[];
  categories: WorkCategory[];
  systems: WorkSystem[];
  onClose: () => void;
  /** 저장 완료. 수정 시 서버 응답(최신 updatedAt 포함)을 전달해 목록 즉시 갱신. */
  onSaved: (updated?: WorkItemListItem) => void;
};

interface TicketRow {
  systemName: string;
  ticketNumber: string;
}

interface FormState {
  title: string;
  description: string;
  category: string;
  status: Status;
  priority: Priority;
  assigneeId: string;
  startDate: string;
  endDate: string;
  transferDate: string;
  requestType: string;
  requestor: string;
  requestNumber: string;
  requestContent: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  category: "",
  status: "WAITING",
  priority: "NORMAL",
  assigneeId: "",
  startDate: "",
  endDate: "",
  transferDate: "",
  requestType: "",
  requestor: "",
  requestNumber: "",
  requestContent: "",
};

function fromWorkItem(w: WorkItemListItem | WorkItemDetail): FormState {
  return {
    title: w.title,
    description: w.description ?? "",
    category: w.category,
    status: w.status,
    priority: w.priority,
    assigneeId: w.assigneeId ?? "",
    startDate: toDateInputValue(w.startDate),
    endDate: toDateInputValue(w.endDate),
    transferDate: toDateInputValue(w.transferDate),
    requestType: w.requestType ?? "",
    requestor: w.requestor ?? "",
    requestNumber: w.requestNumber ?? "",
    requestContent: w.requestContent ?? "",
  };
}

function hasTickets(w: WorkItemListItem | WorkItemDetail): w is WorkItemDetail {
  return "tickets" in w;
}

export function WorkItemFormDialog({
  open,
  editing,
  members,
  categories,
  systems,
  onClose,
  onSaved,
}: Props) {
  const [state, setState] = React.useState<FormState>(EMPTY);
  const [tickets, setTickets] = React.useState<TicketRow[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  // If-Match 토큰을 별도 상태로 관리: CONFLICT 시 서버 응답의 serverUpdatedAt으로 갱신됨
  const [ifMatchToken, setIfMatchToken] = React.useState<string>("");

  // 수정 시 detail의 tickets를 가져오기 위해 필요하면 별도 fetch
  const [loadingTickets, setLoadingTickets] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (!editing) {
      setState(EMPTY);
      setTickets([]);
      setIfMatchToken("");
      return;
    }
    setState(fromWorkItem(editing));
    setIfMatchToken(editing.updatedAt);

    if (hasTickets(editing)) {
      // DrawerBody에서 넘겨준 경우 — tickets 포함
      setTickets(
        editing.tickets.map((t) => ({
          systemName: t.systemName,
          ticketNumber: t.ticketNumber,
        })),
      );
    } else {
      // 목록에서 직접 수정 클릭 — detail 별도 fetch
      setLoadingTickets(true);
      api
        .get<WorkItemDetail>(`/api/work-items/${editing.id}`)
        .then((detail) => {
          setTickets(
            detail.tickets.map((t) => ({
              systemName: t.systemName,
              ticketNumber: t.ticketNumber,
            })),
          );
        })
        .catch(() => {
          // tickets 로드 실패는 비치명적 — 빈 배열로 fallback
          setTickets([]);
        })
        .finally(() => setLoadingTickets(false));
    }
  }, [open, editing]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  // ─── 담당자 단일 선택 ─────────────────────────────────────
  const assigneeSet = React.useMemo(
    () => new Set(state.assigneeId ? [state.assigneeId] : []),
    [state.assigneeId],
  );

  // ─── 티켓 행 조작 ──────────────────────────────────────────
  function addTicketRow() {
    setTickets((prev) => [...prev, { systemName: "", ticketNumber: "" }]);
  }

  function removeTicketRow(index: number) {
    setTickets((prev) => prev.filter((_, i) => i !== index));
  }

  function updateTicketRow(index: number, field: keyof TicketRow, value: string) {
    setTickets((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  // 이미 선택된 시스템 목록 (다른 행에서 중복 방지)
  const usedSystems = React.useMemo(
    () => new Set(tickets.map((t) => t.systemName).filter(Boolean)),
    [tickets],
  );

  // 분류 목록: 수정 시 현재 선택된 분류를 상단에 배치
  const sortedCategories = React.useMemo(() => {
    if (!editing || !editing.category) return categories;
    const current = categories.find((c) => c.code === editing.category);
    if (!current) return categories;
    return [current, ...categories.filter((c) => c.code !== editing.category)];
  }, [categories, editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = state.title.trim();
    if (!title) return;

    if (state.startDate && state.endDate && state.startDate > state.endDate) {
      toast({
        title: "날짜를 확인해주세요",
        description: "종료일은 시작일 이후여야 합니다.",
        variant: "destructive",
      });
      return;
    }

    // 빈 행 필터링 (systemName 또는 ticketNumber가 비어있는 행 제외)
    const validTickets = tickets.filter(
      (t) => t.systemName.trim() && t.ticketNumber.trim(),
    );

    const payload = {
      title,
      description: state.description.trim() || null,
      category: state.category,
      status: state.status,
      priority: state.priority,
      assigneeId: state.assigneeId || null,
      startDate: fromDateInputValue(state.startDate),
      endDate: fromDateInputValue(state.endDate),
      transferDate: fromDateInputValue(state.transferDate),
      requestType: state.requestType.trim() || null,
      requestor: state.requestor.trim() || null,
      requestNumber: state.requestNumber.trim() || null,
      requestContent: state.requestContent.trim() || null,
      tickets: validTickets,
    };

    setSubmitting(true);
    try {
      if (editing) {
        const updated = await api.patch<WorkItemListItem>(
          `/api/work-items/${editing.id}`,
          payload,
          ifMatchToken,
        );
        toast({ title: "작업을 수정했습니다" });
        onSaved(updated);
      } else {
        await api.post("/api/work-items", payload);
        toast({ title: "작업을 추가했습니다" });
        onSaved();
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        // 서버가 응답한 최신 updatedAt으로 1회 자동 재시도 (사용자 입력 보존)
        const serverUpdatedAt = (err.details as { serverUpdatedAt?: string } | null)
          ?.serverUpdatedAt;
        if (serverUpdatedAt && editing) {
          try {
            const updated = await api.patch<WorkItemListItem>(
              `/api/work-items/${editing.id}`,
              payload,
              serverUpdatedAt,
            );
            setIfMatchToken(serverUpdatedAt);
            toast({ title: "작업을 수정했습니다" });
            onSaved(updated);
            return;
          } catch {
            // 재시도도 실패 — 아래 공통 에러 처리로 fall-through
          }
        }
        toast({
          title: "다른 사용자가 먼저 수정했습니다",
          description: "최신 정보를 다시 불러옵니다.",
          variant: "destructive",
        });
        onSaved();
        return;
      }
      toast({
        title: editing ? "작업 수정 실패" : "작업 추가 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editing ? "작업 수정" : "작업 추가"}</DialogTitle>
          <DialogDescription>
            제목과 일정/상태를 입력하세요. 생성 후에도 모든 항목을 변경할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto space-y-4 px-1 pb-1">
          {/* 분류 — 맨 위 단독 */}
          <div className="space-y-2">
            <Label htmlFor="wi-category">분류</Label>
            <Select
              id="wi-category"
              value={state.category}
              onChange={(e) => update("category", e.target.value)}
            >
              <option value="">미분류</option>
              {sortedCategories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          {/* 요청 정보 3열 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wi-req-type">요청구분</Label>
              <Input
                id="wi-req-type"
                value={state.requestType}
                onChange={(e) => update("requestType", e.target.value)}
                maxLength={200}
                placeholder="예: 신규개발"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wi-requestor">요청자</Label>
              <Input
                id="wi-requestor"
                value={state.requestor}
                onChange={(e) => update("requestor", e.target.value)}
                maxLength={200}
                placeholder="예: 홍길동"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wi-req-number">요청번호</Label>
              <Input
                id="wi-req-number"
                value={state.requestNumber}
                onChange={(e) => update("requestNumber", e.target.value)}
                maxLength={200}
                placeholder="예: REQ-2024-001"
              />
            </div>
          </div>

          {/* 요청내용 */}
          <div className="space-y-2">
            <Label htmlFor="wi-req-content">요청내용</Label>
            <Textarea
              id="wi-req-content"
              rows={3}
              value={state.requestContent}
              onChange={(e) => update("requestContent", e.target.value)}
              maxLength={10_000}
              placeholder="요청 배경, 세부 내용 등"
            />
          </div>

          {/* 제목 */}
          <div className="space-y-2">
            <Label htmlFor="wi-title">제목 *</Label>
            <Input
              id="wi-title"
              value={state.title}
              onChange={(e) => update("title", e.target.value)}
              maxLength={300}
              placeholder="예: 대시보드에 요약정보 표시 영역 추가"
            />
          </div>

          {/* 상태 / 우선순위 / 담당자 */}
          <div className="grid grid-cols-3 items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="wi-status">상태</Label>
              <Select
                id="wi-status"
                value={state.status}
                onChange={(e) => update("status", e.target.value as Status)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wi-priority">우선순위</Label>
              <Select
                id="wi-priority"
                value={state.priority}
                onChange={(e) => update("priority", e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2 self-end">
              <Label className="block">담당자</Label>
              <MemberFilter
                members={members}
                selectedIds={assigneeSet}
                onToggle={(id) => update("assigneeId", id)}
                onClear={() => update("assigneeId", "")}
                placeholder="미배정"
                mode="single"
                className="w-full justify-between"
              />
            </div>
          </div>

          {/* 시스템 연동 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>시스템 연동</Label>
              {systems.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addTicketRow}
                  disabled={tickets.length >= systems.length}
                  className="h-7 px-2 text-xs"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  추가
                </Button>
              )}
            </div>

            {systems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                설정 &gt; 코드관리에서 작업시스템을 먼저 추가하세요.
              </p>
            ) : loadingTickets ? (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            ) : tickets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                연동된 시스템이 없습니다.{" "}
                <button
                  type="button"
                  onClick={addTicketRow}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  추가
                </button>
              </p>
            ) : (
              <div className="space-y-2">
                {tickets.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select
                      value={row.systemName}
                      onChange={(e) =>
                        updateTicketRow(index, "systemName", e.target.value)
                      }
                      className="w-40 shrink-0"
                    >
                      <option value="">시스템 선택</option>
                      {systems.map((s) => (
                        <option
                          key={s.code}
                          value={s.code}
                          disabled={
                            usedSystems.has(s.code) && s.code !== row.systemName
                          }
                        >
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={row.ticketNumber}
                      onChange={(e) =>
                        updateTicketRow(index, "ticketNumber", e.target.value)
                      }
                      placeholder="작업번호"
                      maxLength={100}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTicketRow(index)}
                      className="h-9 w-9 shrink-0"
                      aria-label="행 삭제"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 일정 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wi-start">시작일</Label>
              <DatePicker
                id="wi-start"
                value={state.startDate}
                onChange={(v) => update("startDate", v)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wi-end">종료일</Label>
              <DatePicker
                id="wi-end"
                value={state.endDate}
                onChange={(v) => update("endDate", v)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wi-transfer">이관일</Label>
              <DatePicker
                id="wi-transfer"
                value={state.transferDate}
                onChange={(v) => update("transferDate", v)}
              />
            </div>
          </div>

          {/* 설명 */}
          <div className="space-y-2">
            <Label htmlFor="wi-desc">설명</Label>
            <Textarea
              id="wi-desc"
              rows={4}
              value={state.description}
              onChange={(e) => update("description", e.target.value)}
              maxLength={10_000}
              placeholder="작업 배경, 범위, 참고사항 등"
            />
          </div>

          </div>

          <DialogFooter className="shrink-0 border-t pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={submitting || !state.title.trim()}>
              {submitting ? "저장 중..." : editing ? "저장" : "추가"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
