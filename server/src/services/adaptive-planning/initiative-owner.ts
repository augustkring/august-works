import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { adaptivePlanningProposals, analyticalLineageEdges, analyticalLineageManifests, projects, type Db } from "@paperclipai/db";
import { planningProblemSchema, portfolioPlanningProfileSchema, proposeInitiativePlanningSchema, reviewCrossProjectPlanningSchema, type CrossProjectPlanningContext, type InitiativePlanningContext } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, notFound } from "../../errors.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { inspectAnalyticalEvidenceAuthority, type AnalyticalEvidenceEdge } from "../analytical-evidence.js";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";
import { signDecisionSpec, verifyDecisionSpec } from "../decision-signing.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { withV5ActivityTransaction } from "../v5-mutations.js";
import { logActivity } from "../activity-log.js";
import { projectService } from "../projects.js";
import { admitCrossProjectPlanning } from "./cross-project.js";
import { capturePortfolioPlanning } from "./portfolio.js";
import { nativePlanningProvider } from "./provider.js";
import { solveNativePortfolioPlanning } from "./portfolio-kernel.js";

type Proposal = typeof adaptivePlanningProposals.$inferSelect;
type InitiativeProposal = Proposal & { initiativeContext: InitiativePlanningContext };
const EDGE_LIMIT = 20385;
function contextHash(context: CrossProjectPlanningContext, initiativeContext: InitiativePlanningContext) { return nativeSha256({ context, initiativeContext }); }
function prospective(context: InitiativePlanningContext) { if (Date.parse(`${context.profile.horizon.start}T00:00:00Z`) < Math.floor(Date.now() / 86400000) * 86400000) throw conflict("Refresh the prospective initiative horizon before review"); }
function proof(row: Pick<Proposal, "id" | "companyId" | "contextHash" | "reason" | "createdByUserId" | "createdAt">, edges: AnalyticalEvidenceEdge[], expiresAt: Date) {
  return { domain: "aw-initiative-planning:v1", id: row.id, companyId: row.companyId, contextHash: row.contextHash, reasonHash: nativeSha256(row.reason), author: row.createdByUserId, createdAt: row.createdAt.toISOString(), expiresAt: expiresAt.toISOString(), lineageHash: nativeSha256(edges) };
}
async function root(tx: Db, companyId: string, id: string): Promise<InitiativeProposal> {
  const [row] = await tx.select().from(adaptivePlanningProposals).where(and(eq(adaptivePlanningProposals.companyId, companyId), eq(adaptivePlanningProposals.id, id), eq(adaptivePlanningProposals.proposalType, "prioritize_initiatives"))).for("update");
  if (!row?.initiativeContext) throw notFound("Native initiative proposal is unavailable"); return { ...row, initiativeContext: row.initiativeContext };
}
async function retained(tx: Db, actor: AuthorizationActor, row: InitiativeProposal) {
  const context = row.initiativeContext;
  if (contextHash(row.context, context) !== row.contextHash || !portfolioPlanningProfileSchema.safeParse(context.profile).success) throw notFound("Original initiative material is unavailable");
  const [manifest] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, row.companyId), eq(analyticalLineageManifests.id, row.manifestId))).for("share");
  const edges = (await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, row.companyId), eq(analyticalLineageEdges.manifestId, row.manifestId))).limit(EDGE_LIMIT + 1)).map(({ inputType, inputRef, inputHash, relationship }) => ({ inputType, inputRef, inputHash, relationship })).sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  if (!manifest || manifest.expiresAt <= new Date() || manifest.analysisType !== "initiative_planning_proposal" || manifest.analysisRef !== row.id || manifest.engineVersion !== "aw-native-initiative-planning-v1" || manifest.definitionHash !== row.contextHash || manifest.inputHash !== context.snapshotHash || manifest.createdAt.getTime() !== row.createdAt.getTime() || manifest.requestedBy !== row.createdByUserId || manifest.expiresAt.toISOString() !== context.expiresAt || manifest.sourceCount !== edges.length || edges.length > EDGE_LIMIT || !verifyDecisionSpec(proof(row, edges, manifest.expiresAt), String(manifest.parameters.signature))) throw notFound("Signed initiative Source receipt is unavailable");
  await currentAnalyticalPurpose(tx, row.companyId, context.profile, "planning");
  await inspectAnalyticalEvidenceAuthority(tx, row.companyId, actor, edges, performance.now() + 30000);
  const fullProblem = planningProblemSchema.parse({ horizon: row.context.profile.horizon, pools: row.context.profile.pools, policy: row.context.profile.policy, tasks: row.context.profile.tasks.map(({ expectedUpdatedAt: _version, rationale: _rationale, ...task }) => task), dependencies: row.context.sourceSnapshots.flatMap(snapshot => snapshot.dependencies) });
  if ((await nativePlanningProvider.solve(fullProblem)).result.resultHash !== row.context.result.resultHash) throw notFound("Original complete joint constraint replay is unavailable");
  if (nativeSha256({ profile: context.profile, jointSnapshotHash: context.jointSnapshotHash, sources: context.currentSources, sourcePins: context.sourcePins }) !== context.snapshotHash || (await solveNativePortfolioPlanning(context.profile, context.currentSources, row.context.sourceSnapshots.flatMap(snapshot => snapshot.dependencies))).resultHash !== context.result.resultHash) throw notFound("Original initiative Source and kernel replay is unavailable");
  return manifest;
}

