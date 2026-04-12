"use client";

/**
 * Lightweight toast store + hook (shadcn 표준 use-toast의 슬림 버전).
 *
 * - 외부 의존성 없는 모듈 스코프 store
 * - `toast(...)`는 어디서든 호출 가능
 * - `<Toaster />`가 store를 구독해 렌더링
 */

import * as React from "react";
import type { ToastProps } from "@/components/ui/toast";

const TOAST_LIMIT = 4;
const TOAST_REMOVE_DELAY = 4000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
};

type State = { toasts: ToasterToast[] };

let memoryState: State = { toasts: [] };
const listeners: Array<(state: State) => void> = [];

function setState(updater: (prev: State) => State) {
  memoryState = updater(memoryState);
  for (const listener of listeners) listener(memoryState);
}

const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRemoval(id: string) {
  if (removalTimers.has(id)) return;
  const timeout = setTimeout(() => {
    removalTimers.delete(id);
    setState((prev) => ({
      toasts: prev.toasts.filter((t) => t.id !== id),
    }));
  }, TOAST_REMOVE_DELAY);
  removalTimers.set(id, timeout);
}

let counter = 0;
function nextId() {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now()}-${counter}`;
}

export function toast(props: Omit<ToasterToast, "id">) {
  const id = nextId();
  const newToast: ToasterToast = {
    ...props,
    id,
    open: true,
    onOpenChange: (open) => {
      if (!open) scheduleRemoval(id);
    },
  };
  setState((prev) => ({
    toasts: [newToast, ...prev.toasts].slice(0, TOAST_LIMIT),
  }));
  scheduleRemoval(id);
  return id;
}

export function dismissToast(id?: string) {
  setState((prev) => ({
    toasts: prev.toasts.map((t) =>
      id === undefined || t.id === id ? { ...t, open: false } : t,
    ),
  }));
}

export function useToast() {
  const [state, setLocal] = React.useState<State>(memoryState);
  React.useEffect(() => {
    listeners.push(setLocal);
    return () => {
      const i = listeners.indexOf(setLocal);
      if (i > -1) listeners.splice(i, 1);
    };
  }, []);
  return { toasts: state.toasts, toast, dismiss: dismissToast };
}
