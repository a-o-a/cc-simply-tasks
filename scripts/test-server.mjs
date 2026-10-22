import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const root = fileURLToPath(new URL("../", import.meta.url));

async function unusedPort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit");
  server.kill("SIGTERM");
  const timeout = setTimeout(() => server.kill("SIGKILL"), 5_000);
  timeout.unref();
  await exited;
  clearTimeout(timeout);
}

// These suites always own their server and database. Never accept an external
// URL: browser/API writes and backups must only affect disposable test data.
export async function startTestServer(t) {
  await access(path.join(root, ".next", "BUILD_ID"));
  const directory = await mkdtemp(path.join(tmpdir(), "cc-simply-tasks-smoke-"));
  const databaseUrl = pathToFileURL(path.join(directory, "smoke.db")).href;
  let server;
  let serverLog = "";
  const killOnExit = () => server?.kill("SIGTERM");
  process.once("exit", killOnExit);
  t.after(async () => {
    try {
      await stopServer(server);
    } finally {
      process.removeListener("exit", killOnExit);
      await rm(directory, { recursive: true, force: true });
    }
  });

  const sqlite = createClient({ url: databaseUrl });
  try {
    await migrate(drizzle(sqlite), { migrationsFolder: path.join(root, "drizzle") });
  } finally {
    sqlite.close();
  }

  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      // Keep automatic backups outside the test window; all backup paths still
      // resolve inside our temporary directory if a scheduler does run.
      BACKUP_CRON: "0 0 0 29 2 *",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { serverLog = (serverLog + chunk.toString()).slice(-16_000); });
  }
  let startupError;
  server.on("error", (error) => { startupError = error; });
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, `Server exited during startup:\n${serverLog}`);
    try {
      const response = await fetch(`${base}/api/settings`, { signal: AbortSignal.timeout(1_000) });
      await response.text();
      if (response.ok) { ready = true; break; }
    } catch {
      // The child has not opened its listener yet.
    }
    await delay(100);
  }
  assert.ok(ready, `Server did not become ready:\n${serverLog}`);

  return { directory, base, serverLog: () => serverLog };
}
