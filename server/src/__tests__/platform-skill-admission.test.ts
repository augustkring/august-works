import { describe, expect, it } from "vitest";
import { platformSkillAdmissionMatches } from "../services/platform-skill-admission.js";

const pin = { schemaVersion: 1, platformSkill: { key: "blentera-platform", version: "v1", digest: `sha256:${"1".repeat(64)}`,
  sourceSha: "a".repeat(40) }, operationManifestHash: "2".repeat(64), toolCatalogContractHash: "3".repeat(64), runtimeAdapter: "paperclip_runner" };
describe("mandatory platform procedure pin", () => {
  it("accepts the exact pin independently of object property order", () => {
    expect(platformSkillAdmissionMatches(pin, { ...pin, platformSkill: { ...pin.platformSkill } })).toBe(true);
  });
  it("requires re-admission for missing pins, content, release, catalog, operations and adapter changes", () => {
    for (const next of [undefined, null, {}, { ...pin, runtimeAdapter: "openclaw_gateway" },
      { ...pin, toolCatalogContractHash: "4".repeat(64) }, { ...pin, operationManifestHash: "4".repeat(64) },
      { ...pin, platformSkill: { ...pin.platformSkill, version: "v2" } },
      { ...pin, platformSkill: { ...pin.platformSkill, digest: `sha256:${"4".repeat(64)}` } },
      { ...pin, platformSkill: { ...pin.platformSkill, sourceSha: "b".repeat(40) } },
      { ...pin, authority: "allow" }]) expect(platformSkillAdmissionMatches(pin, next)).toBe(false);
  });
});
