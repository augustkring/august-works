import { RAILWAY_API_URL, RAILWAY_MCP_URL, RAILWAY_QUERIES, RAILWAY_TOOLS } from "../services/railway.js";
import { createRemoteRuntimeAssetLocator, remoteRuntimeAssetLocatorDigest } from "../services/native-runtime/runtime-asset-retention.js";
import { verifyRunLeaseCleanupReceipt, verifyNativeCleanupRuntimeState } from "../services/execution-sandbox/run-lease-cleanup.js";
import { appendHeartbeatRunEvent } from "../services/heartbeat-run-events.js";
import { PROCESS_START_REQUESTED } from "../services/native-local-process-stop.js";
import { remoteExecutionHasStopped, recordNativeRemoteWorkloadStopped } from "../services/remote-execution-termination.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { constants, createHash, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import request from "supertest";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentPresenceRuntimeBindings,
  agentProviderBindings,
  authSessions,
  billingAccounts,
  billingAccountCompanies,
  billingSubscriptions,
  companyMemberships,
  connectionGrants,
  createDb,
  environmentLeases,
  environments,
  runtimeCells,
  runtimeOperations,
  usageEvents,
  heartbeatRuns,
  issueRecoveryActions,
  assets,
  issues,
  runtimeCapacityProfiles,
  runtimeHostCommands,
  runtimeHosts,
  runtimePolicySnapshots,
  runtimeHostRequestNonces,
  runtimeSandboxBindings,
  runtimeVersionCatalog,
  toolApplications,
  toolCatalogEntries,
  toolConnections,
  toolProfileEntries,
  toolProfileBindings,
  toolProfiles,
} from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES, SANDBOX_CONTROLS, SANDBOX_HOST_COMMAND, runtimeRequestSigningInput, sandboxCapabilitySnapshotSchema, sandboxHostReplySchema, sandboxHostRequestSchema, type SandboxCapabilitySnapshot, type SandboxQualificationProbeFixture } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { executionSandboxService, sandboxCapabilityFacts } from "../services/execution-sandbox/sandbox-service.js";
import { executionSandboxRoutes } from "../routes/execution-sandbox.js";
import { heartbeatService } from "../services/heartbeat.js";
import { nativeSandboxHostTransport } from "../services/execution-sandbox/native-host-bridge.js";
import { open as unseal } from "../services/saas/crypto.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import { sandboxProbeCases, type SandboxIdentity } from "../services/execution-sandbox/backend.js";
import { openShellBackend } from "../services/execution-sandbox/openshell-backend.js";
import { projectOpenShellPolicy, projectOpenShellQualificationProbePolicy } from "../services/execution-sandbox/openshell-policy.js";
import { agentIdentityService } from "../services/agent-identities.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { runtimeControlService } from "../services/runtime/control.js";
import { describeWorkspaceReconstruction, deliverReconciledExecutions, markExecutionReconciliation, validateExecutionReconciliation, verifyNativeWorkspaceDestructionReceipt } from "../services/execution-recovery-resolution.js";
import { errorHandler } from "../middleware/index.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { environmentRuntimeService } from "../services/environment-runtime.js";
import { environmentService } from "../services/environments.js";
import { createSandboxBrokerJwt, createSandboxQualificationCredentialJwt, verifyLocalAgentJwt, verifySandboxBrokerJwt, verifySandboxExecJwt } from "../agent-auth-jwt.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { registerAssignedMcpGateway } from "../services/native-runtime/assigned-mcp-tools.js";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";
const qualificationPolicyGolden = JSON.parse(readFileSync(new URL("./fixtures/openshell-qualification-policy-golden.json", import.meta.url), "utf8")) as { fixture: SandboxQualificationProbeFixture; document: unknown };

describe("sandbox qualification mechanism pins", () => {
  it("accepts cleanup target attenuation only on stop and inspect and validates returned identities", () => {
    const expectedTarget = { sandboxId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", containerId: "a".repeat(64) };
    const request = {
      version: 1 as const,
      scope: { companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bindingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        cellId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", cellGeneration: "3", sandboxRef: "aw-v7-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      hostEpoch: 9, imageDigest: `fixture.invalid/sandbox@sha256:${"b".repeat(64)}`, requesterUserId: "fixture-owner",
    };
    for (const action of ["stop", "inspect"] as const)
      expect(sandboxHostRequestSchema.parse({ ...request, action, expectedTarget })).toMatchObject({ action, expectedTarget });
    expect(() => sandboxHostRequestSchema.parse({ ...request, action: "capabilities", expectedTarget })).toThrow();
    expect(() => sandboxHostRequestSchema.parse({ ...request, action: "stop", expectedTarget: { ...expectedTarget, extra: true } })).toThrow();
    expect(() => sandboxHostRequestSchema.parse({ ...request, action: "inspect", expectedTarget: { ...expectedTarget, sandboxId: "replacement" } })).toThrow();
    expect(sandboxHostReplySchema.parse({ action: "stop", stopped: true, ...expectedTarget })).toMatchObject(expectedTarget);
    expect(sandboxHostReplySchema.parse({ action: "inspect", state: "stopped", ...expectedTarget,
      policyHash: null, imageDigest: request.imageDigest, generation: "3", controlsHealthy: false })).toMatchObject(expectedTarget);
    expect(() => sandboxHostReplySchema.parse({ action: "stop", stopped: true, ...expectedTarget, unexpected: true })).toThrow();
  });
  it("accepts a typed no-recreate prepare decision only without an active container claim", () => {
    const receipt = {
      action: "prepare" as const, backendVersion: "0.1.2" as const,
      imageDigest: `fixture.invalid/sandbox@sha256:${"b".repeat(64)}`,
      hostEpoch: 9, provisioningHash: "1".repeat(64), bindingVersion: 3,
      policyHash: "2".repeat(64), probePolicyHash: "3".repeat(64),
      resourceLimits: { cpuMillis: 500, memoryBytes: 268435456, diskBytes: 33554432, pidsLimit: 128 },
      requiresRecreate: true,
    };
    expect(sandboxHostReplySchema.parse(receipt)).toEqual(receipt);
    expect(() => sandboxHostReplySchema.parse({ ...receipt, sandboxId: randomUUID() })).toThrow();
  });
  const base = (): SandboxCapabilitySnapshot => {
    const fixtureBase = {
      version: 1 as const, fixtureId: "operator-canary-v1", profileId: "paperclip-qualification",
      profileHash: "5".repeat(64), binaries: ["/usr/bin/curl"] as ["/usr/bin/curl"], wrongBinaryPath: "/usr/bin/wget" as const,
      origin: "https://paperclip.example.test", port: 443, method: "POST" as const, gatewayPublicId: "gw-fixture",
      toolName: "read_canary", wrongToolName: "write_canary", argumentTemplateHash: nativeSha256({ caseId: "<caseId>", fixtureId: "<fixtureId>", nonce: "<nonce>" }), marker: "fixture-ok",
    };
    const credentialFixture = { ...fixtureBase, fixtureHash: nativeSha256(fixtureBase) };
    const { fixtureHash: _goldenFixtureHash, ...goldenFixtureBody } = qualificationPolicyGolden.fixture;
    const probeFixtureBody = { ...goldenFixtureBody, credential: credentialFixture };
    const probeFixture = { ...probeFixtureBody, fixtureHash: nativeSha256(probeFixtureBody) };
    const target = {
      hostEpoch: 9, companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bindingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      bindingVersion: 2, cellId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", cellGeneration: "3",
      sandboxRef: "aw-v7-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sandboxId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      containerId: "a".repeat(64), imageDigest: `fixture.invalid/sandbox@sha256:${"b".repeat(64)}`,
      hostKernelVersion: "fixture-kernel", runtimeBinarySha256: "c".repeat(64), openshellCliSha256: "d".repeat(64),
      dockerEngineIdHash: "e".repeat(64), policyHash: "f".repeat(64), provisioningHash: "1".repeat(64),
      resourceLimits: { cpuMillis: 500, memoryBytes: 268435456, diskBytes: 33554432, pidsLimit: 128 },
      policyVersion: 1, configRevision: "revision-1", phase: "Stopped" as const, mechanism: "openshell_create_sandbox_v0.1.2" as const,
      probePolicyHash: "2".repeat(64), probeFixtureHash: probeFixture.fixtureHash, qualificationCredentialFixture: credentialFixture,
    };
    return sandboxCapabilitySnapshotSchema.parse({
      ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, true])), backend: "openshell", backendVersion: "0.1.2",
      hostKernelVersion: target.hostKernelVersion, sandboxImageDigest: target.imageDigest, filesystemEnforcementMode: "hard_requirement",
      staticPolicyRequiresRecreate: true, dynamicNetworkPolicy: true, policyProverBoundaryCheck: true,
      policyProverCoverage: [...SANDBOX_CONTROLS], credentialBindingDimensions: [], testedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(), qualificationHash: nativeSha256(target), evidenceKind: "protected_host_report",
      qualificationTarget: { ...target, targetHash: nativeSha256(target) }, qualificationProbeFixture: probeFixture, qualificationCredentialFixture: credentialFixture,
    }) as SandboxCapabilitySnapshot;
  };
  it.each(["runtimeBinarySha256", "openshellCliSha256", "dockerEngineIdHash", "hostEpoch", "policyVersion", "probeFixtureHash"])(
    "does not let an admission target borrow qualification after %s changes", field => {
      const qualified = base(), changed = structuredClone(qualified);
      const target = changed.qualificationTarget! as unknown as Record<string, unknown>;
      target[field] = typeof target[field] === "number" ? (target[field] as number) + 1 : "9".repeat(64);
      expect(nativeSha256(sandboxCapabilityFacts(changed))).not.toBe(nativeSha256(sandboxCapabilityFacts(qualified)));
    },
  );
  it("ignores active provisioning IDs and target policy hashes while preserving the qualification sample", () => {
    const qualified = base(), changed = structuredClone(qualified);
    Object.assign(changed.qualificationTarget!, { sandboxId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", containerId: "9".repeat(64),
      provisioningHash: "8".repeat(64), policyHash: "7".repeat(64), probePolicyHash: "6".repeat(64),
      configRevision: "revision-after-apply", phase: "Ready" });
    expect(nativeSha256(sandboxCapabilityFacts(changed))).toBe(nativeSha256(sandboxCapabilityFacts(qualified)));
  });
  it("keeps the exact operator fixture identity in the stable mechanism pin", () => {
    const qualified = base(), changed = structuredClone(qualified);
    changed.qualificationTarget!.qualificationCredentialFixture!.fixtureHash = "9".repeat(64);
    expect(nativeSha256(sandboxCapabilityFacts(changed))).not.toBe(nativeSha256(sandboxCapabilityFacts(qualified)));
  });
});
import { secretService } from "../services/secrets.js";
import { toolAccessService } from "../services/tool-access.js";
import { issueService } from "../services/issues.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";

