import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertWorkerModelProfileCurrent,
  loadWorkerModelProfiles,
  selectWorkerModelProfile,
  workerModelProfileSchema,
  type WorkerModelProfile,
} from "../services/orchestration/worker-model-profiles.js";
import { assertModelMigrationCompatible } from "../services/orchestration/read-only-model-profiles.js";
const sourceSha = "a".repeat(40),
  origin = "https://qualification.test.invalid";
const fixture = (): WorkerModelProfile => ({
  id: randomUUID(),
  companyId: randomUUID(),
  workerAgentId: randomUUID(),
  providerBindingId: randomUUID(),
  providerSnapshotHash: "b".repeat(64),
  providerProfileRef: "private-fixture-profile",
  qualifiedConfigurationHash: "c".repeat(64),
  binding: {
    provider: "anthropic",
    method: "api_key",
    mode: "shared",
    connectionId: randomUUID(),
    grantId: randomUUID(),
  },
  transport: "server-text-only-v1",
  contract: "anthropic-text-messages-2023-06-01",
  tariff: {
    provider: "anthropic",
    model: "fixture-model-20261006",
    currency: "USD",
    inputMinorPerMillion: 1,
    outputMinorPerMillion: 1,
    fixedMinor: 0,
    qualificationHash: "d".repeat(64),
    sourceSha,
    testedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  },
  maximumEnvelopeBytes: 64000,
  inputTokensUpperBound: 100000,
  maxOutputTokens: 1024,
  qualificationEvidenceRef: `${origin}/qualification/worker-fixture-only.json`,
  qualificationArtifactSha256: "e".repeat(64),
});
describe("private worker model transport qualifications", () => {
  const lifecycle = (status: "active" | "candidate" | "deprecated" | "migration_required" | "retired" = "active") => ({
    status, owner: "model operations", retirementAt: status === "deprecated" ? "2026-10-28T00:00:00.000Z" : null,
    replacementProfileId: status === "migration_required" ? randomUUID() : null,
    regionOrRoutingProfile: "anthropic-us-east-v1", dataUseProfile: "no-training-zero-retention",
    supportedInputOutput: ["text"] as const, toolUseCapability: false,
    rateLimits: { requestsPerMinute: 100, tokensPerMinute: 100000 },
  });
  it("keeps the general tool-capable Messages profile distinct from the text-only contract", () => {
    const p = fixture();
    const managed = {
      ...p,
      transport: "server-anthropic-messages-v1" as const,
      contract: "anthropic-messages-tools-2023-06-01" as const,
    };
    expect(workerModelProfileSchema.parse(managed)).toEqual(managed);
    expect(() => workerModelProfileSchema.parse({
      ...managed,
      contract: "anthropic-text-messages-2023-06-01",
    })).toThrow();
    expect(() => workerModelProfileSchema.parse({
      ...managed,
      transport: "server-text-only-v1",
    })).toThrow();
  });
  it("selects only the explicit owned profile and never falls back to another installed alternative", () => {
    const p = fixture(), alternative = { ...p, id: randomUUID(), qualifiedConfigurationHash: "f".repeat(64),
      tariff: { ...p.tariff, model: "alternative-fixture-model" } };
    const input = { companyId: p.companyId, agentId: p.workerAgentId, profileId: p.id, sourceSha, protectedEvidenceOrigin: origin };
    expect(selectWorkerModelProfile([p, alternative], input)).toEqual(p);
    expect(selectWorkerModelProfile([p, alternative], { ...input, profileId: alternative.id })).toEqual(alternative);
    expect(selectWorkerModelProfile([p, alternative], { ...input, profileId: undefined, configurationHash: p.qualifiedConfigurationHash })).toEqual(p);
    expect(() => selectWorkerModelProfile([p, alternative], { ...input, profileId: undefined })).toThrow("exact installed");
    expect(() => selectWorkerModelProfile([p, alternative], { ...input, configurationHash: alternative.qualifiedConfigurationHash })).toThrow("exact installed");
    for (const changed of [{ profileId: randomUUID() }, { profileId: "" }, { companyId: randomUUID() }, { agentId: randomUUID() }])
      expect(() => selectWorkerModelProfile([p, alternative], { ...input, ...changed })).toThrow("exact installed");
    expect(() => selectWorkerModelProfile([p, p], input)).toThrow("exact installed");
    expect(() => selectWorkerModelProfile([{ ...p, tariff: { ...p.tariff, sourceSha: "f".repeat(40) } }, alternative], input)).toThrow();
  });
  it("loads distinct configuration pins for one presence while refusing ambiguous configuration or global profile identity", async () => {
    const p = fixture(), alternative = { ...p, id: randomUUID(), qualifiedConfigurationHash: "f".repeat(64) };
    const home = await mkdtemp(join(tmpdir(), "aw-worker-model-alternatives-")), file = join(home, "profiles.json");
    const write = async (profiles: WorkerModelProfile[]) => {
      const bytes = JSON.stringify(profiles); await writeFile(file, bytes, { mode: 0o600 });
      return createHash("sha256").update(bytes).digest("hex");
    };
    try {
      expect(loadWorkerModelProfiles(file, await write([p, alternative]))).toHaveLength(2);
      expect(() => loadWorkerModelProfiles(file, undefined)).toThrow("pin_required");
      const duplicate = await write([p, { ...alternative, id: p.id }]);
      expect(() => loadWorkerModelProfiles(file, duplicate)).toThrow("ambiguous");
      const ambiguous = await write([p, { ...alternative, qualifiedConfigurationHash: p.qualifiedConfigurationHash }]);
      expect(() => loadWorkerModelProfiles(file, ambiguous)).toThrow("ambiguous");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  it("requires paired deployment pins, a private owner file and exact bytes; missing configuration stays inactive", async () => {
    expect(loadWorkerModelProfiles(undefined, undefined)).toEqual([]);
    expect(() => loadWorkerModelProfiles("/missing", undefined)).toThrow(
      "pin_required",
    );
    const home = await mkdtemp(join(tmpdir(), "aw-worker-model-pins-")),
      file = join(home, "profiles.json");
    try {
      const bytes = JSON.stringify([fixture()]),
        sha = createHash("sha256").update(bytes).digest("hex");
      await writeFile(file, bytes, { mode: 0o600 });
      expect(loadWorkerModelProfiles(file, sha)).toHaveLength(1);
      expect(() => loadWorkerModelProfiles(file, "f".repeat(64))).toThrow(
        "digest_changed",
      );
      await chmod(file, 0o644);
      expect(() => loadWorkerModelProfiles(file, sha)).toThrow("not_private");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("binds current source, short price qualification and protected artifact origin without inventing judge calibration", () => {
    const p = fixture();
    expect(assertWorkerModelProfileCurrent(p, sourceSha, origin)).toEqual(p);
    expect(workerModelProfileSchema.parse(p)).not.toHaveProperty(
      "calibrationHash",
    );
    for (const altered of [
      { ...p, tariff: { ...p.tariff, sourceSha: "f".repeat(40) } },
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
          "https://attacker.invalid/qualification/report.json",
      },
      {
        ...p,
        qualificationEvidenceRef: `${p.qualificationEvidenceRef}?access_token=fixture`,
      },
    ])
      expect(() =>
        assertWorkerModelProfileCurrent(altered, sourceSha, origin),
      ).toThrow();
  });
  it("enforces owner-declared retirement dates at the exact admission boundary and reserves candidate status for evaluation", () => {
    const p = fixture(), retiredAt = "2026-10-28T00:00:00.000Z";
    const deprecated = { ...p, tariff: { ...p.tariff, testedAt: "2026-10-27T23:59:58.000Z", expiresAt: "2026-10-28T00:00:00.001Z" },
      lifecycle: { ...lifecycle("deprecated"), retirementAt: retiredAt } };
    expect(assertWorkerModelProfileCurrent(deprecated, sourceSha, origin, "runtime", new Date("2026-10-27T23:59:59.999Z"))).toEqual(deprecated);
    expect(() => assertWorkerModelProfileCurrent(deprecated, sourceSha, origin, "runtime", new Date(retiredAt))).toThrow("model_lifecycle_profile_unavailable");
    const candidate = { ...p, lifecycle: lifecycle("candidate") };
    expect(() => assertWorkerModelProfileCurrent(candidate, sourceSha, origin)).toThrow("candidate_not_runtime_qualified");
    expect(assertWorkerModelProfileCurrent(candidate, sourceSha, origin, "candidate_evaluation")).toEqual(candidate);
    for (const status of ["migration_required", "retired"] as const)
      expect(() => assertWorkerModelProfileCurrent({ ...p, lifecycle: lifecycle(status) }, sourceSha, origin, "candidate_evaluation")).toThrow("model_lifecycle_profile_unavailable");
    expect(assertWorkerModelProfileCurrent(p, sourceSha, origin)).toEqual(p); // Old pinned profiles remain exact-qualified but untracked.
  });
  it("allows migration only when declared data/region, tool, rate, context and cost ceilings are preserved", () => {
    const from = { ...fixture(), lifecycle: { ...lifecycle("deprecated"), toolUseCapability: true } };
    const next = { ...from, id: randomUUID(), lifecycle: { ...lifecycle("candidate"), toolUseCapability: true }, tariff: { ...from.tariff, model: "fixture-model-next" } };
    expect(() => assertModelMigrationCompatible(from, next)).not.toThrow();
    for (const changed of [
      { lifecycle: { ...next.lifecycle!, regionOrRoutingProfile: "anthropic-eu-west-v1" } },
      { lifecycle: { ...next.lifecycle!, dataUseProfile: "provider-training" } },
      { lifecycle: { ...next.lifecycle!, toolUseCapability: false } },
      { transport: "server-anthropic-messages-v1" as const, contract: "anthropic-messages-tools-2023-06-01" as const },
      { lifecycle: { ...next.lifecycle!, rateLimits: { requestsPerMinute: 10, tokensPerMinute: 10000 } } },
      { inputTokensUpperBound: 99999 },
      { tariff: { ...next.tariff, outputMinorPerMillion: from.tariff.outputMinorPerMillion + 1 } },
    ]) expect(() => assertModelMigrationCompatible(from, { ...next, ...changed })).toThrow("model_lifecycle_candidate_incompatible");
    expect(() => assertModelMigrationCompatible(from, { ...next, lifecycle: undefined })).toThrow("model_lifecycle_compatibility_unavailable");
  });
  it("refuses raw keys, sessions, unknown model destinations, subscriptions and ambiguous presence qualification", async () => {
    const p = fixture();
    for (const altered of [
      { ...p, apiKey: "raw-key" },
      { ...p, providerUrl: "https://attacker.invalid" },
      { ...p, transport: "managed-session" },
      {
        ...p,
        binding: {
          provider: "anthropic",
          method: "api_key",
          mode: "responsible_user",
        },
      },
      { ...p, tariff: { ...p.tariff, provider: "openai" } },
    ])
      expect(workerModelProfileSchema.safeParse(altered).success).toBe(false);
    const home = await mkdtemp(join(tmpdir(), "aw-worker-model-duplicates-")),
      file = join(home, "profiles.json");
    try {
      const bytes = JSON.stringify([p, { ...p, id: randomUUID() }]);
      await writeFile(file, bytes, { mode: 0o600 });
      expect(() =>
        loadWorkerModelProfiles(
          file,
          createHash("sha256").update(bytes).digest("hex"),
        ),
      ).toThrow("ambiguous");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
