import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeRegisteredClients, companyMemberships, createDb, memoryRecords, principalPermissionGrants } from "@paperclipai/db";
import { agentAuthoringContentSchema } from "@paperclipai/shared";
import { resolveAuthoringMemory } from "../services/agents/authoring-memory.js";
import { memoryService } from "../services/memory/memory-service.js";
import { issueService } from "../services/issues.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { accessService } from "../services/access.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("V9 exact human-approved work preference Sources", () => {
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  beforeAll(async () => {
    expect((await getEmbeddedPostgresTestSupport()).supported, "Preference qualification needs actual PostgreSQL").toBe(true);
    fixture = await startEmbeddedPostgresTestDatabase("aw-v9-selected-preferences-"); db = createDb(fixture.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true });
  }, 60000);
  afterAll(async () => { if (fixture) { await closeRegisteredClients(fixture.connectionString); await fixture.cleanup(); } }, 30000);
  beforeEach(async () => {
    f = await seedV5Presences(db);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true });
    await accessService(db).setPrincipalPermission(f.home, "agent", f.presence.id, "company_scope:read", true, f.userId);
  });
  async function source(approve = true, companyId = f.home) {
    const owner = memoryService(db), actor = { principal: { type: "user" as const, userId: f.userId } };
    const binding = await owner.createCompanyBinding(companyId, { key: `prefs-${randomUUID()}`, name: "Approved preference Source", providerKey: "local", config: {}, enabled: true }, actor);
    const body = `Use concise paragraphs ${randomUUID()}`, observedAt = new Date().toISOString();
    const task = await issueService(db).create(companyId, { title: "Human-provided preference evidence", description: body, createdByUserId: f.userId });
    const result = await owner.createCandidate(companyId, { bindingId: binding.id, memoryType: "preference", scope: { type: "company", id: null },
      subject: null, ownerAgentId: null, title: "Concise internal drafts", content: body, summary: null,
      sensitivity: "internal", importance: 50, confidenceScore: 1, validFrom: null, validUntil: null, observedAt: new Date().toISOString(),
      retentionPolicy: "approved_work_preference", expiresAt: new Date(Date.now()+86400000).toISOString(), createdByOperationId: randomUUID(),
      metadata: {}, evidence: [{ sourceClass: "task", sourceProvider: "august_works_issue", sourceType: "issue",
        sourceRef: `issue://${task.id}`, sourceVersion: task.updatedAt.toISOString(), sourceUpdatedAt: task.updatedAt.toISOString(),
        observedAt, excerptHash: nativeSha256(body), citation: { label: task.title }, trustLevel: "high", relation: "supports" }] }, actor);
    if (approve) await owner.reviewCandidate(companyId, result.record.id, { decision: "accept", reason: "Human approved this organizational preference" }, actor);
    return result.record.id;
  }
  function resolve(ids: string[]) { return resolveAuthoringMemory(db, { companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
    content: agentAuthoringContentSchema.parse({ memory: "approved_work_preferences", memoryRecordIds: ids }) }); }
  it("loads only the exact current human-approved preference without widening scope", async () => {
    const selected = await source(), other = await source(); const value = await resolve([selected]);
    expect(value).toHaveLength(1); expect(value[0].recordId).toBe(selected); expect(JSON.stringify(value)).not.toContain(other);
    expect(value[0]).toMatchObject({ sensitivity: "internal", expiresAt: expect.any(String), bodyHash: expect.any(String) });
    await expect(resolveAuthoringMemory(db, { companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      content: agentAuthoringContentSchema.parse({ memory: "approved_work_preferences", memoryRecordIds: [selected] }),
      now: new Date(new Date(value[0]!.expiresAt).getTime()+1) })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects pending, foreign, revoked and erased Sources", async () => {
    await expect(resolve([await source(false)])).rejects.toMatchObject({ status: 409 });
    await expect(resolve([await source(true,f.guest)])).rejects.toMatchObject({ status: 409 });
    const selected = await source();
    await memoryService(db).revoke(f.home, selected, { reason: "Human withdrew the preference" }, { principal: { type: "user", userId: f.userId } });
    await expect(resolve([selected])).rejects.toMatchObject({ status: 409 });
    const erased = await source(); await memoryService(db).forget(f.home, erased, { principal: { type: "user", userId: f.userId } });
    await expect(resolve([erased])).rejects.toMatchObject({ status: 409 });
  });
  it("withdraws after actual admission, agent access or human membership changes", async () => {
    const selected = await source(); await resolve([selected]);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: false });
    await expect(resolve([selected])).rejects.toMatchObject({ status: 409 });
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true });
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "company_scope:read")));
    await expect(resolve([selected])).rejects.toMatchObject({ status: 403 });
    await accessService(db).setPrincipalPermission(f.home, "agent", f.presence.id, "company_scope:read", true, f.userId);
    await db.update(companyMemberships).set({ status: "disabled" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await expect(resolve([selected])).rejects.toMatchObject({ status: 403 });
  });
});
