export async function register() {
  // Edge runtime에서는 실행하지 않음
  if (process.env.NEXT_RUNTIME === "edge") return;

  const cron = process.env.BACKUP_CRON ?? "0 0 2 * * *";

  const { default: nodeCron } = await import("node-cron");
  const { runBackup } = await import("@/lib/backup");

  if (!nodeCron.validate(cron)) {
    console.error(`[backup] 잘못된 BACKUP_CRON 표현식: "${cron}"`);
    return;
  }

  nodeCron.schedule(cron, async () => {
    console.log("[backup] 자동 백업 시작...");
    try {
      const dest = await runBackup();
      console.log(`[backup] 자동 백업 완료: ${dest}`);
    } catch (e) {
      console.error("[backup] 자동 백업 실패:", e);
    }
  });

  console.log(`[backup] 자동 백업 스케줄 등록됨 (${cron})`);
}
