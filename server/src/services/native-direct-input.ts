import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { issues, projects, issueComments, documentRevisions, issueDocuments, issueAttachments,
  contextManifests, contextManifestItems, contextManifestMemoryRoots, heartbeatRuns, nativeRunFinalizations,
  authUsers, accountDeletionOperations, agents, companyMemberships, type Db } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput, type NativePayloadSourcePolicy,
  type NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import type { NativeToolEffectClaim } from "../agent-auth-jwt.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface NativeIssueEffectPrefix {
  readonly policy: NativePayloadSourcePolicy;
  readonly inputs: Extract<NativePayloadSourceInput, { kind: "task" }> [];
  readonly runId: string;
}

function effectPrefixRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function effectPrefixCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(effectPrefixCanonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${effectPrefixCanonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Re-read the exact acknowledged first-call prefix under the output transaction.
 * This admits only a single stateless task-only bootstrap. It is not a general
 * completeness claim: later turns, tools, Context, Memory, workspace or runtime
 * inputs remain unknown. */
export async function readNativeIssueEffectPrefix(tx: Transaction, actor: AuthorizationActor,
  claim: NativeToolEffectClaim): Promise<NativeIssueEffectPrefix> {
  const deny = () => forbidden("Native Task input prefix is unavailable");
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || !actor.agentId || !actor.companyId || !actor.runId ||
    claim.tool !== "call_api" || claim.operationId !== "POST /api/companies/{companyId}/issues" || claim.method !== "POST" ||
    claim.pathAndQuery !== `/api/companies/${actor.companyId}/issues` || !claim.bodyPresent ||
    !actor.onBehalfOfUserId || !Number.isFinite(actor.authenticatedCredentialExpiresAt)) throw deny();

  const [credential] = await tx.execute<{ active: boolean }>(sql`select
    ${actor.authenticatedCredentialExpiresAt}::double precision > extract(epoch from clock_timestamp())*1000 as active`);
  if (!credential?.active) throw deny();
  const [user] = await tx.select({ id: authUsers.id }).from(authUsers)
    .where(eq(authUsers.id, actor.onBehalfOfUserId)).for("share");
  const [deletion] = await tx.select({ userId: accountDeletionOperations.userId }).from(accountDeletionOperations)
    .where(eq(accountDeletionOperations.userId, actor.onBehalfOfUserId));
  const memberships = await tx.select({ principalType: companyMemberships.principalType,
    principalId: companyMemberships.principalId, status: companyMemberships.status }).from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, actor.companyId), inArray(companyMemberships.principalId,
      [actor.agentId, actor.onBehalfOfUserId]), inArray(companyMemberships.principalType, ["agent", "user"])))
    .orderBy(companyMemberships.principalType, companyMemberships.principalId).for("share");
  const [agent] = await tx.select({ id: agents.id, status: agents.status }).from(agents)
    .where(and(eq(agents.id, actor.agentId), eq(agents.companyId, actor.companyId))).for("share");
  if (!user || deletion || !agent || agent.status === "terminated" || agent.status === "pending_approval" ||
    !memberships.some(row => row.principalType === "agent" && row.principalId === actor.agentId && row.status === "active") ||
    !memberships.some(row => row.principalType === "user" && row.principalId === actor.onBehalfOfUserId && row.status === "active")) throw deny();

  const [run] = await tx.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.companyId, actor.companyId),
    eq(heartbeatRuns.agentId, actor.agentId), eq(heartbeatRuns.runtimeMode, "native"),
    eq(heartbeatRuns.status, "running"),
  )).for("update");
  if (!run || !run.nativeIssueId || !run.responsibleUserId || run.responsibleUserId !== actor.onBehalfOfUserId ||
    run.nativeInputSourceProtocolVersion !== 1) throw deny();
  const [launch] = await tx.execute<{ id: number }>(sql`select seq as id from heartbeat_run_events
    where company_id=${actor.companyId}::uuid and run_id=${actor.runId}::uuid and agent_id=${actor.agentId}::uuid
      and seq=${claim.eventSeq} and event_type='native.process_start_requested' for share`);
  if (!launch) throw deny();
  const [lease] = await tx.select().from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, actor.companyId), eq(nativeRunFinalizations.runId, actor.runId),
    eq(nativeRunFinalizations.issueId, run.nativeIssueId), eq(nativeRunFinalizations.attempt, claim.attempt),
    eq(nativeRunFinalizations.leaseOwner, claim.leaseOwner), eq(nativeRunFinalizations.controllerBootId, claim.controllerBootId),
    eq(nativeRunFinalizations.controllerPid, claim.controllerPid),
    eq(nativeRunFinalizations.controllerProcessStartedAt, new Date(claim.controllerProcessStartedAt)),
    gte(nativeRunFinalizations.leaseExpiresAt, new Date(claim.leaseExpiresAt)),
    sql`${nativeRunFinalizations.leaseExpiresAt} > clock_timestamp()`,
  )).for("update");
  if (!lease) throw deny();

  const profile = effectPrefixRecord(run.runnerProfileJson);
  const intents = profile.nativeModelInputDispatchIntents;
  const associations = profile.nativeToolCallDispatchAssociations;
  const legacyResults = profile.nativeDocumentToolResultSources;
  const results = profile.nativeToolResultSourceCaptures;
  const attachmentStages = profile.nativeAttachmentStageSources;
  if (!Array.isArray(intents) || intents.length !== 1 || !Array.isArray(associations) || associations.length !== 1 ||
    legacyResults !== undefined || results !== undefined && (!Array.isArray(results) || results.length !== 0) ||
    attachmentStages !== undefined && (!Array.isArray(attachmentStages) || attachmentStages.length !== 0)) throw deny();
  const intent = effectPrefixRecord(intents[0]);
  const association = effectPrefixRecord(associations[0]);
  if (intent.dispatchId !== claim.dispatchId || intent.eventSeq !== claim.eventSeq || intent.attempt !== claim.attempt ||
    intent.turnId !== claim.turnId || intent.responsibleUserId !== run.responsibleUserId || intent.continuation !== false ||
    association.dispatchId !== claim.dispatchId || association.eventSeq !== claim.eventSeq || association.attempt !== claim.attempt ||
    association.turnId !== claim.turnId || association.callId !== claim.callId || association.tool !== "call_api") throw deny();

  const parsedReceipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  if (!parsedReceipt.success || parsedReceipt.data.binding.companyId !== run.companyId || parsedReceipt.data.binding.runId !== run.id ||
    parsedReceipt.data.binding.agentId !== run.agentId || parsedReceipt.data.binding.responsibleUserId !== run.responsibleUserId ||
    parsedReceipt.data.binding.issueId !== run.nativeIssueId || parsedReceipt.data.dispatches.length !== 1 ||
    parsedReceipt.data.additionalInputs.length !== 0) throw deny();
  const receipt = parsedReceipt.data;
  const dispatch = receipt.dispatches[0]!;
  if (dispatch.executionInputDigest !== intent.turnInputDigest ||
    !isDeepStrictEqual({ policy: dispatch.policy, inputs: dispatch.inputs }, { policy: receipt.bootstrap.policy, inputs: receipt.bootstrap.inputs })) throw deny();
  const [receiptDigest] = await tx.execute<{ digest: string }>(sql`select encode(sha256(convert_to(((${JSON.stringify(receipt)}::jsonb)-'digest')::text,'UTF8')),'hex') as digest`);
  if (!receiptDigest || receiptDigest.digest !== receipt.digest) throw deny();
  const [executionDigest] = await tx.execute<{ digest: string }>(sql`select encode(sha256(convert_to((${JSON.stringify(profile.nativeExecutionInput)}::jsonb)::text,'UTF8')),'hex') as digest`);
  if (!executionDigest || executionDigest.digest !== receipt.bootstrap.executionInputDigest) throw deny();

  const resultJson = effectPrefixRecord(run.resultJson);
  const apiReceipts = effectPrefixRecord(resultJson.apiToolReceipts);
  const receiptKey = createHash("sha256").update(claim.callId).digest("hex");
  const apiReceipt = effectPrefixRecord(apiReceipts[receiptKey]);
  if (Object.keys(apiReceipts).length !== 1 || apiReceipt.digest !== claim.apiReceiptDigest || apiReceipt.operationId !== claim.operationId ||
    apiReceipt.state !== "pending" || apiReceipt.nativeEffectClaimConsumed !== true) throw deny();

  const sourceInputs = receipt.bootstrap.inputs;
  if (!sourceInputs.length || sourceInputs.some(input => input.kind !== "task") || receipt.bootstrap.policy.memoryIds.length !== 0 ||
    receipt.bootstrap.policy.foundationRevisionIds.length !== 0) throw deny();
  const taskInputs = sourceInputs as Extract<NativePayloadSourceInput, { kind: "task" }>[];
  const currentPolicy: NativePayloadSourcePolicy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  const mergePolicy = (source: NativePayloadSourcePolicy) => {
    for (const key of Object.keys(currentPolicy) as Array<keyof NativePayloadSourcePolicy>) {
      currentPolicy[key].push(...source[key]);
      currentPolicy[key] = [...new Set(currentPolicy[key])].sort();
    }
  };
  const taskIds = taskInputs.map(input => input.issueId).sort();
  if (new Set(taskIds).size !== taskIds.length) throw deny();
  const taskRows = await tx.select().from(issues).where(and(eq(issues.companyId, actor.companyId), inArray(issues.id, taskIds)))
    .orderBy(issues.id).for("share");
  if (taskRows.length !== taskIds.length) throw deny();
  const { canActorReadIssuePrivacy } = await import("./authorization.js");
  for (const input of taskInputs) {
    const source = taskRows.find(row => row.id === input.issueId);
    if (!source || !Number.isFinite(Number(input.sourceVersion)) ||
      new Date(Number(input.sourceVersion) * 1000).getTime() !== source.updatedAt.getTime() ||
      createHash("sha256").update(JSON.stringify({ id: source.id, identifier: source.identifier, title: source.title,
        description: source.description, workMode: source.workMode }), "utf8").digest("hex") !== input.contentHash ||
      !source.payloadSourceSnapshot || source.payloadSourceSnapshotInvalidated || source.payloadSourceProtocolVersion !== 1 ||
      !await canActorReadIssuePrivacy(tx, actor, source)) throw deny();
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(source.payloadSourceSnapshot);
    if (!snapshot.success || snapshot.data.owner.kind !== "issue" || snapshot.data.owner.id !== source.id ||
      snapshot.data.owner.companyId !== actor.companyId || snapshot.data.inputs.some(item => item.kind !== "task")) throw deny();
    mergePolicy(snapshot.data.policy);
    for (const nested of snapshot.data.inputs) {
      if (nested.kind !== "task") throw deny();
    }
  }
  if (!isDeepStrictEqual(currentPolicy, receipt.bootstrap.policy)) throw deny();
  return { policy: receipt.bootstrap.policy, inputs: taskInputs, runId: run.id };
}

