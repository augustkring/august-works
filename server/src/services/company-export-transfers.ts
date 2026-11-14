import { createHash, randomUUID } from "node:crypto";
import { agentApiKeyScopeSchema, companyPortabilityExportSchema, type CompanyPortabilityExport, type CompanyPortabilityExportResult } from "@paperclipai/shared";
import { canonicalJson } from "@paperclipai/shared/portability-hash";
import { heartbeatRuns, issues, runIdentityContexts, type Db } from "@paperclipai/db";
import { conflict, forbidden, notFound, HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { assertCompanyCeoAgentOrBoard, authorizationService, type AuthorizationActor } from "./authorization.js";
import { agentRunWritesRevoked, assertAgentRunPolicyAllowed } from "../agent-run-cancellation.js";
import { and, eq, inArray } from "drizzle-orm";
import { finishImportCredential, pinImportCredential } from "./company-import-jobs.js";
import { companyTransferRunService, type CompanyTransferRunRow } from "./company-transfer-runs.js";
import type { StorageService } from "../storage/types.js";
import { storageScopeMatches } from "../storage/object-scope.js";

export const COMPANY_EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPANY_EXPORT_WORKER_LEASE_MS = 120_000;
export const COMPANY_EXPORT_RECOVERY_BATCH = 20;
export const COMPANY_EXPORT_RECOVERY_INTERVAL_MS = 30_000;
const activeExportWorkers = new WeakMap<object, Map<string, { companyId: string; promise: Promise<void> }>>();

function exportWorkersFor(db: Db) {
  let workers = activeExportWorkers.get(db as object);
  if (!workers) { workers = new Map(); activeExportWorkers.set(db as object, workers); }
  return workers;
}

export async function drainCompanyExportWorkers(db: Db, companyId?: string): Promise<void> {
  const workers = exportWorkersFor(db);
  const pending = [...workers.values()].filter(worker => !companyId || worker.companyId === companyId).map(worker => worker.promise);
  await Promise.all(pending);
}

export type CompanyExportAuthorityRef =
  | { version: 1; kind: "board_session"; userId: string; sessionId: string; credentialExpiresAt: number | null }
  | { version: 1; kind: "board_key"; userId: string; keyId: string; authenticatedKeyHash: string; credentialExpiresAt: number | null }
  | { version: 1; kind: "agent_key"; companyId: string; agentId: string; keyId: string; authenticatedKeyHash: string;
      onBehalfOfUserId: string; keyScope: NonNullable<AuthorizationActor["keyScope"]>; credentialExpiresAt: number | null }
  | { version: 1; kind: "agent_jwt_run"; companyId: string; agentId: string; runId: string;
      identityContextId: string; identityRevision: number; identityCause: string; taskIssueId: string | null;
      onBehalfOfUserId: string; keyScope: NonNullable<AuthorizationActor["keyScope"]>; credentialExpiresAt: number | null };

export interface CompanyExportOperationSnapshot {
  version: 1;
  companyId: string;
  requestId: string;
  requestHash: string;
  request: CompanyPortabilityExport;
  authority: CompanyExportAuthorityRef;
  requestedAt: string;
  artifactExpiresAt: string;
  storageScopeId: string;
}

export interface CompanyExportContainerRef {
  version: 1;
  kind: "company_export_transfer_v1";
  lease: { ownerId: string; expiresAt: string } | null;
  artifact: null | { state: "allocated" | "stored" | "ready" | "expired" | "deleted"; objectKey: string; storageScopeId: string;
    sha256?: string; byteSize?: number; expiresAt?: string; manifestSha256?: string };
}

function digest(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function fail(code: string): never { throw forbidden(code, { code }); }
function parseSnapshot(value: unknown): CompanyExportOperationSnapshot | null {
  const raw = record(value);
  if (!raw || raw.version !== 1 || typeof raw.companyId !== "string" || !/^[0-9a-f-]{36}$/i.test(raw.companyId)
    || typeof raw.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(raw.requestId)
    || typeof raw.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.requestHash)
    || typeof raw.requestedAt !== "string" || !Number.isFinite(Date.parse(raw.requestedAt))
    || typeof raw.storageScopeId !== "string" || !/^[a-f0-9]{64}$/.test(raw.storageScopeId)
    || typeof raw.artifactExpiresAt !== "string" || !Number.isFinite(Date.parse(raw.artifactExpiresAt)) || !raw.authority || !raw.request) return null;
  const parsed = companyPortabilityExportSchema.safeParse(raw.request);
  if (!parsed.success) return null;
  const auth = record(raw.authority);
  if (!auth || auth.version !== 1 || !(auth.credentialExpiresAt === null
    || (typeof auth.credentialExpiresAt === "number" && Number.isFinite(auth.credentialExpiresAt)))) return null;
  const boardValid = (auth.kind === "board_session" && typeof auth.userId === "string" && !!auth.userId
    && typeof auth.sessionId === "string" && !!auth.sessionId)
    || (auth.kind === "board_key" && typeof auth.userId === "string" && !!auth.userId
      && typeof auth.keyId === "string" && !!auth.keyId
      && typeof auth.authenticatedKeyHash === "string" && /^[a-f0-9]{64}$/i.test(auth.authenticatedKeyHash));
  const agentKeyValid = auth.kind === "agent_key" && auth.companyId === raw.companyId
    && typeof auth.agentId === "string" && !!auth.agentId && typeof auth.keyId === "string" && !!auth.keyId
    && typeof auth.authenticatedKeyHash === "string" && /^[a-f0-9]{64}$/i.test(auth.authenticatedKeyHash)
    && typeof auth.onBehalfOfUserId === "string" && !!auth.onBehalfOfUserId
    && agentApiKeyScopeSchema.safeParse(auth.keyScope).success;
  const agentRunValid = auth.kind === "agent_jwt_run" && auth.companyId === raw.companyId
    && typeof auth.agentId === "string" && !!auth.agentId && typeof auth.runId === "string" && !!auth.runId
    && typeof auth.identityContextId === "string" && !!auth.identityContextId
    && Number.isSafeInteger(auth.identityRevision) && typeof auth.identityCause === "string" && !!auth.identityCause
    && (auth.taskIssueId === null || typeof auth.taskIssueId === "string")
    && typeof auth.onBehalfOfUserId === "string" && !!auth.onBehalfOfUserId
    && agentApiKeyScopeSchema.safeParse(auth.keyScope).success;
  const agentValid = agentKeyValid || agentRunValid;
  if (!boardValid && !agentValid) return null;
  const snapshot = { ...raw, request: parsed.data } as unknown as CompanyExportOperationSnapshot;
  const expected = digest(canonicalJson({ companyId: snapshot.companyId, request: snapshot.request, authority: authorityIdentity(snapshot.authority) }) ?? "");
  return expected === snapshot.requestHash ? snapshot : null;
}
function authorityIdentity(ref: CompanyExportAuthorityRef): Record<string, unknown> {
  if (ref.kind === "agent_key") return { version: ref.version, kind: ref.kind, companyId: ref.companyId,
    agentId: ref.agentId, keyId: ref.keyId, authenticatedKeyHash: ref.authenticatedKeyHash,
    onBehalfOfUserId: ref.onBehalfOfUserId, keyScope: ref.keyScope };
  if (ref.kind === "agent_jwt_run") return { version: ref.version, kind: ref.kind, companyId: ref.companyId,
    agentId: ref.agentId, runId: ref.runId, identityContextId: ref.identityContextId,
    identityRevision: ref.identityRevision, identityCause: ref.identityCause, taskIssueId: ref.taskIssueId,
    onBehalfOfUserId: ref.onBehalfOfUserId, keyScope: ref.keyScope };
  if (ref.kind === "board_session") return { version: ref.version, kind: ref.kind, userId: ref.userId, sessionId: ref.sessionId };
  return { version: ref.version, kind: ref.kind, userId: ref.userId, keyId: ref.keyId, authenticatedKeyHash: ref.authenticatedKeyHash };
}
function authorityFromActor(actor: AuthorizationActor, companyId: string): CompanyExportAuthorityRef {
  if (actor.type === "board" && actor.userId && actor.source === "session" && actor.sessionId)
    return { version: 1, kind: "board_session", userId: actor.userId, sessionId: actor.sessionId,
      credentialExpiresAt: actor.authenticatedCredentialExpiresAt ?? null };
  if (actor.type === "board" && actor.userId && actor.source === "board_key" && actor.keyId && actor.authenticatedKeyHash)
    return { version: 1, kind: "board_key", userId: actor.userId, keyId: actor.keyId,
      authenticatedKeyHash: actor.authenticatedKeyHash, credentialExpiresAt: actor.authenticatedCredentialExpiresAt ?? null };
  // Native agent-key exports are admitted only without a run binding. A run
  // header changes task/actor/journey scope and needs the distinct run proof
  // protocol; never silently discard it.
  if (actor.type === "agent" && actor.source === "agent_key" && actor.companyId === companyId && actor.agentId
    && actor.keyId && actor.authenticatedKeyHash && actor.onBehalfOfUserId && actor.keyScope && !actor.runId) {
    return { version: 1, kind: "agent_key", companyId, agentId: actor.agentId, keyId: actor.keyId,
      authenticatedKeyHash: actor.authenticatedKeyHash, onBehalfOfUserId: actor.onBehalfOfUserId,
      keyScope: actor.keyScope, credentialExpiresAt: actor.authenticatedCredentialExpiresAt ?? null };
  }
  if (actor.type === "agent" && actor.source === "agent_jwt" && actor.companyId === companyId && actor.agentId
    && actor.runId && actor.identityContextId && actor.onBehalfOfUserId && actor.keyScope && !actor.nativeToolEffect) {
    return { version: 1, kind: "agent_jwt_run", companyId, agentId: actor.agentId, runId: actor.runId,
      identityContextId: actor.identityContextId, identityRevision: -1, identityCause: "pending", taskIssueId: null,
      onBehalfOfUserId: actor.onBehalfOfUserId, keyScope: actor.keyScope,
      credentialExpiresAt: actor.authenticatedCredentialExpiresAt ?? null };
  }
  fail("company_export_authority_profile_not_supported_yet");
}
async function bindRunAuthority(db: Db, ref: CompanyExportAuthorityRef): Promise<CompanyExportAuthorityRef> {
  if (ref.kind !== "agent_jwt_run") return ref;
  const [run] = await db.select({ companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId,
    status: heartbeatRuns.status, resultJson: heartbeatRuns.resultJson, scopeKind: heartbeatRuns.scopeKind,
    issueId: heartbeatRuns.issueId, nativeIssueId: heartbeatRuns.nativeIssueId,
    activeIdentityContextId: heartbeatRuns.activeIdentityContextId, responsibleUserId: heartbeatRuns.responsibleUserId,
    contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, ref.runId), eq(heartbeatRuns.companyId, ref.companyId), eq(heartbeatRuns.agentId, ref.agentId),
  ));
  if (!run || run.status !== "running" || agentRunWritesRevoked(run)
    || run.activeIdentityContextId !== ref.identityContextId || run.responsibleUserId !== ref.onBehalfOfUserId
    || run.scopeKind !== "company") fail("company_export_native_run_unavailable");
  const [identity] = await db.select({ id: runIdentityContexts.id, revision: runIdentityContexts.revision,
    cause: runIdentityContexts.cause, status: runIdentityContexts.status,
    responsibleUserId: runIdentityContexts.responsibleUserId }).from(runIdentityContexts).where(and(
    eq(runIdentityContexts.id, ref.identityContextId), eq(runIdentityContexts.companyId, ref.companyId),
    eq(runIdentityContexts.runId, ref.runId),
  ));
  if (!identity || identity.status !== "accepted" || identity.responsibleUserId !== ref.onBehalfOfUserId)
    fail("company_export_native_identity_unavailable");
  const context = record(run.contextSnapshot);
  const taskIssueId = run.nativeIssueId ?? run.issueId ?? (typeof context?.issueId === "string" ? context.issueId : null);
  if (taskIssueId) {
    const [issue] = await db.select({ id: issues.id, companyId: issues.companyId,
      conversationAgentId: issues.conversationAgentId, conversationSessionGeneration: issues.conversationSessionGeneration })
      .from(issues).where(and(eq(issues.id, taskIssueId), eq(issues.companyId, ref.companyId)));
    if (!issue) fail("company_export_native_task_unavailable");
    if (issue.conversationAgentId && Number(context?.conversationSessionGeneration ?? 0) !== issue.conversationSessionGeneration)
      fail("company_export_native_journey_changed");
  }
  return { ...ref, taskIssueId, identityRevision: identity.revision, identityCause: identity.cause };
}

