export async function register() {
  // Keep Node-only imports in this branch so the Edge compiler can remove them.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupSchedule } = await import("./lib/backup-scheduler");
    startBackupSchedule();
  }
}
