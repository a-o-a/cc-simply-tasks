"use client";

/**
 * MemberFilter — 멀티 셀렉트 팀원 필터 드롭다운.
 *
 * 재사용 가능: 캘린더, 작업 목록 등 어디서나 쓸 수 있도록 의존성 최소화.
 *
 * Props:
 *   members        — 전체 팀원 목록
 *   selectedIds    — 현재 선택된 멤버 ID Set
 *   onToggle       — 멤버 ID 토글 핸들러
 *   onClear        — 전체 선택 해제 핸들러
 *   placeholder    — 미선택 시 버튼 텍스트 (기본: "팀원")
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
};

export function MemberFilter({
  members,
  selectedIds,
  onToggle,
  onClear,
  placeholder = "팀원",
}: Props) {
  const count = selectedIds.size;

  const triggerLabel =
    count === 0
      ? placeholder
      : count === 1
        ? members.find((m) => selectedIds.has(m.id))?.name ?? `${count}명`
        : `${count}명 선택`;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
            count > 0
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-input bg-background text-foreground hover:bg-accent",
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
          {/* 전체 + 팀원 그리드 */}
          <div className="grid grid-cols-5 gap-1">
            {/* 전체 버튼 */}
            <button
              onClick={onClear}
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

            {/* 팀원 목록 — 5열 그리드 */}
            {members.map((m) => {
              const selected = selectedIds.has(m.id);
              const initials = m.name.slice(0, 2);
              return (
                <button
                  key={m.id}
                  onClick={() => onToggle(m.id)}
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
