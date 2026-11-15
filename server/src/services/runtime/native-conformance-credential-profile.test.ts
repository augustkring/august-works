import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeToolsToken, verifyRuntimeToolsToken, type RuntimeToolsTokenClaims } from "../../runtime-tools-token.js";
import { managedModelCredentialProfileExact, managedOpenCodeConformanceCredentialValid } from "./control.js";

// CONF3c. RuntimeControl compared the signed conformance claim's profileId
// (the qualified WorkerModelProfile) with the Host's OpenShell auth-injection
// profile id, two different namespaces, so every probe session start was
// refused. The claims here are real signed tokens, so the claim parser's own
// shape rules (a UUID profileId) apply as they do in RuntimeControl.
describe("managed OpenCode conformance credential profile binding (CONF3c)", () => {
  const NOW = new Date("2026-11-15T12:00:00.000Z");
  // The Host's auth-injection profile, as the managed fixture Host advertises it.
  const hostProfile = { id: "paperclip-model-broker", hash: "e".repeat(64) };
  const origin = "https://broker.conformance.test";
  beforeEach(() => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "conformance-credential-profile-secret");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function fixture() {
    const ids = { company: randomUUID(), agent: randomUUID(), user: randomUUID(), run: randomUUID(), group: randomUUID(),
      plan: randomUUID(), probe: randomUUID(), workerModelProfile: randomUUID(), nonce: randomUUID() };
    const authorityHash = "a".repeat(64);
    const dispatch = { qualificationGroupId: ids.group, planId: ids.plan, profileId: ids.workerModelProfile,
      probeId: ids.probe, dispatchNonce: ids.nonce, authorityHash };
    const contextSnapshot = { providerConformanceGroupId: ids.group, providerConformancePlanId: ids.plan,
      nativeOpenCodeConformanceProbeId: ids.probe, nativeOpenCodeConformanceProfileId: ids.workerModelProfile,
      containsCompanyContext: false, platformToolsGranted: false, nativeOpenCodeConformanceDispatch: dispatch };
    const sign = (binding: Record<string, unknown> = {}, token: Record<string, unknown> = {}) => {
      const minted = createRuntimeToolsToken({ agentId: ids.agent, companyId: ids.company, runId: ids.run,
        responsibleUserId: ids.user, scope: "provider_conformance",
        providerConformanceBinding: { qualificationGroupId: ids.group, probeId: ids.probe, probeRunId: ids.run,
          planId: ids.plan, profileId: ids.workerModelProfile, dispatchNonce: ids.nonce, authorityHash, ...binding },
        providerConformanceDeadlineAt: new Date(NOW.getTime() + 10 * 60_000), ...token } as Parameters<typeof createRuntimeToolsToken>[0]);
      return minted ? verifyRuntimeToolsToken(minted.token, "provider_conformance") : null;
    };
    const claims = sign();
    const input = (overrides: Partial<Parameters<typeof managedOpenCodeConformanceCredentialValid>[0]> = {}) => ({
      providerConformanceBootstrap: true, qualificationGroupId: ids.group, conformancePlanId: ids.plan,
      run: { id: ids.run, agentId: ids.agent, responsibleUserId: ids.user, contextSnapshot },
      companyId: ids.company, nativeSessionStartValid: true, modelBrokerSessionPhase: "start",
      modelCredentialExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(), conformanceClaims: claims,
      otherModelClaimsPresent: false, inputAndExpiryValid: true, nowMs: NOW.getTime(), ...overrides,
    });
    const withContext = (changes: Record<string, unknown>) => ({ ...input().run, contextSnapshot: { ...contextSnapshot, ...changes } });
    const withDispatch = (changes: Record<string, unknown>) => withContext({ nativeOpenCodeConformanceDispatch: { ...dispatch, ...changes } });
    return { ids, claims, sign, input, withContext, withDispatch };
  }

  it("admits the probe whose claim, Run and issuer tuple name the same WorkerModelProfile, under any Host profile id", () => {
    const { ids, claims, input } = fixture();
    expect(claims?.provider_conformance?.profileId).toBe(ids.workerModelProfile);
    // The fixture Host's auth-injection profile id is not, and cannot be, the
    // WorkerModelProfile id: a signed conformance claim only carries a UUID.
    expect(hostProfile.id).not.toBe(ids.workerModelProfile);
    // Before the fix this was false: the claim and tuple profileId were
    // compared with the Host profile id.
    expect(managedOpenCodeConformanceCredentialValid(input())).toBe(true);
    // The Host profile is still bound, through the credential, exactly.
    const credential = { profileId: hostProfile.id, profileHash: hostProfile.hash };
    const env = { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: origin };
    expect(managedModelCredentialProfileExact({ modelCredential: credential, providerProfile: hostProfile, env,
      managedModelBrokerOrigin: origin })).toBe(true);
  });

  it("keeps the Host profile binding: another Host profile, hash or origin, or the WorkerModelProfile id, is refused", () => {
    const { ids } = fixture();
    const env = { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: origin };
    const exact = (credential: { profileId: string; profileHash: string } | undefined,
      profile: { id: string; hash: string } | null = hostProfile, requestEnv: Record<string, string | undefined> = env,
      configuredOrigin: string | null = origin) =>
      managedModelCredentialProfileExact({ modelCredential: credential, providerProfile: profile, env: requestEnv,
        managedModelBrokerOrigin: configuredOrigin });
    const credential = { profileId: hostProfile.id, profileHash: hostProfile.hash };
    expect(exact({ ...credential, profileId: ids.workerModelProfile })).toBe(false);
    expect(exact({ ...credential, profileId: "paperclip-runtime-app-broker" })).toBe(false);
    expect(exact({ ...credential, profileHash: "f".repeat(64) })).toBe(false);
    expect(exact(undefined)).toBe(false);
    expect(exact(credential, null)).toBe(false);
    expect(exact(credential, hostProfile, { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://attacker.invalid" })).toBe(false);
    expect(exact(credential, hostProfile, {})).toBe(false);
    expect(exact(credential, hostProfile, { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: undefined }, null)).toBe(false);
  });

  it("refuses a claim, Run selector or issuer tuple that names another WorkerModelProfile", () => {
    const { input, sign, withContext, withDispatch } = fixture();
    const other = randomUUID();
    // Another profile in the signed claim only.
    expect(managedOpenCodeConformanceCredentialValid(input({ conformanceClaims: sign({ profileId: other }) }))).toBe(false);
    // Another profile in the issuer-persisted tuple only.
    expect(managedOpenCodeConformanceCredentialValid(input({ run: withDispatch({ profileId: other }) }))).toBe(false);
    // Another server-created Run selector only.
    expect(managedOpenCodeConformanceCredentialValid(input({ run: withContext({ nativeOpenCodeConformanceProfileId: other }) }))).toBe(false);
    // Claim and tuple agree on another profile, but the Run selector does not.
    expect(managedOpenCodeConformanceCredentialValid(input({ conformanceClaims: sign({ profileId: other }),
      run: withDispatch({ profileId: other }) }))).toBe(false);
    // Missing selector or tuple profile.
    expect(managedOpenCodeConformanceCredentialValid(input({ run: withContext({ nativeOpenCodeConformanceProfileId: undefined }) }))).toBe(false);
    expect(managedOpenCodeConformanceCredentialValid(input({ run: withDispatch({ profileId: undefined }) }))).toBe(false);
    // The Host profile id cannot stand in for the WorkerModelProfile: the claim
    // parser refuses it, and a tuple or selector naming it does not match.
    expect(sign({ profileId: hostProfile.id })).toBeNull();
    expect(managedOpenCodeConformanceCredentialValid(input({ run: withDispatch({ profileId: hostProfile.id }) }))).toBe(false);
    expect(managedOpenCodeConformanceCredentialValid(input({ run: withContext({ nativeOpenCodeConformanceProfileId: hostProfile.id }) }))).toBe(false);
  });

  it("keeps every other conformance binding", () => {
    const { ids, input, sign, withContext, withDispatch } = fixture();
    const valid = (overrides: Partial<Parameters<typeof managedOpenCodeConformanceCredentialValid>[0]>) =>
      managedOpenCodeConformanceCredentialValid(input(overrides));
    // Run, group, plan, probe, nonce and authority.
    expect(valid({ conformanceClaims: sign({ probeId: randomUUID() }) })).toBe(false);
    expect(valid({ conformanceClaims: sign({ dispatchNonce: randomUUID() }) })).toBe(false);
    expect(valid({ conformanceClaims: sign({ authorityHash: "b".repeat(64) }) })).toBe(false);
    expect(valid({ conformanceClaims: sign({ qualificationGroupId: randomUUID() }) })).toBe(false);
    expect(valid({ conformanceClaims: sign({ planId: randomUUID() }) })).toBe(false);
    expect(valid({ run: withDispatch({ probeId: randomUUID() }) })).toBe(false);
    expect(valid({ run: withDispatch({ planId: randomUUID() }) })).toBe(false);
    expect(valid({ run: withDispatch({ qualificationGroupId: randomUUID() }) })).toBe(false);
    expect(valid({ run: withContext({ nativeOpenCodeConformanceDispatch: undefined }) })).toBe(false);
    expect(valid({ run: withContext({ nativeOpenCodeConformanceProbeId: randomUUID() }) })).toBe(false);
    expect(valid({ run: withContext({ providerConformanceGroupId: randomUUID() }) })).toBe(false);
    expect(valid({ qualificationGroupId: randomUUID() })).toBe(false);
    expect(valid({ conformancePlanId: randomUUID() })).toBe(false);
    expect(valid({ qualificationGroupId: null })).toBe(false);
    // Another Run, company, Agent or Human.
    expect(valid({ run: { ...input().run, id: randomUUID() } })).toBe(false);
    expect(valid({ companyId: randomUUID() })).toBe(false);
    expect(valid({ run: { ...input().run, agentId: randomUUID() } })).toBe(false);
    expect(valid({ run: { ...input().run, responsibleUserId: randomUUID() } })).toBe(false);
    // Session phase, start owner, bootstrap source, other claim families.
    expect(valid({ modelBrokerSessionPhase: "refresh" })).toBe(false);
    expect(valid({ modelBrokerSessionPhase: undefined })).toBe(false);
    expect(valid({ nativeSessionStartValid: false })).toBe(false);
    expect(valid({ providerConformanceBootstrap: false })).toBe(false);
    expect(valid({ otherModelClaimsPresent: true })).toBe(false);
    expect(valid({ conformanceClaims: null })).toBe(false);
    expect(valid({ conformanceClaims: { ...(input().conformanceClaims as RuntimeToolsTokenClaims), scope: "worker_model" } })).toBe(false);
    // Bounds and expiry.
    expect(valid({ inputAndExpiryValid: false })).toBe(false);
    expect(valid({ modelCredentialExpiresAt: undefined })).toBe(false);
    const claimExpiry = (input().conformanceClaims as RuntimeToolsTokenClaims).exp * 1000;
    expect(valid({ modelCredentialExpiresAt: new Date(claimExpiry + 1_000).toISOString() })).toBe(false);
    expect(valid({ nowMs: claimExpiry + 1 })).toBe(false);
    expect(ids.run).toBe(input().run.id);
  });
});
