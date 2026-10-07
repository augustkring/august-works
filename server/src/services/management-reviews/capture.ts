import { and, eq, isNull } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, businessMetricVersions, companyMemberships, decisions, decisionOutcomeReviewReceipts, documentRevisions, foundationDocuments, foundationSections, goals, issues, learningCycles, projectMilestones, type Db } from "@paperclipai/db";
import type { CapturedManagementSource, ManagementReviewDefinition, ManagementReviewSource } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";
import { captureAnalyticalEvidence, inspectAnalyticalEvidenceAuthority, type AnalyticalEvidenceEdge } from "../analytical-evidence.js";
import { authorizeStrategyReference, validateCurrentStrategyReference } from "../strategy-execution/references.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { roadmapHealth } from "../project-health.js";
import { projectControlService } from "../project-control.js";
import { businessMetricService } from "../business-metrics/service.js";
import { businessMetricTargetService } from "../business-metrics/targets.js";
import { decisionOutcomeReviewService } from "../decision-outcome-reviews.js";
import { inspectBoundDecisionContext } from "../decision-intelligence.js";
import { learningService, learningRoots } from "../learning/learning-service.js";
import { analyticalSourceSuppressions } from "@paperclipai/db";
import { aiGovernanceService } from "../ai-governance/governance-service.js";
export interface ManagementPrimitiveLink { sourceType: "issue" | "project" | "goal" | "document" | "document_revision" | "learning_cycle"; sourceRef: string; sourceHash: string }
const DAY = 86400000, LIMIT = 20065;
const grades = { metric_observation: "native_observation", process_finding: "native_observation", forecast_run: "predictive", scenario_run: "conditional_scenario", experiment_analysis: "human_interpreted_experiment", causal_analysis: "conditional_causal" } as const;
/** Caller owns company → Memory locks and current destination admission. Capture
 * resolves every pin through its native owner; public copied facts are excluded.
 * compareCurrentVersions is private historical qualification only: creation
 * requires exact mutable owner versions, publication requires a current packet. */
