import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, issues, issueRelations, projects, projectRoadmapProposals, type Db } from "@paperclipai/db";
import { roadmapPolicySchema, planningProblemSchema, projectPlanningProfileSchema, proposeProjectPlanningSchema, v7FeatureEnabled, v8FeatureEnabled, type ProjectPlanningContext, type ProjectPlanningProfile, type ProjectPlanningSourceSnapshot } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";
import { captureAnalyticalEvidence, inspectAnalyticalEvidenceAuthority, type AnalyticalEvidenceEdge } from "../analytical-evidence.js";
import { authorizeStrategyReference } from "../strategy-execution/references.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { signDecisionSpec, verifyDecisionSpec } from "../decision-signing.js";
import { withV5ActivityTransaction } from "../v5-mutations.js";
import { nativePlanningProvider } from "./provider.js";

type Proposal = typeof projectRoadmapProposals.$inferSelect;
const DAY = 86_400_000, EDGE_LIMIT = 20_065;
async function admit(tx: Db, companyId: string, actor: AuthorizationActor, write = false) {
  v7HumanActorId(actor);
  await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
  const flags = await instanceSettingsService(tx).getExperimental();
  if (!v8FeatureEnabled(flags, "planning_optimizer_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7")) throw notFound("Governed native adaptive planning is not enabled");
  await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
  await tx.execute(sql`set local statement_timeout='8s'`);
}
function checkTime(deadline: number) { if (performance.now() > deadline) throw unprocessable("Planning source inspection exceeded its bounded budget"); }
function mathematicalProblem(profile: ProjectPlanningProfile, snapshot: ProjectPlanningSourceSnapshot) {
  return planningProblemSchema.parse({ horizon: profile.horizon, pools: profile.pools, policy: profile.policy, dependencies: snapshot.dependencies, tasks: profile.tasks.map(({ expectedUpdatedAt: _expected, rationale: _rationale, ...task }) => task) });
}
function snapshotHash(profile: ProjectPlanningProfile, snapshot: ProjectPlanningSourceSnapshot, evidence: ProjectPlanningContext["evidence"]) {
  return nativeSha256({ profile, snapshot, evidence: evidence.map(({ key, source, sourceHash }) => ({ key, source, sourceHash })) });
}
async function capture(tx: Db, companyId: string, projectId: string, actor: AuthorizationActor, profile: ProjectPlanningProfile, checkVersions: boolean) {
  const deadline = performance.now() + 30_000, now = new Date();
  const policies = await currentAnalyticalPurpose(tx, companyId, profile, "planning");
  await authorizeStrategyReference(tx, companyId, actor, { type: "project", id: projectId }, profile.sensitivity);
  const [project] = await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, projectId))).for("share");
  if (!project || project.archivedAt) throw notFound("Planning project is unavailable");
  const roadmapPolicy = roadmapPolicySchema.parse(project.roadmapPolicy ?? {});
  if (roadmapPolicy.fieldOwnership.plannedDates !== "internal") throw conflict("Planning dates belong to the configured external source; native Roadmap changes are not admitted");
  const rows = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId), isNull(issues.hiddenAt))).orderBy(asc(issues.id)).limit(501).for("share");
  if (rows.length > 500) throw unprocessable("Project planning exceeds its bounded native source budget");
  const active = rows.filter((row) => row.harnessKind !== "conversation" && !["done", "cancelled"].includes(row.status));
  const selected = new Map(profile.tasks.map((task) => [task.key, task]));
  // A favorable subset must never masquerade as a complete project schedule.
  if (active.length !== selected.size || active.some((row) => !selected.has(row.id))) throw conflict("Planning needs the complete current active project task population");
  const edges: AnalyticalEvidenceEdge[] = [{ inputType: "project", inputRef: projectId, inputHash: nativeSha256({ type: "project", id: projectId }), relationship: "source" }];
  for (const row of active) {
    checkTime(deadline);
    const ancestry = await authorizeStrategyReference(tx, companyId, actor, { type: "issue", id: row.id }, profile.sensitivity);
    if (checkVersions && selected.get(row.id)!.expectedUpdatedAt !== row.updatedAt.toISOString()) throw conflict("Planning task changed; refresh the complete source population");
    edges.push(...ancestry.issueIds.map((id) => ({ inputType: "issue" as const, inputRef: id, inputHash: nativeSha256({ type: "issue", id }), relationship: "source" as const })));
  }
  const incoming = active.length ? await tx.select().from(issueRelations).where(and(eq(issueRelations.companyId, companyId), eq(issueRelations.type, "blocks"), inArray(issueRelations.relatedIssueId, active.map((row) => row.id)))).orderBy(asc(issueRelations.id)).limit(2001).for("share") : [];
  if (incoming.length > 2000) throw unprocessable("Planning dependencies exceed their bounded budget");
  const dependencies: ProjectPlanningSourceSnapshot["dependencies"] = [], satisfied = new Map<string, ProjectPlanningSourceSnapshot["satisfiedDependencies"][number]>();
  for (const edge of incoming) {
    if (selected.has(edge.issueId)) { dependencies.push({ before: edge.issueId, after: edge.relatedIssueId }); continue; }
    checkTime(deadline);
    const ancestry = await authorizeStrategyReference(tx, companyId, actor, { type: "issue", id: edge.issueId }, profile.sensitivity);
    const [predecessor] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, edge.issueId))).for("share");
    if (!predecessor || predecessor.status !== "done" || predecessor.harnessKind === "conversation") throw conflict("Dependency coverage is not ready for a single-project plan; resolve the predecessor or use a cross-project proposal");
    satisfied.set(predecessor.id, { id: predecessor.id, projectId: predecessor.projectId, updatedAt: predecessor.updatedAt.toISOString(), status: "done" });
    edges.push(...ancestry.issueIds.map((id) => ({ inputType: "issue" as const, inputRef: id, inputHash: nativeSha256({ type: "issue", id }), relationship: "source" as const })), ...ancestry.projectIds.map((id) => ({ inputType: "project" as const, inputRef: id, inputHash: nativeSha256({ type: "project", id }), relationship: "source" as const })));
  }
  const sourceSnapshot: ProjectPlanningSourceSnapshot = {
    projectId, projectUpdatedAt: project.updatedAt.toISOString(), roadmapPolicy,
    tasks: active.map((row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString(), status: row.status, plannedStartAt: row.plannedStartAt?.toISOString() ?? null, plannedEndAt: row.plannedEndAt?.toISOString() ?? null, estimatedEffortMinutes: row.estimatedEffortMinutes, milestoneId: row.milestoneId, assigneeAgentId: row.assigneeAgentId, assigneeUserId: row.assigneeUserId })),
    dependencies: dependencies.sort((a, b) => a.before.localeCompare(b.before) || a.after.localeCompare(b.after)), satisfiedDependencies: [...satisfied.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const inherited = await captureAnalyticalEvidence(tx, companyId, actor, profile, deadline);
  edges.push(...inherited.edges, ...policies.map((policy) => ({ inputType: "governance_obligation" as const, inputRef: policy.id, inputHash: policy.obligationHash, relationship: "policy" as const })));
  const unique = new Map<string, AnalyticalEvidenceEdge>();
  for (const edge of edges) { const key = `${edge.inputType}:${edge.inputRef}`, old = unique.get(key); if (old && old.inputHash !== edge.inputHash) throw conflict("Planning source pins disagree"); unique.set(key, edge); }
  if (unique.size > EDGE_LIMIT) throw unprocessable("Planning source lineage exceeds its bounded budget");
  const lineage = [...unique.values()].sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  await inspectAnalyticalEvidenceAuthority(tx, companyId, actor, lineage, deadline);
  const expiresAt = new Date(Math.min(now.getTime() + profile.retentionDays * DAY, inherited.expiresAt.getTime(), ...policies.map((policy) => Math.min(policy.nextReviewAt.getTime(), Date.parse(policy.obligation.nextReviewAt), policy.obligation.effectiveUntil ? Date.parse(policy.obligation.effectiveUntil) : Infinity))));
  checkTime(deadline);
  if (expiresAt <= new Date()) throw conflict("Planning source expired during admission");
  return { sourceSnapshot, evidence: inherited.evidence, edges: lineage, snapshotHash: snapshotHash(profile, sourceSnapshot, inherited.evidence), expiresAt, now };
}
function proofMaterial(proposal: Proposal, contextHash: string, edges: AnalyticalEvidenceEdge[], expiresAt: Date) {
  return { companyId: proposal.companyId, projectId: proposal.projectId, proposalId: proposal.id, contextHash, patchHash: nativeSha256(proposal.patch), reasonHash: nativeSha256(proposal.reason), author: proposal.createdByUserId, createdAt: proposal.createdAt.toISOString(), expiresAt: expiresAt.toISOString(), lineageHash: nativeSha256(edges) };
}
async function retained(tx: Db, companyId: string, projectId: string, actor: AuthorizationActor, id: string) {
  const [proposal] = await tx.select().from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.projectId, projectId), eq(projectRoadmapProposals.id, id))).for("share");
  if (!proposal?.planningContext || !proposal.planningManifestId || !proposal.planningContextHash) throw notFound("Native planning proposal is unavailable");
  const context = proposal.planningContext;
  if (nativeSha256(context) !== proposal.planningContextHash || !projectPlanningProfileSchema.safeParse(context.profile).success) throw notFound("Native planning source integrity is unavailable");
  const [manifest] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), eq(analyticalLineageManifests.id, proposal.planningManifestId))).for("share");
  if (!manifest || manifest.expiresAt <= new Date() || manifest.analysisType !== "project_planning_proposal" || manifest.analysisRef !== proposal.id || manifest.definitionHash !== proposal.planningContextHash || manifest.inputHash !== context.snapshotHash) throw notFound("Planning source is erased, expired or unavailable");
  const edges = (await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), eq(analyticalLineageEdges.manifestId, manifest.id))).limit(EDGE_LIMIT + 1)).map(({ inputType, inputRef, inputHash, relationship }) => ({ inputType, inputRef, inputHash, relationship })).sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  if (edges.length !== manifest.sourceCount || edges.length > EDGE_LIMIT || !verifyDecisionSpec({ domain: "aw-planning:project:v1", ...proofMaterial(proposal, proposal.planningContextHash, edges, manifest.expiresAt) }, String(manifest.parameters.signature))) throw notFound("Planning signed source receipt is unavailable");
  await currentAnalyticalPurpose(tx, companyId, context.profile, "planning");
  await inspectAnalyticalEvidenceAuthority(tx, companyId, actor, edges, performance.now() + 30_000);
  if (snapshotHash(context.profile, context.sourceSnapshot, context.evidence) !== context.snapshotHash || (await nativePlanningProvider.solve(mathematicalProblem(context.profile, context.sourceSnapshot))).result.resultHash !== context.result.resultHash) throw notFound("Planning original source/kernel replay is unavailable");
  return { proposal, context, manifest };
}

