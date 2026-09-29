import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  contextManifestItems,
  contextManifests,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import type { ContextAuthorityDecision, EvidenceItem } from "@paperclipai/shared";
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
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent(name: string) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const [agent] = await db.insert(agents).values({
      companyId,
      name: `${name} Agent`,
      role: "analyst",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    return { companyId, agent: agent! };
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