export async function captureManagementSources(tx: Db, companyId: string, actor: AuthorizationActor, definition: ManagementReviewDefinition, compareCurrentVersions = false) {
  const started = new Date(), deadline = performance.now() + 30000;
  const policies = await currentAnalyticalPurpose(tx, companyId, definition, "reviews", started);
  let expiresAt = new Date(Math.min(started.getTime() + definition.retentionDays * DAY, ...policies.flatMap(policy => [policy.nextReviewAt.getTime(), Date.parse(policy.obligation.nextReviewAt), ...(policy.obligation.effectiveUntil ? [Date.parse(policy.obligation.effectiveUntil)] : [])])));
  const links = new Map<string, ManagementPrimitiveLink>(), edges = new Map<string, AnalyticalEvidenceEdge>(), dependencies = new Set<string>(), sources: CapturedManagementSource[] = [];
  function budget() { if (performance.now() > deadline || links.size > LIMIT || edges.size > LIMIT || dependencies.size > LIMIT) throw unprocessable("Management review exceeds its bounded native source budget"); }
  function edge(value: AnalyticalEvidenceEdge) { if (value.inputType === "issue" || value.inputType === "project") value = { ...value, inputHash: nativeSha256({ type: value.inputType, id: value.inputRef }) }; const key = `${value.inputType}:${value.inputRef}`, old = edges.get(key); if (old && old.inputHash !== value.inputHash) throw conflict("Management source versions disagree"); edges.set(key, value); budget(); }
  function link(sourceType: ManagementPrimitiveLink["sourceType"], sourceRef: string) { links.set(`${sourceType}:${sourceRef}`, { sourceType, sourceRef, sourceHash: nativeSha256({ type: sourceType, id: sourceRef }) }); if (sourceType === "issue" || sourceType === "project") edge({ inputType: sourceType, inputRef: sourceRef, inputHash: nativeSha256({ type: sourceType, id: sourceRef }), relationship: "source" }); budget(); }
  async function ancestry(source: Extract<ManagementReviewSource, { kind: "canonical" }>["reference"]) { const scope = await authorizeStrategyReference(tx, companyId, actor, source, definition.sensitivity); for (const id of scope.issueIds) link("issue", id); for (const id of scope.projectIds) link("project", id); return scope; }
  async function manifest(id: string) { const [row] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), eq(analyticalLineageManifests.id, id))).for("share"); if (!row || row.expiresAt <= new Date()) throw notFound("Native management source manifest is unavailable"); dependencies.add(id); expiresAt = new Date(Math.min(expiresAt.getTime(), row.expiresAt.getTime())); const values = await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), eq(analyticalLineageEdges.manifestId, id))).limit(LIMIT + 1); if (values.length !== row.sourceCount || values.length > LIMIT) throw notFound("Native management source manifest is incomplete"); for (const value of values) edge({ inputType: value.inputType, inputRef: value.inputRef, inputHash: value.inputHash, relationship: value.relationship }); budget(); }
  for (const policy of policies) edge({ inputType: "governance_obligation", inputRef: policy.id, inputHash: policy.obligationHash, relationship: "policy" });
  for (const item of definition.agenda) { if (item.ownerUserId === "local-board" && actor.type === "board" && actor.source === "local_implicit") continue; const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, item.ownerUserId), eq(companyMemberships.status, "active"))).for("share"); if (!member) throw conflict("Every management agenda owner must be a current company human"); }
  const analytical = definition.sources.filter(item => item.source.kind === "analytical");
  if (analytical.length) {
    const captured = await captureAnalyticalEvidence(tx, companyId, actor, { sensitivity: definition.sensitivity, retentionDays: definition.retentionDays, evidence: analytical.map(item => ({ key: item.key, source: (item.source as Extract<ManagementReviewSource, { kind: "analytical" }>).reference })) }, deadline);
    for (const value of captured.edges) edge(value); for (const id of captured.manifestIds) { dependencies.add(id); budget(); } expiresAt = new Date(Math.min(expiresAt.getTime(), captured.expiresAt.getTime()));
    for (const evidence of captured.evidence) { const source = definition.sources.find(item => item.key === evidence.key)!.source as Extract<ManagementReviewSource, { kind: "analytical" }>; sources.push({ key: evidence.key, source, sourceHash: evidence.sourceHash, capturedAt: evidence.capturedAt, expiresAt: evidence.expiresAt, grade: grades[source.reference.type], facts: evidence.facts, limitations: evidence.limitations, analytical: evidence }); }
  }
  for (const item of definition.sources) {
    budget(); const source = item.source; if (source.kind === "analytical") continue;
    let facts: CapturedManagementSource["facts"], material: unknown, grade: CapturedManagementSource["grade"] = "native_current_state", outcome: CapturedManagementSource["outcome"], governance: CapturedManagementSource["governance"];
    const limitations = ["Native state observed at capture; the requested period does not reconstruct historical state."];
    if (source.kind === "canonical") {
      const ref = source.reference; await ancestry(ref); await validateCurrentStrategyReference(tx, companyId, actor, ref);
      if (ref.type === "project") {
        const roadmap = await projectControlService(tx).get(actor, companyId, ref.id);
        for (const task of roadmap.tasks) await ancestry({ type: "issue", id: task.id });
        const health = roadmapHealth(roadmap.tasks, new Date(), { dependencies: roadmap.dependencies, milestones: roadmap.milestones, waitingApprovalTaskIds: roadmap.health.metrics?.waitingApprovalTaskIds ?? undefined });
        material = { projectUpdatedAt: roadmap.projectUpdatedAt, tasks: roadmap.tasks, milestones: roadmap.milestones, dependencies: roadmap.dependencies, policy: roadmap.policy, health: { status: health.status, facts: health.facts, metrics: health.metrics } };
        facts = { projectName: roadmap.projectName, health: health.status, authorizedTaskCount: roadmap.tasks.length, unscheduledTasks: roadmap.tasks.filter(task => !task.plannedStartAt || !task.plannedEndAt).length, completedTasks: roadmap.tasks.filter(task => task.status === "done").length, blockedTasks: roadmap.tasks.filter(task => task.status === "blocked").length, milestoneCount: roadmap.milestones.length, ...Object.fromEntries(health.facts.slice(0, 16).map((fact, index) => [`healthFact${index + 1}`, fact])) };
        const actuals = roadmap.tasks.filter(task => task.status === "done" && task.plannedEndAt && task.completedAt);
        Object.assign(facts, { completedTasksWithKnownPlanAndActual: actuals.length, completedTasksAfterCommittedEnd: actuals.filter(task => Date.parse(task.completedAt!) > Date.parse(task.plannedEndAt!)).length, overdueOpenTasks: health.metrics?.overdueTaskIds.length ?? null, forecastSlipTasks: health.metrics?.forecastSlipTaskIds.length ?? null, waitingApprovalTasks: health.metrics?.waitingApprovalTaskIds?.length ?? null, milestonesWithKnownActualVariance: health.metrics?.milestoneVariance.filter(item => item.basis === "actual" && item.days !== null).length ?? null, milestonesWithConditionalForecastVariance: health.metrics?.milestoneVariance.filter(item => item.basis === "forecast" && item.days !== null).length ?? null });
        limitations.push("Plan/actual counts include only completed authorized Tasks with both dates. Forecast slips and conditional milestone forecasts remain separate from actual completion.");
        limitations.push("Counts describe the current actor's authorized Roadmap task view, not an unrestricted company population.");
      } else if (ref.type === "issue") {
        const [row] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, ref.id), isNull(issues.hiddenAt))).for("share"); if (!row || row.harnessKind === "conversation") throw notFound("Native management task source is unavailable"); material = row;
        facts = { title: row.title, status: row.status, plannedStartAt: row.plannedStartAt?.toISOString() ?? null, plannedEndAt: row.plannedEndAt?.toISOString() ?? null, startedAt: row.startedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null };
      } else if (ref.type === "goal") {
        const [row] = await tx.select().from(goals).where(and(eq(goals.companyId, companyId), eq(goals.id, ref.id))).for("share"); if (!row) throw notFound("Native management goal source is unavailable"); link("goal", row.id); material = row; facts = { title: row.title, status: row.status, level: row.level };
      } else if (ref.type === "milestone") {
        const [row] = await tx.select().from(projectMilestones).where(and(eq(projectMilestones.companyId, companyId), eq(projectMilestones.projectId, ref.projectId), eq(projectMilestones.id, ref.id))).for("share"); if (!row) throw notFound("Native management milestone source is unavailable"); material = row; facts = { name: row.name, status: row.status, targetDate: row.targetDate, plannedEndAt: row.plannedEndAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null };
        const planned = row.plannedEndAt?.getTime() ?? (row.targetDate ? Date.parse(`${row.targetDate}T23:59:59.999Z`) : null); facts.actualVarianceDays = planned !== null && row.completedAt ? Math.ceil((row.completedAt.getTime() - planned) / DAY) : null; facts.varianceBasis = facts.actualVarianceDays === null ? "unknown" : "actual";
      } else if (ref.type === "foundation_section") {
        const [root] = await tx.select().from(foundationDocuments).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, ref.foundationDocumentId))).for("share");
        const [section] = await tx.select().from(foundationSections).where(and(eq(foundationSections.companyId, companyId), eq(foundationSections.id, ref.sectionId), eq(foundationSections.documentRevisionId, ref.approvedRevisionId))).for("share");
        const [revision] = await tx.select().from(documentRevisions).where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.id, ref.approvedRevisionId))).for("share");
        if (!root || !section || !revision || !root.nextReviewAt) throw notFound("Native management strategy source is unavailable"); link("document", root.documentId); link("document_revision", revision.id); expiresAt = new Date(Math.min(expiresAt.getTime(), root.nextReviewAt.getTime(), root.validUntil?.getTime() ?? Infinity)); material = { reference: ref, approvedAt: root.updatedAt, section }; facts = { heading: ref.headingPath.join(" / "), content: section.body, authority: "approved_native_foundation_section" };
      } else if (ref.type === "decision") {
        const [row] = await tx.select().from(decisions).where(and(eq(decisions.companyId, companyId), eq(decisions.id, ref.id))).for("share"); if (!row) throw notFound("Native management decision source is unavailable"); material = row; facts = { title: row.title, status: row.status, decidedAt: row.decidedAt?.toISOString() ?? null, chosenOptionId: row.chosenOptionId, expiresAt: row.expiresAt.toISOString() }; limitations.push("A canonical choice is not proof of a measured outcome or causal effect.");
      } else if (ref.type === "metric_target") {
        const value = await businessMetricTargetService(tx).inspectApprovedCommitment(companyId, actor, ref.id, ref.versionId), d = value.version.definition; material = { target: value.target, version: value.version }; if (d.scope.type === "goal") link("goal", d.scope.goalId); if (d.scope.type === "project") link("project", d.scope.projectId); edge({ inputType: "metric_version", inputRef: d.metricVersionId, inputHash: (await tx.select().from(businessMetricVersions).where(and(eq(businessMetricVersions.companyId, companyId), eq(businessMetricVersions.id, d.metricVersionId))))[0]!.contentHash, relationship: "definition" }); facts = { key: value.target.key, status: value.target.status, periodStart: d.periodStart, periodEnd: d.periodEnd, criterion: d.criterion.kind, lower: d.criterion.kind === "between" ? d.criterion.lower : null, upper: d.criterion.kind === "between" ? d.criterion.upper : null, threshold: d.criterion.kind === "at_least" || d.criterion.kind === "at_most" ? d.criterion.value : null }; limitations.push("The target is an approved commitment; no achievement comparison is inferred from the target alone.");
      } else if (ref.type === "metric") {
        const value = await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, ref.id, ref.versionId); material = { metric: value.metric, version: value.version }; edge({ inputType: "metric_version", inputRef: value.version.id, inputHash: value.version.contentHash, relationship: "definition" }); facts = { name: value.version.definition.name, unit: value.version.definition.unit, authorityMode: value.version.definition.authorityMode, published: value.metric.publishedVersionId === ref.versionId };
      } else {
        const captured = await captureAnalyticalEvidence(tx, companyId, actor, { sensitivity: definition.sensitivity, retentionDays: definition.retentionDays, evidence: [{ key: item.key, source: ref }] }, deadline); for (const value of captured.edges) edge(value); for (const id of captured.manifestIds) dependencies.add(id); expiresAt = new Date(Math.min(expiresAt.getTime(), captured.expiresAt.getTime())); material = { source: captured.evidence[0].source, sourceHash: captured.evidence[0].sourceHash, facts: captured.evidence[0].facts, limitations: captured.evidence[0].limitations }; facts = captured.evidence[0].facts; limitations.push(...captured.evidence[0].limitations);
      }
    } else if (source.kind === "governance_obligation") {
      const value = await aiGovernanceService(tx).inspectReviewSource(actor, companyId, source.id, source.contentHash), obligation = value.obligation;
      const reviewDue = value.row.nextReviewAt <= started || Date.parse(obligation.nextReviewAt) <= started.getTime(), effectiveState = Date.parse(obligation.effectiveFrom) > started.getTime() ? "not_effective_yet" : obligation.effectiveUntil && Date.parse(obligation.effectiveUntil) <= started.getTime() ? "expired" : "effective";
      edge({ inputType: "governance_obligation", inputRef: value.row.id, inputHash: value.row.obligationHash, relationship: "source" });
      material = { row: value.row, currentRevision: value.currentRevision, reviewDue, effectiveState };
      governance = { id: value.row.id, contentHash: value.row.obligationHash, obligation };
      facts = { framework: obligation.framework, authority: obligation.authority, citation: obligation.citation, jurisdictionOrScope: obligation.jurisdictionOrScope, applicabilityState: obligation.applicabilityState, humanDeclaredApplicabilityFacts: obligation.applicabilityFacts, requiredControl: obligation.requiredControl, requiredEvidenceCount: obligation.evidenceRequired.length, declaredControlReferenceCount: obligation.controlRefs.length, ownerUserId: value.row.ownerUserId, lastReviewedAt: value.row.lastReviewedAt.toISOString(), nextReviewAt: obligation.nextReviewAt, reviewDue, currentRevision: value.currentRevision, effectiveState, effectiveFrom: obligation.effectiveFrom, effectiveUntil: obligation.effectiveUntil, sourceVersionOrDate: obligation.sourceVersionOrDate, sourceUrl: obligation.sourceUrl, reviewTrigger: obligation.reviewTrigger, controlEffectiveness: "not_verified" };
      limitations.push("Applicability, required controls and evidence are the original human governance declaration, not a legal ruling or proof of control effectiveness.", "Review-due or expired legal evidence is reported as a risk and never grants analytical purpose approval.");
    } else if (source.kind === "decision_outcome") {
      const value = await decisionOutcomeReviewService(tx).detail(companyId, actor, source.decisionId); if (!value || value.id !== source.reviewId || !compareCurrentVersions && value.revision !== source.revision) throw conflict("Native decision outcome review identity/revision changed");
      const bound = await inspectBoundDecisionContext(tx, companyId, actor, source.decisionId); if (bound.version.definition.sensitivity === "confidential" && definition.sensitivity !== "confidential") throw forbidden("Management cannot downgrade decision outcome sensitivity");
      await manifest(bound.version.lineageManifestId);
      // Receipt manifests preserve copied outcome judgments. Also inherit the
      // original baseline/actual owners so their deletion cannot leave those
      // copied measurements or dependent management prose behind.
      const originals = [...bound.version.definition.evidence.map(pin => pin.source), ...value.receipts.flatMap(receipt => receipt.actualEvidence.map(pin => pin.source))], distinct = [...new Map(originals.map(pin => [nativeSha256(pin), pin])).values()];
      if (distinct.length) { const inherited = await captureAnalyticalEvidence(tx, companyId, actor, { sensitivity: definition.sensitivity, retentionDays: definition.retentionDays, evidence: distinct.map((source, index) => ({ key: `inherited_${index}`, source })) }, deadline); for (const id of inherited.manifestIds) { dependencies.add(id); budget(); } for (const value of inherited.edges) edge(value); expiresAt = new Date(Math.min(expiresAt.getTime(), inherited.expiresAt.getTime())); }
      const rows = await tx.select().from(decisionOutcomeReviewReceipts).where(and(eq(decisionOutcomeReviewReceipts.companyId, companyId), eq(decisionOutcomeReviewReceipts.reviewId, value.id))).limit(4); if (rows.length !== value.revision) throw notFound("Decision outcome source receipts are unavailable"); for (const row of rows) await manifest(row.lineageManifestId); await ancestry({ type: "decision", id: source.decisionId });
      grade = "native_outcome_review"; const { authorizationCheckedAt, ...retainedOutcome } = value; material = retainedOutcome; if (value.revision === source.revision) outcome = retainedOutcome;
      const assessment = value.receipts.find(receipt => receipt.assessment)?.assessment;
      facts = { reviewStatus: value.status, revision: value.revision, reviewDueAt: value.reviewDueAt, chosenOptionId: value.optionId, contextHash: value.contextHash, lessonSummary: assessment?.lessonSummary ?? null, ...Object.fromEntries(["decisionProcessQuality", "assumptionAccuracy", "executionFidelity", "externalChange", "observedOutcome", "causalConfidence"].map(key => [key, assessment?.assessments[key as keyof typeof assessment.assessments].assessment ?? null])) }; limitations.push("Human outcome assessments remain separate judgments; a before/after association does not identify the effect of the decision.");
    } else {
      const value = await learningService(tx).get(actor, companyId, source.id); if (!compareCurrentVersions && value.version !== source.expectedVersion) throw conflict("Native Learning source version changed");
      const [cycle] = await tx.select().from(learningCycles).where(and(eq(learningCycles.companyId, companyId), eq(learningCycles.id, value.id))).for("share"); if (!cycle || cycle.erasedAt) throw notFound("Native Learning source is unavailable"); const roots = await learningRoots(tx, actor, cycle);
      if (roots.some(root => root.sensitivityLabel === "restricted" || root.sensitivityLabel === "confidential" && definition.sensitivity !== "confidential")) throw forbidden("Management cannot downgrade Learning source sensitivity");
      for (const root of roots) expiresAt = new Date(Math.min(expiresAt.getTime(), root.expiresAt?.getTime() ?? Infinity, root.validUntil?.getTime() ?? Infinity));
      link("learning_cycle", cycle.id); for (const id of Object.keys(cycle.outcomeVersions)) await ancestry({ type: "issue", id }); if (cycle.scopeType === "project") await ancestry({ type: "project", id: cycle.scopeId! });
      grade = "native_learning_cycle"; material = value; facts = { status: value.status, version: value.version, hypothesisCount: value.hypotheses.length, evaluationCount: value.evaluations.length, proposalCount: value.candidates.length, acceptedPromotionReceipts: value.candidates.filter(candidate => !!candidate.promotionReceipt).length }; limitations.push("Native Learning still requires surviving verified canonical Task roots and independent evaluations; analytical proxies do not substitute for those roots.");
    }
    sources.push({ key: item.key, source, sourceHash: nativeSha256(material), capturedAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(), grade, facts, limitations, ...(outcome ? { outcome } : {}), ...(governance ? { governance } : {}) });
  }
  // Capture typed original metric material only for explicitly requested pairs.
  // This is a read of an existing observation, never a query/new measurement.
  const comparisonKeys = new Set((definition.comparisons ?? []).flatMap(item => [item.leftSourceKey, item.rightSourceKey]));
  for (const captured of sources.filter(source => comparisonKeys.has(source.key))) {
    const ref = captured.source.kind === "canonical" || captured.source.kind === "analytical" ? captured.source.reference : null;
    if (ref?.type === "metric_observation") {
      const observation = await businessMetricService(tx).inspectCurrentObservation(companyId, actor, ref.id), published = await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, ref.metricId, ref.metricVersionId);
      if (observation.metricId !== ref.metricId || observation.versionId !== ref.metricVersionId) throw conflict("Management metric comparison pin changed");
      captured.metric = { observation, unit: published.version.definition.unit, timeSemantics: published.version.definition.timeSemantics };
      captured.sourceHash = nativeSha256({ originalSourceHash: captured.sourceHash, metric: captured.metric });
    } else if (ref?.type === "metric_target") {
      const value = await businessMetricTargetService(tx).inspectApprovedCommitment(companyId, actor, ref.id, ref.versionId);
      captured.target = { id: ref.id, versionId: ref.versionId, definition: value.version.definition };
      captured.sourceHash = nativeSha256({ originalSourceHash: captured.sourceHash, target: captured.target });
    } else throw conflict("Management comparison requires native observations and commitments");
    budget();
  }
  const lineage = [...edges.values()].sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  await inspectAnalyticalEvidenceAuthority(tx, companyId, actor, lineage, deadline);
  const primitiveLinks = [...links.values()].sort((a, b) => `${a.sourceType}:${a.sourceRef}`.localeCompare(`${b.sourceType}:${b.sourceRef}`));
  for (const primitive of primitiveLinks.filter(link => link.sourceType !== "learning_cycle")) { const [marker] = await tx.select({ ref: analyticalSourceSuppressions.inputRef }).from(analyticalSourceSuppressions).where(and(eq(analyticalSourceSuppressions.companyId, companyId), eq(analyticalSourceSuppressions.inputType, primitive.sourceType as "issue" | "project" | "goal" | "document" | "document_revision"), eq(analyticalSourceSuppressions.inputRef, primitive.sourceRef))).limit(1); if (marker) throw conflict("Management source was erased"); }
  const asOf = new Date(); if (expiresAt <= asOf) throw conflict("Management source evidence expired during capture"); budget();
  return { sources: definition.sources.map(item => sources.find(source => source.key === item.key)!), edges: lineage, links: primitiveLinks, dependencies: [...dependencies].sort(), expiresAt, asOf };
}
