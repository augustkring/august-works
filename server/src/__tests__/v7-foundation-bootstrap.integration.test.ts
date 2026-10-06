import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentIdentities, agents, companies, companyMemberships, createDb, foundationDocuments, heartbeatRuns, issues, principalPermissionGrants } from "@paperclipai/db";
import { bootstrapCandidateSchema, type BootstrapCandidate } from "@paperclipai/shared";
import { foundationBootstrapService, validateBootstrapCandidate } from "../services/foundation/foundation-bootstrap.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 Foundation discovery on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, agentId: string;
  const owner = { type: "board" as const, source: "local_implicit" as const };
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v7-bootstrap-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableContextEngineV1: true, readiness_engine_v7: true, foundation_bootstrap_v7: true });
  });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Discovery fixture", issuePrefix: `D${companyId.slice(0, 7)}` });
    const [identity] = await db.insert(agentIdentities).values({ name: "Researcher", homeCompanyId: companyId }).returning();
    await db.insert(agents).values({ id: agentId, companyId, agentIdentityId: identity!.id, name: "Researcher" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read", "foundation:propose"].map((permissionKey) => ({ companyId, principalType: "agent", principalId: agentId, permissionKey })));
  });
  const request = () => ({ agentId, query: "Prepare a customer research assistant", idempotencyKey: "discovery-fixture" });
  function candidate(runId?: string): BootstrapCandidate {
    return bootstrapCandidateSchema.parse({ foundationKey: "company.mission", category: "company", title: "Initial company facts", proposedContent: "Company profile is Discovery fixture. Customer mission remains unknown.",
      claims: [{ statement: "The company is named Discovery fixture", sourceRefs: [`company://${companyId}/profile`] }], uncertainties: ["Customer mission is not yet verified"], conflicts: [], materialQuestions: runId ? [{ key: "company.mission", question: "What is the customer outcome?", required: true }] : [] });
  }
  it("creates one canonical Task under concurrent idempotent starts and rejects key reuse", async () => {
    const svc = foundationBootstrapService(db);
    const runs = await Promise.all([svc.start(owner, companyId, request()), svc.start(owner, companyId, request())]);
    expect(runs[0]!.id).toBe(runs[1]!.id);
    expect(await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.originKind, "v7_foundation_bootstrap")))).toHaveLength(1);
    await expect(svc.start(owner, companyId, { ...request(), query: "A different goal" })).rejects.toMatchObject({ status: 409 });
  });
  it("creates evidence-linked drafts with separate canonical approval and replay-safe publication", async () => {
    const svc = foundationBootstrapService(db), run = await svc.start(owner, companyId, request());
    const submitted = await svc.submit(owner, companyId, run.id, { expectedVersion: 1, candidates: [candidate()] });
    expect(submitted.status).toBe("ready_for_review");
    const finished = await svc.createProposals(owner, companyId, run.id, submitted.version);
    expect(finished.status).toBe("proposals_created");
    expect((await svc.createProposals(owner, companyId, run.id, submitted.version)).id).toBe(run.id);
    const documents = await db.select().from(foundationDocuments).where(eq(foundationDocuments.companyId, companyId));
    expect(documents).toHaveLength(1); expect(documents[0]!.status).toBe("draft"); expect(documents[0]!.approvedRevisionId).toBeNull();
    expect((await svc.get(owner, companyId, run.id)).candidates[0]!.foundationDocumentId).toBe(documents[0]!.id);
  });
  it("requires answers before draft publication and makes stale versions fail", async () => {
    const svc = foundationBootstrapService(db), run = await svc.start(owner, companyId, request());
    const submitted = await svc.submit(owner, companyId, run.id, { expectedVersion: 1, candidates: [candidate(run.id)] });
    expect(submitted.status).toBe("needs_answers");
    await expect(svc.createProposals(owner, companyId, run.id, submitted.version)).rejects.toMatchObject({ status: 409 });
    const answered = await svc.answer(owner, companyId, run.id, { expectedVersion: submitted.version, questionKey: "company.mission", answer: "Help researchers find verified customer evidence" });
    await expect(svc.answer(owner, companyId, run.id, { expectedVersion: submitted.version, questionKey: "company.mission", answer: "Stale" })).rejects.toMatchObject({ status: 409 });
    const evidence = await svc.sources(owner, companyId, run.id);
    expect(evidence.evidence.some((item) => item.sourceRef === `bootstrap://${run.id}/answers/company.mission`)).toBe(true);
    expect(answered.status).toBe("awaiting_candidates");
  });
  it("rejects fabricated citations, changed evidence and cross-company access", async () => {
    const svc = foundationBootstrapService(db), run = await svc.start(owner, companyId, request());
    await expect(svc.submit(owner, companyId, run.id, { expectedVersion: 1, candidates: [{ ...candidate(), claims: [{ statement: "Invented", sourceRefs: ["fake://source"] }] }] })).rejects.toMatchObject({ status: 409 });
    await svc.submit(owner, companyId, run.id, { expectedVersion: 1, candidates: [candidate()] });
    await db.update(companies).set({ description: "Changed profile", updatedAt: new Date() }).where(eq(companies.id, companyId));
    const view = await svc.get(owner, companyId, run.id);
    expect(view.candidates).toHaveLength(0); expect(view.withheldCandidateCount).toBe(1);
    await expect(svc.createProposals(owner, companyId, run.id, 2)).rejects.toMatchObject({ status: 409 });
    await expect(svc.get(owner, randomUUID(), run.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.get({ type: "agent", source: "agent_key", companyId, agentId: randomUUID() }, companyId, run.id)).rejects.toMatchObject({ status: 403 });
  });
  it("fences agent candidate writes to the current live checked-out worker attempt", async () => {
    const svc = foundationBootstrapService(db), run = await svc.start(owner, companyId, request());
    const actor = { type: "agent" as const, source: "agent_key" as const, companyId, agentId, runId: randomUUID() };
    await db.insert(heartbeatRuns).values({ id: actor.runId, companyId, agentId, status: "running", contextSnapshot: { issueId: run.taskId } });
    await expect(svc.submit(actor, companyId, run.id, { expectedVersion: 1, candidates: [candidate()] })).rejects.toMatchObject({ status: 403 });
    await db.update(issues).set({ status: "in_progress", checkoutRunId: actor.runId, executionRunId: actor.runId }).where(eq(issues.id, run.taskId));
    await db.update(heartbeatRuns).set({ resultJson: { executionCancellation: { state: "requested" } } }).where(eq(heartbeatRuns.id, actor.runId));
    await expect(svc.submit(actor, companyId, run.id, { expectedVersion: 1, candidates: [candidate()] })).rejects.toMatchObject({ status: 403 });
    await db.update(heartbeatRuns).set({ resultJson: null }).where(eq(heartbeatRuns.id, actor.runId));
    expect((await svc.submit(actor, companyId, run.id, { expectedVersion: 1, candidates: [candidate()] })).status).toBe("ready_for_review");
  });
  it("marks external assertions untrusted and cannot lower evidence sensitivity", async () => {
    const source = { sourceRef: `company://${companyId}/profile`, sourceVersion: null, contentHash: "a".repeat(64), sourceClass: "external_untrusted" as const, sensitivity: "internal" as const, sourceUpdatedAt: null, publicationScope: "review_required" as const, authorityDomain: null, trustLevel: "untrusted" as const };
    expect(validateBootstrapCandidate(candidate(), [source]).candidate.uncertainties).toContain("External source claims require independent review before canonical approval.");
    expect(() => validateBootstrapCandidate({ ...candidate(), sensitivity: "public" }, [source])).toThrow("cannot reduce source sensitivity");
  });
});
