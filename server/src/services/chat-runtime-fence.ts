import { createHash } from "node:crypto";

export type ChatCredentialRefForFence = {
  configPath: string;
  secretId: string;
  versionSelector?: number | "latest" | null;
};

/** Canonical runtime generation/fingerprint used by provider callback owners. */
export function runtimeGeneration(setup: unknown): number {
  const row = setup && typeof setup === "object" && !Array.isArray(setup) ? setup as Record<string, unknown> : {};
  const value = Number(row.runtimeGeneration ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function credentialFingerprint(refs: readonly ChatCredentialRefForFence[]): string {
  const stable = refs.map(ref => ({ configPath: ref.configPath, secretId: ref.secretId,
    versionSelector: ref.versionSelector ?? "latest" })).sort((left, right) =>
    `${left.configPath}:${left.secretId}:${left.versionSelector}`.localeCompare(
      `${right.configPath}:${right.secretId}:${right.versionSelector}`));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
