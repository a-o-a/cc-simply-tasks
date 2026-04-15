import { NextResponse, type NextRequest } from "next/server";
import { db, ensureSqlitePragma } from "@/lib/db";
import { desc } from "drizzle-orm";
import { withErrorHandler } from "@/lib/http";
import { now } from "@/lib/db/helpers";
import { settings } from "@/lib/db/schema";
import { settingUpdateSchema } from "@/lib/validation/setting";

const DEFAULT_SETTINGS = {
  service_name: "cc-simply-tasks",
};

/**
 * GET /api/settings
 * 전체 설정 반환. 없는 키는 기본값으로 채운다.
 */
export const GET = withErrorHandler(async () => {
  await ensureSqlitePragma();
  const rows = await db.select().from(settings).orderBy(desc(settings.updatedAt));
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  return NextResponse.json({
    service_name: map["service_name"] ?? DEFAULT_SETTINGS.service_name,
  });
});

/**
 * PATCH /api/settings
 * 설정 upsert. 감사 로그 불필요 (시스템 설정).
 */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const input = settingUpdateSchema.parse(await req.json());
  const updatedAt = now();

  const updates: { key: string; value: string }[] = [];
  if (input.service_name !== undefined) {
    updates.push({ key: "service_name", value: input.service_name });
  }

  db.transaction((tx) => {
    for (const { key, value } of updates) {
      tx
        .insert(settings)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt },
        })
        .run();
    }
  });

  const rows = await db.select().from(settings).orderBy(desc(settings.updatedAt));
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  return NextResponse.json({
    service_name: map["service_name"] ?? DEFAULT_SETTINGS.service_name,
  });
});
