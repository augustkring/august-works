import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { protocol } from "./helpers/v9-pilot-fixtures.mjs";
import { protocolDigest } from "../../evals/aw-v9/pilot-harness.mjs";
import { main } from "../validate-aw-v9-attention.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aw-v9-attention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = protocol(), digest = protocolDigest(plan), source = join(root, "protocol.json"), observations = join(root, "observations.json"), output = join(root, "aggregate.json");
  const evidence = { schemaVersion: 1, protocolSha256: digest, referenceAt: "2026-10-13T02:00:00.000Z", coverage: "bounded_sample", conditions: [] };
  await writeFile(source, JSON.stringify(plan), { mode: 0o600 });
  await writeFile(observations, JSON.stringify(evidence), { mode: 0o600 });
  return { root, plan, digest, source, observations, output, args: [source, observations, digest, output] };
}
test("writes one private unexecuted receipt bound to exact protocol and input metadata", async t => {
  const f = await fixture(t), result = await main(f.args);
  assert.equal(result.execution, "not_executed"); assert.equal(result.gaAllowed, false);
  assert.equal(result.populationRecallAvailable, false); assert.match(result.observationsSha256, /^[a-f0-9]{64}$/);
  assert.equal((await stat(f.output)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(f.output, "utf8")), result);
});
test("refuses readable-by-others input rather than producing an aggregate", async t => {
  const f = await fixture(t); await chmod(f.observations, 0o640);
  await assert.rejects(main(f.args), /V9 attention evaluation failed/);
  await assert.rejects(stat(f.output), { code: "ENOENT" });
});
test("does not follow an observation symlink or an output symlink", async t => {
  const f = await fixture(t), link = join(f.root, "linked.json");
  await symlink(f.observations, link);
  await assert.rejects(main([f.source, link, f.digest, f.output]), /V9 attention evaluation failed/);
  await symlink(f.observations, f.output);
  const before = await readFile(f.observations, "utf8");
  await assert.rejects(main(f.args), /V9 attention evaluation failed/);
  assert.equal(await readFile(f.observations, "utf8"), before);
});
test("refuses an existing output, input replacement and expanded private payloads", async t => {
  const f = await fixture(t);
  await writeFile(f.output, "EXISTING PRIVATE RECEIPT", { mode: 0o600 });
  await assert.rejects(main(f.args), /V9 attention evaluation failed/);
  assert.equal(await readFile(f.output, "utf8"), "EXISTING PRIVATE RECEIPT");
  await assert.rejects(main([f.source, f.observations, f.digest, f.source]), /V9 attention evaluation failed/);
  const expanded = JSON.parse(await readFile(f.observations, "utf8")); expanded.rawPrompt = "PRIVATE_CANARY";
  await writeFile(f.observations, JSON.stringify(expanded));
  await assert.rejects(main([f.source, f.observations, f.digest, join(f.root, "other.json")]), error => {
    assert.equal(error.message, "V9 attention evaluation failed; inspect the owned protocol/observation artifacts");
    assert.ok(!String(error.stack).includes("PRIVATE_CANARY")); return true;
  });
});
test("the actual CLI refuses private expanded input without logging excerpts or creating a receipt", async t => {
  const f = await fixture(t), evidence = JSON.parse(await readFile(f.observations, "utf8"));
  evidence.rawBody = "PRIVATE_COMMAND_LINE_CANARY";
  await writeFile(f.observations, JSON.stringify(evidence));
  const child = spawnSync(process.execPath, ["scripts/validate-aw-v9-attention.mjs", ...f.args], { encoding: "utf8" });
  assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.equal(child.stderr, "V9 attention evaluation failed; no source excerpts were logged\n");
  await assert.rejects(stat(f.output), { code: "ENOENT" });
});
