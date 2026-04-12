import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui 표준 className 결합 헬퍼.
 * 중복/충돌하는 Tailwind 클래스는 뒤쪽이 우선 (twMerge).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
