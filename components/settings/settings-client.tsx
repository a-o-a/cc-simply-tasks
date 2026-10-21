"use client";

import * as React from "react";
import { Download, HardDrive, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/client/api";
import { useRequestController } from "@/lib/client/use-request-controller";
import { QueryError } from "@/components/ui/query-state";
import { toast } from "@/lib/client/use-toast";
import type { AppSettings, WorkCategory, WorkSystem } from "@/lib/client/types";
import { DEFAULT_SERVICE_NAME, SERVICE_NAME_STORAGE_KEY } from "@/lib/client/api";
import { MembersClient } from "@/app/members/members-client";

function emitReferencesChanged() {
  window.dispatchEvent(new CustomEvent("reference-data-changed"));
}

function useMountedRef() {
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

function useSettingsQuery<T>(path: string, fallbackMessage: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const mounted = useMountedRef();
  const { beginRequest, cancelRequest } = useRequestController();

  const reload = React.useCallback(async () => {
    if (!mounted.current) return;
    const request = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const next = await api.get<T>(path, { signal: request.signal });
      if (request.isCurrent()) setData(next);
    } catch (err) {
      if (!request.isCurrent()) return;
      setError(err instanceof ApiError ? err.message : fallbackMessage);
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [path, fallbackMessage, mounted, beginRequest]);

  React.useEffect(() => {
    void reload();
    return cancelRequest;
  }, [reload, cancelRequest]);

  return { data, error, loading, reload };
}

function SettingsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" role="status">
      <span className="sr-only">불러오는 중…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-8 animate-pulse rounded-sm bg-muted" aria-hidden="true" />
      ))}
    </div>
  );
}

