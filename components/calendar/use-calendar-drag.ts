import * as React from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { api } from "@/lib/client/api";
import { kstDateStringToUtcMs } from "@/lib/client/calendar";
import { toast } from "@/lib/client/use-toast";
import type { CalendarEvent } from "@/lib/client/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DragData = {
  eventId: string;
  originalStartDateTime: string;
  originalEndDateTime: string;
  updatedAt: string;
  sourceDayKey: string;
};

/**
 * @dnd-kit 드래그 앤 드롭으로 이벤트 날짜를 이동하는 훅.
 *
 * - 낙관적 업데이트 → PATCH → 실패 시 롤백
 * - 성공 후 onRefresh()로 서버 데이터 재조회 (updatedAt 갱신)
 */
export function useCalendarDrag(
  setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>,
  onRefresh: () => void,
) {
  const handleDragEnd = React.useCallback(
    async (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over) return;

      const data = active.data.current as DragData | undefined;
      if (!data) return;

      const targetDayKey = over.id as string;
      if (targetDayKey === data.sourceDayKey) return;

      const sourceMs = kstDateStringToUtcMs(data.sourceDayKey);
      const targetMs = kstDateStringToUtcMs(targetDayKey);
      const deltaDays = Math.round((targetMs - sourceMs) / DAY_MS);

      const newStart = new Date(
        new Date(data.originalStartDateTime).getTime() + deltaDays * DAY_MS,
      ).toISOString();
      const newEnd = new Date(
        new Date(data.originalEndDateTime).getTime() + deltaDays * DAY_MS,
      ).toISOString();

      // 낙관적 업데이트
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === data.eventId
            ? { ...ev, startDateTime: newStart, endDateTime: newEnd }
            : ev,
        ),
      );

      try {
        await api.patch(
          `/api/calendar-events/${data.eventId}`,
          { startDateTime: newStart, endDateTime: newEnd },
          data.updatedAt,
        );
        onRefresh();
      } catch (err) {
        // 롤백
        setEvents((prev) =>
          prev.map((ev) =>
            ev.id === data.eventId
              ? {
                  ...ev,
                  startDateTime: data.originalStartDateTime,
                  endDateTime: data.originalEndDateTime,
                }
              : ev,
          ),
        );
        toast({
          title: "이동 실패",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    },
    [setEvents, onRefresh],
  );

  return { handleDragEnd };
}
