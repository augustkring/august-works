import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createDb, agents, agentConfigurationDrafts } from "@paperclipai/db";
import { agentAuthoringContentSchema } from "@paperclipai/shared";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { authoringCandidateHash } from "../services/agents/authoring-test-candidate.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
describe.runIf(support.supported)("Canonical agent candidate migration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-authoring-upgrade-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ saas_deployment_profile_v6: true, billing_v6: true,
      agent_packages_v7: true, hire_agent_v9: true });
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  it("backfills an actual legacy save pin without rewriting content, receipts or production", async () => {
    const fixture = await seedV5Presences(db);
    const service = agentAuthoringService(db);
    const draft = await service.create(fixture.actor, fixture.home, { requestId: randomUUID(), agentId: fixture.presence.id });
    const content = agentAuthoringContentSchema.parse({ name: "Legacy private candidate", outcome: "A bounded internal responsibility",
      ownerUserId: fixture.userId });
    await service.save(fixture.actor, fixture.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test", content });
    const [production] = await db.select().from(agents).where(eq(agents.id, fixture.presence.id));
    const oldNavigation = await readFile(new URL("../../../packages/db/src/migrations/0479_lethal_stellaris.sql", import.meta.url), "utf8");
    const originalModel = await readFile(new URL("../../../packages/db/src/migrations/0477_aromatic_gauntlet.sql", import.meta.url), "utf8");
    const upgrade = await readFile(new URL("../../../packages/db/src/migrations/0480_gray_wrecker.sql", import.meta.url), "utf8");

    // Only this throwaway database is reconstructed to the previous physical
    // schema. Run the shipped upgrade in one original migration transaction.
    await db.transaction(async tx => {
      await tx.execute(sql.raw(`
        DROP TRIGGER aw_v9_agent_test_candidate_guard ON agent_configuration_tests;
        DROP FUNCTION aw_v9_agent_test_candidate_guard();
        ALTER TABLE agent_configuration_tests DROP COLUMN candidate_revision;
        ALTER TABLE agent_configuration_drafts DROP COLUMN candidate_revision;
        ALTER TABLE agent_configuration_drafts ADD COLUMN save_sequence integer DEFAULT 0 NOT NULL;
        ALTER TABLE agent_configuration_drafts ADD CONSTRAINT agent_configuration_drafts_save_sequence_check CHECK(save_sequence>=0);
      `));
      await tx.execute(sql.raw(oldNavigation.slice(oldNavigation.indexOf("CREATE OR REPLACE FUNCTION"))));
      const modelStart = originalModel.indexOf("CREATE FUNCTION aw_v9_agent_test_model_guard()");
      const modelEnd = originalModel.indexOf("--> statement-breakpoint\nCREATE TRIGGER aw_v9_agent_test_model_guard", modelStart);
      expect(modelStart).toBeGreaterThan(0); expect(modelEnd).toBeGreaterThan(modelStart);
      await tx.execute(sql.raw(originalModel.slice(modelStart, modelEnd).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")));
      await tx.execute(sql`update agent_configuration_drafts set version=version+1 where id=${draft.id}::uuid`);
      for (const statement of upgrade.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
    });

    const [restored] = await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.id, draft.id));
    expect(restored).toMatchObject({ version: 3, candidateRevision: 3, content });
    const expectedLegacyHash = nativeSha256({ id: restored!.id, companyId: restored!.companyId, version: restored!.version,
      content: restored!.content, packageVersionId: restored!.packageVersionId, packageContentHash: restored!.packageContentHash });
    expect(authoringCandidateHash(restored!)).toBe(expectedLegacyHash);
    const saved = await service.save(fixture.actor, fixture.home, draft.id, { requestId: randomUUID(), expectedVersion: 3, step: "review", content });
    const [current] = await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.id, draft.id));
    expect(saved.version).toBe(4); expect(current!.candidateRevision).toBe(3);
    expect(current!.requestReceipts.slice(0, -1)).toEqual(restored!.requestReceipts);
    expect(authoringCandidateHash(current!)).toBe(expectedLegacyHash);
    expect((await db.select().from(agents).where(eq(agents.id, fixture.presence.id)))[0]).toEqual(production);
  });
});
