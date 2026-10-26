import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { invalidateCognitiveRecords } from "./cognitive-privacy.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  accountDeletionOperations,
  authSessions,
  authUsers,
  companyMemberships,
  contextManifestItems,
  contextManifestMemoryRoots,
  contextManifests,
  heartbeatRuns,
  issues,
  memoryBindings,
  memoryBindingTargets,
  memoryEvidence,
  memoryPrivateSharePublications,
  memoryRecords,
  memoryDeletionMarkers,
  memoryRetentionPolicies,
  projects,
} from "@paperclipai/db";
import {
  executionPrincipalToActivityActor,
  memoryBindingInputSchema,
  memoryBindingTargetInputSchema,
  memoryCandidateInputSchema,
  memoryCorrectionInputSchema,
  memoryPrivateInputSchema,
  memoryPrivateCorrectionInputSchema,
  memoryReviewInputSchema,
  memoryRevokeInputSchema,
  memoryShareInputSchema,
  memoryRetentionPolicyInputSchema,
  memorySourceDeletionInputSchema,
  memoryDeletionLedgerInputSchema,
  type ExecutionPrincipal,
  type EvidenceSensitivity,
  type MemoryRecordDetail,
  type MemoryCandidateInputParsed,
  type MemoryResolutionMetadata,
  nativePayloadSourceInputSchema,
  nativePayloadSourceSnapshotSchema,
  type NativePayloadSourceInput,
  type NativePayloadSourcePolicy,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { isUniqueViolation } from "../../db-errors.js";
import { lockMemoryPrivacy, assertMemoryOperationRetained, assertMemorySourcesRetained,
  purgeMemoryRecords, memoryDeletionKey, memoryPayloadVisible, reapplyMemoryDeletionMarkers, canActorReadMemorySources, captureMemorySources, capturePrivateShareSource, memoryShareContentFingerprint, withNativeMemoryCaptureSources, type NativeMemoryCaptureReceipt } from "./memory-privacy.js";
import { learningActorFromPrincipal } from "../learning/learning-analytical-sources.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { canActorReadIssuePrivacy, pinCurrentBoardActor, type AuthorizationActor } from "../authorization.js";
import { assertDirectInputSessionCurrent, assertNativeMemoryToolInvocationCurrent, captureNativeTemporalContext, nativePayloadSnapshotSql } from "../native-direct-input.js";
import type { NativeModelOutputCapture } from "../native-runtime/native-execution-input.js";
import {
  lockMemoryResolution,
  resolveMemoryCandidate,
} from "./memory-resolution.js";

export interface MemoryMutationActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
  /** Original server-verified carrier; never request-controlled JSON. */
  authorizationActor?: AuthorizationActor;
  /** Native managed tool capture and invocation ID are server-held only. */
  nativeModelOutputCapture?: NativeModelOutputCapture;
  nativeToolInvocationId?: string;
}

function memorySourceActor(companyId:string,actor:MemoryMutationActor):AuthorizationActor|undefined {
  const current=actor.authorizationActor;
  if(!current)return learningActorFromPrincipal(companyId,actor.principal,actor.runId);
  if(actor.principal.type==="user"&&(current.type!=="board"||current.userId!==actor.principal.userId))
    throw forbidden("Current Human Memory authority changed");
  if(actor.principal.type==="agent"&&(current.type!=="agent"||current.agentId!==actor.principal.agentId
    ||current.onBehalfOfUserId!==actor.principal.responsibleUserId||(actor.runId??null)!==(current.runId??null)
    ||(current.companyId&&current.companyId!==companyId)))throw forbidden("Current Agent Memory authority changed");
  if(actor.principal.type==="system"&&!(actor.principal.service==="local-board"&&current.type==="board"&&current.source==="local_implicit"))
    throw forbidden("Current system Memory authority changed");
  return current;
}

async function assertCurrentMemoryHumanCredential(db:Db,actor:AuthorizationActor,pinned:{credentialExpiresAt:number|null}) {
  const current=await pinCurrentBoardActor(db,actor);
  if(!current||actor.type!=="board"||!actor.userId)throw forbidden("Current Human credential is unavailable");
  const [state]=await db.execute<{active:boolean}>(sql`select
    not exists(select 1 from ${accountDeletionOperations} d where d.user_id=${actor.userId})
    and ${actor.source==="session"&&actor.sessionId?sql`exists(select 1 from ${authSessions} s
      join ${authUsers} u on u.id=s.user_id where s.id=${actor.sessionId} and s.user_id=${actor.userId}
        and s.authenticator_version=u.authenticator_version and s.expires_at>clock_timestamp())`:sql`true`}
    as active`);
  if(!state?.active)throw forbidden("Current Human account or session changed");
  const deadline=pinned.credentialExpiresAt;
  const [currentDeadline]=await db.execute<{active:boolean}>(sql`select
    ${deadline===null?sql`true`:sql`${deadline}::double precision>extract(epoch from clock_timestamp())*1000`} as active`);
  if(!currentDeadline?.active)throw forbidden("The original Human credential expired before review committed");
}

async function captureHumanManualTaskMemorySources(db:Db,companyId:string,principal:ExecutionPrincipal,
  actor:AuthorizationActor|undefined,provenance:Awaited<ReturnType<typeof captureMemorySources>>,
  evidence:Pick<MemoryCandidateInputParsed["evidence"][number],"sourceClass"|"sourceProvider"|"sourceType"|"sourceRef"|"sourceVersion"|"sourceUpdatedAt">[]):Promise<{policy:NativePayloadSourcePolicy;inputs:NativePayloadSourceInput[];
    credentialExpiresAt:number|null}|null> {
  if(principal.type!=="user"||actor?.type!=="board"||actor.userId!==principal.userId||
    (actor.source!=="session"&&actor.source!=="board_key")||!provenance.sourceProvenanceQualified||
    !evidence.length||evidence.some(item=>item.sourceClass!=="task"||item.sourceProvider!=="august_works_tasks"||
      item.sourceType!=="issue"||!item.sourceVersion||item.sourceUpdatedAt!==item.sourceVersion))return null;
  const pinned=await pinCurrentBoardActor(db,actor);
  if(!pinned)return null;
  const [membership]=await db.select({id:companyMemberships.id}).from(companyMemberships).where(and(
    eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalType,"user"),
    eq(companyMemberships.principalId,principal.userId),eq(companyMemberships.status,"active"),
  )).for("share",{noWait:true});
  if(!membership)return null;
  const policy:NativePayloadSourcePolicy={issueIds:[...provenance.sourceIssueIds],projectIds:[...provenance.sourceProjectIds],
    runIds:[...provenance.sourceRunIds],memoryIds:[...provenance.sourceMemoryIds],
    foundationRevisionIds:[...provenance.sourceFoundationRevisionIds]};
  const inputs:NativePayloadSourceInput[]=[];
  for(const item of evidence){
    const ref=/^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
    if(!ref)return null;
    const issueId=ref[1]!;
    const [source]=await db.select({id:issues.id,companyId:issues.companyId,identifier:issues.identifier,title:issues.title,
      description:issues.description,workMode:issues.workMode,updatedAt:issues.updatedAt,
      createdByUserId:issues.createdByUserId,originKind:issues.originKind,
      payloadSourceProtocolVersion:issues.payloadSourceProtocolVersion,
      payloadSourceSnapshot:issues.payloadSourceSnapshot,payloadSourceSnapshotInvalidated:issues.payloadSourceSnapshotInvalidated})
      .from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,issueId))).for("share");
    const snapshot=nativePayloadSourceSnapshotSchema.safeParse(source?.payloadSourceSnapshot);
    const [bodyHash]=await db.execute<{hash:string;snapshotDigestValid:boolean}>(sql`select
      public.aw_native_payload_body_hash('issue',to_jsonb(i)) as hash,
      i.payload_source_snapshot->>'digest'=encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as "snapshotDigestValid"
      from issues i where i.company_id=${companyId}::uuid and i.id=${issueId}::uuid`);
    // Human-created Task roots currently have an empty original dependency
    // set. Nonempty/unsupported Task graphs stay unknown until every family
    // can be revalidated through the same current-source contract.
    if(!source||source.payloadSourceProtocolVersion!==1||source.payloadSourceSnapshotInvalidated||!snapshot.success||snapshot.data.owner.kind!=="issue"||
      snapshot.data.owner.companyId!==companyId||snapshot.data.owner.id!==issueId||!bodyHash||
      !bodyHash.snapshotDigestValid||snapshot.data.owner.contentHash!==bodyHash.hash||source.updatedAt.toISOString()!==item.sourceVersion||
      !source.createdByUserId||source.originKind!=null&&source.originKind!=="manual"||
      Object.values(snapshot.data.policy).some(ids=>ids.length>0)||snapshot.data.inputs.length!==0||
      !await canActorReadIssuePrivacy(db,actor,{companyId,id:issueId}))return null;
    for(const key of Object.keys(policy) as (keyof NativePayloadSourcePolicy)[])
      policy[key]=[...new Set([...policy[key],...snapshot.data.policy[key]])];
    const input:NativePayloadSourceInput={kind:"task",issueId,sourceVersion:item.sourceVersion,
      contentHash:createHash("sha256").update(JSON.stringify({id:issueId,identifier:source.identifier,title:source.title,
        description:source.description,workMode:source.workMode}),"utf8").digest("hex")};
    if(!inputs.some(existing=>JSON.stringify(existing)===JSON.stringify(input)))inputs.push(input);
  }
  if(inputs.length+Object.values(policy).reduce((sum,ids)=>sum+ids.length,0)>256)return null;
  for(const key of Object.keys(policy) as (keyof NativePayloadSourcePolicy)[])
    policy[key]=[...new Set(policy[key])].sort();
  return {policy,inputs,credentialExpiresAt:pinned.credentialExpiresAt};
}

interface SharePrivateMemoryInternalContext {
  operationContextFingerprint?: string | null;
  additionalEvidence?: MemoryCandidateInputParsed["evidence"];
}

function actorIdentity(actor: MemoryMutationActor) {
  const activity = executionPrincipalToActivityActor(actor.principal);
  return {
    actorType: activity.actorType,
    actorId: activity.actorId,
    agentId: actor.principal.type === "agent" ? actor.principal.agentId : null,
    runId: actor.runId ?? null,
    responsibleUserId: activity.responsibleUserId,
  };
}

async function assertActorCompanyScope(
  db: Db,
  companyId: string,
  actor: MemoryMutationActor,
) {
  if (actor.principal.type === "system") return;

  if (actor.principal.type === "agent") {
    const row = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, actor.principal.agentId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw forbidden("Agent does not belong to this company");
    return;
  }

  const membership = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .innerJoin(authUsers,eq(authUsers.id,companyMemberships.principalId))
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.principal.userId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!membership) throw forbidden("User does not have an active company membership");
}

function requireHumanOrSystem(actor: MemoryMutationActor, action: string) {
  if (actor.principal.type === "agent") {
    throw forbidden(`Agents cannot ${action} durable organizational memory`);
  }
}

async function assertPrivacyManagement(db: Db, companyId: string, actor: MemoryMutationActor) {
  await assertActorCompanyScope(db, companyId, actor);
  if (actor.principal.type === "system") return;
  if (actor.principal.type !== "user") throw forbidden("Company privacy management requires a human administrator");
  const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
    eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.principal.userId), eq(companyMemberships.status, "active")));
  if (!membership || !["owner", "admin"].includes(membership.membershipRole ?? "")) throw forbidden("Company privacy management requires an owner or administrator", {
    code: "memory_privacy_management_denied" });
}

function assertPrivateMemoryReadAllowed(
  record: typeof memoryRecords.$inferSelect,
  actor: MemoryMutationActor,
) {
  if (record.scopeType !== "agent") return;
  if (actor.principal.type === "system") return;
  if (
    actor.principal.type === "agent" &&
    record.ownerAgentId === actor.principal.agentId
  ) {
    return;
  }
  throw forbidden("Private agent memory is only visible to its owning agent", {
    code: "private_memory_read_denied",
    ownerAgentId: record.ownerAgentId,
  });
}

async function bindingForCompany(db: Db, companyId: string, bindingId: string) {
  return db
    .select()
    .from(memoryBindings)
    .where(and(eq(memoryBindings.companyId, companyId), eq(memoryBindings.id, bindingId)))
    .then((rows) => rows[0] ?? null);
}

async function assertScopeReferences(
  db: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
) {
  if (input.scope.type === "agent") {
    const agent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, input.scope.id!)))
      .then((rows) => rows[0] ?? null);
    if (!agent) throw unprocessable("Memory scope agent must belong to the company");
  }

  if (input.scope.type === "project") {
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, input.scope.id!)))
      .then((rows) => rows[0] ?? null);
    if (!project) throw unprocessable("Memory scope project must belong to the company");
  }
}

