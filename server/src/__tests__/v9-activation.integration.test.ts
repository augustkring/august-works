import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  authUsers,
  companies,
  companyMemberships,
  companyOnboardingRuns,
  createDb,
} from "@paperclipai/db";
import {
  createSaasCompanySchema,
  type ActivationCommand,
} from "@paperclipai/shared";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { activationService } from "../services/saas/activation.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V9 activation on the native onboarding owner",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      userId: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v9-activation-");
      db = createDb(database.connectionString);
    });
    afterAll(async () => {
      await database?.cleanup();
    });
    beforeEach(async () => {
      userId = randomUUID();
      await db.insert(authUsers).values({
        id: userId,
        name: "Owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        transactional_email_v6: true,
        email_verification_required_v6: true,
        billing_v6: true,
        billing_entitlements_v6: true,
        billing_usage_v6: true,
        server_onboarding_v6: true,
        free_core_commercial_v7: true,
        activation_v9: true,
      });
    });
    const actor = () => ({
      type: "board" as const,
      source: "session" as const,
      userId,
    });
    async function create() {
      return saasOnboardingService(db).create(
        userId,
        createSaasCompanySchema.parse({
          name: "Activation company",
          idempotencyKey: randomUUID(),
          activation: { version: 9, website: "example.test" },
        }),
      );
    }
    const command = (
      expectedVersion: number,
      rest: Omit<
        Extract<ActivationCommand, { operation: "save_intent" }>,
        "expectedVersion" | "requestId"
      >,
    ) => ({ ...rest, expectedVersion, requestId: randomUUID() });
    it("starts with intent and replays company creation without a paid plan or duplicate company", async () => {
      const input = createSaasCompanySchema.parse({
        name: "Activation company",
        idempotencyKey: randomUUID(),
        activation: { version: 9 },
      });
      const [first, replayed] = await Promise.all([
        saasOnboardingService(db).create(userId, input),
        saasOnboardingService(db).create(userId, input),
      ]);
      expect(first.id).toBe(replayed.id);
      expect(first.currentStage).toBe("v9_intent");
      expect(first.activationState?.firstValueAt).toBeNull();
      const view = await activationService(db).get(actor(), first.companyId);
      expect(view.state.step).toBe("intent");
      expect(view.state).not.toHaveProperty("receipts");
      expect(view.blockers).toContain("no_qualified_capability");
    });
    it("serializes concurrent commands, fences changed payloads and keeps intent out of activity details", async () => {
      const run = await create(),
        input = command(run.version, {
          operation: "save_intent",
          intent: "Private customer outcome",
        });
      const service = activationService(db);
      const results = await Promise.all([
        service.command(actor(), run.companyId, input),
        service.command(actor(), run.companyId, input),
      ]);
      expect(results.map((r) => r.version)).toEqual([2, 2]);
      expect(results[0].state.step).toBe("discovery_permission");
      await expect(
        service.command(actor(), run.companyId, {
          ...input,
          intent: "Changed private outcome",
        }),
      ).rejects.toMatchObject({ status: 409 });
      const logs = await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, run.companyId),
            eq(activityLog.action, "activation.step_completed"),
          ),
        );
      expect(logs).toHaveLength(1);
      expect(JSON.stringify(logs.map((l) => l.details))).not.toContain(
        "Private customer",
      );
    });
    it("persists the entered draft without advancing or fetching a supplied website", async () => {
      const run = await create(),
        service = activationService(db);
      const saved = await service.command(actor(), run.companyId, {
        operation: "save_draft",
        requestId: randomUUID(),
        expectedVersion: run.version,
        intent: "Unfinished goal",
      });
      expect(saved.state.step).toBe("intent");
      expect(saved.state.intent).toBe("Unfinished goal");
      expect(saved.sources.find((s) => s.id === "website")?.status).toBe(
        "not_requested",
      );
      await expect(
        service.command(actor(), run.companyId, {
          operation: "continue_discovery",
          requestId: randomUUID(),
          expectedVersion: saved.version,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("records material facts in Foundation and cannot claim a useful result from text alone", async () => {
      const run = await create(),
        service = activationService(db);
      let view = await service.command(
        actor(),
        run.companyId,
        command(run.version, {
          operation: "save_intent",
          intent: "Prepare a customer research draft",
        }),
      );
      view = await service.command(actor(), run.companyId, {
        operation: "build_customer_draft",
        requestId: randomUUID(),
        expectedVersion: view.version,
      });
      view = await service.command(actor(), run.companyId, {
        operation: "continue_discovery",
        requestId: randomUUID(),
        expectedVersion: view.version,
      });
      view = await service.command(actor(), run.companyId, {
        operation: "confirm_material_facts",
        requestId: randomUUID(),
        expectedVersion: view.version,
        companyPurpose: "Help customers compare services",
      });
      expect(view.state.missionFoundationId).toMatch(/^[a-f0-9-]{36}$/);
      expect(view.state.step).toBe("capability");
      expect(view.state.firstValueAt).toBeNull();
      expect(view.status).toBe("in_progress");
      await expect(
        service.command(actor(), run.companyId, {
          operation: "select_capability",
          requestId: randomUUID(),
          expectedVersion: view.version,
          packageVersionId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
    it("rejects another member, revoked membership and archived companies at mutation time", async () => {
      const run = await create(),
        service = activationService(db),
        other = randomUUID();
      await db.insert(authUsers).values({
        id: other,
        name: "Other",
        email: `${other}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(companyMemberships).values({
        companyId: run.companyId,
        principalType: "user",
        principalId: other,
        membershipRole: "owner",
        status: "active",
      });
      await expect(
        service.get({ ...actor(), userId: other }, run.companyId),
      ).rejects.toMatchObject({ status: 404 });
      await db
        .update(companies)
        .set({ status: "archived" })
        .where(eq(companies.id, run.companyId));
      await expect(
        service.command(
          actor(),
          run.companyId,
          command(1, { operation: "save_intent", intent: "Goal" }),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await db
        .update(companyMemberships)
        .set({ status: "inactive" })
        .where(
          and(
            eq(companyMemberships.companyId, run.companyId),
            eq(companyMemberships.principalId, userId),
          ),
        );
      await expect(
        service.get({ ...actor(), isInstanceAdmin: true }, run.companyId),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("fences legacy binaries and preserves history during admission rollback", async () => {
      const run = await create();
      await expect(
        saasOnboardingService(db).update(run.companyId, userId, {
          expectedVersion: 1,
          stage: "plan",
          answers: { mission: "Legacy overwrite" },
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        db.execute(
          sql`update company_onboarding_runs set current_stage='plan',version=version+1 where id=${run.id}::uuid`,
        ),
      ).rejects.toMatchObject({
        cause: { message: "AW_V9_ONBOARDING_FLOW_REQUIRED", code: "P0001" },
      });
      await instanceSettingsService(db).updateExperimental({
        activation_v9: false,
      });
      expect(
        (await activationService(db).get(actor(), run.companyId)).state.step,
      ).toBe("intent");
      await expect(
        activationService(db).command(
          actor(),
          run.companyId,
          command(1, { operation: "save_intent", intent: "Goal" }),
        ),
      ).rejects.toMatchObject({ status: 404 });
      const [saved] = await db
        .select()
        .from(companyOnboardingRuns)
        .where(eq(companyOnboardingRuns.id, run.id));
      expect(saved?.version).toBe(1);
    });
  },
);