export interface NativeTemporalContextCapture {
  readonly complete: boolean;
  readonly inputs: Extract<NativePayloadSourceInput, { kind: "context" }>[];
  readonly issueIds: string[];
  readonly projectIds: string[];
  readonly memoryIds: string[];
  readonly foundationRevisionIds: string[];
  readonly issueEdges: { issueId: string; manifestId: string }[];
}

function temporalContextContentHash(manifest: typeof contextManifests.$inferSelect,
  items: (typeof contextManifestItems.$inferSelect)[], roots: (typeof contextManifestMemoryRoots.$inferSelect)[]) {
  return createHash("sha256").update(JSON.stringify({
    manifest: { id: manifest.id, companyId: manifest.companyId, runId: manifest.runId, agentId: manifest.agentId,
      issueId: manifest.issueId, projectId: manifest.projectId, queryHash: manifest.queryHash,
      policySnapshotHash: manifest.policySnapshotHash, createdAt: manifest.createdAt.toISOString() },
    items: items.map(item => ({ id: item.id, provider: item.sourceProvider, ref: item.sourceRef,
      version: item.sourceVersion, contentHash: item.contentHash, snapshot: item.payloadSourceSnapshot })),
    roots: roots.map(root => ({ id: root.memoryRecordId, version: root.sourceVersion, snapshot: root.payloadSourceSnapshot })),
  }), "utf8").digest("hex");
}