function targetMatchesScope(
  companyId: string,
  target: typeof memoryBindingTargets.$inferSelect,
  input: MemoryCandidateInputParsed,
) {
  if (target.targetType === "company") {
    return (
      target.targetId === companyId &&
      (input.scope.type === "company" || input.scope.type === "subject")
    );
  }
  if (target.targetType === "agent") {
    return input.scope.type === "agent" && target.targetId === input.scope.id;
  }
  if (target.targetType === "project") {
    return input.scope.type === "project" && target.targetId === input.scope.id;
  }
  return false;
}

async function assertBindingAllowsCandidate(
  db: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
) {
  const binding = await bindingForCompany(db, companyId, input.bindingId);
  if (!binding || !binding.enabled) {
    throw forbidden("Memory binding is unavailable for this company");
  }
  const targets = await db
    .select()
    .from(memoryBindingTargets)
    .where(
      and(
        eq(memoryBindingTargets.companyId, companyId),
        eq(memoryBindingTargets.bindingId, binding.id),
      ),
    );
  if (!targets.some((target) => targetMatchesScope(companyId, target, input))) {
    throw forbidden("Memory binding is not authorized for the requested scope");
  }
  return binding;
}

async function assertAgentPrivateOwnership(
  input: MemoryCandidateInputParsed,
  actor: MemoryMutationActor,
) {
  if (
    input.scope.type === "agent" &&
    actor.principal.type === "agent" &&
    input.scope.id !== actor.principal.agentId
  ) {
    throw forbidden("An agent can only create private memory for itself");
  }
}

function assertPrivateMemoryWriter(
  ownerAgentId: string,
  actor: MemoryMutationActor,
) {
  if (actor.principal.type === "system") return;
  if (
    actor.principal.type === "agent" &&
    actor.principal.agentId === ownerAgentId
  ) {
    return;
  }
  throw forbidden("Private agent memory can only be written by its owning agent or the system", {
    code: "private_memory_write_denied",
    ownerAgentId,
  });
}

function privateMemoryEvidenceTrust(
  verificationState: string,
): "high" | "medium" | "low" {
  if (
    verificationState === "human_verified" ||
    verificationState === "system_verified"
  ) {
    return "high";
  }
  return verificationState === "corroborated" ? "medium" : "low";
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalMemoryOperationValue(value: unknown): CanonicalValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unprocessable("Memory operation input contains a non-finite number");
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(canonicalMemoryOperationValue);
  }
  if (typeof value === "object") {
    const result: Record<string, CanonicalValue> = Object.create(null) as Record<
      string,
      CanonicalValue
    >;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalMemoryOperationValue(entry);
    }
    return result;
  }
  throw unprocessable("Memory operation input must be JSON-compatible");
}

function memoryOperationFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalMemoryOperationValue(value)))
    .digest("hex");
}

function metadataForOperationFingerprint(
  rawInput: unknown,
  parsedMetadata: Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof rawInput !== "object" ||
    rawInput === null ||
    Array.isArray(rawInput)
  ) {
    return parsedMetadata;
  }
  const metadataDescriptor = Object.getOwnPropertyDescriptor(rawInput, "metadata");
  const rawMetadata =
    metadataDescriptor && "value" in metadataDescriptor
      ? metadataDescriptor.value
      : null;
  if (
    typeof rawMetadata !== "object" ||
    rawMetadata === null ||
    Array.isArray(rawMetadata)
  ) {
    return parsedMetadata;
  }

  // Zod deliberately normalizes potentially dangerous object keys. The
  // persisted metadata stays normalized, but idempotency must still distinguish
  // two validated requests that differed in an own JSON metadata key such as
  // "__proto__". A null-prototype record avoids invoking prototype setters.
  const fingerprintMetadata = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(parsedMetadata)) {
    fingerprintMetadata[key] = parsedMetadata[key];
  }
  for (const key of Object.keys(rawMetadata as Record<string, unknown>)) {
    const descriptor = Object.getOwnPropertyDescriptor(rawMetadata, key);
    if (!descriptor || !("value" in descriptor) || descriptor.value === undefined) {
      continue;
    }
    fingerprintMetadata[key] = descriptor.value;
  }
  return fingerprintMetadata;
}

async function lockMemoryOperation(
  db: Db,
  companyId: string,
  operationId: string,
) {
  await lockAnalyticalCompany(db,companyId); await lockMemoryPrivacy(db,companyId);
  await db.execute(
    sql`select pg_advisory_xact_lock(
      hashtextextended(${`memory:operation:${companyId}:${operationId}`}, 0)
    )`,
  );
}

async function memoryRecordForOperation(
  db: Db,
  companyId: string,
  operationId: string,
  actor: MemoryMutationActor,
) {
  await assertMemoryOperationRetained(db, companyId, operationId);
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.companyId, companyId),
        eq(memoryRecords.createdByOperationId, operationId),
        memoryPayloadVisible(),
      ),
    )
    .limit(2);
  if (rows.length > 1) {
    throw conflict("Memory operation id is already associated with multiple records", {
      code: "memory_operation_ambiguous",
      operationId,
    });
  }
  if(rows[0])await assertMemorySourceAccess(db,companyId,rows[0].id,actor);
  return rows[0] ?? null;
}

function metadataFingerprint(
  record: typeof memoryRecords.$inferSelect,
  key: string,
): string | null {
  const value = record.metadata[key];
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    ? value
    : null;
}


function recordDetail(
  record: typeof memoryRecords.$inferSelect,
  evidence: (typeof memoryEvidence.$inferSelect)[],
) {
  return { record, evidence };
}

async function getRecordDetail(db: Db, companyId: string, recordId: string, budget: MemoryReadBudget = {}) {
  const bounded = budget.deadlineAt !== undefined || budget.signal !== undefined;
  if (bounded) await setMemoryReadStatementBudget(db, budget);
  const record = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.companyId, companyId),
        eq(memoryRecords.id, recordId),
        memoryPayloadVisible(),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!record) return null;
  if (bounded) await setMemoryReadStatementBudget(db, budget);
  const evidence = await db
    .select()
    .from(memoryEvidence)
    .where(
      and(
        eq(memoryEvidence.companyId, companyId),
        eq(memoryEvidence.memoryRecordId, recordId),
      ),
    )
    .orderBy(memoryEvidence.createdAt);
  if (bounded) await setMemoryReadStatementBudget(db, budget);
  const [share]=await db.select({state:memoryPrivateSharePublications.state,targetScopeType:memoryPrivateSharePublications.targetScopeType,
    targetScopeId:memoryPrivateSharePublications.targetScopeId}).from(memoryPrivateSharePublications).where(and(
      eq(memoryPrivateSharePublications.companyId,companyId),eq(memoryPrivateSharePublications.sharedRecordId,recordId)));
  const scopeType=share?.targetScopeType;
  const safeScope:MemoryRecordDetail["privateShareReview"]=share&&(scopeType==="company"||scopeType==="project"||scopeType==="subject")
    ? {state:share.state,targetScopeType:scopeType,targetScopeId:share.targetScopeId}:undefined;
  return { ...recordDetail(record, evidence), ...(safeScope?{privateShareReview:safeScope}:{}) };
}

type MemoryReadBudget = { signal?: AbortSignal; deadlineAt?: number };
function assertMemoryReadActive(budget: MemoryReadBudget = {}) {
  if (budget.signal?.aborted) throw budget.signal.reason ?? new Error("Memory retrieval was cancelled");
  if (budget.deadlineAt !== undefined && budget.deadlineAt <= Date.now())
    throw new Error("Memory retrieval deadline exceeded");
}
async function setMemoryReadStatementBudget(db: Db, budget: MemoryReadBudget = {}) {
  assertMemoryReadActive(budget);
  const remaining = budget.deadlineAt === undefined ? 8_000 : Math.min(8_000, budget.deadlineAt - Date.now());
  if (remaining <= 0) throw new Error("Memory retrieval deadline exceeded");
  await db.execute(sql`select set_config('statement_timeout', ${`${Math.max(1, Math.floor(remaining))}ms`}, true)`);
  assertMemoryReadActive(budget);
}
async function visibleMemorySources(db:Db,companyId:string,rows:(typeof memoryRecords.$inferSelect)[],actor:MemoryMutationActor,
  budget: MemoryReadBudget = {}) {
  const reader=memorySourceActor(companyId,actor),visible:typeof rows=[];
  for(const row of rows) {
    assertMemoryReadActive(budget);
    if(await canActorReadMemorySources(db,companyId,reader,row.id,budget))visible.push(row);
  }
  return visible;
}
// Apply the public result limit after source qualification. Stable batches
// avoid loading the company's complete Memory merely to find its first match.
async function visibleMemoryPage(db:Db,companyId:string,actor:MemoryMutationActor,limit:number,
  page:(db:Db,offset:number)=>Promise<(typeof memoryRecords.$inferSelect)[]>, budget: MemoryReadBudget = {},
  candidateFilter?: (record: typeof memoryRecords.$inferSelect) => boolean) {
  return db.transaction(async rawTx=>{
    const tx=rawTx as unknown as Db;
    await setMemoryReadStatementBudget(tx, budget);
    await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId);
    await setMemoryReadStatementBudget(tx, budget);
    await assertActorCompanyScope(tx,companyId,actor);
    const deadline=performance.now()+8000;
    const visible:(typeof memoryRecords.$inferSelect)[]=[];
    for(let offset=0;;offset+=100){
      await setMemoryReadStatementBudget(tx, budget);
      const rows=await page(tx,offset);
      const candidates=candidateFilter ? rows.filter(candidateFilter) : rows;
      visible.push(...await visibleMemorySources(tx,companyId,candidates,actor,budget));
      if(performance.now()>deadline)throw conflict("Complete Memory source review exceeded its budget");
      if(visible.length>=limit || rows.length<100){
        // A later source may wait while an earlier reader grant is withdrawn.
        const current=await visibleMemorySources(tx,companyId,visible.slice(0,limit),actor,budget);
        if(performance.now()>deadline)throw conflict("Complete Memory source review exceeded its budget");
        return current;
      }
    }
  });
}
async function assertMemorySourceAccess(db:Db,companyId:string,recordId:string,actor:MemoryMutationActor) {
  if(!await canActorReadMemorySources(db,companyId,memorySourceActor(companyId,actor),recordId))throw notFound("Memory record not found");
}
async function requireCurrentMemoryDetail(db:Db,companyId:string,recordId:string,actor:MemoryMutationActor):Promise<NonNullable<Awaited<ReturnType<typeof getRecordDetail>>>> {
  const nativeOutputCapture = actor.nativeModelOutputCapture;
  const nativeToolInvocationId = actor.nativeToolInvocationId;
  if (nativeOutputCapture) {
    return db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db;
      await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
      const outputActor = memorySourceActor(companyId, actor);
      const capture = nativeOutputCapture;
      const use = capture.managedOpenCodeToolUse;
      const [run] = await tx.select({ issueId: heartbeatRuns.nativeIssueId }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, capture.runId)));
      if (!outputActor || outputActor.type !== "agent" || !run?.issueId || !use || !nativeToolInvocationId ||
        actor.principal.type !== "agent") throw notFound("Memory record not found");
      await assertNativeMemoryToolInvocationCurrent(tx, { companyId, issueId: run.issueId,
        actor: outputActor, capture, invocationId: nativeToolInvocationId, status: "executing" });
      const detail = await getRecordDetail(tx, companyId, recordId);
      const record = detail?.record;
      const metadata = record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown> : null;
      if (!record || record.createdByActorType !== "agent" || record.createdByActorId !== actor.principal.agentId ||
        record.payloadSourceProtocolVersion !== 1 || record.payloadSourceSnapshot !== null || !metadata ||
        metadata.nativeManagedMemoryInvocationId !== nativeToolInvocationId ||
        metadata.nativeManagedMemoryCallId !== use.callId || metadata.nativeManagedMemoryArgumentsHash !== use.argumentsHash)
        throw notFound("Memory record not found");
      return detail!;
    });
  }
  const detail=await memoryService(db).get(companyId,recordId,actor);
  if(!detail)throw notFound("Memory record not found");
  return detail;
}

async function persistedActivityRunId(
  db: Db,
  companyId: string,
  runId: string | null,
): Promise<string | null> {
  if (!runId) return null;
  return db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)))
    .then((rows) => rows[0]?.id ?? null);
}

