export async function register() {
  // Edge runtime에서는 실행하지 않음
  if (process.env.NEXT_RUNTIME === "edge") return;

  const cron = process.env.BACKUP_CRON ?? "0 0 2 * * *";
  const backupRetainDays = 7;
  const runtimeImport = (specifier: string) =>
    (0, eval)(`import(${JSON.stringify(specifier)})`) as Promise<any>;
  const runtimeRequire = eval("require") as NodeRequire;

  const { default: nodeCron } = await runtimeImport("node-cron");
  const runBackup = async () => {
    const path = runtimeRequire("path") as typeof import("path");
    const fs = runtimeRequire("fs") as typeof import("fs");
    const { pathToFileURL } = runtimeRequire("url") as typeof import("url");
    const { createClient } = runtimeRequire("@libsql/client/node") as typeof import("@libsql/client/node");

    const rawUrl = process.env.DATABASE_URL ?? "file:./db/dev.db";
    if (!rawUrl.startsWith("file:")) {
      throw new Error("Only sqlite file DATABASE_URL values are supported");
    }

    const filePath = rawUrl.slice("file:".length);
    const dbPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const backupDir = path.dirname(dbPath);
    const date = new Date().toISOString().slice(0, 10);
    const destPath = path.join(backupDir, `backup_${date}.db`);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const sqlite = createClient({ url: pathToFileURL(dbPath).toString() });
    try {
      await sqlite.execute(`VACUUM INTO '${destPath}'`);
    } finally {
      sqlite.close();
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - backupRetainDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const filename of fs.readdirSync(backupDir)) {
      if (!/^backup_\d{4}-\d{2}-\d{2}\.db$/.test(filename)) continue;

      const backupDate = filename.replace("backup_", "").replace(".db", "");
      if (backupDate < cutoffStr) {
        try {
          fs.unlinkSync(path.join(backupDir, filename));
          console.log(`[backup] 오래된 백업 삭제: ${filename}`);
        } catch (e) {
          console.error(`[backup] 삭제 실패: ${filename}`, e);
        }
      }
    }

    return destPath;
  };

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
