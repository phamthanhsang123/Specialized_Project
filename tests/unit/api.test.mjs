import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
// Exercise the real request implementation; isolate only the translation provider.
const source = fs
  .readFileSync("lib/api.ts", "utf8")
  .replace('import { t } from "./i18n";', "const t = (key: string) => key;");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { apiFetch, ApiError, abortSessionRequests } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const hangingFetch = (_url, { signal }) =>
  new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
test("timeout produces an uncertain mutation error and sends only once", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", (...args) => {
    calls++;
    return hangingFetch(...args);
  });
  await assert.rejects(
    apiFetch("/projects/p1/apply", { method: "POST", timeoutMs: 20 }),
    (e) =>
      e instanceof ApiError &&
      e.uncertain &&
      e.message.includes("quá thời gian"),
  );
  assert.equal(calls, 1);
});
test("caller cancellation and session cancellation abort in-flight requests", async (t) => {
  t.mock.method(globalThis, "fetch", hangingFetch);
  const controller = new AbortController();
  const call = apiFetch("/projects", {
    signal: controller.signal,
    timeoutMs: 1000,
  });
  controller.abort();
  await assert.rejects(call, (e) => e.name === "AbortError");
  const other = apiFetch("/projects", { timeoutMs: 1000 });
  abortSessionRequests();
  await assert.rejects(other, (e) => e.name === "AbortError");
});
test("server errors are uncertain for mutations, validation rejections are not", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response('{"detail":"server error"}', { status: 503 }),
  );
  await assert.rejects(
    apiFetch("/apply", { method: "POST" }),
    (e) => e.uncertain === true,
  );
  await assert.rejects(apiFetch("/projects"), (e) => e.uncertain === false);
  globalThis.fetch = async () =>
    new Response('{"detail":"invalid"}', { status: 422 });
  await assert.rejects(
    apiFetch("/apply", { method: "POST" }),
    (e) => e.uncertain === false,
  );
});
test("timeout covers response body reads, not only response headers", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => ({
    ok: true,
    status: 200,
    text: () => hangingFetch("", { signal }),
  }));
  await assert.rejects(
    apiFetch("/projects", { timeoutMs: 20 }),
    (e) => e instanceof ApiError && e.status === 0,
  );
});