async function persistMemoryActivity(
  db: Db,
  actor: MemoryMutationActor,
  input: {
    companyId: string;
    action: string;
    recordId: string;
    details?: Record<string, unknown>;
  },
): Promise<ActivityPublication> {
  const identity = actorIdentity(actor);
  const runId = await persistedActivityRunId(
    db,
    input.companyId,
    identity.runId,
  );
  const result = await persistActivity(db, {
    companyId: input.companyId,
    actorType: identity.actorType,
    actorId: identity.actorId,
    agentId: identity.agentId,
    runId,
    responsibleUserIdOverride: identity.responsibleUserId,
    action: input.action,
    entityType: "memory_record",
    entityId: input.recordId,
    details: input.details ?? null,
  });
  return result.publication;
}

async function insertEvidenceRows(
  tx: Db,
  companyId: string,
  memoryRecordId: string,
  evidence: MemoryCandidateInputParsed["evidence"],
): Promise<void> {
  if (evidence.length === 0) return;
  await tx.insert(memoryEvidence).values(
    evidence.map((item) => ({
      companyId,
      memoryRecordId,
      sourceClass: item.sourceClass,
      sourceProvider: item.sourceProvider,
      sourceType: item.sourceType,
      sourceRef: item.sourceRef,
      sourceVersion: item.sourceVersion,
      sourceUpdatedAt: item.sourceUpdatedAt
        ? new Date(item.sourceUpdatedAt)
        : null,
      observedAt: new Date(item.observedAt),
      excerptHash: item.excerptHash,
      citationJson: item.citation,
      trustLevel: item.trustLevel,
      supportsOrContradicts: item.relation,
    })),
  );
}

function withResolution<T extends { record: unknown; evidence: unknown[] }>(
  detail: T,
  resolution: MemoryResolutionMetadata,
) {
  return { ...detail, resolution };
}

async function insertCandidate(
  tx: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
  actor: MemoryMutationActor,
  supersedesRecordId: string | null,
  state: {
    reviewState?: "pending" | "accepted";
    verificationState?:
      | "unverified"
      | "corroborated"
      | "human_verified"
      | "system_verified";
    sourceMemoryIds?: string[];
    sourceProvenance?: Awaited<ReturnType<typeof captureMemorySources>>;
    humanCredential?: { actor: AuthorizationActor; credentialExpiresAt: number|null };
  } = {},
) {
  await assertMemorySourcesRetained(tx, companyId, input.evidence);
  await assertActorCompanyScope(tx, companyId, actor);
  await assertSaasDomainAdmission(tx, companyId, "memory.use");
  await assertScopeReferences(tx, companyId, input);
  await assertAgentPrivateOwnership(input, actor);
  const binding = await assertBindingAllowsCandidate(tx, companyId, input);
  if (input.createdByOperationId) {
    await lockMemoryOperation(tx, companyId, input.createdByOperationId);
    const existingOperation = await memoryRecordForOperation(
      tx,
      companyId,
      input.createdByOperationId,
      actor,
    );
    if (existingOperation) {
      throw conflict("Memory operation id is already associated with a record", {
        code: "memory_operation_conflict",
        operationId: input.createdByOperationId,
        existingRecordId: existingOperation.id,
      });
    }
  }
  const identity = actorIdentity(actor);
  const now = new Date();
  let sourceProvenance=state.sourceProvenance??await captureMemorySources(tx,companyId,memorySourceActor(companyId,actor),input.scope,
    [...(supersedesRecordId?[supersedesRecordId]:[]),...(state.sourceMemoryIds??[])], input.evidence);
  const outputCapture = actor.nativeModelOutputCapture;
  const memoryMetadata: Record<string, unknown> = { ...input.metadata };
  delete memoryMetadata.nativeManagedMemoryInvocationId;
  delete memoryMetadata.nativeManagedMemoryCallId;
  delete memoryMetadata.nativeManagedMemoryArgumentsHash;
  let outputIssueId: string | null = null;
  if (outputCapture) {
    const outputActor = memorySourceActor(companyId, actor);
    outputIssueId = outputActor?.type === "agent" ? outputActor.companyId === companyId
      ? (await tx.select({ issueId: heartbeatRuns.nativeIssueId }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, outputCapture.runId),
        )))[0]?.issueId : null : null;
    if (!outputActor || !outputIssueId || !actor.nativeToolInvocationId || actor.runId !== outputCapture.runId)
      throw forbidden("Native Memory output binding is unavailable");
    await assertNativeMemoryToolInvocationCurrent(tx, { companyId, issueId: outputIssueId, actor: outputActor,
      capture: outputCapture, invocationId: actor.nativeToolInvocationId, status: "executing" });
    // The producer Run is retained so deleting it scrubs the copy. It is not
    // a whole-Run read dependency unless the exact captured policy says so.
    sourceProvenance = { ...sourceProvenance, sourceProvenanceQualified: true,
      sourceRunIds: [...new Set([...outputCapture.sourceSet.policy.runIds, outputCapture.runId])].sort(),
      sourceIssueIds: [...outputCapture.sourceSet.policy.issueIds],
      sourceProjectIds: [...outputCapture.sourceSet.policy.projectIds],
      sourceMemoryIds: [...outputCapture.sourceSet.policy.memoryIds],
      sourceFoundationRevisionIds: [...outputCapture.sourceSet.policy.foundationRevisionIds] };
    memoryMetadata.nativeManagedMemoryInvocationId = actor.nativeToolInvocationId;
    memoryMetadata.nativeManagedMemoryCallId = outputCapture.managedOpenCodeToolUse!.callId;
    memoryMetadata.nativeManagedMemoryArgumentsHash = outputCapture.managedOpenCodeToolUse!.argumentsHash;
  }
  const temporalContext = actor.principal.type === "agent" && actor.runId && sourceProvenance.sourceProvenanceQualified
    ? await captureNativeTemporalContext(tx, companyId, actor.runId, "memory_record") : null;
  const humanTaskSources = outputCapture ? null : await captureHumanManualTaskMemorySources(tx,companyId,actor.principal,
    memorySourceActor(companyId,actor),sourceProvenance,input.evidence);
  if(humanTaskSources&&actor.authorizationActor)state.humanCredential={actor:actor.authorizationActor,
    credentialExpiresAt:humanTaskSources.credentialExpiresAt};
  const temporalContextPolicy = {
    issueIds: sourceProvenance.sourceIssueIds, projectIds: sourceProvenance.sourceProjectIds,
    runIds: sourceProvenance.sourceRunIds, memoryIds: sourceProvenance.sourceMemoryIds,
    foundationRevisionIds: sourceProvenance.sourceFoundationRevisionIds,
  };
  const snapshotPolicy = outputCapture?.sourceSet.policy ?? humanTaskSources?.policy ?? temporalContextPolicy;
  const snapshotInputs = outputCapture ? [...outputCapture.sourceSet.inputs, outputCapture.dispatch] : humanTaskSources?.inputs ?? temporalContext?.inputs ?? [];
  const freezeTemporalContext = !!outputCapture || !!humanTaskSources || !!temporalContext?.complete && temporalContext.inputs.length + temporalContextPolicy.issueIds.length +
    temporalContextPolicy.projectIds.length + temporalContextPolicy.runIds.length + temporalContextPolicy.memoryIds.length +
    temporalContextPolicy.foundationRevisionIds.length <= 256;

  const [record] = await tx
    .insert(memoryRecords)
    .values({
      companyId,
      bindingId: binding.id,
      providerKey: binding.providerKey,
      memoryType: input.memoryType,
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      ownerAgentId: input.ownerAgentId,
      title: input.title,
      content: input.content,
      summary: input.summary,
      reviewState: state.reviewState ?? "pending",
      verificationState: state.verificationState ?? "unverified",
      sensitivityLabel: input.sensitivity,
      importance: input.importance,
      confidenceScore: input.confidenceScore,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      observedAt: new Date(input.observedAt),
      retentionPolicy: input.retentionPolicy,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      retentionState: "active",
      supersedesRecordId,
      supersededByRecordId: null,
      createdByActorType: identity.actorType,
      createdByActorId: identity.actorId,
      createdByOperationId: input.createdByOperationId,
      ...sourceProvenance,
      ...(freezeTemporalContext ? { payloadSourceProtocolVersion: 1, payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: false } : {}),
      metadata: memoryMetadata,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!record) throw new Error("Memory candidate insert returned no row");

  let persistedRecord=record;
  await insertEvidenceRows(tx, companyId, record.id, input.evidence);
  if (freezeTemporalContext && !outputCapture) {
    const [captured] = await tx.update(memoryRecords).set({ payloadSourceSnapshot: nativePayloadSnapshotSql(
      "memory_record", snapshotPolicy, snapshotInputs,
    ) }).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, record.id),
      eq(memoryRecords.payloadSourceProtocolVersion, 1), isNull(memoryRecords.payloadSourceSnapshot),
      eq(memoryRecords.payloadSourceSnapshotInvalidated, false))).returning();
    if (!captured?.payloadSourceSnapshot) throw conflict("Temporal Memory source capture was not stored");
    persistedRecord=captured;
  }

  // Every new-row producer shares this final effect admission. An INSERT can
  // wait on a foreign key after capture, while its Agent/Human loses authority.
  if (outputCapture) {
    const outputActor = memorySourceActor(companyId, actor);
    if (!outputActor || !outputIssueId || !actor.nativeToolInvocationId) throw forbidden("Native Memory output binding is unavailable");
    await assertNativeMemoryToolInvocationCurrent(tx, { companyId, issueId: outputIssueId, actor: outputActor,
      capture: outputCapture, invocationId: actor.nativeToolInvocationId, status: "executing" });
  } else if(!await canActorReadMemorySources(tx,companyId,memorySourceActor(companyId,actor),record.id))
    throw forbidden("Memory candidate source access is unavailable");
  if(state.humanCredential){
    await assertCurrentMemoryHumanCredential(tx,state.humanCredential.actor,state.humanCredential);
  }

  return persistedRecord;
}

/** Attach the completed canonical Gateway result to a Memory output after its
 * server-owned invocation row reaches succeeded. Failed/unsettled calls keep
 * their earlier prefix fail-closed and cannot gain a completed result edge. */
export async function sealNativeMemoryToolResultSnapshot(db: Db, input: {
  companyId: string; recordId: string; actor: MemoryMutationActor; resultHash: string;
}) {
  const capture = input.actor.nativeModelOutputCapture;
  const invocationId = input.actor.nativeToolInvocationId;
  const actor = memorySourceActor(input.companyId, input.actor);
  if (!capture || !invocationId || actor?.type !== "agent" || !input.actor.runId)
    throw forbidden("Native Memory output binding is unavailable");
  return db.transaction(async tx => {
    const [run] = await tx.select({ issueId: heartbeatRuns.nativeIssueId }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, capture.runId),
    ));
    if (!run?.issueId) throw forbidden("Native Memory output owner is unavailable");
    await assertNativeMemoryToolInvocationCurrent(tx, { companyId: input.companyId, issueId: run.issueId,
      actor, capture, invocationId, status: "succeeded", resultHash: input.resultHash });
    const [record] = await tx.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId),
      eq(memoryRecords.id, input.recordId), eq(memoryRecords.createdByActorType, "agent"),
      eq(memoryRecords.createdByActorId, actor.agentId!), eq(memoryRecords.sourceProvenanceQualified, true),
      eq(memoryRecords.payloadSourceProtocolVersion, 1), isNull(memoryRecords.payloadSourceSnapshot),
      eq(memoryRecords.payloadSourceSnapshotInvalidated, false)));
    const metadata = record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown> : null;
    if (!record || metadata?.nativeManagedMemoryInvocationId !== invocationId ||
      metadata.nativeManagedMemoryCallId !== capture.managedOpenCodeToolUse!.callId ||
      metadata.nativeManagedMemoryArgumentsHash !== capture.managedOpenCodeToolUse!.argumentsHash)
      throw forbidden("Native Memory output is no longer eligible for source binding");
    const inputs: NativePayloadSourceInput[] = [...capture.sourceSet.inputs, capture.dispatch];
    const [sealed] = await tx.update(memoryRecords).set({ payloadSourceSnapshot: nativePayloadSnapshotSql(
      "memory_record", capture.sourceSet.policy, inputs,
    ) }).where(and(eq(memoryRecords.companyId, input.companyId), eq(memoryRecords.id, record.id),
      eq(memoryRecords.payloadSourceProtocolVersion, 1), isNull(memoryRecords.payloadSourceSnapshot),
      eq(memoryRecords.payloadSourceSnapshotInvalidated, false))).returning({ snapshot: memoryRecords.payloadSourceSnapshot });
    if (!nativePayloadSourceSnapshotSchema.safeParse(sealed?.snapshot).success)
      throw forbidden("Native Memory output source binding could not be sealed");
    return sealed.snapshot;
  });
}

