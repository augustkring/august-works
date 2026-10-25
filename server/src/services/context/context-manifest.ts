import { createHash } from "node:crypto";
import { and, eq, inArray, is } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { PgTransaction } from "drizzle-orm/pg-core";
import {
  agentExecutionScopeRequests,
  agents,
  companyCrossCompanyPolicies,
  delegatedContextManifestBindings,
  contextManifestItems,
  contextManifests,
  heartbeatRuns,
  issues,
  issuePrivacySources,
  projects,
  contextManifestMemoryRoots,
  memoryRecords,
  memoryModels,
  memoryObservations,
} from "@paperclipai/db";
import type {
  ContextAuthorityDecision,
  EvidenceItem,
} from "@paperclipai/shared";
import { agentExecutionScopeSchema, crossCompanyPolicySchema, type AgentExecutionScope } from "@paperclipai/shared";
import { conflict, forbidden, unprocessable } from "../../errors.js";
import { learningAssetRoots,retainLearnedAssetsInContext } from "../learning/learning-assets.js";
import { memoryPayloadVisible, canActorReadMemorySources, lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { modelLineage, observationLineage } from "../memory/derived-memory.js";
import { lockIssuePrivacyTree } from "../issues.js";
import { foundationIndexService } from "../foundation/foundation-index.js";
import { approvedFoundationView, foundationService } from "../foundation/foundation-service.js";
import {authorizationService,canActorReadHeartbeatRunPrivacy,canActorReadIssuePrivacy,canActorReadProjectPrivacy,type AuthorizationActor,type NativeContextInspectionOwner} from "../authorization.js";
import { crossCompanyEvidencePolicy } from "../cross-company-context-policy.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";
import { captureNativeBootstrapContextWitness, readNativeBootstrapContextWitness, type NativeBootstrapContextWitness } from "./native-bootstrap-context-witness.js";

export interface DelegatedContextExecutionBindingInput {
  homeCompanyId: string;
  homeAgentId: string;
  homeAgentIdentityId: string;
  homeRunId: string;
  scopeRequestId: string;
  responsibleUserId: string;
  guestCompanyId: string;
  guestAgentId: string;
  guestAgentIdentityId: string;
  purpose: string;
  accessMode: "read" | "contribute" | "act";
  scope: AgentExecutionScope;
  /** Authenticated home actor passed by the original runtime owner. */
  homeActor: AuthorizationActor;
}

type JsonScalar = string | number | boolean | null;
type CanonicalJson = JsonScalar | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalJson(value: unknown, path = "$"): CanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unprocessable("Context policy snapshot contains a non-finite number", { path });
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unprocessable("Context policy snapshot must be JSON-compatible", { path });
    }
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalJson(entry, `${path}.${key}`);
    }
    return result;
  }
  throw unprocessable("Context policy snapshot must be JSON-compatible", { path });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashContextQuery(query: string): string {
  return sha256(query);
}

export function hashContextPolicySnapshot(snapshot: unknown): string {
  return sha256(JSON.stringify(canonicalJson(snapshot)));
}

export function hashEvidenceContent(evidence: EvidenceItem): string {
  return sha256(
    JSON.stringify({
      title: evidence.title,
      excerpt: evidence.excerpt,
    }),
  );
}

/** Revalidate the exact persisted guest Context closure through its original
 * provider owners. This accepts only native Task, approved Foundation, and
 * Memory providers; connected/unknown providers remain unavailable. Caller
 * must pass the guest actor returned by the canonical cross-company resolver
 * and its existing native transaction. */
