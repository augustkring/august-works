import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFirstPartySupportModelProfileCurrent,
  firstPartySupportFunding,
  firstPartySupportModelProfileSchema,
  loadFirstPartySupportModelProfiles,
  type FirstPartySupportModelProfile,
} from "../services/orchestration/first-party-support-model-profiles.js";

const sourceSha = "a".repeat(40);
const protectedOrigin = "https://qualification.test.invalid";
const profile = (): FirstPartySupportModelProfile => ({
  companyId: randomUUID(),
  packageVersionId: randomUUID(),
  purpose: "first_party_support",
  funder: "blentera_platform",
  profileId: "support-profile-v1",
  providerAccountId: "platform-anthropic-account",
  credentialBindingHash: "b".repeat(64),
  privacyNoticeUrl: "https://blentera.example.test/privacy/ai-support",
  periodKey: "2026-10",
  periodStartsAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  periodEndsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  maxCostMinor: 500,
  maxCalls: 20,
  contract: "anthropic-text-messages-2023-06-01",
  tariff: {
    provider: "anthropic",
    model: "fixture-model-20261025",
    currency: "USD",
    inputMinorPerMillion: 100,
    outputMinorPerMillion: 100,
    fixedMinor: 0,
    qualificationHash: "c".repeat(64),
    sourceSha,
    testedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  },
  maximumEnvelopeBytes: 64000,
  inputTokensUpperBound: 300000,
  maxOutputTokens: 512,
  qualificationEvidenceRef: `${protectedOrigin}/qualification/support-fixture.json`,
  qualificationArtifactSha256: "d".repeat(64),
});

describe("private first-party Support funding profiles", () => {
  it("keeps missing configuration closed and loads only a private file with the exact deployment digest", async () => {
    expect(loadFirstPartySupportModelProfiles(undefined, undefined)).toEqual([]);
    expect(() => loadFirstPartySupportModelProfiles("/missing", undefined)).toThrow("pin_required");
    const dir = await mkdtemp(join(tmpdir(), "aw-support-profile-"));
    const path = join(dir, "profiles.json");
    try {
      const bytes = JSON.stringify([profile()]);
      const sha = createHash("sha256").update(bytes).digest("hex");
      await writeFile(path, bytes, { mode: 0o600 });
      expect(loadFirstPartySupportModelProfiles(path, sha)).toHaveLength(1);
      expect(() => loadFirstPartySupportModelProfiles(path, "e".repeat(64))).toThrow("digest_changed");
      await chmod(path, 0o644);
      expect(() => loadFirstPartySupportModelProfiles(path, sha)).toThrow("not_private");
      await chmod(path, 0o600);
      const p = profile(), duplicateCompany = JSON.stringify([p, { ...p, packageVersionId: randomUUID() }]);
      await writeFile(path, duplicateCompany);
      expect(() => loadFirstPartySupportModelProfiles(path, createHash("sha256").update(duplicateCompany).digest("hex"))).toThrow("ambiguous");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("binds funding to the fixed purpose, platform account, exact company package and qualified tariff interval", () => {
    const p = profile();
    const current = assertFirstPartySupportModelProfileCurrent(p, sourceSha, protectedOrigin);
    const funding = firstPartySupportFunding(current);
    expect(funding).toMatchObject({
      companyId: p.companyId,
      purpose: "first_party_support",
      funder: "blentera_platform",
      profileId: p.profileId,
      providerAccountId: p.providerAccountId,
      credentialBindingHash: p.credentialBindingHash,
    });
    expect(funding.profileHash).toMatch(/^[a-f0-9]{64}$/);
    for (const altered of [
      { ...p, tariff: { ...p.tariff, provider: "openai" as const } },
      { ...p, tariff: { ...p.tariff, sourceSha: "f".repeat(40) } },
      { ...p, tariff: { ...p.tariff, expiresAt: new Date(Date.now() + 3 * 86400_000).toISOString() } },
      { ...p, periodEndsAt: new Date(Date.now() + 3 * 86400_000).toISOString() },
      { ...p, qualificationEvidenceRef: "https://other.test.invalid/qualification/support.json" },
      { ...p, packageVersionId: "not-a-uuid" },
    ]) {
      expect(() => assertFirstPartySupportModelProfileCurrent(altered, sourceSha, protectedOrigin)).toThrow();
    }
    expect(firstPartySupportModelProfileSchema.safeParse({ ...p, apiKey: "never-store-keys-here" }).success).toBe(false);
  });
  it("does not spend the support funding profile after its owner retires it", () => {
    const p = profile();
    expect(() => assertFirstPartySupportModelProfileCurrent({ ...p, lifecycle: { status: "retired", owner: "support model owner",
      retirementAt: null, replacementProfileId: null, regionOrRoutingProfile: "fixture-region", dataUseProfile: "fixture-no-training",
      supportedInputOutput: ["text"], toolUseCapability: false, rateLimits: { requestsPerMinute: 10, tokensPerMinute: 1000 } } }, sourceSha, protectedOrigin))
      .toThrow("model_lifecycle_profile_unavailable");
  });
  it("binds declared lifecycle changes into the support funding identity", () => {
    const p = profile(), old = firstPartySupportFunding(p);
    const declared = { ...p, lifecycle: { status: "active" as const, owner: "support model owner", retirementAt: null,
      replacementProfileId: null, regionOrRoutingProfile: "fixture-region", dataUseProfile: "fixture-no-training",
      supportedInputOutput: ["text" as const], toolUseCapability: false, rateLimits: { requestsPerMinute: 100, tokensPerMinute: 100000 } } };
    expect(firstPartySupportFunding(declared).profileHash).not.toBe(old.profileHash);
  });
});
