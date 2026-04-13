/*
  Warnings:

  - You are about to drop the column `memberId` on the `CalendarEvent` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "CalendarEventMember" (
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    PRIMARY KEY ("eventId", "memberId"),
    CONSTRAINT "CalendarEventMember_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEventMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ETC',
    "startDateTime" DATETIME NOT NULL,
    "endDateTime" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);
INSERT INTO "new_CalendarEvent" ("allDay", "category", "createdAt", "deletedAt", "endDateTime", "id", "note", "startDateTime", "title", "updatedAt") SELECT "allDay", "category", "createdAt", "deletedAt", "endDateTime", "id", "note", "startDateTime", "title", "updatedAt" FROM "CalendarEvent";
DROP TABLE "CalendarEvent";
ALTER TABLE "new_CalendarEvent" RENAME TO "CalendarEvent";
CREATE INDEX "CalendarEvent_startDateTime_endDateTime_idx" ON "CalendarEvent"("startDateTime", "endDateTime");
CREATE INDEX "CalendarEvent_deletedAt_idx" ON "CalendarEvent"("deletedAt");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE INDEX "CalendarEventMember_memberId_idx" ON "CalendarEventMember"("memberId");