export async function revalidateStoredContextManifestSources(db: Db, input: {
  companyId: string; manifestId: string; agentId: string; runId?: string | null; actor: AuthorizationActor;
}) {
  if (!is(db, PgTransaction)) throw forbidden("Delegated Context source review requires its active native transaction.");
  const [manifest] = await db.select({ id: contextManifests.id, agentId: contextManifests.agentId,
    runId: contextManifests.runId, issueId: contextManifests.issueId }).from(contextManifests).where(and(
    eq(contextManifests.companyId, input.companyId), eq(contextManifests.id, input.manifestId))).limit(1);
  if (!manifest || manifest.agentId !== input.agentId || manifest.runId !== (input.runId ?? null))
    throw forbidden("Delegated Context manifest is unavailable");
  if (input.runId) {
    const [run] = await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId,
      responsibleUserId: heartbeatRuns.responsibleUserId, issueId: heartbeatRuns.issueId, nativeIssueId: heartbeatRuns.nativeIssueId,
      status: heartbeatRuns.status }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId))).for("share");
    if (!run || run.status !== "running" || run.responsibleUserId !== input.actor.onBehalfOfUserId ||
      input.actor.type !== "agent" || input.actor.source !== "agent_jwt" || input.actor.runId !== run.id ||
      manifest.issueId !== (run.nativeIssueId ?? run.issueId))
      throw forbidden("Native bootstrap Context accountability changed");
  }
  await lockIssuePrivacyTree(db as unknown as Parameters<typeof lockIssuePrivacyTree>[0], input.companyId);
  await lockMemoryPrivacy(db, input.companyId);
  const items = await db.select().from(contextManifestItems).where(and(
    eq(contextManifestItems.companyId, input.companyId), eq(contextManifestItems.manifestId, input.manifestId)))
    .orderBy(contextManifestItems.rank).limit(257);
  if (items.length > 256) throw forbidden("Delegated Context source set exceeds its bounded review");
  const roots = await db.select().from(contextManifestMemoryRoots).where(and(
    eq(contextManifestMemoryRoots.companyId, input.companyId), eq(contextManifestMemoryRoots.manifestId, input.manifestId)))
    .orderBy(contextManifestMemoryRoots.memoryRecordId).limit(257);
  if (roots.length > 256) throw forbidden("Delegated Context Memory roots exceed their bounded review");

  const expectedRoots = new Map<string, string>();
  const foundationRefs: Array<{ documentId: string; revisionId: string }> = [];
  const analyticalRead = (issueId: string) => assertAnalyticalContextPayloadAccess(db, input.companyId, input.actor, { issueId }, "task");
  for (const item of items) {
    if (item.sourceProvider === "august_works_tasks") {
      const ref = /^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
      if (!ref) throw forbidden("Delegated Context Task reference is invalid");
      const [current] = await db.select({ id: issues.id, updatedAt: issues.updatedAt,
        payloadSourceSnapshot: issues.payloadSourceSnapshot }).from(issues).where(and(
        eq(issues.companyId, input.companyId), eq(issues.id, ref[1]!))).for("share");
      if (!current || current.updatedAt.toISOString() !== item.sourceVersion ||
        hashContextPolicySnapshot(current.payloadSourceSnapshot) !== hashContextPolicySnapshot(item.payloadSourceSnapshot) ||
        !await canActorReadIssuePrivacy(db, input.actor, { companyId: input.companyId, id: current.id }))
        throw forbidden("Delegated Context Task source changed or is unavailable");
      await analyticalRead(current.id);
    } else if (item.sourceProvider === "august_works_foundation") {
      const ref = /^foundation:\/\/([a-f0-9-]{36})\/([a-f0-9-]{36})(?:\/(?:whole|\d+))?$/i.exec(item.sourceRef);
      if (!ref || item.sourceVersion !== ref[2]) throw forbidden("Delegated Context Foundation reference is invalid");
      foundationRefs.push({ documentId: ref[1]!, revisionId: ref[2]! });
    } else if (item.sourceProvider === "august_works_memory") {
      const ref = /^memory:\/\/record\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
      if (!ref || !item.sourceVersion) throw forbidden("Delegated Context Memory reference is invalid");
      expectedRoots.set(ref[1]!, item.sourceVersion);
    } else if (item.sourceProvider === "august_works_derived_memory") {
      const ref = /^memory:\/\/(memory_model|memory_observation)\/([a-f0-9-]{36})$/i.exec(item.sourceRef);
      if (!ref) throw forbidden("Delegated Context derived Memory reference is invalid");
      if (ref[1] === "memory_model") {
        const [row] = await db.select().from(memoryModels).where(and(eq(memoryModels.companyId, input.companyId),
          eq(memoryModels.id, ref[2]!))).for("share");
        if (!row || row.erasedAt || row.status !== "active" || String(row.version) !== item.sourceVersion)
          throw forbidden("Delegated Context derived Memory source is unavailable");
        for (const root of (await modelLineage(db, input.actor, row)).roots) {
          if (expectedRoots.has(root.id) && expectedRoots.get(root.id) !== root.updatedAt.toISOString())
            throw forbidden("Delegated Context Memory root versions changed");
          expectedRoots.set(root.id, root.updatedAt.toISOString());
        }
      } else {
        const [row] = await db.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, input.companyId),
          eq(memoryObservations.id, ref[2]!))).for("share");
        if (!row || row.erasedAt || row.status !== "accepted" || String(row.version) !== item.sourceVersion)
          throw forbidden("Delegated Context derived Memory source is unavailable");
        for (const root of (await observationLineage(db, input.actor, row)).roots) {
          if (expectedRoots.has(root.id) && expectedRoots.get(root.id) !== root.updatedAt.toISOString())
            throw forbidden("Delegated Context Memory root versions changed");
          expectedRoots.set(root.id, root.updatedAt.toISOString());
        }
      }
    } else {
      throw forbidden("Delegated Context provider has no current source authorization owner");
    }
  }
  if (foundationRefs.length) await foundationService(db).pinApprovedRevisions(input.companyId, foundationRefs, input.actor);
  for (const root of roots) {
    const [current] = await db.select({ id: memoryRecords.id, updatedAt: memoryRecords.updatedAt,
      payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot, validUntil: memoryRecords.validUntil,
      expiresAt: memoryRecords.expiresAt }).from(memoryRecords).where(and(
      eq(memoryRecords.companyId, input.companyId), eq(memoryRecords.id, root.memoryRecordId), memoryPayloadVisible())).for("share");
    if (!current || current.updatedAt.toISOString() !== root.sourceVersion ||
      hashContextPolicySnapshot(current.payloadSourceSnapshot) !== hashContextPolicySnapshot(root.payloadSourceSnapshot) ||
      current.validUntil && current.validUntil.getTime() <= Date.now() || current.expiresAt && current.expiresAt.getTime() <= Date.now() ||
      expectedRoots.size && expectedRoots.has(current.id) && expectedRoots.get(current.id) !== current.updatedAt.toISOString() ||
      !await canActorReadMemorySources(db, input.companyId, input.actor, current.id))
      throw forbidden("Delegated Context Memory source changed or is unavailable");
  }
  for (const [id, version] of expectedRoots) if (!roots.some(root => root.memoryRecordId === id && root.sourceVersion === version))
    throw forbidden("Delegated Context selected Memory root closure is incomplete");
}

/** Recheck a fresh native bootstrap's original Context rows through their
 * canonical owners immediately before native input dispatch. The opaque token
 * carries the original server-created Agent/run principal and exact manifest;
 * it does not grant permission on its own. */
