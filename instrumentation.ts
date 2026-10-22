import type { ScheduledTask } from "node-cron";

const globalForBackup = globalThis as typeof globalThis & {
  backupSchedule?: { expression: string; task: ScheduledTask };
};

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ default: nodeCron }, { runBackup }] = await Promise.all([
      import("node-cron"),
      import("./lib/backup"),
    ]);
    const expression = process.env.BACKUP_CRON ?? "0 0 2 * * *";

    if (globalForBackup.backupSchedule?.expression === expression) return;

    if (!nodeCron.validate(expression)) {
      console.error(`[backup] 잘못된 BACKUP_CRON 표현식: "${expression}"`);
      return;
    }

    await globalForBackup.backupSchedule?.task.destroy();
    const task = nodeCron.schedule(expression, async () => {
      console.log("[backup] 자동 백업 시작...");
      try {
        const dest = await runBackup();
        console.log(`[backup] 자동 백업 완료: ${dest}`);
      } catch (e) {
        console.error("[backup] 자동 백업 실패:", e);
      }
    }, {
      name: "database-backup",
      noOverlap: true,
    });

    globalForBackup.backupSchedule = { expression, task };
    console.log(`[backup] 자동 백업 스케줄 등록됨 (${expression})`);
  }
}
