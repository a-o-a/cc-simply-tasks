const path = require("path");
const [temporary, ...files] = process.argv.slice(2);

(async () => {
  for (const file of files) {
    const exports = require(path.join(temporary, "tests", file.replace(/\.ts$/, ".js")));
    const runners = Object.entries(exports).filter(([name, run]) => name.startsWith("run") && typeof run === "function");
    if (!runners.length) throw new Error(`No test runner exported by ${file}`);
    for (const [, run] of runners) await run();
    console.log(`PASS ${file}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