export async function revalidateNativeBootstrapContextWitness(db: Db, input: {
  witness: NativeBootstrapContextWitness; companyId: string; runId: string; agentId: string; issueId: string;
  renderedMarkdown: string; manifestIds: readonly { companyId: string; contextManifestId: string }[];
}) {
  const captured = readNativeBootstrapContextWitness(input.witness, input);
  if (!captured) throw forbidden("Native bootstrap Context source witness is unavailable");
  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    const actor = captured.actor;
    const [run] = await tx.select({ id: heartbeatRuns.id, status: heartbeatRuns.status,
      agentId: heartbeatRuns.agentId, responsibleUserId: heartbeatRuns.responsibleUserId,
      issueId: heartbeatRuns.issueId, nativeIssueId: heartbeatRuns.nativeIssueId }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId),
    )).for("share");
    if (!run || run.status !== "running" || run.responsibleUserId !== actor.onBehalfOfUserId ||
      run.nativeIssueId !== input.issueId && run.issueId !== input.issueId || actor.type !== "agent" || actor.source !== "agent_jwt" ||
      actor.companyId !== input.companyId || actor.agentId !== input.agentId || actor.runId !== input.runId)
      throw forbidden("Native bootstrap Context accountability changed before dispatch");
    const companyAccess = await authorizationService(tx).decide({ actor, action: "company_scope:read",
      resource: { type: "company", companyId: input.companyId }, enforceResponsibleUserIntersection: true });
    if (!companyAccess.allowed) throw forbidden("Native bootstrap Context authority changed before dispatch");
    await revalidateStoredContextManifestSources(tx, { companyId: input.companyId,
      manifestId: captured.contextInput.manifestId, agentId: input.agentId, runId: input.runId, actor });
  });
}

export interface ContextManifestSelectedEvidence {
  decision: ContextAuthorityDecision;
  selectionReason?: string;
  retrievalScore?: number | null;
}

export interface CreateContextManifestInput {
  companyId: string;
  runId?: string | null;
  agentId: string;
  issueId?: string | null;
  projectId?: string | null;
  responsibleUserId?: string | null;
  delegatedExecution?: DelegatedContextExecutionBindingInput;
  query: string;
  policySnapshot: unknown;
  selected: ContextManifestSelectedEvidence[];
}

async function assertManifestReferences(db: Db, input: CreateContextManifestInput) {
  const [agent, run, issue, project] = await Promise.all([
    db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)))
      .then((rows) => rows[0] ?? null),
    input.runId
      ? db
          .select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, responsibleUserId:heartbeatRuns.responsibleUserId,issueId:heartbeatRuns.issueId })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, input.companyId),
              eq(heartbeatRuns.id, input.runId),
            ),
          )
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.issueId
      ? db
          .select({ id: issues.id, projectId: issues.projectId })
          .from(issues)
          .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.projectId
      ? db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.companyId, input.companyId), eq(projects.id, input.projectId)))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  if (!agent) throw forbidden("Context manifest agent is outside the company boundary");
  if (input.runId && !run) {
    throw forbidden("Context manifest run is outside the company boundary");
  }
  if (run && run.agentId !== input.agentId) {
    throw forbidden("Context manifest run does not belong to the selected agent");
  }
  if (input.issueId && !issue) {
    throw forbidden("Context manifest issue is outside the company boundary");
  }
  if (input.projectId && !project) {
    throw forbidden("Context manifest project is outside the company boundary");
  }
  if (issue?.projectId && input.projectId && issue.projectId !== input.projectId) {
    throw unprocessable("Context manifest issue and project do not match");
  }

  const crossCompanyEvidence = input.selected.find(
    ({ decision }) => decision.evidence.companyId !== input.companyId,
  );
  if (crossCompanyEvidence) {
    throw forbidden("Context manifest evidence crossed the company boundary");
  }

  for (const item of input.selected) {
    const score = item.retrievalScore;
    if (
      score !== undefined &&
      score !== null &&
      (!Number.isFinite(score))
    ) {
      throw unprocessable("Context manifest retrieval score must be finite");
    }
    const reason = item.selectionReason ?? item.decision.reason;
    if (!reason.trim() || reason.length > 500) {
      throw unprocessable("Context manifest selection reason is invalid");
    }
  }
  return run;
}

/** Human readiness's no-write Source gate. Runtime manifests keep their
 * separate actual-run create path and its strict retention writes. The caller
 * owns the physical authorization and privacy transaction. */
