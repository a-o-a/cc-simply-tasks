"use client";

import * as React from "react";
import { Pencil, Plus, Trash2, Users as UsersIcon } from "lucide-react";
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
import { ApiError, api } from "@/lib/client/api";
import { toast } from "@/lib/client/use-toast";
import { formatDate } from "@/lib/client/format";
import { MEMBER_ROLES, type MemberRole } from "@/lib/enums";
import { MEMBER_ROLE_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";

/**
 * 팀원 목록/생성/수정/삭제 클라이언트.
 *
 * Phase 4 Step 3 — 가장 단순한 모델로 list/create/edit/delete + 낙관적 락 +
 * 토스트 패턴을 검증한다. 이 페이지에서 정착시킨 패턴을 다른 페이지가 답습한다.
 *
 * - GET /api/team-members (cursor 페이지네이션이지만 1차는 첫 페이지만)
 * - POST /api/team-members
 * - PATCH /api/team-members/:id (If-Match: updatedAt)
 * - DELETE /api/team-members/:id (If-Match: updatedAt)
 *
 * 낙관적 락 충돌(409)이 나면 최신 데이터를 다시 불러오라는 토스트만 띄우고
 * 자동 reload (간단). 더 정교한 머지 UI는 작업/티켓 단계에서 다룰 예정.
 */

type Member = {
  id: string;
  name: string;
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { items: Member[]; nextCursor: string | null };

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; member: Member }
  | { mode: "delete"; member: Member };

export function MembersClient() {
  const [items, setItems] = React.useState<Member[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<DialogState>({ mode: "closed" });

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>("/api/team-members");
      setItems(res.items);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "목록 조회 실패";
      setError(message);
      toast({ title: "목록 조회 실패", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          팀원 정보를 관리합니다. 작업/캘린더의 담당자로 사용됩니다.
        </p>
        <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
          <Plus className="mr-2 h-4 w-4" />
          팀원 추가
        </Button>
      </div>

      <section className="rounded-lg border bg-card">
        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <EmptyState
            icon={<UsersIcon className="h-8 w-8 text-muted-foreground" />}
            title="목록을 불러오지 못했습니다"
            description={error}
            action={
              <Button variant="outline" onClick={() => void load()}>
                다시 시도
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="h-8 w-8 text-muted-foreground" />}
            title="등록된 팀원이 없습니다"
            description="첫 팀원을 추가해 작업 담당자로 지정해보세요."
            action={
              <Button onClick={() => setDialog({ mode: "create" })}>
                <Plus className="mr-2 h-4 w-4" />
                팀원 추가
              </Button>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">이름</th>
                <th className="px-4 py-3 font-medium">역할</th>
                <th className="px-4 py-3 font-medium">생성</th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {MEMBER_ROLE_LABELS[m.role]}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(m.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="수정"
                        onClick={() => setDialog({ mode: "edit", member: m })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        aria-label="삭제"
                        onClick={() => setDialog({ mode: "delete", member: m })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <MemberFormDialog
        state={dialog}
        onClose={() => setDialog({ mode: "closed" })}
        onSaved={() => {
          setDialog({ mode: "closed" });
          void load();
        }}
      />
      <DeleteMemberDialog
        state={dialog}
        onClose={() => setDialog({ mode: "closed" })}
        onDeleted={() => {
          setDialog({ mode: "closed" });
          void load();
        }}
      />
    </div>
  );
}

function MemberFormDialog({
  state,
  onClose,
  onSaved,
}: {
  state: DialogState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = state.mode === "create" || state.mode === "edit";
  const editing = state.mode === "edit" ? state.member : null;

  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<MemberRole>("WEB_DEV");
  const [submitting, setSubmitting] = React.useState(false);

  // 다이얼로그가 열릴 때마다 초기값 세팅
  React.useEffect(() => {
    if (state.mode === "edit") {
      setName(state.member.name);
      setRole(state.member.role);
    } else if (state.mode === "create") {
      setName("");
      setRole("WEB_DEV");
    }
  }, [state]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(
          `/api/team-members/${editing.id}`,
          { name: trimmed, role }
        );
        toast({ title: "팀원을 수정했습니다" });
      } else {
        await api.post("/api/team-members", { name: trimmed, role });
        toast({ title: "팀원을 추가했습니다" });
      }
      onSaved();
    } catch (err) {
      handleApiError(err, editing ? "팀원 수정 실패" : "팀원 추가 실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "팀원 수정" : "팀원 추가"}</DialogTitle>
          <DialogDescription>
            팀원의 표시 이름과 주 담당 역할을 입력하세요. 역할은 추후 변경 가능합니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="member-name">이름</Label>
            <Input
              id="member-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder=""
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-role">역할</Label>
            <Select
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
            >
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {MEMBER_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "저장 중..." : editing ? "저장" : "추가"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteMemberDialog({
  state,
  onClose,
  onDeleted,
}: {
  state: DialogState;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const open = state.mode === "delete";
  const member = state.mode === "delete" ? state.member : null;
  const [submitting, setSubmitting] = React.useState(false);

  async function handleDelete() {
    if (!member) return;
    setSubmitting(true);
    try {
      await api.delete(`/api/team-members/${member.id}`);
      toast({ title: "팀원을 삭제했습니다" });
      onDeleted();
    } catch (err) {
      handleApiError(err, "팀원 삭제 실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>팀원 삭제</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{member?.name}</span>
            {" "}님을 삭제하시겠습니까? 작업/캘린더의 담당자 연결은 그대로
            유지됩니다 (soft delete).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={submitting}
          >
            {submitting ? "삭제 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function handleApiError(err: unknown, fallbackTitle: string) {
  if (err instanceof ApiError) {
    toast({
      title: fallbackTitle,
      description: err.message,
      variant: "destructive",
    });
    return;
  }
  toast({ title: fallbackTitle, variant: "destructive" });
}


function SkeletonRows() {
  return (
    <div className="divide-y">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-7 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-center",
        className,
      )}
    >
      {icon}
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
