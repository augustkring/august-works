import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateLedger, compareTrees } from "./upstream-intake.mjs";

const ledger = JSON.parse(readFileSync(new URL("../doc/operations/upstream-intake.json", import.meta.url), "utf8"));

test("pinned §7 intake snapshot carries every source SHA without claiming source review", () => {
  assert.equal(ledger.changes.length, 86);
  assert.deepEqual(validateLedger(ledger), []);
  assert.ok(ledger.changes.every((item) => item.sourceRead.reviewedRefs.length === 0));
  assert.ok(ledger.changes.some((item) => item.state === "security_fast_path" && item.priority === "P0"));
});

test("security entries cannot be demoted to ordinary queue review", () => {
  const changed = structuredClone(ledger);
  changed.changes.find((item) => item.classification === "SECURITY / VULNERABILITY").state = "review";
  assert.ok(validateLedger(changed).some((message) => message.includes("prioritized fast path")));
});

test("admission is blocked without exact implementation, regression, source-review and provenance evidence", () => {
  const changed = structuredClone(ledger);
  const item = changed.changes.find((row) => row.state === "decision_recorded");
  item.state = "admitted";
  const errors = validateLedger(changed);
  assert.ok(errors.some((message) => message.includes("admission requires")));
  assert.ok(errors.some((message) => message.includes("path-specific reviewed source refs")));
});

test("pinned source rows cannot be silently replaced or converted into automatic upstream admission", () => {
  const changed = structuredClone(ledger);
  changed.changes[0].sourceSha = "0000000000000000000000000000000000000000";
  changed.policy.automaticMerge = true;
  const errors = validateLedger(changed);
  assert.ok(errors.some((message) => message.includes("automatic upstream merge")));
  assert.ok(errors.some((message) => message.includes("exact PR/SHA records")));
});

test("tree comparison preserves exact path, mode and blob identity", () => {
  const base = [
    { path: "same.ts", mode: "100644", sha: "a" },
    { path: "mode.ts", mode: "100644", sha: "b" },
    { path: "gone.ts", mode: "100644", sha: "c" },
  ];
  const next = [
    { path: "same.ts", mode: "100644", sha: "a" },
    { path: "mode.ts", mode: "100755", sha: "b" },
    { path: "gone.ts", mode: "100644", sha: "d" },
    { path: "new.ts", mode: "100644", sha: "e" },
  ];
  assert.deepEqual(compareTrees(base, next).map(({ path, change }) => `${path}:${change}`), ["gone.ts:changed", "mode.ts:changed", "new.ts:added"]);
});

test("inventory refuses a moving upstream ref", () => {
  const script = fileURLToPath(new URL("./upstream-intake.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "inventory", "--base", ledger.fork.baseSha, "--upstream", "origin/master"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be the pinned brief SHA/);
});