async function verifyContextSelection(db: Db, input: CreateContextManifestInput, actor: AuthorizationActor,
  options: { rejectUnsupportedProviders: boolean }) {
  const selectedTaskIds: string[] = [];
  const selectedPayloadSnapshots = new Map<string, typeof issues.$inferSelect["payloadSourceSnapshot"]>();
  const expectedRoots = new Map<string, string>();
  const learnedAssets: Array<{ type: string; id: string }> = [];
  const sourceKey = (provider: string, ref: string) => `${provider}:${ref.toLowerCase()}`;
  const foundationEvidence = input.selected.filter(({ decision }) => decision.evidence.sourceProvider === "august_works_foundation");
  if (options.rejectUnsupportedProviders && foundationEvidence.length) {
    const refs = foundationEvidence.map(({ decision }) => {
      const match = /^foundation:\/\/([a-f0-9-]{36})\/([a-f0-9-]{36})(?:\/\d+)?$/i.exec(decision.evidence.sourceRef);
      if (!match || decision.evidence.sourceVersion !== match[2]) throw forbidden("Foundation Context requires its pinned canonical revision");
      return { documentId: match[1]!, revisionId: match[2]! };
    });
    await foundationService(db).pinApprovedRevisions(input.companyId, refs, actor);
  }
  const canonicalFoundationRows = foundationEvidence.length ? await foundationIndexService(db).search(input.companyId, {
    query: input.query.slice(0, 500), limit: 12, scope: "approved",
  }, actor, "task") : [];
  const wholeFoundationRows = foundationEvidence.some(({ decision }) => decision.evidence.sourceRef.match(/^foundation:\/\/[^/]+\/[^/]+$/))
    ? (await foundationService(db).list(input.companyId, actor)).map(approvedFoundationView).filter((item) => item !== null)
    : [];
  const supported = new Set(["august_works_tasks", "august_works_foundation", "august_works_memory", "august_works_derived_memory"]);

  for (const { decision, retrievalScore, selectionReason } of input.selected) {
    const evidence = decision.evidence;
    const reason = selectionReason ?? decision.reason;
    if (evidence.companyId !== input.companyId || !reason.trim() || reason.length > 500 ||
      retrievalScore != null && !Number.isFinite(retrievalScore) || options.rejectUnsupportedProviders && !supported.has(evidence.sourceProvider))
      throw forbidden("Context source evidence is unavailable");
    const nowMs = Date.now();
    if (evidence.validFrom && new Date(evidence.validFrom).getTime() > nowMs ||
      evidence.validUntil && new Date(evidence.validUntil).getTime() <= nowMs)
      throw conflict("Context source is outside its current validity window");
    if (evidence.sourceProvider === "august_works_tasks") {
      const ref = /^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(evidence.sourceRef);
      if (!ref) throw forbidden("Context requires its canonical Task reference");
      const [current] = await db.select({ id: issues.id, updatedAt: issues.updatedAt,
        payloadSourceSnapshot: issues.payloadSourceSnapshot }).from(issues).where(and(
          eq(issues.companyId, input.companyId), eq(issues.id, ref[1]!))).for("share");
      if (!current || current.updatedAt.toISOString() !== evidence.sourceVersion ||
        !await canActorReadIssuePrivacy(db, actor, { companyId: input.companyId, id: current.id }))
        throw conflict("Context Task source changed or is unavailable");
      selectedTaskIds.push(current.id);
      selectedPayloadSnapshots.set(sourceKey(evidence.sourceProvider, evidence.sourceRef), current.payloadSourceSnapshot);
    } else if (evidence.sourceProvider === "august_works_foundation") {
      const ref = /^foundation:\/\/([a-f0-9-]{36})\/([a-f0-9-]{36})(?:\/(\d+))?$/i.exec(evidence.sourceRef);
      if (!ref || evidence.sourceVersion !== ref[2]) throw forbidden("Foundation Context requires its pinned canonical revision");
      if (ref[3] === undefined) {
        const document = wholeFoundationRows.find(candidate => candidate.id === ref[1] && candidate.canonicalRevision?.id === ref[2]);
        if (!document || !document.canonicalRevision || document.authorityLevel !== "canonical" || !["public", "internal"].includes(document.sensitivity) ||
          document.body !== evidence.excerpt || document.title !== evidence.title ||
          new Date(document.lastReviewedAt ?? document.canonicalRevision.createdAt).toISOString() !== evidence.sourceUpdatedAt)
          throw conflict("Approved Foundation revision changed or is unavailable");
      } else {
        const row = canonicalFoundationRows.find(candidate => candidate.foundationDocumentId === ref[1] &&
          candidate.documentRevisionId === ref[2] && String(candidate.ordinal) === ref[3]);
        const expectedTitle = row ? (row.headingPath.length ? row.headingPath.join(" > ") : row.title ?? row.foundationKey) : null;
        if (!row || row.excerpt !== evidence.excerpt || expectedTitle !== evidence.title ||
          row.sourceUpdatedAt !== evidence.sourceUpdatedAt || row.contentHash !== evidence.metadata.contentHash)
          throw conflict("Foundation Context source changed during assembly");
      }
      learnedAssets.push({ type: "document_revision", id: ref[2]! });
      for (const root of await learningAssetRoots(db, input.companyId, "document_revision", ref[2]!,
        typeof (input.policySnapshot as { intent?: unknown })?.intent === "string" ? (input.policySnapshot as { intent: string }).intent : "general_work", actor, "task")) {
        const version = root.record.updatedAt.toISOString();
        if (expectedRoots.has(root.id) && expectedRoots.get(root.id) !== version)
          throw conflict("Learned Context roots have conflicting versions");
        expectedRoots.set(root.id, version);
      }
    } else if (evidence.sourceProvider === "august_works_memory") {
      const ref = /^memory:\/\/record\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(evidence.sourceRef);
      if (!ref || !evidence.sourceVersion || expectedRoots.has(ref[1]!) && expectedRoots.get(ref[1]!) !== evidence.sourceVersion)
        throw forbidden("Context requires its canonical Memory reference and version");
      expectedRoots.set(ref[1]!, evidence.sourceVersion);
    } else if (evidence.sourceProvider === "august_works_derived_memory") {
      const ref = /^memory:\/\/(memory_model|memory_observation)\/([a-f0-9-]{36})$/i.exec(evidence.sourceRef);
      if (!ref) throw forbidden("Derived Context requires its native reference");
      const roots = await (async () => {
        if (ref[1] === "memory_model") {
          const [row] = await db.select().from(memoryModels).where(and(eq(memoryModels.companyId, input.companyId), eq(memoryModels.id, ref[2]!))).for("share");
          if (!row || row.erasedAt || row.status !== "active" || String(row.version) !== evidence.sourceVersion)
            throw conflict("Derived Context review changed during assembly");
          return (await modelLineage(db, actor, row)).roots;
        }
        const [row] = await db.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, input.companyId), eq(memoryObservations.id, ref[2]!))).for("share");
        if (!row || row.erasedAt || row.status !== "accepted" || String(row.version) !== evidence.sourceVersion)
          throw conflict("Derived Context review changed during assembly");
        return (await observationLineage(db, actor, row)).roots;
      })();
      for (const root of roots) {
        const version = root.updatedAt.toISOString();
        if (expectedRoots.has(root.id) && expectedRoots.get(root.id) !== version)
          throw conflict("Context Memory source versions conflict");
        expectedRoots.set(root.id, version);
      }
    } else if (options.rejectUnsupportedProviders) {
      throw forbidden("Context source provider is not supported for Human inspection");
    }
  }

  const rootIds = [...expectedRoots.keys()];
  if (rootIds.length > 256) throw forbidden("Complete Context Memory roots exceed their source budget");
  if (rootIds.length) {
    const roots = await db.select({ id: memoryRecords.id, updatedAt: memoryRecords.updatedAt, scopeType: memoryRecords.scopeType,
      ownerAgentId: memoryRecords.ownerAgentId, payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
      validUntil: memoryRecords.validUntil, expiresAt: memoryRecords.expiresAt }).from(memoryRecords).where(and(
        eq(memoryRecords.companyId, input.companyId), inArray(memoryRecords.id, rootIds), memoryPayloadVisible())).for("share");
    if (roots.length !== rootIds.length) throw forbidden("Context Memory roots cross a company boundary or were erased");
    for (const root of roots) {
      if (root.scopeType === "agent" && root.ownerAgentId !== input.agentId)
        throw forbidden("Context private Memory belongs to another agent");
      if (root.validUntil && root.validUntil.getTime() <= Date.now() || root.expiresAt && root.expiresAt.getTime() <= Date.now())
        throw conflict("Context Memory source expired during assembly");
      if (root.updatedAt.toISOString() !== expectedRoots.get(root.id) ||
        !await canActorReadMemorySources(db, input.companyId, actor, root.id))
        throw forbidden("Context Memory source access is unavailable");
      selectedPayloadSnapshots.set(sourceKey("august_works_memory", `memory://record/${root.id}`), root.payloadSourceSnapshot);
    }
  }
  return { selectedTaskIds, selectedPayloadSnapshots, expectedRoots, learnedAssets };
}

