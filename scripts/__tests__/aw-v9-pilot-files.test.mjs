import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { protocolDigest } from "../../evals/aw-v9/pilot-harness.mjs";
import { protocol, observation } from "./helpers/v9-pilot-fixtures.mjs";

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "aw-v9-pilot-owned-")), p = protocol();
  const protocolPath = join(directory, "protocol.json"), rowsPath = join(directory, "rows.json"), output = join(directory, "aggregate.json");
  writeFileSync(protocolPath, JSON.stringify(p), { mode: 0o600 }); writeFileSync(rowsPath, JSON.stringify([observation(p)]), { mode: 0o600 });
  const execute = () => spawnSync(process.execPath, ["scripts/validate-aw-v9-pilot.mjs", protocolPath, rowsPath, protocolDigest(p), output], { encoding: "utf8" });
  try { run({ execute, p, protocolPath, rowsPath, output, directory }); } finally { rmSync(directory, { recursive: true, force: true }); }
}
test("private owned artifacts produce only a private aggregate receipt", () => fixture(({ execute, output }) => {
  const result = execute(); assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(output, "utf8"); assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.ok(!text.includes("P-ABC123")); assert.equal(JSON.parse(text).gaAllowed, false);
}));
test("a pre-existing receipt is never overwritten", () => fixture(({ execute, output }) => {
  writeFileSync(output, "existing-receipt", { mode: 0o600 }); assert.notEqual(execute().status, 0); assert.equal(readFileSync(output, "utf8"), "existing-receipt");
}));
test("public observation files are rejected before writing a receipt", () => fixture(({ execute, rowsPath }) => {
  rmSync(rowsPath); writeFileSync(rowsPath, "[]", { mode: 0o644 }); chmodSync(rowsPath, 0o644); assert.notEqual(execute().status, 0);
}));
test("observation symlinks cannot substitute another file", () => fixture(({ execute, rowsPath, directory }) => {
  const alternate = join(directory, "alternate.json"); writeFileSync(alternate, "[]", { mode: 0o600 }); rmSync(rowsPath); symlinkSync(alternate, rowsPath);
  assert.notEqual(execute().status, 0);
}));
test("invalid private content never appears in CLI failure output", () => fixture(({ execute, rowsPath }) => {
  writeFileSync(rowsPath, JSON.stringify([{ apiKey: "PRIVATE-CREDENTIAL-DO-NOT-LOG" }]), { mode: 0o600 });
  const result = execute(); assert.notEqual(result.status, 0); assert.ok(!result.stderr.includes("PRIVATE-CREDENTIAL")); assert.ok(!result.stdout.includes("PRIVATE-CREDENTIAL"));
}));