export async function assertNativeTemporalContextInputsCurrent(db: Db, companyId: string,
  inputs: Extract<NativePayloadSourceInput, { kind: "context" }>[]) {
  if (inputs.length > 64) throw forbidden("Captured Context source set exceeds its bound");
  const ids = inputs.map(input => input.manifestId);
  if (new Set(ids).size !== ids.length) throw forbidden("Captured Context source set is ambiguous");
  const manifests = ids.length ? await db.select().from(contextManifests).where(and(
    eq(contextManifests.companyId, companyId), inArray(contextManifests.id, ids),
  )) : [];
  if (manifests.length !== ids.length) throw forbidden("Captured Context source is unavailable");
  const items = ids.length ? await db.select().from(contextManifestItems).where(and(
    eq(contextManifestItems.companyId, companyId), inArray(contextManifestItems.manifestId, ids),
  )).orderBy(contextManifestItems.manifestId, contextManifestItems.rank, contextManifestItems.id).limit(257) : [];
  const roots = ids.length ? await db.select().from(contextManifestMemoryRoots).where(and(
    eq(contextManifestMemoryRoots.companyId, companyId), inArray(contextManifestMemoryRoots.manifestId, ids),
  )).orderBy(contextManifestMemoryRoots.manifestId, contextManifestMemoryRoots.memoryRecordId).limit(257) : [];
  if (items.length > 256 || roots.length > 256) throw forbidden("Captured Context source set exceeds its bound");
  for (const input of inputs) {
    const manifest=manifests.find(row=>row.id===input.manifestId);
    if (!manifest || manifest.queryHash!==input.queryHash || manifest.policySnapshotHash!==input.policySnapshotHash ||
      temporalContextContentHash(manifest,items.filter(item=>item.manifestId===manifest.id),roots.filter(root=>root.manifestId===manifest.id))!==input.contentHash)
      throw forbidden("Captured Context source changed");
  }
}

