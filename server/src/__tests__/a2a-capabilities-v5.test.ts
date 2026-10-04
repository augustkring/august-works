import { expect, it } from "vitest";
import { mapA2AAgentCard } from "../services/a2a-capabilities.js";
import { makeProviderCapabilitySnapshot } from "../services/provider-capabilities.js";

const card = { name: "External agent", version: "1.2", protocolVersion: "0.3.0", provider: { organization: "Provider" }, url: "https://provider.example/a2a", preferredTransport: "JSONRPC", capabilities: { streaming: true }, defaultOutputModes: ["application/json"], security: [{ bearer: ["agent:invoke", "agent:read"] }], skills: [{ id: "research", name: "Research", description: "Advertised procedure", tags: ["research"] }] };
it("maps bounded A2A advertisements while leaving unproved execution authority and isolation unavailable", () => {
  const snapshot = makeProviderCapabilitySnapshot(mapA2AAgentCard(card));
  expect(snapshot).toMatchObject({ provider: "a2a", providerAgentRef: card.name, version: "1.2", providerOrganization: "Provider", protocolVersion: "0.3.0", interfaces: [{ protocol: "JSONRPC", url: card.url }], securityRequirements: card.security, skills: [{ id: "research", version: "1.2" }], features: { skillsDiscovery: true, structuredOutput: true, memoryScoping: false, cancellation: true, sessions: true } });
  expect(mapA2AAgentCard({ ...card, protocolVersion: "future" }).features.sessions).toBe(false);
  expect(makeProviderCapabilitySnapshot(mapA2AAgentCard({ ...card, security: [{ bearer: ["agent:read", "agent:invoke"] }] })).hash).toBe(snapshot.hash);
  expect(() => mapA2AAgentCard({ ...card, url: "https://secret:password@provider.example/a2a" })).toThrow();
  expect(() => mapA2AAgentCard({ ...card, skills: Array(501).fill(card.skills[0]) })).toThrow();
  expect(() => mapA2AAgentCard({ ...card, capabilities: { streaming: "true" } })).toThrow();
});
