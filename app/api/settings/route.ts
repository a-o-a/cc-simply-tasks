import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler } from "@/lib/http";
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
  const rows = await prisma.setting.findMany();
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

  const updates: { key: string; value: string }[] = [];
  if (input.service_name !== undefined) {
    updates.push({ key: "service_name", value: input.service_name });
  }

  await prisma.$transaction(
    updates.map(({ key, value }) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    ),
  );

  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  return NextResponse.json({
    service_name: map["service_name"] ?? DEFAULT_SETTINGS.service_name,
  });
});
