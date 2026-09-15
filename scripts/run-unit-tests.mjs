import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const testDirectory = resolve("tests", "unit");
const testFiles = readdirSync(testDirectory)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => resolve(testDirectory, name));

if (!testFiles.length) {
  console.error("Không tìm thấy bài kiểm thử unit nào.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
