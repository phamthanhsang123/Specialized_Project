import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const scannedRoots = ["app", "lib"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

function sourceFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return sourceExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

test("frontend uses backend API data instead of legacy mock-data module", () => {
  assert.equal(fs.existsSync(path.join("lib", "mock-data.ts")), false);
  const offenders = scannedRoots
    .flatMap(sourceFiles)
    .filter((file) => fs.readFileSync(file, "utf8").includes("mock-data"));
  assert.deepEqual(offenders, []);
});
