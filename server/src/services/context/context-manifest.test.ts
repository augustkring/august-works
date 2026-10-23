import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  authUsers,
  companies,
  companyMemberships,
  contextManifestItems,
  contextManifests,
  createDb,
  heartbeatRuns,
  issues, memoryBindings, memoryRecords, contextManifestMemoryRoots,
} from "@paperclipai/db";
import type { ContextAuthorityDecision, EvidenceItem, NativePayloadSourceSnapshot } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import {
  contextManifestService,
  hashContextPolicySnapshot,
  hashEvidenceContent,
} from "./context-manifest.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("Context Manifest service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-context-manifest-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(contextManifestItems);
    await db.delete(contextManifests);
    await db.delete(heartbeatRuns);
    await db.delete(memoryRecords);
    await db.delete(memoryBindings);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companyMemberships);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent(name: string) {
    const companyId = randomUUID();
    const userId = randomUUID();
    await db.insert(authUsers).values({id:userId,name:"Current Context owner",email:`${userId}@example.test`,createdAt:new Date(),updatedAt:new Date()});
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,status:"active",membershipRole:"owner"});
    const [agent] = await db.insert(agents).values({
      companyId,
      name: `${name} Agent`,
      role: "analyst",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    return { companyId, userId, agent: agent! };
  }

  function evidence(companyId: string, excerpt: string): EvidenceItem {
    return {
      id: "foundation:strategy:0",
      companyId,
      sourceClass: "foundation",
      sourceProvider: "august_works",
      sourceType: "foundation_section",
      sourceRef: "foundation://strategy/revision-1/0",
      title: "Strategy",
      excerpt,
      sourceVersion: "revision-1",
      sourceUpdatedAt: "2026-09-28T08:00:00.000Z",
      observedAt: "2026-09-28T09:00:00.000Z",
      validFrom: null,
      validUntil: null,
      authorityDomain: "strategy",
      trustLevel: "high",
      sensitivity: "internal",
      citation: { label: "Strategy" },
      metadata: { deliberatelyNotPersisted: "raw-metadata" },
    };
  }

  function decision(item: EvidenceItem): ContextAuthorityDecision {
    return {
      evidence: item,
      authorityRank: 0,
      primaryForDomain: true,
      reason: "preferred_authority",
    };
  }

  it("persists only hashes and provenance, not raw query or evidence content", async () => {
    const seeded = await seedCompanyAndAgent("Alpha");
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId:seeded.userId,
    }).returning();
    const rawQuery = "secret customer question that must not be stored";
    const rawExcerpt = "sensitive selected evidence that must not be stored in the manifest";
    const item = evidence(seeded.companyId, rawExcerpt);

    const result = await contextManifestService(db).create({
      companyId: seeded.companyId,
      runId: run!.id,
      agentId: seeded.agent.id,
      query: rawQuery,
      policySnapshot: {
        sensitivityCeiling: "internal",
        authority: { strategy: "foundation" },
      },
      selected: [{ decision: decision(item), retrievalScore: 0.91 }],
    });

    expect(result.manifest.queryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifest.policySnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      companyId: seeded.companyId,
      sourceClass: "foundation",
      sourceProvider: "august_works",
      sourceRef: item.sourceRef,
      contentHash: hashEvidenceContent(item),
      rank: 0,
      selectionReason: "preferred_authority",
      retrievalScore: 0.91,
    });

    const persisted = JSON.stringify({ manifest: result.manifest, items: result.items });
    expect(persisted).not.toContain(rawQuery);
    expect(persisted).not.toContain(rawExcerpt);
    expect(persisted).not.toContain("raw-metadata");
  });

  it.each([false, true])("retains exact selected Task and Memory body snapshots without inventing unknown history (known=%s)", async known => {
    const seeded = await seedCompanyAndAgent("Captured sources");
    const [task] = await db.insert(issues).values({ companyId: seeded.companyId, title: "Selected Task body",
      description: "Original selected Task rendition", payloadSourceProtocolVersion: known ? 1 : 0 }).returning();
    const [binding] = await db.insert(memoryBindings).values({ companyId: seeded.companyId, key: randomUUID(),
      name: "Selected native Memory", providerKey: "local" }).returning();
    const [memory] = await db.insert(memoryRecords).values({ companyId: seeded.companyId, bindingId: binding!.id,
      providerKey: "local", memoryType: "lesson", scopeType: "company", content: "Original selected Memory rendition",
      observedAt: new Date(), createdByActorType: "user", createdByActorId: seeded.userId,
      sourceProvenanceQualified: true, payloadSourceProtocolVersion: known ? 1 : 0 }).returning();
    // Canonically bound structural fixtures, never complete producer history or
    // provider dispatch qualification. Unknown originals deliberately stay NULL.
    async function seal(kind: "issue" | "memory_record", table: "issues" | "memory_records", id: string) {
      const [hash] = await db.execute<{ hash: string }>(sql`select public.aw_native_payload_body_hash(${kind},to_jsonb(r)) as hash
        from ${sql.identifier(table)} r where r.company_id=${seeded.companyId}::uuid and r.id=${id}::uuid`);
      const content = { version: 1, owner: { kind, companyId: seeded.companyId, id, contentHash: hash!.hash },
        policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] };
      const [sealed] = await db.execute<{ snapshot: NativePayloadSourceSnapshot }>(sql`select ${JSON.stringify(content)}::jsonb ||
        jsonb_build_object('digest',encode(sha256(convert_to((${JSON.stringify(content)}::jsonb)::text,'UTF8')),'hex')) as snapshot`);
      return sealed!.snapshot;
    }
    const taskSnapshot = known ? await seal("issue", "issues", task!.id) : null;
    const memorySnapshot = known ? await seal("memory_record", "memory_records", memory!.id) : null;
    if (known) {
      await db.update(issues).set({ payloadSourceSnapshot: taskSnapshot }).where(eq(issues.id, task!.id));
      await db.update(memoryRecords).set({ payloadSourceSnapshot: memorySnapshot }).where(eq(memoryRecords.id, memory!.id));
    }
    const [run] = await db.insert(heartbeatRuns).values({ companyId: seeded.companyId, agentId: seeded.agent.id,
      responsibleUserId: seeded.userId, status: "running" }).returning();
    const selectedTask: EvidenceItem = { ...evidence(seeded.companyId, task!.description!), id: `task:${task!.id}`,
      sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${task!.id}`,
      title: task!.title, sourceVersion: task!.updatedAt.toISOString() };
    const selectedMemory: EvidenceItem = { ...evidence(seeded.companyId, memory!.content), id: `memory:${memory!.id}`,
      sourceClass: "accepted_memory", sourceProvider: "august_works_memory", sourceType: "memory_record", sourceRef: `memory://record/${memory!.id}`,
      sourceVersion: memory!.updatedAt.toISOString() };
    const result = await contextManifestService(db).create({ companyId: seeded.companyId, runId: run!.id,
      agentId: seeded.agent.id, query: "Actual selected native source bodies", policySnapshot: {},
      selected: [{ decision: decision(selectedTask) }, { decision: decision(selectedMemory) }] });
    expect(result.items.map(item => item.payloadSourceSnapshot)).toEqual([taskSnapshot, memorySnapshot]);
    const [root] = await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,result.manifest.id));
    expect(root!.payloadSourceSnapshot).toEqual(memorySnapshot);
    await db.update(issues).set({ description: "Later Task body", payloadSourceSnapshot: null }).where(eq(issues.id, task!.id));
    await db.update(memoryRecords).set({ content: "Later Memory body", payloadSourceSnapshot: null }).where(eq(memoryRecords.id, memory!.id));
    const items = await db.select().from(contextManifestItems).where(eq(contextManifestItems.manifestId, result.manifest.id));
    items.sort((a, b) => a.rank - b.rank);
    expect(items.map(item => item.payloadSourceSnapshot)).toEqual([taskSnapshot, memorySnapshot]);
    const [retained] = await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,result.manifest.id));
    expect(retained!.payloadSourceSnapshot).toEqual(memorySnapshot);
    expect(items.map(item => item.sourceVersion)).toEqual([selectedTask.sourceVersion, selectedMemory.sourceVersion]);
    expect(items.map(item => item.contentHash)).toEqual([hashEvidenceContent(selectedTask), hashEvidenceContent(selectedMemory)]);
  });

  it("hashes policy snapshots deterministically across object-key order", () => {
    expect(
      hashContextPolicySnapshot({ b: 2, a: { y: true, x: "one" } }),
    ).toBe(
      hashContextPolicySnapshot({ a: { x: "one", y: true }, b: 2 }),
    );
  });

  it("rejects cross-company evidence before any manifest row is created", async () => {
    const alpha = await seedCompanyAndAgent("Alpha");
    const beta = await seedCompanyAndAgent("Beta");

    await expect(
      contextManifestService(db).create({
        companyId: alpha.companyId,
        agentId: alpha.agent.id,
        query: "query",
        policySnapshot: {},
        selected: [{ decision: decision(evidence(beta.companyId, "Beta evidence")) }],
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(await db.select().from(contextManifests)).toHaveLength(0);
  });

  it("rejects a run that belongs to a different agent", async () => {
    const seeded = await seedCompanyAndAgent("Alpha");
    const [otherAgent] = await db.insert(agents).values({
      companyId: seeded.companyId,
      name: "Other Agent",
      role: "analyst",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: seeded.companyId,
      agentId: otherAgent!.id,
    }).returning();

    await expect(
      contextManifestService(db).create({
        companyId: seeded.companyId,
        runId: run!.id,
        agentId: seeded.agent.id,
        query: "query",
        policySnapshot: {},
        selected: [],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