function actorFromAuthority(ref: CompanyExportAuthorityRef): AuthorizationActor {
  if (ref.kind === "board_session") return { type: "board", userId: ref.userId, source: "session", sessionId: ref.sessionId,
    authenticatedCredentialExpiresAt: ref.credentialExpiresAt ?? undefined, isInstanceAdmin: false };
  if (ref.kind === "board_key") return { type: "board", userId: ref.userId, source: "board_key", keyId: ref.keyId,
    authenticatedKeyHash: ref.authenticatedKeyHash, authenticatedCredentialExpiresAt: ref.credentialExpiresAt ?? undefined,
    isInstanceAdmin: false };
  if (ref.kind === "agent_key") return { type: "agent", source: "agent_key", companyId: ref.companyId, agentId: ref.agentId, keyId: ref.keyId,
    authenticatedKeyHash: ref.authenticatedKeyHash, onBehalfOfUserId: ref.onBehalfOfUserId, keyScope: ref.keyScope,
    authenticatedCredentialExpiresAt: ref.credentialExpiresAt ?? undefined };
  return { type: "agent", source: "agent_jwt", companyId: ref.companyId, agentId: ref.agentId, runId: ref.runId,
    identityContextId: ref.identityContextId, onBehalfOfUserId: ref.onBehalfOfUserId, keyScope: ref.keyScope,
    authenticatedCredentialExpiresAt: ref.credentialExpiresAt ?? undefined };
}
function requestMatches(actor: AuthorizationActor, ref: CompanyExportAuthorityRef): boolean {
  if (ref.kind === "agent_key") return actor.type === "agent" && actor.source === "agent_key"
    && actor.companyId === ref.companyId && actor.agentId === ref.agentId && actor.keyId === ref.keyId
    && actor.authenticatedKeyHash === ref.authenticatedKeyHash && actor.onBehalfOfUserId === ref.onBehalfOfUserId
    && canonicalJson(actor.keyScope ?? null) === canonicalJson(ref.keyScope) && !actor.runId;
  if (ref.kind === "agent_jwt_run") return actor.type === "agent" && actor.source === "agent_jwt"
    && actor.companyId === ref.companyId && actor.agentId === ref.agentId && actor.runId === ref.runId
    && actor.identityContextId === ref.identityContextId && actor.onBehalfOfUserId === ref.onBehalfOfUserId
    && canonicalJson(actor.keyScope ?? null) === canonicalJson(ref.keyScope) && !actor.nativeToolEffect;
  if (actor.type !== "board" || actor.userId !== ref.userId) return false;
  return ref.kind === "board_session"
    ? actor.source === "session" && actor.sessionId === ref.sessionId
    : actor.source === "board_key" && actor.keyId === ref.keyId && actor.authenticatedKeyHash === ref.authenticatedKeyHash;
}
function parseContainer(value: unknown): CompanyExportContainerRef | null {
  const raw = record(value);
  if (raw?.version !== 1 || raw.kind !== "company_export_transfer_v1") return null;
  const lease = raw.lease;
  if (lease !== null && (!record(lease) || typeof record(lease)?.ownerId !== "string"
    || typeof record(lease)?.expiresAt !== "string" || !Number.isFinite(Date.parse(String(record(lease)?.expiresAt))))) return null;
  const artifact = raw.artifact;
  if (artifact !== null) {
    const a = record(artifact);
    if (!a || !["allocated", "stored", "ready", "expired", "deleted"].includes(String(a.state))
      || typeof a.objectKey !== "string" || a.objectKey.includes("..")
      || typeof a.storageScopeId !== "string" || !/^[a-f0-9]{64}$/.test(a.storageScopeId)
      || (a.sha256 !== undefined && (typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256)))
      || (a.byteSize !== undefined && (typeof a.byteSize !== "number" || !Number.isSafeInteger(a.byteSize) || a.byteSize < 0))
      || (a.expiresAt !== undefined && (typeof a.expiresAt !== "string" || !Number.isFinite(Date.parse(a.expiresAt))))) return null;
    if (["stored", "ready", "expired", "deleted"].includes(String(a.state))
      && (typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256)
        || typeof a.byteSize !== "number" || !Number.isSafeInteger(a.byteSize) || a.byteSize < 0
        || typeof a.expiresAt !== "string" || !Number.isFinite(Date.parse(a.expiresAt))
        || typeof a.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.manifestSha256))) return null;
  }
  return raw as unknown as CompanyExportContainerRef;
}
function receipt(run: CompanyTransferRunRow) {
  const artifact = parseContainer(run.containerRef)?.artifact;
  const snapshot = parseSnapshot(run.manifest);
  const expired = artifact?.expiresAt ? Date.parse(artifact.expiresAt) <= Date.now() : false;
  return {
    transferId: run.id, status: run.status, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(),
    acceptedExpiresAt: snapshot?.artifactExpiresAt ?? null,
    ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
    artifact: run.status === "completed" && artifact?.state === "ready" && !expired
      ? { availability: "ready" as const, byteSize: artifact.byteSize ?? null, sha256: artifact.sha256!, expiresAt: artifact.expiresAt! }
      : run.status === "completed" && (expired || artifact?.state === "expired" || artifact?.state === "deleted")
        ? { availability: "expired" as const, expiresAt: artifact?.expiresAt ?? null }
        : run.status === "completed" ? { availability: "unavailable" as const } : { availability: "not_ready" as const },
    ...(run.status === "failed" ? { error: { code: /^[a-z0-9_]{1,80}$/.test(run.error ?? "") ? run.error : "company_export_failed" } } : {}),
  };
}

