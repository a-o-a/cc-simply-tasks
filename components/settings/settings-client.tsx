"use client";

import * as React from "react";
import { Download, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/client/api";
import { toast } from "@/lib/client/use-toast";
import type { AppSettings, WorkCategory, WorkSystem } from "@/lib/client/types";
import { DEFAULT_SERVICE_NAME, SERVICE_NAME_STORAGE_KEY } from "@/lib/client/api";
import { MembersClient } from "@/app/members/members-client";

export function SettingsClient() {
  return (
    <div className="px-8 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">설정</h1>
      </header>

      <Tabs defaultValue="service">
        <TabsList>
          <TabsTrigger value="service">서비스</TabsTrigger>
          <TabsTrigger value="members">팀원</TabsTrigger>
          <TabsTrigger value="codes">코드 관리</TabsTrigger>
          <TabsTrigger value="backup">백업</TabsTrigger>
        </TabsList>

        <TabsContent value="service" className="mt-6">
          <ServiceTab />
        </TabsContent>
        <TabsContent value="members" className="mt-6">
          <MembersClient />
        </TabsContent>
        <TabsContent value="codes" className="mt-6">
          <CodesTab />
        </TabsContent>
        <TabsContent value="backup" className="mt-6">
          <BackupTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────────────────── 서비스 탭 ───────────────────────────── */

function ServiceTab() {
  const [draft, setDraft] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    api
      .get<AppSettings>("/api/settings")
      .then((data) => setDraft(data.service_name))
      .catch(() => setDraft(DEFAULT_SERVICE_NAME))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const data = await api.patch<AppSettings>("/api/settings", { service_name: trimmed });
      window.localStorage.setItem(SERVICE_NAME_STORAGE_KEY, data.service_name);
      window.dispatchEvent(new CustomEvent("settings-changed"));
      toast({ title: "서비스명이 저장되었습니다" });
    } catch (err) {
      toast({
        title: "저장 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md rounded-lg border bg-card p-6">
      <h2 className="mb-4 text-sm font-semibold">서비스명</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="service-name">표시 이름</Label>
          <Input
            id="service-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={DEFAULT_SERVICE_NAME}
            maxLength={100}
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            사이드바 상단과 브라우저 탭 제목에 표시됩니다.
          </p>
        </div>
        <Button type="submit" disabled={saving || loading || !draft.trim()}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </form>
    </div>
  );
}

/* ───────────────────────────── 백업 탭 ───────────────────────────── */

type DbTable = { name: string; label: string; count: number };

function BackupTab() {
  const [tables, setTables] = React.useState<DbTable[] | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(true);

  const loadStats = React.useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await api.get<{ tables: DbTable[] }>("/api/db-stats");
      setTables(data.tables);
    } catch {
      toast({ title: "DB 현황 조회 실패", variant: "destructive" });
    } finally {
      setStatsLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadStats(); }, [loadStats]);

  return (
    <div className="max-w-xl space-y-6">
      {/* DB 현황 */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">DB 현황</h2>
          <button
            onClick={() => void loadStats()}
            disabled={statsLoading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            aria-label="새로고침"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {statsLoading && !tables ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">테이블</th>
                <th className="px-4 py-2 font-medium">모델명</th>
                <th className="px-4 py-2 text-right font-medium">레코드 수</th>
              </tr>
            </thead>
            <tbody>
              {(tables ?? []).map((t) => (
                <tr key={t.name} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-2 text-muted-foreground">{t.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{t.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 백업 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-2 text-sm font-semibold">데이터베이스 백업</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          현재 SQLite DB 파일을 그대로 다운로드합니다. 복구 시 <code className="rounded bg-muted px-1 py-0.5 text-xs">db/dev.db</code>에 덮어쓰면 됩니다.
        </p>
        <a href="/api/backup" download>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            DB 파일 다운로드
          </Button>
        </a>
      </div>
    </div>
  );
}

/* ───────────────────────────── 분류 관리 탭 ───────────────────────────── */

type WorkCategoryDialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; item: WorkCategory };

function CategoriesTab() {
  const [items, setItems] = React.useState<WorkCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dialog, setDialog] = React.useState<WorkCategoryDialogState>({ mode: "closed" });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: WorkCategory[] }>("/api/work-categories");
      setItems(data.items);
    } catch {
      toast({ title: "분류 목록 조회 실패", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  async function handleDelete(item: WorkCategory) {
    if (!confirm(`"${item.name}" 분류를 삭제할까요?`)) return;
    try {
      await api.delete(`/api/work-categories/${item.id}`);
      toast({ title: "삭제되었습니다" });
      void load();
    } catch (err) {
      toast({
        title: "삭제 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">작업 분류 코드</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            작업을 등록할 때 선택 가능한 분류 목록입니다.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
          <Plus className="mr-2 h-4 w-4" />
          추가
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            등록된 분류가 없습니다. 추가 버튼을 눌러 시작하세요.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">코드</th>
                <th className="px-4 py-3 font-medium">이름</th>
                <th className="px-4 py-3 font-medium w-20" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDialog({ mode: "edit", item })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(item)}
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
      </div>

      <WorkCategoryDialog
        state={dialog}
        onClose={() => setDialog({ mode: "closed" })}
        onSaved={() => { setDialog({ mode: "closed" }); void load(); }}
      />
    </div>
  );
}

function WorkCategoryDialog({
  state,
  onClose,
  onSaved,
}: {
  state: WorkCategoryDialogState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isOpen = state.mode !== "closed";
  const editing = state.mode === "edit" ? state.item : null;

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (state.mode === "edit") {
      setCode(state.item.code);
      setName(state.item.name);
    } else if (state.mode === "create") {
      setCode("");
      setName("");
    }
  }, [state]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(`/api/work-categories/${editing.id}`, { name });
        toast({ title: "수정되었습니다" });
      } else {
        await api.post("/api/work-categories", { code, name });
        toast({ title: "추가되었습니다" });
      }
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "저장 실패";
      toast({ title: "저장 실패", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "분류 수정" : "분류 추가"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wc-code">코드</Label>
            <Input
              id="wc-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="a-service"
              maxLength={100}
              disabled={!!editing}
            />
            <p className="text-xs text-muted-foreground">영문, 숫자, 하이픈, 언더스코어만 허용. 한 번 등록하면 변경 불가.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wc-name">이름</Label>
            <Input
              id="wc-name"
              autoFocus={!!editing}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A 서비스"
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={submitting || !code.trim() || !name.trim()}>
              {submitting ? "저장 중…" : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── 코드 관리 탭 (분류 + 시스템) ───────────────────────────── */

function CodesTab() {
  return (
    <div className="space-y-10">
      <CategoriesTab />
      <WorkSystemsSection />
    </div>
  );
}

type WorkSystemDialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; item: WorkSystem };

function WorkSystemsSection() {
  const [items, setItems] = React.useState<WorkSystem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dialog, setDialog] = React.useState<WorkSystemDialogState>({ mode: "closed" });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: WorkSystem[] }>("/api/work-systems");
      setItems(data.items);
    } catch {
      toast({ title: "작업 시스템 목록 조회 실패", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  async function handleDelete(item: WorkSystem) {
    if (!confirm(`"${item.name}" 시스템을 삭제할까요?`)) return;
    try {
      await api.delete(`/api/work-systems/${item.id}`);
      toast({ title: "삭제되었습니다" });
      void load();
    } catch (err) {
      toast({
        title: "삭제 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">작업 시스템 코드</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            티켓을 등록할 때 선택 가능한 시스템 목록입니다.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
          <Plus className="mr-2 h-4 w-4" />
          추가
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            등록된 시스템이 없습니다. 추가 버튼을 눌러 시작하세요.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">코드</th>
                <th className="px-4 py-3 font-medium">이름</th>
                <th className="px-4 py-3 font-medium w-20" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDialog({ mode: "edit", item })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(item)}
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
      </div>

      <WorkSystemDialog
        state={dialog}
        onClose={() => setDialog({ mode: "closed" })}
        onSaved={() => { setDialog({ mode: "closed" }); void load(); }}
      />
    </div>
  );
}

function WorkSystemDialog({
  state,
  onClose,
  onSaved,
}: {
  state: WorkSystemDialogState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isOpen = state.mode !== "closed";
  const editing = state.mode === "edit" ? state.item : null;

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (state.mode === "edit") {
      setCode(state.item.code);
      setName(state.item.name);
    } else if (state.mode === "create") {
      setCode("");
      setName("");
    }
  }, [state]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(`/api/work-systems/${editing.id}`, { code, name });
        toast({ title: "수정되었습니다" });
      } else {
        await api.post("/api/work-systems", { code, name });
        toast({ title: "추가되었습니다" });
      }
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "저장 실패";
      toast({ title: "저장 실패", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "시스템 수정" : "시스템 추가"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws-code">코드</Label>
            <Input
              id="ws-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="xxx-channel-api"
              maxLength={100}
              disabled={!!editing}
            />
            <p className="text-xs text-muted-foreground">영문, 숫자, 하이픈, 언더스코어만 허용. 한 번 등록하면 변경 불가.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-name">이름</Label>
            <Input
              id="ws-name"
              autoFocus={!!editing}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="채널API"
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={submitting || !code.trim() || !name.trim()}>
              {submitting ? "저장 중…" : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
