-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ETC',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "order" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "transferDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "WorkItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workItemId" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "ticketUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "WorkTicket_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "memberId" TEXT,
    "startDateTime" DATETIME NOT NULL,
    "endDateTime" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "CalendarEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'ANONYMOUS',
    "actorName" TEXT,
    "actorIp" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TeamMember_deletedAt_idx" ON "TeamMember"("deletedAt");

-- CreateIndex
CREATE INDEX "WorkItem_assigneeId_status_idx" ON "WorkItem"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkItem_transferDate_idx" ON "WorkItem"("transferDate");

-- CreateIndex
CREATE INDEX "WorkItem_startDate_endDate_idx" ON "WorkItem"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "WorkItem_deletedAt_idx" ON "WorkItem"("deletedAt");

-- CreateIndex
CREATE INDEX "WorkItem_status_idx" ON "WorkItem"("status");

-- CreateIndex
CREATE INDEX "WorkTicket_workItemId_idx" ON "WorkTicket"("workItemId");

-- CreateIndex
CREATE INDEX "WorkTicket_ticketNumber_idx" ON "WorkTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "WorkTicket_deletedAt_idx" ON "WorkTicket"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTicket_workItemId_systemName_ticketNumber_key" ON "WorkTicket"("workItemId", "systemName", "ticketNumber");

-- CreateIndex
CREATE INDEX "CalendarEvent_startDateTime_endDateTime_idx" ON "CalendarEvent"("startDateTime", "endDateTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_memberId_idx" ON "CalendarEvent"("memberId");

-- CreateIndex
CREATE INDEX "CalendarEvent_deletedAt_idx" ON "CalendarEvent"("deletedAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