const support = await getEmbeddedPostgresTestSupport();
const image = "fixture.invalid/openshell@sha256:" + "a".repeat(64);
function signedRuntimeRelayProof(hostId: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]) {
  const fields = { hostId, epoch: 1, timestamp: String(Date.now()), nonce: randomBytes(32).toString("base64url") };
  const raw = Buffer.from(JSON.stringify({ hostId, epoch: 1 }));
  const message = runtimeRequestSigningInput("WS", "/api/internal/runtime/relay", createHash("sha256").update(raw).digest("hex"), fields);
  const signature = sign("sha256", Buffer.from(message), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString("base64url");
  return { proof: { ...fields, signature }, nonce: fields.nonce };
}
(support.supported ? describe : describe.skip)(
  "native signed OpenShell command lane",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      f: Awaited<ReturnType<typeof seedV5Companies>>,
      host: typeof runtimeHosts.$inferSelect,
      cell: typeof runtimeCells.$inferSelect,
      scope: SandboxIdentity;
    let priorQualificationJwtSecret: string | undefined;
    let credentialFixtureForTest: SandboxCapabilitySnapshot["qualificationCredentialFixture"] = undefined;
    let qualificationProbeFixtureForTest: SandboxQualificationProbeFixture | undefined;
    let qualificationSecretValueForTest: string | null = null;
    const keys = generateKeyPairSync("rsa", { modulusLength: 3072 });
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-sandbox-host-");
      db = createDb(database.connectionString);
      const forward = readFileSync(new URL("../../../packages/db/src/migrations/0569_native_remote_workload_stop_projection.sql", import.meta.url), "utf8");
      for (const statement of forward.split("--> statement-breakpoint")) if (statement.trim()) await db.execute(sql.raw(statement));
      await instanceSettingsService(db).getExperimental();
      await db.insert(runtimeVersionCatalog).values({
        imageDigest: image,
        providerVersion: "fixture",
        stateFormat: "v1",
        hostAgentMinimumVersion: "6.0.0",
        conformance: { fixtureOnly: true },
        status: "approved",
      });
      await db.insert(runtimeCapacityProfiles).values({
        // This database fixture represents the existing V6-qualified cell
        // profile/reservation owner required before physical qualification.
        key: "sandbox-host-fixture",
        cpuMillis: 1000,
        memoryBytes: 1073741824n,
        diskBytes: 10737418240n,
        pidsLimit: 128,
        qualified: true,
      });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    it("database admission gate accepts only the exact 19 qualified probe cases", async () => {
      const ids = [
        "filesystem_allow", "filesystem_deny", "filesystem_escape",
        "process_nonprivileged", "process_privilege_denied",
        "syscall_allow", "syscall_deny",
        "network_allow", "network_host_port_deny", "network_dns_redirect_deny",
        "network_l7_allow", "network_l7_deny",
        "credential_allow", "credential_raw_read_deny", "credential_wrong_destination_deny",
        "credential_wrong_binary_deny", "credential_revoke_deny",
        "resource_exhaustion_contained", "force_stop",
      ];
      const targetHash = "a".repeat(64);
      const valid = ids.map((caseId) => ({ caseId, verdict: "pass", observationHash: "b".repeat(64), targetQualificationHash: targetHash }));
      const check = async (results: unknown) => {
        const rows = await db.execute(sql`SELECT aw_v7_sandbox_qualification_probes_valid(${JSON.stringify(results)}::jsonb, ${targetHash}) AS valid`);
        return Boolean((rows as unknown as Array<{ valid: boolean }>)[0]?.valid);
      };
      expect(await check(valid)).toBe(true);
      expect(await check(valid.slice(0, -1))).toBe(false);
      expect(await check([...valid.slice(0, -1), { ...valid[18]!, caseId: valid[0]!.caseId }])).toBe(false);
      expect(await check([...valid.slice(0, -1), { ...valid[18]!, caseId: "unknown_case" }])).toBe(false);
      expect(await check([...valid.slice(0, -1), { ...valid[18]!, targetQualificationHash: "c".repeat(64) }])).toBe(false);
      expect(await check([...valid.slice(0, -1), { ...valid[18]!, verdict: "unsupported" }])).toBe(false);
      const missingVerdict = [...valid.slice(0, -1), { ...valid[18]! }];
      delete (missingVerdict[18] as { verdict?: string }).verdict;
      expect(await check(missingVerdict)).toBe(false);
      expect(await check([...valid.slice(0, -1), { ...valid[18]!, verdict: null }])).toBe(false);
      const missingTarget = [...valid.slice(0, -1), { ...valid[18]! }];
      delete (missingTarget[18] as { targetQualificationHash?: string }).targetQualificationHash;
      expect(await check(missingTarget)).toBe(false);
      expect(await check([...valid.slice(0, -1), { ...valid[18]!, targetQualificationHash: null }])).toBe(false);
    });

    beforeEach(async () => {
      priorQualificationJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
      process.env.PAPERCLIP_AGENT_JWT_SECRET = "v7-sandbox-qualification-fixture-secret";
      credentialFixtureForTest = undefined;
      qualificationProbeFixtureForTest = undefined;
      qualificationSecretValueForTest = null;
      await instanceSettingsService(db).updateExperimental({
        sandbox_abstraction_v7: true,
        openshell_v7: true,
        hosted_openclaw_v6: true,
        runtime_host_agent_v6: true,
        saas_deployment_profile_v6: true,
        billing_v6: true,
        billing_entitlements_v6: true,
        billing_usage_v6: true,
      });
      f = await seedV5Companies(db);
      f.actor.sessionId = await seedNativePasskeySession(db, f.userId);
      [host] = (await db
        .insert(runtimeHosts)
        .values({
          environment: "staging",
          region: "dk-cph1",
          capacityClass: "standard",
          cpuTotalMillis: 4000,
          memoryTotalBytes: 8000000000n,
          diskTotalBytes: 40000000000n,
          cpuReservedMillis: 1000,
          memoryReservedBytes: 1073741824n,
          diskReservedBytes: 10737418240n,
          publicKeyPem: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
          status: "READY",
          hostAgentVersion: "6.0.2",
          lastHeartbeatAt: new Date(),
        })
        .returning()) as [typeof host];
      const [account] = await db
        .insert(billingAccounts)
        .values({ displayName: "Fixture", payerUserId: f.userId })
        .returning();
      await db
        .insert(billingAccountCompanies)
        .values({ companyId: f.home, billingAccountId: account!.id });
      await db.insert(billingSubscriptions).values({
        billingAccountId: account!.id,
        providerSubscriptionId: `sandbox-host-fixture-${randomUUID()}`,
        status: "active",
        productKeys: ["platform", "runtime_standard"],
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        providerUpdatedAt: new Date(),
        sourceHash: "local-commercial-entitlement-fixture",
      });
      await db.insert(billingSubscriptions).values({
        billingAccountId: account!.id,
        providerSubscriptionId: `sandbox-host-capacity-fixture-${randomUUID()}`,
        status: "active",
        productKeys: ["runtime_standard"],
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        providerUpdatedAt: new Date(),
        sourceHash: "local-commercial-entitlement-fixture",
      });
      [cell] = (await db
        .insert(runtimeCells)
        .values({
          companyId: f.home,
          billingAccountId: account!.id,
          capacityProfile: "sandbox-host-fixture",
          desiredImageDigest: image,
          status: "STOPPED",
          isolationMode: "company_cell",
          runtimeHostId: host.id,
        })
        .returning()) as [typeof cell];
      transportForTest = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] });
      testWorkloadStates.clear();
      testWorkloadPolicies.clear();
      qualificationToolResponses.length = 0;
      const binding = await executionSandboxService(db, { operatorUserIds: [f.userId] }).create(
        f.actor,
        f.home,
        {
          runtimeCellId: cell.id,
          expectedCellGeneration: "1",
          backend: "openshell",
          profile: "development",
          boundaryPolicy: policyFixture(),
        },
      );
      scope = {
        companyId: f.home,
        bindingId: binding.id,
        cellId: cell.id,
        cellGeneration: "1",
        sandboxRef: `aw-v7-${binding.id}`,
      };
    });
    afterEach(() => {
      if (priorQualificationJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
      else process.env.PAPERCLIP_AGENT_JWT_SECRET = priorQualificationJwtSecret;
    });
    async function pending() {
      await expect
        .poll(
          async () =>
            (
              await db
                .select()
                .from(runtimeHostCommands)
                .where(
                  and(
                    eq(runtimeHostCommands.runtimeCellId, cell.id),
                    eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
                  ),
                )
            )[0]?.id,
        )
        .toBeTruthy();
      return (
        await db
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.runtimeCellId, cell.id))
      )[0]!;
    }
    async function qualificationCredentialProbe(expiresInMs = 20_000) {
      const [binding] = await db.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, scope.bindingId)).limit(1);
      const commandId = randomUUID(), nonce = randomBytes(16).toString("hex"), fixtureId = "operator-canary-v1";
      const base = sandboxProbeCases("1".repeat(64), SANDBOX_CONTROLS).find(test => test.caseId === "credential_allow")!;
      const argumentsValue = { fixtureId, caseId: base.caseId, nonce };
      const requestBody = { jsonrpc: "2.0", id: commandId, method: "tools/call", params: { name: "read_canary", arguments: argumentsValue } };
      const claim = {
        version: 1 as const, purpose: "qualification_credential_probe" as const, aud: "paperclip-sandbox-qualification" as const,
        jti: randomUUID(), commandId, caseId: "credential_allow" as const, fixtureId, fixtureHash: "a".repeat(64),
        hostEpoch: host.credentialVersion, scope: { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
          generation: scope.cellGeneration, sandboxRef: scope.sandboxRef }, bindingVersion: binding!.version,
        sandboxId: "33333333-3333-4333-8333-333333333333", containerId: "b".repeat(64),
        provisioningHash: "c".repeat(64), targetQualificationHash: "d".repeat(64),
        connectionId: "44444444-4444-4444-8444-444444444444", grantId: "55555555-5555-4555-8555-555555555555",
        secretVersionHash: "e".repeat(64), sourceBindingHash: "f".repeat(64), operatorUserId: f.userId,
        operatorSessionId: f.actor.sessionId!, profileId: "paperclip-qualification", profileHash: "1".repeat(64),
        binaries: ["/usr/bin/curl"], gatewayPublicId: "gw-fixture", toolName: "read_canary",
        argumentTemplateHash: nativeSha256({ caseId: "<caseId>", fixtureId: "<fixtureId>", nonce: "<nonce>" }),
        argumentsHash: nativeSha256(argumentsValue), requestBodyHash: nativeSha256(requestBody), nonce,
        origin: "https://paperclip.example.test", method: "POST" as const, path: "/mcp/gateways/gw-fixture",
        expiresAt: new Date(Date.now() + expiresInMs).toISOString(), maxUses: 1 as const,
      };
      const capabilityToken = createSandboxQualificationCredentialJwt({ companyId: scope.companyId,
        bindingId: scope.bindingId, operatorUserId: f.userId, claim });
      if (!capabilityToken) throw new Error("Could not create test-only qualification capability");
      return { commandId, nonce, capabilityToken, probe: { ...base, qualificationCredentialCapability: capabilityToken,
        qualificationCredentialNonce: nonce, qualificationCommandId: commandId } };
    }
    function supportedPolicy() {
      const policy = policyFixture();
      policy.filesystem.deniedPaths = [];
      policy.process.allowedBinaries = [];
      policy.process.allowedSyscalls = [];
      policy.network.destinations = [];
      policy.requiredControls = [...SANDBOX_CONTROLS];
      return policy;
    }
    function simulatedBackend(identity: SandboxIdentity, bridge: ReturnType<ReturnType<typeof nativeSandboxHostTransport>["bridge"]>) {
      let state: "stopped" | "ready" | "running" = "stopped";
      let policyHash: string | null = null;
      return {
        backend: "openshell" as const,
        evidenceKind: "protected_host_report" as const,
        capabilities: () => bridge.capabilities(identity),
        prepareSandbox: async (_input: SandboxIdentity, intent?: import("../services/execution-sandbox/backend.js").SandboxProvisioningIntent) => {
          if (!intent) return bridge.prepare(identity);
          let document;
          let policyHash: string;
          if (intent.purpose === "qualification") {
            const preflight = await bridge.capabilities(identity);
            const probeFixture = preflight?.qualificationProbeFixture;
            if (!preflight || !probeFixture || !qualificationProbeFixtureForTest ||
              nativeSha256(probeFixture) !== nativeSha256(qualificationProbeFixtureForTest) ||
              preflight.qualificationHash !== probeFixture.fixtureHash || preflight.policyProverBoundaryCheck ||
              preflight.policyProverCoverage.length > 0 || SANDBOX_CONTROLS.some(control => preflight[control]))
              throw new Error("Qualification setup has no exact capability-free protected probe fixture preflight");
            const projected = projectOpenShellQualificationProbePolicy(probeFixture);
            if (projected.unsupportedFeatures.length || !projected.document || !projected.documentHash)
              throw new Error("Qualification probe policy projection is unsupported");
            document = projected.document;
            policyHash = projected.documentHash;
          } else {
            document = projectOpenShellPolicy(intent.policy!.compiledPolicy, intent.policy!.modelBrokerEndpoint).document;
            policyHash = nativeSha256(intent.policy!);
          }
          const resources = intent.purpose === "qualification" ? policyFixture().resources : intent.policy!.compiledPolicy.resources;
          const request = { purpose: intent.purpose, operationKey: intent.operationKey, bindingVersion: intent.bindingVersion, expiresAt: intent.expiresAt,
            policyHash, document,
            resourceLimits: { cpuMillis: resources.cpuMillis, memoryBytes: resources.memoryBytes, diskBytes: resources.diskBytes, pidsLimit: resources.pidsLimit },
            ...(intent.purpose === "qualification" && qualificationProbeFixtureForTest ? {
              probeFixtureHash: qualificationProbeFixtureForTest.fixtureHash, qualificationProbeFixture: qualificationProbeFixtureForTest,
            } : {}) };
          const prepared = await bridge.prepare(identity, request);
          return { ...prepared, bindingVersion: intent.bindingVersion, policyHash,
            probePolicyHash: nativeSha256(document), resourceLimits: request.resourceLimits };
        },
        inspectWorkload: async () => ({ ...await bridge.inspect(identity), state, policyHash, controlsHealthy: true }),
        applyPolicy: async input => {
          const hash = nativeSha256(input.policy);
          const result = await bridge.apply({ ...identity, document: projectOpenShellPolicy(input.policy.compiledPolicy).document, policyHash: hash, expiresAt: input.expiresAt, idempotencyKey: input.idempotencyKey, resourceLimits: { cpuMillis: input.policy.compiledPolicy.resources.cpuMillis, memoryBytes: input.policy.compiledPolicy.resources.memoryBytes, diskBytes: input.policy.compiledPolicy.resources.diskBytes, pidsLimit: input.policy.compiledPolicy.resources.pidsLimit } });
          if (result.applied) { state = "ready"; policyHash = hash; }
          return { applied: result.applied, requiresRecreate: result.requiresRecreate, observedPolicyHash: result.policyHash, unsupportedFeatures: [] };
        },
        startWorkload: input => bridge.start({ ...identity, expiresAt: input.expiresAt, policyHash: nativeSha256(input.policy), idempotencyKey: input.idempotencyKey }).then(result => { state = "running"; return result; }),
        stopWorkload: async input => { await bridge.revokeProviders(identity); const result = await bridge.stop({ ...identity, idempotencyKey: input.idempotencyKey }); state = "stopped"; return result; },
        destroySandbox: input => bridge.destroy({ ...identity, idempotencyKey: input.idempotencyKey }),
        probeBoundary: input => bridge.probe({ ...identity, test: input.test }),
      };
    }
    async function driveHost<T>(work: Promise<T>, targetCellId: string,
      onCommand?: (command: Record<string, any>) => Promise<void> | void): Promise<T> {
      let settled = false;
      const result = work.then(value => ({ value }), error => ({ error })).then(value => { settled = true; return value; });
      const deadline = Date.now() + 15000;
      while (!settled && Date.now() < deadline) {
        const claim = await transportForTest.claim(host.id);
        if (!claim) { await new Promise(resolve => setTimeout(resolve, 2)); continue; }
        const secret = privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256", oaepLabel: Buffer.from("aw-runtime-command-v6") }, Buffer.from(claim.envelope.encryptedKey, "base64url"));
        const command = unseal<Record<string, any>>(claim.envelope.ciphertext, secret.toString("hex"), `command:${claim.id}:${host.id}:1`);
        const action = command.action as string;
        await onCommand?.(command);
        if (typeof command.probe?.qualificationCredentialCapability === "string") {
          const persisted = await db.select({ payload: runtimeHostCommands.payload }).from(runtimeHostCommands).where(eq(runtimeHostCommands.id, claim.id)).limit(1);
          const serialized = JSON.stringify(persisted[0]?.payload ?? null);
          expect(serialized).not.toContain(command.probe.qualificationCredentialCapability);
          expect(serialized).not.toContain(command.probe.qualificationCredentialNonce);
          expect(serialized).toContain("__sealedQualificationCredential");
          const envelope = (persisted[0]?.payload as Record<string, any>).__sealedQualificationCredential;
          expect(envelope).toMatchObject({ version: 1, commandId: claim.id });
          expect(envelope.tokenSha256).toMatch(/^[0-9a-f]{64}$/);
          expect(envelope.nonceSha256).toMatch(/^[0-9a-f]{64}$/);
          expect(envelope.sealed).toEqual(expect.any(String));
        }
        const common = { generation: command.scope.cellGeneration, imageDigest: command.imageDigest };
        const reply = action === "capabilities" ? { action, capabilities: testCapabilities(command.imageDigest, command.scope) }
          : action === "prepare" ? (() => {
              const provisioning = command.provisioning;
              const target = testQualificationTarget(command, provisioning);
              testTargets.set(command.scope.bindingId, target);
              if (provisioning?.purpose === "qualification") testQualificationSamples.set(command.scope.bindingId, target);
              testWorkloadStates.set(command.scope.cellId, provisioning?.purpose === "admission" ? "stopped" : "ready");
              return { action, backendVersion: "0.1.2", imageDigest: command.imageDigest, hostEpoch: command.hostEpoch,
                sandboxId: target.sandboxId, containerId: target.containerId, provisioningHash: target.provisioningHash,
                bindingVersion: provisioning.bindingVersion, policyHash: provisioning.policyHash,
                probePolicyHash: target.probePolicyHash, resourceLimits: provisioning.resourceLimits };
            })()
          : action === "probe" ? await (async () => {
              let verdict: "pass" | "fail" | "unsupported" = "pass";
              let observation: unknown = { caseId: command.probe.caseId, simulated: true };
              if (command.probe.qualificationCredentialCapability) {
                const fixture = testTargets.get(command.scope.bindingId)?.qualificationCredentialFixture;
                if (!qualificationProtocolApp || !fixture) throw new Error("Credential probe has no pinned local protocol fixture");
                const caseId = command.probe.caseId;
                const tool = caseId === "credential_wrong_destination_deny" ? fixture.wrongToolName : fixture.toolName;
                const call = request(qualificationProtocolApp).post(`/mcp/gateways/${fixture.gatewayPublicId}`);
                if (caseId !== "credential_wrong_binary_deny") call.set("Authorization", `Bearer ${command.probe.qualificationCredentialCapability}`);
                const response = await call.send({ jsonrpc: "2.0", id: claim.id, method: "tools/call", params: { name: tool,
                  arguments: { fixtureId: fixture.fixtureId, caseId, nonce: command.probe.qualificationCredentialNonce } } });
                const reasonCode = response.body?.error?.data?.reasonCode;
                const marker = response.body?.result?.structuredContent?.marker;
                const serializedResponse = JSON.stringify(response.body);
                expect(serializedResponse).not.toContain("qualification-provider-output-sentinel");
                if (qualificationSecretValueForTest) expect(serializedResponse).not.toContain(qualificationSecretValueForTest);
                expect(serializedResponse).not.toContain(command.probe.qualificationCredentialCapability);
                if (response.status === 200) {
                  expect(response.body.result.content).toEqual([{ type: "text", text: fixture.marker }]);
                  expect(response.body.result.structuredContent).toEqual({ marker: fixture.marker });
                }
                qualificationToolResponses.push({ caseId, status: response.status, reasonCode: reasonCode ?? null, marker: marker ?? null });
                if (caseId === "credential_allow") {
                  const replay = await request(qualificationProtocolApp).post(`/mcp/gateways/${fixture.gatewayPublicId}`)
                    .set("Authorization", `Bearer ${command.probe.qualificationCredentialCapability}`)
                    .send({ jsonrpc: "2.0", id: claim.id, method: "tools/call", params: { name: tool,
                      arguments: { fixtureId: fixture.fixtureId, caseId, nonce: command.probe.qualificationCredentialNonce } } });
                  expect(replay.status).toBe(409);
                  expect(JSON.stringify(replay.body)).toContain("sandbox_qualification_capability_replayed");
                }
                const passed = caseId === "credential_allow" || caseId === "credential_raw_read_deny"
                  ? response.status === 200 && marker === fixture.marker
                  : caseId === "credential_wrong_destination_deny"
                    ? response.status === 403 && reasonCode === "sandbox_qualification_tool_mismatch"
                    : caseId === "credential_wrong_binary_deny"
                      ? response.status === 401 && reasonCode === "sandbox_qualification_credential_required"
                      : response.status === 403 && reasonCode === "sandbox_qualification_grant_revoked";
                verdict = passed ? "pass" : "fail";
                observation = { caseId, status: response.status, reasonCode: reasonCode ?? null, marker: marker ?? null };
              }
              return { action, verdict, observationHash: nativeSha256(observation), contractHash: command.probe.contractHash,
                targetQualificationHash: testTargets.get(command.scope.bindingId)?.targetHash };
            })()
          : action === "inspect" ? { action, ...common, state: testWorkloadStates.get(command.scope.cellId) ?? "stopped", ...(command.expectedTarget ? command.expectedTarget : {}), policyHash: testWorkloadPolicies.get(command.scope.cellId) ?? null, controlsHealthy: true }
          : action === "apply" ? (testWorkloadStates.set(command.scope.cellId, "ready"), testWorkloadPolicies.set(command.scope.cellId, command.admission.policyHash), { action, applied: true, requiresRecreate: false, policyHash: command.admission.policyHash, effectivePolicyHash: command.admission.policyHash })
          : action === "start" ? (testWorkloadStates.set(command.scope.cellId, "running"), testWorkloadPolicies.set(command.scope.cellId, command.start.policyHash), { action, started: true, operationId: claim.id, sandboxId: command.scope.bindingId, containerId: "b".repeat(64), imageDigest: command.imageDigest, policyHash: command.start.policyHash, effectivePolicyHash: command.start.policyHash })
          : action === "stop" ? (testWorkloadStates.set(command.scope.cellId, "stopped"), { action, stopped: true, ...(command.expectedTarget ? command.expectedTarget : {}) })
          : action === "revoke_providers" ? { action, revoked: true }
          : action === "destroy" ? { action, destroyed: true }
          : { action, document: projectOpenShellPolicy(supportedPolicy()).document };
        await transportForTest.complete(host.id, claim.id, { claimToken: command.claimToken, generation: command.scope.cellGeneration, success: true, reply, errorCode: null });
      }
      if (!settled) {
        const pendingRows = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, targetCellId));
        throw new Error(`test host did not drain commands for cell ${targetCellId}: ${JSON.stringify(pendingRows.map(row => ({ status: row.status, errorCode: row.errorCode, action: (row.payload as Record<string, unknown>).action })))}`);
      }
      const output = await result;
      if ("error" in output) throw output.error;
      return output.value;
    }
    // Historical start/launch rows represent earlier verified signed effects.
    // The new cleanup commands exercise the real durable queue/claim/complete owner.
    async function seededCleanupLease(retain = false) {
      const agentId = randomUUID(), runId = randomUUID(), leaseId = randomUUID(), issueId = randomUUID();
      const normalizedSessionId = randomUUID(), runnerInstanceId = randomUUID();
      await db.insert(agents).values({ id: agentId, companyId: f.home, name: "Cleanup owner", status: "running", adapterType: "paperclip_runner" });
      await db.insert(issues).values({ id:issueId,companyId:f.home,title:"Original cleanup task",assigneeAgentId:agentId,responsibleUserId:f.userId });
      const [environment] = await db.insert(environments).values({ name: `cleanup-${runId}`, driver: "sandbox",
        config: { provider: "fake", image: "ubuntu:24.04", reuseLease: false } }).returning();
      const locator = createRemoteRuntimeAssetLocator({ companyId: f.home, runId, environmentId: environment!.id,
        environmentLeaseId: leaseId, provider: "fake", providerLeaseId: `provider-${runId}`,
        runnerInstanceId, normalizedSessionId, remoteCwd: "/work" });
      await db.insert(heartbeatRuns).values({ id: runId, companyId: f.home, agentId, status: "running",
        runtimeMode: "native", runtimeModeResolvedAt: new Date(), driverKind: "opencode_server",
        issueId, nativeIssueId:issueId, scopeKind:"issue",
        nativeSessionId: normalizedSessionId, runnerInstanceId, responsibleUserId: f.userId,
        runnerProfileJson: { nativeRemoteRuntimeAssetLocator: locator } });
      const [lease] = await db.insert(environmentLeases).values({ id: leaseId, companyId: f.home,
        heartbeatRunId: runId, issueId, environmentId: environment!.id, provider: "fake", providerLeaseId: locator.providerLeaseId,
        status: "active", leasePolicy: retain ? "retain_on_failure" : "ephemeral", metadata: { remoteCwd: "/work" },
        expiresAt: new Date(Date.now()-1000) }).returning();
      const policyHash = "a".repeat(64), policySnapshotId = randomUUID(), manifestId = randomUUID();
      const expectedVersion = 2, claimVersion = expectedVersion + 1;
      const startKey = `v7-sandbox-start:${scope.bindingId}:1:${claimVersion}:${policySnapshotId}`;
      const claimKey = `v7-sandbox-admission:${scope.bindingId}:1:${expectedVersion}:${policySnapshotId}`;
      await db.insert(activityLog).values({ companyId: f.home, actorType: "user", actorId: f.userId,
        action: "sandbox.admission_claimed", entityType: "runtime_sandbox", entityId: scope.bindingId,
        details: { claimKey, expectedVersion, claimVersion, generation: "1", policySnapshotId,
          executionManifestId: manifestId, executionManifestHash: "c".repeat(64), policyHash } });
      await appendHeartbeatRunEvent(db, { companyId: f.home, runId, agentId, eventType: PROCESS_START_REQUESTED,
        payload: { driverKind: "opencode_server" } });
      const [clock] = await db.execute(sql`select clock_timestamp() as now`);
      const launchAt = new Date(String(clock!.now));
      const [start] = await db.insert(runtimeHostCommands).values({ companyId: f.home, runtimeHostId: host.id,
        runtimeCellId: cell.id, cellGeneration: 1n, commandType: SANDBOX_HOST_COMMAND,
        status: "SUCCEEDED", attempt: 1, idempotencyKey: `historical-${startKey}`,
        createdAt: new Date(Date.now()-60_000), completedAt: new Date(Date.now()-50_000), deadlineAt: new Date(Date.now()-40_000),
        payload: { version: 1, scope, action: "start", hostEpoch: 1, imageDigest: image, requesterUserId: f.userId,
          start: { policyHash, expiresAt: new Date(Date.now()-40_000).toISOString(), idempotencyKey: startKey } },
        safeResult: { action: "start", started: true, operationId: startKey, sandboxId: scope.bindingId,
          containerId: "b".repeat(64), imageDigest: image, policyHash, effectivePolicyHash: policyHash } }).returning();
      const binding = { schema: "paperclip.remote-native-session-start-binding.v1", locatorDigest: remoteRuntimeAssetLocatorDigest(locator),
        runnerInstanceId, environmentLeaseId: leaseId, provider: "fake", providerLeaseId: locator.providerLeaseId,
        normalizedSessionIdDigest: locator.normalizedSessionIdDigest, hostId: host.id, hostEpoch: 1,
        cellId: cell.id, cellGeneration: "1", bindingId: scope.bindingId, manifestId, manifestHash: "c".repeat(64),
        policySnapshotId, policyHash };
      const requestId = randomUUID();
      await db.insert(runtimeHostCommands).values({ companyId: f.home, runtimeHostId: host.id, runtimeCellId: cell.id,
        cellGeneration: 1n, commandType: "sandbox_exec", status: "SUCCEEDED", attempt: 1,
        idempotencyKey: requestId, createdAt: launchAt, completedAt: launchAt,
        deadlineAt: new Date(Date.now()-10_000), payload: { ...binding, requestId, runId, leaseId,
          generation: "1", nativePreparationPurpose: "native_session_start", remoteNativeSessionStartBinding: binding },
        safeResult: { exitCode: 0, timedOut: false } });
      await db.update(runtimeCells).set({ status: "HEALTHY", activeSince: new Date(Date.now() - 10000),
        meteredThrough: new Date(Date.now() - 10000) }).where(eq(runtimeCells.id, cell.id));
      testWorkloadStates.set(cell.id, "running");testWorkloadPolicies.set(cell.id, policyHash);
      return { companyId: f.home, runId, leaseId, agentId, lease: lease!, start: start!, policyHash };
    }
    it.each([false, true])("cleans the original expired signed workload with revoked Human=%s", async revoked => {
      const input = await seededCleanupLease();
      if (revoked) await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      const actions: string[] = [];
      const receipt = await driveHost(transportForTest.stopRunLeaseForCleanup(input), cell.id, command => {
        actions.push(command.action);
        expect(command.expectedTarget).toEqual({ sandboxId: scope.bindingId, containerId: "b".repeat(64) });
        expect(command.__runLeaseCleanup).toBeUndefined();expect(command.requesterUserId).toBe(f.userId);
      });
      expect(actions).toEqual(["stop", "inspect"]);
      expect(await verifyRunLeaseCleanupReceipt(db, input, receipt)).toEqual(receipt);
      const logs = await db.select().from(activityLog).where(eq(activityLog.action, "sandbox.run_cleanup_queued"));
      expect(logs.filter(log=>log.companyId===f.home)).toHaveLength(2);
      expect(logs.every(log=>log.actorType==="system")).toBe(true);
    });
    it.each(["wrong_lease", "wrong_run", "wrong_provider", "wrong_generation", "wrong_host", "wrong_container", "legacy_void", "changed_policy", "late_failed_start", "late_failed_apply", "late_expired_prepare", "late_failed_foreign_exec", "late_expired_foreign_exec", "older_claimed_foreign_exec", "older_failed_foreign_exec", "older_pending_prepare", "after_receipt_restart"])("fences an unqualified cleanup proof: %s", async kind => {
      const input = await seededCleanupLease();
      if (kind.startsWith("late_") || kind.startsWith("older_")) {
        const action=kind==="late_failed_start"?"start":kind==="late_failed_apply"?"apply":"prepare";
        const foreignExec=kind.endsWith("foreign_exec");
        await db.insert(runtimeHostCommands).values({ companyId:f.home,runtimeHostId:host.id,runtimeCellId:cell.id,
          cellGeneration:1n,commandType:foreignExec?"sandbox_exec":SANDBOX_HOST_COMMAND,
          status:kind.includes("expired")?"EXPIRED":kind.includes("claimed")?"CLAIMED":kind.includes("pending")?"PENDING":"FAILED",
          attempt:kind.includes("pending")?0:1,idempotencyKey:randomUUID(),
          ...(kind.startsWith("older_")?{createdAt:new Date(input.start.createdAt.getTime()-1000)}:{}),
          deadlineAt:new Date(Date.now()-1),payload:foreignExec?{bindingId:scope.bindingId,runId:randomUUID()}:{scope,action} });
        await expect(transportForTest.stopRunLeaseForCleanup(input)).rejects.toMatchObject({status:409});return;
      }
      if(kind==="changed_policy") {
        testWorkloadPolicies.set(cell.id,"d".repeat(64));
        await expect(driveHost(transportForTest.stopRunLeaseForCleanup(input),cell.id)).rejects.toMatchObject({status:409});return;
      }
      const receipt = await driveHost(transportForTest.stopRunLeaseForCleanup(input), cell.id);
      if(kind==="after_receipt_restart") {
        await db.insert(runtimeHostCommands).values({companyId:f.home,runtimeHostId:host.id,runtimeCellId:cell.id,
          cellGeneration:1n,commandType:SANDBOX_HOST_COMMAND,status:"SUCCEEDED",attempt:1,
          idempotencyKey:randomUUID(),deadlineAt:new Date(Date.now()+1000),completedAt:new Date(),
          payload:input.start.payload,safeResult:input.start.safeResult});
      }
      const bad = structuredClone(receipt) as any;
      if(kind==="wrong_lease")bad.leaseId=randomUUID();
      if(kind==="wrong_run")bad.runId=randomUUID();
      if(kind==="wrong_provider")bad.provider="foreign";
      if(kind==="wrong_generation")bad.sandboxStop.cellGeneration="2";
      if(kind==="wrong_host")bad.sandboxStop.hostId=randomUUID();
      if(kind==="wrong_container")bad.sandboxStop.containerId="c".repeat(64);
      await expect(verifyRunLeaseCleanupReceipt(db,input,kind==="legacy_void"?undefined:bad)).rejects.toMatchObject({status:409});
    });
    it.each([false, true])("persists canonical runtime state and signed release after revoked Human=%s",async revoked=>{
      const input=await seededCleanupLease();const errors: unknown[]=[];
      if (revoked) await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      const control=runtimeControlService(db,{runtime:{suspectSeconds:90,unreachableSeconds:600,relayPort:3102}} as SaasPlatformConfig);
      const runtime=environmentRuntimeService(db,{stopSandboxRunLease:scope=>driveHost(control.stopSandboxRunLeaseForCleanup(scope),cell.id)});
      const released=await runtime.releaseRunLeases(input.runId,"released",error=>{errors.push(error);});
      expect(errors).toEqual([]);expect(released.some(record=>record.lease.id===input.leaseId&&record.lease.status==="released")).toBe(true);
      expect(await remoteExecutionHasStopped(db,input.companyId,input.runId)).toBe(true);
      const [row]=await db.select().from(environmentLeases).where(eq(environmentLeases.id,input.leaseId));
      expect(row.metadata?.remoteExecutionTermination).toMatchObject({runId:input.runId,leaseId:input.leaseId,state:"stopped"});
      const settled = await verifyNativeCleanupRuntimeState(db, input, row.metadata?.remoteExecutionTermination);
      const repeated = await driveHost(control.stopSandboxRunLeaseForCleanup(input), cell.id);
      expect(repeated).toEqual(settled);
      const [operation] = await db.select().from(runtimeOperations).where(eq(runtimeOperations.id, settled.sandboxStop.runtimeOperationId));
      expect(operation).toMatchObject({ requestedByType: "system", requestedById: "native-run-cleanup", status: "SUCCEEDED" });
      const [stoppedCell] = await db.select().from(runtimeCells).where(eq(runtimeCells.id, cell.id));
      expect(stoppedCell).toMatchObject({ status: "STOPPED", activeSince: null });
      const meter = await db.select().from(usageEvents).where(and(eq(usageEvents.companyId, input.companyId),
        eq(usageEvents.resourceId, cell.id), eq(usageEvents.meterKey, "runtime.shared_millisecond")));
      expect(meter).toHaveLength(1); expect(BigInt(meter[0]!.quantity)).toBeGreaterThan(0n);
      await control.relay.stop();
    });
    it("converges concurrent canonical Stop completions without duplicate meter events", async () => {
      const input = await seededCleanupLease();
      const physical = await driveHost(transportForTest.stopRunLeaseForCleanup(input), cell.id);
      const control = runtimeControlService(db, { runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 } } as SaasPlatformConfig);
      try {
        const service = executionSandboxService(db, { recordRuntimeWorkloadState: control.recordSandboxWorkloadState });
        const receipts = await Promise.all([service.recordNativeCleanupStop(input, physical), service.recordNativeCleanupStop(input, physical)]);
        expect(receipts[0]).toEqual(receipts[1]);
        await verifyNativeCleanupRuntimeState(db, input, receipts[0]);
        const operations = await db.select().from(runtimeOperations).where(and(eq(runtimeOperations.companyId, input.companyId),
          eq(runtimeOperations.runtimeCellId, cell.id), eq(runtimeOperations.operationType, "stop")));
        expect(operations).toHaveLength(1);
        const meter = await db.select().from(usageEvents).where(and(eq(usageEvents.companyId, input.companyId), eq(usageEvents.resourceId, cell.id)));
        expect(meter).toHaveLength(1);
      } finally { await control.relay.stop(); }
    });
    it.each(["missing_owner", "physical_only", "foreign_operation"])("does not settle runtime billing from a false cleanup callback: %s", async kind => {
      const input = await seededCleanupLease();
      const runtime = environmentRuntimeService(db, kind === "missing_owner" ? {} : {
        stopSandboxRunLease: async scope => {
          const receipt = await driveHost(transportForTest.stopRunLeaseForCleanup(scope), cell.id);
          return kind === "physical_only" ? receipt : { ...receipt,
            sandboxStop: { ...receipt.sandboxStop, runtimeOperationId: randomUUID() } };
        },
      });
      await runtime.releaseRunLeases(input.runId, "released");
      const [lease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, input.leaseId));
      expect(lease).toMatchObject({ status: "pending_cleanup", cleanupStatus: "failed" });
      expect(await remoteExecutionHasStopped(db, input.companyId, input.runId)).toBe(false);
    });
    it("does not grant final stopped reads or resource projection from physical-only cleanup", async () => {
      const input = await seededCleanupLease();
      await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, input.runId));
      const physical = await driveHost(transportForTest.stopRunLeaseForCleanup(input), cell.id);
      await environmentService(db).releaseLease(input.leaseId, "released", { cleanupStatus: "success", remoteExecutionTermination: physical });
      expect(await remoteExecutionHasStopped(db, input.companyId, input.runId)).toBe(false);
      expect(await recordNativeRemoteWorkloadStopped(db, input)).toBe(false);
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId)))[0]?.nativeProcessCleanupPending).toBe(true);
    });
    it("projects only an explicit verified remote Stop and re-fences a later original intent", async () => {
      const input = await seededCleanupLease();
      await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date(), processPid: 123456789, processGroupId: 123456788 }).where(eq(heartbeatRuns.id, input.runId));
      const occupancy = async () => {
        const [row] = await db.execute<{ count: string }>(sql`select public.aw_v10_resource_durable_occupancy(${input.companyId}::uuid)::text as count`);
        return Number(row!.count);
      };
      expect(await occupancy()).toBe(1);
      const control = runtimeControlService(db, { runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 } } as SaasPlatformConfig);
      const receipt = await driveHost(control.stopSandboxRunLeaseForCleanup(input), cell.id);
      await control.relay.stop();
      await environmentService(db).releaseLease(input.leaseId, "released", { cleanupStatus: "success", remoteExecutionTermination: receipt });
      expect(await remoteExecutionHasStopped(db, input.companyId, input.runId)).toBe(true);
      expect(await occupancy()).toBe(1); // The read predicate has no projection side effect.
      expect(await recordNativeRemoteWorkloadStopped(db, input)).toBe(true);
      expect(await occupancy()).toBe(0);
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId)))[0]).toMatchObject({ processPid: 123456789, processGroupId: 123456788 });
      await appendHeartbeatRunEvent(db, { companyId: input.companyId, runId: input.runId, agentId: input.agentId,
        eventType: PROCESS_START_REQUESTED, payload: { driverKind: "opencode_server" } });
      expect(await occupancy()).toBe(1);
      expect(await remoteExecutionHasStopped(db, input.companyId, input.runId)).toBe(false);
      expect(await recordNativeRemoteWorkloadStopped(db, input)).toBe(false);
    });
    it("keeps unknown physical cleanup pending even for retain-on-failure", async () => {
      const input=await seededCleanupLease(true);
      const runtime=environmentRuntimeService(db,{stopSandboxRunLease:async()=>undefined});
      await runtime.releaseRunLeases(input.runId,"failed");
      const [lease]=await db.select().from(environmentLeases).where(eq(environmentLeases.id,input.leaseId));
      expect(lease).toMatchObject({status:"pending_cleanup",cleanupStatus:"failed"});
      expect(await remoteExecutionHasStopped(db,input.companyId,input.runId)).toBe(false);
    });
    let qualificationProtocolApp: any = null;
    const qualificationToolResponses: Array<{ caseId: string; status: number; reasonCode: string | null; marker: string | null }> = [];
    const testWorkloadStates = new Map<string, "stopped" | "ready" | "running">();
    const testWorkloadPolicies = new Map<string, string>();
    const testCapabilitySnapshots = new Map<string, Record<string, unknown>>();
    const testTargets = new Map<string, Record<string, any>>();
    const testQualificationSamples = new Map<string, Record<string, any>>();
    const testQualificationTarget = (command: Record<string, any>, provisioning: Record<string, any>) => {
      const sandboxId = "f3a4f0a0-cd95-4fd2-8f4c-2b5223309a17";
      const containerId = "b".repeat(64);
      const target = {
        hostEpoch: command.hostEpoch, companyId: command.scope.companyId, bindingId: command.scope.bindingId,
        bindingVersion: provisioning.bindingVersion,
        cellId: command.scope.cellId, cellGeneration: command.scope.cellGeneration, sandboxRef: command.scope.sandboxRef,
        sandboxId, containerId, imageDigest: command.imageDigest, hostKernelVersion: "fixture-kernel", runtimeBinarySha256: "a".repeat(64),
        openshellCliSha256: "b".repeat(64), dockerEngineIdHash: "d".repeat(64),
        policyHash: provisioning.policyHash, provisioningHash: provisioning.provisioningHash,
        resourceLimits: provisioning.resourceLimits, policyVersion: 1, configRevision: "fixture-config-1",
        phase: provisioning.purpose === "admission" ? "Stopped" : "Ready",
        mechanism: "openshell_create_sandbox_v0.1.2", probePolicyHash: nativeSha256(provisioning.document),
        probeFixtureHash: provisioning.probeFixtureHash ?? testQualificationSamples.get(command.scope.bindingId)?.probeFixtureHash,
        ...((provisioning.qualificationProbeFixture?.credential ?? testQualificationSamples.get(command.scope.bindingId)?.qualificationCredentialFixture)
          ? { qualificationCredentialFixture: provisioning.qualificationProbeFixture?.credential ?? testQualificationSamples.get(command.scope.bindingId)?.qualificationCredentialFixture } : {}),
      };
      return { ...target, targetHash: nativeSha256(target) };
    };
    const testCapabilities = (digest: string, scope?: SandboxIdentity) => {
      const target = scope ? testTargets.get(scope.bindingId) : undefined;
      const cacheKey = scope ? `${scope.bindingId}:${digest}` : digest;
      let snapshot = testCapabilitySnapshots.get(cacheKey);
      if (!snapshot) {
        const preflight = Boolean(scope && !target);
        const probeFixture = preflight ? qualificationProbeFixtureForTest : undefined;
        snapshot = { ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, !preflight])), backend: "openshell", backendVersion: "0.1.2", hostKernelVersion: "fixture-kernel", sandboxImageDigest: digest, filesystemEnforcementMode: "hard_requirement", staticPolicyRequiresRecreate: true, dynamicNetworkPolicy: !preflight, policyProverBoundaryCheck: !preflight, policyProverCoverage: preflight ? [] : [...SANDBOX_CONTROLS], credentialBindingDimensions: preflight ? [] : ["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"], credentialBrokerProviderProfile: { id: "paperclip-broker", hash: "d".repeat(64), origin: "https://paperclip.example.test" }, testedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), qualificationHash: probeFixture?.fixtureHash ?? "a".repeat(64), evidenceKind: "protected_host_report",
          ...(probeFixture ? { qualificationProbeFixture: probeFixture, qualificationCredentialFixture: probeFixture.credential } : {}) };
        testCapabilitySnapshots.set(cacheKey, snapshot);
      }
      if (target) {
        for (const control of SANDBOX_CONTROLS) snapshot[control] = true;
        snapshot.dynamicNetworkPolicy = true; snapshot.policyProverBoundaryCheck = true;
        snapshot.policyProverCoverage = [...SANDBOX_CONTROLS];
        snapshot.credentialBindingDimensions = ["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"];
        snapshot.qualificationTarget = target;
        snapshot.qualificationProbeFixture = qualificationProbeFixtureForTest;
        snapshot.qualificationCredentialFixture = target.qualificationCredentialFixture ?? testQualificationSamples.get(scope!.bindingId)?.qualificationCredentialFixture;
        snapshot.qualificationHash = target.targetHash;
      }
      return snapshot;
    };
    let transportForTest: ReturnType<typeof nativeSandboxHostTransport>;
    function decrypt(
      claim: NonNullable<
        Awaited<
          ReturnType<ReturnType<typeof nativeSandboxHostTransport>["claim"]>
        >
      >,
    ) {
      const key = privateDecrypt(
        {
          key: keys.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
          oaepLabel: Buffer.from("aw-runtime-command-v6"),
        },
        Buffer.from(claim.envelope.encryptedKey, "base64url"),
      );
      return unseal<{ claimToken: string }>(
        claim.envelope.ciphertext,
        key.toString("hex"),
        `command:${claim.id}:${host.id}:1`,
      );
    }
    it("fails closed before queueing unless the configured operator has a current passkey session", async () => {
      const transport = nativeSandboxHostTransport(db, {
        operatorUserIds: [f.userId],
      });
      await expect(
        nativeSandboxHostTransport(db).bridge(f.actor).capabilities(scope),
      ).rejects.toMatchObject({ status: 403 });
      const withoutSession = { ...f.actor, sessionId: undefined };
      await expect(
        transport.bridge(withoutSession).capabilities(scope),
      ).rejects.toMatchObject({ status: 403 });
      await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301000) })
        .where(eq(authSessions.id, f.actor.sessionId!));
      await expect(transport.bridge(f.actor).prepare(scope)).rejects.toMatchObject({ status: 403 });
      await db.delete(authSessions).where(eq(authSessions.id, f.actor.sessionId!));
      await expect(
        transport.bridge(f.actor).capabilities(scope),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.runtimeCellId, cell.id)),
      ).toHaveLength(0);
    });
    it("keeps qualification bearer material sealed and fails closed on ciphertext tamper, key rotation, and expiry", async () => {
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] });
      const bridge = transport.bridge(f.actor);
      const waitForCommand = async (id: string) => {
        await expect.poll(async () => (await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, id)).limit(1))[0]?.id,
          { timeout: 1000 }).toBe(id);
        return (await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, id)).limit(1))[0]!;
      };
      const first = await qualificationCredentialProbe();
      const firstCall = bridge.probe({ ...scope, test: first.probe }).then(() => null, error => error);
      const firstCommand = await waitForCommand(first.commandId);
      const firstPayload = firstCommand.payload as Record<string, any>;
      const firstSerialized = JSON.stringify(firstPayload);
      expect(firstSerialized).not.toContain(first.capabilityToken);
      expect(firstSerialized).not.toContain(first.nonce);
      expect(firstPayload.__sealedQualificationCredential).toMatchObject({ version: 1, commandId: first.commandId });
      expect(firstPayload.__sealedQualificationCredential.tokenSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(firstPayload.__sealedQualificationCredential.nonceSha256).toMatch(/^[a-f0-9]{64}$/);
      const tamperedPayload = structuredClone(firstPayload);
      tamperedPayload.__sealedQualificationCredential.sealed = `${tamperedPayload.__sealedQualificationCredential.sealed}tampered`;
      await db.update(runtimeHostCommands).set({ payload: tamperedPayload }).where(eq(runtimeHostCommands.id, firstCommand.id));
      await expect(transport.claim(host.id)).rejects.toMatchObject({ status: 409 });
      await db.update(runtimeHostCommands).set({ status: "CANCELED", errorCode: "sandbox_qualification_test_tamper", completedAt: new Date() })
        .where(eq(runtimeHostCommands.id, firstCommand.id));
      await expect(firstCall).resolves.toMatchObject({ status: 409 });

      const second = await qualificationCredentialProbe();
      const secondCall = bridge.probe({ ...scope, test: second.probe }).then(() => null, error => error);
      const secondCommand = await waitForCommand(second.commandId);
      const originalSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
      process.env.PAPERCLIP_AGENT_JWT_SECRET = "rotated-qualification-test-key";
      try {
        await expect(transport.claim(host.id)).rejects.toMatchObject({ status: 409 });
      } finally {
        if (originalSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
        else process.env.PAPERCLIP_AGENT_JWT_SECRET = originalSecret;
      }
      await db.update(runtimeHostCommands).set({ status: "CANCELED", errorCode: "sandbox_qualification_test_key_rotation", completedAt: new Date() })
        .where(eq(runtimeHostCommands.id, secondCommand.id));
      await expect(secondCall).resolves.toMatchObject({ status: 409 });

      const expiring = await qualificationCredentialProbe(3500);
      const expiringCall = bridge.probe({ ...scope, test: expiring.probe }).then(() => null, error => error);
      const expiringCommand = await waitForCommand(expiring.commandId);
      await new Promise(resolve => setTimeout(resolve, 3600));
      await expect(transport.claim(host.id)).rejects.toMatchObject({ status: 409 });
      await db.update(runtimeHostCommands).set({ status: "CANCELED", errorCode: "sandbox_qualification_test_expired", completedAt: new Date() })
        .where(eq(runtimeHostCommands.id, expiringCommand.id));
      await expect(expiringCall).resolves.toMatchObject({ status: 409 });
    }, 10000);
    it("caps the durable apply command at the original policy expiry and rejects an already expired request before queueing", async () => {
      // A test-only reservation row is used to exercise the native command
      // lane independently from qualification; this is not qualification proof.
      await db.update(runtimeSandboxBindings)
        .set({ status: "admitting", version: 2 })
        .where(eq(runtimeSandboxBindings.id, scope.bindingId));
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] });
      const bridge = transport.bridge(f.actor);
      const expired = bridge.apply({
        ...scope,
        document: projectOpenShellPolicy(policyFixture()).document,
        policyHash: "f".repeat(64),
        expiresAt: new Date(0).toISOString(),
        idempotencyKey: "expired-source-policy",
        resourceLimits: { cpuMillis: 1000, memoryBytes: 536870912, diskBytes: policyFixture().resources.diskBytes, pidsLimit: 256 },
      });
      await expect(expired).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, cell.id))).toHaveLength(0);
      await expect(bridge.apply({
        ...scope, document: projectOpenShellPolicy(policyFixture()).document,
        policyHash: "f".repeat(64), expiresAt: new Date(Date.now() + 8000).toISOString(),
        idempotencyKey: "invalid-resource-envelope", resourceLimits: { cpuMillis: 0, memoryBytes: 536870912, diskBytes: policyFixture().resources.diskBytes, pidsLimit: 256 },
      })).rejects.toThrow();
      expect(await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, cell.id))).toHaveLength(0);

      const expiresAt = new Date(Date.now() + 8000);
      const pendingApply = bridge.apply({
        ...scope,
        document: projectOpenShellPolicy(policyFixture()).document,
        policyHash: "e".repeat(64),
        expiresAt: expiresAt.toISOString(),
        idempotencyKey: "bounded-source-policy",
        resourceLimits: { cpuMillis: 1000, memoryBytes: 536870912, diskBytes: policyFixture().resources.diskBytes, pidsLimit: 256 },
      }).catch((error) => error);
      const command = await pending();
      expect(command.deadlineAt.getTime()).toBeLessThanOrEqual(expiresAt.getTime());
      expect(command.deadlineAt.getTime()).toBeGreaterThan(Date.now());
      const claim = await transport.claim(host.id);
      expect(claim).toBeTruthy();
      const payload = decrypt(claim!);
      await transport.complete(host.id, claim!.id, {
        claimToken: payload.claimToken,
        generation: "1",
        success: false,
        reply: null,
        errorCode: "sandbox_host_unavailable",
      });
      await expect(pendingApply).resolves.toMatchObject({ status: 409 });
    });
    it("does not accept a successful provisioning receipt after its original expiry", async () => {
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] });
      const bridge = transport.bridge(f.actor);
      const expiresAt = new Date(Date.now() + 8000);
      const qualificationFixture = qualificationPolicyGolden.fixture;
      const projectedFixture = projectOpenShellQualificationProbePolicy(qualificationFixture);
      expect(projectedFixture.document).toBeTruthy();
      const document = projectedFixture.document!;
      const pendingReceipt = bridge.prepare(scope, {
        purpose: "qualification", operationKey: `late-provisioning-receipt:${randomUUID()}`,
        bindingVersion: 1, expiresAt: expiresAt.toISOString(), policyHash: projectedFixture.documentHash!, document,
        resourceLimits: { cpuMillis: policyFixture().resources.cpuMillis, memoryBytes: policyFixture().resources.memoryBytes,
          diskBytes: policyFixture().resources.diskBytes, pidsLimit: policyFixture().resources.pidsLimit },
        probeFixtureHash: qualificationFixture.fixtureHash, qualificationProbeFixture: qualificationFixture,
      }).then(() => null, error => error);
      let claim: Awaited<ReturnType<typeof transport.claim>> = null;
      await expect.poll(async () => {
        claim = await transport.claim(host.id);
        return Boolean(claim);
      }, { timeout: 3000 }).toBe(true);
      const claimed = claim!;
      const command = decrypt(claimed);
      const stored = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, claimed.id));
      const provisioningHash = (stored[0]!.payload as Record<string, any>).provisioning.provisioningHash;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 25)));
      await expect(transport.complete(host.id, claimed.id, {
        claimToken: command.claimToken, generation: scope.cellGeneration, success: true,
        reply: { action: "prepare", backendVersion: "0.1.2", imageDigest: image, hostEpoch: 1,
          sandboxId: "f3a4f0a0-cd95-4fd2-8f4c-2b5223309a17", containerId: "b".repeat(64),
          provisioningHash }, errorCode: null,
      })).rejects.toMatchObject({ status: 409, details: { code: "sandbox_scope_changed" } });
      expect((await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, claimed.id)))[0]?.status).toBe("CLAIMED");
      await expect(pendingReceipt).resolves.toMatchObject({ status: 409 });
    }, 15000);
    it("persists an encrypted current native scope and rejects mismatched receipts without earning capability", async () => {
      // Private host metadata reads require current proof, not a new recent event.
      await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301000) })
        .where(eq(authSessions.id, f.actor.sessionId!));
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] }),
        result = transport.bridge(f.actor).capabilities(scope);
      await pending();
      const claim = await transport.claim(host.id);
      expect(claim).toBeTruthy();
      expect(JSON.stringify(claim)).not.toContain(f.userId);
      const payload = decrypt(claim!);
      expect(payload).toMatchObject({
        scope,
        hostEpoch: 1,
        imageDigest: image,
      });
      const receipt = {
        claimToken: payload.claimToken,
        generation: "1",
        success: true,
        reply: { action: "capabilities", capabilities: null },
        errorCode: null,
      };
      await expect(
        transport.complete(host.id, claim!.id, { ...receipt, generation: "2" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        transport.complete(host.id, claim!.id, {
          ...receipt,
          reply: { action: "stop", stopped: true },
        }),
      ).rejects.toMatchObject({ status: 403 });
      await transport.complete(host.id, claim!.id, receipt);
      expect(await result).toBeNull();
      await transport.complete(host.id, claim!.id, receipt);
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, scope.bindingId),
              eq(activityLog.action, "sandbox.host_command_recorded"),
            ),
          ),
      ).toHaveLength(1);
    });
    it.each([
      "generation",
      "host epoch",
      "owner revocation",
      "rollout rollback",
    ])("cancels queued scope after %s changes", async (reason) => {
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] }),
        result = transport
          .bridge(f.actor)
          .capabilities(scope)
          .catch((error) => error);
      const command = await pending();
      if (reason === "generation")
        await db
          .update(runtimeCells)
          .set({ generation: 2n })
          .where(eq(runtimeCells.id, cell.id));
      if (reason === "host epoch")
        await db
          .update(runtimeHosts)
          .set({ credentialVersion: 2 })
          .where(eq(runtimeHosts.id, host.id));
      if (reason === "owner revocation")
        await db
          .delete(companyMemberships)
          .where(eq(companyMemberships.companyId, f.home));
      if (reason === "rollout rollback")
        await instanceSettingsService(db).updateExperimental({
          openshell_v7: false,
        });
      expect(await transport.claim(host.id)).toBeNull();
      expect(await result).toMatchObject({ status: 409 });
      expect(
        (
          await db
            .select()
            .from(runtimeHostCommands)
            .where(eq(runtimeHostCommands.id, command.id))
        )[0],
      ).toMatchObject({
        status: "CANCELED",
        errorCode: "sandbox_scope_changed",
      });
    });
    it("keeps the legacy engine out of the sandbox lane and permits scoped Stop after rollout rollback", async () => {
      await instanceSettingsService(db).updateExperimental({
        openshell_v7: false,
        sandbox_abstraction_v7: false,
      });
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] }),
        result = transport
          .bridge(f.actor)
          .stop({ ...scope, idempotencyKey: "fixture-safe-stop" });
      await pending();
      const runtime = runtimeControlService(db, {
        runtime: { suspectSeconds: 90, relayPort: 3102 },
      } as SaasPlatformConfig);
      try {
        expect(await runtime.claim(host.id)).toBeNull();
      } finally {
        await runtime.relay.stop();
      }
      const concurrent = transport
        .bridge(f.actor)
        .stop({ ...scope, idempotencyKey: "fixture-safe-stop" });
      const claim = await transport.claim(host.id);
      const payload = decrypt(claim!);
      await transport.complete(host.id, claim!.id, {
        claimToken: payload.claimToken,
        generation: "1",
        success: true,
        reply: { action: "stop", stopped: true },
        errorCode: null,
      });
      expect(await result).toEqual({ operationId: claim!.id });
      expect(await concurrent).toEqual({ operationId: claim!.id });
      expect(
        await transport
          .bridge(f.actor)
          .stop({ ...scope, idempotencyKey: "fixture-safe-stop" }),
      ).toEqual({ operationId: claim!.id });
    });
    it.each(["6.0.0", "6.0.1"])("rejects host %s without immutable instance pinning", async (version) => {
      await db
        .update(runtimeHosts)
        .set({ hostAgentVersion: version })
        .where(eq(runtimeHosts.id, host.id));
      await expect(
        nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] }).bridge(f.actor).capabilities(scope),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await db
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.runtimeCellId, cell.id)),
      ).toHaveLength(0);
    });
    it("retains unsupported host qualification without treating configured image as physical preparation", async () => {
      qualificationProbeFixtureForTest = qualificationPolicyGolden.fixture;
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] });
      const service = executionSandboxService(db, {
        operatorUserIds: [f.userId],
        backendFor: (_binding, actor) => {
          const nativeBridge = transport.bridge(actor);
          const bridge = {
            ...nativeBridge,
            prepare: async (identity: SandboxIdentity, provisioning?: Parameters<typeof nativeBridge.prepare>[1]) => {
              const prepared = await nativeBridge.prepare(identity, provisioning);
              if (provisioning?.purpose !== "qualification") return prepared;
              const currentCapabilities = await nativeBridge.capabilities(identity);
              const target = currentCapabilities?.qualificationTarget;
              if (!target) throw new Error("Protected target receipt is unavailable after CreateSandbox");
              return { ...prepared, bindingVersion: target.bindingVersion, policyHash: target.policyHash,
                probePolicyHash: target.probePolicyHash, resourceLimits: target.resourceLimits };
            },
          };
          return openShellBackend({
            identity: scope,
            boundary: policyFixture(),
            bridge,
            evidenceKind: "protected_host_report",
            prover: {
              executable: "/unused-unqualified-fixture",
              executableSha256: "a".repeat(64),
            },
          });
        },
      });
      let finished = false;
      const qualification = service
        .qualify(f.actor, f.home, scope.bindingId, 1)
        .finally(() => {
          finished = true;
        });
      const limit = Date.now() + 15000;
      while (!finished && Date.now() < limit) {
        const claim = await transport.claim(host.id);
        if (claim) {
          const payload = decrypt(claim) as {
            claimToken: string;
            action: string;
            probe?: { contractHash: string };
            hostEpoch: number;
            imageDigest: string;
            provisioning?: { provisioningHash: string };
          };
          await transport.complete(host.id, claim.id, {
            claimToken: payload.claimToken,
            generation: "1",
            success: true,
            reply:
              payload.action === "capabilities"
                ? (() => {
                    const capabilities = testCapabilities(payload.imageDigest, scope);
                    if (testTargets.has(scope.bindingId)) {
                      for (const control of SANDBOX_CONTROLS) capabilities[control] = false;
                      capabilities.dynamicNetworkPolicy = false;
                      capabilities.policyProverBoundaryCheck = false;
                      capabilities.policyProverCoverage = [];
                      capabilities.credentialBindingDimensions = [];
                    }
                    return { action: "capabilities", capabilities };
                  })()
                : payload.action === "prepare"
                  ? (() => {
                      const target = testQualificationTarget(payload, payload.provisioning);
                      testTargets.set(scope.bindingId, target);
                      return { action: "prepare", backendVersion: "0.1.2", imageDigest: payload.imageDigest,
                        hostEpoch: payload.hostEpoch, sandboxId: target.sandboxId, containerId: target.containerId,
                        provisioningHash: target.provisioningHash, bindingVersion: payload.provisioning.bindingVersion,
                        policyHash: payload.provisioning.policyHash, probePolicyHash: target.probePolicyHash,
                        resourceLimits: payload.provisioning.resourceLimits };
                    })()
                  : payload.action === "revoke_providers"
                    ? { action: "revoke_providers", revoked: true }
                    : payload.action === "stop"
                      ? { action: "stop", stopped: true }
                      : payload.action === "inspect"
                        ? { action: "inspect", state: "stopped", policyHash: null, imageDigest: payload.imageDigest,
                            generation: "1", controlsHealthy: false }
                        : {
                    action: "probe",
                    verdict: "unsupported",
                    observationHash: null,
                    contractHash: payload.probe!.contractHash,
                  },
            errorCode: null,
          });
        } else await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(await qualification).toMatchObject({
        status: "requested",
        capabilitySnapshot: expect.objectContaining({
          evidenceKind: "protected_host_report", qualificationProbeFixture: qualificationPolicyGolden.fixture,
          policyProverBoundaryCheck: false,
        }),
        version: 2,
      });
      const qualificationCommands = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, cell.id));
      const setup = qualificationCommands.find(command => (command.payload as Record<string, any>).action === "prepare");
      expect(setup?.payload).toMatchObject({
        action: "prepare",
        provisioning: { purpose: "qualification", operationKey: expect.stringContaining(`:${scope.bindingId}:1:`),
          probeFixtureHash: qualificationPolicyGolden.fixture.fixtureHash,
          qualificationProbeFixture: qualificationPolicyGolden.fixture,
          resourceLimits: { cpuMillis: policyFixture().resources.cpuMillis, memoryBytes: policyFixture().resources.memoryBytes,
            diskBytes: policyFixture().resources.diskBytes, pidsLimit: policyFixture().resources.pidsLimit },
          document: qualificationPolicyGolden.document },
      });
      const setupPayload = setup!.payload as Record<string, any>;
      const provisioning = setupPayload.provisioning;
      expect(provisioning.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(provisioning.idleUntilUnixSeconds).toBe(Math.floor(Date.parse(provisioning.expiresAt) / 1000));
      expect(provisioning.provisioningHash).toBe(nativeSha256({
        scope: setupPayload.scope,
        hostEpoch: setupPayload.hostEpoch,
        imageDigest: setupPayload.imageDigest,
        purpose: provisioning.purpose,
        operationKey: provisioning.operationKey,
        bindingVersion: provisioning.bindingVersion,
        expiresAt: provisioning.expiresAt,
        idleUntilUnixSeconds: provisioning.idleUntilUnixSeconds,
        policyHash: provisioning.policyHash,
        document: provisioning.document,
        resourceLimits: provisioning.resourceLimits,
        qualificationProbeFixture: provisioning.qualificationProbeFixture,
        probeFixtureHash: provisioning.probeFixtureHash,
      }));
      await expect(transport.bridge(f.actor).prepare(scope, {
        purpose: provisioning.purpose,
        operationKey: provisioning.operationKey,
        bindingVersion: provisioning.bindingVersion,
        expiresAt: provisioning.expiresAt,
        policyHash: provisioning.policyHash,
        document: provisioning.document,
        resourceLimits: provisioning.resourceLimits,
        probeFixtureHash: provisioning.probeFixtureHash,
        qualificationProbeFixture: provisioning.qualificationProbeFixture,
      })).rejects.toMatchObject({ status: 409, details: { code: "sandbox_scope_changed" } });
      const retained = await service.get(f.actor, f.home, scope.bindingId);
      expect(retained.qualifications[0]).toMatchObject({
        status: "inconclusive",
        backendVersion: "0.1.2",
        hostOrImageRef: image,
      });
      expect(retained.qualifications[0]?.results).toHaveLength(19);
    }, 20000);
    it("admits a signed Sandbox Task with fixed non-model connector and all qualification fault checks (CI transport simulation)", async () => {
      await instanceSettingsService(db).updateExperimental({
        agent_identities_v5: true,
        agent_provider_bindings_v5: true,
        agent_runtime_fabric_v5: true,
        enableFoundationV1: true,
        enableContextEngineV1: true,
      });
      const created = await agentIdentityService(db).create(f.actor, { name: "Sandbox admission Task fixture", homeCompanyId: f.home });
      const presence = created.presence;
      const [runtimePresence] = await db.select({ id: agentPresenceRuntimeBindings.id }).from(agentPresenceRuntimeBindings).where(and(
        eq(agentPresenceRuntimeBindings.companyId, f.home), eq(agentPresenceRuntimeBindings.agentId, presence.id), eq(agentPresenceRuntimeBindings.status, "active"),
      )).limit(1);
      expect(runtimePresence).toBeTruthy();
      const providerService = agentProviderBindingService(db);
      const provider = await providerService.create(f.actor, f.home, presence.id, { providerType: "paperclip_native", providerAgentRef: presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
      const newCellId = randomUUID();
      const [admissionCell] = await db.insert(runtimeCells).values({
        id: newCellId, companyId: f.home, billingAccountId: cell.billingAccountId,
        runtimeHostId: host.id, providerBindingId: provider.id,
        capacityProfile: "sandbox-host-fixture", desiredImageDigest: image,
        status: "STOPPED", isolationMode: "company_cell",
      }).returning();
      await providerService.attach(f.actor, f.home, presence.id, { providerBindingId: provider.id, providerProfileRef: `aw:cell:${admissionCell!.id}:generation:${admissionCell!.generation}` });
      const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
      await providerService.recordDiscovery(f.home, presence.id, { provider: "paperclip_native", version: "ci-software-fixture", features, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
      const [task] = await db.insert(issues).values({ companyId: f.home, title: "Run through the qualified sandbox", status: "in_progress", assigneeAgentId: presence.id, responsibleUserId: f.userId }).returning();
      // Saved comment-bound uploads predate the execution. A new comment after
      // the failed run would correctly supersede conversation continuation.
      const savedBytes = Buffer.from("saved reconstruction source\n");
      const savedHash = createHash("sha256").update(savedBytes).digest("hex");
      const savedComment = await issueService(db).addComment(task!.id,
        "Saved source context for recovery.", { userId: f.userId }, { manualInputActor: { ...f.actor } });
      const savedAttachment = await issueService(db).createAttachment({
        issueId: task!.id, issueCommentId: savedComment.id, provider: "local_fixture", objectKey: `recovery/${randomUUID()}`,
        contentType: "text/plain", byteSize: savedBytes.byteLength, sha256: savedHash,
        originalFilename: "saved-source.txt", createdByUserId: f.userId,
      }, { actor: { ...f.actor }, bytes: savedBytes });
      const withdrawnAttachment = await issueService(db).createAttachment({
        issueId: task!.id, issueCommentId: savedComment.id, provider: "local_fixture", objectKey: `recovery/${randomUUID()}`,
        contentType: "text/plain", byteSize: savedBytes.byteLength, sha256: savedHash,
        originalFilename: "withdrawn-source.txt", createdByUserId: f.userId,
      }, { actor: { ...f.actor }, bytes: savedBytes });
      const verifyFixtureSavedBytes = async (source: { objectKey: string; sha256: string; byteSize: number }) => {
        if (source.objectKey === savedAttachment!.objectKey) expect(source).toMatchObject({ sha256: savedHash, byteSize: savedBytes.byteLength });
      };
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: presence.id, status: "running", startedAt: new Date(), runtimeMode: "native", runtimeModeResolvedAt: new Date(), nativeIssueId: task!.id, responsibleUserId: f.userId, contextSnapshot: { issueId: task!.id } }).returning();
      await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, task!.id));
      const manifest = await agentRuntimeFabricService(db).prepare({ companyId: f.home, agentId: presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: task!.id, query: task!.title });
      expect(manifest).toBeTruthy();
      const providerSecretValue = `provider-secret-${randomUUID()}`;
      const providerSecret = await secretService(db).create(f.home, {
        name: `Brokered provider secret ${randomUUID()}`,
        key: `brokered_provider_secret_${randomUUID().replace(/-/g, "")}`,
        provider: "local_encrypted", value: providerSecretValue,
      });
      const applicationKey = `brokered-${randomUUID().replace(/-/g, "")}`;
      const [application] = await db.insert(toolApplications).values({ companyId: f.home, applicationKey, name: "Brokered provider fixture", type: "mcp_http", status: "active" }).returning();
      const [connection] = await db.insert(toolConnections).values({
        companyId: f.home, applicationId: application!.id, name: "Brokered provider fixture", uid: `fixture/${randomUUID()}`,
        transport: "mcp_remote", authKind:"oauth",credentialSource:"paperclip_vault",status: "active", enabled: true, healthStatus: "ok",
        config: { url: RAILWAY_MCP_URL,sourceTemplateKey:"railway",connectionMethodKey:"mcp-oauth",railwayApiStatus:"available" }, transportConfig: { url: RAILWAY_MCP_URL,sourceTemplateKey:"railway",connectionMethodKey:"mcp-oauth",railwayApiStatus:"available" },
        credentialRefs: [{ name: "credentials.authorization", secretId: providerSecret.id, version: "latest", placement: "header", key: "Authorization", prefix: "Bearer " }],
        credentialSecretRefs: [{ secretId: providerSecret.id, versionSelector: "latest", configPath: "credentials.authorization", required: true, label: "Brokered provider token" }],
      }).returning();
      await secretService(db).createBinding({ companyId: f.home, secretId: providerSecret.id, targetType: "tool_connection", targetId: connection!.id, configPath: "credentials.authorization", versionSelector: "latest", required: true, label: "Brokered provider token" });
      const [brokerGrant] = await db.insert(connectionGrants).values({ companyId: f.home, connectionId: connection!.id, kind: "organization", credentialSecretRefs: connection!.credentialSecretRefs, status: "active", isDefault: true }).returning();
      qualificationSecretValueForTest = `qualification-secret-${randomUUID()}`;
      const qualificationSecret = await secretService(db).create(f.home, {
        name: `Operator qualification canary secret ${randomUUID()}`,
        key: `qualification_canary_secret_${randomUUID().replace(/-/g, "")}`,
        provider: "local_encrypted", value: qualificationSecretValueForTest,
      });
      const qualificationApplicationKey = `qualification-canary-${randomUUID().replace(/-/g, "")}`;
      const [qualificationApplication] = await db.insert(toolApplications).values({ companyId: f.home,
        applicationKey: qualificationApplicationKey, name: "Operator qualification canary", type: "mcp_http", status: "active" }).returning();
      const qualificationCredentialRefs = [{ name: "credentials.authorization", secretId: qualificationSecret.id,
        version: "latest", placement: "header", key: "Authorization", prefix: "Bearer " }];
      const qualificationSecretRefs = [{ secretId: qualificationSecret.id, versionSelector: "latest",
        configPath: "credentials.authorization", required: true, label: "Qualification-only canary credential" }];
      // This owner seam supplies a public DNS answer without performing live
      // DNS. All provider HTTP stays on the local `remoteHttpRequest` stub.
      const qualificationToolAccess = toolAccessService(db, {
        remoteHttpEndpointLookup: async () => [{ address: "8.8.8.8", family: 4 }],
        remoteHttpRequest: async (url, init) => {
          expect(url).toBe("https://paperclip.example.test/mcp/qualification/credential-echo");
          const request = JSON.parse(String(init.body)) as { id: string; method: string };
          expect(request.method).toBe("tools/list");
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{
            name: "read_canary", description: "Fixed local qualification marker",
            inputSchema: { type: "object", properties: { fixtureId: { type: "string" }, caseId: { type: "string" }, nonce: { type: "string" } },
              required: ["fixtureId", "caseId", "nonce"], additionalProperties: false },
            annotations: { readOnlyHint: true },
          }] } }), { status: 200, headers: { "content-type": "application/json" } });
        },
      });
      const qualificationConnection = await qualificationToolAccess.createConnection(f.home, {
        applicationId: qualificationApplication!.id, name: "Operator qualification canary", transport: "mcp_remote",
        status: "active", enabled: true, config: { url: "https://paperclip.example.test/mcp/qualification/credential-echo" }, transportConfig: { url: "https://paperclip.example.test/mcp/qualification/credential-echo" },
        credentialRefs: qualificationCredentialRefs, credentialSecretRefs: qualificationSecretRefs,
      }, { actorType: "user", actorId: f.userId });
      let qualificationGrant: typeof connectionGrants.$inferSelect | undefined;
      const expectedQualificationToolName = `mcp.${qualificationApplicationKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${qualificationConnection.id.replace(/-/g, "").slice(0, 8)}:read-canary`;
      await db.insert(toolCatalogEntries).values({ companyId: f.home, applicationId: qualificationApplication!.id,
        connectionId: qualificationConnection.id, entryKind: "tool", name: `read_canary-${randomUUID()}`, toolName: "read_canary",
        title: "Read operator qualification canary", description: "Returns one fixed, non-sensitive qualification marker",
        inputSchema: { type: "object", properties: { fixtureId: { type: "string" }, caseId: { type: "string" }, nonce: { type: "string" } },
          required: ["fixtureId", "caseId", "nonce"], additionalProperties: false },
        annotations: { readOnlyHint: true }, riskLevel: "read", isReadOnly: true, isWrite: false, isDestructive: false,
        status: "active", versionHash: randomUUID(), quarantinedAt: null,
      });
      await db.insert(toolCatalogEntries).values({
        companyId: f.home, applicationId: application!.id, connectionId: connection!.id, entryKind: "tool",
        name: `read_record-${randomUUID()}`, toolName: "paperclip-railway-list-projects", title: "Read record", description: "Read a fixture record",
        inputSchema: RAILWAY_TOOLS.find(tool=>tool.name==="paperclip-railway-list-projects")!.inputSchema,
        annotations: { readOnlyHint: true }, riskLevel: "read", isReadOnly: true, isWrite: false, isDestructive: false,
        status: "active", versionHash: randomUUID(), quarantinedAt: null,
      });
      // Use the canonical health owner with a deterministic local protocol stub so
      // the active shared-grant fixture is catalog-visible without live network.
      const qualificationHealth = await qualificationToolAccess.checkHealth(qualificationConnection.id, { actorType: "user", actorId: f.userId });
      expect(qualificationHealth.connection.healthStatus).toBe("ok");
      [qualificationGrant] = await db.select().from(connectionGrants).where(and(
        eq(connectionGrants.companyId, f.home), eq(connectionGrants.connectionId, qualificationConnection.id),
        eq(connectionGrants.status, "active"), eq(connectionGrants.isDefault, true),
      )).limit(1);
      expect(qualificationGrant).toMatchObject({ kind: "organization", status: "active", isDefault: true });
      const [agentToolProfile] = await db.insert(toolProfiles).values({ companyId: f.home, profileKey: `broker-agent-${randomUUID()}`, name: "Brokered agent tool profile", defaultAction: "deny" }).returning();
      await db.insert(toolProfileBindings).values({ companyId: f.home, profileId: agentToolProfile!.id, targetType: "agent", targetId: presence.id });
      const expectedBrokerToolName = `mcp.${applicationKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${connection!.id.replace(/-/g, "").slice(0, 8)}:paperclip-railway-list-projects`;
      await db.insert(toolProfileEntries).values({ companyId: f.home, profileId: agentToolProfile!.id, selectorType: "tool_name", effect: "include", toolName: expectedBrokerToolName });
      const [gatewayProfile] = await db.insert(toolProfiles).values({ companyId: f.home, profileKey: `broker-gateway-${randomUUID()}`, name: "Brokered gateway profile", defaultAction: "deny" }).returning();
      await db.insert(toolProfileEntries).values({ companyId: f.home, profileId: gatewayProfile!.id, selectorType: "connection", effect: "include", connectionId: connection!.id });
      await db.insert(toolProfileEntries).values({ companyId: f.home, profileId: gatewayProfile!.id, selectorType: "connection", effect: "include", connectionId: qualificationConnection.id });
      const dispatchedBrokerCalls: Array<{ url: string; body: string | null; authorization: string | null }> = [];
      let qualificationProviderMarkerOverride: string | null = null;
      let qualificationProviderError = false;
      let qualificationEchoOwnerError = false;
      let nextProviderBarrier: { started: () => void; wait: Promise<void> } | null = null;
      const deferNextProviderResponse = () => {
        let markStarted!: () => void, release!: () => void;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        const wait = new Promise<void>(resolve => { release = resolve; });
        nextProviderBarrier = { started: markStarted, wait };
        return { started, release };
      };
      let concurrentEchoChecked = false;
      const gatewayOptions: Parameters<typeof createToolGatewayService>[1] = {
        operatorUserIds: [f.userId],
        qualificationBrokerOrigin: "https://paperclip.example.test",
        toolActionSigningSecret: "v7-sandbox-broker-fixture",
        remoteHttpRequest: async (url, init) => {
          const body = typeof init.body === "string" ? init.body : null;
          const authorization = new Headers(init.headers).get("authorization");
          dispatchedBrokerCalls.push({ url, body, authorization });
          const barrier = nextProviderBarrier;
          if (barrier) { nextProviderBarrier = null; barrier.started(); await barrier.wait; }
          if(qualificationProviderError) throw new Error(`private-provider-error:${qualificationSecretValueForTest}`);
          if(url===RAILWAY_API_URL) {
            expect(authorization).toBe(`Bearer ${providerSecretValue}`);
            const payload=JSON.parse(String(init.body));
            expect(payload.query).toBe(RAILWAY_QUERIES.projects);
            expect(payload.variables.workspaceId).toBe("11111111-1111-4111-8111-111111111111");
            return Response.json({data:{projects:{edges:[{node:{id:"22222222-2222-4222-8222-222222222222",name:"read ok",workspaceId:payload.variables.workspaceId}}]}}});
          }
          expect(url).toBe("https://paperclip.example.test/mcp/qualification/credential-echo");
          expect(init.method).toBe("POST"); expect(init.redirect).toBe("manual");
          expect(authorization).toBe(`Bearer ${qualificationSecretValueForTest}`);
          const send = (wrongAuthorization = false) => {
            const http = request(qualificationProtocolApp).post(new URL(url).pathname);
            new Headers(init.headers).forEach((value, key) => http.set(key, value));
            if (wrongAuthorization) http.set("authorization", "Bearer wrong-canary-value");
            return http.send(JSON.parse(String(init.body)));
          };
          if (!concurrentEchoChecked) expect((await send(true)).status).toBe(403);
          const responses = await (concurrentEchoChecked ? Promise.all([send()]) : Promise.all([send(), send()]));
          if (!concurrentEchoChecked) {
            expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
            concurrentEchoChecked = true;
          }
          const response = responses.find(response => response.status === 200) ?? responses[0]!;
          let returned = response.body;
          if (qualificationProviderMarkerOverride && response.status === 200)
            returned = { ...returned, result: { ...returned.result, structuredContent: { marker: qualificationProviderMarkerOverride } } };
          expect(JSON.stringify(returned)).not.toContain(qualificationSecretValueForTest);
          return Response.json(returned, {status:response.status});
        },
      };
      const gateway = createToolGatewayService(db, gatewayOptions);
      registerAssignedMcpGateway(db, gateway, scopedDb => createToolGatewayService(scopedDb, gatewayOptions));
      const namedGateway = await gateway.createNamedGateway({ companyId: f.home, body: { name: "Native task broker fixture", profileId: gatewayProfile!.id } });
      const argumentTemplateHash = nativeSha256({ caseId: "<caseId>", fixtureId: "<fixtureId>", nonce: "<nonce>" });
      const credentialFixtureBase = {
        version: 1 as const, fixtureId: "operator-canary-v1", profileId: "paperclip-qualification", profileHash: "5".repeat(64),
        binaries: ["/usr/bin/curl"] as ["/usr/bin/curl"], wrongBinaryPath: "/usr/bin/wget" as const,
        origin: "https://paperclip.example.test", port: 443, method: "POST" as const,
        gatewayPublicId: namedGateway.gatewayPublicId, toolName: expectedQualificationToolName, wrongToolName: "wrong_scope_canary",
        argumentTemplateHash, marker: "paperclip-qualification-credential-ok-v1",
      };
      credentialFixtureForTest = { ...credentialFixtureBase, fixtureHash: nativeSha256(credentialFixtureBase) };
      const { fixtureHash: _goldenHash, ...goldenFixtureBody } = qualificationPolicyGolden.fixture;
      const probeFixtureBody = { ...goldenFixtureBody, credential: credentialFixtureForTest };
      qualificationProbeFixtureForTest = { ...probeFixtureBody, fixtureHash: nativeSha256(probeFixtureBody) };
      const qualificationCanary = {
        argumentTemplateHash, endpointOrigin: "https://paperclip.example.test", endpointPath: "/mcp/qualification/credential-echo",
        fixtureHash: credentialFixtureForTest.fixtureHash, fixtureId: credentialFixtureForTest.fixtureId,
        gatewayPublicId: namedGateway.gatewayPublicId, grantId: qualificationGrant!.id,
        kind: "platform_owned_qualification_echo", marker: credentialFixtureForTest.marker,
        noSideEffects: true, purpose: "sandbox_qualification", readOnly: true, setupOnly: true,
        toolName: expectedQualificationToolName, version: 1, wrongToolName: "wrong_scope_canary",
      };
      await qualificationToolAccess.updateConnection(qualificationConnection.id, {
        config: { ...(qualificationConnection.config as Record<string, unknown>), sandboxQualificationCanary: qualificationCanary },
      });
      qualificationProtocolApp = express();
      qualificationProtocolApp.use(express.json());
      const actualQualificationEntry = gateway.executeSandboxQualificationCredentialTool.bind(gateway);
      gateway.executeSandboxQualificationCredentialTool = async (...args) => {
        if(qualificationEchoOwnerError && args[1] !== undefined) throw new Error(`private-owner-error:${qualificationSecretValueForTest}`);
        return actualQualificationEntry(...args);
      };
      qualificationProtocolApp.use(mcpGatewayProtocolRoutes(gateway));
      const fixedMetadata = await request(qualificationProtocolApp).post("/mcp/qualification/credential-echo")
        .send({jsonrpc:"2.0",id:"catalogue-health",method:"tools/list"});
      expect(fixedMetadata.status).toBe(200);
      expect(fixedMetadata.body.result.tools.map((tool: {name:string})=>tool.name)).toEqual(["read_canary"]);
      const noCapability = await request(qualificationProtocolApp).post("/mcp/qualification/credential-echo")
        .set("authorization",`Bearer ${qualificationSecretValueForTest}`)
        .send({jsonrpc:"2.0",id:randomUUID(),method:"tools/call",params:{name:expectedQualificationToolName,arguments:{fixtureId:"unknown",caseId:"credential_allow",nonce:"unknown"}}});
      expect(noCapability.status).toBe(401);
      expect(noCapability.body.reasonCode).toBe("sandbox_qualification_credential_required");
      const initialBrokerBinding = {
        connectionId: connection!.id, grantVersionHash: "0".repeat(64), hostname: new URL(RAILWAY_MCP_URL).hostname, port: 443,
        methods: ["POST"] as const, pathPrefixes: [new URL(RAILWAY_MCP_URL).pathname], binary: null, ttlSeconds: 120,
      };
      const initialBrokerResolution = await gateway.resolveSandboxCredentialBrokerPolicyBindings({
        companyId: f.home, agentId: presence.id, runId: run!.id, responsibleUserId: f.userId,
        presenceId: runtimePresence!.id, bindings: [initialBrokerBinding],
      });
      expect(initialBrokerResolution.bindings[0]?.allowedTools).toContain(expectedBrokerToolName);
      const boundary = supportedPolicy();
      boundary.riskClass = "C3";
      boundary.credentials = { mode: "brokered", bindings: [{ ...initialBrokerBinding, grantVersionHash: initialBrokerResolution.authorizedConnectionGrantHashes[connection!.id]! }] };
      const sandboxBinding = await executionSandboxService(db, { operatorUserIds: [f.userId] }).create(f.actor, f.home, { runtimeCellId: admissionCell!.id, expectedCellGeneration: admissionCell!.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy: boundary });
      const sandboxIdentity: SandboxIdentity = { companyId: f.home, bindingId: sandboxBinding.id, cellId: admissionCell!.id, cellGeneration: admissionCell!.generation.toString(), sandboxRef: `aw-v7-${sandboxBinding.id}` };
      expect(sandboxCapabilitySnapshotSchema.safeParse({ ...testCapabilities(image), evidenceKind: "local_fixture", qualificationTarget: undefined, qualificationProbeFixture: undefined, qualificationCredentialFixture: undefined }).success).toBe(true);
      const serviceOptions = {
        operatorUserIds: [f.userId],
        credentialBrokerOrigin: "https://paperclip.example.test/",
        backendFor: (binding: any, actor: any) => simulatedBackend(sandboxIdentity, transportForTest.bridge(actor)),
      };
      const qualification = await driveHost(executionSandboxService(db, serviceOptions).qualify(f.actor, f.home, sandboxBinding.id, 1), admissionCell!.id);
      if (qualification.status !== "ready") {
        const retained = await executionSandboxService(db, serviceOptions).get(f.actor, f.home, sandboxBinding.id);
        const probeReceipts = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id));
        throw new Error(`CI-only qualification did not pass: ${JSON.stringify({ report: retained.qualifications[0], probes: probeReceipts.filter(row => (row.payload as Record<string, any>).action === "probe").map(row => ({ test: (row.payload as any).probe, status: row.status, errorCode: row.errorCode, safeResult: row.safeResult })) })}`);
      }
      expect(qualification).toMatchObject({ status: "ready", version: 2 });
      expect(concurrentEchoChecked).toBe(true);
      const [revokedQualificationGrant] = await db.select({ status: connectionGrants.status }).from(connectionGrants)
        .where(eq(connectionGrants.id, qualificationGrant!.id)).limit(1);
      const [activeRuntimeGrant] = await db.select({ status: connectionGrants.status }).from(connectionGrants)
        .where(eq(connectionGrants.id, brokerGrant!.id)).limit(1);
      expect(revokedQualificationGrant?.status).toBe("revoked");
      expect(activeRuntimeGrant?.status).toBe("active");
      expect(qualificationToolResponses).toEqual(expect.arrayContaining([
        { caseId: "credential_allow", status: 200, reasonCode: null, marker: credentialFixtureForTest!.marker },
        { caseId: "credential_raw_read_deny", status: 200, reasonCode: null, marker: credentialFixtureForTest!.marker },
        { caseId: "credential_wrong_destination_deny", status: 403, reasonCode: "sandbox_qualification_tool_mismatch", marker: null },
        { caseId: "credential_wrong_binary_deny", status: 401, reasonCode: "sandbox_qualification_credential_required", marker: null },
        { caseId: "credential_revoke_deny", status: 403, reasonCode: "sandbox_qualification_grant_revoked", marker: null },
      ]));

      // Recreate only the setup-only canary grant, then revoke it while a
      // read-only request is in flight. The task's actual boundary grant is
      // separate and must remain active throughout this race.
      const qualificationActor = { actorType: "user" as const, actorId: f.userId };
      const reactivatedCanaryGrant = await qualificationToolAccess.addConnectionInstallation(qualificationConnection.id, {
        credentialSecretRefs: qualificationSecretRefs, isDefault: true,
      }, qualificationActor);
      const [currentCanaryConnection] = await db.select().from(toolConnections).where(eq(toolConnections.id, qualificationConnection.id)).limit(1);
      await qualificationToolAccess.updateConnection(qualificationConnection.id, {
        config: { ...(currentCanaryConnection!.config as Record<string, unknown>), sandboxQualificationCanary: {
          ...qualificationCanary, grantId: reactivatedCanaryGrant.id,
        } },
      });
      const [currentQualificationBinding] = await db.select().from(runtimeSandboxBindings)
        .where(eq(runtimeSandboxBindings.id, sandboxBinding.id)).limit(1);
      const qualifiedTarget = testTargets.get(sandboxBinding.id)!;
      const priorTarget = qualifiedTarget;
      const targetWithoutHash = { ...priorTarget, bindingVersion: currentQualificationBinding!.version };
      delete targetWithoutHash.targetHash;
      const raceTarget = { ...targetWithoutHash, targetHash: nativeSha256(targetWithoutHash) };
      testTargets.set(sandboxBinding.id, raceTarget);
      const badMarkerCommandId = randomUUID();
      const badMarkerCapability = await gateway.issueSandboxQualificationCredentialProbe({
        actor: f.actor, scope: sandboxIdentity, bindingVersion: currentQualificationBinding!.version,
        operationKey: `qualification-canary-bad-marker:${sandboxBinding.id}:${currentQualificationBinding!.version}`,
        target: raceTarget as NonNullable<SandboxCapabilitySnapshot["qualificationTarget"]>,
        caseId: "credential_allow", commandId: badMarkerCommandId,
      });
      expect(badMarkerCapability).toBeTruthy();
      const allowProbe = sandboxProbeCases(raceTarget.probePolicyHash, SANDBOX_CONTROLS).find(test => test.caseId === "credential_allow")!;
      qualificationProviderMarkerOverride = "wrong-provider-marker";
      const badMarkerProbe = { ...allowProbe, qualificationCredentialCapability: badMarkerCapability!.capabilityToken,
        qualificationCredentialNonce: badMarkerCapability!.nonce, qualificationCommandId: badMarkerCommandId };
      await driveHost(transportForTest.bridge(f.actor).probe({ ...sandboxIdentity, test: badMarkerProbe }), admissionCell!.id);
      qualificationProviderMarkerOverride = null;
      expect(qualificationToolResponses.at(-1)).toMatchObject({
        caseId: "credential_allow", status: 502, reasonCode: "sandbox_qualification_result_invalid", marker: null,
      });
      for(const direction of ["broker", "echo"] as const) {
        const failureCommandId=randomUUID();
        const failureCapability=await gateway.issueSandboxQualificationCredentialProbe({actor:f.actor,scope:sandboxIdentity,
          bindingVersion:currentQualificationBinding!.version,operationKey:`qualification-private-error:${direction}:${randomUUID()}`,
          target:raceTarget as NonNullable<SandboxCapabilitySnapshot["qualificationTarget"]>,caseId:"credential_allow",commandId:failureCommandId});
        expect(failureCapability).toBeTruthy();
        qualificationProviderError = direction === "broker";
        qualificationEchoOwnerError = direction === "echo";
        try {
          await driveHost(transportForTest.bridge(f.actor).probe({...sandboxIdentity,test:{...allowProbe,
            qualificationCredentialCapability:failureCapability!.capabilityToken,qualificationCredentialNonce:failureCapability!.nonce,
            qualificationCommandId:failureCommandId}}),admissionCell!.id);
        } finally { qualificationProviderError=false;qualificationEchoOwnerError=false; }
        expect(qualificationToolResponses.at(-1)).toMatchObject({caseId:"credential_allow",status:502,reasonCode:"sandbox_qualification_probe_failed",marker:null});
      }
      const inFlightCommandId = randomUUID();
      const inFlightCapability = await gateway.issueSandboxQualificationCredentialProbe({
        actor: f.actor, scope: sandboxIdentity, bindingVersion: currentQualificationBinding!.version,
        operationKey: `qualification-canary-race:${sandboxBinding.id}:${currentQualificationBinding!.version}`,
        target: raceTarget as NonNullable<SandboxCapabilitySnapshot["qualificationTarget"]>,
        caseId: "credential_allow", commandId: inFlightCommandId,
      });
      expect(inFlightCapability).toBeTruthy();
      const raceProbe = { ...allowProbe, qualificationCredentialCapability: inFlightCapability!.capabilityToken,
        qualificationCredentialNonce: inFlightCapability!.nonce, qualificationCommandId: inFlightCommandId };
      const raceBarrier = deferNextProviderResponse();
      const raceRequest = driveHost(transportForTest.bridge(f.actor).probe({ ...sandboxIdentity, test: raceProbe }), admissionCell!.id);
      await raceBarrier.started;
      await qualificationToolAccess.revokeConnectionGrant(qualificationConnection.id, reactivatedCanaryGrant.id, qualificationActor);
      raceBarrier.release();
      await raceRequest;
      expect(qualificationToolResponses.at(-1)).toMatchObject({
        caseId: "credential_allow", status: 403, reasonCode: "sandbox_qualification_grant_revoked", marker: null,
      });
      const [stillActiveRuntimeGrant] = await db.select({ status: connectionGrants.status }).from(connectionGrants)
        .where(eq(connectionGrants.id, brokerGrant!.id)).limit(1);
      expect(stillActiveRuntimeGrant?.status).toBe("active");
      const candidatePolicy = structuredClone(boundary);
      candidatePolicy.riskClass = "C3";
      candidatePolicy.resources.wallClockSeconds = Math.max(1, Math.floor(boundary.resources.wallClockSeconds / 2));
      const runtime = runtimeControlService(db, {
        runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 },
      } as SaasPlatformConfig, undefined, { credentialBrokerOrigin: "https://paperclip.example.test/" });
      gateway.setSandboxBrokerAuthority(runtime.authorizeSandboxBrokerCapability, "https://paperclip.example.test/");
      let compiled = await executionSandboxService(db, serviceOptions).compile(f.actor, f.home, sandboxBinding.id, { expectedVersion: 2, executionManifestId: manifest!.record.id, candidatePolicy });
      expect(compiled.status, JSON.stringify({ proverResult: compiled.compilation.proverResult, failedBoundaries: compiled.compilation.failedBoundaries, unsupportedFeatures: compiled.compilation.unsupportedFeatures })).toBe("qualified");
      const firstPolicySnapshotId = compiled.id;
      const brokerApp = express();
      brokerApp.use(express.json());
      brokerApp.use(mcpGatewayProtocolRoutes(gateway));
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { (req as any).actor = f.actor; next(); });
      app.use("/api", executionSandboxRoutes(db, {
        ...serviceOptions,
        assertRuntimeStartAdmission: (tx, input) => runtime.assertSandboxStartAdmission(tx, input),
        recordRuntimeWorkloadState: (tx, input) => runtime.recordSandboxWorkloadState(tx, input),
      }));
      app.use(errorHandler);
      const admissionPath = `/api/companies/${f.home}/runtime-sandboxes/${sandboxBinding.id}/admit`;
      const driftedTargetBase = { ...qualifiedTarget, runtimeBinarySha256: "9".repeat(64) };
      const { targetHash: _oldTargetHash, ...driftedTargetFacts } = driftedTargetBase;
      testTargets.set(sandboxBinding.id, { ...driftedTargetBase, targetHash: nativeSha256(driftedTargetFacts) });
      const commandsBeforeMechanismDrift = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id));
      const commandIdsBeforeMechanismDrift = new Set(commandsBeforeMechanismDrift.map(command => command.id));
      const changedRuntime = await driveHost(request(app).post(admissionPath).send({ expectedVersion: 3, policySnapshotId: compiled.id }), admissionCell!.id);
      expect(changedRuntime.status).toBe(409);
      expect(JSON.stringify(changedRuntime.body)).toContain("Current protected-host capability snapshot changed");
      const afterMechanismDrift = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id));
      const driftCommands = afterMechanismDrift.filter(command => !commandIdsBeforeMechanismDrift.has(command.id));
      expect(driftCommands.map(command => (command.payload as Record<string, unknown>).action)).toEqual(["capabilities"]);
      testTargets.set(sandboxBinding.id, qualifiedTarget);
      const commandCountBeforeDenials = (await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id))).length;
      await db.update(agentProviderBindings).set({ status: "revoked" }).where(eq(agentProviderBindings.id, provider.id));
      const revokedProvider = await request(app).post(admissionPath).send({ expectedVersion: 5, policySnapshotId: compiled.id });
      expect(revokedProvider.status).toBe(409);
      await db.update(agentProviderBindings).set({ status: "active" }).where(eq(agentProviderBindings.id, provider.id));
      await db.update(heartbeatRuns).set({ status: "paused" }).where(eq(heartbeatRuns.id, run!.id));
      const pausedRun = await request(app).post(admissionPath).send({ expectedVersion: 5, policySnapshotId: compiled.id });
      expect(pausedRun.status).toBe(409);
      await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, run!.id));
      expect((await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id))).length).toBe(commandCountBeforeDenials);
      const [bindingBeforeAdmission] = await db.select({ capabilitySnapshot: runtimeSandboxBindings.capabilitySnapshot,
        version: runtimeSandboxBindings.version }).from(runtimeSandboxBindings)
        .where(eq(runtimeSandboxBindings.id, sandboxBinding.id)).limit(1);
      const currentAdmissionCapabilities = await driveHost(transportForTest.bridge(f.actor).capabilities(sandboxIdentity), admissionCell!.id);
      const storedFacts = sandboxCapabilityFacts(sandboxCapabilitySnapshotSchema.parse(bindingBeforeAdmission!.capabilitySnapshot));
      const currentFacts = sandboxCapabilityFacts(sandboxCapabilitySnapshotSchema.parse(currentAdmissionCapabilities!));
      const storedFactRecord = storedFacts as unknown as Record<string, unknown>;
      const currentFactRecord = currentFacts as unknown as Record<string, unknown>;
      const factMismatches = Object.keys(storedFactRecord).filter(key => nativeSha256(storedFactRecord[key]) !== nativeSha256(currentFactRecord[key]));
      const storedMechanism = storedFactRecord.qualificationMechanism as Record<string, unknown> | null;
      const currentMechanism = currentFactRecord.qualificationMechanism as Record<string, unknown> | null;
      const mechanismMismatches = Object.keys(storedMechanism ?? {}).filter(key =>
        nativeSha256(storedMechanism?.[key]) !== nativeSha256(currentMechanism?.[key])).map(key => `qualificationMechanism.${key}`);
      expect([...factMismatches.filter(key => key !== "qualificationMechanism"), ...mechanismMismatches]).toEqual([]);
      const admissionInput = { expectedVersion: bindingBeforeAdmission!.version, policySnapshotId: compiled.id };
      const admissionPromise = request(app).post(admissionPath).send(admissionInput);
      let admissionReplay: Promise<{ status: number; body: any } | { error: unknown }> | undefined;
      let replayHostCommandCount: { before: number; after: number } | undefined;
      const admitted = await driveHost(admissionPromise.then(response => { expect(response.status, JSON.stringify(response.body)).toBe(200); return response.body; }),
        admissionCell!.id, async command => {
          if (command.action === "prepare" && !admissionReplay) {
            const before = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands)
              .where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id));
            const currentReplay = request(app).post(admissionPath).send(admissionInput)
              .then(response => ({ status: response.status, body: response.body }), error => ({ error }));
            admissionReplay = currentReplay;
            const result = await currentReplay;
            if ("error" in result) throw result.error;
            const after = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands)
              .where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id));
            replayHostCommandCount = { before: before.length, after: after.length };
          }
        });
      expect(admitted.binding).toMatchObject({ status: "running" });
      expect(admissionReplay).toBeDefined();
      const replayResult = await admissionReplay!;
      if ("error" in replayResult) throw replayResult.error;
      expect(replayResult.status, JSON.stringify(replayResult.body)).toBe(200);
      expect(replayResult.body).toMatchObject({ duplicate: true, inProgress: true, binding: { status: "admitting" } });
      expect(replayHostCommandCount?.after).toBe(replayHostCommandCount?.before,
        "an exact in-progress retry observes the claim without dispatching another host effect");
      expect(admitted.binding.version).toBe(bindingBeforeAdmission!.version + 2,
        "the durable claim and successful start each advance the binding fence");
      expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, admissionCell!.id)))[0]).toMatchObject({ status: "HEALTHY" });
      expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId, admissionCell!.id))).map(row => [row.operationType, row.status])).toEqual([["start", "SUCCEEDED"]]);
      const previousJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
      process.env.PAPERCLIP_AGENT_JWT_SECRET = "v7-sandbox-exec-software-fixture-secret";
      const relayServer = createServer();
      runtime.relay.attach(relayServer);
      relayServer.listen(0, "127.0.0.1");
      await once(relayServer, "listening");
      await runtime.relay.listen(0);
      const relayHost = new WebSocket(`ws://127.0.0.1:${(relayServer.address() as import("node:net").AddressInfo).port}/api/internal/runtime/relay`);
      let stopResult: any = null;
      const adapterExecutionDrains: Promise<void>[] = [];
      try {
        await once(relayHost, "open");
        const relayProof = signedRuntimeRelayProof(host!.id, keys.privateKey);
        relayHost.send(JSON.stringify({ type: "hello", proof: relayProof.proof }));
        let authenticated = false;
        for (let index = 0; index < 100; index++) {
          if ((await db.select({ nonce: runtimeHostRequestNonces.nonce }).from(runtimeHostRequestNonces).where(eq(runtimeHostRequestNonces.nonce, relayProof.nonce))).length) { authenticated = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(authenticated).toBe(true);
        const [lease] = await db.insert(environmentLeases).values({
          companyId: f.home, issueId: task!.id, heartbeatRunId: run!.id, status: "active",
          expiresAt: new Date(Date.now() + 60000), metadata: { driver: "sandbox" },
        }).returning();
        const runAdmissionRace = async (invalidateHost: boolean) => {
          let markHostLocked!: (pid: number) => void;
          let releaseHeartbeat!: () => void;
          let markAdmissionStarted!: (pid: number) => void;
          let markPrivacyWriterStarted!: (pid: number) => void;
          const hostLocked = new Promise<number>(resolve => { markHostLocked = resolve; });
          const heartbeatRelease = new Promise<void>(resolve => { releaseHeartbeat = resolve; });
          const admissionStarted = new Promise<number>(resolve => { markAdmissionStarted = resolve; });
          const privacyWriterStarted = new Promise<number>(resolve => { markPrivacyWriterStarted = resolve; });
          const heartbeatTx = db.transaction(async tx => {
            const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
            await tx.select({ id: runtimeHosts.id }).from(runtimeHosts).where(eq(runtimeHosts.id, host!.id)).for("update");
            await tx.update(runtimeHosts).set({ lastHeartbeatAt: new Date() }).where(eq(runtimeHosts.id, host!.id));
            markHostLocked(backend!.pid);
            await heartbeatRelease;
            await tx.execute(sql`set local lock_timeout = '2000ms'`);
            if (invalidateHost) await tx.update(runtimeHosts).set({ status: "BOOTSTRAPPING" }).where(eq(runtimeHosts.id, host!.id));
            await tx.update(runtimeCells).set({
              meteredThrough: new Date(),
            }).where(eq(runtimeCells.id, admissionCell!.id));
          });
          const heartbeatOutcome = heartbeatTx.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
          const heartbeatPid = await hostLocked;
          const admission = db.transaction(async tx => {
            const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
            markAdmissionStarted(Number(backend!.pid));
            const source = await executionSandboxService(tx as any, { runtimeSuspectSeconds: 90 }).assertTaskExecutionContext(tx as any, {
              companyId: f.home, runId: run!.id, leaseId: lease!.id,
            });
            const [privacyLocks] = await tx.execute<{ businessEvents: boolean; memory: boolean }>(sql`
              select
                exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory'
                  and mode='ShareLock' and granted and objsubid=1
                  and classid=(((hashtextextended('business-events:' || ${f.home},0) >> 32) & 4294967295)::oid)
                  and objid=((hashtextextended('business-events:' || ${f.home},0) & 4294967295)::oid)) as "businessEvents",
                exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory'
                  and mode='ShareLock' and granted and objsubid=1
                  and classid=(((hashtextextended('memory:privacy:' || ${f.home},0) >> 32) & 4294967295)::oid)
                  and objid=((hashtextextended('memory:privacy:' || ${f.home},0) & 4294967295)::oid)) as memory
            `);
            expect(privacyLocks).toMatchObject({ businessEvents: true, memory: true });
            return source;
          });
          const admissionOutcome = admission.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
          const admissionPid = await admissionStarted;
          let privacyWriterOutcome: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
          try {
            let waitingOnHost = false;
            const waitDeadline = Date.now() + 5000;
            while (Date.now() < waitDeadline) {
              const [state] = await db.execute<{ waiting: boolean }>(sql`select exists(
                select 1 from pg_stat_activity where pid=${admissionPid}
                  and ${heartbeatPid}::integer=any(pg_blocking_pids(pid)) and wait_event_type='Lock'
              ) as waiting`);
              if (state?.waiting) { waitingOnHost = true; break; }
              await new Promise(resolve => setTimeout(resolve, 20));
            }
            expect(waitingOnHost, "task admission must wait for the heartbeat's host lock").toBe(true);
            const privacyWriter = db.transaction(async tx => {
              const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
              markPrivacyWriterStarted(Number(backend!.pid));
              await lockAnalyticalCompany(tx as any, f.home);
              await lockMemoryPrivacy(tx as any, f.home);
            });
            privacyWriterOutcome = privacyWriter.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
            const privacyWriterPid = await privacyWriterStarted;
            let waitingOnAdmission = false;
            const writerDeadline = Date.now() + 5000;
            while (Date.now() < writerDeadline) {
              const [state] = await db.execute<{ waiting: boolean }>(sql`select exists(
                select 1 from pg_stat_activity where pid=${privacyWriterPid}
                  and ${admissionPid}::integer=any(pg_blocking_pids(pid)) and wait_event_type='Lock'
              ) as waiting`);
              if (state?.waiting) { waitingOnAdmission = true; break; }
              await new Promise(resolve => setTimeout(resolve, 20));
            }
            expect(waitingOnAdmission, "source writer must wait for the admitted reader's shared privacy locks").toBe(true);
          } finally {
            releaseHeartbeat();
          }
          expect(await heartbeatOutcome).toMatchObject({ ok: true });
          const admissionResult = await admissionOutcome;
          expect(await privacyWriterOutcome).toMatchObject({ ok: true });
          if (invalidateHost) {
            expect(admissionResult).toMatchObject({ ok: false, error: { status: 409 } });
            await db.update(runtimeHosts).set({ status: "READY" }).where(eq(runtimeHosts.id, host!.id));
          } else {
            expect(admissionResult).toMatchObject({ ok: true, value: { host: { id: host!.id }, cell: { runtimeHostId: host!.id } } });
          }
        };
        await runAdmissionRace(false);
        await runAdmissionRace(true);
        const environmentRuntime = environmentRuntimeService(db, { executeSandboxTask: runtime.executeSandboxTask });
        const executionEnvironment = { id: randomUUID(), driver: "sandbox", config: {}, envVars: {}, metadata: null } as any;
        const executeThroughAdapter = () => {
          const execution = environmentRuntime.execute({
          environment: executionEnvironment,
          lease: lease as any,
          command: "node", args: ["-e", "process.stdout.write('fixture')"], cwd: "/workspace", timeoutMs: 60000,
          onLog: async (stream, chunk) => { streamed.push([stream, chunk]); },
          });
          adapterExecutionDrains.push(execution.then(() => undefined, () => undefined));
          return execution;
        };
        const streamed: Array<[string, string]> = [];
        const firstFrame = new Promise<Record<string, any>>(resolve => relayHost.on("message", raw => {
          const message = JSON.parse(raw.toString());
          if (message.type === "exec_open") resolve(message);
        }));
        const firstExecution = executeThroughAdapter();
        const firstCommand = await firstFrame;
        const execClaims = verifySandboxExecJwt(firstCommand.capabilityToken);
        expect(verifyLocalAgentJwt(firstCommand.capabilityToken)).toBeNull();
        expect(execClaims?.sandbox_exec).toMatchObject({
          requestId: firstCommand.request.requestId, bindingId: sandboxBinding.id, cellId: admissionCell!.id,
          runId: run!.id, manifestId: manifest!.record.id, manifestHash: manifest!.record.hash,
          policySnapshotId: compiled.id,
        });
        const brokerToken = firstCommand.request.brokerCredential?.capabilityToken;
        const brokerClaims = brokerToken ? verifySandboxBrokerJwt(brokerToken) : null;
        expect(brokerClaims?.sandbox_broker).toMatchObject({
          parentRequestId: firstCommand.request.requestId, bindingId: sandboxBinding.id,
          cellId: admissionCell!.id, generation: admissionCell!.generation.toString(),
          runId: run!.id, manifestId: manifest!.record.id, manifestHash: manifest!.record.hash,
          policySnapshotId: compiled.id, endpointOrigin: "https://paperclip.example.test/",
        });
        expect(firstCommand.request.env.PAPERCLIP_SANDBOX_BROKER_TOKEN).toBeUndefined();
        expect(JSON.stringify(firstCommand.request.argv)).not.toContain(brokerToken);
        expect(JSON.stringify(firstCommand.request.brokerCredential)).not.toContain(providerSecretValue);
        expect(JSON.stringify(firstCommand.request.env)).not.toContain(providerSecretValue);
        expect(brokerClaims?.sandbox_broker.bindings[0]?.allowedTools).toContain(expectedBrokerToolName);
        const brokerOperation = (token: string, gatewayPublicId: string, operationId = randomUUID()) => request(brokerApp)
          .post(`/mcp/gateways/${gatewayPublicId}`)
          .set("authorization", `Bearer ${token}`)
          .send({ jsonrpc: "2.0", id: operationId, method: "tools/call", params: {
            name: expectedBrokerToolName, arguments: { workspaceId:"11111111-1111-4111-8111-111111111111" }, _meta: { "paperclip/operationId": operationId },
          } });
        const dispatchedBeforeDeniedCalls = dispatchedBrokerCalls.length;
        await brokerOperation(brokerToken!, `${namedGateway.gatewayPublicId}-wrong`).expect(403);
        const wrongGenerationToken = createSandboxBrokerJwt({
          agentId: presence.id, companyId: f.home, adapterType: execClaims!.adapter_type,
          runId: run!.id, responsibleUserId: f.userId,
          claim: { ...brokerClaims!.sandbox_broker, generation: (Number(admissionCell!.generation) + 1).toString() },
          parentExpiresAt: new Date(Date.now() + 30000), nativeLeaseExpiresAt: lease!.expiresAt,
          execDeadlineAt: new Date(Date.now() + 30000),
        });
        expect(wrongGenerationToken).toBeTruthy();
        await brokerOperation(wrongGenerationToken!, namedGateway.gatewayPublicId).expect(403);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls);
        const operationId = randomUUID();
        const dispatched = await brokerOperation(brokerToken!, namedGateway.gatewayPublicId, operationId).expect(200);
        expect(dispatched.body.result.isError).toBe(false);
        expect(dispatched.body.result.content[0].text).toContain("read ok");
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 1);
        expect(dispatchedBrokerCalls[dispatchedBeforeDeniedCalls]?.authorization).toBe(`Bearer ${providerSecretValue}`);
        await brokerOperation(brokerToken!, namedGateway.gatewayPublicId, operationId).expect(200);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 1);
        await db.update(toolConnections).set({
          config: { url: "https://other-provider.example.test/mcp" },
          transportConfig: { url: "https://other-provider.example.test/mcp" },
        }).where(eq(toolConnections.id, connection!.id));
        await brokerOperation(brokerToken!, namedGateway.gatewayPublicId).expect(409);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 1);
        await db.update(toolConnections).set({
          config: connection!.config,
          transportConfig: connection!.transportConfig,
        }).where(eq(toolConnections.id, connection!.id));
        await db.update(connectionGrants).set({ status: "revoked", revokedAt: new Date() }).where(eq(connectionGrants.connectionId, connection!.id));
        await brokerOperation(brokerToken!, namedGateway.gatewayPublicId).expect(409);
        await brokerOperation(brokerToken!, namedGateway.gatewayPublicId, operationId).expect(409);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 1);
        await db.update(connectionGrants).set({ status: "active", revokedAt: null, updatedAt: brokerGrant!.updatedAt }).where(eq(connectionGrants.connectionId, connection!.id));
        const inFlightBarrier = deferNextProviderResponse();
        const inFlightOperationId = randomUUID();
        const inFlightResponse = brokerOperation(brokerToken!, namedGateway.gatewayPublicId, inFlightOperationId).then(response => response);
        await inFlightBarrier.started;
        await db.update(connectionGrants).set({ status: "revoked", revokedAt: new Date() }).where(eq(connectionGrants.connectionId, connection!.id));
        inFlightBarrier.release();
        const fencedResponse = await inFlightResponse;
        expect(fencedResponse.status).toBe(409);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 2);
        await db.update(connectionGrants).set({ status: "active", revokedAt: null, updatedAt: brokerGrant!.updatedAt }).where(eq(connectionGrants.connectionId, connection!.id));
        await brokerOperation(brokerToken!, namedGateway.gatewayPublicId, inFlightOperationId).expect(409);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 2);
        const outputWithBrokerCapability = Buffer.from(`Task output ${brokerToken}`, "utf8");
        const capabilitySplit = Math.floor(outputWithBrokerCapability.length / 2);
        relayHost.send(JSON.stringify({ type: "exec_output", channelId: firstCommand.channelId, stream: "stdout", base64: outputWithBrokerCapability.subarray(0, capabilitySplit).toString("base64") }));
        relayHost.send(JSON.stringify({ type: "exec_output", channelId: firstCommand.channelId, stream: "stdout", base64: outputWithBrokerCapability.subarray(capabilitySplit).toString("base64") }));
        relayHost.send(JSON.stringify({ type: "exec_exit", channelId: firstCommand.channelId, exitCode: 0, timedOut: false }));
        const firstExecutionResult = await firstExecution;
        expect(firstExecutionResult).toMatchObject({ exitCode: 0, stderr: "" });
        expect(firstExecutionResult!.stdout).toContain("Task output");
        expect(firstExecutionResult!.stdout).not.toContain(brokerToken);
        expect(streamed.map(([, chunk]) => chunk).join("")).toContain("Task output");
        expect(streamed.map(([, chunk]) => chunk).join("")).not.toContain(brokerToken);
        const [successfulExecClaim] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, firstCommand.request.requestId));
        expect(successfulExecClaim).toMatchObject({ status: "SUCCEEDED", safeResult: { exitCode: 0, timedOut: false } });
        expect(JSON.stringify(successfulExecClaim?.safeResult)).not.toContain("Task output");
        await expect(runtime.relay.executeOpenShell({
          cellId: admissionCell!.id, generation: admissionCell!.generation.toString(), request: firstCommand.request,
          capabilityToken: firstCommand.capabilityToken, onOutput: () => {},
        })).rejects.toThrow();

        const service = executionSandboxService(db, {
          ...serviceOptions,
          recordRuntimeWorkloadState: (tx, input) => runtime.recordSandboxWorkloadState(tx, input),
        });
        stopResult = await driveHost(service.stop(f.actor, f.home, sandboxBinding.id, "fixture-user-stop"), admissionCell!.id);
        expect(stopResult.binding.status).toBe("stopped");
        const firstPolicyExpiry = compiled.expiresAt.getTime();
        const [policyAfterStop] = await db.select().from(runtimePolicySnapshots)
          .where(eq(runtimePolicySnapshots.id, compiled.id)).limit(1);
        expect(policyAfterStop?.status).toBe("revoked");
        expect(policyAfterStop?.expiresAt.getTime()).toBe(firstPolicyExpiry);
        const longerRecompilePolicy = structuredClone(candidatePolicy);
        longerRecompilePolicy.resources.wallClockSeconds = boundary.resources.wallClockSeconds;
        expect(longerRecompilePolicy.resources.wallClockSeconds).toBeGreaterThan(candidatePolicy.resources.wallClockSeconds);
        compiled = await executionSandboxService(db, serviceOptions).compile(f.actor, f.home, sandboxBinding.id, {
          expectedVersion: stopResult.binding.version, executionManifestId: manifest!.record.id,
          candidatePolicy: longerRecompilePolicy,
        });
        expect(compiled.status).toBe("qualified");
        expect(compiled.expiresAt.getTime()).toBeLessThanOrEqual(firstPolicyExpiry);
        expect(compiled.id).not.toBe(firstPolicySnapshotId);
        const [bindingAfterRecompile] = await db.select({ version: runtimeSandboxBindings.version })
          .from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, sandboxBinding.id)).limit(1);
        const firstAdmissionTarget = testTargets.get(sandboxBinding.id)!;
        expect(firstAdmissionTarget.bindingVersion).toBeGreaterThan(qualifiedTarget.bindingVersion);
        const commandsBeforeStaleVersion = await db.select().from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id));
        const staleAdmission = await request(app).post(admissionPath).send({
          expectedVersion: stopResult.binding.version, policySnapshotId: compiled.id,
        });
        expect(staleAdmission.status).toBe(409);
        expect(JSON.stringify(staleAdmission.body)).toContain("Sandbox changed; refresh before admission");
        expect((await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id))).length)
          .toBe(commandsBeforeStaleVersion.length);
        const secondAdmissionPromise = request(app).post(admissionPath).send({
          expectedVersion: bindingAfterRecompile!.version, policySnapshotId: compiled.id,
        });
        const secondAdmission = await driveHost(secondAdmissionPromise.then(response => {
          expect(response.status, JSON.stringify(response.body)).toBe(200); return response.body;
        }), admissionCell!.id);
        expect(secondAdmission.binding.status).toBe("running");
        const oldExecClaims = verifySandboxExecJwt(firstCommand.capabilityToken);
        expect(oldExecClaims?.sandbox_exec.policySnapshotId).toBe(firstPolicySnapshotId);
        const [revokedPriorPolicy] = await db.select({ status: runtimePolicySnapshots.status })
          .from(runtimePolicySnapshots).where(eq(runtimePolicySnapshots.id, firstPolicySnapshotId)).limit(1);
        expect(revokedPriorPolicy?.status).toBe("revoked");
        await expect(runtime.relay.executeOpenShell({
          cellId: admissionCell!.id, generation: admissionCell!.generation.toString(), request: firstCommand.request,
          capabilityToken: firstCommand.capabilityToken, onOutput: () => {},
        })).rejects.toThrow();
        const rejectedRunningPolicy = await db.insert(runtimePolicySnapshots).values({
          ...compiled, id: randomUUID(), policyVersion: compiled.policyVersion + 1, status: "qualified",
        }).then(() => null, error => error as { cause?: { code?: string; message?: string } });
        expect(rejectedRunningPolicy?.cause?.code).toBe("23514");
        expect(rejectedRunningPolicy?.cause?.message).toContain("sandbox_policy_current_execution_required");
        const secondAdmissionTarget = testTargets.get(sandboxBinding.id)!;
        expect(secondAdmissionTarget.bindingVersion).toBeGreaterThan(firstAdmissionTarget.bindingVersion);
        const admissionEffectPayloads = (await db.select({ payload: runtimeHostCommands.payload })
          .from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id)))
          .map(row => row.payload as Record<string, any>);
        const applyEpochKeys = admissionEffectPayloads.filter(payload => payload.action === "apply")
          .map(payload => payload.admission?.idempotencyKey).filter((key): key is string => typeof key === "string");
        const startEpochKeys = admissionEffectPayloads.filter(payload => payload.action === "start")
          .map(payload => payload.start?.idempotencyKey).filter((key): key is string => typeof key === "string");
        expect(applyEpochKeys).toHaveLength(2);
        expect(new Set(applyEpochKeys).size).toBe(2);
        expect(startEpochKeys).toHaveLength(2);
        expect(new Set(startEpochKeys).size).toBe(2);
        const secondFrame = new Promise<Record<string, any>>(resolve => relayHost.on("message", raw => {
          const message = JSON.parse(raw.toString());
          if (message.type === "exec_open") resolve(message);
        }));
        const uncertainExecution = executeThroughAdapter();
        const uncertainCommand = await secondFrame;
        const currentExecClaims = verifySandboxExecJwt(uncertainCommand.capabilityToken);
        expect(currentExecClaims?.sandbox_exec.policySnapshotId).toBe(compiled.id);
        await db.update(heartbeatRuns).set({ status: "paused" }).where(eq(heartbeatRuns.id, run!.id));
        relayHost.send(JSON.stringify({ type: "exec_output", channelId: uncertainCommand.channelId, stream: "stdout", base64: Buffer.from("revoked output").toString("base64") }));
        await expect(uncertainExecution).rejects.toThrow("Current active native Task run is required");
        expect(streamed.map(([, chunk]) => chunk).join("")).not.toContain("revoked output");
        await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, run!.id));
        const [uncertainClaim] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, uncertainCommand.request.requestId));
        expect(uncertainClaim?.status).toBe("CLAIMED");
        await expect(executeThroughAdapter()).rejects.toThrow("previous sandbox execution");

        stopResult = await driveHost(service.stop(f.actor, f.home, sandboxBinding.id, "fixture-user-stop-after-uncertain"), admissionCell!.id);
        expect(stopResult.binding.status).toBe("stopped");
        await environmentService(db).releaseLease(lease!.id, "released");
        await db.update(heartbeatRuns).set({ status: "failed", resultJson: { workspaceRestoreFailure: "restore_failed" } })
          .where(eq(heartbeatRuns.id, run!.id));
        const destruction = await driveHost(
          transportForTest.bridge(f.actor).destroy({ ...sandboxIdentity, idempotencyKey: "fixture-physical-workspace-destroy" }),
          admissionCell!.id,
        );
        expect(destruction.operationId).toMatch(/^[0-9a-f-]{36}$/i);
        const destructionReceipt = await verifyNativeWorkspaceDestructionReceipt({ db, companyId: f.home, runId: run!.id });
        expect(destructionReceipt).toMatchObject({ bindingId: sandboxBinding.id, cellId: admissionCell!.id, generation: admissionCell!.generation.toString() });
        expect(destructionReceipt?.receiptHash).toMatch(/^[a-f0-9]{64}$/);

        // Continue only from an exact, same-task captured attachment. This
        // drives the real failed-run recovery owner after the signed host
        // Stop+Destroy producer above; the continuation is a fresh bounded run.
        // Use the real current-human upload owner. The original issue service
        // verifies these bytes, captures the access snapshot, and records its
        // producer receipt; the test never fabricates a sealed source row.
        await db.update(heartbeatRuns).set({ status: "failed", scheduledRetryAttempt: 1,
          scheduledRetryReason: "transient_failure", resultJson: { workspaceRestoreFailure: "restore_failed" } })
          .where(eq(heartbeatRuns.id, run!.id));
        await db.update(issues).set({ status: "todo", executionRunId: null }).where(eq(issues.id, task!.id));
        await instanceSettingsService(db).updateExperimental({ enableAgentChat: true });
        await db.update(agents).set({ status: "active", runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } })
          .where(eq(agents.id, presence.id));
        const [recoveryAction] = await db.insert(issueRecoveryActions).values({
          companyId: f.home, sourceIssueId: task!.id, kind: "active_run_watchdog", status: "resolved",
          ownerType: "agent", ownerAgentId: presence.id, returnOwnerAgentId: presence.id,
          cause: "continuation_evidence_incomplete", fingerprint: randomUUID(), evidence: {},
          nextAction: "Continue from the selected saved files.", outcome: "restored",
        }).returning();
        const reconstructionDecision = {
          runId: run!.id, providerStopped: true as const, actionOutcome: "not_performed" as const,
          outcomeEvidence: "The signed native host receipt confirms Stop and physical Destroy; no external action was replayed.",
          workspaceReconstruction: { confirmed: true as const, destructionReceiptHash: destructionReceipt!.receiptHash,
            selectedSources: [{ attachmentId: savedAttachment!.id, sha256: savedHash }] },
        };
        const reconstructionDescriptor = await describeWorkspaceReconstruction({ db, companyId: f.home,
          issueId: task!.id, sourceRunId: run!.id, currentOwnerAgentId: presence.id,
          canReadCommentSource: async () => true, verifySavedSourceBytes: verifyFixtureSavedBytes });
        expect(reconstructionDescriptor.reason).toBeNull();
        expect(reconstructionDescriptor).toMatchObject({ state: "available", sourceRunId: run!.id,
          currentOwnerAgentId: presence.id, destruction: { state: "confirmed", receiptHash: destructionReceipt!.receiptHash,
            bindingId: sandboxBinding.id, cellId: admissionCell!.id, generation: admissionCell!.generation.toString() },
          continuation: { available: true, mode: "fresh_bounded" } });
        expect(reconstructionDescriptor.sources).toContainEqual({ attachmentId: savedAttachment!.id,
          filename: "saved-source.txt", contentType: "text/plain", byteSize: savedBytes.byteLength, sha256: savedHash });
        await expect(describeWorkspaceReconstruction({ db, companyId: f.home,
          issueId: task!.id, sourceRunId: run!.id, currentOwnerAgentId: presence.id,
          canReadCommentSource: async () => false,
          commentSourceUnavailableReason: "comment_source_requires_board_session",
          verifySavedSourceBytes: verifyFixtureSavedBytes })).resolves.toMatchObject({
            state: "unavailable", reason: "comment_source_requires_board_session", sources: [],
          });
        await expect(validateExecutionReconciliation({ db, companyId: f.home, issueId: task!.id,
          agentId: presence.id, sourceRunId: run!.id, decision: reconstructionDecision,
          canReadCommentSource: async () => false })).rejects.toThrow("current comment source");
        // Withdraw one genuine upload while the Task is still eligible. The
        // other captured source remains available for the positive fresh
        // continuation below.
        await db.update(assets).set({ sha256: "e".repeat(64) }).where(eq(assets.id, withdrawnAttachment!.assetId));
        const afterSourceWithdrawal = await describeWorkspaceReconstruction({ db, companyId: f.home,
          issueId: task!.id, sourceRunId: run!.id, currentOwnerAgentId: presence.id,
          canReadCommentSource: async () => true, verifySavedSourceBytes: verifyFixtureSavedBytes });
        expect(afterSourceWithdrawal).toMatchObject({ state: "available", destruction: { state: "confirmed" } });
        expect(afterSourceWithdrawal.sources.map(source => source.attachmentId)).toContain(savedAttachment!.id);
        expect(afterSourceWithdrawal.sources.map(source => source.attachmentId)).not.toContain(withdrawnAttachment!.id);
        await expect(validateExecutionReconciliation({ db, companyId: f.home, issueId: task!.id,
          agentId: presence.id, sourceRunId: run!.id, decision: { ...reconstructionDecision,
            workspaceReconstruction: { ...reconstructionDecision.workspaceReconstruction,
              selectedSources: [{ attachmentId: withdrawnAttachment!.id, sha256: savedHash }] } },
          canReadCommentSource: async () => true })).rejects.toThrow("captured source hash and access snapshot");
        await expect(describeWorkspaceReconstruction({ db, companyId: f.home, issueId: task!.id,
          sourceRunId: run!.id, currentOwnerAgentId: randomUUID(), canReadCommentSource: async () => true,
          verifySavedSourceBytes: verifyFixtureSavedBytes })).resolves.toMatchObject({
            state: "unavailable", reason: "current_task_owner_or_lost_workspace_unverified",
            destruction: { state: "confirmed", receiptHash: destructionReceipt!.receiptHash,
              bindingId: sandboxBinding.id, cellId: admissionCell!.id, generation: admissionCell!.generation.toString() },
            sources: [],
          });
        if (savedAttachment!.issueCommentId) {
          await expect(describeWorkspaceReconstruction({ db, companyId: f.home, issueId: task!.id,
            sourceRunId: run!.id, currentOwnerAgentId: presence.id, canReadCommentSource: async () => false,
            verifySavedSourceBytes: verifyFixtureSavedBytes })).resolves.toMatchObject({
              state: "unavailable", reason: "no_currently_qualified_saved_sources", sources: [],
              destruction: { state: "confirmed", receiptHash: destructionReceipt!.receiptHash },
            });
        }
        await expect(validateExecutionReconciliation({ db, companyId: f.home, issueId: task!.id,
          agentId: presence.id, sourceRunId: run!.id, decision: { ...reconstructionDecision,
            workspaceReconstruction: { ...reconstructionDecision.workspaceReconstruction,
              selectedSources: [{ attachmentId: savedAttachment!.id, sha256: "d".repeat(64) }] } },
          canReadCommentSource: async () => true }))
          .rejects.toThrow("captured source hash and access snapshot");
        await validateExecutionReconciliation({ db, companyId: f.home, issueId: task!.id,
          agentId: presence.id, sourceRunId: run!.id, decision: reconstructionDecision,
          canReadCommentSource: async () => true });
        const [sourceSession] = await db.select({ expiresAt: authSessions.expiresAt }).from(authSessions)
          .where(eq(authSessions.id, f.actor.sessionId!)).limit(1);
        await markExecutionReconciliation(db, recoveryAction!, reconstructionDecision, f.userId,
          undefined, undefined, { source: "session", userId: f.userId, sessionId: f.actor.sessionId!,
            credentialExpiresAt: sourceSession?.expiresAt.getTime() ?? null });
        const recoveryHeartbeat = heartbeatService(db);
        await deliverReconciledExecutions(db, recoveryHeartbeat.wakeup);
        const [successor] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.retryOfRunId, run!.id));
        expect(["queued", "running"]).toContain(successor?.status);
        expect(successor).toMatchObject({ scheduledRetryAttempt: 1, scheduledRetryReason: "transient_failure" });
        expect(successor?.contextSnapshot).toMatchObject({ recoveryActionId: recoveryAction!.id, previousRunId: run!.id, retryOfRunId: run!.id });
        await recoveryHeartbeat.cancelRun(successor!.id, "Fixture completed after verifying bounded reconstruction admission");
        await recoveryHeartbeat.drainActiveRunExecutions();
        const [stillFailed] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
        expect(stillFailed).toMatchObject({ status: "failed", resultJson: { workspaceRestoreFailure: "restore_failed" } });
        const [quiescedExecClaim] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, uncertainCommand.request.requestId));
        expect(quiescedExecClaim).toMatchObject({ status: "CANCELED", errorCode: "sandbox_exec_quiesced_by_stop" });
      } finally {
        relayHost.terminate();
        await runtime.relay.stop();
        // Each execution is asserted at its call site; drain handled settlements
        // here so no late relay rejection can escape teardown.
        await Promise.all(adapterExecutionDrains);
        await new Promise<void>(resolve => relayServer.close(() => resolve()));
        if (previousJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
        else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousJwtSecret;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(stopResult.binding.status).toBe("stopped");
      expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, admissionCell!.id)))[0]).toMatchObject({ status: "STOPPED", activeSince: null });
      expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId, admissionCell!.id))).map(row => [row.operationType, row.status]))
        .toEqual([["start", "SUCCEEDED"], ["stop", "SUCCEEDED"], ["start", "SUCCEEDED"], ["stop", "SUCCEEDED"]]);
      expect((await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.entityId, admissionCell!.id)))).some(event => event.action === "runtime.sandbox_workload_started")).toBe(true);
    }, 240000);
    it("rejects a late completion after host fencing and expires bounded pending work", async () => {
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] }),
        result = transport
          .bridge(f.actor)
          .capabilities(scope)
          .catch((error) => error);
      await pending();
      const claim = await transport.claim(host.id),
        payload = decrypt(claim!);
      await db
        .update(runtimeHosts)
        .set({ fencedAt: new Date() })
        .where(eq(runtimeHosts.id, host.id));
      await expect(
        transport.complete(host.id, claim!.id, {
          claimToken: payload.claimToken,
          generation: "1",
          success: true,
          reply: { action: "capabilities", capabilities: null },
          errorCode: null,
        }),
      ).rejects.toMatchObject({ status: 409 });
      await transport.reconcile(new Date(Date.now() + 30001));
      expect(await result).toMatchObject({ status: 409 });
    });
  },
);
