import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertWorkerModelProfileCurrent,
  loadWorkerModelProfiles,
  workerModelProfileSchema,
  type WorkerModelProfile,
} from "../services/orchestration/worker-model-profiles.js";
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
describe("private worker text transport qualifications", () => {
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