export function SettingsClient() {
  return (
    <div className="px-4 py-4 md:px-8 md:py-6">
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
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const mounted = useMountedRef();
  const { data, error, loading, reload } = useSettingsQuery<AppSettings>("/api/settings", "서비스명을 불러오지 못했습니다.");

  React.useEffect(() => {
    if (data) setDraft(data.service_name);
  }, [data]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || savingRef.current || loading || !data) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const data = await api.patch<AppSettings>("/api/settings", { service_name: trimmed });
      try {
        window.localStorage.setItem(SERVICE_NAME_STORAGE_KEY, data.service_name);
      } catch {
        // 브라우저 저장소가 차단되어도 서버에 저장된 변경은 유지됩니다.
      }
      window.dispatchEvent(new CustomEvent("settings-changed"));
      emitReferencesChanged();
      if (mounted.current) setDraft(data.service_name);
      toast({ title: "서비스명이 저장되었습니다" });
    } catch (err) {
      toast({
        title: "저장 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="max-w-md rounded-lg border bg-card p-6">
      <h2 className="mb-4 text-sm font-semibold">서비스명</h2>
      {error && <div className="mb-4"><QueryError message={error} onRetry={() => void reload()} /></div>}
      {loading && <p className="mb-3 text-xs text-muted-foreground" role="status">서비스명을 불러오는 중…</p>}
      <form onSubmit={handleSubmit} className="space-y-4" aria-busy={saving}>
        <div className="form-field">
          <Label htmlFor="service-name">표시 이름</Label>
          <Input
            id="service-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={DEFAULT_SERVICE_NAME}
            maxLength={100}
            disabled={loading || saving || !data}
            required
          />
          <p className="text-xs text-muted-foreground">
            사이드바 상단과 브라우저 탭 제목에 표시됩니다.
          </p>
        </div>
        <Button type="submit" disabled={saving || loading || !data || !draft.trim()}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </form>
    </div>
  );
}

/* ───────────────────────────── 백업 탭 ───────────────────────────── */

type DbTable = { name: string; label: string; count: number };
type BackupFile = { filename: string; size: number; date: string };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackupTab() {
  const { data: stats, error: statsError, loading: statsLoading, reload: loadStats } = useSettingsQuery<{ tables: DbTable[] }>("/api/db-stats", "DB 현황을 불러오지 못했습니다.");
  const { data: files, error: filesError, loading: filesLoading, reload: loadFiles } = useSettingsQuery<{ files: BackupFile[] }>("/api/backup/files", "백업 파일 목록을 불러오지 못했습니다.");
  const tables = stats?.tables ?? null;
  const backupFiles = files?.files ?? null;
  const [triggering, setTriggering] = React.useState(false);
  const triggeringRef = React.useRef(false);
  const mounted = useMountedRef();

  React.useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshVisibleBackupFiles = () => {
      if (document.visibilityState !== "visible" || refreshTimer !== null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void loadStats();
        void loadFiles();
      }, 100);
    };

    window.addEventListener("focus", refreshVisibleBackupFiles);
    document.addEventListener("visibilitychange", refreshVisibleBackupFiles);

    return () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshVisibleBackupFiles);
      document.removeEventListener("visibilitychange", refreshVisibleBackupFiles);
    };
  }, [loadFiles, loadStats]);

  async function handleTrigger() {
    if (triggeringRef.current) return;
    triggeringRef.current = true;
    setTriggering(true);
    try {
      await api.post("/api/backup/trigger", {});
      toast({ title: "백업이 완료되었습니다" });
      if (mounted.current) await loadFiles();
    } catch (e) {
      toast({
        title: "백업 실패",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      triggeringRef.current = false;
      if (mounted.current) setTriggering(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      {/* DB 현황 */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">DB 현황</h2>
          <button
            type="button"
            onClick={() => void loadStats()}
            disabled={statsLoading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            aria-label="DB 현황 새로고침"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {statsLoading && <p className="sr-only" role="status">DB 현황을 불러오는 중…</p>}
        {statsError && <div className="m-4"><QueryError message={statsError} onRetry={() => void loadStats()} /></div>}
        {tables === null ? (
          statsLoading ? <SettingsSkeleton rows={5} /> : null
        ) : tables.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">표시할 DB 현황이 없습니다.</p>
        ) : (
          <table className="w-full text-sm" aria-busy={statsLoading}>
            <caption className="sr-only">데이터베이스 모델별 레코드 수</caption>
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">테이블</th>
                <th scope="col" className="px-4 py-2 font-medium">모델명</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">레코드 수</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
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

      {/* 백업 실행 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-2 text-sm font-semibold">데이터베이스 백업</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          자동 백업은 매일 서버 시간 기준 02:00에 실행됩니다 (<code className="rounded-sm bg-muted px-1 py-0.5 text-xs">BACKUP_CRON</code> 환경변수로 변경 가능).
          최근 7일치 백업을 DB 파일과 같은 디렉터리에 보관합니다.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleTrigger} disabled={triggering}>
            <HardDrive className="mr-2 h-4 w-4" />
            {triggering ? "백업 중…" : "지금 백업"}
          </Button>
          <Button variant="ghost" asChild>
            <a href="/api/backup" download>
              <Download className="mr-2 h-4 w-4" />
              현재 DB 다운로드
            </a>
          </Button>
        </div>
        {triggering && <p className="mt-3 text-xs text-muted-foreground" role="status">백업이 완료될 때까지 기다려주세요.</p>}
      </div>

      {/* 백업 파일 목록 */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">백업 파일 목록</h2>
          <button
            type="button"
            onClick={() => void loadFiles()}
            disabled={filesLoading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            aria-label="백업 파일 목록 새로고침"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${filesLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {filesLoading && <p className="sr-only" role="status">백업 파일 목록을 불러오는 중…</p>}
        {filesError && <div className="m-4"><QueryError message={filesError} onRetry={() => void loadFiles()} /></div>}
        {backupFiles === null ? (
          filesLoading ? <SettingsSkeleton /> : null
        ) : backupFiles.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            백업 파일이 없습니다. 위에서 &apos;지금 백업&apos; 버튼을 눌러 첫 백업을 생성하세요.
          </p>
        ) : (
          <table className="w-full text-sm" aria-busy={filesLoading}>
            <caption className="sr-only">다운로드 가능한 백업 파일</caption>
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">날짜</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">크기</th>
                <th scope="col" className="px-4 py-3 w-16"><span className="sr-only">다운로드</span></th>
              </tr>
            </thead>
            <tbody>
              {backupFiles.map((f) => (
                <tr key={f.filename} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-3 font-mono text-xs">{f.date}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatBytes(f.size)}
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                      <a href={`/api/backup/files/${encodeURIComponent(f.filename)}`} download={f.filename} aria-label={`${f.filename} 다운로드`}>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── 코드 관리 ───────────────────────────── */

type CodeItem = WorkCategory | WorkSystem;
type CodeDialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; item: CodeItem };

type CodeDefinition = {
  endpoint: string;
  prefix: string;
  name: string;
  description: string;
};

const CATEGORY_DEFINITION: CodeDefinition = {
  endpoint: "/api/work-categories",
  prefix: "wc",
  name: "분류",
  description: "작업을 등록할 때 선택 가능한 분류 목록입니다.",
};
const SYSTEM_DEFINITION: CodeDefinition = {
  endpoint: "/api/work-systems",
  prefix: "ws",
  name: "시스템",
  description: "티켓을 등록할 때 선택 가능한 시스템 목록입니다.",
};

function CodesTab() {
  return (
    <div className="space-y-10">
      <CodeSection definition={CATEGORY_DEFINITION} />
      <CodeSection definition={SYSTEM_DEFINITION} />
    </div>
  );
}

function CodeSection({ definition }: { definition: CodeDefinition }) {
  const { data, error, loading, reload } = useSettingsQuery<{ items: CodeItem[] }>(
    definition.endpoint,
    `${definition.name} 목록을 불러오지 못했습니다.`,
  );
  const items = data?.items ?? null;
  const [dialog, setDialog] = React.useState<CodeDialogState>({ mode: "closed" });
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const deletingRef = React.useRef(false);
  const mounted = useMountedRef();

  async function handleDelete(item: CodeItem) {
    if (deletingRef.current || !confirm(`"${item.name}" 코드를 삭제할까요?`)) return;
    deletingRef.current = true;
    setDeletingId(item.id);
    try {
      await api.delete(`${definition.endpoint}/${item.id}`);
      emitReferencesChanged();
      toast({ title: "삭제되었습니다" });
      if (mounted.current) await reload();
    } catch (err) {
      toast({
        title: "삭제 실패",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      deletingRef.current = false;
      if (mounted.current) setDeletingId(null);
    }
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">작업 {definition.name} 코드</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{definition.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs text-muted-foreground" role="status">불러오는 중…</span>}
          <Button type="button" variant="ghost" size="icon" onClick={() => void reload()} disabled={loading} aria-label={`${definition.name} 목록 새로고침`}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" disabled={deletingId !== null} onClick={() => setDialog({ mode: "create" })}>
            <Plus className="mr-2 h-4 w-4" />
            추가
          </Button>
        </div>
      </div>

      {error && <div className="mb-4"><QueryError message={error} onRetry={() => void reload()} /></div>}
      {deletingId !== null && <p className="mb-3 text-xs text-muted-foreground" role="status">삭제하는 중…</p>}
      <div className="rounded-lg border bg-card" aria-busy={loading}>
        {items === null ? (
          loading ? <SettingsSkeleton /> : null
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            등록된 {definition.name} 코드가 없습니다. 추가 버튼을 눌러 시작하세요.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">작업 {definition.name} 코드 목록</caption>
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">코드</th>
                <th scope="col" className="px-4 py-3 font-medium">이름</th>
                <th scope="col" className="px-4 py-3 font-medium w-20"><span className="sr-only">수정 및 삭제</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={deletingId !== null} aria-label={`${item.name} 수정`} onClick={() => setDialog({ mode: "edit", item })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={deletingId !== null} aria-label={`${item.name} 삭제`} onClick={() => void handleDelete(item)}>
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

      <CodeDialog
        definition={definition}
        state={dialog}
        onClose={() => setDialog({ mode: "closed" })}
        onSaved={() => { setDialog({ mode: "closed" }); void reload(); }}
      />
    </div>
  );
}

function CodeDialog({
  definition,
  state,
  onClose,
  onSaved,
}: {
  definition: CodeDefinition;
  state: CodeDialogState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.mode === "edit" ? state.item : null;
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const mounted = useMountedRef();

  React.useEffect(() => {
    if (state.mode === "closed") return;
    setCode(state.mode === "edit" ? state.item.code : "");
    setName(state.mode === "edit" ? state.item.name : "");
  }, [state]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextCode = code.trim();
    const nextName = name.trim();
    if (submittingRef.current || !nextCode || !nextName) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(`${definition.endpoint}/${editing.id}`, { name: nextName });
        toast({ title: "수정되었습니다" });
      } else {
        await api.post(definition.endpoint, { code: nextCode, name: nextName });
        toast({ title: "추가되었습니다" });
      }
      emitReferencesChanged();
      if (mounted.current) onSaved();
    } catch (err) {
      toast({ title: "저장 실패", description: err instanceof ApiError ? err.message : "저장 실패", variant: "destructive" });
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <Dialog open={state.mode !== "closed"} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent hideCloseButton={submitting}>
        <DialogHeader>
          <DialogTitle>{definition.name} {editing ? "수정" : "추가"}</DialogTitle>
          <DialogDescription>{definition.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={submitting}>
          <div className="form-field">
            <Label htmlFor={`${definition.prefix}-code`}>코드</Label>
            <Input id={`${definition.prefix}-code`} value={code} onChange={(e) => setCode(e.target.value)} autoFocus={!editing} maxLength={100} disabled={!!editing || submitting} required={!editing} pattern="[a-zA-Z0-9_-]+" />
            <p className="text-xs text-muted-foreground">영문, 숫자, 하이픈, 언더스코어만 허용. 한 번 등록하면 변경 불가.</p>
          </div>
          <div className="form-field">
            <Label htmlFor={`${definition.prefix}-name`}>이름</Label>
            <Input id={`${definition.prefix}-name`} autoFocus={!!editing} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={submitting} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>취소</Button>
            <Button type="submit" disabled={submitting || !code.trim() || !name.trim()}>
              {submitting ? "저장 중…" : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
