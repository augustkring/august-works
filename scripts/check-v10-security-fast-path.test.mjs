import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSecurityFastPath, selectSecurityFastPath } from "./check-v10-security-fast-path.mjs";

const root = resolve(import.meta.dirname, "..");
const map = JSON.parse(readFileSync(resolve(root, "doc/operations/v10-security-fast-path.json"), "utf8"));

test("security fast path resolves every protected owner path to existing regression files", () => {
  assert.deepEqual(validateSecurityFastPath(map), []);
  assert.equal(map.sourceAssuranceSha256, createHash("sha256").update(readFileSync(resolve(root, map.sourceAssurance))).digest("hex"));
  assert.match(map.qualificationBoundary, /at least one passed or failed assertion from every selected file\/directory/);
});

test("a changed protected path selects only its mapped regression files, deduplicated", () => {
  assert.deepEqual(selectSecurityFastPath(map, ["server/src/services/workflows/workflow-executor.ts"]), [
    "server/src/__tests__/v9-workflow-authoring-api.integration.test.ts",
    "server/src/__tests__/v9-workflow-authoring-sources.integration.test.ts",
  ]);
});

test("a protected regression group cannot drift away from its CI job owner", () => {
  const altered = structuredClone(map);
  altered.regressions[0].ciJob = "server-general";
  assert.ok(validateSecurityFastPath(altered).some((error) => error.includes("declared CI owner")));
});

test("an unmapped new security prefix fails closed while known domains select owner-directory regressions", () => {
  assert.ok(selectSecurityFastPath(map, ["server/src/services/memory/new-owner.ts"]).includes("server/src/services/memory/"));
  const altered = structuredClone(map);
  altered.sensitiveSourcePrefixes.push("server/src/services/unknown-security/");
  assert.throws(() => selectSecurityFastPath(altered, ["server/src/services/unknown-security/owner.ts"]), /Unmapped security-sensitive source change/);
});

test("the declared CI owner invokes changed selectors and has a fail-closed base diff", () => {
  const workflow = readFileSync(resolve(root, map.ciOwner.workflow), "utf8");
  assert.match(workflow, new RegExp(`${map.ciOwner.jobId}:`));
  assert.ok(workflow.includes("node scripts/check-v10-security-fast-path.mjs --base"));
  assert.ok(workflow.includes("node scripts/check-v10-security-fast-path.mjs --all"));
  assert.ok(workflow.includes("--reporter=json --outputFile"));
  assert.ok(workflow.includes("mktemp --suffix=.json"));
  assert.ok(workflow.includes("node scripts/check-v10-security-regression-execution.mjs"));
});
