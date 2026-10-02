// Use the TypeScript CLI so tests do not depend on its JavaScript compiler API.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const files = fs.readdirSync(path.join(root, "tests")).filter((name) => name.endsWith(".test.ts")).sort();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-simply-tasks-tests-"));

async function main() {
  if (!files.length) throw new Error("No test modules found");
  const output = path.join(temporary, "compiled");
  const configPath = path.join(temporary, "tsconfig.json");
  fs.writeFileSync(configPath, JSON.stringify({
    extends: path.join(root, "tsconfig.json"),
    compilerOptions: {
      noEmit: false,
      noEmitOnError: true,
      incremental: false,
      isolatedModules: false,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
      rootDir: root,
      outDir: output,
    },
    files: files.map((file) => path.join(root, "tests", file)),
    include: [],
  }, null, 2));
  // Explicit type libraries resolve relative to this temporary tsconfig.
  fs.symlinkSync(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "junction");
  const packagePath = require.resolve("typescript/package.json");
  const packageInfo = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const compilerBin = typeof packageInfo.bin === "string"
    ? packageInfo.bin
    : packageInfo.bin?.tsc ?? Object.entries(packageInfo.bin ?? {}).find(([name]) => /^tsc\d+$/.test(name))?.[1];
  if (!compilerBin) throw new Error("The installed TypeScript package has no compiler executable");
  const compiler = path.resolve(path.dirname(packagePath), compilerBin);
  const compilation = spawnSync(process.execPath, [compiler, "--project", configPath, "--pretty", "false"], {
    stdio: "inherit",
    cwd: root,
  });
  if (compilation.error) throw compilation.error;
  if (compilation.status !== 0) {
    process.exitCode = compilation.status ?? 1;
    return;
  }
  const child = spawnSync(process.execPath, [path.join(__dirname, "test-worker.cjs"), output, ...files], {
    stdio: "inherit",
    cwd: root,
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(temporary, { recursive: true, force: true }));
