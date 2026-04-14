"use client";

/**
 * MemberFilter — 팀원 필터 드롭다운.
 *
 * mode="multi" (기본): 멀티셀렉트. 캘린더, 작업 목록 필터 등.
 * mode="single": 단일 선택. 선택 즉시 닫힘. 새 선택 시 기존 해제. "전체" 없음.
 *
 * Props:
 *   members        — 전체 팀원 목록
 *   selectedIds    — 현재 선택된 팀원 ID Set
 *   onToggle       — 팀원 ID 토글 핸들러
 *   onClear        — 전체 선택 해제 핸들러 (multi 모드에서만 사용)
 *   placeholder    — 미선택 시 버튼 텍스트 (기본: "팀원")
 *   mode           — "multi" | "single" (기본: "multi")
 */

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Member } from "@/lib/client/types";

type Props = {
  members: Member[];
  selectedIds: Set<string>;
  onToggle: (memberId: string) => void;
  onClear: () => void;
  placeholder?: string;
  mode?: "multi" | "single";
  className?: string;
};

export function MemberFilter({
  members,
  selectedIds,
  onToggle,
  onClear,
  placeholder = "팀원",
  mode = "multi",
  className,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const count = selectedIds.size;

  const triggerLabel =
    count === 0
      ? placeholder
      : count === 1
        ? members.find((m) => selectedIds.has(m.id))?.name ?? `${count}명`
        : `${count}명 선택`;

  function handleToggle(memberId: string) {
    if (mode === "single") {
      // single: 이미 선택된 경우 해제, 아니면 선택 후 닫기
      if (selectedIds.has(memberId)) {
        onClear();
      } else {
        onClear();
        onToggle(memberId);
      }
      setOpen(false);
    } else {
      onToggle(memberId);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
            count > 0
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-input bg-background text-foreground hover:bg-accent",
            className,
          )}
        >
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[8rem] truncate">{triggerLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-md border bg-popover p-2 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <div className={cn("grid gap-1", mode === "multi" ? "grid-cols-5" : "grid-cols-4")}>
            {/* 전체 버튼 — multi 모드에서만 표시 */}
            {mode === "multi" && (
              <button
                onClick={() => { onClear(); }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent",
                  count === 0 ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground",
                )}
              >
                <span className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors",
                  count === 0 ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30",
                )}>
                  전
                </span>
                <span className="truncate w-full text-center">전체</span>
              </button>
            )}

            {/* 팀원 목록 */}
            {members.map((m) => {
              const selected = selectedIds.has(m.id);
              const initials = m.name.slice(0, 2);
              return (
                <button
                  key={m.id}
                  onClick={() => handleToggle(m.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent",
                    selected ? "bg-primary/10 text-primary font-medium" : "text-foreground",
                  )}
                >
                  <span className={cn(
                    "relative flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/30 bg-muted",
                  )}>
                    {initials}
                    {selected && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary">
                        <Check className="h-2 w-2 text-primary-foreground" />
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center">{m.name}</span>
                </button>
              );
            })}
          </div>

          {members.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              등록된 팀원이 없습니다
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