export function companyExportTransferService(
  db: Db,
  storage: StorageService | undefined,
  portability: {
    exportBundle(companyId: string, input: CompanyPortabilityExport, options: { allowExternalInstructions: boolean; actor: AuthorizationActor;
      requireCurrentExternalInstructionAuthority: boolean }): Promise<CompanyPortabilityExportResult>;
    assertExternalInstructionsAllowed(companyId: string, input: CompanyPortabilityExport, actor: AuthorizationActor): Promise<boolean>;
    assertExportDownloadAccess(companyId: string, actor: AuthorizationActor, input: CompanyPortabilityExport, result: CompanyPortabilityExportResult, allowExternalInstructions?: boolean): Promise<void>;
  },
) {
  const workers = exportWorkersFor(db);
  function assertOriginalStorage(scopeId: string) {
    if (!storage || !storageScopeMatches(storage, scopeId))
      throw conflict("The original export storage namespace must be restored before access or erasure", { code: "company_export_storage_scope_changed" });
  }
  async function deleteArtifact(companyId: string, artifact: NonNullable<CompanyExportContainerRef["artifact"]>) {
    assertOriginalStorage(artifact.storageScopeId);
    if (!storage!.eraseObject)
      throw conflict("Export object erasure requires its original physical erasure owner", { code: "company_export_artifact_erasure_pending" });
    await storage!.eraseObject(companyId, artifact.objectKey);
  }
  function scheduleProcess(runId: string, companyId: string) {
    if (workers.has(runId)) return;
    const worker = { companyId, promise: Promise.resolve() as Promise<void> };
    worker.promise = Promise.resolve().then(() => process(runId)).catch(() => undefined).finally(() => {
      if (workers.get(runId) === worker) workers.delete(runId);
    });
    workers.set(runId, worker);
  }
  async function pinOriginal(ref: CompanyExportAuthorityRef, companyId: string) {
    const actor = actorFromAuthority(ref);
    return db.transaction(async tx => {
      if (ref.kind === "agent_key" || ref.kind === "agent_jwt_run") {
        // These exact Agent profiles revalidate through the native Source owner
        // and current CEO/responsible-Human authority; no role is persisted.
        if (ref.kind === "agent_jwt_run") {
          const rebound = await bindRunAuthority(tx as unknown as Db, ref);
          if (canonicalJson(authorityIdentity(rebound)) !== canonicalJson(authorityIdentity(ref)))
            fail("company_export_native_journey_changed");
          await assertAgentRunPolicyAllowed(tx as unknown as Db, companyId, { agentId: ref.agentId, runId: ref.runId });
        }
        await assertCompanyCeoAgentOrBoard(tx, companyId, actor, "company exports");
        let allowed = false;
        await authorizationService(tx).withReadCompany(companyId, async owner => {
          const decision = await owner.decide({ actor, action: "company_scope:read",
            resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
          allowed = decision.allowed;
        });
        if (!allowed) fail("company_export_current_company_access_required");
        if (ref.credentialExpiresAt !== null && ref.credentialExpiresAt <= Date.now())
          fail("company_export_original_credential_unavailable");
        return actor;
      }
      const pinned = await pinImportCredential(tx, actor);
      if (!pinned) fail("company_export_original_credential_unavailable");
      const decision = await authorizationService(tx).decide({ actor: pinned.actor, action: "company_scope:read",
        resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
      if (!decision.allowed) fail("company_export_current_company_access_required");
      await finishImportCredential(tx, pinned);
      return pinned.actor;
    });
  }

  async function admit(input: { companyId: string; requestId: string; actorKey: string; actor: AuthorizationActor;
    request: unknown }) {
    if (!storage) throw conflict("Durable export storage is unavailable", { code: "company_export_storage_unavailable" });
    if (!storage.eraseObject)
      throw conflict("Durable export storage cannot confirm physical erasure", { code: "company_export_storage_erasure_unqualified" });
    if (!storageScopeMatches(storage, storage.scopeId))
      throw conflict("Durable export requires a qualified storage namespace", { code: "company_export_storage_scope_unqualified" });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId))
      throw conflict("A stable export request id is required", { code: "company_export_request_id_required" });
    const request = companyPortabilityExportSchema.parse(input.request);
    const identity = authorityFromActor(input.actor, input.companyId);
    const authority = await bindRunAuthority(db, identity);
    await pinOriginal(authority, input.companyId);
    await portability.assertExternalInstructionsAllowed(input.companyId, request, actorFromAuthority(authority));
    // Credential expiry is an immutable admission-time ceiling, while the
    // idempotency identity is stable across a refreshed expiry on that same
    // credential. Replays retain the first manifest and never extend it.
    const authorityKey = authorityIdentity(authority);
    const requestHash = digest(canonicalJson({ companyId: input.companyId, request, authority: authorityKey }) ?? "");
    const snapshot: CompanyExportOperationSnapshot = { version: 1, companyId: input.companyId, requestId: input.requestId,
      requestHash, request, authority, storageScopeId: storage.scopeId!, requestedAt: new Date().toISOString(), artifactExpiresAt: new Date(Date.now() + COMPANY_EXPORT_ARTIFACT_TTL_MS).toISOString() };
    const idempotencyKey = digest(canonicalJson({ companyId: input.companyId, requestId: input.requestId, authority: authorityKey }) ?? "");
    const { run, resumed, alreadyCompleted } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: input.actorKey, idempotencyKey, companyId: input.companyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null } satisfies CompanyExportContainerRef,
      manifest: snapshot, manifestSha256: requestHash,
    });
    const prior = parseSnapshot(run.manifest);
    if (!prior || prior.requestHash !== requestHash) throw conflict("Export request id already refers to different validated input", { code: "company_export_request_changed" });
    const acceptedArtifact = parseContainer(run.containerRef)?.artifact;
    if (run.error === "company_export_storage_outcome_unknown" || acceptedArtifact?.state === "allocated")
      throw conflict("Export storage outcome is unknown and requires reconciliation; it will not be regenerated", { code: "company_export_storage_outcome_unknown" });
    const rawContainer = record(run.containerRef);
    const retainsArtifact = rawContainer?.artifact !== null && rawContainer?.artifact !== undefined;
    if (!alreadyCompleted && run.status === "failed" && retainsArtifact)
      return { ...receipt(run), alreadyCompleted };
    if (!alreadyCompleted && ["pending", "failed"].includes(run.status)) scheduleProcess(run.id, input.companyId);
    return { ...receipt(run), alreadyCompleted };
  }

  async function process(runId: string) {
    if (!storage) return;
    const workerId = randomUUID();
    const claimed = await companyTransferRunService.claimExport(db, runId, workerId, { leaseMs: COMPANY_EXPORT_WORKER_LEASE_MS });
    if (!claimed) return;
    const snapshot = parseSnapshot(claimed.manifest);
    const initial = parseContainer(claimed.containerRef);
    if (!snapshot || !initial) { await companyTransferRunService.failExport(db, runId, workerId, "company_export_manifest_invalid"); return; }
    let allocatedObjectKey: string | null = initial.artifact?.objectKey ?? null;
    let providerWriteSettled = false;
    let writePrevented = false;
    const leaseTimer = setInterval(() => {
      void companyTransferRunService.renewExportLease(db, runId, workerId, { leaseMs: COMPANY_EXPORT_WORKER_LEASE_MS })
        .then(ok => { if (!ok) logger.warn({ transferId: runId }, "company export worker lease lost"); })
        .catch(() => logger.warn({ transferId: runId }, "company export lease renewal failed"));
    }, 30_000);
    leaseTimer.unref?.();
    try {
      assertOriginalStorage(snapshot.storageScopeId);
      const previous = initial.artifact;
      if (previous && previous.storageScopeId !== snapshot.storageScopeId)
        throw conflict("The export artifact namespace does not match its original admission", { code: "company_export_storage_scope_changed" });
      if (previous?.state === "allocated")
        throw conflict("Export storage outcome is unknown and requires reconciliation", { code: "company_export_storage_outcome_unknown" });
      if (Date.parse(snapshot.artifactExpiresAt) <= Date.now())
        throw new HttpError(410, "Export request expired; create a new export", { code: "company_export_request_expired" });
      const actor = await pinOriginal(snapshot.authority, snapshot.companyId);
      if (previous?.state === "stored" && previous.expiresAt && Date.parse(previous.expiresAt) > Date.now()) {
        const object = await storage.getObject(snapshot.companyId, previous.objectKey);
        const bytes = await streamToBuffer(object.stream, previous.byteSize);
        if (digest(bytes) !== previous.sha256) throw conflict("Stored export artifact integrity check failed", { code: "company_export_artifact_integrity_failed" });
        const result = JSON.parse(bytes.toString("utf8")) as CompanyPortabilityExportResult;
        if (digest(canonicalJson(result.manifest) ?? "") !== previous.manifestSha256)
          throw conflict("Stored export manifest integrity check failed", { code: "company_export_artifact_integrity_failed" });
        const allowExternal = await portability.assertExternalInstructionsAllowed(snapshot.companyId, snapshot.request, actor);
        await portability.assertExportDownloadAccess(snapshot.companyId, actor, snapshot.request, result, allowExternal);
        const finalActor = await pinOriginal(snapshot.authority, snapshot.companyId);
        await portability.assertExternalInstructionsAllowed(snapshot.companyId, snapshot.request, finalActor);
        if (!(await companyTransferRunService.completeExport(db, runId, workerId, previous.manifestSha256 ?? "")))
          throw conflict("Export worker lease was lost before completion", { code: "company_export_lease_lost" });
        return;
      }
      const allowExternal = await portability.assertExternalInstructionsAllowed(snapshot.companyId, snapshot.request, actor);
      const result = await portability.exportBundle(snapshot.companyId, snapshot.request, { allowExternalInstructions: allowExternal, actor,
        requireCurrentExternalInstructionAuthority: true });
      const currentActor = await pinOriginal(snapshot.authority, snapshot.companyId);
      await portability.assertExternalInstructionsAllowed(snapshot.companyId, snapshot.request, currentActor);
      const bytes = Buffer.from(JSON.stringify(result), "utf8");
      const artifactSha = digest(bytes);
      const manifestSha = digest(canonicalJson(result.manifest) ?? "");
      const expiresAt = snapshot.artifactExpiresAt;
      const stored = await storage.putFile({
        companyId: snapshot.companyId, namespace: "company-exports/" + runId + "/" + workerId,
        originalFilename: "company-export-" + runId + ".json", contentType: "application/json", body: bytes,
        onAllocated: async objectKey => {
          allocatedObjectKey = objectKey;
          const ok = await companyTransferRunService.recordExportArtifact(db, runId, workerId, { objectKey, state: "allocated", storageScopeId: snapshot.storageScopeId });
          if (!ok) throw conflict("Export worker lease lost before artifact allocation", { code: "company_export_lease_lost" });
        },
        onTransportSettled: async objectKey => {
          providerWriteSettled = true;
          const ok = await companyTransferRunService.recordExportArtifact(db, runId, workerId, {
            objectKey, state: "stored", sha256: artifactSha, byteSize: bytes.length, expiresAt, manifestSha256: manifestSha,
          });
          if (!ok) throw conflict("Export worker lease lost after artifact storage", { code: "company_export_lease_lost" });
        },
        onWritePrevented: async objectKey => {
          writePrevented = true;
          const cleared = await companyTransferRunService.clearAllocatedExportArtifact(db, runId, workerId, objectKey);
          if (!cleared) throw conflict("Storage confirmed no provider write, but its allocation could not be cleared", { code: "company_export_storage_reconcile_required" });
          if (allocatedObjectKey === objectKey) allocatedObjectKey = null;
        },
      });
      if (stored.sha256 !== artifactSha || stored.byteSize !== bytes.length)
        throw conflict("Export artifact storage integrity mismatch", { code: "company_export_artifact_integrity_failed" });
      const finalActor = await pinOriginal(snapshot.authority, snapshot.companyId);
      await portability.assertExternalInstructionsAllowed(snapshot.companyId, snapshot.request, finalActor);
      if (!(await companyTransferRunService.completeExport(db, runId, workerId, manifestSha)))
        throw conflict("Export worker lease lost before completion", { code: "company_export_lease_lost" });
    } catch (error) {
      const details = error && typeof error === "object" && "details" in error ? (error as { details?: { code?: unknown } }).details : null;
      const code = allocatedObjectKey && !providerWriteSettled && !writePrevented
        ? "company_export_storage_outcome_unknown"
        : typeof details?.code === "string" && /^[a-z0-9_]{1,80}$/.test(details.code) ? details.code : "company_export_failed";
      if (["native_source_authority_busy", "authentication_state_busy"].includes(code) &&
          await companyTransferRunService.deferExport(db, runId, workerId, code)) return;
      const failed = await companyTransferRunService.failExport(db, runId, workerId, code).catch(() => false);
      // Only a confirmed provider settlement permits cleanup here. An
      // unacknowledged PUT remains allocated/unknown and is never regenerated
      // or declared erased from lease expiry alone.
      if (failed && providerWriteSettled && allocatedObjectKey && snapshot) {
        try {
          await deleteArtifact(snapshot.companyId, { state: "stored", objectKey: allocatedObjectKey, storageScopeId: snapshot.storageScopeId });
          await companyTransferRunService.markFailedExportArtifactDeleted(db, runId, workerId, allocatedObjectKey);
          allocatedObjectKey = null;
        } catch { logger.warn({ transferId: runId }, "failed company export artifact cleanup will retry"); }
      }
      logger.warn({ transferId: runId, code }, "durable company export failed");
    } finally { clearInterval(leaseTimer); }
  }

  async function currentRunForActor(companyId: string, runId: string, actorKey: string, actor: AuthorizationActor) {
    const run = await companyTransferRunService.getRunForActor(db, runId, actorKey);
    if (!run || run.direction !== "export" || run.companyId !== companyId) throw notFound("Export transfer not found");
    const snapshot = parseSnapshot(run.manifest);
    if (!snapshot || snapshot.companyId !== companyId || !requestMatches(actor, snapshot.authority))
      throw notFound("Export transfer not found");
    const pinnedActor = await pinOriginal(snapshot.authority, companyId);
    assertOriginalStorage(snapshot.storageScopeId);
    return { run, snapshot, authorityActor: pinnedActor };
  }

  async function getForActor(companyId: string, runId: string, actorKey: string, actor: AuthorizationActor) {
    const { run, snapshot } = await currentRunForActor(companyId, runId, actorKey, actor);
    const artifact = parseContainer(run.containerRef)?.artifact;
    if (artifact?.state === "expired" || (artifact?.state === "ready" && artifact.expiresAt && Date.parse(artifact.expiresAt) <= Date.now())) {
      await expireArtifact(run, artifact);
      const refreshed = await companyTransferRunService.getRunForActor(db, runId, actorKey) ?? run;
      return receipt(refreshed);
    }
    if (run.status === "pending" || run.status === "running") scheduleProcess(run.id, companyId);
    return receipt(run);
  }

  async function expireArtifact(run: CompanyTransferRunRow, artifact: NonNullable<CompanyExportContainerRef["artifact"]>) {
    if (!storage || !artifact.expiresAt || Date.parse(artifact.expiresAt) > Date.now()) return false;
    // Mark unavailable first. A concurrent download will then fail closed; object deletion is retried by recovery.
    if (artifact.state === "deleted") return false;
    const marked = artifact.state === "expired"
      ? true
      : await companyTransferRunService.expireExportArtifact(db, run.id, artifact.objectKey);
    if (!marked) return false;
    try {
      await deleteArtifact(run.companyId!, artifact);
      await companyTransferRunService.markExportArtifactDeleted(db, run.id, artifact.objectKey);
      return true;
    } catch {
      logger.warn({ transferId: run.id }, "expired company export artifact cleanup failed");
      return false;
    }
  }

  async function download(companyId: string, runId: string, actorKey: string, actor: AuthorizationActor) {
    if (!storage) throw conflict("Durable export storage is unavailable", { code: "company_export_storage_unavailable" });
    const { run, snapshot, authorityActor } = await currentRunForActor(companyId, runId, actorKey, actor);
    const artifact = parseContainer(run.containerRef)?.artifact;
    if (run.status !== "completed" || !artifact) throw conflict("Export artifact is not ready", { code: "company_export_not_ready" });
    if (artifact.state === "expired" || artifact.state === "deleted" || !artifact.expiresAt || Date.parse(artifact.expiresAt) <= Date.now()) {
      await expireArtifact(run, artifact);
      throw new HttpError(410, "Export artifact expired; request a new export", { code: "company_export_artifact_expired" });
    }
    if (artifact.state !== "ready") throw conflict("Export artifact is not ready", { code: "company_export_not_ready" });
    const object = await storage.getObject(companyId, artifact.objectKey);
    const bytes = await streamToBuffer(object.stream, artifact.byteSize);
    if (bytes.length !== artifact.byteSize || digest(bytes) !== artifact.sha256)
      throw conflict("Stored export artifact integrity check failed", { code: "company_export_artifact_integrity_failed" });
    const result = JSON.parse(bytes.toString("utf8")) as CompanyPortabilityExportResult;
    if (digest(canonicalJson(result.manifest) ?? "") !== artifact.manifestSha256)
      throw conflict("Stored export manifest integrity check failed", { code: "company_export_artifact_integrity_failed" });
    const allowExternal = await portability.assertExternalInstructionsAllowed(companyId, snapshot.request, authorityActor);
    await portability.assertExportDownloadAccess(companyId, authorityActor, snapshot.request, result, allowExternal);
    // Repeat exact credential pin and expiry check immediately before returning bytes.
    const finalActor = await pinOriginal(snapshot.authority, companyId);
    await portability.assertExternalInstructionsAllowed(companyId, snapshot.request, finalActor);
    if (Date.parse(artifact.expiresAt) <= Date.now()) throw new HttpError(410, "Export artifact expired; request a new export", { code: "company_export_artifact_expired" });
    return { bytes, sha256: artifact.sha256, expiresAt: artifact.expiresAt };
  }

  async function recoverBatch(limit = COMPANY_EXPORT_RECOVERY_BATCH) {
    const runs = await companyTransferRunService.listExportRunsForRecovery(db, limit);
    for (const run of runs) {
      if ((run.status === "pending" || run.status === "running") && run.companyId) scheduleProcess(run.id, run.companyId);
    }
    if (storage) {
      const expired = await companyTransferRunService.listExpiredExportArtifacts(db, limit);
      for (const run of expired) {
        const artifact = parseContainer(run.containerRef)?.artifact;
        if (!artifact) continue;
        if (artifact.state === "ready") await companyTransferRunService.expireExportArtifact(db, run.id, artifact.objectKey);
        try {
          await deleteArtifact(run.companyId!, artifact);
          if ((run.status === "failed" || run.status === "cancelled") && artifact.state === "stored") {
            const lease = parseContainer(run.containerRef)?.lease;
            if (lease?.ownerId) await companyTransferRunService.markFailedExportArtifactDeleted(db, run.id, lease.ownerId, artifact.objectKey);
          } else {
            await companyTransferRunService.markExportArtifactDeleted(db, run.id, artifact.objectKey);
          }
        } catch { logger.warn({ transferId: run.id }, "expired company export artifact cleanup failed"); }
      }
    }
    return runs.length;
  }

  return { admit, getForActor, download, recoverBatch, process };
}

