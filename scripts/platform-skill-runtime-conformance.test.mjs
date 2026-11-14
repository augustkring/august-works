import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import path from "node:path";
import { attachRawReportReceipt, describeProfileScope, parseSelectedTestResults, selectProfiles, selectedAssertionsPassed, validateContract, validateSuites } from "./run-platform-skill-runtime-conformance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("runtime conformance contract maps every common case and keeps external runtime profiles unqualified", async () => {
  const contract = JSON.parse(await readFile(path.join(root, "evals/platform-skill/runtime-conformance.json"), "utf8"));
  validateContract(contract);
  const ids = contract.scenarios.map(({ id }) => id);
  assert.deepEqual(ids, ["pinned-positive-delivery", "missing-or-stale-pin", "reserved-name-collision", "isolated-profile-boundary", "safe-recovery-boundary"]);
  for (const profile of contract.profiles) {
    assert.match(profile.qualification, /unqualified|not-GA/i);
    assert.equal(profile.exactInstalledVersion, null);
  }
  const runnable = contract.profiles.filter(({ suites }) => suites.length > 0);
  assert.equal(runnable.length, 3);
  assert.ok(runnable.every(({ commonSuiteComplete }) => commonSuiteComplete), "every source-implemented runtime must map all common scenarios");
  const pins = await validateSuites(contract);
  assert.ok(Object.keys(pins).length >= runnable.length);
});

test("rejects a deleted required scenario or declared profile instead of shrinking the common matrix", async () => {
  const load = async () => JSON.parse(await readFile(path.join(root, "evals/platform-skill/runtime-conformance.json"), "utf8"));
  let contract = await load();
  contract.scenarios = contract.scenarios.filter(({ id }) => id !== "reserved-name-collision");
  assert.throws(() => validateContract(contract), /Scenario IDs must match the exact required common cases/);

  contract = await load();
  contract.profiles = contract.profiles.filter(({ id }) => id !== "hermes-local");
  assert.throws(() => validateContract(contract), /Profile IDs must match the exact declared runtime inventory/);
});

test("explicit CLI profile selection is allowed and its scope is reported", async () => {
  const contract = validateContract(JSON.parse(await readFile(path.join(root, "evals/platform-skill/runtime-conformance.json"), "utf8")));
  const selected = selectProfiles(contract, ["openclaw"]);
  assert.deepEqual(selected.map(({ id }) => id), ["openclaw"]);
  assert.deepEqual(describeProfileScope(contract, selected, ["openclaw"]), {
    mode: "explicit-profile-selection",
    requestedProfiles: ["openclaw"],
    executedProfiles: ["openclaw"],
    runnableProfiles: ["blentera-managed-native", "openclaw", "hermes-local"],
    unselectedRunnableProfiles: ["blentera-managed-native", "hermes-local"],
    unsupportedProfiles: ["a2a-or-custom"],
    includesAllRunnableProfiles: false,
    includesAllDeclaredProfiles: false,
  });
  const defaultSelection = selectProfiles(contract);
  const scope = describeProfileScope(contract, defaultSelection);
  assert.equal(scope.mode, "all-runnable-source-profiles");
  assert.equal(scope.includesAllRunnableProfiles, true);
  assert.equal(scope.includesAllDeclaredProfiles, false);
});

test("source-only contract rejects external qualification, GA, and installed-version claims", async () => {
  const load = async () => JSON.parse(await readFile(path.join(root, "evals/platform-skill/runtime-conformance.json"), "utf8"));
  let contract = await load();
  contract.profiles[0].qualification = "externally-qualified";
  assert.throws(() => validateContract(contract), /cannot claim external qualification or GA status/);

  contract = await load();
  contract.profiles[0].qualification = "ga";
  assert.throws(() => validateContract(contract), /cannot claim external qualification or GA status/);

  contract = await load();
  contract.profiles[0].exactInstalledVersion = "1.2.3";
  assert.throws(() => validateContract(contract), /cannot claim an installed runtime version/);
});

test("A2A/custom profile cannot advertise a source test driver that does not exist", async () => {
  const contract = JSON.parse(await readFile(path.join(root, "evals/platform-skill/runtime-conformance.json"), "utf8"));
  const profile = contract.profiles.find(({ id }) => id === "a2a-or-custom");
  profile.suites = [{ path: "missing.test.ts", config: "vitest.config.ts", selection: "case", scenarios: [] }];
  assert.throws(() => validateContract(contract), /cannot claim suites without a delivery driver/);
});

test("selected scenario titles must each have one passed machine-readable assertion", () => {
  const suite = { path: "server/a.test.ts", selection: "required A|required B|required C", requiredTitles: ["required A", "required B", "required C"] };
  const report = (statuses) => ({ testResults: [{
    name: "/repo/server/a.test.ts",
    assertionResults: statuses.map(([title, status]) => ({ title, fullName: title, status })),
  }] });
  const allPassed = parseSelectedTestResults(report([["required A", "passed"], ["required B", "passed"], ["required C", "passed"]]), suite, "/repo");
  assert.equal(allPassed.parsed, true);
  assert.ok(allPassed.requiredTitles.every(({ passed }) => passed));
  assert.equal(selectedAssertionsPassed(allPassed), true);

  const oneSkipped = parseSelectedTestResults(report([["required A", "passed"], ["required B", "skipped"], ["required C", "passed"]]), suite, "/repo");
  assert.ok(oneSkipped.requiredTitles.some(({ title, statuses, passed }) => title === "required B" && statuses.includes("skipped") && !passed));
  assert.equal(oneSkipped.requiredTitles.every(({ passed }) => passed), false);
  assert.equal(selectedAssertionsPassed(oneSkipped), false);

  const oneMissing = parseSelectedTestResults(report([["required A", "passed"], ["required C", "passed"]]), suite, "/repo");
  assert.ok(oneMissing.requiredTitles.some(({ title, matches, passed }) => title === "required B" && matches === 0 && !passed));

  const duplicateWithSkip = parseSelectedTestResults(report([["required A", "passed"], ["required A", "skipped"], ["required B", "passed"], ["required C", "passed"]]), suite, "/repo");
  assert.equal(duplicateWithSkip.requiredTitles.find(({ title }) => title === "required A").passed, false);
  assert.equal(selectedAssertionsPassed(duplicateWithSkip), false);
  assert.equal(oneMissing.requiredTitles.every(({ passed }) => passed), false);
  assert.equal(selectedAssertionsPassed(oneMissing), false);
});


test("per-title verdicts reference the immutable raw Vitest JSON receipt", () => {
  const receipt = { path: "evidence/vitest.json", sha256: "a".repeat(64), bytes: 123 };
  const summary = { parsed: true, requiredTitles: [{ title: "selected", passed: true }] };
  const attached = attachRawReportReceipt(summary, receipt);
  assert.deepEqual(attached.rawReport, receipt);
  assert.deepEqual(attached.requiredTitles[0], { title: "selected", passed: true, rawReportPath: receipt.path, rawReportSha256: receipt.sha256 });
});
