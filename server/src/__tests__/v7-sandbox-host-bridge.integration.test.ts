import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  billingAccounts,
  billingAccountCompanies,
  companyMemberships,
  createDb,
  runtimeCells,
  runtimeCapacityProfiles,
  runtimeHostCommands,
  runtimeHosts,
  runtimeVersionCatalog,
} from "@paperclipai/db";
import { SANDBOX_HOST_COMMAND } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { executionSandboxService } from "../services/execution-sandbox/sandbox-service.js";
import { nativeSandboxHostTransport } from "../services/execution-sandbox/native-host-bridge.js";
import { runtimeControlService } from "../services/runtime/control.js";
import { open as unseal } from "../services/saas/crypto.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import type { SandboxIdentity } from "../services/execution-sandbox/backend.js";
import { openShellBackend } from "../services/execution-sandbox/openshell-backend.js";

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
          hostAgentVersion: "6.0.1",
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
      const binding = await executionSandboxService(db).create(
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
    it("persists an encrypted current native scope and rejects mismatched receipts without earning capability", async () => {
      const transport = nativeSandboxHostTransport(db),
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
      const transport = nativeSandboxHostTransport(db),
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
      const transport = nativeSandboxHostTransport(db),
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
    it("requires the host version that actually polls this native command lane", async () => {
      await db
        .update(runtimeHosts)
        .set({ hostAgentVersion: "6.0.0" })
        .where(eq(runtimeHosts.id, host.id));
      await expect(
        nativeSandboxHostTransport(db).bridge(f.actor).capabilities(scope),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await db
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.runtimeCellId, cell.id)),
      ).toHaveLength(0);
    });
    it("retains unsupported host qualification without treating configured image as physical preparation", async () => {
      const transport = nativeSandboxHostTransport(db);
      const service = executionSandboxService(db, {
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
    it("rejects a late completion after host fencing and expires bounded pending work", async () => {
      const transport = nativeSandboxHostTransport(db),
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
