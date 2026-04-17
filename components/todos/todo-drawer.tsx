"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MemberFilter } from "@/components/member-filter";
import { ApiError, api, emitTodosChanged } from "@/lib/client/api";
import {
  fromDateInputValue,
  toDateInputValue,
} from "@/lib/client/format";
import { toast } from "@/lib/client/use-toast";
import type {
  Member,
  TodoChecklistItem,
  TodoItem,
} from "@/lib/client/types";
import { TODO_STATUSES, type TodoStatus } from "@/lib/enums";
import { TODO_STATUS_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";

/**
 * TodoDrawer — 생성/수정 통합 드로어.
 *
 * - `mode="create"`: 저장 시 POST (부모+자식 batch), 저장 완료 후 edit 모드로 전환
 * - `mode="edit"`:   모든 편집이 debounce 500ms 후 PATCH (자동 저장)
 *
 * 체크리스트는 mode에 따라 다르게 동작:
 *   create — 로컬 state에만 누적, 최종 저장 시 batch POST
 *   edit   — 각 변경 즉시 개별 PATCH/POST/DELETE
 */

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  todoId: string | null;
  members: Member[];
  open: boolean;
  onClose: () => void;
  onMutated: () => void;
}

interface DraftChecklistItem {
  id: string; // 로컬/서버 ID
  content: string;
  done: boolean;
  assigneeId: string | null;
  _isNew?: boolean; // 로컬 생성분
}

type DraftSnapshot = {
  title: string;
  note: string;
  status: TodoStatus;
  assigneeId: string | null;
  dueDate: string;
  checklist: DraftChecklistItem[];
};

function createDraftChecklistItem(): DraftChecklistItem {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content: "",
    done: false,
    assigneeId: null,
    _isNew: true,
  };
}

function sanitizeChecklistDraft(items: DraftChecklistItem[]): DraftChecklistItem[] {
  return items.map((item) => ({
    ...item,
    content: item.content.trim(),
  }));
}

