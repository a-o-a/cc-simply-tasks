/**
 * Enum 소스 오브 트루스.
 *
 * SQLite는 native enum을 지원하지 않아 Drizzle 스키마의 해당 컬럼은 String으로 저장된다.
 * 런타임 검증은 zod가 이 배열을 기반으로 수행하고, 타입은 여기서 export된 union 타입을 쓴다.
 *
 * Postgres 이관 시:
 *  - Drizzle 스키마의 String 컬럼을 enum 타입으로 교체
 *  - 이 파일의 값과 DB enum 값을 동일하게 유지
 */

export const STATUSES = [
  "WAITING",
  "IN_PROGRESS",
  "INTERNAL_TEST",
  "BUSINESS_TEST",
  "QA_TEST",
  "TRANSFER_READY",
  "TRANSFERRED",
  "HOLDING",
] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MEMBER_ROLES = [
  "WEB_DEV",
  "APP_DEV",
  "UI_DEV",
  "PLANNING",
  "DESIGN",
  "ETC",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const CALENDAR_EVENT_CATEGORIES = [
  "HOLIDAY",
  "WORK",
  "ABSENCE",
  "ETC",
] as const;
export type CalendarEventCategory = (typeof CALENDAR_EVENT_CATEGORIES)[number];

export const ACTOR_TYPES = ["ANONYMOUS"] as const; // 추후 "USER" 추가
export type ActorType = (typeof ACTOR_TYPES)[number];

export const AUDIT_ACTIONS = ["CREATE", "UPDATE", "DELETE", "RESTORE"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const TODO_STATUSES = ["OPEN", "DONE"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const AUDIT_ENTITY_TYPES = [
  "WorkItem",
  "WorkTicket",
  "CalendarEvent",
  "TeamMember",
  "WorkSystem",
  "WorkCategory",
  "Todo",
  "TodoChecklist",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
