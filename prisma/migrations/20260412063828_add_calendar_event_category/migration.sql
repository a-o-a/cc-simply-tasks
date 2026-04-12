-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "memberId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ETC',
    "startDateTime" DATETIME NOT NULL,
    "endDateTime" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "CalendarEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CalendarEvent" ("allDay", "createdAt", "deletedAt", "endDateTime", "id", "memberId", "note", "startDateTime", "title", "updatedAt") SELECT "allDay", "createdAt", "deletedAt", "endDateTime", "id", "memberId", "note", "startDateTime", "title", "updatedAt" FROM "CalendarEvent";
DROP TABLE "CalendarEvent";
ALTER TABLE "new_CalendarEvent" RENAME TO "CalendarEvent";
CREATE INDEX "CalendarEvent_startDateTime_endDateTime_idx" ON "CalendarEvent"("startDateTime", "endDateTime");
CREATE INDEX "CalendarEvent_memberId_idx" ON "CalendarEvent"("memberId");
CREATE INDEX "CalendarEvent_deletedAt_idx" ON "CalendarEvent"("deletedAt");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