export function contextManifestService(db: Db) {
  return {
    /** Validate a Human-owned, non-execution Context selection without creating
     * a manifest or retaining Task/Memory/analytical dependency edges. Runtime
     * callers continue to use create(), which requires the real accountable run. */
    inspectReadOnly: async (input: CreateContextManifestInput, actor: AuthorizationActor, authority: NativeContextInspectionOwner) => {
      if (input.runId) throw forbidden("Read-only Context inspection cannot claim an execution run");
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        const assertOriginalHumanCurrent = async () => {
          if (actor.type !== "board") throw forbidden("Read-only Context inspection requires its original Human actor");
          const company = await authority.decide({ actor, action: "company_scope:read",
            resource: { type: "company", companyId: input.companyId }, enforceResponsibleUserIntersection: true });
          const agentRead = await authority.decide({ actor, action: "agent:read",
            resource: { type: "agent", companyId: input.companyId, agentId: input.agentId } });
          if (!company.allowed || !agentRead.allowed) throw forbidden("Context inspection authority is unavailable");
          return actor;
        };
        const sourceActor = await assertOriginalHumanCurrent();
        // Pin the original User/credential before taking Task privacy-tree locks.
        await lockIssuePrivacyTree(rawTx, input.companyId);
        await assertManifestReferences(tx, input);
        const verified = await verifyContextSelection(tx, input, sourceActor, { rejectUnsupportedProviders: true });
        await assertOriginalHumanCurrent();
        if (input.issueId && !await canActorReadIssuePrivacy(tx, sourceActor, { companyId: input.companyId, id: input.issueId }))
          throw forbidden("Context inspection source access changed during assembly");
        for (const id of verified.selectedTaskIds) if (!await canActorReadIssuePrivacy(tx, sourceActor, { companyId: input.companyId, id }))
          throw forbidden("Context inspection Task access changed during assembly");
        for (const id of verified.expectedRoots.keys()) if (!await canActorReadMemorySources(tx, input.companyId, sourceActor, id))
          throw forbidden("Context inspection Memory access changed during assembly");

        const sourceSnapshotHash = sha256(JSON.stringify(input.selected.map(({ decision }) => ({
          sourceProvider: decision.evidence.sourceProvider, sourceRef: decision.evidence.sourceRef,
          sourceVersion: decision.evidence.sourceVersion, contentHash: hashEvidenceContent(decision.evidence),
        })).sort((a, b) => `${a.sourceProvider}:${a.sourceRef}`.localeCompare(`${b.sourceProvider}:${b.sourceRef}`))));
        return { policySnapshotHash: hashContextPolicySnapshot(input.policySnapshot), sourceSnapshotHash };
      });
    },
    create: async (input: CreateContextManifestInput, nativeBootstrap?: { renderedMarkdown: string }) => {
      const queryHash = hashContextQuery(input.query);
      const policySnapshotHash = hashContextPolicySnapshot(input.policySnapshot);

      return db.transaction(async (tx) => {
        const sourceDb = tx as unknown as Db;
        const delegated = input.delegatedExecution;
        if (delegated && (input.runId || input.companyId !== delegated.guestCompanyId || input.agentId !== delegated.guestAgentId ||
          input.responsibleUserId !== delegated.responsibleUserId || input.issueId || input.projectId))
          throw forbidden("Delegated Context does not match its guest-local source owner");
        const run = await assertManifestReferences(sourceDb, input);
        let issueId: string | null = null;
        let sourceActor: AuthorizationActor;
        if (delegated) {
          const scope = agentExecutionScopeSchema.parse(delegated.scope);
          const entry = scope.delegatedScopes.find(candidate => candidate.companyId === delegated.guestCompanyId && candidate.agentPresenceId === delegated.guestAgentId);
          if (!entry || entry.purpose !== delegated.purpose || entry.accessMode !== delegated.accessMode ||
            scope.primaryCompanyId !== delegated.homeCompanyId || scope.primaryAgentPresenceId !== delegated.homeAgentId)
            throw forbidden("Delegated Context is outside its exact execution scope");
          const [home] = await sourceDb.select({ id: heartbeatRuns.id, issueId: heartbeatRuns.issueId, responsibleUserId: heartbeatRuns.responsibleUserId,
            status: heartbeatRuns.status, agentIdentityId: agents.agentIdentityId }).from(heartbeatRuns)
            .innerJoin(agents, and(eq(agents.companyId, heartbeatRuns.companyId), eq(agents.id, heartbeatRuns.agentId)))
            .where(and(eq(heartbeatRuns.companyId, delegated.homeCompanyId), eq(heartbeatRuns.agentId, delegated.homeAgentId),
              eq(heartbeatRuns.id, delegated.homeRunId), eq(heartbeatRuns.status, "running"),
              eq(heartbeatRuns.responsibleUserId, delegated.responsibleUserId))).for("share");
          const [request] = await sourceDb.select().from(agentExecutionScopeRequests).where(and(
            eq(agentExecutionScopeRequests.id, delegated.scopeRequestId), eq(agentExecutionScopeRequests.companyId, delegated.homeCompanyId),
            eq(agentExecutionScopeRequests.agentId, delegated.homeAgentId), eq(agentExecutionScopeRequests.runId, delegated.homeRunId),
            eq(agentExecutionScopeRequests.requestedByUserId, delegated.responsibleUserId),
          )).for("share");
          if (!home || home.agentIdentityId !== delegated.homeAgentIdentityId || !request || request.issueId !== home.issueId ||
            hashContextPolicySnapshot(agentExecutionScopeSchema.parse(request.scope)) !== hashContextPolicySnapshot(scope))
            throw forbidden("Delegated Context requires its exact current home Run and claimed scope request");
          if (delegated.homeActor.type !== "agent" || delegated.homeActor.source !== "agent_jwt" ||
            delegated.homeActor.companyId !== delegated.homeCompanyId || delegated.homeActor.agentId !== delegated.homeAgentId ||
            delegated.homeActor.runId !== delegated.homeRunId || delegated.homeActor.onBehalfOfUserId !== delegated.responsibleUserId)
            throw forbidden("Delegated Context requires its original authenticated home actor");
          const [guest] = await sourceDb.select({ agentIdentityId: agents.agentIdentityId }).from(agents).where(and(
            eq(agents.companyId, delegated.guestCompanyId), eq(agents.id, delegated.guestAgentId))).limit(1);
          if (!guest || guest.agentIdentityId !== delegated.guestAgentIdentityId || guest.agentIdentityId !== home.agentIdentityId)
            throw forbidden("Delegated Context presence identity changed");
          sourceActor = { type:"agent", source:"agent_jwt", companyId:input.companyId, agentId:input.agentId,
            onBehalfOfUserId:delegated.responsibleUserId };
        } else {
          if (!run?.responsibleUserId || (input.responsibleUserId && input.responsibleUserId !== run.responsibleUserId))
            throw forbidden("Context requires its actual accountable run");
          if (input.issueId && input.issueId !== run.issueId) throw forbidden("Context task does not match its actual run");
          issueId = run.issueId;
          sourceActor = {type:"agent",source:"agent_jwt",companyId:input.companyId,agentId:input.agentId,runId:run.id,onBehalfOfUserId:run.responsibleUserId};
        }
        // Retrieval may have waited while membership or sharing changed. The
        // original privacy transaction owns admission of the retained copy.
        const assertScopePrivacy = async () => {
          if (delegated) {
            const [currentRun] = await sourceDb.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
              eq(heartbeatRuns.companyId, delegated.homeCompanyId), eq(heartbeatRuns.id, delegated.homeRunId),
              eq(heartbeatRuns.agentId, delegated.homeAgentId), eq(heartbeatRuns.responsibleUserId, delegated.responsibleUserId),
              eq(heartbeatRuns.status, "running")));
            const [currentRequest] = await sourceDb.select({ id: agentExecutionScopeRequests.id, scope: agentExecutionScopeRequests.scope }).from(agentExecutionScopeRequests).where(and(
              eq(agentExecutionScopeRequests.id, delegated.scopeRequestId), eq(agentExecutionScopeRequests.companyId, delegated.homeCompanyId),
              eq(agentExecutionScopeRequests.agentId, delegated.homeAgentId), eq(agentExecutionScopeRequests.runId, delegated.homeRunId),
              eq(agentExecutionScopeRequests.requestedByUserId, delegated.responsibleUserId)));
            if (!currentRun || !currentRequest || hashContextPolicySnapshot(agentExecutionScopeSchema.parse(currentRequest.scope)) !== hashContextPolicySnapshot(delegated.scope))
              throw forbidden("Delegated Context accountability changed during assembly");
            const { crossCompanyContextService } = await import("../cross-company-context.js");
            await crossCompanyContextService(sourceDb).resolve(delegated.homeActor, delegated.scope, sourceDb);
            const [policyRow] = await sourceDb.select().from(companyCrossCompanyPolicies).where(eq(companyCrossCompanyPolicies.companyId, delegated.guestCompanyId)).limit(1);
            const currentPolicy = crossCompanyPolicySchema.parse(policyRow?.policy ?? {});
            const policyAllowsMode = delegated.accessMode === "read" ? currentPolicy.allowRead : delegated.accessMode === "contribute" ? currentPolicy.allowContribute : currentPolicy.allowAct;
            if (!policyAllowsMode) throw forbidden("Guest company sharing policy changed during Context assembly");
            for (const { decision } of input.selected) {
              if (crossCompanyEvidencePolicy(decision.evidence) !== "allow" || !currentPolicy.allowedSensitivities.includes(decision.evidence.sensitivity as "public" | "internal" | "confidential"))
                throw forbidden("Guest company sharing policy does not allow this Context source");
            }
          } else {
            const [currentRun]=await sourceDb.select({id:heartbeatRuns.id}).from(heartbeatRuns).where(and(
              eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.id,run!.id),
              eq(heartbeatRuns.agentId,input.agentId),eq(heartbeatRuns.responsibleUserId,run!.responsibleUserId!),
            ));
            if(!currentRun)throw forbidden("Context accountable run changed during assembly");
          }
          const admission = await authorizationService(sourceDb).decide({actor:sourceActor,action:"company_scope:read",
            resource:{type:"company",companyId:input.companyId},enforceResponsibleUserIntersection:true});
          if (!admission.allowed) throw forbidden("Context source access is unavailable");
          if ((issueId && !await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:issueId}))
            || (input.runId && !await canActorReadHeartbeatRunPrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:input.runId}))
            || (input.projectId && !await canActorReadProjectPrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:input.projectId})))
            throw forbidden("Context source access is unavailable");
        };
        // Pin current primary/guest authority before touching Task privacy
        // roots, then recheck in the same physical source transaction after
        // the privacy tree is locked.
        if (delegated) await assertScopePrivacy();
        await lockIssuePrivacyTree(tx,input.companyId);
        await assertScopePrivacy();
        const selectedTaskIds: string[] = [];
        const selectedPayloadSnapshots = new Map<string, typeof issues.$inferSelect["payloadSourceSnapshot"]>();
        const sourceKey = (provider: string, ref: string) => `${provider}:${ref.toLowerCase()}`;
        for (const {decision} of input.selected) {
          const evidence = decision.evidence;
          if (evidence.sourceProvider !== "august_works_tasks") continue;
          const ref = /^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(evidence.sourceRef);
          if (!ref) throw forbidden("Context source access is unavailable");
          const [current] = await tx.select({updatedAt:issues.updatedAt,payloadSourceSnapshot:issues.payloadSourceSnapshot}).from(issues)
            .where(and(eq(issues.companyId,input.companyId),eq(issues.id,ref[1]!))).for("share");
          if (!current || !await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:ref[1]!}))
            throw forbidden("Context source access is unavailable");
          if (current.updatedAt.toISOString() !== evidence.sourceVersion)
            throw conflict("Context task changed during assembly");
          selectedTaskIds.push(ref[1]!);
          selectedPayloadSnapshots.set(sourceKey(evidence.sourceProvider,evidence.sourceRef),current.payloadSourceSnapshot);
        }
        // A later selected row may have waited after an earlier source passed.
        await assertScopePrivacy();
        for (const id of selectedTaskIds)
          if (!await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id}))
            throw forbidden("Context source access is unavailable");
        const [manifest] = await tx
          .insert(contextManifests)
          .values({
            companyId: input.companyId,
            runId: input.runId ?? null,
            agentId: input.agentId,
            issueId,
            projectId: input.projectId ?? null,
            queryHash,
            policySnapshotHash,
          })
          .returning();
        // Keep Task source edges tenant-qualified and tied to this exact
        // Context selection. Effect-time output snapshots choose which
        // manifest roots are actually retained by the resulting Task.
        const copiedTaskIds = selectedTaskIds.filter(id => id !== issueId);
        if (issueId && copiedTaskIds.length) await tx.insert(issuePrivacySources).values(copiedTaskIds.map(sourceId => ({
          companyId: input.companyId, issueId, sourceKind: "issue" as const, sourceId, contextManifestId: manifest!.id,
        }))).onConflictDoNothing();

        const values = input.selected.map((selected, rank) => {
          const evidence = selected.decision.evidence;
          return {
            companyId: input.companyId,
            manifestId: manifest!.id,
            sourceClass: evidence.sourceClass,
            sourceProvider: evidence.sourceProvider,
            sourceRef: evidence.sourceRef,
            sourceVersion: evidence.sourceVersion,
            contentHash: hashEvidenceContent(evidence),
            authorityDomain: evidence.authorityDomain,
            trustLevel: evidence.trustLevel,
            sensitivity: evidence.sensitivity,
            rank,
            selectionReason: selected.selectionReason ?? selected.decision.reason,
            retrievalScore: selected.retrievalScore ?? null,
          };
        });

        const learnedRoots = new Map<string, string>();
        const learnedAssets:{type:string;id:string}[]=[];
        const purpose = input.policySnapshot && typeof input.policySnapshot === "object" && "intent" in input.policySnapshot && typeof input.policySnapshot.intent === "string" ? input.policySnapshot.intent : "general_work";
        for (const { decision } of input.selected) {
          const evidence = decision.evidence;
          if (evidence.sourceProvider !== "august_works_foundation") continue;
          const ref = /^foundation:\/\/[a-f0-9-]{36}\/([a-f0-9-]{36})\/(?:\d+|whole)$/i.exec(evidence.sourceRef);
          if (!ref || evidence.sourceVersion !== ref[1]) throw unprocessable("Foundation Context requires its pinned canonical revision");
          learnedAssets.push({type:"document_revision",id:ref[1]!});
          for (const root of await learningAssetRoots(tx as unknown as Db, input.companyId, "document_revision", ref[1]!, purpose,sourceActor,"task")) {
            if (learnedRoots.has(root.id) && learnedRoots.get(root.id) !== root.expectedVersion) throw conflict("Learned Context roots have conflicting versions");
            learnedRoots.set(root.id, root.expectedVersion);
          }
        }
        // Native references and lineage owners define the complete source set.
        // Provider metadata is descriptive; it cannot shrink retained roots.
        const expectedRoots=new Map(learnedRoots);
        const delegatedRootSnapshot: Array<{ memoryRecordId: string; sourceVersion: string; payloadHash: string }> = [];
        let retainedMemoryRoots: (typeof contextManifestMemoryRoots.$inferSelect)[] = [];
        for(const {decision} of input.selected){
          const item=decision.evidence;
          if(item.sourceProvider==="august_works_memory"){
            const ref=/^memory:\/\/record\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
            if(!ref)throw forbidden("Context requires its canonical Memory reference");
            if(!item.sourceVersion || expectedRoots.has(ref[1]!) && expectedRoots.get(ref[1]!)!==item.sourceVersion)
              throw conflict("Context Memory source versions conflict");
            expectedRoots.set(ref[1]!,item.sourceVersion);
          }else if(item.sourceProvider==="august_works_derived_memory"){
            const ref=/^memory:\/\/(memory_model|memory_observation)\/([a-f0-9-]{36})$/i.exec(item.sourceRef);
            if(!ref)throw unprocessable("Derived Context requires its native observation/model reference");
            const roots=await (async()=>{
              if(ref[1]==="memory_model"){
                const [row]=await tx.select().from(memoryModels).where(and(eq(memoryModels.companyId,input.companyId),eq(memoryModels.id,ref[2]!))).for("share");
                if(!row || row.erasedAt || row.status!=="active" || String(row.version)!==item.sourceVersion)
                  throw conflict("Derived Context review changed during assembly");
                return (await modelLineage(sourceDb,sourceActor,row)).roots;
              }
              const [row]=await tx.select().from(memoryObservations).where(and(eq(memoryObservations.companyId,input.companyId),eq(memoryObservations.id,ref[2]!))).for("share");
              if(!row || row.erasedAt || row.status!=="accepted" || String(row.version)!==item.sourceVersion)
                throw conflict("Derived Context review changed during assembly");
              return (await observationLineage(sourceDb,sourceActor,row)).roots;
            })();
            for(const root of roots){
              const version=root.updatedAt.toISOString();
              if(expectedRoots.has(root.id) && expectedRoots.get(root.id)!==version)
                throw conflict("Context Memory source versions conflict");
              expectedRoots.set(root.id,version);
            }
          }
        }
        const rootIds=[...expectedRoots.keys()];
        if(rootIds.length>256)throw forbidden("Complete Context Memory roots exceed their source budget");
        if (rootIds.length) {
          const roots = await tx.select({ id: memoryRecords.id, updatedAt: memoryRecords.updatedAt,scopeType:memoryRecords.scopeType,ownerAgentId:memoryRecords.ownerAgentId,payloadSourceSnapshot:memoryRecords.payloadSourceSnapshot }).from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId), inArray(memoryRecords.id, rootIds), memoryPayloadVisible())).for("share");
          if (roots.length !== rootIds.length) throw forbidden("Context Memory roots cross a company boundary");
          for(const root of roots){
            if(root.scopeType==="agent" && root.ownerAgentId!==input.agentId)
              throw forbidden("Context private Memory belongs to another agent");
            if(!await canActorReadMemorySources(sourceDb,input.companyId,sourceActor,root.id))throw forbidden("Context Memory source access is unavailable");
          }
          if(roots.some(root=>expectedRoots.get(root.id)!==root.updatedAt.toISOString()))
            throw conflict("Context Memory roots changed during assembly");
          // Freeze the selected body's closure under the same version/share
          // pin, including learned/derived roots. NULL history stays unknown.
          for (const root of roots) selectedPayloadSnapshots.set(sourceKey("august_works_memory",`memory://record/${root.id}`),root.payloadSourceSnapshot);
          delegatedRootSnapshot.push(...roots.map(root => ({ memoryRecordId: root.id, sourceVersion: root.updatedAt.toISOString(),
            payloadHash: hashContextPolicySnapshot(root.payloadSourceSnapshot) })));
          retainedMemoryRoots = await tx.insert(contextManifestMemoryRoots).values(roots.map((root) => ({ companyId: input.companyId, manifestId: manifest!.id,
            memoryRecordId: root.id, sourceVersion: root.updatedAt.toISOString(), payloadSourceSnapshot: root.payloadSourceSnapshot }))).returning();
        }

        await retainLearnedAssetsInContext(tx as unknown as Db,input.companyId,sourceActor,manifest!.id,learnedAssets);

        // Insert immutable items after the selected Task and Memory bodies
        // have been pinned. Caller evidence metadata never supplies snapshots.
        const items = values.length > 0
          ? await tx.insert(contextManifestItems).values(values.map(value => ({ ...value,
              payloadSourceSnapshot: selectedPayloadSnapshots.get(sourceKey(value.sourceProvider,value.sourceRef)) ?? null,
            }))).returning()
          : [];

        if (delegated) {
          const sourceSnapshotHash = hashContextPolicySnapshot({ items: input.selected.map(({ decision }, rank) => ({
            rank, sourceProvider: decision.evidence.sourceProvider, sourceRef: decision.evidence.sourceRef,
            sourceVersion: decision.evidence.sourceVersion, contentHash: hashEvidenceContent(decision.evidence),
          })), roots: delegatedRootSnapshot.sort((a, b) => a.memoryRecordId.localeCompare(b.memoryRecordId)) });
          await tx.insert(delegatedContextManifestBindings).values({
            guestCompanyId: delegated.guestCompanyId, contextManifestId: manifest!.id,
            homeCompanyId: delegated.homeCompanyId, homeAgentId: delegated.homeAgentId,
            homeAgentIdentityId: delegated.homeAgentIdentityId, homeRunId: delegated.homeRunId,
            scopeRequestId: delegated.scopeRequestId, responsibleUserId: delegated.responsibleUserId,
            guestAgentId: delegated.guestAgentId, guestAgentIdentityId: delegated.guestAgentIdentityId,
            purpose: delegated.purpose, accessMode: delegated.accessMode,
            scopeSnapshot: agentExecutionScopeSchema.parse(delegated.scope), sourceSnapshotHash,
          });
        }

        await assertScopePrivacy();
        for (const id of selectedTaskIds)
          if (!await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id}))
            throw forbidden("Context source access is unavailable");
        for(const id of rootIds)
          if(!await canActorReadMemorySources(sourceDb,input.companyId,sourceActor,id))
            throw forbidden("Context Memory source access changed during assembly");

        let nativeBootstrapWitness: NativeBootstrapContextWitness | undefined;
        if (nativeBootstrap) {
          if (delegated || !input.runId || !issueId || input.issueId !== issueId)
            throw forbidden("Native bootstrap Context requires its exact same-company accountable Task run");
          const capturedWitness = captureNativeBootstrapContextWitness({ companyId: input.companyId, runId: input.runId,
            agentId: input.agentId, issueId, actor: sourceActor, renderedMarkdown: nativeBootstrap.renderedMarkdown,
            manifest: manifest!, items, roots: retainedMemoryRoots });
          if (capturedWitness) nativeBootstrapWitness = capturedWitness;
        }
        return { manifest: manifest!, items, roots: retainedMemoryRoots, ...(nativeBootstrapWitness ? { nativeBootstrapWitness } : {}) };
      });
    },
  };
}