export interface MemoryServiceOptions {
  postCommitPublications?: ActivityPublication[];
  nativeCaptureReceipt?: NativeMemoryCaptureReceipt;
}

export function memoryService(db: Db, options: MemoryServiceOptions = {}) {
  const publishOrDefer = (publications: ActivityPublication[]) => {
    if (options.postCommitPublications) options.postCommitPublications.push(...publications);
    else publications.forEach(publishActivity);
  };
  async function runCandidate(
      companyId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
      sourceMemoryIds: string[],
      nativeCapture: boolean,
    ) {
      const parsed = memoryCandidateInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory candidate", parsed.error.issues);
      }

      const fingerprint=parsed.data.metadata.postRunExtractionFingerprint;
      if(nativeCapture && (!options.nativeCaptureReceipt || !options.postCommitPublications || !parsed.data.createdByOperationId
        || typeof fingerprint!=="string" || !/^[0-9a-f]{64}$/.test(fingerprint)))
        throw forbidden("Native Memory capture requires its server receipt and input fingerprint");
      const publications: ActivityPublication[] = [];
      const outcome = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockAnalyticalCompany(txDb,companyId);
        await lockMemoryPrivacy(txDb,companyId);
        const inspect=async()=>{

        // Authorize before classification so the resolver can never become a
        // cross-tenant or cross-scope record oracle.
        await assertActorCompanyScope(txDb, companyId, actor);
        await assertScopeReferences(txDb, companyId, parsed.data);
        await assertAgentPrivateOwnership(parsed.data, actor);
        await assertBindingAllowsCandidate(txDb, companyId, parsed.data);
        await lockAnalyticalCompany(txDb,companyId);
        await assertMemorySourcesRetained(txDb, companyId, parsed.data.evidence);

        // Preserve the existing operation-id contract before semantic
        // resolution. Reusing one operation id with any prior persisted record
        // remains a conflict even when the new payload happens to be similar.
        if (parsed.data.createdByOperationId) {
          await lockMemoryOperation(
            txDb,
            companyId,
            parsed.data.createdByOperationId,
          );
          const existingOperation = await memoryRecordForOperation(
            txDb,
            companyId,
            parsed.data.createdByOperationId,
            actor,
          );
          if (existingOperation) {
            if(nativeCapture){
              if(existingOperation.metadata.postRunExtractionFingerprint!==fingerprint)
                throw conflict("Memory operation id is already associated with a record",{code:"memory_operation_conflict"});
              return {recordId:existingOperation.id,resolution:null,replayed:true as const};
            }
            throw conflict(
              "Memory operation id is already associated with a record",
              {
                code: "memory_operation_conflict",
                operationId: parsed.data.createdByOperationId,
                existingRecordId: existingOperation.id,
              },
            );
          }
        }

        await lockMemoryResolution(txDb, companyId, parsed.data);
        const resolution = await resolveMemoryCandidate(
          txDb,
          companyId,
          parsed.data,
          {actor:memorySourceActor(companyId,actor)},
        );

        const attachesToExistingPendingContradiction =
          resolution.metadata.kind === "contradiction" &&
          resolution.metadata.reasonCode ===
            "contradicting_evidence_against_pending_equivalent_claim";

        if (actor.nativeModelOutputCapture && (resolution.metadata.kind === "duplicate" ||
          resolution.metadata.kind === "corroboration" || attachesToExistingPendingContradiction)) {
          throw conflict("A Native Memory output must remain a new private record or pending shared proposal", {
            code: "native_memory_output_requires_new_draft",
          });
        }

        if (
          resolution.metadata.kind === "duplicate" ||
          resolution.metadata.kind === "corroboration" ||
          attachesToExistingPendingContradiction
        ) {
          const resolvedTarget = resolution.target;
          if (!resolvedTarget) {
            throw new Error(
              `Memory ${resolution.metadata.kind} resolution is missing its target record`,
            );
          }
          const [target] = await txDb.select().from(memoryRecords).where(and(
            eq(memoryRecords.companyId,companyId),eq(memoryRecords.id,resolvedTarget.id),memoryPayloadVisible(),
          )).for("update");
          if(!target || target.updatedAt.getTime()!==resolvedTarget.updatedAt.getTime())
            throw conflict("Memory resolution target changed before attachment",{code:"memory_resolution_conflict"});
          await assertMemorySourceAccess(txDb,companyId,target.id,actor);
          const [privateShareCopy]=await txDb.select({id:memoryPrivateSharePublications.sharedRecordId}).from(memoryPrivateSharePublications).where(and(
            eq(memoryPrivateSharePublications.companyId,companyId),eq(memoryPrivateSharePublications.sharedRecordId,target.id)));

          const oldSnapshot=nativePayloadSourceSnapshotSchema.safeParse(target.payloadSourceSnapshot);
          const manualSnapshot=oldSnapshot.success?oldSnapshot.data:null;
          const targetMetadata=target.metadata&&typeof target.metadata==="object"&&!Array.isArray(target.metadata)
            ?target.metadata as Record<string,unknown>:{};
          const humanManualTaskTarget=actor.principal.type==="user"&&actor.authorizationActor?.type==="board"
            &&actor.authorizationActor.userId===actor.principal.userId&&target.createdByActorType==="user"
            &&target.sourceProvenanceQualified&&target.payloadSourceProtocolVersion===1&&!target.payloadSourceSnapshotInvalidated&&manualSnapshot!==null
            &&manualSnapshot.owner.kind==="memory_record"&&manualSnapshot.owner.companyId===companyId
            &&manualSnapshot.owner.id===target.id&&manualSnapshot.inputs.length>0
            &&manualSnapshot.inputs.every(item=>item.kind==="task")
            &&Object.entries(manualSnapshot.policy).every(([key,ids])=>key==="issueIds"||ids.length===0)
            &&targetMetadata.nativeManagedMemoryInvocationId===undefined
            &&targetMetadata.nativeManagedMemoryCallId===undefined
            &&targetMetadata.nativeManagedMemoryArgumentsHash===undefined;
          const priorTaskEvidence=humanManualTaskTarget?await txDb.select({sourceClass:memoryEvidence.sourceClass,
            sourceProvider:memoryEvidence.sourceProvider,sourceType:memoryEvidence.sourceType,sourceRef:memoryEvidence.sourceRef,
            sourceVersion:memoryEvidence.sourceVersion,sourceUpdatedAt:memoryEvidence.sourceUpdatedAt,
            observedAt:memoryEvidence.observedAt,excerptHash:memoryEvidence.excerptHash,
            citation:memoryEvidence.citationJson,trustLevel:memoryEvidence.trustLevel,
            relation:memoryEvidence.supportsOrContradicts})
            .from(memoryEvidence).where(and(eq(memoryEvidence.companyId,companyId),eq(memoryEvidence.memoryRecordId,target.id))):[];
          const allTaskEvidence=[...priorTaskEvidence.map(item=>({...item,sourceUpdatedAt:item.sourceUpdatedAt?.toISOString()??null,
            observedAt:item.observedAt.toISOString()})),
            ...resolution.novelEvidence];
          const provenance=await captureMemorySources(txDb,companyId,memorySourceActor(companyId,actor),parsed.data.scope,
            [...sourceMemoryIds,...(humanManualTaskTarget?target.sourceMemoryIds:[])],humanManualTaskTarget?allTaskEvidence:[]);
          if(provenance.sourceMemoryIds.includes(target.id)){
            // Only the exact current native selection can be a no-op input to
            // its own unchanged claim. Caller IDs and old receipts cannot erase
            // a dependency; all other captured roots remain in the union.
            if(actor.principal.type!=="agent" || !actor.runId)
              throw conflict("Memory self-source requires its current native selection",{code:"memory_resolution_source_conflict"});
            const version=target.updatedAt.toISOString();
            const receipts=await txDb.select({version:contextManifestMemoryRoots.sourceVersion,pinned:sql<boolean>`exists(
              select 1 from ${contextManifestItems} item where item.company_id=${companyId}::uuid
                and item.manifest_id=${contextManifestMemoryRoots.manifestId} and item.source_provider='august_works_memory'
                and item.source_ref=${`memory://record/${target.id}`} and item.source_version=${version})`})
              .from(contextManifestMemoryRoots).innerJoin(contextManifests,and(
                eq(contextManifests.companyId,contextManifestMemoryRoots.companyId),eq(contextManifests.id,contextManifestMemoryRoots.manifestId),
              )).where(and(eq(contextManifests.companyId,companyId),eq(contextManifests.runId,actor.runId),
                eq(contextManifests.agentId,actor.principal.agentId),eq(contextManifestMemoryRoots.memoryRecordId,target.id))).limit(65);
            if(!receipts.length || receipts.length>64 || receipts.some(receipt=>receipt.version!==version || !receipt.pinned))
              throw conflict("Memory self-source selection changed before attachment",{code:"memory_resolution_source_conflict"});
            provenance.sourceMemoryIds=provenance.sourceMemoryIds.filter(id=>id!==target.id);
          }
          const sourceKeys=["sourceRunIds","sourceIssueIds","sourceProjectIds","sourceMemoryIds","sourceFoundationRevisionIds"] as const;
          const shareCopyHasOnlyIncidentalRunRoots=!!privateShareCopy&&resolution.metadata.kind==="duplicate"
            && target.sourceProvenanceQualified===provenance.sourceProvenanceQualified
            && !provenance.sourceIssueIds.some(id=>!target.sourceIssueIds.includes(id))
            && !provenance.sourceProjectIds.some(id=>!target.sourceProjectIds.includes(id))
            && !provenance.sourceFoundationRevisionIds.some(id=>!target.sourceFoundationRevisionIds.includes(id))
            && !provenance.sourceMemoryIds.some(id=>id!==target.id&&!target.sourceMemoryIds.includes(id));
          const sourceChanges=!shareCopyHasOnlyIncidentalRunRoots
            && (target.sourceProvenanceQualified!==(target.sourceProvenanceQualified && provenance.sourceProvenanceQualified)
              || sourceKeys.some(key=>provenance[key].some(id=>!target[key].includes(id))));
          let humanEvidenceSealAudit:{previousSnapshotDigest:string;currentSnapshotDigest:string}|null=null;
          let humanEvidenceSealCredential:{actor:AuthorizationActor;credentialExpiresAt:number|null}|null=null;
          if((resolution.metadata.kind!=="duplicate" || sourceChanges)&&!humanManualTaskTarget)await txDb.update(memoryRecords).set({
            ...(sourceChanges ? { payloadSourceSnapshot: null } : {}),
            sourceProvenanceQualified:target.sourceProvenanceQualified && provenance.sourceProvenanceQualified,
            sourceRunIds:[...new Set([...target.sourceRunIds,...provenance.sourceRunIds])],
            sourceIssueIds:[...new Set([...target.sourceIssueIds,...provenance.sourceIssueIds])],
            sourceProjectIds:[...new Set([...target.sourceProjectIds,...provenance.sourceProjectIds])],
            sourceMemoryIds:[...new Set([...target.sourceMemoryIds,...provenance.sourceMemoryIds])],
            sourceFoundationRevisionIds:[...new Set([...target.sourceFoundationRevisionIds,...provenance.sourceFoundationRevisionIds])],
            updatedAt:new Date(),
          }).where(and(eq(memoryRecords.companyId,companyId),eq(memoryRecords.id,target.id)));

          if (
            resolution.metadata.kind === "corroboration" ||
            attachesToExistingPendingContradiction
          ) {
            await insertEvidenceRows(
              txDb,
              companyId,
              target.id,
              resolution.novelEvidence,
            );

            if(humanManualTaskTarget&&manualSnapshot){
              const currentTaskSources=await captureHumanManualTaskMemorySources(txDb,companyId,actor.principal,
                memorySourceActor(companyId,actor),provenance,allTaskEvidence);
              if(!currentTaskSources||allTaskEvidence.length===0||allTaskEvidence.some(item=>item.sourceClass!=="task"||
                item.sourceProvider!=="august_works_tasks"||item.sourceType!=="issue")||
                currentTaskSources.inputs.some(input=>input.kind!=="task")||
                manualSnapshot.inputs.some(old=>!currentTaskSources.inputs.some(current=>JSON.stringify(old)===JSON.stringify(current))))
                throw conflict("Human Memory evidence cannot be sealed from current Task sources",{code:"memory_resolution_source_conflict"});
              const nextSnapshotInputs=[...manualSnapshot.inputs];
              for(const input of currentTaskSources.inputs){
                if(!nextSnapshotInputs.some(existing=>JSON.stringify(existing)===JSON.stringify(input)))nextSnapshotInputs.push(input);
              }
              const nextPolicy={issueIds:[...new Set([...manualSnapshot.policy.issueIds,...currentTaskSources.policy.issueIds])].sort(),
                projectIds:[...new Set([...manualSnapshot.policy.projectIds,...currentTaskSources.policy.projectIds])].sort(),
                runIds:[...new Set([...manualSnapshot.policy.runIds,...currentTaskSources.policy.runIds])].sort(),
                memoryIds:[...new Set([...manualSnapshot.policy.memoryIds,...currentTaskSources.policy.memoryIds])].sort(),
                foundationRevisionIds:[...new Set([...manualSnapshot.policy.foundationRevisionIds,...currentTaskSources.policy.foundationRevisionIds])].sort()};
              const mergedSourceFields={
                sourceProvenanceQualified:target.sourceProvenanceQualified&&provenance.sourceProvenanceQualified,
                sourceRunIds:[...new Set([...target.sourceRunIds,...provenance.sourceRunIds])],
                sourceIssueIds:[...new Set([...target.sourceIssueIds,...provenance.sourceIssueIds])],
                sourceProjectIds:[...new Set([...target.sourceProjectIds,...provenance.sourceProjectIds])],
                sourceMemoryIds:[...new Set([...target.sourceMemoryIds,...provenance.sourceMemoryIds])],
                sourceFoundationRevisionIds:[...new Set([...target.sourceFoundationRevisionIds,...provenance.sourceFoundationRevisionIds])],
              };
              const [retained]=await txDb.update(memoryRecords).set({...mergedSourceFields,updatedAt:new Date()})
                .where(and(eq(memoryRecords.companyId,companyId),eq(memoryRecords.id,target.id),
                  eq(memoryRecords.payloadSourceProtocolVersion,1),eq(memoryRecords.payloadSourceSnapshotInvalidated,true),
                  eq(memoryRecords.createdByActorType,"user"))).returning({id:memoryRecords.id});
              if(!retained)throw conflict("Human Memory source history changed before sealing",{code:"memory_resolution_source_conflict"});
              const [sealed]=await txDb.update(memoryRecords).set({
                payloadSourceSnapshot:nativePayloadSnapshotSql("memory_record",nextPolicy,nextSnapshotInputs),
                payloadSourceSnapshotInvalidated:false,updatedAt:new Date(),
              }).where(and(eq(memoryRecords.companyId,companyId),eq(memoryRecords.id,target.id),
                eq(memoryRecords.payloadSourceProtocolVersion,1),eq(memoryRecords.payloadSourceSnapshotInvalidated,true),
                eq(memoryRecords.createdByActorType,"user"))).returning({snapshot:memoryRecords.payloadSourceSnapshot});
              const sealedSnapshot=nativePayloadSourceSnapshotSchema.safeParse(sealed?.snapshot);
              if(!sealedSnapshot.success)throw conflict("Human Memory evidence seal was not stored",{code:"memory_resolution_source_conflict"});
              if(!actor.authorizationActor||actor.authorizationActor.type!=="board")
                throw forbidden("Current Human Memory authority changed");
              humanEvidenceSealCredential={actor:actor.authorizationActor,credentialExpiresAt:currentTaskSources.credentialExpiresAt};
              humanEvidenceSealAudit={previousSnapshotDigest:manualSnapshot.digest,currentSnapshotDigest:sealedSnapshot.data.digest};
            }

            publications.push(
              await persistMemoryActivity(txDb, actor, {
                companyId,
                action:
                  resolution.metadata.kind === "corroboration"
                    ? "memory.corroborated"
                    : "memory.contradiction_attached",
                recordId: target.id,
                details: { resolution: resolution.metadata,
                  ...(humanEvidenceSealAudit?{evidenceSnapshotSeal:humanEvidenceSealAudit}:{}) },
              }),
            );
          }

          if((resolution.metadata.kind!=="duplicate"||sourceChanges)&&humanManualTaskTarget&&
            resolution.novelEvidence.length===0){
            throw conflict("Human Memory source expansion requires new current Task evidence",{code:"memory_resolution_source_conflict"});
          }

          // A distinct descendant or another retained source may lead back to
          // this target. Use the original current source owner before commit,
          // so failed attachment rolls back lineage, evidence and audit alike.
          if(!await canActorReadMemorySources(txDb,companyId,memorySourceActor(companyId,actor),target.id))
            throw conflict("Memory attachment sources are unavailable or cyclic",{code:"memory_resolution_source_conflict"});
          if(humanEvidenceSealCredential)await assertCurrentMemoryHumanCredential(txDb,humanEvidenceSealCredential.actor,
            humanEvidenceSealCredential);
          return { recordId: target.id, resolution: resolution.metadata, replayed:false as const };
        }

        const supersedesRecordId =
          resolution.metadata.kind === "update" ||
          resolution.metadata.kind === "contradiction"
            ? resolution.target?.id ?? null
            : null;
        if (
          (resolution.metadata.kind === "update" ||
            resolution.metadata.kind === "contradiction") &&
          !supersedesRecordId
        ) {
          throw new Error(
            `Memory ${resolution.metadata.kind} resolution is missing its target record`,
          );
        }

        const candidate: MemoryCandidateInputParsed = {
          ...parsed.data,
          metadata: {
            ...parsed.data.metadata,
            memoryResolution: resolution.metadata,
          },
        };
        const candidateState:{sourceMemoryIds:string[];humanCredential?:{actor:AuthorizationActor;credentialExpiresAt:number|null}}={sourceMemoryIds};
        const created = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          supersedesRecordId,
          candidateState,
        );
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.candidate_created",
            recordId: created.id,
            details: {
              memoryType: created.memoryType,
              scopeType: created.scopeType,
              scopeId: created.scopeId,
              resolution: resolution.metadata,
            },
          }),
        );
        if(candidateState.humanCredential){
          await assertCurrentMemoryHumanCredential(txDb,candidateState.humanCredential.actor,candidateState.humanCredential);
          await assertDirectInputSessionCurrent(tx,candidateState.humanCredential.actor,candidateState.humanCredential.credentialExpiresAt,
            "The original Human Memory input session is unavailable");
        }
        return { recordId: created.id, resolution: resolution.metadata, replayed:false as const };
        };
        return nativeCapture
          ? withNativeMemoryCaptureSources(txDb,companyId,memorySourceActor(companyId,actor),options.nativeCaptureReceipt!,inspect)
          : inspect();
      });
      publishOrDefer(publications);

      return outcome;
  }
  return {
    exportDeletionLedger: async (companyId: string, actor: MemoryMutationActor) => {
      await assertPrivacyManagement(db, companyId, actor);
      const rows = await db.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId, companyId));
      return { schema: "memory_deletion_ledger.v1" as const, companyId, markers: rows.map((row) => ({
        key: row.key, kind: row.kind, recordId: row.recordId, deletedAt: row.deletedAt.toISOString(),
      })) };
    },
    restoreDeletionLedger: async (companyId: string, input: unknown, actor: MemoryMutationActor) => {
      const ledger = memoryDeletionLedgerInputSchema.parse(input);
      if (ledger.companyId !== companyId) throw forbidden("Deletion ledger belongs to another company", { code: "company_boundary_denied" });
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertPrivacyManagement(scopedDb, companyId, actor);
        await lockAnalyticalCompany(scopedDb,companyId); await lockMemoryPrivacy(scopedDb,companyId);
        for (const marker of ledger.markers) {
          if (marker.kind === "record" ? !marker.recordId || marker.key !== memoryDeletionKey(companyId, "record", marker.recordId) : marker.recordId !== null) {
            throw unprocessable("Deletion marker identity is invalid", { code: "memory_deletion_marker_invalid" });
          }
        }
        if (ledger.markers.length) await scopedDb.insert(memoryDeletionMarkers).values(ledger.markers.map((marker) => ({
          ...marker, companyId, deletedAt: new Date(marker.deletedAt),
        }))).onConflictDoNothing();
        const erased = await reapplyMemoryDeletionMarkers(scopedDb, companyId);
        publications.push(await persistMemoryActivity(scopedDb, actor, { companyId, action: "memory.deletion_ledger_restored", recordId: companyId,
          details: { markerCount: ledger.markers.length, deletedRecordCount: erased.deletedRecordCount } }));
        return { importedMarkerCount: ledger.markers.length, deletedRecordCount: erased.deletedRecordCount };
      });
      publishOrDefer(publications);
      return result;
    },
    forget: async (companyId: string, recordId: string, actor: MemoryMutationActor) => {
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertActorCompanyScope(scopedDb, companyId, actor);
        await lockAnalyticalCompany(scopedDb,companyId); await lockMemoryPrivacy(scopedDb,companyId);
        const [record] = await scopedDb.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, recordId))).for("update");
        if (!record) throw notFound("Memory record not found");
        if(!record.deletedAt)await assertMemorySourceAccess(scopedDb,companyId,record.id,actor);
        assertPrivateMemoryReadAllowed(record, actor);
        if (record.scopeType === "agent") assertPrivateMemoryWriter(record.ownerAgentId!, actor);
        else requireHumanOrSystem(actor, "delete");
        const deleted = await purgeMemoryRecords(scopedDb, companyId, [recordId]);
        if (deleted.deletedRecordCount) publications.push(await persistMemoryActivity(scopedDb, actor, {
          companyId, action: "memory.deleted", recordId,
          details: { deletedRecordCount: deleted.deletedRecordCount, includesDerivedRecords: true },
        }));
        return deleted;
      });
      publishOrDefer(publications);
      return result;
    },

    export: async (companyId: string, actor: MemoryMutationActor) => {
      return db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertActorCompanyScope(scopedDb, companyId, actor);
        await lockAnalyticalCompany(scopedDb,companyId); await lockMemoryPrivacy(scopedDb,companyId);
        const candidates = await scopedDb.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), memoryPayloadVisible(),
          actor.principal.type === "agent" ? and(eq(memoryRecords.scopeType, "agent"), eq(memoryRecords.ownerAgentId, actor.principal.agentId)) : ne(memoryRecords.scopeType, "agent")));
        const records=await visibleMemorySources(scopedDb,companyId,candidates,actor);
        const evidence = records.length ? await scopedDb.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId, companyId),
          inArray(memoryEvidence.memoryRecordId, records.map((row) => row.id)))) : [];
        return { schema: "memory_export.v1" as const, companyId, exportedAt: new Date().toISOString(), records, evidence };
      });
    },

    forgetSource: async (companyId: string, input: unknown, actor: MemoryMutationActor) => {
      requireHumanOrSystem(actor, "delete source-derived");
      const parsed = memorySourceDeletionInputSchema.parse(input);
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertPrivacyManagement(scopedDb, companyId, actor);
        await lockAnalyticalCompany(scopedDb,companyId); await lockMemoryPrivacy(scopedDb,companyId);
        const key = memoryDeletionKey(companyId, "source", [parsed.sourceProvider, parsed.sourceRef]);
        await scopedDb.insert(memoryDeletionMarkers).values({ companyId, key, kind: "source" }).onConflictDoNothing();
        const evidence = await scopedDb.select({ id: memoryEvidence.memoryRecordId }).from(memoryEvidence).where(and(
          eq(memoryEvidence.companyId, companyId), eq(memoryEvidence.sourceProvider, parsed.sourceProvider), eq(memoryEvidence.sourceRef, parsed.sourceRef)));
        const deleted = await purgeMemoryRecords(scopedDb, companyId, evidence.map((row) => row.id));
        publications.push(await persistMemoryActivity(scopedDb, actor, { companyId, action: "memory.source_deleted", recordId: companyId,
          details: { sourceDigest: key, deletedRecordCount: deleted.deletedRecordCount } }));
        return { deletedRecordCount: deleted.deletedRecordCount, sourceDigest: key };
      });
      publishOrDefer(publications);
      return result;
    },

    getRetentionPolicy: async (companyId: string, actor: MemoryMutationActor) => {
      requireHumanOrSystem(actor, "inspect retention for");
      await assertActorCompanyScope(db, companyId, actor);
      const [policy] = await db.select().from(memoryRetentionPolicies).where(eq(memoryRetentionPolicies.companyId, companyId));
      let canManage = actor.principal.type === "system";
      if (actor.principal.type === "user") {
        const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.principal.userId), eq(companyMemberships.status, "active")));
        canManage = ["owner", "admin"].includes(membership?.membershipRole ?? "");
      }
      return { companyId, maxAgeDays: policy?.maxAgeDays ?? null, canManage };
    },

    setRetentionPolicy: async (companyId: string, input: unknown, actor: MemoryMutationActor) => {
      requireHumanOrSystem(actor, "configure retention for");
      const policy = memoryRetentionPolicyInputSchema.parse(input);
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertPrivacyManagement(scopedDb, companyId, actor);
        await lockAnalyticalCompany(scopedDb,companyId); await lockMemoryPrivacy(scopedDb,companyId);
        const [stored] = await scopedDb.insert(memoryRetentionPolicies).values({ companyId, ...policy })
          .onConflictDoUpdate({ target: memoryRetentionPolicies.companyId, set: { ...policy, updatedAt: new Date() } }).returning();
        publications.push(await persistMemoryActivity(scopedDb, actor, { companyId, action: "memory.retention_policy_updated", recordId: companyId,
          details: { maxAgeDays: stored!.maxAgeDays } }));
        return stored!;
      });
      publishOrDefer(publications);
      return result;
    },

    listBindings: async (
      companyId: string,
      actor: MemoryMutationActor,
    ) => {
      requireHumanOrSystem(actor, "inspect");
      await assertActorCompanyScope(db, companyId, actor);
      return db
        .select()
        .from(memoryBindings)
        .where(eq(memoryBindings.companyId, companyId))
        .orderBy(memoryBindings.key);
    },

    listReviewable: async (
      companyId: string,
      input: {
        reviewState?: "pending" | "accepted" | "rejected";
        memoryType?: MemoryCandidateInputParsed["memoryType"];
        limit: number;
      },
      actor: MemoryMutationActor,
    ) => {
      requireHumanOrSystem(actor, "inspect");
      await assertActorCompanyScope(db, companyId, actor);
      return visibleMemoryPage(db,companyId,actor,input.limit,async (scopedDb,offset)=>scopedDb
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.companyId, companyId),
            ne(memoryRecords.scopeType, "agent"),
            memoryPayloadVisible(),
            ...(input.reviewState
              ? [eq(memoryRecords.reviewState, input.reviewState)]
              : []),
            ...(input.memoryType
              ? [eq(memoryRecords.memoryType, input.memoryType)]
              : []),
          ),
        )
        .orderBy(desc(memoryRecords.updatedAt),memoryRecords.id)
        .limit(100).offset(offset));
    },

    getShared: async (
      companyId: string,
      recordId: string,
      actor: MemoryMutationActor,
    ) => {
      requireHumanOrSystem(actor, "inspect");
      await assertActorCompanyScope(db, companyId, actor);
      return db.transaction(async rawTx=>{
        const tx=rawTx as unknown as Db;await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId);
        const detail=await getRecordDetail(tx,companyId,recordId);
        if(!detail || detail.record.scopeType==="agent" || !await canActorReadMemorySources(tx,companyId,
          memorySourceActor(companyId,actor),recordId))return null;
        return detail;
      });
    },

    get: async (
      companyId: string,
      recordId: string,
      actor: MemoryMutationActor,
      budget: MemoryReadBudget = {},
    ) => {
      assertMemoryReadActive(budget);
      return db.transaction(async rawTx=>{
        const tx=rawTx as unknown as Db;await setMemoryReadStatementBudget(tx,budget);
        await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId);
        await setMemoryReadStatementBudget(tx,budget); await assertActorCompanyScope(tx,companyId,actor);
        const detail=await getRecordDetail(tx,companyId,recordId,budget);
        if(!detail)return null;
        assertPrivateMemoryReadAllowed(detail.record,actor);
        assertMemoryReadActive(budget);
        if(!await canActorReadMemorySources(tx,companyId,memorySourceActor(companyId,actor),recordId,budget))return null;
        return detail;
      });
    },

    createCompanyBinding: async (
      companyId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryBindingInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory binding", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "configure");
      await assertActorCompanyScope(db, companyId, actor);
      await assertSaasDomainAdmission(db, companyId, "memory.use");

      try {
        return await db.transaction(async (tx) => {
          const [binding] = await tx
            .insert(memoryBindings)
            .values({
              companyId,
              key: parsed.data.key,
              name: parsed.data.name,
              providerKey: parsed.data.providerKey,
              config: parsed.data.config,
              enabled: parsed.data.enabled,
            })
            .returning();
          if (!binding) {
            throw new Error("Memory binding insert returned no row");
          }
          await tx.insert(memoryBindingTargets).values({
            companyId,
            bindingId: binding.id,
            targetType: "company",
            targetId: companyId,
          });
          return binding;
        });
      } catch (error) {
        if (isUniqueViolation(error, "memory_bindings_company_key_uq")) {
          throw conflict("Memory binding key already exists", {
            code: "memory_binding_key_conflict",
          });
        }
        throw error;
      }
    },

    createBinding: async (
      companyId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryBindingInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory binding", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "configure");
      await assertActorCompanyScope(db, companyId, actor);
      await assertSaasDomainAdmission(db, companyId, "memory.use");
      try {
        const [binding] = await db
          .insert(memoryBindings)
          .values({
            companyId,
            key: parsed.data.key,
            name: parsed.data.name,
            providerKey: parsed.data.providerKey,
            config: parsed.data.config,
            enabled: parsed.data.enabled,
          })
          .returning();
        return binding!;
      } catch (error) {
        if (isUniqueViolation(error, "memory_bindings_company_key_uq")) {
          throw conflict("Memory binding key already exists", {
            code: "memory_binding_key_conflict",
          });
        }
        throw error;
      }
    },

    addBindingTarget: async (
      companyId: string,
      bindingId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryBindingTargetInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory binding target", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "configure");
      await assertActorCompanyScope(db, companyId, actor);
      await assertSaasDomainAdmission(db, companyId, "memory.use");
      const binding = await bindingForCompany(db, companyId, bindingId);
      if (!binding) throw notFound("Memory binding not found");

      if (parsed.data.targetType === "company" && parsed.data.targetId !== companyId) {
        throw unprocessable("Company memory target must reference the current company");
      }
      if (parsed.data.targetType === "agent") {
        const agent = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.companyId, companyId), eq(agents.id, parsed.data.targetId)))
          .then((rows) => rows[0] ?? null);
        if (!agent) throw unprocessable("Memory target agent must belong to the company");
      }
      if (parsed.data.targetType === "project") {
        const project = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.companyId, companyId), eq(projects.id, parsed.data.targetId)))
          .then((rows) => rows[0] ?? null);
        if (!project) throw unprocessable("Memory target project must belong to the company");
      }

      const [target] = await db
        .insert(memoryBindingTargets)
        .values({
          companyId,
          bindingId,
          targetType: parsed.data.targetType,
          targetId: parsed.data.targetId,
        })
        .onConflictDoNothing()
        .returning();
      if (target) return target;
      return db
        .select()
        .from(memoryBindingTargets)
        .where(
          and(
            eq(memoryBindingTargets.companyId, companyId),
            eq(memoryBindingTargets.bindingId, bindingId),
            eq(memoryBindingTargets.targetType, parsed.data.targetType),
            eq(memoryBindingTargets.targetId, parsed.data.targetId),
          ),
        )
        .then((rows) => rows[0]!);
    },

    createPrivateMemory: async (
      companyId: string,
      ownerAgentId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryPrivateInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid private memory", parsed.error.issues);
      }
      assertPrivateMemoryWriter(ownerAgentId, actor);

      const operationFingerprint = memoryOperationFingerprint({
        ownerAgentId,
        input: {
          ...parsed.data,
          metadata: metadataForOperationFingerprint(
            rawInput,
            parsed.data.metadata,
          ),
        },
      });
      const candidate: MemoryCandidateInputParsed = {
        ...parsed.data,
        scope: { type: "agent", id: ownerAgentId },
        ownerAgentId,
        metadata: {
          ...parsed.data.metadata,
          privateOperationFingerprint: operationFingerprint,
        },
      };

      const publications: ActivityPublication[] = [];
      const record = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockMemoryOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        const existing = await memoryRecordForOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
          actor,
        );
        if (existing) {
          if (
            existing.scopeType !== "agent" ||
            existing.ownerAgentId !== ownerAgentId ||
            metadataFingerprint(existing, "privateOperationFingerprint") !==
              operationFingerprint
          ) {
            throw conflict("Memory operation id was reused with different private-memory input", {
              code: "memory_operation_conflict",
              operationId: parsed.data.createdByOperationId,
            });
          }
          return existing;
        }
        const created = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          null,
          {
            reviewState: "accepted",
            verificationState: "unverified",
          },
        );
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.private_created",
            recordId: created.id,
            details: {
              ownerAgentId,
              memoryType: created.memoryType,
            },
          }),
        );
        return created;
      });
      publishOrDefer(publications);
      return requireCurrentMemoryDetail(db,companyId,record.id,actor);
    },

    correctPrivateMemory: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryPrivateCorrectionInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid private memory correction", parsed.error.issues);
      }

      const publications: ActivityPublication[] = [];
      const corrected = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");
        await lockAnalyticalCompany(txDb,companyId); await lockMemoryPrivacy(txDb,companyId);

        const source = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              eq(memoryRecords.scopeType, "agent"),
              memoryPayloadVisible(),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!source) throw notFound("Private memory record not found");
        assertPrivateMemoryReadAllowed(source, actor);
        if (!source.ownerAgentId) {
          throw conflict("Private memory owner is missing", {
            code: "private_memory_owner_missing",
          });
        }
        if(!source.privateOwnerUserId)throw conflict("Private Memory owner is unavailable",{code:"private_memory_owner_missing"});
        assertPrivateMemoryWriter(source.ownerAgentId, actor);

        const operationFingerprint = memoryOperationFingerprint({
          sourceRecordId: source.id,
          input: {
            ...parsed.data,
            metadata: metadataForOperationFingerprint(
              rawInput,
              parsed.data.metadata,
            ),
          },
        });
        await lockMemoryOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        const existing = await memoryRecordForOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
          actor,
        );
        if (existing) {
          if (
            existing.scopeType !== "agent" ||
            existing.ownerAgentId !== source.ownerAgentId ||
            existing.supersedesRecordId !== source.id ||
            metadataFingerprint(existing, "privateCorrectionFingerprint") !==
              operationFingerprint
          ) {
            throw conflict("Memory operation id was reused with different private correction input", {
              code: "memory_operation_conflict",
              operationId: parsed.data.createdByOperationId,
            });
          }
          return existing;
        }

        await assertMemorySourceAccess(txDb,companyId,source.id,actor);
        const now = new Date();
        if (
          source.reviewState !== "accepted" ||
          source.retentionState !== "active" ||
          source.revokedAt ||
          source.supersededByRecordId ||
          (source.validFrom && source.validFrom.getTime() > now.getTime()) ||
          (source.validUntil && source.validUntil.getTime() <= now.getTime()) ||
          (source.expiresAt && source.expiresAt.getTime() <= now.getTime())
        ) {
          throw conflict("Only current active private memory can be corrected", {
            code: "private_memory_not_correctable",
          });
        }

        const candidate: MemoryCandidateInputParsed = {
          bindingId: source.bindingId,
          memoryType: parsed.data.memoryType,
          scope: { type: "agent", id: source.ownerAgentId },
          subject: parsed.data.subject,
          ownerAgentId: source.ownerAgentId,
          title: parsed.data.title,
          content: parsed.data.content,
          summary: parsed.data.summary,
          sensitivity: parsed.data.sensitivity,
          importance: parsed.data.importance,
          confidenceScore: parsed.data.confidenceScore,
          validFrom: parsed.data.validFrom,
          validUntil: parsed.data.validUntil,
          observedAt: parsed.data.observedAt,
          retentionPolicy: parsed.data.retentionPolicy,
          expiresAt: parsed.data.expiresAt,
          createdByOperationId: parsed.data.createdByOperationId,
          metadata: {
            ...parsed.data.metadata,
            correctionReason: parsed.data.reason,
            privateCorrectionFingerprint: operationFingerprint,
          },
          evidence: parsed.data.evidence,
        };

        const next = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          source.id,
          {
            reviewState: "accepted",
            verificationState: "unverified",
          },
        );
        const [superseded] = await txDb
          .update(memoryRecords)
          .set({
            supersededByRecordId: next.id,
            retentionState: "superseded",
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, source.id),
              isNull(memoryRecords.supersededByRecordId),
              eq(memoryRecords.retentionState, "active"),
            ),
          )
          .returning({ id: memoryRecords.id });
        if (!superseded) {
          throw conflict("Private memory changed before correction could commit", {
            code: "private_memory_correction_conflict",
          });
        }

        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.private_corrected",
            recordId: next.id,
            details: {
              supersedesRecordId: source.id,
              ownerAgentId: source.ownerAgentId,
            },
          }),
        );
        return next;
      });
      publishOrDefer(publications);
      return requireCurrentMemoryDetail(db,companyId,corrected.id,actor);
    },

    sharePrivateMemory: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
      internalContext: SharePrivateMemoryInternalContext = {},
    ) => {
      const parsed = memoryShareInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid private memory share", parsed.error.issues);
      }

      const publications: ActivityPublication[] = [];
      const shared = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");
        await lockAnalyticalCompany(txDb,companyId); await lockMemoryPrivacy(txDb,companyId);

        const source = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              eq(memoryRecords.scopeType, "agent"),
              memoryPayloadVisible(),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!source) throw notFound("Private memory record not found");

        assertPrivateMemoryReadAllowed(source, actor);
        if (!source.ownerAgentId) {
          throw conflict("Private memory owner is missing", {
            code: "private_memory_owner_missing",
          });
        }
        if(!source.privateOwnerUserId)throw conflict("Private Memory owner is unavailable",{code:"private_memory_owner_missing"});

        const operationFingerprint = memoryOperationFingerprint({
          sourceRecordId: source.id,
          targetBindingId: parsed.data.targetBindingId,
          targetScope: parsed.data.targetScope,
          reason: parsed.data.reason,
          createdByOperationId: parsed.data.createdByOperationId,
          operationContextFingerprint:
            internalContext.operationContextFingerprint ?? null,
        });
        await lockMemoryOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        const existing = await memoryRecordForOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
          actor,
        );
        if (existing) {
          if (
            existing.scopeType === "agent" ||
            metadataFingerprint(existing, "shareOperationFingerprint") !==
              operationFingerprint
          ) {
            throw conflict("Memory operation id was reused with different share input", {
              code: "memory_operation_conflict",
              operationId: parsed.data.createdByOperationId,
            });
          }
          const [receipt]=await txDb.select().from(memoryPrivateSharePublications).where(and(
            eq(memoryPrivateSharePublications.companyId,companyId),eq(memoryPrivateSharePublications.sharedRecordId,existing.id),
            eq(memoryPrivateSharePublications.operationFingerprint,operationFingerprint)));
          if(!receipt||!(receipt.state==="pending"||receipt.state==="published"||receipt.state==="rejected")
            ||receipt.sourceRecordId!==source.id||receipt.sourceOwnerUserId!==source.privateOwnerUserId
            ||receipt.sourceVersion!==source.updatedAt.toISOString()||receipt.sourceFingerprint!==memoryShareContentFingerprint(source)
            ||receipt.sharedFingerprint!==memoryShareContentFingerprint(existing)||receipt.targetBindingId!==parsed.data.targetBindingId
            ||receipt.targetScopeType!==parsed.data.targetScope.type||receipt.targetScopeId!==(parsed.data.targetScope.id??null)
            ||source.reviewState!=="accepted"||source.retentionState!=="active"||source.revokedAt||source.supersededByRecordId
            ||(source.validFrom&&source.validFrom.getTime()>Date.now())||(source.validUntil&&source.validUntil.getTime()<=Date.now())
            ||(source.expiresAt&&source.expiresAt.getTime()<=Date.now()))
            throw conflict("Private Memory share proposal is unavailable or changed",{code:"private_memory_share_proposal_invalid"});
          return existing;
        }

        await assertMemorySourceAccess(txDb,companyId,source.id,actor);
        const now = new Date();
        if (
          source.reviewState !== "accepted" ||
          source.retentionState !== "active" ||
          source.revokedAt ||
          source.supersededByRecordId ||
          (source.validFrom && source.validFrom.getTime() > now.getTime()) ||
          (source.validUntil && source.validUntil.getTime() <= now.getTime()) ||
          (source.expiresAt && source.expiresAt.getTime() <= now.getTime())
        ) {
          throw conflict("Only current active private memory can be shared", {
            code: "private_memory_not_shareable",
          });
        }
        const candidate: MemoryCandidateInputParsed = {
          bindingId: parsed.data.targetBindingId,
          memoryType: source.memoryType as MemoryCandidateInputParsed["memoryType"],
          scope: parsed.data.targetScope,
          subject:
            source.subjectType && source.subjectId
              ? { type: source.subjectType, id: source.subjectId }
              : null,
          ownerAgentId: null,
          title: source.title,
          content: source.content,
          summary: source.summary,
          sensitivity:
            source.sensitivityLabel as MemoryCandidateInputParsed["sensitivity"],
          importance: source.importance,
          confidenceScore: source.confidenceScore,
          validFrom: source.validFrom?.toISOString() ?? null,
          validUntil: source.validUntil?.toISOString() ?? null,
          observedAt: source.observedAt.toISOString(),
          retentionPolicy: source.retentionPolicy,
          expiresAt: source.expiresAt?.toISOString() ?? null,
          createdByOperationId: parsed.data.createdByOperationId,
          metadata: {
            promotedFromPrivateRecordId: source.id,
            promotedFromOwnerAgentId: source.ownerAgentId,
            promotionReason: parsed.data.reason,
            shareOperationFingerprint: operationFingerprint,
            shareOperationContextFingerprint:
              internalContext.operationContextFingerprint ?? null,
          },
          evidence: [
            {
              sourceClass: "private_memory",
              sourceProvider: "august_works_memory",
              sourceType: "memory_record",
              sourceRef: `memory://private/${source.id}`,
              sourceVersion: source.updatedAt.toISOString(),
              sourceUpdatedAt: source.updatedAt.toISOString(),
              observedAt: now.toISOString(),
              excerptHash: createHash("sha256")
                .update(source.content)
                .digest("hex"),
              citation: { label: "Agent-private memory" },
              trustLevel: privateMemoryEvidenceTrust(source.verificationState),
              relation: "supports",
            },
            ...(internalContext.additionalEvidence ?? []),
          ],
        };

        // The narrow copy can omit incidental run inputs only when no extra
        // evidence was copied. Tool evidence includes the active Task's title,
        // so it retains the original producer closure and its current ACL.
        const sourceProvenance=internalContext.additionalEvidence?.length
          ? await captureMemorySources(txDb,companyId,memorySourceActor(companyId,actor),candidate.scope,[source.id])
          : await capturePrivateShareSource(txDb,companyId,
            memorySourceActor(companyId,actor),source.id,source.privateOwnerUserId??"");
        const created = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          null,
          {sourceMemoryIds:[source.id],sourceProvenance},
        );
        await txDb.insert(memoryPrivateSharePublications).values({
          companyId,sharedRecordId:created.id,sourceRecordId:source.id,sourceOwnerUserId:source.privateOwnerUserId,
          targetBindingId:parsed.data.targetBindingId,targetScopeType:parsed.data.targetScope.type,
          targetScopeId:parsed.data.targetScope.id??null,sourceVersion:source.updatedAt.toISOString(),
          sourceFingerprint:memoryShareContentFingerprint(source),sharedFingerprint:memoryShareContentFingerprint(created),operationFingerprint,
          state:"pending",
        });
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.share_candidate_created",
            recordId: created.id,
            details: {
              sourcePrivateRecordId: source.id,
              ownerAgentId: source.ownerAgentId,
              targetScopeType: created.scopeType,
              targetScopeId: created.scopeId,
            },
          }),
        );
        return created;
      });
      publishOrDefer(publications);
      return requireCurrentMemoryDetail(db,companyId,shared.id,actor);
    },

    createCandidate: async (companyId:string, rawInput:unknown, actor:MemoryMutationActor, sourceMemoryIds:string[]=[]) => {
      const outcome=await runCandidate(companyId,rawInput,actor,sourceMemoryIds,false);
      if(!outcome.resolution)throw new Error("Ordinary Memory candidate replay is unavailable");
      const detail=await requireCurrentMemoryDetail(db,companyId,outcome.recordId,actor);
      return withResolution(detail,outcome.resolution);
    },

    // Native worker result only: source comparison never becomes a generic
    // completed-run get/export permission or discloses a retained record DTO.
    captureCandidate: async (companyId:string, rawInput:unknown, actor:MemoryMutationActor) => {
      const outcome=await runCandidate(companyId,rawInput,actor,[],true);
      return {resolutionKind:outcome.replayed ? "duplicate" as const : outcome.resolution!.kind,replayed:outcome.replayed};
    },

    createCorrectionCandidate: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryCorrectionInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory correction", parsed.error.issues);
      }

      const publications: ActivityPublication[] = [];
      const created = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");
        await lockAnalyticalCompany(txDb,companyId); await lockMemoryPrivacy(txDb,companyId);
        const existing = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              memoryPayloadVisible(),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!existing) throw notFound("Memory record not found");
        await assertMemorySourceAccess(txDb,companyId,existing.id,actor);
        if (
          existing.reviewState !== "accepted" ||
          existing.revokedAt ||
          existing.retentionState !== "active" ||
          existing.supersededByRecordId
        ) {
          throw conflict("Only active accepted memory can be corrected", {
            code: "memory_not_correctable",
          });
        }

        const candidate: MemoryCandidateInputParsed = {
          bindingId: existing.bindingId,
          memoryType: parsed.data.memoryType,
          scope: { type: existing.scopeType as MemoryCandidateInputParsed["scope"]["type"], id: existing.scopeId },
          subject: parsed.data.subject,
          ownerAgentId: existing.ownerAgentId,
          title: parsed.data.title,
          content: parsed.data.content,
          summary: parsed.data.summary,
          sensitivity: parsed.data.sensitivity,
          importance: parsed.data.importance,
          confidenceScore: parsed.data.confidenceScore,
          validFrom: parsed.data.validFrom,
          validUntil: parsed.data.validUntil,
          observedAt: parsed.data.observedAt,
          retentionPolicy: parsed.data.retentionPolicy,
          expiresAt: parsed.data.expiresAt,
          createdByOperationId: parsed.data.createdByOperationId,
          metadata: {
            ...parsed.data.metadata,
            correctionReason: parsed.data.reason,
          },
          evidence: parsed.data.evidence,
        };
        const next = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          existing.id,
        );
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.corrected",
            recordId: next.id,
            details: {
              supersedesRecordId: existing.id,
              pendingReview: true,
            },
          }),
        );
        return next;
      });
      publishOrDefer(publications);
      return requireCurrentMemoryDetail(db,companyId,created.id,actor);
    },

    reviewCandidate: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryReviewInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory review", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "review");
      const publications: ActivityPublication[] = [];

      const reviewed = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const sourceActor=actor.authorizationActor?memorySourceActor(companyId,actor):null;
        const currentHumanActor=sourceActor?.type==="board"&&sourceActor.source!=="local_implicit"?sourceActor:null;
        const pinnedBoard=currentHumanActor?await pinCurrentBoardActor(txDb,currentHumanActor):null;
        if(currentHumanActor&&!pinnedBoard)throw forbidden("Current Human credential is unavailable");
        await lockAnalyticalCompany(txDb,companyId); await lockMemoryPrivacy(txDb,companyId);
        await assertActorCompanyScope(txDb, companyId, actor);
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");
        if(currentHumanActor?.userId){
          const [membership]=await txDb.select({id:companyMemberships.id}).from(companyMemberships).where(and(
            eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalType,"user"),
            eq(companyMemberships.principalId,currentHumanActor.userId),eq(companyMemberships.status,"active"),
          )).for("share",{noWait:true});
          if(!membership)throw forbidden("Current Human company membership is unavailable");
        }
        const record = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              memoryPayloadVisible(),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!record) throw notFound("Memory candidate not found");
        await assertMemorySourceAccess(txDb,companyId,record.id,actor);
        const [shareReceipt]=await txDb.select().from(memoryPrivateSharePublications).where(and(
          eq(memoryPrivateSharePublications.companyId,companyId),eq(memoryPrivateSharePublications.sharedRecordId,record.id))).for("update");
        if(parsed.data.publishPrivateShare&&parsed.data.decision!=="accept")
          throw unprocessable("Private share publication requires an acceptance decision",{code:"private_memory_share_flag_invalid"});
        if(parsed.data.publishPrivateShare&&!shareReceipt)
          throw unprocessable("Explicit publication applies only to a pending private share",{code:"private_memory_share_flag_invalid"});
        if(shareReceipt){
          if(shareReceipt.state!=="pending")throw conflict("Private share proposal was already reviewed",{code:"private_memory_share_proposal_reviewed"});
          if(parsed.data.publishPrivateShare){
            if(actor.principal.type!=="user"||actor.principal.userId!==shareReceipt.sourceOwnerUserId
              ||!sourceActor||sourceActor.type!=="board"||sourceActor.userId!==shareReceipt.sourceOwnerUserId||!pinnedBoard
              ||(sourceActor.source!=="session"&&sourceActor.source!=="board_key")
              ||(sourceActor.source==="session"&&(!sourceActor.sessionId||!Number.isFinite(sourceActor.authenticatedCredentialExpiresAt))))
              throw forbidden("Only the original Human owner can publish this exact private Memory share");
            if(sourceActor.userId!==shareReceipt.sourceOwnerUserId)throw forbidden("The original Human company membership is unavailable");
          }
          const [source]=await txDb.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),
            eq(memoryRecords.id,shareReceipt.sourceRecordId),memoryPayloadVisible())).for("update");
          const evidence=await txDb.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId,companyId),eq(memoryEvidence.memoryRecordId,record.id)));
          const sourceEvidence=evidence.filter(item=>item.sourceProvider==="august_works_memory"&&item.sourceRef===`memory://private/${shareReceipt.sourceRecordId}`);
          const nowForShare=Date.now();
          if(!source||source.scopeType!=="agent"||source.privateOwnerUserId!==shareReceipt.sourceOwnerUserId
            ||source.updatedAt.toISOString()!==shareReceipt.sourceVersion||memoryShareContentFingerprint(source)!==shareReceipt.sourceFingerprint
            ||source.reviewState!=="accepted"||source.retentionState!=="active"||source.revokedAt||source.supersededByRecordId
            ||(source.validFrom&&source.validFrom.getTime()>nowForShare)||(source.validUntil&&source.validUntil.getTime()<=nowForShare)
            ||(source.expiresAt&&source.expiresAt.getTime()<=nowForShare)
            ||memoryShareContentFingerprint(record)!==shareReceipt.sharedFingerprint||record.bindingId!==shareReceipt.targetBindingId
            ||record.scopeType!==shareReceipt.targetScopeType||record.scopeId!==shareReceipt.targetScopeId
            ||sourceEvidence.length!==1||sourceEvidence[0]!.sourceVersion!==shareReceipt.sourceVersion
            ||sourceEvidence[0]!.excerptHash!==createHash("sha256").update(source.content).digest("hex"))
            throw conflict("Private Memory share is stale or changed",{code:"private_memory_share_stale"});
          await assertMemorySourceAccess(txDb,companyId,source.id,actor);
          const [binding]=await txDb.select().from(memoryBindings).where(and(eq(memoryBindings.companyId,companyId),eq(memoryBindings.id,shareReceipt.targetBindingId)));
          const targets=binding?await txDb.select().from(memoryBindingTargets).where(and(eq(memoryBindingTargets.companyId,companyId),
            eq(memoryBindingTargets.bindingId,binding.id))):[];
          const authorizedTarget=targets.some(target=>
            (target.targetType==="company"&&target.targetId===companyId&&(record.scopeType==="company"||record.scopeType==="subject"))
            ||(target.targetType==="project"&&record.scopeType==="project"&&target.targetId===record.scopeId));
          if(!binding||!binding.enabled||!authorizedTarget)
            throw conflict("Private Memory share target is no longer available",{code:"private_memory_share_target_changed"});
        }
        if (record.reviewState !== "pending") {
          throw conflict("Memory candidate has already been reviewed", {
            code: "memory_review_conflict",
            reviewState: record.reviewState,
          });
        }

        const nextVerification =
          actor.principal.type === "user"
            ? "human_verified"
            : actor.principal.type === "system"
              ? "system_verified"
              : "unverified";
        const now = new Date();

        if (parsed.data.decision === "accept" && record.supersedesRecordId) {
          const prior = await txDb
            .select()
            .from(memoryRecords)
            .where(
              and(
                eq(memoryRecords.companyId, companyId),
                eq(memoryRecords.id, record.supersedesRecordId),
                memoryPayloadVisible(),
              ),
            )
            .for("update")
            .then((rows) => rows[0] ?? null);
          if (
            !prior ||
            prior.reviewState !== "accepted" ||
            prior.revokedAt ||
            prior.retentionState !== "active" ||
            prior.supersededByRecordId
          ) {
            throw conflict("The memory being corrected is no longer current", {
              code: "memory_correction_stale",
            });
          }
          await txDb
            .update(memoryRecords)
            .set({
              supersededByRecordId: record.id,
              retentionState: "superseded",
              updatedAt: now,
            })
            .where(
              and(
                eq(memoryRecords.companyId, companyId),
                eq(memoryRecords.id, prior.id),
              ),
            );
          await invalidateCognitiveRecords(txDb, companyId, [prior.id]);
          publications.push(
            await persistMemoryActivity(txDb, actor, {
              companyId,
              action: "memory.superseded",
              recordId: prior.id,
              details: { supersededByRecordId: record.id },
            }),
          );
        }

        const [updated] = await txDb
          .update(memoryRecords)
          .set({
            reviewState: parsed.data.decision === "accept" ? "accepted" : "rejected",
            verificationState:
              parsed.data.decision === "accept" ? nextVerification : record.verificationState,
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, record.id),
              eq(memoryRecords.reviewState, "pending"),
            ),
          )
          .returning();
        if (!updated) throw conflict("Memory candidate review raced with another reviewer");

        if(shareReceipt){
          const published=parsed.data.decision==="accept"&&parsed.data.publishPrivateShare===true;
          const [receiptUpdated]=await txDb.update(memoryPrivateSharePublications).set({
            state:published?"published":"rejected",publishedAt:published?now:null,
            publishedByUserId:published?actor.principal.type==="user"?actor.principal.userId:null:null,
          }).where(and(eq(memoryPrivateSharePublications.companyId,companyId),
            eq(memoryPrivateSharePublications.sharedRecordId,record.id),eq(memoryPrivateSharePublications.state,"pending"))).returning();
          if(!receiptUpdated)throw conflict("Private Memory publication raced with another reviewer");
        }

        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action:
              parsed.data.decision === "accept"
                ? "memory.candidate_accepted"
                : "memory.candidate_rejected",
            recordId: updated.id,
            details: {
              verificationState: updated.verificationState,
              reason: parsed.data.reason ?? null,
            },
          }),
        );
        if(sourceActor&&pinnedBoard)await assertCurrentMemoryHumanCredential(txDb,sourceActor,pinnedBoard);
        return updated;
      });
      publishOrDefer(publications);
      return requireCurrentMemoryDetail(db,companyId,reviewed.id,actor);
    },

    revoke: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryRevokeInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory revocation", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "revoke");
      const publications: ActivityPublication[] = [];

      const revoked = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const sourceActor=actor.authorizationActor?memorySourceActor(companyId,actor):null;
        const currentHumanActor=sourceActor?.type==="board"&&sourceActor.source!=="local_implicit"?sourceActor:null;
        const pinnedBoard=currentHumanActor?await pinCurrentBoardActor(txDb,currentHumanActor):null;
        if(currentHumanActor&&!pinnedBoard)throw forbidden("Current Human credential is unavailable");
        await lockAnalyticalCompany(txDb,companyId); await lockMemoryPrivacy(txDb,companyId);
        await assertActorCompanyScope(txDb, companyId, actor);
        if(currentHumanActor?.userId){
          const [membership]=await txDb.select({id:companyMemberships.id}).from(companyMemberships).where(and(
            eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalType,"user"),
            eq(companyMemberships.principalId,currentHumanActor.userId),eq(companyMemberships.status,"active"),
          )).for("share",{noWait:true});
          if(!membership)throw forbidden("Current Human company membership is unavailable");
        }
        const record = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              memoryPayloadVisible(),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!record) throw notFound("Memory record not found");
        await assertMemorySourceAccess(txDb,companyId,record.id,actor);
        if (record.reviewState !== "accepted") {
          throw conflict("Only accepted memory can be revoked");
        }
        if (record.revokedAt) {
          const evidence=await txDb.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId,companyId),
            eq(memoryEvidence.memoryRecordId,record.id))).orderBy(memoryEvidence.createdAt);
          await assertActorCompanyScope(txDb,companyId,actor);
          if(currentHumanActor&&pinnedBoard){
            await assertCurrentMemoryHumanCredential(txDb,currentHumanActor,pinnedBoard);
            await assertDirectInputSessionCurrent(tx,currentHumanActor,pinnedBoard.credentialExpiresAt,
              "The original Human Memory revocation session is unavailable");
          }
          return {record,evidence};
        }

        const identity = actorIdentity(actor);
        const now = new Date();
        const [updated] = await txDb
          .update(memoryRecords)
          .set({
            revokedAt: now,
            revokedByActorType: identity.actorType,
            revokedByActorId: identity.actorId,
            revocationReason: parsed.data.reason,
            payloadSourceSnapshot: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, record.id),
              isNull(memoryRecords.revokedAt),
            ),
          )
          .returning();
        const result = updated ?? record;
        if (updated) {
          await invalidateCognitiveRecords(txDb, companyId, [record.id]);
          publications.push(
            await persistMemoryActivity(txDb, actor, {
              companyId,
              action: "memory.revoked",
              recordId: result.id,
              details: { reason: parsed.data.reason },
            }),
          );
        }
        const evidence=await txDb.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId,companyId),
          eq(memoryEvidence.memoryRecordId,result.id))).orderBy(memoryEvidence.createdAt);
        await assertActorCompanyScope(txDb,companyId,actor);
        if(currentHumanActor&&pinnedBoard){
          await assertCurrentMemoryHumanCredential(txDb,currentHumanActor,pinnedBoard);
          await assertDirectInputSessionCurrent(tx,currentHumanActor,pinnedBoard.credentialExpiresAt,
            "The original Human Memory revocation session is unavailable");
        }
        return {record:result,evidence};
      });
      publishOrDefer(publications);
      return recordDetail(revoked.record,revoked.evidence);
    },

    listEligible: async (
      companyId: string,
      input: {
        scopeType?: "company" | "agent" | "project" | "subject";
        scopeId?: string | null;
        asOf?: Date;
        limit?: number;
        sensitivityCeiling?: EvidenceSensitivity;
        signal?: AbortSignal;
        deadlineAt?: number;
        /** Internal retrieval prefilter; only matching candidates are source-checked and returned. */
        candidateFilter?: (record: typeof memoryRecords.$inferSelect) => boolean;
      },
      actor: MemoryMutationActor,
    ) => {
      assertMemoryReadActive(input);
      if (input.scopeId !== undefined && !input.scopeType) {
        throw unprocessable("Memory scope id requires an explicit scope type");
      }
      if (input.scopeType === "agent" && !input.scopeId) {
        throw unprocessable("Agent memory eligibility requires the owning agent id");
      }
      if (
        input.scopeType === "agent" &&
        actor.principal.type !== "system" &&
        !(
          actor.principal.type === "agent" &&
          actor.principal.agentId === input.scopeId
        )
      ) {
        throw forbidden("Private agent memory can only be recalled by its owning agent", {
          code: "private_memory_read_denied",
          scopeId: input.scopeId,
        });
      }

      const asOf = input.asOf ?? new Date();
      const limit = Math.min(100, Math.max(1, input.limit ?? 50));
      const sensitivityLabels = input.sensitivityCeiling
        ? (["public", "internal", "confidential", "restricted"] as const).slice(
            0,
            (["public", "internal", "confidential", "restricted"] as const).indexOf(input.sensitivityCeiling) + 1,
          )
        : null;
      return visibleMemoryPage(db,companyId,actor,limit,async (scopedDb,offset)=>scopedDb
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.companyId, companyId),
            eq(memoryRecords.reviewState, "accepted"),
            eq(memoryRecords.retentionState, "active"),
            isNull(memoryRecords.revokedAt),
            memoryPayloadVisible(),
            isNull(memoryRecords.supersededByRecordId),
            or(isNull(memoryRecords.validFrom), lte(memoryRecords.validFrom, asOf)),
            or(isNull(memoryRecords.validUntil), gt(memoryRecords.validUntil, asOf)),
            or(isNull(memoryRecords.expiresAt), gt(memoryRecords.expiresAt, asOf)),
            ...(sensitivityLabels ? [inArray(memoryRecords.sensitivityLabel, sensitivityLabels)] : []),
            ...(input.scopeType
              ? [eq(memoryRecords.scopeType, input.scopeType)]
              : [ne(memoryRecords.scopeType, "agent")]),
            ...(input.scopeId !== undefined
              ? input.scopeId === null
                ? [isNull(memoryRecords.scopeId)]
                : [eq(memoryRecords.scopeId, input.scopeId)]
              : []),
          ),
        )
        .orderBy(desc(memoryRecords.observedAt),memoryRecords.id)
        .limit(100).offset(offset), input, input.candidateFilter);
    },
  };
}
