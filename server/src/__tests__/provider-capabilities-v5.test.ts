import { describe, expect, it } from "vitest";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import { makeProviderCapabilitySnapshot, providerCapabilityChanges, providerConformanceRequirements } from "../services/provider-capabilities.js";

const base = {
  provider: "hermes", version: "1",
  features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, true])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>,
  skills: [{ id: "a", name: "A", description: "", version: "1" }, { id: "b", name: "B", description: "", version: "1" }],
  tools: [{ id: "t", name: "Tool", description: "", version: "1" }], discoveredAt: "2026-10-03T00:00:00Z",
};
describe("V5 provider contracts", () => {
  it("ignores discovery time/order, but detects lost features, tools and changed versions", () => {
    const before = makeProviderCapabilitySnapshot(base);
    expect(makeProviderCapabilitySnapshot({ ...base, skills: [...base.skills].reverse(), discoveredAt: "2026-10-04T00:00:00Z" }).hash).toBe(before.hash);
    const after = makeProviderCapabilitySnapshot({ ...base, version: "2", features: { ...base.features, cancellation: false }, tools: [], skills: base.skills.slice(1) });
    expect(providerCapabilityChanges(before, after)).toMatchObject({ changed: true, versionChanged: true, lostFeatures: ["cancellation"], lostTools: ["t"], lostSkills: ["a"] });
  });
  it("requires tested memory isolation and every advertised feature for qualification", () => {
    const snapshot = makeProviderCapabilitySnapshot({ ...base, features: { ...base.features, memoryScoping: false } });
    expect(providerConformanceRequirements(snapshot, "isolated_per_presence")).toEqual(expect.arrayContaining(["connect", "identity", "start", "stream", "wait", "cancel", "resume", "memoryScoping", "structuredOutput", "skillsDiscovery", "toolDiscovery"]));
    expect(() => makeProviderCapabilitySnapshot({ ...base, features: { ...base.features, cancellation: "true" as unknown as boolean } })).toThrow();
  });
});
