import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { adaptivePlanningProposals, analyticalLineageEdges, analyticalLineageManifests, issues, projects, type Db } from "@paperclipai/db";
import { crossProjectPlanningProfileSchema, planningProblemSchema, proposeCrossProjectPlanningSchema, reviewCrossProjectPlanningSchema, v7FeatureEnabled, v8FeatureEnabled, type CrossProjectPlanningContext, type CrossProjectPlanningProfile } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";
import { inspectAnalyticalEvidenceAuthority, type AnalyticalEvidenceEdge } from "../analytical-evidence.js";
import { signDecisionSpec, verifyDecisionSpec } from "../decision-signing.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { withV5ActivityTransaction } from "../v5-mutations.js";
import { logActivity } from "../activity-log.js";
import { projectControlService } from "../project-control.js";
import { capturePlanningProject } from "./project-owner.js";
import { nativePlanningProvider } from "./provider.js";

type Proposal = typeof adaptivePlanningProposals.$inferSelect;
const DAY = 86400000, EDGE_LIMIT = 20065;
function budget(deadline: number) { if (performance.now() > deadline) throw unprocessable("Cross-project planning source budget exceeded"); }
async function admit(tx: Db, companyId: string, actor: AuthorizationActor, write = false, content = true) {
  v7HumanActorId(actor); await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
  const flags = await instanceSettingsService(tx).getExperimental();
  if (content && (!v8FeatureEnabled(flags, "planning_optimizer_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7"))) throw notFound("Governed cross-project planning is not enabled");
  await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
  await tx.execute(sql`set local statement_timeout='8s'`);
}
function math(profile: CrossProjectPlanningProfile, snapshots: CrossProjectPlanningContext["sourceSnapshots"]) {
  return planningProblemSchema.parse({ horizon: profile.horizon, pools: profile.pools, policy: profile.policy, dependencies: snapshots.flatMap(snapshot => snapshot.dependencies), tasks: profile.tasks.map(({ expectedUpdatedAt: _version, rationale: _rationale, ...task }) => task) });
}
function sourceHash(profile: CrossProjectPlanningProfile, snapshots: CrossProjectPlanningContext["sourceSnapshots"], evidence: CrossProjectPlanningContext["evidence"], edges: AnalyticalEvidenceEdge[]) {
  return nativeSha256({ profile, snapshots, lineageHash: nativeSha256(edges), evidence: evidence.map(({ key, source, sourceHash }) => ({ key, source, sourceHash })) });
}
async function capture(tx: Db, companyId: string, actor: AuthorizationActor, profile: CrossProjectPlanningProfile, versions: boolean) {
  const deadline = performance.now() + 30000, now = new Date(), selected = new Set(profile.tasks.map(task => task.key));
  const population = await tx.select({ id: issues.id, projectId: issues.projectId }).from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, [...selected]))).orderBy(asc(issues.id));
  if (population.length !== selected.size || population.some(task => !profile.projects.some(project => project.id === task.projectId))) throw conflict("Every selected Task must belong to one selected native project");
  const snapshots: CrossProjectPlanningContext["sourceSnapshots"] = [], edges = new Map<string, AnalyticalEvidenceEdge>();
  let evidence: CrossProjectPlanningContext["evidence"] = [], expiresAt = new Date(now.getTime() + profile.retentionDays * DAY);
  for (const project of [...profile.projects].sort((a, b) => a.id.localeCompare(b.id))) {
    budget(deadline);
    const [locked] = await tx.select({ id: projects.id, updatedAt: projects.updatedAt }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, project.id))).for("update");
    if (!locked) throw notFound("Selected planning project is unavailable");
    if (versions && locked.updatedAt.toISOString() !== project.expectedUpdatedAt) throw conflict("Selected project changed; inspect a fresh joint plan");
    const keys = new Set(population.filter(task => task.projectId === project.id).map(task => task.id));
    if (!keys.size) throw conflict("Each selected project must contribute its complete active Task population");
    const { projects: _projects, ...originalProfile } = profile;
    const source = await capturePlanningProject(tx, companyId, project.id, actor, { ...originalProfile, tasks: profile.tasks.filter(task => keys.has(task.key)), evidence: snapshots.length ? [] : profile.evidence }, versions, selected);
    snapshots.push(source.sourceSnapshot); if (snapshots.length === 1) evidence = source.evidence;
    expiresAt = new Date(Math.min(expiresAt.getTime(), source.expiresAt.getTime()));
    for (const edge of source.edges) { const key = `${edge.inputType}:${edge.inputRef}`, prior = edges.get(key); if (prior && prior.inputHash !== edge.inputHash) throw conflict("Joint planning Source pins disagree"); edges.set(key, edge); }
  }
  if (edges.size > EDGE_LIMIT) throw unprocessable("Joint planning Source lineage exceeds its bounded budget");
  budget(deadline); if (expiresAt <= new Date()) throw conflict("Joint planning Source expired during capture");
  const lineage = [...edges.values()].sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  return { snapshots, evidence, edges: lineage, expiresAt, now, snapshotHash: sourceHash(profile, snapshots, evidence, lineage) };
}
function proof(row: Pick<Proposal, "id" | "companyId" | "contextHash" | "reason" | "createdByUserId" | "createdAt">, edges: AnalyticalEvidenceEdge[], expiresAt: Date) {
  return { domain: "aw-cross-project-planning:v1", id: row.id, companyId: row.companyId, contextHash: row.contextHash, reasonHash: nativeSha256(row.reason), author: row.createdByUserId, createdAt: row.createdAt.toISOString(), expiresAt: expiresAt.toISOString(), lineageHash: nativeSha256(edges) };
}
async function root(tx: Db, companyId: string, id: string) {
  const [row] = await tx.select().from(adaptivePlanningProposals).where(and(eq(adaptivePlanningProposals.companyId, companyId), eq(adaptivePlanningProposals.id, id))).for("update");
  if (!row) throw notFound("Cross-project planning proposal is unavailable"); return row;
}
async function retained(tx: Db, actor: AuthorizationActor, row: Proposal) {
  if (nativeSha256(row.context) !== row.contextHash || !crossProjectPlanningProfileSchema.safeParse(row.context.profile).success) throw notFound("Joint planning original material is unavailable");
  const [manifest] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, row.companyId), eq(analyticalLineageManifests.id, row.manifestId))).for("share");
  const edges = (await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, row.companyId), eq(analyticalLineageEdges.manifestId, row.manifestId))).limit(EDGE_LIMIT + 1)).map(({ inputType, inputRef, inputHash, relationship }) => ({ inputType, inputRef, inputHash, relationship })).sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  if (!manifest || manifest.expiresAt <= new Date() || manifest.analysisType !== "cross_project_planning_proposal" || manifest.analysisRef !== row.id || manifest.engineVersion !== "aw-native-cross-project-planning-v1" || manifest.createdAt.getTime() !== row.createdAt.getTime() || manifest.definitionHash !== row.contextHash || manifest.inputHash !== row.context.snapshotHash || manifest.expiresAt.toISOString() !== row.context.expiresAt || manifest.sourceCount !== edges.length || edges.length > EDGE_LIMIT || !verifyDecisionSpec(proof(row, edges, manifest.expiresAt), String(manifest.parameters.signature))) throw notFound("Joint planning signed Source receipt is unavailable");
  await currentAnalyticalPurpose(tx, row.companyId, row.context.profile, "planning");
  await inspectAnalyticalEvidenceAuthority(tx, row.companyId, actor, edges, performance.now() + 30000);
  if (sourceHash(row.context.profile, row.context.sourceSnapshots, row.context.evidence, edges) !== row.context.snapshotHash || (await nativePlanningProvider.solve(math(row.context.profile, row.context.sourceSnapshots))).result.resultHash !== row.context.result.resultHash) throw notFound("Joint planning original kernel replay is unavailable");
  return manifest;
}
export function crossProjectPlanningService(db: Db) {
  return {
    async preview(companyId: string, actor: AuthorizationActor, raw: unknown) {
      const profile = crossProjectPlanningProfileSchema.parse(raw);
      return db.transaction(async rawTx => { const tx = rawTx as unknown as Db; await admit(tx, companyId, actor); if (Date.parse(`${profile.horizon.start}T00:00:00Z`) < Math.floor(Date.now() / DAY) * DAY) throw conflict("A prospective joint horizon cannot begin in the past"); const source = await capture(tx, companyId, actor, profile, true), solved = await nativePlanningProvider.solve(math(profile, source.snapshots)); return { snapshotHash: source.snapshotHash, result: solved.result, runtimeMs: solved.runtimeMs, expiresAt: source.expiresAt.toISOString(), authority: "human_cross_project_roadmap_review_required" as const }; });
    },
    async propose(companyId: string, actor: AuthorizationActor, raw: unknown) {
      const input = proposeCrossProjectPlanningSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); if (Date.parse(`${input.profile.horizon.start}T00:00:00Z`) < Math.floor(Date.now() / DAY) * DAY) throw conflict("A prospective joint horizon cannot begin in the past");
        const source = await capture(tx, companyId, actor, input.profile, true), solved = await nativePlanningProvider.solve(math(input.profile, source.snapshots));
        if (source.snapshotHash !== input.expectedSnapshotHash || solved.result.status !== "feasible_best_known") throw conflict("An exact freshly reviewed feasible joint plan is required");
        const context: CrossProjectPlanningContext = { profile: input.profile, sourceSnapshots: source.snapshots, evidence: source.evidence, snapshotHash: source.snapshotHash, result: solved.result, capturedAt: source.now.toISOString(), expiresAt: source.expiresAt.toISOString(), authority: "human_cross_project_roadmap_review_required" };
        const material = { id: randomUUID(), companyId, contextHash: nativeSha256(context), reason: input.reason, createdByUserId: v7HumanActorId(actor), createdAt: source.now }, manifestId = randomUUID();
        await tx.insert(analyticalLineageManifests).values({ id: manifestId, companyId, analysisType: "cross_project_planning_proposal", analysisRef: material.id, engineVersion: "aw-native-cross-project-planning-v1", inputHash: source.snapshotHash, definitionHash: material.contextHash, requestedBy: material.createdByUserId, sourceWatermark: source.now.toISOString(), sourceCount: source.edges.length, parameters: { signature: signDecisionSpec(proof(material, source.edges, source.expiresAt)) }, createdAt: source.now, expiresAt: source.expiresAt });
        for (let offset = 0; offset < source.edges.length; offset += 500) await tx.insert(analyticalLineageEdges).values(source.edges.slice(offset, offset + 500).map(edge => ({ ...edge, companyId, manifestId })));
        const [row] = await tx.insert(adaptivePlanningProposals).values({ ...material, proposalType: "change_schedule", context, manifestId, updatedAt: source.now }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: material.createdByUserId, action: "adaptive_planning.proposed", entityType: "adaptive_planning_proposal", entityId: row.id, details: { contextHash: material.contextHash } }, publications);
        return row;
      });
    },
    async controls(companyId: string, actor: AuthorizationActor, cursor?: string) {
      return db.transaction(async rawTx => { const tx = rawTx as unknown as Db; await admit(tx, companyId, actor, false, false); const rows = await tx.select({ id: adaptivePlanningProposals.id, status: adaptivePlanningProposals.status, revision: adaptivePlanningProposals.revision }).from(adaptivePlanningProposals).where(and(eq(adaptivePlanningProposals.companyId, companyId), cursor ? sql`${adaptivePlanningProposals.id}>${cursor}::uuid` : undefined)).orderBy(asc(adaptivePlanningProposals.id)).limit(21); return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null, coverage: "bounded_native_joint_proposal_metadata" as const }; });
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async rawTx => { const tx = rawTx as unknown as Db; await admit(tx, companyId, actor); const row = await root(tx, companyId, id); await retained(tx, actor, row); const current = ["proposed", "under_review"].includes(row.status) ? await capture(tx, companyId, actor, row.context.profile, false) : null; return { ...row, currentQualification: current?.snapshotHash === row.context.snapshotHash ? "current" as const : "needs_revalidation" as const }; });
    },
    async review(companyId: string, actor: AuthorizationActor, id: string, raw: unknown) {
      const input = reviewCrossProjectPlanningSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true, input.action === "accept" || input.action === "begin_review"); const row = await root(tx, companyId, id);
        if (row.revision !== input.expectedRevision || !["proposed", "under_review"].includes(row.status)) throw conflict("The current uncompleted joint proposal is required");
        for (const project of row.context.profile.projects) await assertV7Authorization(tx, actor, companyId, "tasks:assign", { type: "project", companyId, projectId: project.id });
        const refs: Proposal["appliedRoadmapRefs"] = []; let status: Proposal["status"];
        if (input.action === "accept" || input.action === "begin_review") {
          const manifest = await retained(tx, actor, row), current = await capture(tx, companyId, actor, row.context.profile, true);
          if (current.snapshotHash !== row.context.snapshotHash || manifest.expiresAt <= new Date()) throw conflict("Joint planning Sources or constraints changed; propose a fresh joint plan");
          if (input.action === "begin_review") { if (row.status !== "proposed") throw conflict("Joint review has already begun"); status = "under_review"; }
          else {
            if (row.status !== "under_review") throw conflict("Begin a separate Human review before applying the joint plan");
            const owner = projectControlService(tx), start = Date.parse(`${row.context.profile.horizon.start}T00:00:00Z`);
            for (const snapshot of row.context.sourceSnapshots) {
              const keys = new Set(snapshot.tasks.map(task => task.id)), versions = new Map(snapshot.tasks.map(task => [task.id, task.updatedAt]));
              const proposal = await owner.propose(actor, companyId, snapshot.projectId, { expectedProjectUpdatedAt: snapshot.projectUpdatedAt, changes: row.context.result.schedule.filter(item => keys.has(item.taskKey)).map(item => ({ issueId: item.taskKey, expectedUpdatedAt: versions.get(item.taskKey)!, patch: { plannedStartAt: new Date(start + item.startDay * DAY).toISOString(), plannedEndAt: new Date(start + item.endDay * DAY).toISOString() } })), reason: row.reason, evidence: [`cross_project_planning:${row.id}:${row.contextHash}`] }, publications);
              const applied = await owner.review(actor, companyId, snapshot.projectId, proposal.id, true, input.rationale, publications);
              if (applied.status !== "accepted") throw conflict("The original Roadmap owner refused part of the joint plan"); refs.push({ projectId: snapshot.projectId, proposalId: proposal.id });
            }
            if (manifest.expiresAt <= new Date()) throw conflict("Joint planning Source expired before canonical application completed"); status = "accepted";
          }
        } else status = input.action === "reject" ? "rejected" : "cancelled";
        const [updated] = await tx.update(adaptivePlanningProposals).set({ status, revision: row.revision + 1, reviewedByUserId: v7HumanActorId(actor), reviewRationale: input.rationale, appliedRoadmapRefs: refs, updatedAt: new Date() }).where(eq(adaptivePlanningProposals.id, row.id)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: `adaptive_planning.${status}`, entityType: "adaptive_planning_proposal", entityId: id, details: { revision: updated.revision } }, publications);
        return { id, companyId, status, revision: updated.revision, appliedRoadmapRefs: refs };
      });
    },
  };
}
