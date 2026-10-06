import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createDb,
  memoryBindings,
  memoryRecords,
  memoryEvidence,
  companyMemberships,
  type Db,
} from "@paperclipai/db";
import { exportCompanyStateV7 } from "../services/enterprise/portability.js";
import { memoryService } from "../services/memory/memory-service.js";
import { cognitiveMemoryActor } from "../services/memory/cognitive-memory.js";
import { derivedMemoryService } from "../services/memory/derived-memory.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "native owner V7 portability",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: Db,
      f: Awaited<ReturnType<typeof seedV5Presences>>,
      first: string,
      second: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-portability-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
      f = await seedV5Presences(db);
      await instanceSettingsService(db).updateExperimental({
        enableCollectiveMemoryV1: true,
        enableContextEngineV1: true,
        cognitive_memory_v7: true,
        memory_observations_v7: true,
        memory_models_v7: true,
      });
      first = randomUUID();
      second = randomUUID();
      const [binding] = await db
        .insert(memoryBindings)
        .values({
          companyId: f.home,
          key: "portable",
          name: "Portable fixture",
          providerKey: "local",
        })
        .returning();
      const roots = [first, second];
      for (const id of roots) {
        await db
          .insert(memoryRecords)
          .values({
            id,
            companyId: f.home,
            bindingId: binding!.id,
            providerKey: "local",
            memoryType: "outcome",
            scopeType: "company",
            content: "Portable shared reviewed outcome",
            reviewState: "accepted",
            verificationState: "human_verified",
            observedAt: new Date(),
            createdByActorType: "user",
            createdByActorId: f.userId,
          });
        await db
          .insert(memoryEvidence)
          .values({
            companyId: f.home,
            memoryRecordId: id,
            sourceClass: "task",
            sourceProvider: "august_works_tasks",
            sourceType: "issue",
            sourceRef: `issue://${id}`,
            sourceVersion: "1",
            observedAt: new Date(),
            excerptHash: id === first ? "a".repeat(64) : "b".repeat(64),
            citationJson: { label: "Reviewed outcome" },
            trustLevel: "high",
            supportsOrContradicts: "supports",
          });
      }
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
    }, 30000);
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
    });
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
        first,
        cognitiveMemoryActor(f.actor),
      );
      const state = await exportCompanyStateV7(db, f.actor, f.home);
      expect(state.files["memory/records.json"]).not.toContain(first);
      expect(state.files["memory/observations.json"]).not.toContain(
        "Portable observation",
      );
    });
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
