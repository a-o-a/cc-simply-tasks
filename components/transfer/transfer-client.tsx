"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, api, emitWorkItemsChanged } from "@/lib/client/api";
import { toast } from "@/lib/client/use-toast";
import type {
  ListResponse,
  Member,
  WorkCategory,
  WorkItemDetail,
  WorkItemListItem,
  WorkSystem,
} from "@/lib/client/types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/work-items/status-badge";
import { WorkItemDrawer } from "@/components/work-items/work-item-drawer";
import { WorkItemFormDialog } from "@/components/work-items/work-item-form-dialog";
import type { Status } from "@/lib/enums";

/**
 * 이관 현황 페이지 — 미팅용.
 *
 * 이관완료(TRANSFERRED)가 아닌 + 이관일이 설정된 작업을
 * 이관일 → 요청번호 → 작업 순으로 그룹핑해 표시.
 */

// ─── 그룹핑 타입 ───────────────────────────────────────────────────────────────

type DateGroup = {
  date: string; // YYYY-MM-DD (KST)
  label: string; // "2026-04-17 (목)"
  isPast: boolean;
  isToday: boolean;
  requestGroups: RequestGroup[];
  totalCount: number;
  systems: string[];
};

type RequestGroup = {
  requestNumber: string | null; // null = 요청번호 없음
  requestTypes: string[]; // 고유 요청구분 목록
  requestors: string[]; // 고유 요청자 목록
  items: WorkItemListItem[];
};

type BulkStatusResponse = {
  updatedCount: number;
  updatedIds: string[];
  skippedIds: string[];
};

// ─── 유틸 ──────────────────────────────────────────────────────────────────────

const KST = "Asia/Seoul";
const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function toKstDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: KST });
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  const day = DAY_LABELS[d.getDay()];
  return `${dateStr} (${day})`;
}

function todayKst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: KST });
}

function cursorFromDateStr(dateStr: string): { year: number; month0: number } {
  const [y, m] = dateStr.split("-").map(Number);
  return { year: y, month0: m - 1 };
}

