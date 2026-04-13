/**
 * Enum 값 → 한글 표시 라벨.
 *
 * `lib/enums.ts`가 값/타입의 소스 오브 트루스이고, 이 파일은 표시 전용 매핑이다.
 * UI에서 enum 값을 그대로 렌더링하지 말고 항상 이 라벨을 거치게 한다.
 */

import type { Category, MemberRole, Priority, Status } from "./enums";

export const STATUS_LABELS: Record<Status, string> = {
  DRAFT: "초안",
  IN_PROGRESS: "진행 중",
  READY_TO_TRANSFER: "이관 준비",
  TRANSFERRED: "이관 완료",
  CANCELED: "취소",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  FEATURE: "기능",
  BUGFIX: "버그 수정",
  IMPROVEMENT: "개선",
  REFACTOR: "리팩터링",
  OPS: "운영",
  ETC: "기타",
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  WEB_DEV: "웹개발",
  APP_DEV: "앱개발",
  UI_DEV: "UI개발",
  PLANNING: "기획",
  DESIGN: "디자인",
  ETC: "기타",
};
