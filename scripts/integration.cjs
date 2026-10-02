// Build and exercise a production server against a disposable database.
// Neither the developer database nor an existing .next directory is touched.
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-simply-tasks-integration-"));
let server;
let logs = "";

function copy(source, destination) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name));
  } else fs.copyFileSync(source, destination);
}

function request(port, route, { method = "GET", body, headers = {}, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body));
    const req = http.request({
      hostname: "127.0.0.1", port, path: route, method,
      headers: {
        ...(payload === undefined ? {} : { "Content-Type": "application/json", ...(chunked ? { "Transfer-Encoding": "chunked" } : { "Content-Length": Buffer.byteLength(payload) }) }),
        "x-actor-name": "integration-test", ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        try {
          const buffer = Buffer.concat(chunks);
          let json;
          if ((res.headers["content-type"] ?? "").includes("application/json")) json = JSON.parse(buffer.toString());
          resolve({ status: res.statusCode, headers: res.headers, buffer, json });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error(`Request timed out: ${route}`)));
    req.on("error", (error) => {
      error.message = `${method} ${route}: ${error.message}`;
      reject(error);
    });
    req.end(payload);
  });
}

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function main() {
  for (const directory of ["app", "components", "lib", "drizzle"]) copy(path.join(root, directory), path.join(temporary, directory));
  for (const file of ["package.json", "tsconfig.json", "next.config.js", "postcss.config.js", "postcss.config.mjs", "tailwind.config.cjs", "instrumentation.ts", "eslint.config.mjs", "next-env.d.ts"]) {
    if (fs.existsSync(path.join(root, file))) copy(path.join(root, file), path.join(temporary, file));
  }
  fs.mkdirSync(path.join(temporary, "db"));
  fs.copyFileSync(path.join(root, "db/dev.db.clean"), path.join(temporary, "db/backup_2000-01-01.db"));
  // Turbopack resolves dependencies within the isolated project filesystem.
  // Reflinks use copy-on-write where supported and otherwise fall back to copies.
  fs.cpSync(path.join(root, "node_modules"), path.join(temporary, "node_modules"), {
    recursive: true,
    mode: fs.constants.COPYFILE_FICLONE,
    verbatimSymlinks: true,
  });
  const cli = require.resolve("next/dist/bin/next", { paths: [temporary] });
  const environment = {
    ...process.env,
    DATABASE_URL: `file:${path.join(temporary, "db/backup_2000-01-01.db")}`,
    BACKUP_CRON: "0 0 0 1 1 *",
    APP_ALLOWED_ORIGINS: "",
    CI: "1", NEXT_TELEMETRY_DISABLED: "1",
  };
  const build = spawnSync(process.execPath, [cli, "build"], { cwd: temporary, env: environment, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  assert.equal(build.status, 0, `Production build failed:\n${build.stdout}\n${build.stderr}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(temporary, ".next/prerender-manifest.json")));
  assert.equal(manifest.routes["/api/db-stats"], undefined, "DB statistics must be evaluated at request time");
  console.log("PASS isolated production build");

  const port = await freePort();
  server = spawn(process.execPath, [cli, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: temporary, env: environment });
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { ready = (await request(port, "/api/settings")).status === 200; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `Server did not start: ${logs}`);

  for (const route of ["/", "/work-items", "/todos", "/calendar", "/transfer", "/settings"]) {
    const response = await request(port, route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
  }
  const create = await request(port, "/api/work-items", { method: "POST", body: {
    title: "integration work", startDate: "2026-10-02T00:00:00Z", endDate: "2026-10-03T00:00:00Z",
    tickets: [{ systemName: "A", ticketNumber: "1" }],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const workId = create.json.id;
  const stats = await request(port, "/api/db-stats");
  assert.equal(stats.json.tables.find((table) => table.name === "WorkItem").count, 1);
  assert.equal((await request(port, "/api/work-items/count")).json.total, 1);
  console.log("PASS live statistics and page responses");

  const invalidDates = await request(port, `/api/work-items/${workId}`, { method: "PATCH", body: { startDate: "2026-10-04T00:00:00Z" } });
  assert.equal(invalidDates.status, 400);
  assert.equal((await request(port, `/api/work-items/${workId}`)).json.startDate, create.json.startDate);
  const updateTickets = await request(port, `/api/work-items/${workId}`, { method: "PATCH", body: { tickets: [{ systemName: "B", ticketNumber: "2" }] } });
  assert.equal(updateTickets.status, 200);
  const audit = await request(port, `/api/audit-logs?entityType=WorkItem&entityId=${workId}`);
  const ticketUpdate = audit.json.items.find((item) => item.action === "UPDATE" && JSON.parse(item.afterJson ?? "{}").tickets);
  assert.ok(ticketUpdate, "Ticket changes must be audited");
  assert.deepEqual(JSON.parse(ticketUpdate.beforeJson).tickets, [{ systemName: "A", ticketNumber: "1" }]);
  assert.deepEqual(JSON.parse(ticketUpdate.afterJson).tickets, [{ systemName: "B", ticketNumber: "2" }]);

  assert.equal((await request(port, "/api/work-items", { method: "POST", body: { title: "blocked" }, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await request(port, "/api/work-items", { method: "POST", body: { title: "same origin" }, headers: { Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" } })).status, 201);
  assert.equal((await request(port, "/api/work-items", { method: "POST", body: "{" })).status, 400);
  assert.equal((await request(port, "/api/work-items", { method: "POST", body: { title: "x".repeat(260 * 1024) } })).status, 413);
  assert.equal((await request(port, "/api/work-items", { method: "POST", body: "title=test", headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status, 400);
  assert.equal((await request(port, "/api/work-items", { method: "POST", body: { title: "x".repeat(260 * 1024) }, chunked: true })).status, 413);
  console.log("PASS partial-date validation, audit, origin and streamed payload protections");

  for (let index = 0; index < 51; index += 1) assert.equal((await request(port, "/api/work-items", { method: "POST", body: { title: `pagination ${index}` } })).status, 201);
  const ids = [];
  let cursor;
  do {
    const page = await request(port, `/api/work-items?scope=active&pageSize=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(page.status, 200);
    assert.ok(page.json.items.length <= 20);
    ids.push(...page.json.items.map((item) => item.id));
    cursor = page.json.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 53);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((await request(port, "/api/work-items?pageSize=201")).status, 400);
  assert.equal((await request(port, "/api/work-items?cursor=page:invalid")).status, 400);
  const transferIds = ids.slice(0, 3);
  for (let index = 0; index < transferIds.length; index += 1) {
    assert.equal((await request(port, `/api/work-items/${transferIds[index]}`, { method: "PATCH", body: {
      status: "TRANSFERRED", transferDate: index === 0 ? null : `2026-10-0${index + 2}T00:00:00Z`,
    } })).status, 200);
  }
  const transferred = [];
  cursor = undefined;
  do {
    const page = await request(port, `/api/work-items?scope=transferred&pageSize=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(page.status, 200);
    transferred.push(...page.json.items.map((item) => item.id));
    cursor = page.json.nextCursor;
  } while (cursor);
  assert.deepEqual(transferred, [transferIds[2], transferIds[1], transferIds[0]]);
  const legacy = await request(port, `/api/work-items?scope=transferred&pageSize=1&cursor=${transferIds[1]}`);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.json.items[0].id, transferIds[0]);
  console.log("PASS complete cursor pagination, null dates, legacy cursors and bounded pages");

  const members = [];
  for (const name of ["first member", "second member"]) {
    const member = await request(port, "/api/team-members", { method: "POST", body: { name, role: "ETC" } });
    assert.equal(member.status, 201);
    members.push(member.json.id);
  }
  const event = await request(port, "/api/calendar-events", { method: "POST", body: {
    title: "integration event", category: "WORK", allDay: false,
    startDateTime: "2026-10-02T00:00:00Z", endDateTime: "2026-10-03T00:00:00Z", memberIds: [members[0]],
  } });
  assert.equal(event.status, 201);
  assert.equal((await request(port, `/api/calendar-events/${event.json.id}`, { method: "PATCH", body: { startDateTime: "2026-10-04T00:00:00Z" } })).status, 400);
  assert.equal((await request(port, `/api/calendar-events/${event.json.id}`, { method: "PATCH", body: { memberIds: [members[1]] } })).status, 200);
  const eventAudit = await request(port, `/api/audit-logs?entityType=CalendarEvent&entityId=${event.json.id}`);
  assert.ok(eventAudit.json.items.some((item) => JSON.stringify(item.beforeJson).includes(members[0]) && JSON.stringify(item.afterJson).includes(members[1])));
  console.log("PASS calendar partial-date validation and member audit");

  const todo = await request(port, "/api/todos", { method: "POST", body: { title: "before", checklist: [{ content: "first" }] } });
  assert.equal(todo.status, 201);
  const detail = await request(port, `/api/todos/${todo.json.id}`);
  const checklist = detail.json.checklist;
  const saved = await request(port, `/api/todos/${todo.json.id}`, { method: "PATCH", body: {
    title: "after", checklist: [{ id: checklist[0].id, content: "changed", done: true }, { content: "added" }],
  } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.title, "after");
  assert.equal(saved.json.checklist.length, 2);
  const rejected = await request(port, `/api/todos/${todo.json.id}`, { method: "PATCH", body: {
    title: "must roll back", checklist: [{ id: workId, content: "foreign child" }],
  } });
  assert.equal(rejected.status, 400);
  assert.equal((await request(port, `/api/todos/${todo.json.id}`)).json.title, "after");
  console.log("PASS atomic TODO and checklist save with rollback");

  const snapshot = await request(port, "/api/backup");
  assert.equal(snapshot.status, 200);
  const snapshotPath = path.join(temporary, "download.db");
  fs.writeFileSync(snapshotPath, snapshot.buffer);
  const { createClient } = require("@libsql/client/node");
  const sqlite = createClient({ url: `file:${snapshotPath}` });
  try {
    assert.equal((await sqlite.execute("select count(*) as count from WorkItem")).rows[0].count, 53);
    assert.equal((await sqlite.execute("pragma integrity_check")).rows[0].integrity_check, "ok");
  } finally { sqlite.close(); }
  const backups = await Promise.all([request(port, "/api/backup/trigger", { method: "POST" }), request(port, "/api/backup/trigger", { method: "POST" })]);
  for (const backup of backups) {
    assert.equal(backup.status, 200);
    assert.ok(backup.json.filename.startsWith("backup_"));
    assert.equal(backup.json.path, undefined, "Server filesystem paths must remain private");
    assert.equal((await request(port, `/api/backup/files/${backup.json.filename}`)).status, 200);
  }
  assert.equal((await request(port, "/api/backup/files/invalid.db")).status, 400);
  assert.ok(fs.existsSync(path.join(temporary, "db/backup_2000-01-01.db")), "Retention must not delete a database whose filename resembles an old backup");
  assert.equal((await request(port, "/api/work-items/count")).json.total, 53);
  const files = await request(port, "/api/backup/files");
  assert.ok(!files.json.files.some((file) => file.filename === "backup_2000-01-01.db"));
  const linkName = "backup_2026-10-02_00-00-00_deadbeef.db";
  fs.symlinkSync(snapshotPath, path.join(temporary, "db", linkName));
  assert.equal((await request(port, `/api/backup/files/${linkName}`)).status, 404);
  assert.ok(!(await request(port, "/api/backup/files")).json.files.some((file) => file.filename === linkName));
  console.log("PASS consistent streaming backup and concurrent snapshot requests");
}

main().catch((error) => {
  console.error(error);
  if (logs) console.error(logs);
  process.exitCode = 1;
}).finally(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 5000);
      server.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});
