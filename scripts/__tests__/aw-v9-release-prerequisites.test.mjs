import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const digest = value => createHash("sha256").update(value).digest("hex");
const gates = [...Array.from({ length: 18 }, (_, i) => `H6-${String(i + 1).padStart(2, "0")}`), "H7-01", "H7-02", "H7-03"];
const blockers = ["native_openshell_host_bridge", "credential_use_broker_and_revocation", "pre_spend_model_reservation"];

// A complete synthetic coverage portfolio isolates the inherited-release guard:
// missing surface evidence must not be the reason these negative cases fail.
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "aw-v9-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (path, value) => {
    const file = join(dir, path); mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  put("scripts/check-aw-v9-coverage.mjs", readFileSync(join(root, "scripts/check-aw-v9-coverage.mjs"), "utf8"));
  const helper = "scripts/aw-v9-release-prerequisites.mjs";
  if (existsSync(join(root, helper))) copyFileSync(join(root, helper), join(dir, helper));
  const brief = "Synthetic brief", witness = "Synthetic evidence", artifactSha = "b".repeat(64);
  put("brief.md", brief); put("component.ts", "export {};"); put("witness.json", witness);
  const ids = ["SHELL", "HOME", "NEEDS-YOU", "WORK", "APPS", "COMPANY", "HELP-RECOVERY", "FEEDBACK", "MY-FEEDBACK", "APPROVAL-CARD", "ORCHESTRATION", "WORKFLOW", "AGENT-MONITOR", "AGENT-CHANGE", "AGENT-RETIRE",
    ...[["ONB", 12], ["HIRE", 7], ["CUSTOM", 13]].flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`))];
  put("doc/experience/v9/coverage.json", { briefSha256: digest(brief), screens: ids.map(screenId => {
    put(`contracts/${screenId}.json`, { screenId, journeyId: screenId });
    return { screenId, journeyId: screenId, owner: "fixture", criticality: "C3", implementationStatus: "implemented",
      specification: { path: "brief.md", startLine: 1, endLine: 1, sha256: digest(brief) },
      contractPath: `contracts/${screenId}.json`, componentPaths: ["component.ts"], evidenceRefs:
        ["functional", "accessibility", "securityPrivacy", "usability"].map(kind => ({ kind, status: "passed", artifactSha, path: "witness.json", artifactSha256: digest(witness) })) };
  }) });
  const v9 = { version: 1, stage: "R4_LIMITED_GA", sourceComplete: true, acceptedBy: "fixture-owner",
    releaseIdentity: { sourceSha: "a".repeat(40), artifactSha, configSha256: "c".repeat(64), schemaVersion: "fixture" } };
  const v8 = { version: 1, sourceComplete: true, predecessorStatus: "passed", predecessorGateIds: [...gates] };
  const v7 = { version: 1, implementationBlockers: blockers.map(id => ({ id, status: "implemented_and_verified" })) };
  const run = (release = true) => {
    put("evals/aw-v9/readiness.json", v9); put("evals/aw-v8/readiness.json", v8); put("evals/aw-v7/pilot-readiness.json", v7);
    return spawnSync(process.execPath, [join(dir, "scripts/check-aw-v9-coverage.mjs"), ...(release ? ["--release"] : [])], { encoding: "utf8", timeout: 10000 });
  };
  return { dir, put, v9, v8, v7, run };
}

test("complete V9 surface witnesses cannot bypass the three actual inherited code blockers", t => {
  const f = fixture(t);
  f.v7.implementationBlockers = JSON.parse(readFileSync(join(root, "evals/aw-v7/pilot-readiness.json"))).implementationBlockers
    .map(entry => blockers.includes(entry.id) ? { ...entry, status: "incomplete" } : entry);
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const id of blockers) assert.ok(result.stderr.includes(id), result.stderr);
});

test("closed synthetic prerequisites allow coverage checking without claiming production acceptance", t => {
  const result = fixture(t).run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release coverage passed/);
});

test("open V8 hosting gates and incomplete predecessor source prevent release coverage", t => {
  const f = fixture(t); f.v8.predecessorStatus = "open"; f.v8.sourceComplete = false;
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /V8.*source/); assert.match(result.stderr, /H6\/H7/);
});

test("removing or duplicating a mandatory predecessor cannot turn an incomplete register into a pass", t => {
  const f = fixture(t); f.v7.implementationBlockers.pop(); f.v8.predecessorGateIds.pop();
  let result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /pre_spend_model_reservation/); assert.match(result.stderr, /H7-03/);
  f.v7.implementationBlockers.push({ ...f.v7.implementationBlockers[0] });
  f.v8.predecessorGateIds.push(f.v8.predecessorGateIds[0]);
  result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
});

test("a named V9 acceptance owner is required even with complete surface witnesses", t => {
  const f = fixture(t); f.v9.acceptedBy = null;
  const result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /acceptance owner/);
});

test("source development can still validate coverage with inherited runtime gates open", t => {
  const f = fixture(t); f.v7.implementationBlockers[0].status = "incomplete";
  f.v8.sourceComplete = false; f.v8.predecessorStatus = "open"; f.v9.acceptedBy = null;
  const result = f.run(false); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not release acceptance/);
});

test("future incomplete V7 blockers remain binding and raw register values stay out of refusal logs", t => {
  const f = fixture(t);
  f.v7.implementationBlockers.push({ id: "PRIVATE-FUTURE-BLOCKER", status: "incomplete" });
  const result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /V7 implementation register still contains incomplete work/);
  assert.ok(!result.stderr.includes("PRIVATE-FUTURE-BLOCKER"));
});

test("missing or malformed predecessor registers fail closed", t => {
  const f = fixture(t);
  f.v7.implementationBlockers = null; f.v8.predecessorGateIds = null;
  let result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
  f.put("evals/aw-v7/pilot-readiness.json", "not-json");
  result = spawnSync(process.execPath, [join(f.dir, "scripts/check-aw-v9-coverage.mjs"), "--release"], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /registers are unavailable or invalid/);
  rmSync(join(f.dir, "evals/aw-v7/pilot-readiness.json"));
  result = spawnSync(process.execPath, [join(f.dir, "scripts/check-aw-v9-coverage.mjs"), "--release"], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /registers are unavailable or invalid/);
});

test("truthy source flags and untyped schema identities cannot earn release coverage", t => {
  const f = fixture(t); f.v9.sourceComplete = "false";
  let result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
  f.v9.sourceComplete = true; f.v9.releaseIdentity.schemaVersion = { unverified: true };
  result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
  f.v9.releaseIdentity.schemaVersion = "   ";
  result = f.run(); assert.equal(result.status, 1, result.stdout + result.stderr);
  f.v9.releaseIdentity.schemaVersion = "fixture";
  result = f.run(); assert.equal(result.status, 0, result.stderr);
});
