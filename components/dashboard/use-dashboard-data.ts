"use client";

import * as React from "react";
import { ApiError, isAbortError } from "@/lib/client/api";
import { useRequestController } from "@/lib/client/use-request-controller";

/** 각 홈 영역은 독립적으로 조회하고 마지막 요청만 화면에 반영합니다. */
export function useDashboardData<T>(
  load: (signal: AbortSignal) => Promise<T>,
  fallbackMessage: string,
) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const { beginRequest, cancelRequest } = useRequestController();

  const reload = React.useCallback(async () => {
    const request = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const next = await load(request.signal);
      if (request.isCurrent()) setData(next);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      setError(err instanceof ApiError ? err.message : fallbackMessage);
      // Promise.all의 다른 조회도 실패한 묶음과 함께 취소합니다.
      cancelRequest();
      setLoading(false);
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [beginRequest, cancelRequest, fallbackMessage, load]);

  React.useEffect(() => {
    void reload();
    return cancelRequest;
  }, [reload, cancelRequest]);

  return { data, error, loading, reload };
}
