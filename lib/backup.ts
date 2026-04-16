import path from "path";
import fs from "fs";
import { getSqliteDbPath, getSqlite } from "@/lib/db";

const BACKUP_RETAIN_DAYS = 7;

function getBackupDir() {
  return path.dirname(getSqliteDbPath());
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function backupFilename(date: string) {
  return `backup_${date}.db`;
}

/** db/ 디렉터리의 백업 파일 목록을 최신순으로 반환 */
export function listBackupFiles(): { filename: string; size: number; date: string }[] {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => /^backup_\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .map((filename) => {
      const stat = fs.statSync(path.join(dir, filename));
      const date = filename.replace("backup_", "").replace(".db", "");
      return { filename, size: stat.size, date };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 7일 이전 백업 파일 삭제 */
function pruneOldBackups() {
  const dir = getBackupDir();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETAIN_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (const { filename, date } of listBackupFiles()) {
    if (date < cutoffStr) {
      try {
        fs.unlinkSync(path.join(dir, filename));
        console.log(`[backup] 오래된 백업 삭제: ${filename}`);
      } catch (e) {
        console.error(`[backup] 삭제 실패: ${filename}`, e);
      }
    }
  }
}

/** SQLite VACUUM INTO로 스냅샷 백업 생성 */
export async function runBackup(): Promise<string> {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const date = todayStr();
  const destPath = path.join(dir, backupFilename(date));

  const sqlite = getSqlite();
  await sqlite.execute(`VACUUM INTO '${destPath}'`);
  console.log(`[backup] 백업 완료: ${destPath}`);

  pruneOldBackups();
  return destPath;
}
