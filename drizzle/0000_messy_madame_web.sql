CREATE TABLE `AuditLog` (
	`id` text PRIMARY KEY NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`action` text NOT NULL,
	`beforeJson` text,
	`afterJson` text,
	`actorType` text DEFAULT 'ANONYMOUS' NOT NULL,
	`actorName` text,
	`actorIp` text,
	`userAgent` text,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `AuditLog_entityType_entityId_createdAt_idx` ON `AuditLog` (`entityType`,`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `AuditLog_createdAt_idx` ON `AuditLog` (`createdAt`);--> statement-breakpoint
CREATE TABLE `CalendarEventMember` (
	`eventId` text NOT NULL,
	`memberId` text NOT NULL,
	PRIMARY KEY(`eventId`, `memberId`),
	FOREIGN KEY (`eventId`) REFERENCES `CalendarEvent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memberId`) REFERENCES `TeamMember`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `CalendarEventMember_memberId_idx` ON `CalendarEventMember` (`memberId`);--> statement-breakpoint
CREATE TABLE `CalendarEvent` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT 'ETC' NOT NULL,
	`startDateTime` integer NOT NULL,
	`endDateTime` integer NOT NULL,
	`allDay` integer DEFAULT false NOT NULL,
	`note` text,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE INDEX `CalendarEvent_startDateTime_endDateTime_idx` ON `CalendarEvent` (`startDateTime`,`endDateTime`);--> statement-breakpoint
CREATE INDEX `CalendarEvent_deletedAt_idx` ON `CalendarEvent` (`deletedAt`);--> statement-breakpoint
CREATE TABLE `Setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `TeamMember` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE INDEX `TeamMember_deletedAt_idx` ON `TeamMember` (`deletedAt`);--> statement-breakpoint
CREATE TABLE `WorkCategory` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `WorkCategory_code_key` ON `WorkCategory` (`code`);--> statement-breakpoint
CREATE INDEX `WorkCategory_deletedAt_idx` ON `WorkCategory` (`deletedAt`);--> statement-breakpoint
CREATE TABLE `WorkItem` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`additionalNotes` text,
	`category` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'WAITING' NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`assigneeId` text,
	`startDate` integer,
	`endDate` integer,
	`transferDate` integer,
	`requestType` text,
	`requestor` text,
	`requestNumber` text,
	`requestContent` text,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`assigneeId`) REFERENCES `TeamMember`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `WorkItem_assigneeId_status_idx` ON `WorkItem` (`assigneeId`,`status`);--> statement-breakpoint
CREATE INDEX `WorkItem_transferDate_idx` ON `WorkItem` (`transferDate`);--> statement-breakpoint
CREATE INDEX `WorkItem_startDate_endDate_idx` ON `WorkItem` (`startDate`,`endDate`);--> statement-breakpoint
CREATE INDEX `WorkItem_deletedAt_idx` ON `WorkItem` (`deletedAt`);--> statement-breakpoint
CREATE INDEX `WorkItem_status_idx` ON `WorkItem` (`status`);--> statement-breakpoint
CREATE TABLE `WorkSystem` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `WorkSystem_code_key` ON `WorkSystem` (`code`);--> statement-breakpoint
CREATE INDEX `WorkSystem_deletedAt_idx` ON `WorkSystem` (`deletedAt`);--> statement-breakpoint
CREATE TABLE `WorkTicket` (
	`id` text PRIMARY KEY NOT NULL,
	`workItemId` text NOT NULL,
	`systemName` text NOT NULL,
	`ticketNumber` text NOT NULL,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`workItemId`) REFERENCES `WorkItem`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `WorkTicket_workItemId_idx` ON `WorkTicket` (`workItemId`);--> statement-breakpoint
CREATE INDEX `WorkTicket_deletedAt_idx` ON `WorkTicket` (`deletedAt`);