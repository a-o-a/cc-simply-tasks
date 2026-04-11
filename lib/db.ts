import { PrismaClient } from "@prisma/client";

// Prisma 싱글톤. Next.js dev 모드 HMR에서 다중 인스턴스 생성 방지.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPragmaApplied: boolean | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * SQLite PRAGMA를 첫 연결 시 1회 적용.
 *  - journal_mode=WAL: 동시 reader/writer 처리 개선
 *  - busy_timeout=5000: write 경합 시 최대 5초 대기 (SQLITE_BUSY 완화)
 *  - foreign_keys=ON: FK 제약 활성화 (SQLite 기본은 OFF)
 *
 * Postgres 이관 시 이 함수는 no-op으로 바꾸거나 제거.
 */
let pragmaPromise: Promise<void> | null = null;
export function ensureSqlitePragma(): Promise<void> {
  if (globalForPrisma.prismaPragmaApplied) return Promise.resolve();
  if (pragmaPromise) return pragmaPromise;

  pragmaPromise = (async () => {
    try {
      await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
      await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
      globalForPrisma.prismaPragmaApplied = true;
    } catch (err) {
      // PRAGMA 실패는 치명적이지 않지만 로그에 남김.
      // eslint-disable-next-line no-console
      console.warn("[db] failed to apply SQLite PRAGMA:", err);
    }
  })();

  return pragmaPromise;
}
