import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../workflows/pr-trusted.yml", import.meta.url), "utf8");
const jobs = [...workflow.matchAll(/^  ([a-z_][a-z_0-9]*):\n([\s\S]*?)(?=^  [a-z_][a-z_0-9]*:\n|$(?![\s\S]))/gm)];
const installers = jobs.filter(([, name, body]) => name !== "policy" && body.includes("pnpm install --frozen-lockfile"));

test("PR workflows restore dependency stores without creating branch copies", () => {
  assert.equal(installers.length, 7);
  assert.doesNotMatch(workflow, /^ +cache: pnpm$/m);
  assert.doesNotMatch(workflow, /uses: actions\/cache(?:@|\/save@)/);
  for (const [, job, body] of jobs) {
    for (const step of body.split("      - name:").filter((step) => step.includes("uses: actions/setup-node@"))) {
      assert.match(step, /package-manager-cache: false/, job);
    }
  }
  const policy = jobs.find(([, name]) => name === "policy")[2];
  assert.doesNotMatch(policy, /uses: actions\/cache|cache: pnpm/);
});

for (const [, job, body] of installers) {
  test(`${job}: reuse master keys before a frozen install`, () => {
    const locate = body.indexOf("      - name: Locate pnpm store");
    const restore = body.indexOf("      - name: Restore pnpm store (read only)");
    const install = body.indexOf("      - name: Install dependencies");
    assert.ok(locate >= 0 && locate < restore && restore < install);
    const cache = body.slice(restore, install);
    assert.match(body.slice(locate, restore), /pnpm store path --silent/);
    assert.match(body.slice(locate, restore), /node -p 'process.arch'/);
    assert.match(cache, /uses: actions\/cache\/restore@[a-f0-9]{40}/);
    assert.ok(cache.includes("key: node-cache-${{ runner.os }}-${{ steps.pnpm_store.outputs.arch }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}"));
    assert.ok(cache.includes("restore-keys: node-cache-${{ runner.os }}-${{ steps.pnpm_store.outputs.arch }}-pnpm-"));
    // A cache hit never permits a different graph than the reviewed source.
    const installStep = body.slice(install).split("      - name:")[1] ?? body.slice(install);
    assert.match(installStep, /pnpm install --frozen-lockfile/);
    assert.match(installStep, /git diff --exit-code -- pnpm-lock.yaml/);
    assert.doesNotMatch(installStep, /--no-frozen-lockfile|--resolution-only/);
    assert.doesNotMatch(installStep, /needs\.policy/);
  });
}
