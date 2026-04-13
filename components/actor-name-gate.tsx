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
import { ACTOR_NAME_STORAGE_KEY } from "@/lib/client/api";

/**
 * 인증이 없는 1차 환경에서 "누가 작업했는가"를 확보하기 위한 강제 게이트.
 *
 * - localStorage에 actor name이 없으면 모달로 입력 강제
 * - 입력 후에는 모든 fetch에 `x-actor-name` 헤더로 자동 전송 (lib/client/api.ts)
 * - 변경은 사이드바의 "이름 변경" 버튼으로 가능 (이 컴포넌트 외부에서 setItem 후 setName 트리거)
 *
 * SSR-safe: 마운트 전에는 모달을 렌더링하지 않음.
 */
export function ActorNameGate() {
  const [mounted, setMounted] = React.useState(false);
  const [name, setName] = React.useState("");
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    setMounted(true);
    const stored = window.localStorage.getItem(ACTOR_NAME_STORAGE_KEY) ?? "";
    setName(stored);
  }, []);

  const open = mounted && !name;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    window.localStorage.setItem(ACTOR_NAME_STORAGE_KEY, trimmed);
    window.dispatchEvent(new CustomEvent("actor-name-changed", { detail: trimmed }));
    setName(trimmed);
    setDraft("");
  }

  if (!open) return null;

  return (
    <Dialog open={open}>
      <DialogContent
        hideCloseButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>이름을 입력해주세요</DialogTitle>
          <DialogDescription>
            모든 작업 변경 이력에 표시되는 이름입니다. 브라우저에 저장되며
            언제든 사이드바에서 변경할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="actor-name-input">표시 이름</Label>
            <Input
              id="actor-name-input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="예: 김지원"
              maxLength={32}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!draft.trim()}>
              시작하기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
