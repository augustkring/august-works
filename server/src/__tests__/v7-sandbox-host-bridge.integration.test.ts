import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { constants, createHash, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import request from "supertest";
import { WebSocket } from "ws";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
  runtimeCells,
  runtimeOperations,
  heartbeatRuns,
  issueRecoveryActions,
  assets,
  issues,
  runtimeCapacityProfiles,
  runtimeHostCommands,
  runtimeHosts,
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
import { PROVIDER_CAPABILITY_FEATURES, SANDBOX_CONTROLS, SANDBOX_HOST_COMMAND, runtimeRequestSigningInput, sandboxCapabilitySnapshotSchema } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { executionSandboxService } from "../services/execution-sandbox/sandbox-service.js";
import { executionSandboxRoutes } from "../routes/execution-sandbox.js";
import { heartbeatService } from "../services/heartbeat.js";
import { nativeSandboxHostTransport } from "../services/execution-sandbox/native-host-bridge.js";
import { open as unseal } from "../services/saas/crypto.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import type { SandboxIdentity } from "../services/execution-sandbox/backend.js";
import { openShellBackend } from "../services/execution-sandbox/openshell-backend.js";
import { projectOpenShellPolicy } from "../services/execution-sandbox/openshell-policy.js";
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
import { createSandboxBrokerJwt, verifyLocalAgentJwt, verifySandboxBrokerJwt, verifySandboxExecJwt } from "../agent-auth-jwt.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { registerAssignedMcpGateway } from "../services/native-runtime/assigned-mcp-tools.js";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";
import { secretService } from "../services/secrets.js";
import { issueService } from "../services/issues.js";

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
    const keys = generateKeyPairSync("rsa", { modulusLength: 3072 });
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-sandbox-host-");
      db = createDb(database.connectionString);
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
        key: "sandbox-host-fixture",
        cpuMillis: 1000,
        memoryBytes: 1073741824n,
        diskBytes: 10737418240n,
        pidsLimit: 128,
        qualified: false,
      });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    beforeEach(async () => {
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
        prepareSandbox: () => bridge.prepare(identity),
        inspectWorkload: async () => ({ ...await bridge.inspect(identity), state, policyHash, controlsHealthy: true }),
        applyPolicy: async input => {
          const hash = nativeSha256(input.policy);
          const result = await bridge.apply({ ...identity, document: projectOpenShellPolicy(input.policy.compiledPolicy).document, policyHash: hash, expiresAt: input.expiresAt, idempotencyKey: `v7-sandbox-policy:${identity.bindingId}:${identity.cellGeneration}:${hash}` });
          if (result.applied) { state = "ready"; policyHash = hash; }
          return { applied: result.applied, requiresRecreate: result.requiresRecreate, observedPolicyHash: result.policyHash, unsupportedFeatures: [] };
        },
        startWorkload: input => bridge.start({ ...identity, expiresAt: input.expiresAt, policyHash: nativeSha256(input.policy), idempotencyKey: input.idempotencyKey }).then(result => { state = "running"; return result; }),
        stopWorkload: async input => { await bridge.revokeProviders(identity); const result = await bridge.stop({ ...identity, idempotencyKey: input.idempotencyKey }); state = "stopped"; return result; },
        destroySandbox: input => bridge.destroy({ ...identity, idempotencyKey: input.idempotencyKey }),
        probeBoundary: input => bridge.probe({ ...identity, test: input.test }),
      };
    }
    async function driveHost<T>(work: Promise<T>, targetCellId: string): Promise<T> {
      let settled = false;
      const result = work.then(value => ({ value }), error => ({ error })).then(value => { settled = true; return value; });
      const deadline = Date.now() + 15000;
      while (!settled && Date.now() < deadline) {
        const claim = await transportForTest.claim(host.id);
        if (!claim) { await new Promise(resolve => setTimeout(resolve, 2)); continue; }
        const secret = privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256", oaepLabel: Buffer.from("aw-runtime-command-v6") }, Buffer.from(claim.envelope.encryptedKey, "base64url"));
        const command = unseal<Record<string, any>>(claim.envelope.ciphertext, secret.toString("hex"), `command:${claim.id}:${host.id}:1`);
        const action = command.action as string;
        const common = { generation: command.scope.cellGeneration, imageDigest: command.imageDigest };
        const reply = action === "capabilities" ? { action, capabilities: testCapabilities(command.imageDigest) }
          : action === "prepare" ? { action, backendVersion: "0.1.2", imageDigest: command.imageDigest }
          : action === "probe" ? { action, verdict: "pass", observationHash: "d".repeat(64) }
          : action === "inspect" ? { action, ...common, state: testWorkloadStates.get(command.scope.cellId) ?? "stopped", policyHash: testWorkloadPolicies.get(command.scope.cellId) ?? null, controlsHealthy: true }
          : action === "apply" ? (testWorkloadStates.set(command.scope.cellId, "ready"), testWorkloadPolicies.set(command.scope.cellId, command.admission.policyHash), { action, applied: true, requiresRecreate: false, policyHash: command.admission.policyHash, effectivePolicyHash: command.admission.policyHash })
          : action === "start" ? (testWorkloadStates.set(command.scope.cellId, "running"), testWorkloadPolicies.set(command.scope.cellId, command.start.policyHash), { action, started: true, operationId: claim.id, sandboxId: command.scope.bindingId, containerId: "b".repeat(64), imageDigest: command.imageDigest, policyHash: command.start.policyHash, effectivePolicyHash: command.start.policyHash })
          : action === "stop" ? (testWorkloadStates.set(command.scope.cellId, "stopped"), { action, stopped: true })
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
    const testWorkloadStates = new Map<string, "stopped" | "ready" | "running">();
    const testWorkloadPolicies = new Map<string, string>();
    const testCapabilitySnapshots = new Map<string, Record<string, unknown>>();
    const testCapabilities = (digest: string) => {
      let snapshot = testCapabilitySnapshots.get(digest);
      if (!snapshot) {
        snapshot = { ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, true])), backend: "openshell", backendVersion: "0.1.2", hostKernelVersion: "fixture-kernel", sandboxImageDigest: digest, filesystemEnforcementMode: "hard_requirement", staticPolicyRequiresRecreate: true, dynamicNetworkPolicy: true, policyProverBoundaryCheck: true, policyProverCoverage: [...SANDBOX_CONTROLS], credentialBindingDimensions: ["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"], credentialBrokerProviderProfile: { id: "paperclip-broker", hash: "d".repeat(64) }, testedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), qualificationHash: "a".repeat(64), evidenceKind: "protected_host_report" };
        testCapabilitySnapshots.set(digest, snapshot);
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
      });
      await expect(expired).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, cell.id))).toHaveLength(0);

      const expiresAt = new Date(Date.now() + 8000);
      const pendingApply = bridge.apply({
        ...scope,
        document: projectOpenShellPolicy(policyFixture()).document,
        policyHash: "e".repeat(64),
        expiresAt: expiresAt.toISOString(),
        idempotencyKey: "bounded-source-policy",
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
      const transport = nativeSandboxHostTransport(db, { operatorUserIds: [f.userId] });
      const service = executionSandboxService(db, {
        operatorUserIds: [f.userId],
        backendFor: (_binding, actor) =>
          openShellBackend({
            identity: scope,
            boundary: policyFixture(),
            bridge: transport.bridge(actor),
            evidenceKind: "protected_host_report",
            prover: {
              executable: "/unused-unqualified-fixture",
              executableSha256: "a".repeat(64),
            },
          }),
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
          };
          await transport.complete(host.id, claim.id, {
            claimToken: payload.claimToken,
            generation: "1",
            success: true,
            reply:
              payload.action === "capabilities"
                ? { action: "capabilities", capabilities: null }
                : {
                    action: "probe",
                    verdict: "unsupported",
                    observationHash: null,
                  },
            errorCode: null,
          });
        } else await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(await qualification).toMatchObject({
        status: "requested",
        capabilitySnapshot: null,
        version: 2,
      });
      const retained = await service.get(f.actor, f.home, scope.bindingId);
      expect(retained.qualifications[0]).toMatchObject({
        status: "inconclusive",
        backendVersion: "unqualified",
        hostOrImageRef: `cell:${cell.id}:1`,
      });
      expect(retained.qualifications[0]?.results).toHaveLength(18);
    }, 20000);
    it("admits a qualified native Task through the HTTP route and meters only the signed host start/stop receipts (CI transport simulation)", async () => {
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
        transport: "mcp_remote", status: "active", enabled: true, healthStatus: "ok",
        config: { url: "https://provider.example.test/mcp" }, transportConfig: { url: "https://provider.example.test/mcp" },
        credentialRefs: [{ name: "credentials.authorization", secretId: providerSecret.id, version: "latest", placement: "header", key: "Authorization", prefix: "Bearer " }],
        credentialSecretRefs: [{ secretId: providerSecret.id, versionSelector: "latest", configPath: "credentials.authorization", required: true, label: "Brokered provider token" }],
      }).returning();
      await secretService(db).createBinding({ companyId: f.home, secretId: providerSecret.id, targetType: "tool_connection", targetId: connection!.id, configPath: "credentials.authorization", versionSelector: "latest", required: true, label: "Brokered provider token" });
      const [brokerGrant] = await db.insert(connectionGrants).values({ companyId: f.home, connectionId: connection!.id, kind: "organization", credentialSecretRefs: connection!.credentialSecretRefs, status: "active", isDefault: true }).returning();
      await db.insert(toolCatalogEntries).values({
        companyId: f.home, applicationId: application!.id, connectionId: connection!.id, entryKind: "tool",
        name: `read_record-${randomUUID()}`, toolName: "read_record", title: "Read record", description: "Read a fixture record",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
        annotations: { readOnlyHint: true }, riskLevel: "read", isReadOnly: true, isWrite: false, isDestructive: false,
        status: "active", versionHash: randomUUID(), quarantinedAt: null,
      });
      const [agentToolProfile] = await db.insert(toolProfiles).values({ companyId: f.home, profileKey: `broker-agent-${randomUUID()}`, name: "Brokered agent tool profile", defaultAction: "deny" }).returning();
      await db.insert(toolProfileBindings).values({ companyId: f.home, profileId: agentToolProfile!.id, targetType: "agent", targetId: presence.id });
      const expectedBrokerToolName = `mcp.${applicationKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${connection!.id.replace(/-/g, "").slice(0, 8)}:read-record`;
      await db.insert(toolProfileEntries).values({ companyId: f.home, profileId: agentToolProfile!.id, selectorType: "tool_name", effect: "include", toolName: expectedBrokerToolName });
      const [gatewayProfile] = await db.insert(toolProfiles).values({ companyId: f.home, profileKey: `broker-gateway-${randomUUID()}`, name: "Brokered gateway profile", defaultAction: "deny" }).returning();
      await db.insert(toolProfileEntries).values({ companyId: f.home, profileId: gatewayProfile!.id, selectorType: "connection", effect: "include", connectionId: connection!.id });
      const dispatchedBrokerCalls: Array<{ url: string; body: string | null; authorization: string | null }> = [];
      let nextProviderBarrier: { started: () => void; wait: Promise<void> } | null = null;
      const deferNextProviderResponse = () => {
        let markStarted!: () => void, release!: () => void;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        const wait = new Promise<void>(resolve => { release = resolve; });
        nextProviderBarrier = { started: markStarted, wait };
        return { started, release };
      };
      const gatewayOptions: Parameters<typeof createToolGatewayService>[1] = {
        toolActionSigningSecret: "v7-sandbox-broker-fixture",
        remoteHttpRequest: async (url, init) => {
          const body = typeof init.body === "string" ? init.body : null;
          const authorization = new Headers(init.headers).get("authorization");
          dispatchedBrokerCalls.push({ url, body, authorization });
          const barrier = nextProviderBarrier;
          if (barrier) { nextProviderBarrier = null; barrier.started(); await barrier.wait; }
          const requestId = body ? (JSON.parse(body) as { id?: unknown }).id ?? "broker-fixture" : "broker-fixture";
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { content: [{ type: "text", text: "read ok" }], structuredContent: { ok: true } } }), { status: 200, headers: { "content-type": "application/json" } });
        },
      };
      const gateway = createToolGatewayService(db, gatewayOptions);
      registerAssignedMcpGateway(db, gateway, scopedDb => createToolGatewayService(scopedDb, gatewayOptions));
      const namedGateway = await gateway.createNamedGateway({ companyId: f.home, body: { name: "Native task broker fixture", profileId: gatewayProfile!.id } });
      const initialBrokerBinding = {
        connectionId: connection!.id, grantVersionHash: "0".repeat(64), hostname: "provider.example.test", port: 443,
        methods: ["POST"] as const, pathPrefixes: ["/mcp"], binary: null, ttlSeconds: 120,
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
      expect(sandboxCapabilitySnapshotSchema.safeParse(testCapabilities(image)).success).toBe(true);
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
      const candidatePolicy = structuredClone(boundary);
      candidatePolicy.riskClass = "C3";
      const compiled = await executionSandboxService(db, serviceOptions).compile(f.actor, f.home, sandboxBinding.id, { expectedVersion: 2, executionManifestId: manifest!.record.id, candidatePolicy });
      expect(compiled.status, JSON.stringify({ proverResult: compiled.compilation.proverResult, failedBoundaries: compiled.compilation.failedBoundaries, unsupportedFeatures: compiled.compilation.unsupportedFeatures })).toBe("qualified");
      const runtime = runtimeControlService(db, {
        runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 },
      } as SaasPlatformConfig, undefined, { credentialBrokerOrigin: "https://paperclip.example.test/" });
      gateway.setSandboxBrokerAuthority(runtime.authorizeSandboxBrokerCapability);
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
      const commandCountBeforeDenials = (await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id))).length;
      await db.update(agentProviderBindings).set({ status: "revoked" }).where(eq(agentProviderBindings.id, provider.id));
      const revokedProvider = await request(app).post(admissionPath).send({ expectedVersion: 3, policySnapshotId: compiled.id });
      expect(revokedProvider.status).toBe(409);
      await db.update(agentProviderBindings).set({ status: "active" }).where(eq(agentProviderBindings.id, provider.id));
      await db.update(heartbeatRuns).set({ status: "paused" }).where(eq(heartbeatRuns.id, run!.id));
      const pausedRun = await request(app).post(admissionPath).send({ expectedVersion: 3, policySnapshotId: compiled.id });
      expect(pausedRun.status).toBe(409);
      await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, run!.id));
      expect((await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.runtimeCellId, admissionCell!.id))).length).toBe(commandCountBeforeDenials);
      const admissionPromise = request(app).post(admissionPath).send({ expectedVersion: 3, policySnapshotId: compiled.id });
      const admitted = await driveHost(admissionPromise.then(response => { expect(response.status, JSON.stringify(response.body)).toBe(200); return response.body; }), admissionCell!.id);
      expect(admitted.binding).toMatchObject({ status: "running", version: 5 });
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
        const environmentRuntime = environmentRuntimeService(db, { executeSandboxTask: runtime.executeSandboxTask });
        const executionEnvironment = { id: randomUUID(), driver: "sandbox", config: {}, envVars: {}, metadata: null } as any;
        const executeThroughAdapter = () => environmentRuntime.execute({
          environment: executionEnvironment,
          lease: lease as any,
          command: "node", args: ["-e", "process.stdout.write('fixture')"], cwd: "/workspace", timeoutMs: 60000,
          onLog: async (stream, chunk) => { streamed.push([stream, chunk]); },
        });
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
            name: expectedBrokerToolName, arguments: { id: "fixture-record" }, _meta: { "paperclip/operationId": operationId },
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
        expect(dispatchedBrokerCalls[0]?.authorization).toBe(`Bearer ${providerSecretValue}`);
        await brokerOperation(brokerToken!, namedGateway.gatewayPublicId, operationId).expect(200);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 1);
        await db.update(toolConnections).set({
          config: { url: "https://other-provider.example.test/mcp" },
          transportConfig: { url: "https://other-provider.example.test/mcp" },
        }).where(eq(toolConnections.id, connection!.id));
        await brokerOperation(brokerToken!, namedGateway.gatewayPublicId).expect(409);
        expect(dispatchedBrokerCalls).toHaveLength(dispatchedBeforeDeniedCalls + 1);
        await db.update(toolConnections).set({
          config: { url: "https://provider.example.test/mcp" },
          transportConfig: { url: "https://provider.example.test/mcp" },
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

        const secondFrame = new Promise<Record<string, any>>(resolve => relayHost.on("message", raw => {
          const message = JSON.parse(raw.toString());
          if (message.type === "exec_open") resolve(message);
        }));
        const uncertainExecution = executeThroughAdapter();
        const uncertainCommand = await secondFrame;
        await db.update(heartbeatRuns).set({ status: "paused" }).where(eq(heartbeatRuns.id, run!.id));
        relayHost.send(JSON.stringify({ type: "exec_output", channelId: uncertainCommand.channelId, stream: "stdout", base64: Buffer.from("revoked output").toString("base64") }));
        await expect(uncertainExecution).rejects.toThrow("Current active native Task run is required");
        expect(streamed.map(([, chunk]) => chunk).join("")).not.toContain("revoked output");
        await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, run!.id));
        const [uncertainClaim] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, uncertainCommand.request.requestId));
        expect(uncertainClaim?.status).toBe("CLAIMED");
        await expect(executeThroughAdapter()).rejects.toThrow("previous sandbox execution");

        const service = executionSandboxService(db, {
          ...serviceOptions,
          recordRuntimeWorkloadState: (tx, input) => runtime.recordSandboxWorkloadState(tx, input),
        });
        stopResult = await driveHost(service.stop(f.actor, f.home, sandboxBinding.id, "fixture-user-stop"), admissionCell!.id);
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
        await new Promise<void>(resolve => relayServer.close(() => resolve()));
        if (previousJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
        else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousJwtSecret;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(stopResult.binding.status).toBe("stopped");
      expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, admissionCell!.id)))[0]).toMatchObject({ status: "STOPPED", activeSince: null });
      expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId, admissionCell!.id))).map(row => [row.operationType, row.status])).toEqual([["start", "SUCCEEDED"], ["stop", "SUCCEEDED"]]);
      expect((await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.entityId, admissionCell!.id)))).some(event => event.action === "runtime.sandbox_workload_started")).toBe(true);
    }, 60000);
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