async function streamToBuffer(stream: NodeJS.ReadableStream, expectedByteSize: number | undefined): Promise<Buffer> {
  if (typeof expectedByteSize !== "number" || !Number.isSafeInteger(expectedByteSize) || expectedByteSize < 0)
    throw conflict("Stored export artifact size is invalid", { code: "company_export_artifact_integrity_failed" });
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.length > expectedByteSize - byteSize)
      throw conflict("Stored export artifact exceeds its recorded size", { code: "company_export_artifact_integrity_failed" });
    byteSize += bytes.length;
    chunks.push(bytes);
  }
  if (byteSize !== expectedByteSize)
    throw conflict("Stored export artifact size does not match", { code: "company_export_artifact_integrity_failed" });
  return Buffer.concat(chunks, byteSize);
}

/** Bounded startup/restart recovery uses the existing transfer ledger and lease; it creates no second queue. */
export function scheduleCompanyExportRecovery(
  recover: () => Promise<unknown>,
  onError: (error: unknown) => void,
  drain?: () => Promise<void>,
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  const tick = () => {
    if (inFlight) return;
    inFlight = Promise.resolve().then(recover).then(() => undefined).catch(onError)
      .finally(() => { inFlight = null; });
  };
  const timer = setInterval(tick, COMPANY_EXPORT_RECOVERY_INTERVAL_MS);
  timer.unref?.();
  tick();
  return async () => { clearInterval(timer); await inFlight; await drain?.(); };
}
