import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const teamMembers = sqliteTable(
  "TeamMember",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => ({
    deletedAtIdx: index("TeamMember_deletedAt_idx").on(table.deletedAt),
  }),
);

export const workItems = sqliteTable(
  "WorkItem",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    additionalNotes: text("additionalNotes"),
    category: text("category").notNull().default(""),
    status: text("status").notNull().default("WAITING"),
    priority: text("priority").notNull().default("NORMAL"),
    order: integer("order").notNull().default(0),
    assigneeId: text("assigneeId").references(() => teamMembers.id, {
      onDelete: "set null",
    }),
    startDate: integer("startDate", { mode: "timestamp_ms" }),
    endDate: integer("endDate", { mode: "timestamp_ms" }),
    transferDate: integer("transferDate", { mode: "timestamp_ms" }),
    requestType: text("requestType"),
    requestor: text("requestor"),
    requestNumber: text("requestNumber"),
    requestContent: text("requestContent"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => ({
    assigneeStatusIdx: index("WorkItem_assigneeId_status_idx").on(
      table.assigneeId,
      table.status,
    ),
    transferDateIdx: index("WorkItem_transferDate_idx").on(table.transferDate),
    startEndIdx: index("WorkItem_startDate_endDate_idx").on(
      table.startDate,
      table.endDate,
    ),
    deletedAtIdx: index("WorkItem_deletedAt_idx").on(table.deletedAt),
    statusIdx: index("WorkItem_status_idx").on(table.status),
  }),
);

export const workTickets = sqliteTable(
  "WorkTicket",
  {
    id: text("id").primaryKey(),
    workItemId: text("workItemId")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    systemName: text("systemName").notNull(),
    ticketNumber: text("ticketNumber").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => ({
    workItemIdx: index("WorkTicket_workItemId_idx").on(table.workItemId),
    deletedAtIdx: index("WorkTicket_deletedAt_idx").on(table.deletedAt),
  }),
);

export const calendarEvents = sqliteTable(
  "CalendarEvent",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category").notNull().default("ETC"),
    startDateTime: integer("startDateTime", { mode: "timestamp_ms" }).notNull(),
    endDateTime: integer("endDateTime", { mode: "timestamp_ms" }).notNull(),
    allDay: integer("allDay", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => ({
    startEndIdx: index("CalendarEvent_startDateTime_endDateTime_idx").on(
      table.startDateTime,
      table.endDateTime,
    ),
    deletedAtIdx: index("CalendarEvent_deletedAt_idx").on(table.deletedAt),
  }),
);

export const calendarEventMembers = sqliteTable(
  "CalendarEventMember",
  {
    eventId: text("eventId")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    memberId: text("memberId")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.eventId, table.memberId] }),
    memberIdx: index("CalendarEventMember_memberId_idx").on(table.memberId),
  }),
);

export const settings = sqliteTable("Setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const workCategories = sqliteTable(
  "WorkCategory",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => ({
    codeKey: uniqueIndex("WorkCategory_code_key").on(table.code),
    deletedAtIdx: index("WorkCategory_deletedAt_idx").on(table.deletedAt),
  }),
);

export const workSystems = sqliteTable(
  "WorkSystem",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => ({
    codeKey: uniqueIndex("WorkSystem_code_key").on(table.code),
    deletedAtIdx: index("WorkSystem_deletedAt_idx").on(table.deletedAt),
  }),
);

export const auditLogs = sqliteTable(
  "AuditLog",
  {
    id: text("id").primaryKey(),
    entityType: text("entityType").notNull(),
    entityId: text("entityId").notNull(),
    action: text("action").notNull(),
    beforeJson: text("beforeJson"),
    afterJson: text("afterJson"),
    actorType: text("actorType").notNull().default("ANONYMOUS"),
    actorName: text("actorName"),
    actorIp: text("actorIp"),
    userAgent: text("userAgent"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    entityIdx: index("AuditLog_entityType_entityId_createdAt_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    createdAtIdx: index("AuditLog_createdAt_idx").on(table.createdAt),
  }),
);

export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type WorkItemRow = typeof workItems.$inferSelect;
export type WorkTicketRow = typeof workTickets.$inferSelect;
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type CalendarEventMemberRow = typeof calendarEventMembers.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
export type WorkCategoryRow = typeof workCategories.$inferSelect;
export type WorkSystemRow = typeof workSystems.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
