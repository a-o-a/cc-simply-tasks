import { runBackup } from "./backup";
import { schedule, validate } from "node-cron";

const state = globalThis as typeof globalThis & { _backupTask?: { stop(): void } };

export function startBackupSchedule() {
  if (state._backupTask) return;
  const expression = process.env.BACKUP_CRON ?? "0 0 2 * * *";
  if (!validate(expression)) throw new Error("BACKUP_CRON 설정이 올바르지 않습니다");
  state._backupTask = schedule(expression, async () => {
    try {
      await runBackup();
      console.log("[backup] 자동 백업 완료");
    } catch (error) {
      console.error("[backup] 자동 백업 실패:", error);
    }
  });
}
