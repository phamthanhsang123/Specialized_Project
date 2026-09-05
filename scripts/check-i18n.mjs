import fs from "node:fs";
import assert from "node:assert/strict";
const vi = JSON.parse(fs.readFileSync("locales/vi.json", "utf8"));
const en = JSON.parse(fs.readFileSync("locales/en.json", "utf8"));
const placeholders = value => [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map(m => m[1]).sort();
for (const [key, value] of Object.entries(vi)) {
  const translations = en[key] ? [en[key]] : [en[key + "_one"], en[key + "_other"]];
  assert(translations.every(Boolean), "Missing English translation: " + key);
  for (const translation of translations)
    assert.deepEqual(placeholders(translation), placeholders(value), "Interpolation mismatch: " + key);
}
console.log("Translation coverage and interpolation checks passed: " + Object.keys(vi).length + " keys.");
