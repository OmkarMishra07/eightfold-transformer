// Minimal, dependency-free test runner (assignment says tests are optional --
// keeping this framework-free so `npm test` has zero extra install surface).
import assert from "node:assert";
import { normalizePhoneE164, normalizeDateYYYYMM, normalizeCountryISO, normalizeSkillName } from "../src/pipeline/normalize.js";
import { matchFragments, combineGroup, resolveCandidate, type Fragment } from "../src/pipeline/merge.js";
import { parseRecruiterCsv, csvRowToFragment } from "../src/sources/recruiterCsv.js";
import { validateConfig } from "../src/pipeline/validate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  FAIL - ${name}\n    ${e.message}`);
    failed++;
  }
}

console.log("normalize.ts");
test("E.164: bare 10-digit Indian number gets +91 prefix", () => {
  assert.strictEqual(normalizePhoneE164("9876543210"), "+919876543210");
});
test("E.164: already-international number passes through", () => {
  assert.strictEqual(normalizePhoneE164("+1-415-555-0100"), "+14155550100");
});
test("E.164: garbage phone returns null, never a fabricated number", () => {
  assert.strictEqual(normalizePhoneE164("not-a-phone"), null);
});
test("dates: 'Jan 2021' -> 2021-01", () => {
  assert.strictEqual(normalizeDateYYYYMM("Jan 2021"), "2021-01");
});
test("dates: 'Present' -> null (caller treats null end as current)", () => {
  assert.strictEqual(normalizeDateYYYYMM("Present"), null);
});
test("country: 'India' -> IN", () => {
  assert.strictEqual(normalizeCountryISO("India"), "IN");
});
test("country: unrecognized text -> null, not a guess", () => {
  assert.strictEqual(normalizeCountryISO("Narnia"), null);
});
test("skills: aliases collapse to one canonical spelling", () => {
  assert.strictEqual(normalizeSkillName("ReactJS"), "react");
  assert.strictEqual(normalizeSkillName("react.js"), "react");
});

console.log("\nrecruiterCsv.ts (malformed input handling)");
test("malformed row (wrong cell count) is skipped, not crashed on", () => {
  const tmp = path.join(os.tmpdir(), `test-${Date.now()}.csv`);
  fs.writeFileSync(tmp, "name,email\nGood Row,good@example.com\nBad,Row,Extra,Cells\n");
  const { rows, warnings } = parseRecruiterCsv(tmp);
  assert.strictEqual(rows.length, 1);
  assert.ok(warnings.some((w) => w.includes("skipped")));
  fs.unlinkSync(tmp);
});
test("empty file produces zero rows and a warning, not a throw", () => {
  const tmp = path.join(os.tmpdir(), `test-empty-${Date.now()}.csv`);
  fs.writeFileSync(tmp, "");
  const { rows, warnings } = parseRecruiterCsv(tmp);
  assert.strictEqual(rows.length, 0);
  assert.ok(warnings.length > 0);
  fs.unlinkSync(tmp);
});

console.log("\nmerge.ts (matching + conflict resolution)");
test("two sources sharing an email merge into ONE candidate", () => {
  const fragA: Fragment = { _matchHints: ["email:a@x.com"], fullName: [{ value: "A Name", source: "recruiter_csv", method: "direct_field", confidence: 0.7 }], emails: [{ value: "a@x.com", source: "recruiter_csv", method: "direct_field", confidence: 0.7 }] };
  const fragB: Fragment = { _matchHints: ["email:a@x.com"], headline: [{ value: "Engineer", source: "github", method: "api_fetch", confidence: 0.5 }], emails: [{ value: "a@x.com", source: "github", method: "api_fetch", confidence: 0.55 }] };
  const groups = matchFragments([fragA, fragB]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].length, 2);
});
test("conflicting names: higher-confidence + higher source-priority wins", () => {
  const frag: Fragment = {
    _matchHints: [],
    fullName: [
      { value: "Wrong Name", source: "recruiter_notes", method: "regex_extraction", confidence: 0.3 },
      { value: "Right Name", source: "recruiter_csv", method: "direct_field", confidence: 0.7 },
    ],
  };
  const canonical = combineGroup([frag]);
  const resolved = resolveCandidate(canonical);
  assert.strictEqual(resolved.fullName.value, "Right Name");
});
test("agreement across sources raises confidence above any single source's base", () => {
  const frag: Fragment = {
    _matchHints: [],
    fullName: [
      { value: "Same Name", source: "recruiter_csv", method: "direct_field", confidence: 0.7 },
      { value: "Same Name", source: "github", method: "api_fetch", confidence: 0.55 },
    ],
  };
  const resolved = resolveCandidate(combineGroup([frag]));
  assert.ok(resolved.fullName.confidence > 0.7, `expected corroboration bonus, got ${resolved.fullName.confidence}`);
});

console.log("\nvalidate.ts (config validation)");
test("config missing required keys is rejected before projection runs", () => {
  const { valid, errors } = validateConfig({ fields: [], include_confidence: true, on_missing: "null" } as any);
  assert.strictEqual(valid, false);
  assert.ok(errors.length > 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