/** Called only inside canonical human Roadmap review, before any native changes. */
export async function inspectCurrentProjectPlanningProposal(tx: Db, actor: AuthorizationActor, companyId: string, projectId: string, id: string) {
  const [marker] = await tx.select({ planningManifestId: projectRoadmapProposals.planningManifestId }).from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.projectId, projectId), eq(projectRoadmapProposals.id, id)));
  if (!marker?.planningManifestId) return;
  await admit(tx, companyId, actor, true);
  const original = await retained(tx, companyId, projectId, actor, id), current = await capture(tx, companyId, projectId, actor, original.context.profile, true);
  if (current.snapshotHash !== original.context.snapshotHash || current.expiresAt <= new Date()) throw conflict("Planning constraints or source evidence changed; create and review a fresh proposal");
}

export function projectPlanningService(db: Db) {
  return {
    async review(companyId: string, projectId: string, actor: AuthorizationActor, id: string, accept: boolean, rationale: string) {
      v7HumanActorId(actor);
      await assertV7Authorization(db, actor, companyId, "project:read", { type: "project", companyId, projectId });
      await assertV7Authorization(db, actor, companyId, "tasks:assign", { type: "project", companyId, projectId });
      const [marker] = await db.select({ id: projectRoadmapProposals.id }).from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.projectId, projectId), eq(projectRoadmapProposals.id, id), sql`${projectRoadmapProposals.planningManifestId} is not null`));
      if (!marker) throw notFound("Native planning control is unavailable");
      const { projectControlService } = await import("../project-control.js");
      return projectControlService(db).review(actor, companyId, projectId, id, accept, rationale);
    },
    async controls(companyId: string, projectId: string, actor: AuthorizationActor, cursor?: string) {
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Db; v7HumanActorId(actor);
        await assertV7Authorization(tx, actor, companyId, "users:manage_permissions");
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        await authorizeStrategyReference(tx, companyId, actor, { type: "project", id: projectId }, "confidential");
        const rows = await tx.select({ id: projectRoadmapProposals.id, status: projectRoadmapProposals.status }).from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.projectId, projectId), sql`${projectRoadmapProposals.planningManifestId} is not null`, cursor ? sql`${projectRoadmapProposals.id}>${cursor}::uuid` : undefined)).orderBy(asc(projectRoadmapProposals.id)).limit(21);
        return { proposals: rows.slice(0, 20), hasMore: rows.length > 20, nextCursor: rows.length > 20 ? rows[19].id : null };
      });
    },
    async preview(companyId: string, projectId: string, actor: AuthorizationActor, raw: unknown) {
      const profile = projectPlanningProfileSchema.parse(raw);
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Db; await admit(tx, companyId, actor);
        if (Date.parse(`${profile.horizon.start}T00:00:00Z`) < Math.floor(Date.now() / DAY) * DAY) throw conflict("A prospective plan horizon cannot begin in the past");
        const source = await capture(tx, companyId, projectId, actor, profile, true), solved = await nativePlanningProvider.solve(mathematicalProblem(profile, source.sourceSnapshot));
        return { snapshotHash: source.snapshotHash, result: solved.result, runtimeMs: solved.runtimeMs, capturedAt: source.now.toISOString(), expiresAt: source.expiresAt.toISOString(), authority: "human_roadmap_review_required" as const };
      });
    },
    async propose(companyId: string, projectId: string, actor: AuthorizationActor, raw: unknown) {
      const input = proposeProjectPlanningSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true);
        if (Date.parse(`${input.profile.horizon.start}T00:00:00Z`) < Math.floor(Date.now() / DAY) * DAY) throw conflict("A prospective plan horizon cannot begin in the past");
        const source = await capture(tx, companyId, projectId, actor, input.profile, true), solved = await nativePlanningProvider.solve(mathematicalProblem(input.profile, source.sourceSnapshot));
        if (source.snapshotHash !== input.expectedSnapshotHash) throw conflict("Planning preview changed; inspect a fresh source snapshot before proposing");
        if (solved.result.status !== "feasible_best_known") throw conflict("Only an independently validated feasible plan can become a Roadmap change proposal");
        const { projectControlService } = await import("../project-control.js");
        const start = Date.parse(`${input.profile.horizon.start}T00:00:00Z`), versions = new Map(source.sourceSnapshot.tasks.map((task) => [task.id, task.updatedAt]));
        const proposal = await projectControlService(tx).propose(actor, companyId, projectId, { expectedProjectUpdatedAt: source.sourceSnapshot.projectUpdatedAt, changes: solved.result.schedule.map((item) => ({ issueId: item.taskKey, expectedUpdatedAt: versions.get(item.taskKey)!, patch: { plannedStartAt: new Date(start + item.startDay * DAY).toISOString(), plannedEndAt: new Date(start + item.endDay * DAY).toISOString() } })), reason: input.reason, evidence: [`native_planning_snapshot:${source.snapshotHash}`] }, publications);
        if (proposal.status !== "pending") throw conflict("Adaptive planning requires separate canonical human Roadmap review");
        const context: ProjectPlanningContext = { profile: input.profile, sourceSnapshot: source.sourceSnapshot, evidence: source.evidence, snapshotHash: source.snapshotHash, result: solved.result, runtimeMs: solved.runtimeMs, capturedAt: source.now.toISOString(), expiresAt: source.expiresAt.toISOString(), authority: "human_roadmap_review_required" };
        const contextHash = nativeSha256(context), manifestId = randomUUID(), material = proofMaterial(proposal, contextHash, source.edges, source.expiresAt);
        await tx.insert(analyticalLineageManifests).values({ id: manifestId, companyId, analysisType: "project_planning_proposal", analysisRef: proposal.id, engineVersion: "aw-native-planning-project-owner-v1", inputHash: source.snapshotHash, definitionHash: contextHash, requestedBy: v7HumanActorId(actor), sourceWatermark: source.now.toISOString(), sourceCount: source.edges.length, parameters: { signature: signDecisionSpec({ domain: "aw-planning:project:v1", ...material }) }, createdAt: sql`(select created_at from project_roadmap_proposals where company_id=${companyId} and id=${proposal.id})`, expiresAt: source.expiresAt });
        for (let offset = 0; offset < source.edges.length; offset += 500) await tx.insert(analyticalLineageEdges).values(source.edges.slice(offset, offset + 500).map((edge) => ({ ...edge, companyId, manifestId })));
        const [bound] = await tx.update(projectRoadmapProposals).set({ planningContext: context, planningContextHash: contextHash, planningManifestId: manifestId }).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.id, proposal.id))).returning();
        return { id: bound.id, companyId, projectId, status: bound.status, reason: bound.reason, context, contextHash };
      });
    },
    async detail(companyId: string, projectId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Db; await admit(tx, companyId, actor);
        const original = await retained(tx, companyId, projectId, actor, id), current = await capture(tx, companyId, projectId, actor, original.context.profile, false);
        return { id: original.proposal.id, companyId, projectId, status: original.proposal.status, reason: original.proposal.reason, context: original.context, contextHash: original.proposal.planningContextHash!, currentQualification: current.snapshotHash === original.context.snapshotHash ? "current" as const : "needs_revalidation" as const };
      });
    },
  };
}
