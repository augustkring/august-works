import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SANDBOX_CONTROLS, qualificationProbeFixtureSchema, sandboxCapabilitySnapshotSchema, type SandboxCapabilitySnapshot, type SandboxQualificationProbeFixture } from "@paperclipai/shared";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { projectOpenShellQualificationProbePolicy } from "../services/execution-sandbox/openshell-policy.js";
import { openShellBackend, type OpenShellHostBridge } from "../services/execution-sandbox/openshell-backend.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";

const goldenVector = JSON.parse(readFileSync(new URL("./fixtures/openshell-qualification-policy-golden.json", import.meta.url), "utf8")) as {
  fixture: SandboxQualificationProbeFixture;
  document: ReturnType<typeof projectOpenShellQualificationProbePolicy>["document"];
};
function fixture(): SandboxQualificationProbeFixture { return goldenVector.fixture; }

describe("OpenShell qualification-only create policy", () => {
  it("derives a single bounded fixture document from protected nonsecret metadata", () => {
    const input = fixture();
    expect(qualificationProbeFixtureSchema.parse(input)).toEqual(input);
    const projected = projectOpenShellQualificationProbePolicy(input);
    expect(projected.unsupportedFeatures).toEqual([]);
    expect(projected.documentHash).toBe(nativeSha256(projected.document));
    expect(projected.document).toEqual(goldenVector.document);
    expect(projected.document?.process).toEqual({ run_as_user: "1000", run_as_group: "1000" });
    const { fixtureHash, ...fixtureBody } = input;
    expect(nativeSha256(fixtureBody)).toBe(fixtureHash);
    expect(projected.document?.filesystem_policy.read_write).toEqual(["/workspace/project"]);
    expect(projected.document?.filesystem_policy.read_only).toEqual(expect.arrayContaining([
      "/etc", "/etc/os-release", "/proc", "/sys/fs/cgroup",
    ]));
    expect(projected.document?.filesystem_policy.read_write).not.toContain("/proc");
    expect(projected.document?.filesystem_policy.read_only).not.toContain("/dev/null");
    const endpoints = Object.values(projected.document?.network_policies ?? {}).flatMap(policy => policy.endpoints);
    expect(endpoints).toHaveLength(1);
    const canaryEndpoint = endpoints[0]!;
    const canaryRules = canaryEndpoint.rules;
    expect(canaryEndpoint).toMatchObject({ host: "canary.example.test", port: 443, protocol: "rest", enforcement: "enforce" });
    expect(canaryRules).toEqual(goldenVector.document?.network_policies.aw_probe_0?.endpoints[0]?.rules);
    expect(canaryRules).toContainEqual({ allow: { method: "GET", path: "/__aw_qualification_l7_sentinel__" } });
    expect(canaryRules.some(rule => rule.allow?.path.includes("l7-deny"))).toBe(false);
    expect(endpoints.some(endpoint => endpoint.host === "wrong.example.test" || endpoint.port === 8443)).toBe(false);
  });

  it("adds only the exact credential gateway endpoint when a protected credential fixture exists", () => {
    const base = fixture();
    const credentialBody = {
      version: 1 as const, fixtureId: "qualification-canary-v1", profileId: "qualification-profile",
      profileHash: "1".repeat(64), binaries: ["/usr/bin/curl"] as ["/usr/bin/curl"], wrongBinaryPath: "/usr/bin/wget" as const,
      origin: "https://gateway.example.test", port: 443, method: "POST" as const,
      gatewayPublicId: "gateway_public_1", toolName: "qualification_canary", wrongToolName: "wrong_scope_tool",
      argumentTemplateHash: "2".repeat(64), marker: "credential-marker",
    };
    const credential = { ...credentialBody, fixtureHash: nativeSha256(credentialBody) };
    const { fixtureHash: _oldHash, ...baseBody } = base;
    const withCredentialBody = { ...baseBody, credential };
    const withCredential = { ...withCredentialBody, fixtureHash: nativeSha256(withCredentialBody) };
    const projected = projectOpenShellQualificationProbePolicy(withCredential);
    expect(projected.unsupportedFeatures).toEqual([]);
    const endpoints = Object.values(projected.document?.network_policies ?? {}).flatMap(policy => policy.endpoints);
    const credentialEndpoints = endpoints.filter(endpoint => endpoint.host === "gateway.example.test");
    expect(endpoints).toHaveLength(2);
    expect(credentialEndpoints).toEqual([{
      host: "gateway.example.test", port: 443, protocol: "rest", enforcement: "enforce",
      rules: [{ allow: { method: "POST", path: "/mcp/gateways/gateway_public_1" } }],
    }]);
    expect(credentialEndpoints.some(endpoint => endpoint.rules.some(rule => rule.allow.path === "/*" || rule.allow.path === "/mcp/*"))).toBe(false);
  });

  it("allows setup metadata preflight only with every capability disabled", () => {
    const probeFixture = fixture();
    const snapshot = {
      ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, false])),
      backend: "openshell", backendVersion: "0.1.2", hostKernelVersion: "fixture-kernel",
      sandboxImageDigest: "fixture.invalid/openshell@sha256:" + "a".repeat(64),
      filesystemEnforcementMode: "hard_requirement", staticPolicyRequiresRecreate: true,
      dynamicNetworkPolicy: false, policyProverBoundaryCheck: false, policyProverCoverage: [],
      credentialBindingDimensions: [], qualificationProbeFixture: probeFixture,
      qualificationCredentialFixture: probeFixture.credential,
      testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
      qualificationHash: probeFixture.fixtureHash, evidenceKind: "protected_host_report",
    } as SandboxCapabilitySnapshot;
    expect(sandboxCapabilitySnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(sandboxCapabilitySnapshotSchema.safeParse({ ...snapshot, credentialBrokering: true }).success).toBe(false);
    expect(sandboxCapabilitySnapshotSchema.safeParse({ ...snapshot, policyProverBoundaryCheck: true }).success).toBe(false);
  });


  it("requires a post-create target receipt matching the exact qualification operation", async () => {
    const probeFixture = fixture();
    const identity = {
      companyId: "11111111-1111-4111-8111-111111111111",
      bindingId: "22222222-2222-4222-8222-222222222222",
      cellId: "33333333-3333-4333-8333-333333333333",
      cellGeneration: "7",
      sandboxRef: "aw-v7-44444444-4444-4444-8444-444444444444",
    };
    const boundary = policyFixture();
    boundary.process.uid = 1000;
    const imageDigest = `fixture.invalid/openshell@sha256:${"a".repeat(64)}`;
    const containerId = "b".repeat(64);
    const prepared = {
      ...identity, backendVersion: "0.1.2", imageDigest, hostEpoch: 9,
      sandboxId: "55555555-5555-4555-8555-555555555555", containerId,
      provisioningHash: "c".repeat(64), bindingVersion: 3,
    };
    let finalSnapshot: SandboxCapabilitySnapshot | null = null;
    let publishTarget = true;
    let provisioningRequest: Parameters<OpenShellHostBridge["prepare"]>[1] | undefined;
    const preflight = () => ({
      ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, false])),
      backend: "openshell" as const, backendVersion: "0.1.2", hostKernelVersion: "fixture-kernel",
      sandboxImageDigest: imageDigest, filesystemEnforcementMode: "hard_requirement" as const,
      staticPolicyRequiresRecreate: true, dynamicNetworkPolicy: false, policyProverBoundaryCheck: false,
      policyProverCoverage: [], credentialBindingDimensions: [], qualificationProbeFixture: probeFixture,
      qualificationCredentialFixture: probeFixture.credential,
      testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
      qualificationHash: probeFixture.fixtureHash, evidenceKind: "protected_host_report" as const,
    }) as SandboxCapabilitySnapshot;
    const bridge = {
      capabilities: async () => finalSnapshot ?? preflight(),
      prepare: async (_scope: typeof identity, request?: Parameters<OpenShellHostBridge["prepare"]>[1]) => {
        provisioningRequest = request;
        if (request && publishTarget) {
          const targetBody = {
            hostEpoch: prepared.hostEpoch!, ...identity, bindingVersion: prepared.bindingVersion!,
            sandboxId: prepared.sandboxId!, containerId, imageDigest, hostKernelVersion: "fixture-kernel",
            runtimeBinarySha256: "d".repeat(64), openshellCliSha256: "e".repeat(64), dockerEngineIdHash: "f".repeat(64),
            policyHash: request.policyHash, provisioningHash: prepared.provisioningHash!, resourceLimits: request.resourceLimits,
            policyVersion: 1, configRevision: "fixture-r1", phase: "Ready" as const,
            mechanism: "openshell_create_sandbox_v0.1.2" as const,
            probePolicyHash: nativeSha256(request.document), probeFixtureHash: request.probeFixtureHash!,
          };
          const target = { ...targetBody, targetHash: nativeSha256(targetBody) };
          finalSnapshot = {
            ...preflight(), qualificationTarget: target, qualificationHash: target.targetHash,
          } as SandboxCapabilitySnapshot;
        }
        return request ? { ...prepared, bindingVersion: request.bindingVersion, policyHash: request.policyHash,
          probePolicyHash: nativeSha256(request.document), resourceLimits: request.resourceLimits } : prepared;
      },
      inspect: async () => ({ state: "stopped" as const, policyHash: null, imageDigest, generation: identity.cellGeneration, controlsHealthy: false }),
      effectivePolicy: async () => ({ version: 1 as const, filesystem_policy: { include_workdir: false as const, read_only: [], read_write: [] }, landlock: { compatibility: "hard_requirement" as const }, process: { run_as_user: "1000", run_as_group: "1000" }, network_policies: {} }),
      apply: async () => ({ applied: false, policyHash: null }), start: async () => ({ operationId: "start" }),
      revokeProviders: async () => {}, stop: async () => ({ operationId: "stop" }), destroy: async () => ({ operationId: "delete" }),
      probe: async ({ test }: { test: { contractHash: string } }) => ({ verdict: "unsupported" as const, observationHash: null, contractHash: test.contractHash }),
    } satisfies OpenShellHostBridge;
    const backend = openShellBackend({ identity, boundary, bridge, evidenceKind: "protected_host_report", prover: { executable: "unused", executableSha256: "0".repeat(64) } });
    const intent = { purpose: "qualification" as const, operationKey: "op-qualification-1", bindingVersion: 3, expiresAt: new Date(Date.now() + 30000).toISOString() };

    // The host may expose config-only preflight before create, but cannot use
    // that same response as proof that a target was created.
    finalSnapshot = null;
    publishTarget = false;
    await expect(backend.prepareSandbox(identity, intent)).rejects.toMatchObject({ status: 409, details: { code: "sandbox_qualification_target_mismatch" } });
    expect(provisioningRequest?.qualificationProbeFixture?.fixtureHash).toBe(probeFixture.fixtureHash);

    finalSnapshot = null;
    publishTarget = true;
    const exactBridge = { ...bridge, prepare: async (_scope: typeof identity, request?: Parameters<OpenShellHostBridge["prepare"]>[1]) => {
      provisioningRequest = request;
      // Reuse the first bridge's exact synthetic prepare and final report builder.
      const result = await bridge.prepare(_scope, request);
      return result;
    } } satisfies OpenShellHostBridge;
    const exactBackend = openShellBackend({ identity, boundary, bridge: exactBridge, evidenceKind: "protected_host_report", prover: { executable: "unused", executableSha256: "0".repeat(64) } });
    await expect(exactBackend.prepareSandbox(identity, intent)).resolves.toMatchObject({ sandboxId: prepared.sandboxId, containerId, provisioningHash: prepared.provisioningHash });
    expect(finalSnapshot?.qualificationTarget?.probeFixtureHash).toBe(probeFixture.fixtureHash);
  });

  it("rejects an unsafe fixture overlap instead of widening reads or writes", () => {
    const input = fixture();
    const overlapping = { ...input, filesystem: { ...input.filesystem, workdirPath: "/" } };
    expect(qualificationProbeFixtureSchema.safeParse(overlapping).success).toBe(false);
    const badMarker = { ...input, network: { ...input.network, allow: { ...input.network.allow, urlTemplate: "https://canary.example.test/allow/{nonce}tail" } } };
    expect(projectOpenShellQualificationProbePolicy(badMarker).unsupportedFeatures).toContain("qualification_network_template_invalid");
    const broadGlob = { ...input, network: { ...input.network, allow: { ...input.network.allow, urlTemplate: "https://canary.example.test/allow/*/{nonce}" } } };
    expect(projectOpenShellQualificationProbePolicy(broadGlob).unsupportedFeatures).toContain("qualification_network_template_invalid");
    const hiddenDeniedRead = { ...input, filesystem: { ...input.filesystem, deniedReadPath: "/usr/bin/secret-fixture" } };
    expect(projectOpenShellQualificationProbePolicy(hiddenDeniedRead).unsupportedFeatures).toContain("qualification_fixture_paths_or_identity_overlap");
  });
});
