import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, companyMemberships, companySkills, companySkillVersions, portfolioCapabilityPublications, projects, issues } from "@paperclipai/db";
import { createPlaybookSchema, publishPortfolioCapabilitySchema, installPortfolioCapabilitySchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { organizationService } from "../services/organization.js";
import { playbookService } from "../services/playbooks.js";
import { portfolioCapabilityService } from "../services/portfolio-capabilities.js";
import { portfolioService } from "../services/portfolio.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 explicit portfolio releases and company views", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-portfolio-"); db = createDb(database.connectionString); await enableV5ForTest(db); });
  afterAll(async () => { await database?.cleanup(); });
  async function related() { const f = await seedV5Presences(db), org = organizationService(db); const proposal = await org.proposeRelationship(f.actor, f.home, { targetCompanyId: f.guest, relationshipType: "portfolio_company" }); await org.transitionRelationship(f.actor, f.guest, proposal.id, "accept"); return { ...f, relationshipId: proposal.id }; }
  it("a relationship alone reveals no sources; a frozen release becomes a local unapproved draft", async () => {
    const f = await related(), playbooks = playbookService(db), sharing = portfolioCapabilityService(db);
    const source = await playbooks.create(f.actor, f.home, createPlaybookSchema.parse({ key: "reviewed-release", title: "Release procedure", markdown: "Reviewed organizational procedure" })), detail = await playbooks.get(f.actor, f.home, source.id);
    await playbooks.review(f.actor, f.home, source.id, { expectedRevisionId: detail.document.latestRevisionId!, decision: "approve", rationale: "Operator reviewed the procedure" });
    expect(await sharing.discover(f.actor, f.guest)).toEqual([]);
    const release = await sharing.publish(f.actor, f.home, publishPortfolioCapabilitySchema.parse({ assetType: "playbook", assetId: source.id, versionId: detail.document.latestRevisionId, recipientCompanyIds: [f.guest], releaseNotes: "Reviewed release for portfolio adoption" }));
    await expect(db.update(portfolioCapabilityPublications).set({ snapshot: { ...release.snapshot, markdown: "Rewrite released bytes" } }).where(eq(portfolioCapabilityPublications.id, release.id))).rejects.toThrow();
    const installed = await sharing.install(f.actor, f.guest, installPortfolioCapabilitySchema.parse({ publicationId: release.id, localKey: "local-release", mode: "subscribe" }));
    const local = await playbooks.get(f.actor, f.guest, installed.localPlaybookId!);
    expect(local).toMatchObject({ status: "draft", approvedRevisionId: null }); expect(local.document.latestBody).toBe("Reviewed organizational procedure");
    await organizationService(db).transitionRelationship(f.actor, f.home, f.relationshipId, "revoke");
    expect(await sharing.discover(f.actor, f.guest)).toEqual([]);
    expect((await sharing.subscriptions(f.actor, f.guest))[0]!.sourceAvailable).toBe(false);
    await expect(sharing.install(f.actor, f.guest, installPortfolioCapabilitySchema.parse({ publicationId: release.id, localKey: "second-copy", mode: "fork" }))).rejects.toMatchObject({ status: 404 });
  });
  it("copies the complete immutable Skill file inventory without automatically activating it", async () => {
    const f = await related(), sharing = portfolioCapabilityService(db);
    const [skill] = await db.insert(companySkills).values({ companyId: f.home, key: `company/${f.home}/published`, slug: "published", name: "Published", markdown: "Reviewed Skill", sourceType: "url", sharingScope: "company", compatibility: "compatible" }).returning();
    const [version] = await db.insert(companySkillVersions).values({ companyId: f.home, companySkillId: skill!.id, revisionNumber: 1, state: "active", fileInventory: [{ path: "SKILL.md", kind: "skill", content: "Reviewed Skill" }, { path: "scripts/check.sh", kind: "script", content: "exit 0" }] }).returning();
    await db.update(companySkills).set({ lifecycleState: "active", activeVersionId: version!.id, currentVersionId: version!.id }).where(eq(companySkills.id, skill!.id));
    const release = await sharing.publish(f.actor, f.home, publishPortfolioCapabilitySchema.parse({ assetType: "skill", assetId: skill!.id, versionId: version!.id, recipientCompanyIds: [f.guest], releaseNotes: "Pinned procedure and its supporting script" }));
    const installed = await sharing.install(f.actor, f.guest, installPortfolioCapabilitySchema.parse({ publicationId: release.id, localKey: "adopted", mode: "fork" }));
    const [local] = await db.select().from(companySkills).where(eq(companySkills.id, installed.localSkillId!)), [candidate] = await db.select().from(companySkillVersions).where(eq(companySkillVersions.companySkillId, local!.id));
    expect(local).toMatchObject({ lifecycleState: "proposed", activeVersionId: null }); expect(candidate!.fileInventory).toEqual(expect.arrayContaining(version!.fileInventory));
    expect(candidate!.validationSummary?.portfolioSource).toMatchObject({ id: release.id, companyId: f.home, versionId: version!.id });
    await sharing.withdraw(f.actor, f.home, release.id); expect(await sharing.discover(f.actor, f.guest)).toEqual([]);
    await expect(db.update(portfolioCapabilityPublications).set({ status: "published" }).where(eq(portfolioCapabilityPublications.id, release.id))).rejects.toThrow();
  });
  it("reads each company's canonical sources and removes a company after current membership is revoked", async () => {
    const f = await seedV5Presences(db), service = portfolioService(db);
    const [project] = await db.insert(projects).values({ companyId: f.home, name: "Canonical launch" }).returning();
    const [task] = await db.insert(issues).values({ companyId: f.home, projectId: project!.id, title: "Assigned to the operator", assigneeUserId: f.userId }).returning();
    const before = await service.summary(f.actor, { companyIds: [f.home, f.guest] });
    expect(before.companies.find((c) => c.companyId === f.home)?.myTasks.map((t) => t.id)).toContain(task!.id);
    expect(before.companies.find((c) => c.companyId === f.home)?.projects.map((p) => p.id)).toContain(project!.id);
    await db.update(companyMemberships).set({ status: "revoked" }).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
    const after = await service.summary(f.actor, { companyIds: [f.home, f.guest] });
    expect(after.unavailableCompanyIds).toEqual([f.guest]); expect(after.companies.map((c) => c.companyId)).toEqual([f.home]);
  });
});
