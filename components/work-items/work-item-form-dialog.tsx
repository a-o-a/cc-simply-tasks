"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/client/api";
import { fromDateInputValue, toDateInputValue } from "@/lib/client/format";
import { toast } from "@/lib/client/use-toast";
import type { Member, WorkItemListItem } from "@/lib/client/types";
import {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  type Category,
  type Priority,
  type Status,
} from "@/lib/enums";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "@/lib/enum-labels";

/**
 * 작업 생성/수정 다이얼로그.
 *
 * - editing이 null이면 생성, 있으면 수정
 * - 수정 시 `If-Match: editing.updatedAt` 자동 처리
 * - 날짜 필드는 KST 자정 → UTC ISO로 직렬화 (`fromDateInputValue`)
 *
 * 1차 범위에서는 reorder/order는 다루지 않음 (모든 신규 0, 추후 Step 4 후속).
 */

type Props = {
  open: boolean;
  editing: WorkItemListItem | null;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
};

interface FormState {
  title: string;
  description: string;
  category: Category;
  status: Status;
  priority: Priority;
  assigneeId: string;
  startDate: string;
  endDate: string;
  transferDate: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  category: "ETC",
  status: "DRAFT",
  priority: "NORMAL",
  assigneeId: "",
  startDate: "",
  endDate: "",
  transferDate: "",
};

function fromWorkItem(w: WorkItemListItem): FormState {
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
  };
}

export function WorkItemFormDialog({
  open,
  editing,
  members,
  onClose,
  onSaved,
}: Props) {
  const [state, setState] = React.useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setState(editing ? fromWorkItem(editing) : EMPTY);
  }, [open, editing]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = state.title.trim();
    if (!title) return;

    // 클라이언트에서도 날짜 정합성 한 번 (서버에서 zod refine으로 다시 검증)
    if (state.startDate && state.endDate && state.startDate > state.endDate) {
      toast({
        title: "날짜를 확인해주세요",
        description: "종료일은 시작일 이후여야 합니다.",
        variant: "destructive",
      });
      return;
    }

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
    };

    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(
          `/api/work-items/${editing.id}`,
          payload,
          editing.updatedAt,
        );
        toast({ title: "작업을 수정했습니다" });
      } else {
        await api.post("/api/work-items", payload);
        toast({ title: "작업을 추가했습니다" });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        toast({
          title: "다른 사용자가 먼저 수정했습니다",
          description: "최신 정보를 다시 불러옵니다.",
          variant: "destructive",
        });
        onSaved(); // 충돌해도 목록은 새로고침
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "작업 수정" : "작업 추가"}</DialogTitle>
          <DialogDescription>
            제목과 일정/상태를 입력하세요. 생성 후에도 모든 항목을 변경할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wi-title">제목</Label>
            <Input
              id="wi-title"
              autoFocus
              value={state.title}
              onChange={(e) => update("title", e.target.value)}
              maxLength={300}
              placeholder="예: 결제 모듈 PG사 추가"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
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
            <div className="space-y-2">
              <Label htmlFor="wi-category">분류</Label>
              <Select
                id="wi-category"
                value={state.category}
                onChange={(e) => update("category", e.target.value as Category)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wi-assignee">담당자</Label>
            <Select
              id="wi-assignee"
              value={state.assigneeId}
              onChange={(e) => update("assigneeId", e.target.value)}
            >
              <option value="">미배정</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wi-start">시작일</Label>
              <Input
                id="wi-start"
                type="date"
                value={state.startDate}
                onChange={(e) => update("startDate", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wi-end">종료일</Label>
              <Input
                id="wi-end"
                type="date"
                value={state.endDate}
                onChange={(e) => update("endDate", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wi-transfer">이관일</Label>
              <Input
                id="wi-transfer"
                type="date"
                value={state.transferDate}
                onChange={(e) => update("transferDate", e.target.value)}
              />
            </div>
          </div>

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

          <DialogFooter>
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
