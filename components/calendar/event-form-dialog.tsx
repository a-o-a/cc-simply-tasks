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
import { DatePicker, DateTimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/client/api";
import {
  kstDateStringToUtcMs,
  utcMsToKstDateString,
} from "@/lib/client/calendar";
import { toast } from "@/lib/client/use-toast";
import type { CalendarEvent, CalendarEventCategory, Member } from "@/lib/client/types";
import { MemberFilter } from "@/components/member-filter";

/**
 * 캘린더 이벤트 생성/수정 다이얼로그.
 *
 * 1차 범위는 all-day 위주의 단순 폼:
 *  - 제목, 담당자(선택), 시작/종료(KST 날짜), 종일 여부, 메모
 *  - 종일이면 [start KST 자정, (end+1) KST 자정) 으로 직렬화
 *  - 시간 단위 이벤트는 startDateTime/endDateTime을 datetime-local로 입력
 *
 * 삭제는 별도 버튼.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type Props = {
  open: boolean;
  /** 편집 중 이벤트. null이면 생성 모드. */
  editing: CalendarEvent | null;
  /** 생성 모드에서 미리 채울 KST 날짜(yyyy-mm-dd). */
  defaultDate?: string;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

const CATEGORY_OPTIONS: { value: CalendarEventCategory; label: string }[] = [
  { value: "HOLIDAY", label: "휴일" },
  { value: "WORK", label: "업무" },
  { value: "ABSENCE", label: "부재" },
  { value: "ETC", label: "기타" },
];

interface FormState {
  title: string;
  memberIds: string[];
  category: CalendarEventCategory;
  allDay: boolean;
  // all-day 시: yyyy-mm-dd
  startDate: string;
  endDate: string;
  // 시간 단위: datetime-local 값
  startDateTime: string;
  endDateTime: string;
  note: string;
}

function emptyState(defaultDate?: string): FormState {
  const today = defaultDate ?? new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
  return {
    title: "",
    memberIds: [],
    category: "ETC" as CalendarEventCategory,
    allDay: true,
    startDate: today,
    endDate: today,
    startDateTime: `${today}T09:00`,
    endDateTime: `${today}T10:00`,
    note: "",
  };
}

function fromEvent(event: CalendarEvent): FormState {
  if (event.allDay) {
    const startDate = utcMsToKstDateString(
      new Date(event.startDateTime).getTime(),
    );
    // end는 반열림이라 -1ms로 마지막 포함 일을 구함
    const endDate = utcMsToKstDateString(
      new Date(event.endDateTime).getTime() - 1,
    );
    return {
      title: event.title,
      memberIds: event.members.map((m) => m.member.id),
      category: event.category,
      allDay: true,
      startDate,
      endDate,
      startDateTime: `${startDate}T09:00`,
      endDateTime: `${endDate}T10:00`,
      note: event.note ?? "",
    };
  }
  return {
    title: event.title,
    memberIds: event.members.map((m) => m.member.id),
    category: event.category,
    allDay: false,
    startDate: utcMsToKstDateString(new Date(event.startDateTime).getTime()),
    endDate: utcMsToKstDateString(new Date(event.endDateTime).getTime()),
    startDateTime: toLocalInput(event.startDateTime),
    endDateTime: toLocalInput(event.endDateTime),
    note: event.note ?? "",
  };
}

function toLocalInput(iso: string): string {
  // datetime-local의 표시도 KST 기준
  const d = new Date(iso);
  const ymd = d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const hm = d
    .toLocaleTimeString("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${ymd}T${hm}`;
}

function fromLocalInput(value: string): string {
  // value: yyyy-mm-ddTHH:mm — KST로 해석해 ISO(UTC)로
  return new Date(`${value}:00+09:00`).toISOString();
}

export function EventFormDialog({
  open,
  editing,
  defaultDate,
  members,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const [state, setState] = React.useState<FormState>(emptyState());
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setState(editing ? fromEvent(editing) : emptyState(defaultDate));
  }, [open, editing, defaultDate]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function buildPayload() {
    if (state.allDay) {
      if (!state.startDate || !state.endDate) {
        throw new Error("시작/종료 날짜를 입력해주세요");
      }
      if (state.startDate > state.endDate) {
        throw new Error("종료일은 시작일 이후여야 합니다");
      }
      const startMs = kstDateStringToUtcMs(state.startDate);
      // 종료일을 포함하기 위해 +1일 → 반열림
      const endMs = kstDateStringToUtcMs(state.endDate) + DAY_MS;
      return {
        startDateTime: new Date(startMs).toISOString(),
        endDateTime: new Date(endMs).toISOString(),
        allDay: true,
      };
    }
    if (!state.startDateTime || !state.endDateTime) {
      throw new Error("시작/종료 시각을 입력해주세요");
    }
    return {
      startDateTime: fromLocalInput(state.startDateTime),
      endDateTime: fromLocalInput(state.endDateTime),
      allDay: false,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = state.title.trim();
    if (!title) return;

    let datePayload;
    try {
      datePayload = buildPayload();
    } catch (err) {
      toast({
        title: "입력값 확인",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      return;
    }
    if (
      new Date(datePayload.endDateTime).getTime() <=
      new Date(datePayload.startDateTime).getTime()
    ) {
      toast({
        title: "종료가 시작 이후여야 합니다",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      title,
      memberIds: state.memberIds,
      category: state.category,
      note: state.note.trim() || null,
      ...datePayload,
    };

    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(
          `/api/calendar-events/${editing.id}`,
          payload
        );
        toast({ title: "이벤트를 수정했습니다" });
      } else {
        await api.post("/api/calendar-events", payload);
        toast({ title: "이벤트를 추가했습니다" });
      }
      onSaved();
    } catch (err) {
      toast({
        title: editing
          ? "수정 실패"
          : "추가 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    try {
      await api.delete(
        `/api/calendar-events/${editing.id}`
      );
      toast({ title: "이벤트를 삭제했습니다" });
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      toast({
        title: "삭제 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "이벤트 수정" : "이벤트 추가"}
            </DialogTitle>
            <DialogDescription>
              팀원의 일정을 캘린더에 표시합니다. (KST)
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ce-category">카테고리</Label>
              <Select
                id="ce-category"
                value={state.category}
                onChange={(e) => update("category", e.target.value as CalendarEventCategory)}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ce-title">제목</Label>
              <Input
                id="ce-title"
                autoFocus
                value={state.title}
                onChange={(e) => update("title", e.target.value)}
                maxLength={300}
                placeholder="예: 대시보드에 요약정보 표시 영역 추가"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>담당자</Label>
              <MemberFilter
                members={members}
                selectedIds={new Set(state.memberIds)}
                onToggle={(id) => {
                  const next = state.memberIds.includes(id)
                    ? state.memberIds.filter((i) => i !== id)
                    : [...state.memberIds, id];
                  update("memberIds", next);
                }}
                onClear={() => update("memberIds", [])}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.allDay}
                onChange={(e) => update("allDay", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              종일 일정
            </label>

            {state.allDay ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ce-start-date">시작일</Label>
                  <DatePicker
                    id="ce-start-date"
                    value={state.startDate}
                    onChange={(v) => update("startDate", v)}
                    clearable={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-end-date">종료일</Label>
                  <DatePicker
                    id="ce-end-date"
                    value={state.endDate}
                    onChange={(v) => update("endDate", v)}
                    clearable={false}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ce-start-dt">시작 시각</Label>
                  <DateTimePicker
                    id="ce-start-dt"
                    value={state.startDateTime}
                    onChange={(v) => update("startDateTime", v)}
                    clearable={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-end-dt">종료 시각</Label>
                  <DateTimePicker
                    id="ce-end-dt"
                    value={state.endDateTime}
                    onChange={(v) => update("endDateTime", v)}
                    clearable={false}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ce-note">메모</Label>
              <Textarea
                id="ce-note"
                rows={3}
                value={state.note}
                onChange={(e) => update("note", e.target.value)}
                maxLength={2000}
              />
            </div>

            <DialogFooter className="sm:justify-between">
              <div>
                {editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmDelete(true)}
                  >
                    삭제
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  취소
                </Button>
                <Button type="submit" disabled={submitting || !state.title.trim()}>
                  {submitting ? "저장 중..." : editing ? "저장" : "추가"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이벤트 삭제</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{editing?.title}</span>
              {" "}이벤트를 삭제하시겠습니까?
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