/** Capture only same-company persisted Context roots. Unsupported providers keep
 * the legacy live-Run path; this is a temporal source pin, not qualification. */
export async function captureNativeTemporalContext(db: Db, companyId: string, runId: string,
  owner: "issue" | "memory_record"): Promise<NativeTemporalContextCapture> {
  const manifests = await db.select().from(contextManifests).where(and(
    eq(contextManifests.companyId, companyId), eq(contextManifests.runId, runId),
  )).orderBy(contextManifests.createdAt, contextManifests.id).limit(65);
  if (manifests.length > 64) return { complete: false, inputs: [], issueIds: [], projectIds: [], memoryIds: [], foundationRevisionIds: [], issueEdges: [] };
  const ids = manifests.map(row => row.id);
  const items = ids.length ? await db.select().from(contextManifestItems).where(and(
    eq(contextManifestItems.companyId, companyId), inArray(contextManifestItems.manifestId, ids),
  )).orderBy(contextManifestItems.manifestId, contextManifestItems.rank, contextManifestItems.id).limit(257) : [];
  const memoryRoots = ids.length ? await db.select().from(contextManifestMemoryRoots).where(and(
    eq(contextManifestMemoryRoots.companyId, companyId), inArray(contextManifestMemoryRoots.manifestId, ids),
  )).orderBy(contextManifestMemoryRoots.manifestId, contextManifestMemoryRoots.memoryRecordId).limit(257) : [];
  if (items.length > 256 || memoryRoots.length > 256) return { complete: false, inputs: [], issueIds: [], projectIds: [], memoryIds: [], foundationRevisionIds: [], issueEdges: [] };
  const issueIds = new Set<string>(), projectIds = new Set<string>(), memoryIds = new Set<string>(), foundationRevisionIds = new Set<string>();
  const issueEdges: { issueId: string; manifestId: string }[] = [];
  // This helper pins the current Context family only. The native receipt
  // owner does not yet prove complete consumed-input closure across runtime,
  // workspace, history and tool effects, so this cannot seal an output body.
  let complete = false;
  const inputRows: Extract<NativePayloadSourceInput, { kind: "context" }>[] = [];
  for (const manifest of manifests) {
    if (manifest.projectId) projectIds.add(manifest.projectId);
    const manifestItems = items.filter(item => item.manifestId === manifest.id);
    const roots = memoryRoots.filter(root => root.manifestId === manifest.id);
    for (const item of manifestItems) {
      if (item.sourceProvider === "august_works_tasks") {
        const ref = /^issue:\/\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(item.sourceRef);
        if (!ref || !item.sourceVersion || !item.contentHash) complete = false;
        else { issueIds.add(ref[1]!); issueEdges.push({ issueId: ref[1]!, manifestId: manifest.id }); }
      } else if (item.sourceProvider === "august_works_foundation" && owner === "memory_record") {
        const ref = /^foundation:\/\/[0-9a-f-]{36}\/([0-9a-f-]{36})\/(?:\d+|whole)$/i.exec(item.sourceRef);
        if (!ref || item.sourceVersion !== ref[1]) complete = false;
        else foundationRevisionIds.add(ref[1]!);
      } else if (["august_works_memory", "august_works_derived_memory"].includes(item.sourceProvider) && owner === "memory_record") {
        const ref = /^memory:\/\/(?:record|derived)\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(item.sourceRef);
        if (!ref) complete = false;
        else memoryIds.add(ref[1]!);
      } else complete = false;
    }
    if (roots.length && owner !== "memory_record") complete = false;
    roots.forEach(root => memoryIds.add(root.memoryRecordId));
    const contentHash = temporalContextContentHash(manifest, manifestItems, roots);
    inputRows.push({ kind: "context", manifestId: manifest.id, queryHash: manifest.queryHash,
      policySnapshotHash: manifest.policySnapshotHash, contentHash });
  }
  const refs = issueIds.size + projectIds.size + memoryIds.size + foundationRevisionIds.size + inputRows.length;
  if (refs > 256) complete = false;
  return { complete, inputs: complete ? inputRows : [], issueIds: [...issueIds].sort(), projectIds: [...projectIds].sort(),
    memoryIds: [...memoryIds].sort(), foundationRevisionIds: [...foundationRevisionIds].sort(), issueEdges };
}

