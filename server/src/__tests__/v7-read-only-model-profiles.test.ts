import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertReadOnlyModelProfileCurrent,
  loadReadOnlyModelProfiles,
  readOnlyModelProfileSchema,
  type ReadOnlyModelProfile,
} from "../services/orchestration/read-only-model-profiles.js";
const sourceSha = "a".repeat(40),
  protectedOrigin = "https://qualification.test.invalid";
const profile = (): ReadOnlyModelProfile => ({
  id: randomUUID(),
  companyId: randomUUID(),
  reviewerAgentId: randomUUID(),
  binding: {
    provider: "anthropic",
    method: "api_key",
    mode: "shared",
    connectionId: randomUUID(),
    grantId: randomUUID(),
  },
  contract: "anthropic-text-messages-2023-06-01",
  tariff: {
    provider: "anthropic",
    model: "fixture-model-20261005",
    currency: "USD",
    inputMinorPerMillion: 1,
    outputMinorPerMillion: 1,
    fixedMinor: 0,
    qualificationHash: "b".repeat(64),
    sourceSha,
    testedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  },
  maximumEnvelopeBytes: 64000,
  inputTokensUpperBound: 300000,
  maxOutputTokens: 1024,
  qualificationEvidenceRef: `${protectedOrigin}/qualification/local-fixture-only.json`,
  qualificationArtifactSha256: "c".repeat(64),
  calibrationHash: "d".repeat(64),
});
describe("deployment-pinned read-only model qualifications", () => {
  it("keeps absent configuration inactive and requires a private owner file with an exact digest", async () => {
    expect(loadReadOnlyModelProfiles(undefined, undefined)).toEqual([]);
    expect(() => loadReadOnlyModelProfiles("/missing", undefined)).toThrow(
      "pin_required",
    );
    const home = await mkdtemp(join(tmpdir(), "aw-v7-model-pins-")),
      file = join(home, "profiles.json");
    try {
      const bytes = JSON.stringify([profile()]),
        digest = createHash("sha256").update(bytes).digest("hex");
      await writeFile(file, bytes, { mode: 0o600 });
      expect(loadReadOnlyModelProfiles(file, digest)).toHaveLength(1);
      expect(() => loadReadOnlyModelProfiles(file, "f".repeat(64))).toThrow(
        "digest_changed",
      );
      await chmod(file, 0o644);
      expect(() => loadReadOnlyModelProfiles(file, digest)).toThrow(
        "not_private",
      );
      await chmod(file, 0o600);
      const p = profile(),
        ambiguous = JSON.stringify([p, { ...p, id: randomUUID() }]);
      await writeFile(file, ambiguous);
      expect(() =>
        loadReadOnlyModelProfiles(
          file,
          createHash("sha256").update(ambiguous).digest("hex"),
        ),
      ).toThrow("ambiguous");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("rejects current-source, expiry, future, long-lived and protected-origin/query drift", () => {
    const p = profile();
    expect(
      assertReadOnlyModelProfileCurrent(p, sourceSha, protectedOrigin),
    ).toEqual({ ...p,purposes: ["read_only_verification"] });
    for (const altered of [
      { ...p, tariff: { ...p.tariff, sourceSha: "e".repeat(40) } },
      { ...p, tariff: { ...p.tariff, expiresAt: new Date(0).toISOString() } },
      {
        ...p,
        tariff: {
          ...p.tariff,
          testedAt: new Date(Date.now() + 30000).toISOString(),
        },
      },
      {
        ...p,
        tariff: {
          ...p.tariff,
          expiresAt: new Date(Date.now() + 172800000).toISOString(),
        },
      },
      {
        ...p,
        qualificationEvidenceRef:
          "https://other.test.invalid/qualification/fixture",
      },
      {
        ...p,
        qualificationEvidenceRef: `${p.qualificationEvidenceRef}?token=forbidden`,
      },
    ])
      expect(() =>
        assertReadOnlyModelProfileCurrent(altered, sourceSha, protectedOrigin),
      ).toThrow("qualification_unavailable");
  });
  it("requires an explicit API-key grant and refuses an extra endpoint, raw key or unsupported contract", () => {
    const p = profile();
    expect(
      readOnlyModelProfileSchema.safeParse({
        ...p,
        binding: {
          provider: "anthropic",
          method: "api_key",
          mode: "responsible_user",
        },
      }).success,
    ).toBe(false);
    expect(
      readOnlyModelProfileSchema.safeParse({
        ...p,
        binding: { ...p.binding, method: "subscription" },
      }).success,
    ).toBe(false);
    expect(
      readOnlyModelProfileSchema.safeParse({
        ...p,
        endpoint: "https://arbitrary.test.invalid",
      }).success,
    ).toBe(false);
    expect(
      readOnlyModelProfileSchema.safeParse({ ...p, apiKey: "raw-key" }).success,
    ).toBe(false);
    expect(
      readOnlyModelProfileSchema.safeParse({
        ...p,
        contract: "unqualified-model-sdk",
      }).success,
    ).toBe(false);
  });
});
