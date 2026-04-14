/**
 * 클라이언트에서 공유하는 도메인 타입.
 *
 * Prisma client의 타입을 그대로 import하면 서버 코드가 클라이언트 번들로
 * 끌려올 수 있어, 화면에서 다루는 모양만 손으로 정의한다. (1차 범위 한정)
 */

import type {
  MemberRole,
  Priority,
  Status,
  AuditAction,
  AuditEntityType,
} from "@/lib/enums";

export type Member = {
  id: string;
  name: string;
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
};

export type WorkTicket = {
  id: string;
  workItemId: string;
  systemName: string;
  ticketNumber: string;
  createdAt: string;
  updatedAt: string;
};

/** 목록 응답에 들어 있는 work item (assignee include). */
export type WorkItemListItem = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: Status;
  priority: Priority;
  order: number;
  assigneeId: string | null;
  startDate: string | null;
  endDate: string | null;
  transferDate: string | null;
  requestType: string | null;
  requestor: string | null;
  requestNumber: string | null;
  requestContent: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: Member | null;
};

/** 상세 응답: 위에 tickets 추가. */
export type WorkItemDetail = WorkItemListItem & {
  tickets: WorkTicket[];
};

export type CalendarEventCategory = "HOLIDAY" | "WORK" | "ABSENCE" | "ETC";

export type CalendarEvent = {
  id: string;
  title: string;
  category: CalendarEventCategory;
  startDateTime: string;
  endDateTime: string;
  allDay: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  members: { member: Member }[];
};

export type AuditLog = {
  id: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  beforeJson: string | null;
  afterJson: string | null;
  actorType: string;
  actorName: string | null;
  actorIp: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type WorkSystem = {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkCategory = {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  service_name: string;
};

export type ListResponse<T> = { items: T[]; nextCursor: string | null };
