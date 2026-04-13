import * as React from "react";
import type { Priority, Status } from "@/lib/enums";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";

/**
 * 상태 칩. globals.css의 status semantic CSS 변수를 그대로 사용해
 * 라이트/다크 모드에서 일관된 색상을 보여준다.
 */

const STATUS_VAR: Record<Status, string> = {
  WAITING: "--status-waiting",
  IN_PROGRESS: "--status-in-progress",
  INTERNAL_TEST: "--status-internal-test",
  BUSINESS_TEST: "--status-business-test",
  QA_TEST: "--status-qa-test",
  TRANSFER_READY: "--status-transfer-ready",
  TRANSFERRED: "--status-transferred",
  HOLDING: "--status-holding",
};

export function StatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const cssVar = STATUS_VAR[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{
        color: `hsl(var(${cssVar}))`,
        borderColor: `hsl(var(${cssVar}) / 0.4)`,
        background: `hsl(var(${cssVar}) / 0.08)`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `hsl(var(${cssVar}))` }}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  // priority는 텍스트 비중이 낮아 별도 색상 구분 없이 muted 톤 사용
  const tone =
    priority === "HIGH"
      ? "text-rose-600 dark:text-rose-400"
      : priority === "LOW"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <span className={cn("text-xs font-medium", tone, className)}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
