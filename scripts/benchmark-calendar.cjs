// Compare event-to-day indexing under a fixed 42-day month window on Node 22.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-calendar-benchmark-"));
const label = process.argv[2] ?? "current";
try {
  const packagePath = require.resolve("typescript/package.json");
  const packageInfo = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const compilerBin = typeof packageInfo.bin === "string"
    ? packageInfo.bin
    : packageInfo.bin?.tsc ?? Object.entries(packageInfo.bin ?? {}).find(([name]) => /^tsc\d+$/.test(name))?.[1];
  if (!compilerBin) throw new Error("The installed TypeScript package has no compiler executable");
  const configPath = path.join(temporary, "tsconfig.json");
  const output = path.join(temporary, "compiled");
  fs.writeFileSync(configPath, JSON.stringify({
    extends: path.join(root, "tsconfig.json"),
    compilerOptions: {
      noEmit: false, noEmitOnError: true, incremental: false, isolatedModules: false,
      module: "NodeNext", moduleResolution: "NodeNext", rootDir: root, outDir: output,
    },
    files: [path.join(root, "lib/client/calendar.ts")], include: [],
  }));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "junction");
  const compilation = spawnSync(process.execPath, [path.resolve(path.dirname(packagePath), compilerBin), "--project", configPath, "--pretty", "false"], { cwd: root, encoding: "utf8" });
  if (compilation.status !== 0) throw new Error(compilation.stdout || compilation.stderr || "Compilation failed");
  const { eventDayKeys, kstMonthGrid } = require(path.join(output, "lib/client/calendar.js"));
  const grid = kstMonthGrid(2026, 9);
  const range = { fromMs: grid[0], toMs: grid[41] + 86_400_000 };
  const events = Array.from({ length: 10 }, () => ({
    startDateTime: "2006-01-01T00:00:00+09:00",
    endDateTime: "2046-01-01T00:00:00+09:00",
    allDay: true,
  }));
  function run() {
    const start = performance.now();
    let keys = 0;
    for (const event of events) keys += eventDayKeys(event, range).length;
    return { ms: performance.now() - start, keys };
  }
  run();
  const samples = Array.from({ length: 5 }, run);
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({
    label, node: process.version,
    scenario: "10 forty-year events indexed for the October 2026 month grid (42 days)",
    warmups: 1, repetitions: samples.length,
    range: { from: new Date(range.fromMs).toISOString(), to: new Date(range.toMs).toISOString() },
    samplesMs: samples.map((sample) => Number(sample.ms.toFixed(3))),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    generatedDayKeys: samples[0].keys,
    visibleDayKeys: events.length * 42,
  }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
