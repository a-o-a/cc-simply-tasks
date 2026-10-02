"use client";

import * as React from "react";
import { api, ApiError, isAbortError } from "./api";
import type { Member, WorkCategory, WorkSystem } from "./types";
import { useRequestController } from "./use-request-controller";

/** 작업 화면들이 공유하는 선택 항목은 목록 변경과 분리해서 조회합니다. */
export function useWorkReferences() {
  const [members, setMembers] = React.useState<Member[]>([]);
  const [categories, setCategories] = React.useState<WorkCategory[]>([]);
  const [systems, setSystems] = React.useState<WorkSystem[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const { beginRequest, cancelRequest } = useRequestController();

  const reload = React.useCallback(async () => {
    const request = beginRequest();
    setError(null);
    try {
      const [nextMembers, categoryResult, systemResult] = await Promise.all([
        api.getAllPages<Member>("/api/team-members", { signal: request.signal }),
        api.get<{ items: WorkCategory[] }>("/api/work-categories", { signal: request.signal }),
        api.get<{ items: WorkSystem[] }>("/api/work-systems", { signal: request.signal }),
      ]);
      if (!request.isCurrent()) return;
      setMembers(nextMembers);
      setCategories(categoryResult.items);
      setSystems(systemResult.items);
    } catch (error) {
      if (!request.isCurrent() || isAbortError(error)) return;
      setError(error instanceof ApiError ? error.message : "팀원·분류·시스템을 불러오지 못했습니다.");
    }
  }, [beginRequest]);

  React.useEffect(() => {
    void reload();
    window.addEventListener("reference-data-changed", reload);
    return () => {
      cancelRequest();
      window.removeEventListener("reference-data-changed", reload);
    };
  }, [reload, cancelRequest]);

  return { members, categories, systems, error, reload };
}
