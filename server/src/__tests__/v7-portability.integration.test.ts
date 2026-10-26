import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createDb,
  memoryBindings,
  memoryRecords,
  memoryBindingTargets,
  companyMemberships,
  type Db,
} from "@paperclipai/db";
import { exportCompanyStateV7 } from "../services/enterprise/portability.js";
import { memoryService } from "../services/memory/memory-service.js";
import { cognitiveMemoryActor } from "../services/memory/cognitive-memory.js";
import { derivedMemoryService } from "../services/memory/derived-memory.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { issueService } from "../services/issues.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "native owner V7 portability",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: Db,
      f: Awaited<ReturnType<typeof seedV5Presences>>,
      first: string,
      second: string,
      firstMemoryRecordId: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-portability-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
      f = await seedV5Presences(db);
      const sourceActor = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
      await instanceSettingsService(db).updateExperimental({
        enableCollectiveMemoryV1: true,
        enableContextEngineV1: true,
        cognitive_memory_v7: true,
        memory_observations_v7: true,
        memory_models_v7: true,
      });
      first = randomUUID();
      second = randomUUID();
      const taskSources = new Map<string, Date>();
      for (const [index, id] of [first, second].entries()) {
        const task = await issueService(db).create(f.home, {
          id,
          title: `Human-reviewed portable source ${index + 1}`,
          description: `Original Human task evidence ${index + 1}`,
          createdByUserId: f.userId,
          responsibleUserId: f.userId,
        }, db, undefined, { manualInputActor: sourceActor, privacyActor: sourceActor, sourceAccessActor: sourceActor });
        taskSources.set(id, task.updatedAt);
      }
      const [binding] = await db
        .insert(memoryBindings)
        .values({
          companyId: f.home,
          key: "portable",
          name: "Portable fixture",
          providerKey: "local",
        })
        .returning();
      const roots: string[] = [];
      await db.insert(memoryBindingTargets).values({ companyId: f.home, bindingId: binding!.id,
        targetType: "company", targetId: f.home });
      const memoryActor = { principal: { type: "user" as const, userId: f.userId }, authorizationActor: sourceActor };
      for (const [index, id] of [first, second].entries()) {
        const observedAt = new Date();
        const sourceVersion = taskSources.get(id)!.toISOString();
        const candidate = await memoryService(db).createCandidate(f.home, {
          bindingId: binding!.id,
          memoryType: "outcome",
          scope: { type: "company", id: null },
          subject: null,
          ownerAgentId: null,
          title: `Portable shared reviewed outcome ${index + 1}`,
          content: `Portable shared reviewed outcome ${index + 1}`,
          summary: "A current Human reviewed portable Task outcome",
          sensitivity: "internal",
          importance: 50,
          confidenceScore: 0.8,
          validFrom: null,
          validUntil: null,
          expiresAt: null,
          observedAt: observedAt.toISOString(),
          retentionPolicy: "standard",
          createdByOperationId: randomUUID(),
          metadata: {},
          evidence: [{
            sourceClass: "task",
            sourceProvider: "august_works_tasks",
            sourceType: "issue",
            sourceRef: `issue://${id}`,
            sourceVersion,
            sourceUpdatedAt: sourceVersion,
            observedAt: observedAt.toISOString(),
            excerptHash: nativeSha256({ taskId: id, updatedAt: sourceVersion, index }),
            citation: { label: "Reviewed outcome" },
            trustLevel: "high",
            relation: "supports",
          }],
        }, memoryActor);
        roots.push(candidate.record.id);
        await memoryService(db).reviewCandidate(f.home, candidate.record.id,
          { decision: "accept", reason: "The current Human reviewed this portable Task outcome" }, memoryActor);
      }
      firstMemoryRecordId = roots[0]!;
      await db
        .insert(memoryRecords)
        .values({
          companyId: f.home,
          bindingId: binding!.id,
          providerKey: "local",
          memoryType: "outcome",
          scopeType: "agent",
          scopeId: f.presence.id,
          ownerAgentId: f.presence.id,
          content: "Private agent memory must stay private",
          observedAt: new Date(),
          createdByActorType: "agent",
          createdByActorId: f.presence.id,
        });
      for (let i = 0; i < 101; i++)
        await derivedMemoryService(db).createObservation(f.actor, f.home, {
          observationKey: `portable.observation.${i}`,
          scope: { type: "company", id: null },
          purpose: "general_work",
          content: `Portable observation ${i}`,
          sensitivity: "internal",
          evidence: roots.map((id) => ({
            memoryRecordId: id,
            relation: "supports" as const,
          })),
        });
    // This setup deliberately builds 101 independently observed lifecycle
    // rows through the original service path; keep its fixture budget separate
    // from the normal per-hook default.
    }, 120000);
    afterAll(async () => {
      await db?.$client.end();
      await database?.cleanup();
    }, 60000);
    it("exports every eligible observation and shared lifecycle without private Memory or credentials", async () => {
      const state = await exportCompanyStateV7(db, f.actor, f.home);
      expect(state.schema).toBe("aw.company-state.v7");
      expect(state.sha256).toBe(nativeSha256(state.files));
      expect(
        JSON.parse(state.files["memory/observations.json"]!).observations,
      ).toHaveLength(101);
      expect(state.files["memory/records.json"]).toContain(
        "Portable shared reviewed outcome",
      );
      expect(JSON.stringify(state)).not.toContain(
        "Private agent memory must stay private",
      );
      expect(state.files["role-packs/roles.json"]).toBeDefined();
      expect(state.files["workflows/definitions.json"]).toBeDefined();
      expect(state.files["governance/use-cases.json"]).toBeDefined();
    }, 120000);
    it("retains portability with rollout off and excludes source-erased payloads", async () => {
      await instanceSettingsService(db).updateExperimental({
        memory_observations_v7: false,
        memory_models_v7: false,
        cognitive_memory_v7: false,
      });
      expect(
        JSON.parse(
          (await exportCompanyStateV7(db, f.actor, f.home)).files[
            "memory/observations.json"
          ]!,
        ).observations,
      ).toHaveLength(101);
      await memoryService(db).forget(
        f.home,
        firstMemoryRecordId,
        cognitiveMemoryActor(f.actor),
      );
      const state = await exportCompanyStateV7(db, f.actor, f.home);
      const exportedRecords = JSON.parse(state.files["memory/records.json"]!).records as Array<{ id: string }>;
      expect(exportedRecords.some(record => record.id === firstMemoryRecordId)).toBe(false);
      expect(state.files["memory/observations.json"]).not.toContain(
        "Portable observation",
      );
    }, 120000);
    it("requires fresh actual company owner membership even with a previously authorized actor", async () => {
      await db
        .update(companyMemberships)
        .set({ membershipRole: "viewer" })
        .where(eq(companyMemberships.companyId, f.home));
      await expect(
        exportCompanyStateV7(db, f.actor, f.home),
      ).rejects.toMatchObject({ status: 403 });
    });
  },
);
