import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sandboxHostReplySchema, sandboxHostRequestSchema } from "../../../packages/shared/dist/index.js";

const target = { sandboxId: randomUUID(), containerId: "a".repeat(64) };
const request = (action, expectedTarget) => {
  const bindingId = randomUUID();
  return {
    version: 1,
    scope: { companyId: randomUUID(), bindingId, cellId: randomUUID(), cellGeneration: "7",
      sandboxRef: `aw-v7-${bindingId}` },
    action,
    hostEpoch: 2,
    imageDigest: `fixture.invalid/openshell@sha256:${"b".repeat(64)}`,
    requesterUserId: "fixture-owner",
    ...(expectedTarget ? { expectedTarget } : {}),
  };
};

test("cleanup expectedTarget is accepted only for strict stop/inspect requests", () => {
  for (const action of ["stop", "inspect"]) {
    const value = sandboxHostRequestSchema.parse(request(action, target));
    assert.deepEqual(value.expectedTarget, target);
  }
  assert.throws(() => sandboxHostRequestSchema.parse(request("capabilities", target)));
  assert.throws(() => sandboxHostRequestSchema.parse(request("stop", { ...target, extra: true })));
  assert.throws(() => sandboxHostRequestSchema.parse(request("stop", { ...target, sandboxId: "replacement" })));
  assert.throws(() => sandboxHostRequestSchema.parse(request("inspect", { ...target, containerId: "A".repeat(64) })));
  assert.equal(sandboxHostRequestSchema.parse(request("stop")).expectedTarget, undefined,
    "legacy non-cleanup Stop remains compatible");
});

test("cleanup replies can carry the exact observed target while ordinary replies remain valid", () => {
  const stop = { action: "stop", stopped: true, ...target };
  const inspect = { action: "inspect", state: "stopped", ...target,
    policyHash: null, imageDigest: `fixture.invalid/openshell@sha256:${"b".repeat(64)}`,
    generation: "7", controlsHealthy: false };
  assert.deepEqual(sandboxHostReplySchema.parse(stop), stop);
  assert.deepEqual(sandboxHostReplySchema.parse(inspect), inspect);
  assert.deepEqual(sandboxHostReplySchema.parse({ action: "stop", stopped: true }),
    { action: "stop", stopped: true }, "ordinary Stop reply remains compatible");
  assert.throws(() => sandboxHostReplySchema.parse({ ...stop, unexpected: true }));
});
