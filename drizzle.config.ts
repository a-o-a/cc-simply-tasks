import path from "path";
import { defineConfig } from "drizzle-kit";

const rawUrl = process.env.DATABASE_URL ?? "file:./db/dev.db";
const relativePath = rawUrl.startsWith("file:")
  ? rawUrl.slice("file:".length)
  : rawUrl;
const sqlitePath = path.isAbsolute(relativePath)
  ? relativePath
  : path.resolve(process.cwd(), relativePath);

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: sqlitePath,
  },
});