function groupItems(items: WorkItemListItem[]): DateGroup[] {
  const todayStr = todayKst();

  // 날짜별 Map
  const dateMap = new Map<string, Map<string, WorkItemListItem[]>>();

  for (const item of items) {
    if (!item.transferDate) continue;
    const date = toKstDateStr(item.transferDate);
    const reqKey = item.requestNumber ?? "__none__";

    if (!dateMap.has(date)) dateMap.set(date, new Map());
    const reqMap = dateMap.get(date)!;
    if (!reqMap.has(reqKey)) reqMap.set(reqKey, []);
    reqMap.get(reqKey)!.push(item);
  }

  // 날짜 오름차순 정렬
  const sortedDates = [...dateMap.keys()].sort();

  return sortedDates.map((date) => {
    const reqMap = dateMap.get(date)!;

    // 요청번호 그룹: 요청번호 있는 것 먼저(가나다순), 없는 것 마지막
    const reqGroups: RequestGroup[] = [];
    const numbered = [...reqMap.keys()].filter((k) => k !== "__none__").sort();
    const hasNone = reqMap.has("__none__");

    for (const key of numbered) {
      const groupItems = reqMap.get(key)!;
      const requestTypes = [...new Set(groupItems.map((i) => i.requestType).filter(Boolean) as string[])];
      const requestors = [...new Set(groupItems.map((i) => i.requestor).filter(Boolean) as string[])];
      reqGroups.push({
        requestNumber: key,
        requestTypes,
        requestors,
        items: groupItems,
      });
    }
    if (hasNone) {
      const groupItems = reqMap.get("__none__")!;
      reqGroups.push({
        requestNumber: null,
        requestTypes: [],
        requestors: [],
        items: groupItems,
      });
    }

    const totalCount = [...reqMap.values()].reduce((s, a) => s + a.length, 0);

    const systemSet = new Set<string>();
    for (const group of reqGroups) {
      for (const item of group.items) {
        for (const t of item.tickets) {
          systemSet.add(t.systemName);
        }
      }
    }
    const systems = Array.from(systemSet).sort();

    return {
      date,
      label: formatDateLabel(date),
      isPast: date < todayStr,
      isToday: date === todayStr,
      requestGroups: reqGroups,
      totalCount,
      systems,
    };
  });
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function TransferClient() {
  const today = React.useMemo(todayKst, []);
  const [cursor, setCursor] = React.useState(() => cursorFromDateStr(today));

  const [items, setItems] = React.useState<WorkItemListItem[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [categories, setCategories] = React.useState<WorkCategory[]>([]);
  const [systems, setSystems] = React.useState<WorkSystem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerReloadKey, setDrawerReloadKey] = React.useState(0);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkItemListItem | null>(null);
  const [pendingDate, setPendingDate] = React.useState<string | null>(null);
  const [confirmingDate, setConfirmingDate] = React.useState<DateGroup | null>(null);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromDate = `${cursor.year}-${String(cursor.month0 + 1).padStart(2, "0")}-01`;
      const daysInMonth = new Date(cursor.year, cursor.month0 + 1, 0).getDate();
      const toDate = `${cursor.year}-${String(cursor.month0 + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

      const [itemsRes, membersRes, catsRes, sysRes] = await Promise.all([
        api.get<ListResponse<WorkItemListItem>>("/api/work-items", {
          query: {
            hasTransferDate: "true",
            transferDate: fromDate,
            transferDateTo: toDate,
            pageSize: 10000,
          },
        }),
        api.get<ListResponse<Member>>("/api/team-members"),
        api.get<ListResponse<WorkCategory>>("/api/work-categories"),
        api.get<ListResponse<WorkSystem>>("/api/work-systems"),
      ]);
      setItems(itemsRes.items);
      setMembers(membersRes.items);
      setCategories(catsRes.items);
      setSystems(sysRes.items);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "데이터 조회 실패";
      setError(message);
      toast({ title: "이관 현황 조회 실패", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  React.useEffect(() => { void loadAll(); }, [loadAll]);

  const dateGroups = React.useMemo(() => groupItems(items), [items]);

  const systemNameByCode = React.useMemo(
    () => Object.fromEntries(systems.map((s) => [s.code, s.name])),
    [systems],
  );

  function openDrawer(item: WorkItemListItem) {
    setDrawerId(item.id);
  }

  function openEdit(item: WorkItemDetail) {
    setEditing(item);
    setFormOpen(true);
  }

  function openCompleteConfirm(dateGroup: DateGroup) {
    setConfirmingDate(dateGroup);
  }

  async function completeDateGroup(dateGroup: DateGroup) {
    const ids = dateGroup.requestGroups.flatMap((group) =>
      group.items
        .filter((item) => item.status !== "TRANSFERRED")
        .map((item) => item.id),
    );
    if (ids.length === 0) return;

    setConfirmingDate(null);
    setPendingDate(dateGroup.date);
    try {
      const result = await api.post<BulkStatusResponse>("/api/work-items/bulk-status", {
        ids,
        status: "TRANSFERRED" satisfies Status,
      });
      setItems((prev) =>
        prev.map((item) =>
          result.updatedIds.includes(item.id)
            ? { ...item, status: "TRANSFERRED" }
            : item,
        ),
      );
      if (result.updatedCount > 0) emitWorkItemsChanged();
      toast({
        title: "이관완료 처리됨",
        description:
          result.updatedCount > 0
            ? `${dateGroup.label} 작업 ${result.updatedCount}건을 이관완료로 변경했습니다.`
            : `${dateGroup.label} 작업은 이미 모두 이관완료 상태입니다.`,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "일괄 상태 변경 실패";
      toast({
        title: "이관완료 처리 실패",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPendingDate((current) => (current === dateGroup.date ? null : current));
      void loadAll();
    }
  }

  function gotoPrev() {
    setCursor((c) =>
      c.month0 === 0
        ? { year: c.year - 1, month0: 11 }
        : { year: c.year, month0: c.month0 - 1 },
    );
  }
  function gotoNext() {
    setCursor((c) =>
      c.month0 === 11
        ? { year: c.year + 1, month0: 0 }
        : { year: c.year, month0: c.month0 + 1 },
    );
  }
  function gotoToday() {
    setCursor(cursorFromDateStr(today));
  }

  const headerLabel = `${cursor.year}년 ${cursor.month0 + 1}월`;

  return (
    <div className="px-8 py-6">
      <header className="flex items-center justify-between">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">이관 현황</h1>
          {!loading && !error && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              이 달의 이관 작업 {items.length}건
            </p>
          )}
        </div>

        {/* 가운데: 월 선택 */}
        <div className="flex flex-1 items-center justify-center gap-3">
          <div className="flex items-center rounded-md border bg-card">
            <Button variant="ghost" size="icon" onClick={gotoPrev} aria-label="이전" disabled={loading}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[10rem] px-3 text-center text-sm font-medium tabular-nums">
              {headerLabel}
            </span>
            <Button variant="ghost" size="icon" onClick={gotoNext} aria-label="다음" disabled={loading}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button variant="outline" onClick={gotoToday} disabled={loading}>
            이번 달
          </Button>
        </div>

        <div className="flex flex-1 justify-end"></div>
      </header>

      <div className="mt-6">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadAll()} />
        ) : dateGroups.length === 0 ? (
          <EmptyState />
        ) : (
          <TransferTable
            dateGroups={dateGroups}
            systemNameByCode={systemNameByCode}
            categoryNameByCode={Object.fromEntries(categories.map((c) => [c.code, c.name]))}
            onOpen={openDrawer}
            pendingDate={pendingDate}
            onCompleteDate={openCompleteConfirm}
          />
        )}
      </div>

      <WorkItemDrawer
        workItemId={drawerId}
        reloadKey={drawerReloadKey}
        categories={categories}
        systems={systems}
        onClose={() => setDrawerId(null)}
        onEdit={openEdit}
        onDeleted={() => { setDrawerId(null); void loadAll(); }}
        onMutated={() => void loadAll()}
      />

      <WorkItemFormDialog
        open={formOpen}
        editing={editing}
        members={members}
        categories={categories}
        systems={systems}
        onClose={() => setFormOpen(false)}
        onSaved={(updated) => {
          setFormOpen(false);
          if (updated) {
            setItems((prev) =>
              prev.map((item) =>
                item.id === updated.id ? { ...item, ...updated, assignee: item.assignee } : item,
              ),
            );
          }
          void loadAll();
          if (drawerId) setDrawerReloadKey((k) => k + 1);
        }}
      />

      <ConfirmBulkTransferDialog
        dateGroup={confirmingDate}
        loading={confirmingDate ? pendingDate === confirmingDate.date : false}
        onClose={() => setConfirmingDate(null)}
        onConfirm={() => {
          if (!confirmingDate) return;
          void completeDateGroup(confirmingDate);
        }}
      />
    </div>
  );
}

// ─── 날짜별 테이블 목록 ────────────────────────────────────────────────────────

function TransferTable({
  dateGroups,
  systemNameByCode,
  categoryNameByCode,
  onOpen,
  pendingDate,
  onCompleteDate,
}: {
  dateGroups: DateGroup[];
  systemNameByCode: Record<string, string>;
  categoryNameByCode: Record<string, string>;
  onOpen: (item: WorkItemListItem) => void;
  pendingDate: string | null;
  onCompleteDate: (dateGroup: DateGroup) => void;
}) {
  return (
    <div className="space-y-6">
      {dateGroups.map((dateGroup) => (
        <DateTable
          key={dateGroup.date}
          dateGroup={dateGroup}
          systemNameByCode={systemNameByCode}
          categoryNameByCode={categoryNameByCode}
          onOpen={onOpen}
          isPending={pendingDate === dateGroup.date}
          onComplete={() => onCompleteDate(dateGroup)}
        />
      ))}
    </div>
  );
}

function DateTable({
  dateGroup,
  systemNameByCode,
  categoryNameByCode,
  onOpen,
  isPending,
  onComplete,
}: {
  dateGroup: DateGroup;
  systemNameByCode: Record<string, string>;
  categoryNameByCode: Record<string, string>;
  onOpen: (item: WorkItemListItem) => void;
  isPending: boolean;
  onComplete: () => void;
}) {
  const hasCompletableItems = dateGroup.requestGroups.some((group) =>
    group.items.some((item) => item.status !== "TRANSFERRED"),
  );

  return (
    <div>
      {/* 날짜 타이틀 */}
      <div className="mb-2 flex items-center gap-2">
        <h2
          className={cn(
            "text-base font-bold",
            dateGroup.isToday
              ? "text-blue-700 dark:text-blue-400"
              : dateGroup.isPast
                ? "text-muted-foreground"
                : "text-foreground",
          )}
        >
          {dateGroup.label}
        </h2>
        {dateGroup.isToday && (
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            오늘
          </span>
        )}
        {dateGroup.isPast && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            지난날
          </span>
        )}
        <span className="text-xs text-muted-foreground">총 {dateGroup.totalCount}건</span>
        {dateGroup.systems.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {dateGroup.systems.map((sysCode) => (
              <span
                key={sysCode}
                className="inline-flex items-center rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70"
              >
                {systemNameByCode[sysCode] ?? sysCode}
              </span>
            ))}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onComplete}
          disabled={isPending || !hasCompletableItems}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              처리 중
            </>
          ) : (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              전체 이관완료
            </>
          )}
        </Button>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="border-b text-xs uppercase text-muted-foreground bg-muted/40">
            <tr>
              <th className="border-r px-4 py-3 font-medium w-[180px]">요청 정보</th>
              <th className="border-r px-4 py-3 font-medium w-[130px]">상태</th>
              <th className="border-r px-4 py-3 font-medium">작업명</th>
              <th className="border-r px-4 py-3 font-medium w-[110px]">담당자</th>
              <th className="px-4 py-3 font-medium w-[200px]">이관 시스템</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {dateGroup.requestGroups.map((reqGroup) =>
              reqGroup.items.map((item, iId) => {
                const isFirstReq = iId === 0;
                return (
                  <tr
                    key={item.id}
                    className="bg-background"
                  >
                    {/* 1. 요청 정보 병합 */}
                    {isFirstReq && (
                      <td rowSpan={reqGroup.items.length} className="border-r px-4 py-3 align-top">
                        <div className="flex flex-col gap-0.5 text-sm">
                          <span className="font-semibold">
                            {reqGroup.requestNumber ? `# ${reqGroup.requestNumber}` : "—"}
                          </span>
                          {(reqGroup.requestTypes.length > 0 || reqGroup.requestors.length > 0) && (
                            <span className="text-xs text-muted-foreground">
                              {[reqGroup.requestTypes.join(", "), reqGroup.requestors.join(", ")]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
                      </td>
                    )}

                    {/* 3. 상태 */}
                    <td className="border-r px-4 py-3 align-top">
                      <StatusBadge status={item.status} />
                    </td>

                    {/* 4. 작업명 */}
                    <td
                      className="border-r px-4 py-3 align-top cursor-pointer hover:bg-accent/40 transition-colors"
                      onClick={() => onOpen(item)}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.category && categoryNameByCode[item.category] && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {categoryNameByCode[item.category]}
                          </span>
                        )}
                        <span className="font-medium leading-snug">{item.title}</span>
                      </div>
                      {item.additionalNotes && (
                        <span className="mt-1 block whitespace-pre-wrap text-[11px] text-muted-foreground">
                          {item.additionalNotes}
                        </span>
                      )}
                    </td>

                    {/* 5. 담당자 */}
                    <td className="border-r px-4 py-3 align-top text-muted-foreground">
                      {item.assignee?.name ?? "미배정"}
                    </td>

                    {/* 6. 이관 시스템 */}
                    <td className="px-4 py-3 align-top">
                      {item.tickets.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {item.tickets.map((t) => (
                            <div
                              key={`${t.systemName}-${t.ticketNumber}`}
                              className="flex w-fit flex-col rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground leading-tight"
                            >
                              <span className="font-medium text-foreground/80">
                                {systemNameByCode[t.systemName] ?? t.systemName}
                              </span>
                              {t.ticketNumber ? <span>{t.ticketNumber}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 상태 컴포넌트 ─────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
          <div className="space-y-2 pl-2">
            {[1, 2, 3].map((j) => (
              <div key={j} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-16 text-center">
      <p className="text-sm font-medium">데이터를 불러오지 못했습니다</p>
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>다시 시도</Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-card py-16 text-center">
      <p className="text-sm font-medium">이관일이 설정된 진행 작업이 없습니다</p>
      <p className="text-xs text-muted-foreground">작업에 이관일을 설정하면 여기에 표시됩니다.</p>
    </div>
  );
}

function ConfirmBulkTransferDialog({
  dateGroup,
  loading,
  onClose,
  onConfirm,
}: {
  dateGroup: DateGroup | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const completableCount = React.useMemo(
    () =>
      dateGroup
        ? dateGroup.requestGroups.reduce(
            (count, group) =>
              count + group.items.filter((item) => item.status !== "TRANSFERRED").length,
            0,
          )
        : 0,
    [dateGroup],
  );

  return (
    <Dialog open={Boolean(dateGroup)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>전체 이관완료 확인</DialogTitle>
          <DialogDescription>
            {dateGroup
              ? `${dateGroup.label}에 표시된 미완료 작업 ${completableCount}건을 이관완료로 변경합니다.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading || completableCount === 0}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                처리 중
              </>
            ) : (
              "이관완료 처리"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
