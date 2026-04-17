import path from "path";
import fs from "fs";
import { getSqliteDbPath, getSqlite } from "@/lib/db";

const BACKUP_RETAIN_DAYS = 7;
const BACKUP_FILENAME_RE = /^backup_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?\.db$/;

function getBackupDir() {
  return path.dirname(getSqliteDbPath());
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function backupTimestamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

function localDateStr(date = new Date()) {
  return backupTimestamp(date).slice(0, 10);
}

function backupFilename(timestamp: string) {
  return `backup_${timestamp}.db`;
}

/** db/ 디렉터리의 백업 파일 목록을 최신순으로 반환 */
export function listBackupFiles(): { filename: string; size: number; date: string }[] {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => BACKUP_FILENAME_RE.test(f))
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
  const cutoffStr = localDateStr(cutoff);

  for (const { filename, date } of listBackupFiles()) {
    if (date.slice(0, 10) < cutoffStr) {
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

  const timestamp = backupTimestamp();
  const destPath = path.join(dir, backupFilename(timestamp));

  const sqlite = getSqlite();
  await sqlite.execute(`VACUUM INTO '${destPath}'`);
  console.log(`[backup] 백업 완료: ${destPath}`);

  pruneOldBackups();
  return destPath;
}