export function TodoDrawer({
  mode,
  todoId,
  members,
  open,
  onClose,
  onMutated,
}: Props) {
  const [detail, setDetail] = React.useState<TodoItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  // 로컬 드래프트
  const [title, setTitle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [status, setStatus] = React.useState<TodoStatus>("OPEN");
  const [assigneeId, setAssigneeId] = React.useState<string | null>(null);
  const [dueDate, setDueDate] = React.useState<string>(""); // yyyy-mm-dd
  const [checklist, setChecklist] = React.useState<DraftChecklistItem[]>([]);

  const checklistInputRefs = React.useRef(new Map<string, HTMLInputElement | null>());
  const [pendingFocusChecklistId, setPendingFocusChecklistId] = React.useState<string | null>(null);
  const originalSnapshotRef = React.useRef<DraftSnapshot | null>(null);

  const buildSnapshot = React.useCallback((): DraftSnapshot => ({
    title,
    note,
    status,
    assigneeId,
    dueDate,
    checklist: checklist.map((item) => ({
      id: item.id,
      content: item.content,
      done: item.done,
      assigneeId: item.assigneeId,
      _isNew: item._isNew,
    })),
  }), [title, note, status, assigneeId, dueDate, checklist]);

  const isDirty = React.useMemo(() => {
    if (mode === "create") {
      return Boolean(
        title.trim() ||
        note.trim() ||
        assigneeId ||
        dueDate ||
        status !== "OPEN" ||
        checklist.length > 0,
      );
    }
    const original = originalSnapshotRef.current;
    if (!original) return false;
    return JSON.stringify(buildSnapshot()) !== JSON.stringify(original);
  }, [mode, title, note, status, assigneeId, dueDate, checklist, buildSnapshot]);

  // open / mode / todoId 변화 시 상태 초기화
  React.useEffect(() => {
    if (!open) return;
    setConfirmCloseOpen(false);
    setConfirmDeleteOpen(false);
    if (mode === "create") {
      setDetail(null);
      setTitle("");
      setNote("");
      setStatus("OPEN");
      setAssigneeId(null);
      setDueDate("");
      setChecklist([]);
      originalSnapshotRef.current = {
        title: "",
        note: "",
        status: "OPEN",
        assigneeId: null,
        dueDate: "",
        checklist: [],
      };
      return;
    }
    if (todoId) {
      setLoading(true);
      api
        .get<TodoItem>(`/api/todos/${todoId}`)
        .then((data) => {
          const nextChecklist = (data.checklist ?? []).map((c) => ({
            id: c.id,
            content: c.content,
            done: c.done,
            assigneeId: c.assigneeId,
          }));
          setDetail(data);
          setTitle(data.title);
          setNote(data.note ?? "");
          setStatus(data.status);
          setAssigneeId(data.assigneeId);
          setDueDate(data.dueDate ? toDateInputValue(data.dueDate) : "");
          setChecklist(nextChecklist);
          originalSnapshotRef.current = {
            title: data.title,
            note: data.note ?? "",
            status: data.status,
            assigneeId: data.assigneeId,
            dueDate: data.dueDate ? toDateInputValue(data.dueDate) : "",
            checklist: nextChecklist,
          };
        })
        .catch((err) => {
          toast({
            title: "TODO 조회 실패",
            description: err instanceof ApiError ? err.message : undefined,
            variant: "destructive",
          });
          onClose();
        })
        .finally(() => setLoading(false));
    }
  }, [open, mode, todoId, onClose]);

  async function changeStatus(newStatus: TodoStatus) {
    setStatus(newStatus);
  }

  async function syncChecklist(todoId: string) {
    const trimmedChecklist = sanitizeChecklistDraft(checklist);

    const originalChecklist = originalSnapshotRef.current?.checklist ?? [];
    const originalById = new Map(originalChecklist.map((item) => [item.id, item]));
    const nextIds = new Set(trimmedChecklist.map((item) => item.id));

    for (const originalItem of originalChecklist) {
      if (!nextIds.has(originalItem.id)) {
        await api.delete(`/api/todos/${todoId}/checklist/${originalItem.id}`);
      }
    }

    for (let index = 0; index < trimmedChecklist.length; index += 1) {
      const item = trimmedChecklist[index];
      const originalItem = originalById.get(item.id);
      if (!originalItem || item._isNew) {
        await api.post<TodoChecklistItem>(`/api/todos/${todoId}/checklist`, {
          content: item.content,
          done: item.done,
          order: index,
          assigneeId: item.assigneeId,
        });
        continue;
      }

      const patch: {
        content?: string;
        done?: boolean;
        order?: number;
        assigneeId?: string | null;
      } = {};

      if (originalItem.content !== item.content) patch.content = item.content;
      if (originalItem.done !== item.done) patch.done = item.done;
      if ((originalItem.assigneeId ?? null) !== (item.assigneeId ?? null)) {
        patch.assigneeId = item.assigneeId;
      }
      const originalIndex = originalChecklist.findIndex((candidate) => candidate.id === item.id);
      if (originalIndex !== index) patch.order = index;

      if (Object.keys(patch).length > 0) {
        await api.patch(`/api/todos/${todoId}/checklist/${item.id}`, patch);
      }
    }

    return true;
  }

  async function saveDraft(options?: { closeAfterSave?: boolean }) {
    if (saving) return false;
    if (!title.trim()) {
      toast({ title: "제목을 입력하세요", variant: "destructive" });
      return false;
    }

    const payload = {
      title,
      note: note || null,
      status,
      assigneeId,
      dueDate: dueDate ? fromDateInputValue(dueDate) : null,
    };
    const normalizedChecklist = sanitizeChecklistDraft(checklist);
    if (normalizedChecklist.some((item) => item.content.length === 0)) {
      toast({
        title: "빈 체크리스트 항목이 있습니다",
        description: "내용을 입력하거나 빈 항목을 삭제한 뒤 저장하세요.",
        variant: "destructive",
      });
      return false;
    }

    try {
      setSaving(true);
      if (mode === "create") {
        await api.post<TodoItem>("/api/todos", {
          ...payload,
          checklist: normalizedChecklist.map((item, idx) => ({
            content: item.content,
            done: item.done,
            order: idx,
            assigneeId: item.assigneeId,
          })),
        });
      } else if (detail) {
        await api.patch<TodoItem>(`/api/todos/${detail.id}`, payload);
        setChecklist(normalizedChecklist);
        const synced = await syncChecklist(detail.id);
        if (!synced) return false;
      }

      onMutated();
      emitTodosChanged();
      toast({ title: mode === "create" ? "TODO 생성됨" : "저장됨" });

      if (options?.closeAfterSave) {
        onClose();
      } else if (mode === "edit" && detail) {
        const fresh = await api.get<TodoItem>(`/api/todos/${detail.id}`);
        const nextChecklist = (fresh.checklist ?? []).map((c) => ({
          id: c.id,
          content: c.content,
          done: c.done,
          assigneeId: c.assigneeId,
        }));
        setDetail(fresh);
        setTitle(fresh.title);
        setNote(fresh.note ?? "");
        setStatus(fresh.status);
        setAssigneeId(fresh.assigneeId);
        setDueDate(fresh.dueDate ? toDateInputValue(fresh.dueDate) : "");
        setChecklist(nextChecklist);
        originalSnapshotRef.current = {
          title: fresh.title,
          note: fresh.note ?? "",
          status: fresh.status,
          assigneeId: fresh.assigneeId,
          dueDate: fresh.dueDate ? toDateInputValue(fresh.dueDate) : "",
          checklist: nextChecklist,
        };
      } else if (mode === "create") {
        onClose();
      }

      return true;
    } catch (err) {
      toast({
        title: mode === "create" ? "생성 실패" : "저장 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function handleRequestClose() {
    if (saving) return;
    if (isDirty) {
      setConfirmCloseOpen(true);
      return;
    }
    onClose();
  }

  async function handleConfirmSaveAndClose() {
    const saved = await saveDraft({ closeAfterSave: true });
    if (saved) {
      setConfirmCloseOpen(false);
    }
  }

  async function handleCreate() {
    await saveDraft({ closeAfterSave: true });
  }

  async function handleDelete() {
    if (!detail) return;
    try {
      await api.delete(`/api/todos/${detail.id}`);
      onMutated();
      emitTodosChanged();
      setConfirmDeleteOpen(false);
      onClose();
      toast({ title: "TODO 삭제됨" });
    } catch (err) {
      toast({
        title: "삭제 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  // ─────── 체크리스트 핸들러 ───────
  function addChecklistItem() {
    const nextItem = createDraftChecklistItem();
    setChecklist((prev) => [...prev, nextItem]);
    setPendingFocusChecklistId(nextItem.id);
  }

  function addChecklistItemAfter(afterId: string) {
    const nextItem = createDraftChecklistItem();
    setChecklist((prev) => {
      const index = prev.findIndex((item) => item.id === afterId);
      if (index === -1) return [...prev, nextItem];
      const next = prev.slice();
      next.splice(index + 1, 0, nextItem);
      return next;
    });
    setPendingFocusChecklistId(nextItem.id);
  }

  async function saveNewChecklistItem(localId: string, content: string) {
    const trimmed = content.trim();
    setChecklist((prev) =>
      prev.map((c) =>
        c.id === localId
          ? { ...c, content: trimmed }
          : c,
      ),
    );
  }

  async function updateChecklistItem(
    id: string,
    patch: Partial<DraftChecklistItem>,
  ) {
    setChecklist((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  async function removeChecklistItem(id: string) {
    setChecklist((prev) => prev.filter((c) => c.id !== id));
  }

  React.useEffect(() => {
    if (!pendingFocusChecklistId) return;
    const node = checklistInputRefs.current.get(pendingFocusChecklistId);
    if (!node) return;
    node.focus();
    setPendingFocusChecklistId(null);
  }, [checklist, pendingFocusChecklistId]);

  return (
    <>
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleRequestClose(); }}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle>
            {mode === "create" ? "새 TODO" : detail?.title || "TODO"}
          </SheetTitle>
        </SheetHeader>
        <div
          className={cn(
            "flex-1 space-y-4 overflow-y-auto p-4",
            loading && "pointer-events-none opacity-60",
          )}
        >
          <div className="space-y-1.5">
            <Label htmlFor="todo-title">제목</Label>
            <Input
              id="todo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 4/25 회식 참석 확인"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="min-w-0 space-y-1.5">
              <Label>상태</Label>
              <Select
                value={status}
                onChange={(e) => void changeStatus(e.target.value as TodoStatus)}
              >
                {TODO_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TODO_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label>담당자</Label>
              <div>
                <MemberFilter
                  members={members}
                  selectedIds={new Set(assigneeId ? [assigneeId] : [])}
                  onToggle={(id) => setAssigneeId(id)}
                  onClear={() => setAssigneeId(null)}
                  mode="single"
                  placeholder="지정 안 함"
                />
              </div>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label>마감일</Label>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                placeholder="날짜 선택"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="todo-note">메모</Label>
            <Textarea
              id="todo-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="선택 사항"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>체크리스트</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addChecklistItem}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                항목 추가
              </Button>
            </div>
            {checklist.length === 0 ? (
              <p className="rounded border border-dashed py-6 text-center text-xs text-muted-foreground">
                아직 항목이 없습니다
              </p>
            ) : (
              <ul className="space-y-1.5">
                {checklist.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded border bg-background p-2"
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(e) =>
                        updateChecklistItem(item.id, { done: e.target.checked })
                      }
                      className="h-4 w-4 cursor-pointer rounded border-input"
                    />
                    <Input
                      ref={(node) => {
                        checklistInputRefs.current.set(item.id, node);
                      }}
                      value={item.content}
                      onChange={(e) =>
                        setChecklist((prev) =>
                          prev.map((c) =>
                            c.id === item.id
                              ? { ...c, content: e.target.value }
                              : c,
                          ),
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
                          return;
                        }
                        e.preventDefault();
                        addChecklistItemAfter(item.id);
                      }}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (item._isNew) {
                          void saveNewChecklistItem(item.id, val);
                        } else {
                          void updateChecklistItem(item.id, { content: val });
                        }
                      }}
                      placeholder="항목 내용"
                      className={cn(
                        "h-8 flex-1 text-sm",
                        item.done && "text-muted-foreground line-through",
                      )}
                    />
                    <MemberFilter
                      members={members}
                      selectedIds={new Set(item.assigneeId ? [item.assigneeId] : [])}
                      onToggle={(id) =>
                        void updateChecklistItem(item.id, { assigneeId: id })
                      }
                      onClear={() =>
                        void updateChecklistItem(item.id, { assigneeId: null })
                      }
                      mode="single"
                      placeholder="담당 없음"
                      className="h-8 w-32 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeChecklistItem(item.id)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      aria-label="항목 삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-card p-3">
          {mode === "edit" && detail ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={saving}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                삭제
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={handleRequestClose} disabled={saving}>
                  취소
                </Button>
                <Button type="button" onClick={() => void saveDraft()} disabled={saving || !isDirty}>
                  {saving ? "저장 중..." : "저장"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={handleRequestClose} disabled={saving}>
                취소
              </Button>
              <Button type="button" onClick={() => void handleCreate()} disabled={saving}>
                {saving ? "생성 중..." : "생성"}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>변경사항이 저장되지 않았습니다</DialogTitle>
            <DialogDescription>
              저장 후 닫을지, 변경을 버리고 닫을지 선택하세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmCloseOpen(false)}
              disabled={saving}
            >
              계속 편집
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmCloseOpen(false);
                onClose();
              }}
              disabled={saving}
            >
              변경 버리기
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmSaveAndClose()}
              disabled={saving}
            >
              {saving ? "저장 중..." : "저장 후 닫기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이 TODO를 삭제하시겠습니까?</DialogTitle>
            <DialogDescription>
              TODO와 연결된 체크리스트 항목도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={saving}
            >
              {saving ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
