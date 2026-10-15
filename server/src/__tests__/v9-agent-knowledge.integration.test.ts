import { grantAuthoringKnowledgeReadFixture } from "./helpers/authoring-procedures.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeRegisteredClients, companyMemberships, createDb, principalPermissionGrants } from "@paperclipai/db";
import { agentAuthoringContentSchema } from "@paperclipai/shared";
import { resolveAuthoringKnowledge } from "../services/agents/authoring-knowledge.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("V9 selected approved knowledge through Original Source and access owners", () => {
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  beforeAll(async () => {
    expect((await getEmbeddedPostgresTestSupport()).supported, "Knowledge qualification needs actual PostgreSQL").toBe(true);
    fixture = await startEmbeddedPostgresTestDatabase("aw-v9-selected-knowledge-"); db = createDb(fixture.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { if (fixture) { await closeRegisteredClients(fixture.connectionString); await fixture.cleanup(); } }, 30000);
  beforeEach(async () => {
    f = await seedV5Presences(db);
    await grantAuthoringKnowledgeReadFixture(db, f.home, f.presence.id, f.userId);
  });
  async function source(body = "Approved facts for the internal welcome", sensitivity: "internal" | "confidential" = "internal", companyId = f.home) {
    const owner = foundationService(db), actor = { principal: { type: "user" as const, userId: f.userId } };
    const draft = await owner.createDraft(companyId, { foundationKey: `source-${randomUUID()}`, category: "company", documentType: "company_profile", title: "Approved source", body, sensitivity }, actor);
    await owner.submitForReview(companyId, draft.id, draft.latestRevisionId!, actor);
    return owner.approve(companyId, draft.id, draft.latestRevisionId!, actor);
  }
  function resolve(ids: string[]) {
    return resolveAuthoringKnowledge(db, { companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      content: agentAuthoringContentSchema.parse({ knowledgeDocumentIds: ids, capabilities: [{ operation: "read_approved_knowledge", autonomy: "automatic" }] }) });
  }
  it("reads only the selected approved revision and keeps bodies out of identity pins", async () => {
    const selected = await source(), other = await source("Unselected private company facts");
    const view = await resolve([selected.id]); expect(view.knowledge).toHaveLength(1);
    expect(view.knowledge[0]).toMatchObject({ foundationDocumentId: selected.id, revisionId: selected.approvedRevisionId, body: selected.body });
    expect(JSON.stringify(view.pins)).not.toContain(selected.body); expect(JSON.stringify(view)).not.toContain(other.body);
    await foundationService(db).updateDraft(f.home, selected.id, { baseRevisionId: selected.latestRevisionId!, body: "Private unpublished source change" }, { principal: { type: "user", userId: f.userId } });
    expect(await resolve([selected.id])).toEqual(view);
  });
  it("withdraws access when either read grant or current human membership is removed", async () => {
    const selected = await source(); await resolve([selected.id]);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "foundation:read")));
    await expect(resolve([selected.id])).rejects.toMatchObject({ status: 403 });
    await grantAuthoringKnowledgeReadFixture(db, f.home, f.presence.id, f.userId);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, "foundation:read")));
    await expect(resolve([selected.id])).rejects.toMatchObject({ status: 403 });
    await grantAuthoringKnowledgeReadFixture(db, f.home, f.presence.id, f.userId);
    await db.update(companyMemberships).set({ status: "disabled" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await expect(resolve([selected.id])).rejects.toMatchObject({ status: 403 });
  });
  it("rejects foreign, archived, future, expired and higher-sensitivity sources", async () => {
    await expect(resolve([(await source("Foreign private evidence", "internal", f.guest)).id])).rejects.toMatchObject({ status: 409 });
    await expect(resolve([(await source("Confidential data", "confidential")).id])).rejects.toMatchObject({ status: 409 });
    const selected = await source(); await foundationService(db).archive(f.home, selected.id, { principal: { type: "user", userId: f.userId } });
    await expect(resolve([selected.id])).rejects.toMatchObject({ status: 409 });
    for (const validity of [{ validFrom: new Date(Date.now() + 60000).toISOString() }, { validUntil: new Date(Date.now() - 60000).toISOString() }]) {
      const next = await source(), owner = foundationService(db), actor = { principal: { type: "user" as const, userId: f.userId } };
      const changed = await owner.updateDraft(f.home, next.id, { baseRevisionId: next.latestRevisionId!, ...validity }, actor);
      await owner.submitForReview(f.home, next.id, changed.latestRevisionId!, actor); await owner.approve(f.home, next.id, changed.latestRevisionId!, actor);
      await expect(resolve([next.id])).rejects.toMatchObject({ status: 409 });
    }
  });
});
