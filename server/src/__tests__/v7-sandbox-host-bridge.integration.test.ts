import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { constants, generateKeyPairSync, privateDecrypt, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  authSessions,
  billingAccounts,
  billingAccountCompanies,
  companyMemberships,
  createDb,
  runtimeCells,
  runtimeOperations,
  heartbeatRuns,
  issues,
  runtimeCapacityProfiles,
  runtimeHostCommands,
  runtimeHosts,
  runtimeSandboxBindings,
  runtimeVersionCatalog,
} from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES, SANDBOX_CONTROLS, SANDBOX_HOST_COMMAND } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { executionSandboxService } from "../services/execution-sandbox/sandbox-service.js";
import { executionSandboxRoutes } from "../routes/execution-sandbox.js";
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
import { errorHandler } from "../middleware/index.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";

const support = await getEmbeddedPostgresTestSupport();
const image = "fixture.invalid/openshell@sha256:" + "a".repeat(64);
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
      const deadline = Date.now() + 45000;
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
      if (!settled) throw new Error(`test host did not drain commands for cell ${targetCellId}`);
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
        snapshot = { ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, true])), backend: "openshell", backendVersion: "0.1.2", hostKernelVersion: "fixture-kernel", sandboxImageDigest: digest, filesystemEnforcementMode: "hard_requirement", staticPolicyRequiresRecreate: true, dynamicNetworkPolicy: true, policyProverBoundaryCheck: true, policyProverCoverage: [...SANDBOX_CONTROLS], credentialBindingDimensions: ["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"], testedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), qualificationHash: "a".repeat(64), evidenceKind: "protected_host_report" };
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
        enableContextEngineV1: true,
      });
      const created = await agentIdentityService(db).create(f.actor, { name: "Sandbox admission Task fixture", homeCompanyId: f.home });
      const presence = created.presence;
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
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: presence.id, status: "running", runtimeMode: "native", runtimeModeResolvedAt: new Date(), nativeIssueId: task!.id, responsibleUserId: f.userId, contextSnapshot: { issueId: task!.id } }).returning();
      await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, task!.id));
      const manifest = await agentRuntimeFabricService(db).prepare({ companyId: f.home, agentId: presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: task!.id, query: task!.title });
      expect(manifest).toBeTruthy();
      const boundary = supportedPolicy();
      const sandboxBinding = await executionSandboxService(db, { operatorUserIds: [f.userId] }).create(f.actor, f.home, { runtimeCellId: admissionCell!.id, expectedCellGeneration: admissionCell!.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy: boundary });
      const sandboxIdentity: SandboxIdentity = { companyId: f.home, bindingId: sandboxBinding.id, cellId: admissionCell!.id, cellGeneration: admissionCell!.generation.toString(), sandboxRef: `aw-v7-${sandboxBinding.id}` };
      const serviceOptions = {
        operatorUserIds: [f.userId],
        backendFor: (binding: any, actor: any) => simulatedBackend(sandboxIdentity, transportForTest.bridge(actor)),
      };
      const qualification = await driveHost(executionSandboxService(db, serviceOptions).qualify(f.actor, f.home, sandboxBinding.id, 1), admissionCell!.id);
      expect(qualification).toMatchObject({ status: "ready", version: 2 });
      const compiled = await executionSandboxService(db, serviceOptions).compile(f.actor, f.home, sandboxBinding.id, { expectedVersion: 2, executionManifestId: manifest!.record.id, candidatePolicy: boundary });
      expect(compiled.status).toBe("qualified");
      const runtime = runtimeControlService(db, { runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 } } as SaasPlatformConfig);
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { (req as any).actor = f.actor; next(); });
      app.use("/api", executionSandboxRoutes(db, {
        ...serviceOptions,
        assertRuntimeStartAdmission: (tx, input) => runtime.assertSandboxStartAdmission(tx, input),
        recordRuntimeWorkloadState: (tx, input) => runtime.recordSandboxWorkloadState(tx, input),
      }));
      app.use(errorHandler);
      const admissionPromise = request(app).post(`/api/companies/${f.home}/runtime-sandboxes/${sandboxBinding.id}/admit`).send({ expectedVersion: 2, policySnapshotId: compiled.id });
      const admitted = await driveHost(admissionPromise.then(response => { expect(response.status).toBe(200); return response.body; }), admissionCell!.id);
      expect(admitted.binding).toMatchObject({ status: "running", version: 4 });
      expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, admissionCell!.id)))[0]).toMatchObject({ status: "HEALTHY" });
      expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId, admissionCell!.id))).map(row => [row.operationType, row.status])).toEqual([["start", "SUCCEEDED"]]);
      await new Promise(resolve => setTimeout(resolve, 5));
      const service = executionSandboxService(db, {
        ...serviceOptions,
        recordRuntimeWorkloadState: (tx, input) => runtime.recordSandboxWorkloadState(tx, input),
      });
      const stopped = await driveHost(service.stop(f.actor, f.home, sandboxBinding.id, "fixture-user-stop"), admissionCell!.id);
      expect(stopped.binding.status).toBe("stopped");
      expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, admissionCell!.id)))[0]).toMatchObject({ status: "STOPPED", activeSince: null });
      expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId, admissionCell!.id))).map(row => [row.operationType, row.status])).toEqual([["start", "SUCCEEDED"], ["stop", "SUCCEEDED"]]);
      expect((await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.entityId, admissionCell!.id)))).some(event => event.action === "runtime.sandbox_workload_started")).toBe(true);
      await runtime.relay.stop();
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
