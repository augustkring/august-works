import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeToolsToken, verifyRuntimeToolsToken } from "./runtime-tools-token.js";
import type { ProviderConformanceRuntimeToolsBinding } from "./provider-conformance-runtime-tools-claim.js";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const binding: ProviderConformanceRuntimeToolsBinding = {
  qualificationGroupId: "10000000-0000-4000-8000-000000000001",
  probeId: "10000000-0000-4000-8000-000000000002",
  probeRunId: "10000000-0000-4000-8000-000000000003",
  planId: "10000000-0000-4000-8000-000000000004",
  profileId: "10000000-0000-4000-8000-000000000005",
  dispatchNonce: "10000000-0000-4000-8000-000000000006",
  authorityHash: "a".repeat(64),
};

function tokenInput(overrides: Record<string, unknown> = {}): Parameters<typeof createRuntimeToolsToken>[0] {
  return {
    agentId: "agent-1",
    companyId: "company-1",
    runId: binding.probeRunId,
    responsibleUserId: "user-1",
    scope: "provider_conformance" as const,
    providerConformanceBinding: binding,
    providerConformanceDeadlineAt: new Date(NOW.getTime() + 10 * 60_000),
    ...overrides,
  } as Parameters<typeof createRuntimeToolsToken>[0];
}

describe("runtime connection tools token", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("binds the token to company, agent, run, responsible user, and scope", () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-runtime-tools-secret");
    vi.setSystemTime(NOW);
    const minted = createRuntimeToolsToken({
      agentId: "agent-1",
      companyId: "company-1",
      runId: "run-1",
      responsibleUserId: "user-1",
    });
    expect(minted).not.toBeNull();
    expect(verifyRuntimeToolsToken(minted!.token)).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      run_id: "run-1",
      responsible_user_id: "user-1",
      scope: "connection_intents",
    });
  });

  it("rejects tampering and expiry", () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-runtime-tools-secret");
    vi.setSystemTime(NOW);
    const minted = createRuntimeToolsToken({
      agentId: "agent-1",
      companyId: "company-1",
      runId: "run-1",
      responsibleUserId: "user-1",
    })!;
    expect(verifyRuntimeToolsToken(`${minted.token.slice(0, -1)}x`)).toBeNull();
    vi.setSystemTime(new Date("2026-08-26T13:00:01.000Z"));
    expect(verifyRuntimeToolsToken(minted.token)).toBeNull();
  });

  it("signs the exact provider-conformance binding and verifies it only in its own scope", () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-runtime-tools-secret");
    vi.setSystemTime(NOW);
    const minted = createRuntimeToolsToken(tokenInput());
    expect(minted).not.toBeNull();
    const verified = verifyRuntimeToolsToken(minted!.token, "provider_conformance");
    expect(verified).toMatchObject({
      sub: "agent-1", company_id: "company-1", run_id: binding.probeRunId,
      responsible_user_id: "user-1", scope: "provider_conformance",
    });
    expect(verified?.provider_conformance).toEqual(binding);
    expect(verifyRuntimeToolsToken(minted!.token)).toBeNull();
    expect(verifyRuntimeToolsToken(minted!.token, "worker_model")).toBeNull();

    const ordinary = createRuntimeToolsToken({ agentId: "agent-1", companyId: "company-1",
      runId: binding.probeRunId, responsibleUserId: "user-1" });
    expect(verifyRuntimeToolsToken(ordinary!.token, "provider_conformance")).toBeNull();
  });

  it("clips provider-conformance expiry to the live deadline and a 60-second maximum", () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-runtime-tools-secret");
    vi.setSystemTime(NOW);
    const capped = createRuntimeToolsToken(tokenInput({
      providerConformanceDeadlineAt: new Date(NOW.getTime() + 5 * 60_000),
    }))!;
    const cappedClaims = verifyRuntimeToolsToken(capped.token, "provider_conformance")!;
    expect(cappedClaims.exp - cappedClaims.iat).toBe(60);
    expect(new Date(cappedClaims.exp * 1000).toISOString()).toBe(capped.expiresAt);

    const deadlineBound = createRuntimeToolsToken(tokenInput({
      providerConformanceDeadlineAt: new Date(NOW.getTime() + 25_000),
    }))!;
    const deadlineClaims = verifyRuntimeToolsToken(deadlineBound.token, "provider_conformance")!;
    expect(deadlineClaims.exp - deadlineClaims.iat).toBe(25);
    expect(deadlineClaims.exp * 1000).toBeLessThanOrEqual(NOW.getTime() + 25_000);
  });

  const invalidInputs: Array<[string, Record<string, unknown>]> = [
    ["missing binding", { providerConformanceBinding: undefined }],
    ["missing deadline", { providerConformanceDeadlineAt: undefined }],
    ["expired deadline", { providerConformanceDeadlineAt: new Date(NOW.getTime() - 1) }],
    ["mismatched run", { runId: "10000000-0000-4000-8000-000000000099" }],
    ["malformed profile UUID", { providerConformanceBinding: { ...binding, profileId: "profile-1" } }],
    ["missing authority hash", { providerConformanceBinding: { ...binding, authorityHash: undefined } }],
    ["extra binding field", { providerConformanceBinding: { ...binding, ordinaryScope: true } }],
  ];
  it.each(invalidInputs)("refuses provider-conformance token creation with %s", (_label, overrides) => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-runtime-tools-secret");
    vi.setSystemTime(NOW);
    expect(createRuntimeToolsToken(tokenInput(overrides))).toBeNull();
  });

  it("refuses a provider-conformance token after its signed expiry", () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "test-runtime-tools-secret");
    vi.setSystemTime(NOW);
    const minted = createRuntimeToolsToken(tokenInput({
      providerConformanceDeadlineAt: new Date(NOW.getTime() + 20_000),
    }))!;
    vi.setSystemTime(new Date(NOW.getTime() + 21_000));
    expect(verifyRuntimeToolsToken(minted.token, "provider_conformance")).toBeNull();
  });
});