/** Bind an effect owner's source-policy facts to its actual body hash. The
 * caller must build inputs/policy from locked native source owners. */
export function nativePayloadSnapshotSql(kind: "issue" | "memory_record", policy: NativePayloadSourcePolicy,
  inputs: NativePayloadSourceInput[]) {
  const ownerId = kind === "issue" ? issues.id : sql`memory_records.id`;
  const companyId = kind === "issue" ? issues.companyId : sql`memory_records.company_id`;
  const body = kind === "issue" ? sql`to_jsonb(${issues})` : sql`to_jsonb(memory_records)`;
  const policyJson = JSON.stringify(policy), inputsJson = JSON.stringify(inputs);
  return sql<NativePayloadSourceSnapshot>`(
    with payload as (select jsonb_build_object('version',1,'owner',jsonb_build_object(
      'kind',${kind}::text,'companyId',${companyId}::text,'id',${ownerId}::text,
      'contentHash',public.aw_native_payload_body_hash(${kind}::text,${body})),
      'policy',${policyJson}::jsonb,'inputs',${inputsJson}::jsonb) as value)
    select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload
  )`;
}

/** Used only after the original owner admits an independent direct Human
 * input. This expression binds bytes; it supplies no permission or completeness. */
export function directHumanPayloadSnapshotSql(kind: "issue" | "project" | "comment" | "document_revision" | "attachment") {
  const table = kind === "issue" ? issues : kind === "project" ? projects : kind === "comment" ? issueComments
    : kind === "attachment" ? issueAttachments : documentRevisions;
  const issuePolicy = kind === "comment" ? sql`jsonb_build_array(${issueComments.issueId}::text)`
    : kind === "attachment" ? sql`jsonb_build_array(${issueAttachments.issueId}::text)`
    : kind === "document_revision" ? sql`jsonb_build_array((select d.issue_id::text from ${issueDocuments} d
        where d.company_id=${documentRevisions.companyId} and d.document_id=${documentRevisions.documentId}))`
    : sql`'[]'::jsonb`;
  return sql<NativePayloadSourceSnapshot>`(
    with payload as (select jsonb_build_object('version',1,'owner',jsonb_build_object(
      'kind',${kind}::text,'companyId',${table.companyId}::text,'id',${table.id}::text,
      'contentHash',public.aw_native_payload_body_hash(${kind}::text,to_jsonb(${table}))),
      'policy',jsonb_build_object('issueIds',${issuePolicy},'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
        'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value)
    select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload
  )`;
}

/** The caller retains its actual native User/session pins until commit. */
export async function assertDirectInputSessionCurrent(
  tx: Transaction,
  actor: AuthorizationActor,
  expiresAt: number | null,
  unavailableMessage = "The current manual input session is unavailable",
) {
  if (actor.type !== "board" || !actor.userId || (expiresAt !== null && !Number.isFinite(expiresAt)))
    throw forbidden(unavailableMessage);
  const [current] = await tx.execute<{ active: boolean }>(sql`select
    (${expiresAt}::double precision is null or ${expiresAt}::double precision>extract(epoch from clock_timestamp())*1000)
    and not exists(select 1 from account_deletion_operations where user_id=${actor.userId}) as active`);
  if (!current?.active) throw forbidden(unavailableMessage);
}
