import {assertAnalyticalReader} from "./analytical-reader.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { processFindings, processFindingTransitions, type Db } from "@paperclipai/db";
import { createProcessFindingSchema, transitionProcessFindingSchema, processFindingTransitionAllowed,
  type CreateProcessFinding, type ProcessAnalysisRunView, type ProcessFindingFacts, type ProcessFindingView,
  type TransitionProcessFinding } from "@paperclipai/shared";
import type { AuthorizationActor } from "./authorization.js";
import { conflict, notFound } from "../errors.js";
import { processAnalysisService } from "./process-analysis.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { assertV7Authorization, v7HumanActorId } from "./v7-authorization.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "./v7-mutations.js";

type Finding = typeof processFindings.$inferSelect;
const limitations = [
  "Severity and interpretation are human judgments, not calibrated probabilities or causal estimates.",
  "The evidence covers only currently authorized retained native activity and the declared object perspective.",
  "No employee score, inferred avoidability, automatic promotion or change to native work is produced.",
];
/** Select material aggregates already admitted by the native run. Raw paths,
 * actor identities and source bodies are never copied into a finding. */
export function materialProcessFinding(run: ProcessAnalysisRunView, input: CreateProcessFinding): { summary: string; facts: ProcessFindingFacts } {
  const facts: ProcessFindingFacts = { observed: {}, semantics: "human_process_interpretation_of_observed_facts", limitations: [...limitations] };
  if (input.findingType === "missing_process_data") {
    if (run.result.errorCode !== "DATA_NOT_READY") throw conflict("This run has no admitted missing-data finding");
    facts.observed = Object.fromEntries(run.result.readiness.dimensions
      .filter(dimension => dimension.required && (dimension.state === "failed" || dimension.state === "unknown"))
      .map(dimension => [dimension.dimension, dimension.state]));
    return { summary: "The declared process analysis lacks qualified current data", facts };
  }
  if (run.result.status !== "succeeded") throw conflict("A process finding requires admitted observed statistics");
  const observed = run.result.objectSummaries.find(value => value.objectType === input.objectType);
  if (!observed) throw conflict("This run did not qualify the selected object perspective");
  facts.observed = { objectCount: observed.objectCount, eventCount: observed.eventCount };
  if(input.findingType==="conformance_deviation") {
    const comparison=observed.conformance;
    if(!comparison || comparison.deviatingObjectCount<=0 || comparison.targetVersionId!==run.versionId)
      throw conflict("No qualified published-model deviation supports this finding");
    facts.observed={...facts.observed,modelHash:comparison.modelHash,targetVersionId:comparison.targetVersionId,
      evaluatedObjectCount:comparison.evaluatedObjectCount,deviatingObjectCount:comparison.deviatingObjectCount,...comparison.violationCounts};
    facts.limitations.push("A difference from the published typed expectation does not establish a policy violation, cause, avoidability or employee performance.");
    return {summary:"Recorded primary state paths differ from the published explicit process model",facts};
  }
  if (input.findingType === "rework") {
    if (observed.reopenCount === null || observed.reopenCount <= 0) throw conflict("No observed reopening supports this finding");
    facts.observed.reopenCount = observed.reopenCount;
    return { summary: "Recorded object paths contain observed terminal-to-nonterminal reopening", facts };
  }
  if (input.findingType === "avoidable_wait" || input.findingType === "bottleneck") {
    if (observed.knownBlockedSeconds === null || observed.knownBlockedSeconds <= 0) throw conflict("No qualified blocked interval supports this finding");
    facts.observed.knownBlockedSeconds = observed.knownBlockedSeconds;
    facts.limitations.push("Blocked duration alone does not establish avoidability or a bottleneck; investigation must test the human interpretation.");
    return { summary: "Recorded object paths contain blocked intervals for human investigation", facts };
  }
  const variant = observed.variants.find(value => value.hash === input.variantHash);
  if (!variant || observed.variants.length < 2) throw conflict("Select a retained variant from a qualified multi-variant result");
  facts.observed.variantHash = variant.hash; facts.observed.variantObjectCount = variant.objectCount;
  facts.observed.observedVariantCount = observed.variants.length;
  facts.limitations.push("A selected variant is not a statistically established anomaly; no unusualness probability is estimated.");
  return { summary: "A human selected an observed process variant for investigation", facts };
}
function immutableContent(row: Pick<Finding, "findingType" | "objectType" | "variantHash" | "severity" | "interpretation" | "summary" | "facts" | "definitionHash" | "eventSetHash">) {
  return { findingType: row.findingType, objectType: row.objectType, variantHash: row.variantHash, severity: row.severity, interpretation: row.interpretation,
    summary: row.summary, facts: row.facts, definitionHash: row.definitionHash, eventSetHash: row.eventSetHash };
}
function view(row: Finding, run: ProcessAnalysisRunView): ProcessFindingView {
  if (row.expiresAt <= new Date() || row.expiresAt.getTime() > Date.parse(run.expiresAt)) throw notFound("Process finding retention expired or is unavailable");
  if (row.definitionHash !== run.definitionHash || row.eventSetHash !== run.eventSetHash || nativeSha256(immutableContent(row)) !== row.contentHash)
    throw conflict("Process finding evidence integrity is unavailable");
  const { createdBy: _createdBy, fingerprint: _fingerprint, ...retained } = row;
  return { ...retained, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionRef: null, authorizationCheckedAt: run.authorizationCheckedAt };
}
export function processFindingService(db: Db) {
  async function boundary(tx: Db, companyId: string, actor: AuthorizationActor, definitionId: string, runId: string, write = false) {
    if(write)v7HumanActorId(actor);else await assertAnalyticalReader(tx,companyId,actor); await tx.execute(sql`set local statement_timeout='8s'`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
    // The native run owner rechecks flags, current purpose/owner, exact source
    // set, readiness and all lineage sources before any finding disclosure.
    return processAnalysisService(tx).getRun(companyId, actor, definitionId, runId);
  }
  async function finding(tx: Db, companyId: string, runId: string, id: string, write = false) {
    const query = tx.select().from(processFindings).where(and(eq(processFindings.companyId, companyId), eq(processFindings.analysisRunId, runId), eq(processFindings.id, id)));
    const [row] = await (write ? query.for("update") : query.for("share"));
    if (!row) throw notFound("Process finding not found");
    return row;
  }
  return {
    async create(companyId: string, actor: AuthorizationActor, definitionId: string, runId: string, raw: CreateProcessFinding) {
      const input = createProcessFindingSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const run = await boundary(tx, companyId, actor, definitionId, runId, true);
        const material = materialProcessFinding(run, input), fingerprint = nativeSha256({ runId, findingType: input.findingType, objectType: input.objectType, variantHash: input.variantHash });
        const content = { ...input, ...material, definitionHash: run.definitionHash, eventSetHash: run.eventSetHash }, contentHash = nativeSha256(content);
        const [existing] = await tx.select().from(processFindings).where(and(eq(processFindings.companyId, companyId), eq(processFindings.analysisRunId, runId), eq(processFindings.fingerprint, fingerprint)));
        if (existing) {
          if (existing.contentHash !== contentHash) throw conflict("This material finding already has a frozen human interpretation");
          return view(existing, run);
        }
        const [row] = await tx.insert(processFindings).values({ companyId, definitionId, analysisRunId: runId, ...content, contentHash, fingerprint,
          createdBy: v7HumanActorId(actor), expiresAt: new Date(run.expiresAt) }).returning();
        await tx.insert(processFindingTransitions).values({ companyId, findingId: row.id, version: 1, fromStatus: null, toStatus: "OPEN", reason: input.interpretation, recordedBy: v7HumanActorId(actor) });
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "process_finding.created", entityType: "process_analysis_definition", entityId: definitionId,
          details: { findingId: row.id, runId, findingType: input.findingType, contentHash } }, publications);
        return view(row, run);
      });
    },
    async list(companyId: string, actor: AuthorizationActor, definitionId: string, runId: string, cursor?: string) {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db, run = await boundary(tx, companyId, actor, definitionId, runId);
        const rows = await tx.select().from(processFindings).where(and(eq(processFindings.companyId, companyId), eq(processFindings.analysisRunId, runId),
          cursor ? sql`${processFindings.id}>${cursor}::uuid` : undefined)).orderBy(asc(processFindings.id)).limit(101);
        return { items: rows.slice(0, 100).map(row => view(row, run)), nextCursor: rows.length > 100 ? rows[99].id : null };
      });
    },
    async detail(companyId: string, actor: AuthorizationActor, definitionId: string, runId: string, id: string) {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db, run = await boundary(tx, companyId, actor, definitionId, runId), row = await finding(tx, companyId, runId, id);
        const receipts = await tx.select().from(processFindingTransitions).where(and(eq(processFindingTransitions.companyId, companyId), eq(processFindingTransitions.findingId, id)))
          .orderBy(desc(processFindingTransitions.version)).limit(101);
        if (!receipts[0] || receipts[0].version !== row.version || receipts[0].toStatus !== row.status) throw conflict("Process finding transition evidence is unavailable");
        return { finding: view(row, run), transitions: receipts.slice(0, 100).map(receipt => ({ version: receipt.version, fromStatus: receipt.fromStatus,
          toStatus: receipt.toStatus, reason: receipt.reason, recordedAt: receipt.recordedAt.toISOString() })), hasMoreTransitions: receipts.length > 100 };
      });
    },
    async transition(companyId: string, actor: AuthorizationActor, definitionId: string, runId: string, id: string, raw: TransitionProcessFinding) {
      const input = transitionProcessFindingSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const run = await boundary(tx, companyId, actor, definitionId, runId, true), row = await finding(tx, companyId, runId, id, true);
        view(row, run);
        if (row.version !== input.expectedVersion || !processFindingTransitionAllowed(row.status, input.status)) throw conflict("Process finding state changed or the requested transition is not admitted");
        const [updated] = await tx.update(processFindings).set({ status: input.status, version: row.version + 1, resolvedAt: input.status === "RESOLVED" ? new Date() : null })
          .where(eq(processFindings.id, id)).returning();
        await tx.insert(processFindingTransitions).values({ companyId, findingId: id, version: updated.version, fromStatus: row.status, toStatus: input.status, reason: input.reason, recordedBy: v7HumanActorId(actor) });
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "process_finding.transitioned", entityType: "process_analysis_definition", entityId: definitionId,
          details: { findingId: id, runId, fromStatus: row.status, toStatus: input.status, version: updated.version, reasonHash: nativeSha256(input.reason) } }, publications);
        return view(updated, run);
      });
    },
  };
}
