CREATE TABLE `TodoChecklist` (
	`id` text PRIMARY KEY NOT NULL,
	`todoId` text NOT NULL,
	`content` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`assigneeId` text,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`todoId`) REFERENCES `Todo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigneeId`) REFERENCES `TeamMember`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `TodoChecklist_todoId_order_idx` ON `TodoChecklist` (`todoId`,`order`);--> statement-breakpoint
CREATE INDEX `TodoChecklist_assigneeId_done_idx` ON `TodoChecklist` (`assigneeId`,`done`);--> statement-breakpoint
CREATE INDEX `TodoChecklist_deletedAt_idx` ON `TodoChecklist` (`deletedAt`);--> statement-breakpoint
CREATE TABLE `Todo` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`dueDate` integer,
	`order` integer DEFAULT 0 NOT NULL,
	`assigneeId` text,
	`createdAt` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`assigneeId`) REFERENCES `TeamMember`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `Todo_assigneeId_status_idx` ON `Todo` (`assigneeId`,`status`);--> statement-breakpoint
CREATE INDEX `Todo_deletedAt_idx` ON `Todo` (`deletedAt`);--> statement-breakpoint
CREATE INDEX `Todo_status_idx` ON `Todo` (`status`);