/** Proposal identity shares the existing cross-project table; canonical project
 * lifecycle mutations remain with the original project service after review. */
export function initiativePlanningService(db: Db) {
  return {
    async propose(companyId: string, actor: AuthorizationActor, raw: unknown) {
      const input = proposeInitiativePlanningSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await admitCrossProjectPlanning(tx, companyId, actor, true);
        const capture = await capturePortfolioPlanning(tx, companyId, actor, input.profile);
        if (capture.snapshotHash !== input.expectedSnapshotHash || capture.result.candidates.every(candidate => candidate.disposition === "investigate")) throw conflict("An exact freshly inspected actionable initiative preview is required");
        const { initiatives: _initiatives, initiativePolicy: _policy, ...profile } = input.profile;
        const full = await nativePlanningProvider.solve(planningProblemSchema.parse({ horizon: profile.horizon, pools: profile.pools, policy: profile.policy, tasks: profile.tasks.map(({ expectedUpdatedAt: _version, rationale: _rationale, ...task }) => task), dependencies: capture.joint.snapshots.flatMap(snapshot => snapshot.dependencies) }));
        const context: CrossProjectPlanningContext = { profile, sourceSnapshots: capture.joint.snapshots, evidence: capture.joint.evidence, snapshotHash: capture.joint.snapshotHash, result: full.result, capturedAt: capture.joint.now.toISOString(), expiresAt: capture.joint.expiresAt.toISOString(), authority: "human_cross_project_roadmap_review_required" };
        const initiativeContext: InitiativePlanningContext = { profile: input.profile, currentSources: capture.sources, sourcePins: capture.sourcePins, jointSnapshotHash: capture.joint.snapshotHash, snapshotHash: capture.snapshotHash, result: capture.result, capturedAt: context.capturedAt, expiresAt: context.expiresAt, authority: "human_initiative_review_required" };
        prospective(initiativeContext);
        const edges = [...new Map([...capture.joint.edges, ...capture.sourcePins.goalIds.map(inputRef => ({ inputType: "goal" as const, inputRef, inputHash: nativeSha256({ type: "goal", id: inputRef }), relationship: "source" as const }))].map(edge => [`${edge.inputType}:${edge.inputRef}`, edge])).values()].sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
        const material = { id: randomUUID(), companyId, contextHash: contextHash(context, initiativeContext), reason: input.reason, createdByUserId: v7HumanActorId(actor), createdAt: capture.joint.now }, manifestId = randomUUID();
        await tx.insert(analyticalLineageManifests).values({ id: manifestId, companyId, analysisType: "initiative_planning_proposal", analysisRef: material.id, engineVersion: "aw-native-initiative-planning-v1", inputHash: capture.snapshotHash, definitionHash: material.contextHash, requestedBy: material.createdByUserId, sourceWatermark: context.capturedAt, sourceCount: edges.length, parameters: { signature: signDecisionSpec(proof(material, edges, capture.joint.expiresAt)) }, createdAt: material.createdAt, expiresAt: capture.joint.expiresAt });
        for (let offset = 0; offset < edges.length; offset += 500) await tx.insert(analyticalLineageEdges).values(edges.slice(offset, offset + 500).map(edge => ({ ...edge, companyId, manifestId })));
        const [row] = await tx.insert(adaptivePlanningProposals).values({ ...material, proposalType: "prioritize_initiatives", context, initiativeContext, manifestId, updatedAt: material.createdAt }).returning();
        if (capture.joint.expiresAt <= new Date()) throw conflict("Initiative Source expired before publication");
        await logActivity(tx, { companyId, actorType: "user", actorId: material.createdByUserId, action: "initiative_planning.proposed", entityType: "adaptive_planning_proposal", entityId: row.id, details: { contextHash: material.contextHash } }, publications);
        return row;
      });
    },
    async controls(companyId: string, actor: AuthorizationActor, cursor?: string) {
      return db.transaction(async rawTx => { const tx = rawTx as unknown as Db; await admitCrossProjectPlanning(tx, companyId, actor, false, false); const rows = await tx.select({ id: adaptivePlanningProposals.id, status: adaptivePlanningProposals.status, revision: adaptivePlanningProposals.revision }).from(adaptivePlanningProposals).where(and(eq(adaptivePlanningProposals.companyId, companyId), eq(adaptivePlanningProposals.proposalType, "prioritize_initiatives"), cursor ? sql`${adaptivePlanningProposals.id}>${cursor}::uuid` : undefined)).orderBy(asc(adaptivePlanningProposals.id)).limit(21); return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null, coverage: "bounded_native_initiative_proposal_metadata" as const }; });
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async rawTx => { const tx = rawTx as unknown as Db; await admitCrossProjectPlanning(tx, companyId, actor); const row = await root(tx, companyId, id); await retained(tx, actor, row); const current = ["proposed", "under_review"].includes(row.status) ? await capturePortfolioPlanning(tx, companyId, actor, row.initiativeContext.profile, false) : null; return { ...row, currentQualification: current?.snapshotHash === row.initiativeContext.snapshotHash ? "current" as const : "needs_revalidation" as const }; });
    },
    async review(companyId: string, actor: AuthorizationActor, id: string, raw: unknown) {
      const input = reviewCrossProjectPlanningSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await admitCrossProjectPlanning(tx, companyId, actor, true, ["begin_review", "accept"].includes(input.action)); const row = await root(tx, companyId, id);
        if (row.revision !== input.expectedRevision || !["proposed", "under_review"].includes(row.status)) throw conflict("The exact current uncompleted initiative proposal is required");
        for (const project of row.context.profile.projects) await assertV7Authorization(tx, actor, companyId, "tasks:assign", { type: "project", companyId, projectId: project.id });
        const refs: Proposal["appliedProjectRefs"] = []; let status: Proposal["status"];
        if (["begin_review", "accept"].includes(input.action)) {
          const manifest = await retained(tx, actor, row); prospective(row.initiativeContext);
          const current = await capturePortfolioPlanning(tx, companyId, actor, row.initiativeContext.profile);
          if (current.snapshotHash !== row.initiativeContext.snapshotHash) throw conflict("Initiative Sources, Goals, budgets or assumptions changed; create a fresh proposal");
          if (input.action === "begin_review") { if (row.status !== "proposed") throw conflict("Initiative review has already begun"); status = "under_review"; }
          else {
            if (row.status !== "under_review") throw conflict("Begin a separate Human initiative review before application");
            const owner = projectService(tx);
            for (const candidate of row.initiativeContext.result.candidates) {
              if (candidate.disposition === "investigate") continue;
              const patch = candidate.disposition === "start" ? { status: "in_progress" } : candidate.disposition === "pause" ? { pauseReason: "manual", pausedAt: new Date() } : candidate.disposition === "stop" ? { status: "cancelled", pauseReason: "manual", pausedAt: new Date() } : null;
              const applied = patch ? await owner.update(candidate.projectId, patch) : (await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, candidate.projectId))))[0];
              if (!applied || applied.companyId !== companyId) throw conflict("The original project owner refused an initiative change");
              refs.push({ projectId: applied.id, disposition: candidate.disposition, status: applied.status, paused: applied.pausedAt !== null, updatedAt: applied.updatedAt.toISOString() });
              if (patch) await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "project.updated", entityType: "project", entityId: applied.id, details: { changedKeys: Object.keys(patch), initiativeProposalId: row.id, contextHash: row.contextHash, disposition: candidate.disposition, status: applied.status } }, publications);
            }
            if (manifest.expiresAt <= new Date()) throw conflict("Initiative Source expired before canonical application completed"); status = "accepted";
          }
        } else status = input.action === "reject" ? "rejected" : "cancelled";
        const [updated] = await tx.update(adaptivePlanningProposals).set({ status, revision: row.revision + 1, reviewedByUserId: v7HumanActorId(actor), reviewRationale: input.rationale, appliedProjectRefs: refs, updatedAt: new Date() }).where(eq(adaptivePlanningProposals.id, id)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: `initiative_planning.${status}`, entityType: "adaptive_planning_proposal", entityId: id, details: { revision: updated.revision } }, publications);
        return { id, companyId, status, revision: updated.revision, appliedProjectRefs: refs };
      });
    },
  };
}
