import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  authUsers,
  companies,
  companyMemberships,
  contextManifestItems,
  contextManifests,
  createDb,
  documentRevisions,
  documents,
  foundationChangeProposals,
  foundationDocuments,
  foundationSections,
  externalObjectMentions,
  externalObjects,
  issues,
  principalPermissionGrants,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { foundationService } from "../foundation/foundation-service.js";
import { contextEngineService } from "./context-engine.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

describeEmbeddedPostgres("Context Engine integration", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-context-engine-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(contextManifestItems);
    await db.delete(contextManifests);
    await db.delete(foundationChangeProposals);
    await db.delete(foundationSections);
    await db.delete(foundationDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(externalObjectMentions);
    await db.delete(externalObjects);
    await db.delete(issues);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(authUsers);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Context Co",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: userId,
    });
    const userNow = new Date();
    await db.insert(authUsers).values({
      id: userId,
      name: "Context Owner",
      email: `context-${companyId}@example.test`,
      emailVerified: true,
      createdAt: userNow,
      updatedAt: userNow,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    const [agent] = await db.insert(agents).values({
      companyId,
      name: "Context Agent",
      role: "analyst",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });
    const [issue] = await db.insert(issues).values({
      companyId,
      title: "Prepare enterprise strategy recommendation",
      description: "Recommend how to position the enterprise launch.",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent!.id,
      responsibleUserId: userId,
    }).returning();
    return { companyId, userId, agent: agent!, issue: issue! };
  }

  async function createApprovedFoundation(input: {
    companyId: string;
    userId: string;
    key: string;
    body: string;
    sensitivity: "internal" | "confidential";
  }) {
    const svc = foundationService(db);
    const draft = await svc.createDraft(
      input.companyId,
      {
        foundationKey: input.key,
        category: "strategy",
        documentType: "strategy",
        title: input.key,
        body: input.body,
        sensitivity: input.sensitivity,
      },
      { principal: { type: "user", userId: input.userId } },
    );
    const submitted = await svc.submitForReview(
      input.companyId,
      draft.id,
      draft.latestRevisionId!,
      { principal: { type: "user", userId: input.userId } },
    );
    return svc.approve(
      input.companyId,
      draft.id,
      submitted.latestRevisionId!,
      { principal: { type: "user", userId: input.userId } },
    );
  }

  it("assembles authorized approved Foundation and task context into a durable manifest", async () => {
    const seeded = await seed();
    await db.insert(principalPermissionGrants).values({
      companyId: seeded.companyId,
      principalType: "agent",
      principalId: seeded.agent.id,
      permissionKey: "foundation:read",
      scope: null,
    });
    await createApprovedFoundation({
      companyId: seeded.companyId,
      userId: seeded.userId,
      key: "enterprise-strategy",
      body: "# Enterprise strategy\nEnterprise strategy prioritizes durable customer value.",
      sensitivity: "internal",
    });
    await createApprovedFoundation({
      companyId: seeded.companyId,
      userId: seeded.userId,
      key: "confidential-strategy",
      body: "# Confidential strategy\nEnterprise strategy acquisition target is confidential.",
      sensitivity: "confidential",
    });

    const result = await contextEngineService(db).assemble({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: seeded.issue.id,
      query: "enterprise strategy",
      sensitivityCeiling: "internal",
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.taskContext).toHaveLength(1);
    expect(result.packet.foundation).toEqual([
      expect.objectContaining({
        sourceClass: "foundation",
        sensitivity: "internal",
        excerpt: expect.stringContaining("durable customer value"),
      }),
    ]);
    expect(result.markdown).toContain("## August Works governed context");
    expect(result.markdown).toContain("Approved Foundation");
    expect(result.markdown).not.toContain("acquisition target");
    expect(result.packet.manifest?.id).toBeTruthy();

    const persisted = await db.select().from(contextManifests);
    const items = await db.select().from(contextManifestItems);
    expect(persisted).toHaveLength(1);
    expect(items.some((item) => item.sourceClass === "foundation")).toBe(true);
    expect(items.some((item) => item.sourceClass === "task")).toBe(true);
    expect(JSON.stringify({ persisted, items })).not.toContain("durable customer value");
  });

  it("retrieves only issue-authorized synced GitHub evidence into the governed Context packet", async () => {
    const seeded = await seed();
    const now = new Date("2026-09-29T12:01:00.000Z");

    const [linked] = await db.insert(externalObjects).values({
      companyId: seeded.companyId,
      providerKey: "github",
      objectType: "issue",
      externalId: "augustkring/august-works#issues/42",
      sanitizedCanonicalUrl:
        "https://github.com/augustkring/august-works/issues/42",
      displayKey: "GitHub Issue",
      displayTitle: "augustkring/august-works#42: Critical billing bug",
      statusKey: "open",
      statusLabel: "Open",
      statusCategory: "open",
      statusTone: "info",
      liveness: "fresh",
      isTerminal: false,
      data: {
        state: "open",
        authorLogin: "maintainer",
      },
      remoteVersion: "2026-09-29T12:00:00.000Z",
      etag: "\"issue-42\"",
      lastResolvedAt: now,
      lastChangedAt: new Date("2026-09-29T12:00:00.000Z"),
      nextRefreshAt: new Date("2026-09-29T12:06:00.000Z"),
      updatedAt: now,
    }).returning();

    await db.insert(externalObjectMentions).values({
      companyId: seeded.companyId,
      sourceIssueId: seeded.issue.id,
      sourceKind: "description",
      sourceRecordId: null,
      documentKey: null,
      propertyKey: null,
      matchedTextRedacted:
        "https://github.com/augustkring/august-works/issues/42",
      sanitizedDisplayUrl:
        "https://github.com/augustkring/august-works/issues/42",
      canonicalIdentityHash: "linked-github-42",
      canonicalIdentity: {
        scheme: "https",
        host: "github.com",
        path: "/augustkring/august-works/issues/42",
      },
      objectId: linked!.id,
      providerKey: "github",
      detectorKey: "github",
      objectType: "issue",
      confidence: "exact",
    });

    const [otherIssue] = await db.insert(issues).values({
      companyId: seeded.companyId,
      title: "Unrelated issue",
      description: "A separate task.",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
    }).returning();
    const [unrelated] = await db.insert(externalObjects).values({
      companyId: seeded.companyId,
      providerKey: "github",
      objectType: "issue",
      externalId: "augustkring/august-works#issues/99",
      sanitizedCanonicalUrl:
        "https://github.com/augustkring/august-works/issues/99",
      displayKey: "GitHub Issue",
      displayTitle: "augustkring/august-works#99: Critical billing bug unrelated",
      statusKey: "open",
      statusLabel: "Open",
      statusCategory: "open",
      statusTone: "info",
      liveness: "fresh",
      isTerminal: false,
      data: { state: "open" },
      remoteVersion: "2026-09-29T12:00:00.000Z",
      etag: "\"issue-99\"",
      lastResolvedAt: now,
      lastChangedAt: now,
      nextRefreshAt: new Date("2026-09-29T12:06:00.000Z"),
      updatedAt: now,
    }).returning();
    await db.insert(externalObjectMentions).values({
      companyId: seeded.companyId,
      sourceIssueId: otherIssue!.id,
      sourceKind: "description",
      sourceRecordId: null,
      documentKey: null,
      propertyKey: null,
      matchedTextRedacted:
        "https://github.com/augustkring/august-works/issues/99",
      sanitizedDisplayUrl:
        "https://github.com/augustkring/august-works/issues/99",
      canonicalIdentityHash: "unrelated-github-99",
      canonicalIdentity: {
        scheme: "https",
        host: "github.com",
        path: "/augustkring/august-works/issues/99",
      },
      objectId: unrelated!.id,
      providerKey: "github",
      detectorKey: "github",
      objectType: "issue",
      confidence: "exact",
    });

    const result = await contextEngineService(db).assemble({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: seeded.issue.id,
      query: "critical billing bug",
      includeFoundation: false,
      sensitivityCeiling: "internal",
      asOf: new Date("2026-09-29T12:02:00.000Z"),
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.connectedEvidence).toEqual([
      expect.objectContaining({
        sourceClass: "external_untrusted",
        sourceProvider: "github",
        sourceType: "github_issue",
        sourceRef:
          "https://github.com/augustkring/august-works/issues/42",
        title: "augustkring/august-works#42: Critical billing bug",
        sourceVersion: "2026-09-29T12:00:00.000Z",
        trustLevel: "untrusted",
        metadata: expect.objectContaining({
          syncMode: "synced",
          tombstone: false,
          freshness: "fresh",
          aclFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    ]);
    expect(JSON.stringify(result.packet.connectedEvidence)).not.toContain(
      "issues/99",
    );

    const manifestItems = await db
      .select()
      .from(contextManifestItems);
    expect(manifestItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceClass: "external_untrusted",
          sourceProvider: "github",
          sourceRef:
            "https://github.com/augustkring/august-works/issues/42",
        }),
      ]),
    );
    expect(JSON.stringify(manifestItems)).not.toContain("Critical billing bug");
  });

  it("omits Foundation without foundation:read but still admits authorized task context", async () => {
    const seeded = await seed();
    await createApprovedFoundation({
      companyId: seeded.companyId,
      userId: seeded.userId,
      key: "enterprise-strategy",
      body: "# Enterprise strategy\nEnterprise strategy prioritizes durable customer value.",
      sensitivity: "internal",
    });

    const result = await contextEngineService(db).assemble({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: seeded.issue.id,
      query: "enterprise strategy",
      sensitivityCeiling: "internal",
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.foundation).toEqual([]);
    expect(result.packet.taskContext).toHaveLength(1);
    expect(result.packet.warnings).toEqual([
      expect.objectContaining({
        providerKey: "foundation",
        code: "permission_denied",
      }),
    ]);
    expect(result.markdown).not.toContain("durable customer value");
  });
});
