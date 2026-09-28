import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  documentRevisions,
  documents,
  foundationChangeProposals,
  foundationDocuments,
  foundationSections,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { foundationIndexService } from "../services/foundation/foundation-index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("Foundation service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-foundation-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(foundationChangeProposals);
    await db.delete(foundationSections);
    await db.delete(foundationDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name: string) {
    const id = randomUUID();
    const userId = `user-${id}`;
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `F${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: userId,
    });
    await db.insert(companyMemberships).values({
      companyId: id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    return { id, userId };
  }

  function actor(userId: string) {
    return { principal: { type: "user" as const, userId } };
  }

  async function createCompanyProfile(companyId: string, userId: string) {
    return foundationService(db).createDraft(
      companyId,
      {
        foundationKey: "company-profile",
        category: "company",
        documentType: "company_profile",
        title: "Company profile",
        body: "# Company\nInitial truth",
        authorityLevel: "canonical",
        sensitivity: "internal",
        reviewFrequencyDays: 30,
      },
      actor(userId),
    );
  }

  it("creates a tenant-scoped draft backed by documents and revisions", async () => {
    const company = await seedCompany("Alpha");
    const created = await createCompanyProfile(company.id, company.userId);

    expect(created).toMatchObject({
      companyId: company.id,
      foundationKey: "company-profile",
      status: "draft",
      latestRevisionNumber: 1,
      approvedRevisionId: null,
      canonicalRevision: null,
    });
    expect(created.latestRevisionId).toBeTruthy();

    const [document] = await db.select().from(documents);
    const [revision] = await db.select().from(documentRevisions);
    expect(document).toMatchObject({
      id: created.documentId,
      companyId: company.id,
      latestRevisionId: created.latestRevisionId,
      latestBody: "# Company\nInitial truth",
    });
    expect(revision).toMatchObject({
      documentId: created.documentId,
      revisionNumber: 1,
      body: "# Company\nInitial truth",
    });
  });

  it("enforces company boundaries on reads and mutations", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    const created = await createCompanyProfile(alpha.id, alpha.userId);
    const svc = foundationService(db);

    await expect(svc.get(beta.id, created.id)).resolves.toBeNull();
    await expect(
      svc.updateDraft(
        beta.id,
        created.id,
        {
          baseRevisionId: created.latestRevisionId!,
          body: "Cross-company write",
        },
        actor(beta.userId),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects duplicate Foundation keys within a company but permits the same key in another company", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    await createCompanyProfile(alpha.id, alpha.userId);

    await expect(createCompanyProfile(alpha.id, alpha.userId)).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "foundation_key_conflict" }),
    });
    await expect(createCompanyProfile(beta.id, beta.userId)).resolves.toMatchObject({
      companyId: beta.id,
      foundationKey: "company-profile",
    });
  });

  it("preserves the approved revision while a new draft is edited", async () => {
    const company = await seedCompany("Alpha");
    const svc = foundationService(db);
    const draft = await createCompanyProfile(company.id, company.userId);
    const inReview = await svc.submitForReview(
      company.id,
      draft.id,
      draft.latestRevisionId!,
      actor(company.userId),
    );
    const approved = await svc.approve(
      company.id,
      draft.id,
      inReview.latestRevisionId!,
      actor(company.userId),
    );

    expect(approved).toMatchObject({
      status: "approved",
      approvedRevisionId: approved.latestRevisionId,
    });
    expect(approved.canonicalRevision?.body).toBe("# Company\nInitial truth");

    const nextDraft = await svc.updateDraft(
      company.id,
      approved.id,
      {
        baseRevisionId: approved.latestRevisionId!,
        body: "# Company\nUnapproved changed truth",
        sensitivity: "restricted",
        validFrom: "2026-10-01T00:00:00.000Z",
        changeSummary: "Draft update",
      },
      actor(company.userId),
    );

    expect(nextDraft.status).toBe("draft");
    expect(nextDraft.body).toBe("# Company\nUnapproved changed truth");
    expect(nextDraft.latestRevisionNumber).toBe(2);
    expect(nextDraft.approvedRevisionId).toBe(approved.approvedRevisionId);
    expect(nextDraft.canonicalRevision?.body).toBe("# Company\nInitial truth");
    expect(nextDraft.sensitivity).toBe("restricted");
    expect(nextDraft.canonicalGovernance?.sensitivity).toBe("internal");

    const [storedDraft] = await db
      .select()
      .from(foundationDocuments)
      .where(eq(foundationDocuments.id, nextDraft.id));
    expect(storedDraft?.sensitivity).toBe("internal");
    expect(storedDraft?.draftMetadata).toMatchObject({
      sensitivity: "restricted",
      validFrom: "2026-10-01T00:00:00.000Z",
    });

    const reviewedDraft = await svc.submitForReview(
      company.id,
      nextDraft.id,
      nextDraft.latestRevisionId!,
      actor(company.userId),
    );
    const reapproved = await svc.approve(
      company.id,
      nextDraft.id,
      reviewedDraft.latestRevisionId!,
      actor(company.userId),
    );
    expect(reapproved.canonicalRevision?.body).toBe("# Company\nUnapproved changed truth");
    expect(reapproved.canonicalGovernance?.sensitivity).toBe("restricted");
    expect(reapproved.canonicalGovernance?.validFrom?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("rejects invalid lifecycle transitions and stale revision writes", async () => {
    const company = await seedCompany("Alpha");
    const svc = foundationService(db);
    const draft = await createCompanyProfile(company.id, company.userId);

    await expect(
      svc.approve(company.id, draft.id, draft.latestRevisionId!, actor(company.userId)),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "foundation_invalid_transition" }),
    });

    const updated = await svc.updateDraft(
      company.id,
      draft.id,
      {
        baseRevisionId: draft.latestRevisionId!,
        body: "Version 2",
      },
      actor(company.userId),
    );

    await expect(
      svc.updateDraft(
        company.id,
        draft.id,
        {
          baseRevisionId: draft.latestRevisionId!,
          body: "Stale overwrite",
        },
        actor(company.userId),
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({
        code: "revision_conflict",
        currentRevisionId: updated.latestRevisionId,
      }),
    });
  });

  it("enforces lifecycle values at the database boundary", async () => {
    const company = await seedCompany("Alpha");
    const created = await createCompanyProfile(company.id, company.userId);

    await expect(
      db
        .update(foundationDocuments)
        .set({ status: "not-a-real-state" })
        .where(
          // Deliberately direct DB mutation: this verifies the durable constraint,
          // independent of TypeScript and service validation.
          eq(foundationDocuments.id, created.id),
        ),
    ).rejects.toBeTruthy();
  });

  it("rejects cross-company owner references", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");

    await expect(
      foundationService(db).createDraft(
        alpha.id,
        {
          foundationKey: "strategy",
          category: "strategy",
          documentType: "strategy",
          body: "Strategy",
          ownerUserId: beta.userId,
        },
        actor(alpha.userId),
      ),
    ).rejects.toMatchObject({
      status: 422,
      message: "Foundation owner user must have an active company membership",
    });
  });

  it("creates proposals against the current revision without activating them as company truth", async () => {
    const company = await seedCompany("Alpha");
    const svc = foundationService(db);
    const draft = await createCompanyProfile(company.id, company.userId);
    const proposal = await svc.createProposal(
      company.id,
      draft.id,
      {
        sourceType: "agent_run",
        proposedBody: "Candidate truth",
        reason: "Observed new information",
      },
      actor(company.userId),
    );

    expect(proposal).toMatchObject({
      companyId: company.id,
      foundationDocumentId: draft.id,
      baseRevisionId: draft.latestRevisionId,
      status: "pending",
      proposedBody: "Candidate truth",
    });
    const unchanged = await svc.get(company.id, draft.id);
    expect(unchanged?.body).toBe("# Company\nInitial truth");
    expect(unchanged?.canonicalRevision).toBeNull();
  });
  it("accepts a current proposal into a new draft revision without changing approved truth", async () => {
    const company = await seedCompany("Alpha");
    const svc = foundationService(db);
    const draft = await createCompanyProfile(company.id, company.userId);
    const inReview = await svc.submitForReview(company.id, draft.id, draft.latestRevisionId!, actor(company.userId));
    const approved = await svc.approve(company.id, draft.id, inReview.latestRevisionId!, actor(company.userId));
    const proposal = await svc.createProposal(
      company.id,
      approved.id,
      { sourceType: "agent_run", proposedBody: "# Company\nNext truth" },
      actor(company.userId),
    );

    const accepted = await svc.acceptProposal(company.id, approved.id, proposal.id, actor(company.userId));
    expect(accepted.proposal.status).toBe("accepted");
    expect(accepted.foundation).toMatchObject({
      status: "draft",
      body: "# Company\nNext truth",
      latestRevisionNumber: 2,
      approvedRevisionId: approved.approvedRevisionId,
    });
    expect(accepted.foundation.canonicalRevision?.body).toBe("# Company\nInitial truth");
  });

  it("marks stale proposals superseded and preserves the current draft", async () => {
    const company = await seedCompany("Alpha");
    const svc = foundationService(db);
    const draft = await createCompanyProfile(company.id, company.userId);
    const proposal = await svc.createProposal(
      company.id,
      draft.id,
      { sourceType: "agent_run", proposedBody: "Stale proposal" },
      actor(company.userId),
    );
    const current = await svc.updateDraft(
      company.id,
      draft.id,
      { baseRevisionId: draft.latestRevisionId!, body: "Current draft" },
      actor(company.userId),
    );

    await expect(
      svc.acceptProposal(company.id, draft.id, proposal.id, actor(company.userId)),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "revision_conflict", currentRevisionId: current.latestRevisionId }),
    });

    const [storedProposal] = await db
      .select()
      .from(foundationChangeProposals)
      .where(eq(foundationChangeProposals.id, proposal.id));
    expect(storedProposal?.status).toBe("superseded");

  it("keeps section hashes stable across revisions and searches approved truth only", async () => {
    const company = await seedCompany("Alpha");
    const svc = foundationService(db);
    const index = foundationIndexService(db);
    const draft = await svc.createDraft(
      company.id,
      {
        foundationKey: "strategy",
        category: "strategy",
        documentType: "strategy",
        body: "# Direction\nStable intro\n\n## Priority\nOld priority",
      },
      actor(company.userId),
    );

    const revisionOneSections = await db
      .select()
      .from(foundationSections)
      .where(eq(foundationSections.documentRevisionId, draft.latestRevisionId!))
      .orderBy(foundationSections.ordinal);
    expect(revisionOneSections).toHaveLength(2);

    const updated = await svc.updateDraft(
      company.id,
      draft.id,
      {
        baseRevisionId: draft.latestRevisionId!,
        body: "# Direction\nStable intro\n\n## Priority\nNew priority",
      },
      actor(company.userId),
    );
    const revisionTwoSections = await db
      .select()
      .from(foundationSections)
      .where(eq(foundationSections.documentRevisionId, updated.latestRevisionId!))
      .orderBy(foundationSections.ordinal);

    expect(revisionTwoSections).toHaveLength(2);
    expect(revisionTwoSections[0]?.contentHash).toBe(revisionOneSections[0]?.contentHash);
    expect(revisionTwoSections[1]?.contentHash).not.toBe(revisionOneSections[1]?.contentHash);

    expect(await index.search(company.id, {
      query: "New priority",
      limit: 10,
      scope: "approved",
    })).toEqual([]);

    const submitted = await svc.submitForReview(
      company.id,
      updated.id,
      updated.latestRevisionId!,
      actor(company.userId),
    );
    await svc.approve(
      company.id,
      updated.id,
      submitted.latestRevisionId!,
      actor(company.userId),
    );

    const approvedSearch = await index.search(company.id, {
      query: "New priority",
      limit: 10,
      scope: "approved",
    });
    expect(approvedSearch).toHaveLength(1);
    expect(approvedSearch[0]).toMatchObject({
      foundationDocumentId: draft.id,
      headingPath: ["Direction", "Priority"],
      documentRevisionId: updated.latestRevisionId,
    });

    const nextDraft = await svc.updateDraft(
      company.id,
      updated.id,
      {
        baseRevisionId: updated.latestRevisionId!,
        body: "# Direction\nStable intro\n\n## Priority\nUnapproved future priority",
      },
      actor(company.userId),
    );
    expect(nextDraft.status).toBe("draft");

    expect(await index.search(company.id, {
      query: "Unapproved future priority",
      limit: 10,
      scope: "approved",
    })).toEqual([]);
    expect(await index.search(company.id, {
      query: "New priority",
      limit: 10,
      scope: "approved",
    })).toHaveLength(1);
  });
    expect((await svc.get(company.id, draft.id))?.body).toBe("Current draft");
  });

});
