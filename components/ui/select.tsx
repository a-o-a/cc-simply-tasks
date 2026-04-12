import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select — 네이티브 `<select>` 기반 (Radix Select 도입은 필요할 때 교체).
 *
 * 폼 이벤트가 평범한 input과 동일하게 동작해 React 상태 관리가 단순하다.
 * 화살표 아이콘은 lucide ChevronDown으로 직접 그려서 OS 스타일 차이를 줄였다.
 */
export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-8 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
