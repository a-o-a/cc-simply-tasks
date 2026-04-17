/**
 * Enum 값 → 한글 표시 라벨.
 *
 * `lib/enums.ts`가 값/타입의 소스 오브 트루스이고, 이 파일은 표시 전용 매핑이다.
 * UI에서 enum 값을 그대로 렌더링하지 말고 항상 이 라벨을 거치게 한다.
 */

import type { MemberRole, Priority, Status, TodoStatus } from "./enums";

export const STATUS_LABELS: Record<Status, string> = {
  WAITING: "대기",
  IN_PROGRESS: "진행 중",
  INTERNAL_TEST: "내부테스트",
  BUSINESS_TEST: "현업테스트",
  QA_TEST: "QA테스트",
  TRANSFER_READY: "이관대기",
  TRANSFERRED: "이관완료",
  HOLDING: "홀딩",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  WEB_DEV: "웹개발",
  APP_DEV: "앱개발",
  UI_DEV: "UI개발",
  PLANNING: "기획",
  DESIGN: "디자인",
  ETC: "기타",
};

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  OPEN: "진행 중",
  DONE: "완료",
};
