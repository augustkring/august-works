import { describe, expect, it } from "vitest";
import { sandboxPolicySchema, SANDBOX_CONTROLS, type SandboxCapabilitySnapshot, type SandboxPolicy } from "@paperclipai/shared";
import { compileSandboxPolicy } from "../services/execution-sandbox/policy-compiler.js";
import { runSandboxQualification } from "../services/execution-sandbox/qualification.js";
import { existingCellContainerBackend } from "../services/execution-sandbox/compatibility-backend.js";
import type { ExecutionSandboxBackend } from "../services/execution-sandbox/backend.js";
const now = new Date("2026-10-05T12:00:00Z"), image = "fixture.invalid/sandbox@sha256:" + "a".repeat(64);
import { policyFixture } from "./helpers/sandbox-fixture.js";
const caps = (): SandboxCapabilitySnapshot => ({ ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, true])), backend: "openshell", backendVersion: "fixture", hostKernelVersion: "fixture", sandboxImageDigest: image, filesystemEnforcementMode: "hard_requirement", staticPolicyRequiresRecreate: true, dynamicNetworkPolicy: true, policyProverBoundaryCheck: true, policyProverCoverage: [...SANDBOX_CONTROLS], credentialBindingDimensions: ["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"], testedAt: now.toISOString(), expiresAt: "2026-10-06T12:00:00Z", qualificationHash: "a".repeat(64), evidenceKind: "local_fixture" } as SandboxCapabilitySnapshot);
const compile = (candidate = policyFixture(), capabilities: SandboxCapabilitySnapshot | null = caps(), boundary = policyFixture(), grants = {}) => compileSandboxPolicy({ candidate, capabilities, boundary, authorizedConnectionGrantHashes: grants, sourcePolicyRefs: ["fixture-only"], now });
describe("V7 policy subset proofs, distinct from physical boundary qualification", () => {
  it("proves a narrower policy and pins deterministic content", () => { const p = policyFixture(); p.filesystem.readPaths = ["/work/input"]; p.resources.wallClockSeconds = 60; const first = compile(p); expect(first.proverResult).toBe("pass"); expect(compile(p)).toEqual(first); expect(first.candidatePolicyHash).not.toBe(first.boundaryPolicyHash); });
  it.each([
    ["filesystem sibling", (p: SandboxPolicy) => { p.filesystem.readPaths = ["/worker"]; }, "filesystem_read_expansion"],
    ["removed deny", (p: SandboxPolicy) => { p.filesystem.deniedPaths = []; }, "filesystem_deny_removed"],
    ["binary substitution", (p: SandboxPolicy) => { p.process.allowedBinaries = ["/usr/bin/node/evil"]; }, "process_expansion"],
    ["hostname", (p: SandboxPolicy) => { p.network.destinations[0]!.hostname = "evil.example.com"; }, "network_expansion"],
    ["port", (p: SandboxPolicy) => { p.network.destinations[0]!.port = 80; }, "network_expansion"],
    ["method", (p: SandboxPolicy) => { p.network.destinations[0]!.methods = ["DELETE"]; }, "network_expansion"],
    ["path sibling", (p: SandboxPolicy) => { p.network.destinations[0]!.pathPrefixes = ["/v11"]; }, "network_expansion"],
    ["budget", (p: SandboxPolicy) => { p.resources.pidsLimit = 65; }, "resource_pidsLimit_expansion"],
    ["autonomy", (p: SandboxPolicy) => { p.broadAutonomy = true; }, "autonomy_expansion"],
    ["C4", (p: SandboxPolicy) => { p.riskClass = "C4"; }, "domain_overlay_not_qualified"],
  ] as const)("rejects %s expansion", (_name, mutate, reason) => { const p = policyFixture(); mutate(p); expect(compile(p).failedBoundaries).toContain(reason); });
  it.each(["/work/../secret", "/work//secret", "/work/", "/work/*"])("rejects noncanonical filesystem path %s", path => { const p = policyFixture(); p.filesystem.readPaths = [path]; expect(sandboxPolicySchema.safeParse(p).success).toBe(false); });
  it.each(["/v1/%2e%2e", "/v1?override=true", "/v1#fragment", "/v1/[a-z]", "/v1/[!a]", "/v1/[[]", "/v1/unclosed["])("rejects ambiguous destination path %s", path => { const p = policyFixture(); p.network.destinations[0]!.pathPrefixes = [path]; expect(sandboxPolicySchema.safeParse(p).success).toBe(false); });
  it.each(["/v1/[a-z]", "/v1/[!a]", "/v1/[[]"])("rejects OpenShell glob syntax in a credential destination %s", path => {
    const p = policyFixture();
    p.credentials = { mode: "brokered", bindings: [{ connectionId: "11111111-1111-4111-8111-111111111111", grantVersionHash: "b".repeat(64),
      hostname: "api.example.com", port: 443, methods: ["GET"], pathPrefixes: [path], binary: "/usr/bin/node", ttlSeconds: 30 }] };
    expect(sandboxPolicySchema.safeParse(p).success).toBe(false);
  });
  it("preserves literal filesystem bracket names and segment-boundary REST prefixes", () => {
    const p = policyFixture(); p.filesystem.readPaths = ["/work/data[1]"];
    expect(sandboxPolicySchema.safeParse(p).success).toBe(true);
    p.network.destinations[0]!.pathPrefixes = ["/v1/items"];
    expect(compile(p).proverResult).toBe("pass");
  });
  it("requires actual fresh capability evidence and hard filesystem enforcement", () => { expect(compile(undefined, null).proverResult).toBe("unsupported"); const c = caps(); c.expiresAt = now.toISOString(); expect(compile(undefined, c).unsupportedFeatures).toContain("capability_snapshot_stale"); c.expiresAt = "2026-10-06T12:00:00Z"; c.filesystemEnforcementMode = "best_effort"; expect(compile(undefined, c).unsupportedFeatures).toContain("filesystem_hard_enforcement_missing"); });
  it("does not promote local fixtures into managed assurance", () => { const p = policyFixture(); p.profile = "standard_managed"; expect(compile(p).unsupportedFeatures).toContain("production_boundary_evidence_missing"); });
  it("requires L7 enforcement even for DELETE-only destinations", () => { const p = policyFixture(); p.network.destinations[0]!.methods = ["DELETE"]; const c = caps(); c.networkLayer7Policy = false; expect(compile(p, c, p).unsupportedFeatures).toContain("networkLayer7Policy"); });
  it("requires current grants and all credential dimensions", () => { const p = policyFixture(); p.credentials = { mode: "brokered", bindings: [{ connectionId: "11111111-1111-4111-8111-111111111111", grantVersionHash: "b".repeat(64), hostname: "api.example.com", port: 443, methods: ["GET"], pathPrefixes: ["/v1"], binary: "/usr/bin/node", ttlSeconds: 30 }] }; const c = caps(); c.credentialBindingDimensions = ["company", "presence"]; const result = compile(p, c, p); expect(result.failedBoundaries).toContain("credential_grant_not_current"); expect(result.unsupportedFeatures).toContain("credential_binary_binding_missing"); expect(result.unsupportedFeatures).toContain("credential_revocation_binding_missing"); });
  it("refuses legacy fallback while retaining native Stop", async () => { let stops = 0; const b = existingCellContainerBackend({ inspect: async () => ({ generation: "1", imageDigest: image, state: "stopped", backendVersion: "6.0.0" }), stop: async () => ({ operationId: String(++stops) }), destroy: async () => ({ operationId: "delete" }) }); const identity = { companyId: "c", bindingId: "b", cellId: "cell", cellGeneration: "1", sandboxRef: "cell:1" }; const report = await runSandboxQualification(b, identity, now); expect(report.status).toBe("inconclusive"); expect(report.capabilities).toBeNull(); await expect(b.startWorkload({ ...identity, policy: compile(), expiresAt: now.toISOString(), idempotencyKey: "start" })).rejects.toMatchObject({ status: 403 }); expect(await b.stopWorkload({ ...identity, idempotencyKey: "stop" })).toEqual({ operationId: "1" }); await expect(b.prepareSandbox({ ...identity, cellGeneration: "2" })).rejects.toMatchObject({ status: 409 }); });
  it("does not qualify claimed passing probes without observation hashes or capabilities", async () => { const b = { backend: "openshell", evidenceKind: "local_fixture", capabilities: async () => null, probeBoundary: async () => ({ verdict: "pass", observationHash: "claim" }) } as unknown as ExecutionSandboxBackend; const r = await runSandboxQualification(b, { companyId: "c", bindingId: "b", cellId: "cell", cellGeneration: "1", sandboxRef: "fixture" }, now); expect(r.status).toBe("inconclusive"); expect(r.results.every(test => test.verdict === "unsupported")).toBe(true); });
});
