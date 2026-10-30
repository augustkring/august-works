import assert from "node:assert/strict";
import test from "node:test";
import { buildMigrationRegister, checkMigrationRegister } from "./platform-skill-migration-register.mjs";

test("the legacy instruction inventory is source-current and section complete", async () => {
  const register = await buildMigrationRegister();
  assert.deepEqual(await checkMigrationRegister(), []);
  assert.ok(register.sources.some((source) => source.path === "skills/paperclip/SKILL.md"));
  assert.ok(register.sources.some((source) => source.path === "packages/adapters/hermes/skills/paperclip-task-bridge/SKILL.md"));
  assert.ok(register.sources.some((source) => source.path === "server/src/onboarding-assets/default/AGENTS.md"));
  assert.equal(new Set(register.sections.map((section) => section.id)).size, register.sections.length);
  assert.ok(register.sections.every((section) => section.semanticOwner && section.target && section.runtimeDestination && section.action && section.reason && section.tests));
  assert.ok(register.legacyDisposition.shadowCollisionDisposition);
  assert.ok(register.legacyDisposition.sunsetGate && register.legacyDisposition.rollback);
});

test("runtime compatibility distinguishes implemented delivery from external qualification", async () => {
  const { runtimeProfiles, currentRelease } = await buildMigrationRegister();
  assert.equal(currentRelease.version, "v3");
  assert.deepEqual(runtimeProfiles.map((profile) => profile.profile), [
    "blentera_managed_native", "openclaw", "hermes_local", "a2a_or_custom",
  ]);
  assert.equal(runtimeProfiles.find((profile) => profile.profile === "hermes_local").implementation, "isolated_delivery_source_present");
  assert.equal(runtimeProfiles.find((profile) => profile.profile === "hermes_local").qualification, "source_conformance_only_not_GA");
  assert.ok(runtimeProfiles.every((profile) => profile.requiredExternalEvidence.length > 0));
});
