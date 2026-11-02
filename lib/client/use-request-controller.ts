"use client";

import * as React from "react";

/** 새 조회가 시작되거나 화면을 떠나면 이전 조회를 취소합니다. */
export function useRequestController() {
  const current = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(true);

  const cancelRequest = React.useCallback(() => {
    current.current?.abort();
    current.current = null;
  }, []);

  const beginRequest = React.useCallback(() => {
    cancelRequest();
    const controller = new AbortController();
    if (!mounted.current) controller.abort();
    current.current = controller;
    return {
      signal: controller.signal,
      isCurrent: () => mounted.current && current.current === controller && !controller.signal.aborted,
    };
  }, [cancelRequest]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelRequest();
    };
  }, [cancelRequest]);
  return { beginRequest, cancelRequest };
}
