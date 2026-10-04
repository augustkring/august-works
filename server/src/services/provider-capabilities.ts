import { providerCapabilitySnapshotSchema, PROVIDER_CAPABILITY_FEATURES, type ProviderCapabilitySnapshot } from "@paperclipai/shared";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";

export function makeProviderCapabilitySnapshot(input: Omit<ProviderCapabilitySnapshot, "hash">): ProviderCapabilitySnapshot {
  const snapshot = providerCapabilitySnapshotSchema.parse({ ...input, hash: "pending" });
  // Discovery timestamps do not change the behavior contract. Stable ordering
  // avoids false drift when a provider returns the same inventory differently.
  const skills = [...snapshot.skills].sort((a, b) => a.id.localeCompare(b.id));
  const tools = [...snapshot.tools].sort((a, b) => a.id.localeCompare(b.id));
  const interfaces = snapshot.interfaces?.slice().sort((a, b) => `${a.protocol}:${a.url}`.localeCompare(`${b.protocol}:${b.url}`));
  const securityRequirements = snapshot.securityRequirements?.map((item) => Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, scopes]) => [key, [...scopes].sort()]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const normalized = { ...snapshot, skills, tools, ...(interfaces ? { interfaces } : {}), ...(securityRequirements ? { securityRequirements } : {}) };
  const { discoveredAt: _discoveredAt, hash: _hash, ...contract } = normalized;
  return { ...normalized, hash: hashContextPolicySnapshot(contract) };
}

export function providerCapabilityChanges(before: ProviderCapabilitySnapshot | null, after: ProviderCapabilitySnapshot) {
  if (!before || before.hash === after.hash) return { changed: false, lostFeatures: [], lostSkills: [], lostTools: [], versionChanged: false };
  return {
    changed: true,
    lostFeatures: PROVIDER_CAPABILITY_FEATURES.filter((key) => before.features[key] && !after.features[key]),
    lostSkills: before.skills.filter((item) => !after.skills.some((next) => next.id === item.id && next.version === item.version)).map((item) => item.id),
    lostTools: before.tools.filter((item) => !after.tools.some((next) => next.id === item.id && next.version === item.version)).map((item) => item.id),
    versionChanged: before.version !== after.version,
  };
}

export function providerConformanceRequirements(snapshot: ProviderCapabilitySnapshot, isolationMode: string): string[] {
  return ["connect", "identity", "start", "stream", "wait", "cancel",
    ...(snapshot.features.sessions ? ["resume"] : []),
    ...(snapshot.features.steering ? ["steering"] : []),
    ...(snapshot.features.skillsDiscovery ? ["skillsDiscovery"] : []),
    ...(snapshot.features.skillsSync ? ["skillsSync"] : []),
    ...(snapshot.features.toolDiscovery ? ["toolDiscovery"] : []),
    ...(snapshot.features.structuredOutput ? ["structuredOutput"] : []),
    ...(snapshot.features.memoryScoping || isolationMode === "isolated_per_presence" ? ["memoryScoping"] : []),
  ];
}
