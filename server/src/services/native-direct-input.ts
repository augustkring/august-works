import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, gte, inArray, is, isNull, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { agents, issues, projects, projectWorkspaces, issueComments, documentRevisions, issueDocuments, issueAttachments, assets,
  contextManifests, contextManifestItems, contextManifestMemoryRoots, accountDeletionOperations, memoryRecords,
  memoryDeletionMarkers,
  completionContracts, heartbeatRuns, orchestrationModelReservations, agentExecutionManifests, executionWorkspaces, foundationDocuments,
  documents, companySkills, companySkillVersions, playbookDocuments, rolePacks, rolePackVersions, rolePackItems,
  agentRolePackAssignments, issueThreadInteractions, type Db } from "@paperclipai/db";
import { toolInvocations } from "@paperclipai/db";
import { nativePayloadSourceInputSchema, nativePayloadSourcePolicySchema, nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema,
  AUTHORED_AGENT_DEFINITION_KEY, type NativePayloadSourceInput, type NativePayloadSourcePolicy,
  type NativePayloadSourceSnapshot, type NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { assertAnalyticalContextPayloadAccessBatch } from "./analytical-context-authority.js";
import { canActorReadHeartbeatRunPrivacy, canActorReadIssuePrivacy, canActorReadProjectPrivacy, authorizationService,
  type AuthorizationActor } from "./authorization.js";
import { canActorReadMemorySources, memoryPayloadVisible } from "./memory/memory-privacy.js";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import { readNativeRuntimeAssetText } from "./native-runtime/runtime-context.js";
import { assertAuthoredAgentSnapshotCurrent } from "./agents/authored-definition.js";
import { readNativeBootstrapContextWitness } from "./context/native-bootstrap-context-witness.js";
import { assertLearnedAssetAnalyticalSources } from "./learning/learning-analytical-sources.js";
import { assertRuntimeSkillSourceRetained } from "./learning/learning-assets.js";
import { publicNativePayloadRow } from "./native-payload-public.js";
import { projectService } from "./projects.js";
import { skillResolverService } from "./skill-resolver.js";
import { nativeCommentProjectionHash, nativeSha256 } from "./native-runtime/canonical.js";
import { captureNativeTaskWakeSource, type NativeConsumedSourceComponent, type NativeModelOutputCapture,
  type NativePayloadSourceSet } from "./native-runtime/native-execution-input.js";
import type { NativeToolEffectClaim } from "../agent-auth-jwt.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type NativeDocumentSourceCurrentRow = { revision: typeof documentRevisions.$inferSelect; latestRevisionId: string | null;
  documentId: string; issueId: string };
interface NativeSourceReadContext { db: object; txOrdinal?: number; scopes: Map<string, NativeSourceReadScope>; work: number;
  privacyLockedCompanies: Set<string>; active: boolean; runs: Map<string, typeof heartbeatRuns.$inferSelect | null>;
  reservations: Map<string, typeof orchestrationModelReservations.$inferSelect | null>;
  documentSources: Map<string, NativeDocumentSourceCurrentRow>;
  documentParentTasks: Map<string, { id: string; companyId: string }>;
  deferredReaderChecks: Map<string, { companyId: string; actor: AuthorizationActor; version: number;
    sets: Map<string, { runId: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }> }>;
  pendingReaderChecks: Set<string>; activeReaderChecks: Set<string> }
interface NativeSourceReadScope { context: NativeSourceReadContext; actorKey: string; active: Set<string>; complete: Set<string>;
  deferredReaderSets: Map<string, { companyId: string; runId: string; policy: NativePayloadSourcePolicy;
    inputs: NativePayloadSourceInput[] }> }
const nativeSourceReadScopes = new AsyncLocalStorage<NativeSourceReadContext>();
const nativeSourceMemoDiagnostics = { roots: 0, actorScopes: 0, nestedScopeReuses: 0, memoHits: 0,
  memoMisses: 0, uncachedProofMs: 0, maxUncachedProofMs: 0, documentRowCacheHits: 0,
  documentRowCacheMisses: 0, parentTaskRowCacheHits: 0, parentTaskRowCacheMisses: 0,
  byTransaction: {} as Record<string, { roots: number; actorScopes: number; hits: number; misses: number;
    uncachedProofMs: number; maxUncachedProofMs: number }>, byActor: {} as Record<string, {
    scopes: number; reuses: number; hits: number; misses: number;
  }> };
function nativeSourceMemoDiagnosticsEnabled() { return process.env.PAPERCLIP_NATIVE_SOURCE_MEMO_DIAGNOSTICS === "1"; }
function nativeSourceMemoActorKey(actor: AuthorizationActor) { return `${actor.type}:${actor.source}`; }
function nativeSourceMemoTransactionOrdinal(db: object): number | undefined {
  if (!nativeSourceMemoDiagnosticsEnabled()) return undefined;
  const map = (globalThis as unknown as Record<PropertyKey, unknown>)[
    Symbol.for("paperclip.nativeSourceMemoDiagnosticTxOrdinals.v1")];
  return map instanceof WeakMap ? map.get(db) : undefined;
}
function nativeSourceMemoTransactionStats(scope: NativeSourceReadScope) {
  const ordinal = scope.context.txOrdinal;
  if (!nativeSourceMemoDiagnosticsEnabled() || ordinal === undefined) return undefined;
  return nativeSourceMemoDiagnostics.byTransaction[String(ordinal)] ??=
    { roots: 0, actorScopes: 0, hits: 0, misses: 0, uncachedProofMs: 0, maxUncachedProofMs: 0 };
}
function nativeSourceMemoCount(key: "scopes" | "reuses" | "hits" | "misses", actor: AuthorizationActor) {
  if (!nativeSourceMemoDiagnosticsEnabled()) return;
  const stats = nativeSourceMemoDiagnostics.byActor[nativeSourceMemoActorKey(actor)] ??=
    { scopes: 0, reuses: 0, hits: 0, misses: 0 };
  stats[key] = Math.min(1_000_000, stats[key] + 1);
  const totalKey = key === "scopes" ? "actorScopes" : key === "reuses" ? "nestedScopeReuses" : key === "hits" ? "memoHits" : "memoMisses";
  nativeSourceMemoDiagnostics[totalKey] = Math.min(1_000_000, nativeSourceMemoDiagnostics[totalKey] + 1);
}
function nativeSourceMemoRecordProofTime(startedAt: number, scope: NativeSourceReadScope) {
  if (!nativeSourceMemoDiagnosticsEnabled()) return;
  const elapsed = Math.max(0, performance.now() - startedAt);
  nativeSourceMemoDiagnostics.uncachedProofMs = Math.min(1_000_000_000, nativeSourceMemoDiagnostics.uncachedProofMs + elapsed);
  nativeSourceMemoDiagnostics.maxUncachedProofMs = Math.max(nativeSourceMemoDiagnostics.maxUncachedProofMs, elapsed);
  const txStats = nativeSourceMemoTransactionStats(scope);
  if (txStats) {
    txStats.uncachedProofMs = Math.min(1_000_000_000, txStats.uncachedProofMs + elapsed);
    txStats.maxUncachedProofMs = Math.max(txStats.maxUncachedProofMs, elapsed);
  }
}
export function resetNativeSourceMemoDiagnosticsForTest() {
  nativeSourceMemoDiagnostics.roots = 0;
  nativeSourceMemoDiagnostics.actorScopes = 0;
  nativeSourceMemoDiagnostics.nestedScopeReuses = 0;
  nativeSourceMemoDiagnostics.memoHits = 0;
  nativeSourceMemoDiagnostics.memoMisses = 0;
  nativeSourceMemoDiagnostics.uncachedProofMs = 0;
  nativeSourceMemoDiagnostics.maxUncachedProofMs = 0;
  nativeSourceMemoDiagnostics.documentRowCacheHits = 0;
  nativeSourceMemoDiagnostics.documentRowCacheMisses = 0;
  nativeSourceMemoDiagnostics.parentTaskRowCacheHits = 0;
  nativeSourceMemoDiagnostics.parentTaskRowCacheMisses = 0;
  nativeSourceMemoDiagnostics.byTransaction = {};
  nativeSourceMemoDiagnostics.byActor = {};
}
export function nativeSourceMemoDiagnosticsForTest() { return structuredClone(nativeSourceMemoDiagnostics); }
function nativeSourceReadWork(scope: NativeSourceReadScope) {
  if (++scope.context.work > 512) throw forbidden("The Native source graph exceeds its total-work bound");
}
function nativeSourceReadScope(db: Db | Transaction, actor: AuthorizationActor): NativeSourceReadScope {
  const txOrdinal = nativeSourceMemoTransactionOrdinal(db as object);
  const context: NativeSourceReadContext = { db: db as object, ...(txOrdinal === undefined ? {} : { txOrdinal }),
    scopes: new Map(), work: 0, runs: new Map(), reservations: new Map(), documentSources: new Map(),
    documentParentTasks: new Map(), deferredReaderChecks: new Map(),
    pendingReaderChecks: new Set(), activeReaderChecks: new Set(),
    privacyLockedCompanies: new Set(), active: true };
  const scope: NativeSourceReadScope = { context, actorKey: nativeSha256(actor), active: new Set(), complete: new Set(),
    deferredReaderSets: new Map() };
  context.scopes.set(scope.actorKey, scope);
  return scope;
}
// Reuse only raw rows pinned by FOR SHARE inside this physical source-read
// transaction. Callers continue checking their own bindings and permissions.
async function nativeSourceReadRun(db: Db | Transaction, companyId: string, runId: string,
  scope: NativeSourceReadScope): Promise<typeof heartbeatRuns.$inferSelect | null> {
  const key = `${companyId}:${runId}`;
  if (scope.context.runs.has(key)) return scope.context.runs.get(key) ?? null;
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
    eq(heartbeatRuns.id, runId))).for("share");
  if (run) scope.context.runs.set(key, run);
  return run ?? null;
}
async function nativeSourceReadReservation(db: Db | Transaction, companyId: string, reservationId: string,
  scope: NativeSourceReadScope): Promise<typeof orchestrationModelReservations.$inferSelect | null> {
  const key = `${companyId}:${reservationId}`;
  if (scope.context.reservations.has(key)) return scope.context.reservations.get(key) ?? null;
  const [reservation] = await db.select().from(orchestrationModelReservations).where(and(
    eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.id, reservationId))).for("share");
  if (reservation) scope.context.reservations.set(key, reservation);
  return reservation ?? null;
}
function deferNativeSourceReaderCheck(scope: NativeSourceReadScope, input: {
  companyId: string; runId: string; actor: AuthorizationActor; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}) {
  const key = `${input.companyId}:${nativeSha256(input.actor)}`;
  let pending = scope.context.deferredReaderChecks.get(key);
  if (!pending) {
    pending = { companyId: input.companyId, actor: input.actor, version: 0, sets: new Map() };
    scope.context.deferredReaderChecks.set(key, pending);
  }
  const set = { runId: input.runId, policy: input.policy, inputs: input.inputs };
  const setKey = nativeSha256(set);
  if (!pending.sets.has(setKey)) {
    nativeSourceReadWork(scope);
    if (pending.sets.size >= 512) throw forbidden("The Native source reader recheck exceeds its work bound");
    pending.sets.set(setKey, set);
    pending.version += 1;
    scope.context.pendingReaderChecks.add(key);
  } else if (!scope.context.activeReaderChecks.has(key)) {
    // If the set is requested after a prior final pass, schedule a new pass;
    // an active grouped pass already covers every known set for this actor.
    scope.context.pendingReaderChecks.add(key);
  }
}
async function flushNativeSourceReaderChecks(context: NativeSourceReadContext) {
  while (context.pendingReaderChecks.size) {
    const groupKeys = [...context.pendingReaderChecks];
    context.pendingReaderChecks.clear();
    for (const key of groupKeys) {
      const group = context.deferredReaderChecks.get(key);
      if (!group) continue;
      const version = group.version;
      context.activeReaderChecks.add(key);
      try {
        await assertNativeSourceSetsReaderAccessCurrent(context.db as Db, {
          companyId: group.companyId, actor: group.actor, sets: [...group.sets.values()],
        }, context.scopes.get(nativeSha256(group.actor)));
      } finally { context.activeReaderChecks.delete(key); }
      if (group.version !== version) context.pendingReaderChecks.add(key);
    }
  }
}
function withNativeSourceReadScope<T>(db: Db | Transaction, actor: AuthorizationActor,
  read: (scope: NativeSourceReadScope) => Promise<T>): Promise<T> {
  const current = nativeSourceReadScopes.getStore();
  const actorKey = nativeSha256(actor);
  if (current?.active && current.db === (db as object)) {
    let scope = current.scopes.get(actorKey);
    if (!scope) {
      scope = { context: current, actorKey, active: new Set(), complete: new Set(), deferredReaderSets: new Map() };
      current.scopes.set(actorKey, scope);
      nativeSourceMemoCount("scopes", actor);
    } else nativeSourceMemoCount("reuses", actor);
    return read(scope);
  }
  const scope = nativeSourceReadScope(db, actor);
  if (nativeSourceMemoDiagnosticsEnabled()) {
    nativeSourceMemoDiagnostics.roots = Math.min(1_000_000, nativeSourceMemoDiagnostics.roots + 1);
    const txStats = nativeSourceMemoTransactionStats(scope);
    if (txStats) txStats.roots = Math.min(1_000_000, txStats.roots + 1);
  }
  nativeSourceMemoCount("scopes", actor);
  const txStats = nativeSourceMemoTransactionStats(scope);
  if (txStats) txStats.actorScopes = Math.min(1_000_000, txStats.actorScopes + 1);
  return nativeSourceReadScopes.run(scope.context, async () => {
    try {
      const result = await read(scope);
      await flushNativeSourceReaderChecks(scope.context);
      return result;
    }
    finally { scope.context.active = false; }
  });
}
function inNativeSourceReadTransaction<T>(db: Db | Transaction, read: (tx: Db | Transaction) => Promise<T>): Promise<T> {
  if (is(db, PgTransaction)) return read(db);
  return db.transaction(tx => read(tx as unknown as Db));
}
async function lockNativeSourceReadPrivacy(db: Db | Transaction, companyId: string, scope: NativeSourceReadScope) {
  if (scope.context.privacyLockedCompanies.has(companyId)) return;
  const { lockAnalyticalCompany } = await import("./analytical-privacy.js");
  const { lockMemoryPrivacy } = await import("./memory/memory-privacy.js");
  await lockAnalyticalCompany(db as Db, companyId);
  await lockMemoryPrivacy(db as Db, companyId);
  scope.context.privacyLockedCompanies.add(companyId);
}
async function nativeSourceReaderHasCompanyAccess(db: Db | Transaction, companyId: string, actor: AuthorizationActor) {
  // Agent identities bind one company. Human readers use current memberships,
  // rather than the Agent-only companyId field on the authorization actor.
  if (actor.type === "none" || (actor.type === "agent" && actor.companyId !== companyId)) return false;
  return (await authorizationService(db).decide({ actor, action: "company_scope:read",
    resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true })).allowed;
}
async function assertNativeSourceSetsReaderAccessCurrent(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor;
  sets: Array<{ runId: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }>;
}, scope?: NativeSourceReadScope) {
  if (!input.sets.length) return;
  if (!await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("The Native source prefix is unavailable");
  const projectIds = new Set(input.sets.flatMap(set => [...set.policy.projectIds, ...set.inputs.flatMap(source =>
    source.kind === "project" || source.kind === "project_workspace" ? [source.projectId] : [])]));
  const memoryIds = new Set(input.sets.flatMap(set => [...set.policy.memoryIds, ...set.inputs.flatMap(source =>
    source.kind === "memory" ? [source.memoryId] : [])]));
  const issueIds = new Set(input.sets.flatMap(set => [...set.policy.issueIds, ...set.inputs.flatMap(source =>
    source.kind === "task" ? [source.issueId] : [])]));
  const runIds = new Set(input.sets.flatMap(set => set.policy.runIds));
  const foundationRevisionIds = new Set(input.sets.flatMap(set => set.inputs.flatMap(source =>
    source.kind === "foundation_revision" ? [source.revisionId] : [])));
  const runtimeInstructions = new Map<string, { runId: string; source: Extract<NativePayloadSourceInput, { kind: "runtime_instructions" }> }>();
  const contextIds = new Set<string>();
  for (const set of input.sets) for (const source of set.inputs) {
    if (source.kind === "runtime_instructions") runtimeInstructions.set(nativeSha256({ runId: set.runId, source }), { runId: set.runId, source });
    if (source.kind === "context") contextIds.add(source.manifestId);
  }
  for (const issueId of issueIds) if (!await canActorReadIssuePrivacy(db, input.actor,
    { id: issueId, companyId: input.companyId })) throw forbidden("A Native source Task is unavailable");
  for (const projectId of projectIds) if (!await canActorReadProjectPrivacy(db, input.actor,
    { id: projectId, companyId: input.companyId })) throw forbidden("A Native source Project is unavailable");
  for (const runId of runIds) if (!await canActorReadHeartbeatRunPrivacy(db, input.actor,
    { id: runId, companyId: input.companyId })) throw forbidden("A Native source Run is unavailable");
  if (contextIds.size) {
    const [items, roots] = await Promise.all([
      db.select({ sourceProvider: contextManifestItems.sourceProvider, sourceRef: contextManifestItems.sourceRef })
        .from(contextManifestItems).where(and(eq(contextManifestItems.companyId, input.companyId),
          inArray(contextManifestItems.manifestId, [...contextIds]))).for("share"),
      db.select({ memoryRecordId: contextManifestMemoryRoots.memoryRecordId }).from(contextManifestMemoryRoots)
        .where(and(eq(contextManifestMemoryRoots.companyId, input.companyId),
          inArray(contextManifestMemoryRoots.manifestId, [...contextIds]))).for("share"),
    ]);
    for (const item of items) if (item.sourceProvider === "august_works_tasks") {
      const match = /^issue:\/\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
      if (!match || !await canActorReadIssuePrivacy(db, input.actor, { id: match[1]!, companyId: input.companyId }))
        throw forbidden("A Native Context Task source is unavailable");
    }
    for (const root of roots) memoryIds.add(root.memoryRecordId);
  }
  for (const revisionId of foundationRevisionIds)
    await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", revisionId, input.actor);
  for (const memoryId of memoryIds) if (!await canActorReadMemorySources(db as Db, input.companyId, input.actor, memoryId))
    throw forbidden("A Native source Memory is unavailable");
  // Runtime bundles are the only filesystem reads in this final ACL pass, so
  // run them after every batched owner/ACL query has completed its row waits.
  for (const { runId, source } of runtimeInstructions.values())
    await assertNativeRuntimeInstructionsCurrent(db, input.companyId, runId, source, scope);
}
async function assertNativeRuntimeInstructionsCurrent(db: Db | Transaction, companyId: string, runId: string,
  source: Extract<NativePayloadSourceInput, { kind: "runtime_instructions" }>, scope?: NativeSourceReadScope) {
  const run = scope ? await nativeSourceReadRun(db, companyId, runId, scope) : (await db.select().from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId),
      eq(heartbeatRuns.runtimeMode, "native"))).for("share"))[0] ?? null;
  const execution = run ? profileRunExecution(run) : null;
  const runtime = execution?.runtimeContext && typeof execution.runtimeContext === "object" && !Array.isArray(execution.runtimeContext)
    ? execution.runtimeContext as Record<string, unknown> : null;
  const instructions = runtime?.instructions && typeof runtime.instructions === "object" && !Array.isArray(runtime.instructions)
    ? runtime.instructions as Record<string, unknown> : null;
  const bundle = instructions?.bundle as Parameters<typeof readNativeRuntimeAssetText>[0] | undefined;
  if (!run || run.runtimeMode !== "native" || source.agentId !== run.agentId || !bundle || bundle.digest !== source.bundleDigest ||
    bundle.manifestDigest !== source.manifestDigest)
    throw forbidden("A Native runtime instruction source changed");
  const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, source.agentId))).for("share");
  if (!agent) throw forbidden("A Native runtime instruction owner is unavailable");
  await assertAuthoredAgentSnapshotCurrent(db as Db, agent).catch(() => {
    throw forbidden("A Native runtime instruction owner changed");
  });
  await readNativeRuntimeAssetText(bundle, 256000, { companyId, runId }).catch(() => {
    throw forbidden("A Native runtime instruction source was erased");
  });
}
function nativeProviderToolName(name: string): string {
  const stripped = name.replace(/^(?:paperclip__|paperclip_|paperclip\.)/, "");
  if (stripped === "self_remember") return "paperclip-self:remember";
  if (stripped === "self_read_context") return "read_context";
  return stripped;
}

function nativeToolResultReceiptCopies(receipt: NativeRunInputSourceReceipt, source: Extract<NativePayloadSourceInput, { kind: "tool_result" }>) {
  const perEntry = receipt.additionalInputs.map(entry => entry.inputs.filter(value =>
    value.kind === "tool_result" && isDeepStrictEqual(value, source)).length);
  const exact = perEntry.reduce((count, value) => count + value, 0);
  const conflicting = receipt.additionalInputs.some(entry => entry.inputs.some(value =>
    value.kind === "tool_result" && value.callId === source.callId && !isDeepStrictEqual(value, source)));
  return { exact, conflicting, duplicateWithinEntry: perEntry.some(value => value > 1) };
}

function nativeSourceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function assertNativeProjectSourceCurrentInScope(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; projectId: string;
  sources?: Extract<NativePayloadSourceInput, { kind: "project" }>[];
  workspaceSources?: Extract<NativePayloadSourceInput, { kind: "project_workspace" }>[];
}, scope: NativeSourceReadScope): Promise<void> {
  const activeKey = `native-project-owner:${input.companyId}:${input.projectId}`;
  if (scope.active.has(activeKey)) throw forbidden("A Native source Project graph contains a cycle");
  scope.active.add(activeKey);
  try {
    await assertNativeProjectSourceCurrentInScopeBody(db, input, scope);
  } finally {
    scope.active.delete(activeKey);
  }
}

async function assertNativeProjectTaskRootsCurrent(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; snapshot: NativePayloadSourceSnapshot;
}, scope: NativeSourceReadScope): Promise<void> {
  const taskInputs = input.snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
    source.kind === "task");
  const issueIds = [...new Set([...input.snapshot.policy.issueIds, ...taskInputs.map(source => source.issueId)])].sort();
  for (const issueId of issueIds) {
    const sources = taskInputs.filter(source => source.issueId === issueId);
    if (sources.length) {
      for (const source of sources) await assertNativeTaskSourceInputCurrentInScope(db, input.companyId, input.actor, source, scope);
    } else await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, issueId, scope);
  }
}

async function assertNativeProjectSourceCurrentInScopeBody(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; projectId: string;
  sources?: Extract<NativePayloadSourceInput, { kind: "project" }>[];
  workspaceSources?: Extract<NativePayloadSourceInput, { kind: "project_workspace" }>[];
}, scope: NativeSourceReadScope): Promise<void> {
  const projectId = input.projectId;
  nativeSourceReadWork(scope);
  const [project] = await db.select({ id: projects.id, companyId: projects.companyId, updatedAt: projects.updatedAt,
    sourceIssueIds: projects.sourceIssueIds, sourceProjectIds: projects.sourceProjectIds,
    sourceProvenanceQualified: projects.sourceProvenanceQualified,
    payloadSourceProtocolVersion: projects.payloadSourceProtocolVersion,
    payloadSourceSnapshot: projects.payloadSourceSnapshot, payloadSourceSnapshotInvalidated: projects.payloadSourceSnapshotInvalidated })
    .from(projects).where(and(eq(projects.companyId, input.companyId), eq(projects.id, projectId))).for("share");
  const currentWorkspaceSources = await db.select({ workspaceId: projectWorkspaces.id,
    sourceVersion: sql<string>`${projectWorkspaces.updatedAt}::text`,
    contentHash: sql<string>`encode(sha256(convert_to(to_jsonb(${projectWorkspaces})::text,'UTF8')),'hex')` })
    .from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, input.companyId),
      eq(projectWorkspaces.projectId, projectId))).for("share");
  if (!project || !await canActorReadProjectPrivacy(db, input.actor, project))
    throw forbidden("A Native source Project is unavailable");
  const owner = nativePayloadSourceSnapshotSchema.safeParse(project.payloadSourceSnapshot);
  const [hash] = await db.execute<{ hash: string }>(sql`select public.aw_native_payload_body_hash('project',to_jsonb(p)) as hash
    from projects p where p.company_id=${input.companyId}::uuid and p.id=${projectId}::uuid`);
  const currentProjection = await projectService(db as Db).getById(projectId);
  const currentPublicProjection = currentProjection ? publicNativePayloadRow(currentProjection) : null;
  const currentPublicHash = currentPublicProjection
    ? createHash("sha256").update(JSON.stringify(currentPublicProjection), "utf8").digest("hex") : null;
  const projectionRecord = currentProjection as unknown as Record<string, unknown> | null;
  const projectedWorkspaces = Array.isArray(projectionRecord?.workspaces)
    ? projectionRecord!.workspaces.filter((value): value is Record<string, unknown> =>
        value !== null && typeof value === "object" && !Array.isArray(value)) : [];
  const currentWorkspacePins = owner.success ? owner.data.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project_workspace" }> =>
    source.kind === "project_workspace" && source.projectId === projectId) : [];
  const allWorkspacePins = owner.success ? owner.data.inputs.filter(source => source.kind === "project_workspace") : [];
  const foreignWorkspacePins = allWorkspacePins.filter(source => source.projectId !== projectId);
  const sortedWorkspacePins = [...currentWorkspacePins].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  const sortedCurrentWorkspaceSources = [...currentWorkspaceSources].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  const requestedWorkspaceSources = input.workspaceSources ?? [];
  const sortedRequestedWorkspaceSources = [...requestedWorkspaceSources].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  const invalidWorkspaceSources = input.workspaceSources !== undefined &&
    (new Set(requestedWorkspaceSources.map(source => source.workspaceId)).size !== requestedWorkspaceSources.length ||
      !isDeepStrictEqual(sortedRequestedWorkspaceSources, sortedWorkspacePins));
  const projectionGoals = Array.isArray(projectionRecord?.goals) ? projectionRecord!.goals : null;
  const projectionHasManagedByPlugin = projectionRecord?.managedByPlugin !== null && projectionRecord?.managedByPlugin !== undefined;
  const projectionHasWorkspaceRuntimeServices = projectedWorkspaces.some(workspace =>
    !Array.isArray(workspace.runtimeServices) || workspace.runtimeServices.length > 0);
  const invalidSources = (input.sources ?? []).some(source => source.sourceVersion !== project.updatedAt.toISOString() ||
    source.contentHash !== currentPublicHash);
  const foreignWorkspaceProjectIds = [...new Set(foreignWorkspacePins.map(source => source.projectId))].sort();
  const foreignProjectSources = owner.success ? owner.data.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project" }> =>
    source.kind === "project" && source.projectId !== projectId && foreignWorkspaceProjectIds.includes(source.projectId)) : [];
  const expectedForeignProjectSourceIds = [...foreignWorkspaceProjectIds];
  const actualForeignProjectSourceIds = [...new Set(foreignProjectSources.map(source => source.projectId))].sort();
  if (project.payloadSourceProtocolVersion !== 1 || project.payloadSourceSnapshotInvalidated || !owner.success ||
    owner.data.owner.kind !== "project" || owner.data.owner.companyId !== input.companyId || owner.data.owner.id !== projectId || !hash ||
    owner.data.owner.contentHash !== hash.hash || invalidSources || invalidWorkspaceSources || !currentProjection ||
    project.sourceProvenanceQualified !== true ||
    // sourceIssueIds is constructor-owned provenance metadata. The sealed
    // owner hash pins its exact current value, while the original constructor
    // proves its meaning: direct Human capture admits source-free Projects;
    // managed creation separately binds producerIssueId + policy.issueIds in
    // its durable receipt. Do not infer links from every Task input here: a
    // snapshot can contain consumed Tasks that were not publication links.
    !isDeepStrictEqual([...project.sourceProjectIds].sort(), [...owner.data.policy.projectIds].sort()) ||
    !isDeepStrictEqual(sortedWorkspacePins, sortedCurrentWorkspaceSources.map(workspace => ({ kind: "project_workspace",
      projectId, workspaceId: workspace.workspaceId, sourceVersion: workspace.sourceVersion, contentHash: workspace.contentHash }))) ||
    !isDeepStrictEqual(actualForeignProjectSourceIds, expectedForeignProjectSourceIds) ||
    foreignWorkspacePins.some(source => !owner.data.policy.projectIds.includes(source.projectId)) ||
    !isDeepStrictEqual(projectedWorkspaces.map(workspace => workspace.id).sort(), currentWorkspaceSources.map(workspace => workspace.workspaceId).sort()) ||
    projectionGoals === null || projectionGoals.length > 0 || projectionHasManagedByPlugin || projectionHasWorkspaceRuntimeServices)
    throw forbidden("A Native source Project changed");

  // A Project snapshot can contain exact Task roots that are not publication
  // links. Revalidate those roots independently from sourceIssueIds, whose
  // meaning is established by the original Project constructor.
  await assertNativeProjectTaskRootsCurrent(db, { companyId: input.companyId, actor: input.actor, snapshot: owner.data }, scope);

  // Workspace rows from another Project are valid retained source roots only
  // when this snapshot also binds that parent Project's exact public DTO. Pin
  // each parent and its joined rows recursively under the same actor/transaction.
  for (const foreignProjectId of foreignWorkspaceProjectIds) {
    const parentSources = foreignProjectSources.filter(source => source.projectId === foreignProjectId);
    const parentWorkspaceSources = foreignWorkspacePins.filter(source => source.projectId === foreignProjectId);
    if (parentSources.length !== 1 || parentWorkspaceSources.length === 0)
      throw forbidden("A Native source Project workspace parent is ambiguous");
    await assertNativeProjectSourceCurrentInScope(db, { companyId: input.companyId, actor: input.actor,
      projectId: foreignProjectId, sources: parentSources, workspaceSources: parentWorkspaceSources }, scope);
  }
}

async function assertNativeProjectApiToolResultCurrentInScope(db: Db | Transaction, input: {
  companyId: string; run: typeof heartbeatRuns.$inferSelect;
  profile: Record<string, unknown>; receipt: NativeRunInputSourceReceipt; actor: AuthorizationActor; scope: NativeSourceReadScope;
  source: Extract<NativePayloadSourceInput, { kind: "tool_result" }>;
}): Promise<void> {
  const source = input.source;
  const captures = Array.isArray(input.profile.nativeToolResultSourceCaptures)
    ? input.profile.nativeToolResultSourceCaptures.map(nativeSourceRecord) : [];
  const originalCaptures = captures.filter(capture => capture.managedOpenCode !== true &&
    capture.callId === source.callId && capture.tool === "call_api" &&
    capture.operationId === "GET /api/projects/{id}" && capture.resultDigest === source.contentHash);
  const managedCaptures = captures.filter(capture => capture.managedOpenCode === true &&
    capture.callId === source.callId && capture.tool === "call_api" && capture.resultDigest === source.contentHash &&
    isDeepStrictEqual(capture.source, source));
  if (originalCaptures.length !== 1 || managedCaptures.length !== 1 || source.invocationId !== null)
    throw forbidden("A Native Project API result receipt is unavailable");
  const original = originalCaptures[0]!;
  const managed = managedCaptures[0]!;
  const projectSourceResult = nativePayloadSourceInputSchema.safeParse(original.source);
  const managedProjectSourceResult = nativePayloadSourceInputSchema.safeParse(managed.projectSource);
  if (!projectSourceResult.success || projectSourceResult.data.kind !== "project" ||
    !managedProjectSourceResult.success || managedProjectSourceResult.data.kind !== "project" ||
    !isDeepStrictEqual(managedProjectSourceResult.data, projectSourceResult.data) ||
    !/^[0-9a-f]{64}$/.test(String(original.requestHash ?? "")) ||
    original.projectId !== projectSourceResult.data.projectId ||
    original.pathAndQuery !== `/api/projects/${projectSourceResult.data.projectId}` ||
    original.turnId !== managed.turnId || original.eventSeq !== managed.eventSeq || original.attempt !== managed.attempt ||
    typeof original.turnId !== "string" || typeof managed.turnId !== "string" ||
    typeof original.eventSeq !== "number" || typeof original.attempt !== "number")
    throw forbidden("A Native Project API result capture is ambiguous");

  const receiptKey = createHash("sha256").update(source.callId, "utf8").digest("hex");
  const apiReceipts = nativeSourceRecord(nativeSourceRecord(input.run.resultJson).apiToolReceipts);
  const apiReceipt = nativeSourceRecord(apiReceipts[receiptKey]);
  const expectedReceiptKeys = ["callId", "turnId", "eventSeq", "attempt", "operationId", "method", "pathAndQuery",
    "requestHash", "argumentsHash", "state", "status", "resultDigest"].sort();
  if (!isDeepStrictEqual(Object.keys(apiReceipt).sort(), expectedReceiptKeys) ||
    apiReceipt.callId !== source.callId || apiReceipt.turnId !== original.turnId ||
    apiReceipt.eventSeq !== original.eventSeq || apiReceipt.attempt !== original.attempt ||
    apiReceipt.operationId !== "GET /api/projects/{id}" || apiReceipt.method !== "GET" ||
    apiReceipt.pathAndQuery !== original.pathAndQuery || apiReceipt.requestHash !== original.requestHash ||
    apiReceipt.state !== "completed" || apiReceipt.status !== 200 || apiReceipt.resultDigest !== source.contentHash)
    throw forbidden("A Native Project API receipt no longer matches its exact result capture");

  const associations = Array.isArray(input.profile.nativeToolCallDispatchAssociations)
    ? input.profile.nativeToolCallDispatchAssociations.map(nativeSourceRecord).filter(association =>
        association.callId === source.callId && association.turnId === original.turnId && association.tool === "call_api" &&
        association.eventSeq === original.eventSeq && association.attempt === original.attempt &&
        typeof association.argumentsHash === "string" && /^[0-9a-f]{64}$/.test(association.argumentsHash)) : [];
  const uses = Array.isArray(input.profile.nativeAwModelWireIntents)
    ? input.profile.nativeAwModelWireIntents.flatMap(value => {
        const intent = nativeSourceRecord(value);
        const responseUses = Array.isArray(intent.responseToolUses) ? intent.responseToolUses.map(nativeSourceRecord) : [];
        return responseUses.filter(use => use.id === source.callId && typeof use.name === "string" &&
          nativeProviderToolName(use.name) === "call_api").map(use => ({ intent, use }));
      }) : [];
  const dispatches = Array.isArray(input.profile.nativeModelInputDispatchIntents)
    ? input.profile.nativeModelInputDispatchIntents.map(nativeSourceRecord).filter(dispatch =>
        dispatch.turnId === original.turnId && dispatch.eventSeq === original.eventSeq &&
        dispatch.attempt === original.attempt && dispatch.responsibleUserId === input.run.responsibleUserId &&
        dispatch.continuation === false) : [];
  if (associations.length !== 1 || uses.length !== 1 || dispatches.length !== 1 ||
    associations[0]!.dispatchId !== dispatches[0]!.dispatchId ||
    !/^[0-9a-f]{64}$/.test(String(uses[0]!.use.argumentsHash ?? "")) ||
    uses[0]!.use.argumentsHash !== associations[0]!.argumentsHash ||
    apiReceipt.argumentsHash !== associations[0]!.argumentsHash ||
    typeof uses[0]!.intent.reservationId !== "string")
    throw forbidden("A Native Project API result is not bound to one acknowledged provider call");
  const [reservation] = await db.select({ status: orchestrationModelReservations.status,
    providerResponseHash: orchestrationModelReservations.providerResponseHash }).from(orchestrationModelReservations).where(and(
    eq(orchestrationModelReservations.companyId, input.companyId),
    eq(orchestrationModelReservations.id, uses[0]!.intent.reservationId as string),
    eq(orchestrationModelReservations.purpose, "worker_model"), eq(orchestrationModelReservations.status, "completed")));
  if (reservation?.status !== "completed" || typeof reservation.providerResponseHash !== "string")
    throw forbidden("A Native Project API provider result is unsettled");

  const projectSource = projectSourceResult.data;
  const additionalEntries = input.receipt.additionalInputs.filter(entry => entry.responsibleUserId === input.run.responsibleUserId &&
    isDeepStrictEqual(entry.inputs, [source, projectSource]) &&
    isDeepStrictEqual(entry.policy, { issueIds: [], projectIds: [projectSource.projectId], runIds: [], memoryIds: [],
      foundationRevisionIds: [] }));
  const toolResultCopies = input.receipt.additionalInputs.reduce((count, entry) => count + entry.inputs.filter(value =>
    value.kind === "tool_result" && value.callId === source.callId).length, 0);
  if (additionalEntries.length !== 1 || toolResultCopies !== 1 ||
    nativeToolResultReceiptCopies(input.receipt, source).conflicting)
    throw forbidden("A Native Project API result source entry is ambiguous");
  await assertNativeProjectSourceCurrentInScope(db, { companyId: input.companyId, actor: input.actor,
    projectId: projectSourceResult.data.projectId, sources: [projectSourceResult.data] }, input.scope);
}

/** Revalidate a captured Project DTO and its separately mutable workspace rows
 * at a tool-result publication boundary. The caller holds its privacy locks. */
export async function assertNativeProjectSourceCurrent(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; source: Extract<NativePayloadSourceInput, { kind: "project" }>;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    await assertNativeProjectSourceCurrentInScope(tx, { companyId: input.companyId, actor: input.actor,
      projectId: input.source.projectId, sources: [input.source] }, scope);
  }));
}

function nativeMemoryReviewEvidence(receipt: NativeRunInputSourceReceipt,
  memorySource: Extract<NativePayloadSourceInput, { kind: "memory" }>): Extract<NativePayloadSourceInput, { kind: "tool_result" }> | undefined {
  const entries = receipt.additionalInputs.filter(entry => entry.inputs.some(value => isDeepStrictEqual(value, memorySource)));
  if (entries.length !== 1) return undefined;
  const candidates = entries[0]!.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "tool_result" }> =>
    value.kind === "tool_result" && value.toolName === "paperclip-self:remember" && value.invocationId !== null);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function nativeManagedConsumedSourceParts(intent: Record<string, unknown>, expected: NativePayloadSourceSet) {
  const rawSet = intent.consumedSourceSet;
  const rawComponents = intent.consumedSourceComponents;
  if (!rawSet || typeof rawSet !== "object" || Array.isArray(rawSet) || !Array.isArray(rawComponents) ||
    rawComponents.length < 1 || rawComponents.length > 64 ||
    !isDeepStrictEqual(Object.keys(rawSet).sort(), ["inputs", "policy"])) return null;
  const value = rawSet as Record<string, unknown>;
  const policy = nativePayloadSourcePolicySchema.safeParse(value.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(value.inputs);
  if (!policy.success || !inputs.success || !isDeepStrictEqual(policy.data, expected.policy) ||
    !isDeepStrictEqual(inputs.data, expected.inputs)) return null;
  return { sourceSet: { policy: policy.data, inputs: inputs.data },
    components: rawComponents as NativeConsumedSourceComponent[] };
}

type NativeMemoryRecord = typeof memoryRecords.$inferSelect;
/** Review can promote a pending result without changing what the model read.
 * Bind every other persisted Memory field so this exception cannot cover a
 * body, scope, lineage, expiry, retention or metadata edit. */
export function nativeMemoryReviewTransitionStateHash(memory: NativeMemoryRecord): string {
  const { updatedAt: _updatedAt, reviewState: _reviewState, verificationState: _verificationState, ...stable } = memory;
  const normalized = Object.fromEntries(Object.entries(stable).map(([key, value]) =>
    [key, value instanceof Date ? value.toISOString() : value]));
  return nativeSha256(normalized);
}

async function assertNativeMemoryReviewTransitionEvidence(db: Db | Transaction, companyId: string,
  source: Extract<NativePayloadSourceInput, { kind: "memory" }>, evidence: Extract<NativePayloadSourceInput, { kind: "tool_result" }> | undefined,
  memory: NativeMemoryRecord): Promise<boolean> {
  const capturedVersion = Date.parse(source.sourceVersion);
  const evidenceBound = Boolean(evidence && evidence.toolName === "paperclip-self:remember" && evidence.invocationId !== null);
  const captureStatesMatch = source.reviewStateAtCapture === "pending" && source.verificationStateAtCapture === "unverified";
  const currentStatesMatch = memory.reviewState === "accepted" && memory.verificationState === "human_verified";
  const timeAdvanced = Number.isFinite(capturedVersion) && memory.updatedAt.getTime() > capturedVersion;
  const stateHashMatches = Boolean(source.reviewTransitionStateHash &&
    nativeMemoryReviewTransitionStateHash(memory) === source.reviewTransitionStateHash);
  const earlyChecksMatch = evidenceBound && captureStatesMatch && currentStatesMatch && timeAdvanced && stateHashMatches;
  if (!earlyChecksMatch) return false;
  if (!evidence || evidence.toolName !== "paperclip-self:remember" || evidence.invocationId === null) return false;
  const [invocation] = await db.select({ runId: toolInvocations.runId, toolName: toolInvocations.toolName,
    idempotencyKey: toolInvocations.idempotencyKey, status: toolInvocations.status,
    resultHash: toolInvocations.resultHash, workflowResultJson: toolInvocations.workflowResultJson })
    .from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId),
      eq(toolInvocations.id, evidence.invocationId), eq(toolInvocations.runId, evidence.runId),
      eq(toolInvocations.status, "succeeded"), eq(toolInvocations.toolName, "paperclip-self:remember"),
      eq(toolInvocations.resultHash, evidence.contentHash))).for("share");
  if (!invocation) {
    return false;
  }
  const invocationBound = invocation.idempotencyKey === `aw-native-tool:${evidence.runId}:${evidence.callId}` &&
    invocation.runId === evidence.runId && nativeSha256(invocation.workflowResultJson) === evidence.contentHash &&
    invocation.workflowResultJson && typeof invocation.workflowResultJson === "object" && !Array.isArray(invocation.workflowResultJson);
  if (!invocationBound) return false;
  const result = invocation.workflowResultJson as Record<string, unknown>;
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? result.data as Record<string, unknown> : null;
  const record = data?.record && typeof data.record === "object" && !Array.isArray(data.record)
    ? data.record as Record<string, unknown> : null;
  const scope = record?.scope && typeof record.scope === "object" && !Array.isArray(record.scope)
    ? record.scope as Record<string, unknown> : null;
  return data?.status === "pending" && record?.id === source.memoryId && record.reviewState === "pending" &&
    record.verificationState === "unverified" && record.content === memory.content &&
    (record.ownerAgentId ?? null) === (memory.ownerAgentId ?? null) &&
    (record.supersedesRecordId ?? null) === (memory.supersedesRecordId ?? null) &&
    (record.supersededByRecordId ?? null) === (memory.supersededByRecordId ?? null) &&
    scope?.type === memory.scopeType && (scope.id ?? null) === memory.scopeId;
}

async function assertNativeMemorySourceCurrent(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  source: Extract<NativePayloadSourceInput, { kind: "memory" }>,
  transitionEvidence?: Extract<NativePayloadSourceInput, { kind: "tool_result" }>): Promise<void> {
  const [memory] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
    eq(memoryRecords.id, source.memoryId), isNull(memoryRecords.deletedAt))).for("share");
  const versionMatches = !!memory && memory.updatedAt.toISOString() === source.sourceVersion;
  const acceptedReviewMatches = !!memory && !versionMatches && await assertNativeMemoryReviewTransitionEvidence(db, companyId,
    source, transitionEvidence, memory);
  const contentHashMatches = !!memory && nativeSha256(memory.content) === source.contentHash;
  const readable = await canActorReadMemorySources(db as Db, companyId, actor, source.memoryId);
  if (!memory || (!versionMatches && !acceptedReviewMatches) || !contentHashMatches || !readable) {
    if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1") {
      console.error("native_exact_memory_source_test_failure", JSON.stringify({
        rowPresent: Boolean(memory), versionMatches, transitionEvidencePresent: Boolean(transitionEvidence), acceptedReviewMatches,
        contentHashMatches, readable, actorType: actor.type, actorIsAgent: actor.type === "agent",
        actorSource: actor.source === "local_implicit" ? "local_implicit" :
          actor.source === "agent_jwt" ? "agent_jwt" : actor.source === "none" ? "none" : "other",
        actorHasUser: Boolean(actor.userId),
        actorHasRun: Boolean(actor.runId), actorHasResponsibleHuman: Boolean(actor.onBehalfOfUserId),
        transitionTool: transitionEvidence?.kind === "tool_result"
          ? transitionEvidence.toolName === "self_remember" ? "self_remember" :
            transitionEvidence.toolName === "read_context" ? "read_context" :
            transitionEvidence.toolName === "write_document" ? "write_document" :
            transitionEvidence.toolName === "create_task" ? "create_task" :
            transitionEvidence.toolName === "read_document" ? "read_document" :
            transitionEvidence.toolName === "call_api" ? "call_api" : "other"
          : "none",
      }));
    }
    throw forbidden("A Native Memory source is unavailable");
  }
}

/** Revalidate an exact Memory body delivered as a prior managed tool result.
 * The caller must also bind its tool_result bytes to the canonical succeeded
 * Gateway invocation; this validates the returned Memory owner and current ACL. */
export async function assertNativeMemorySourceInputCurrent(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; source: Extract<NativePayloadSourceInput, { kind: "memory" }>;
  transitionEvidence?: Extract<NativePayloadSourceInput, { kind: "tool_result" }>;
}): Promise<void> {
  if (!input.source.memoryId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.source.memoryId) ||
    !await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("A Native Memory source is unavailable");
  await assertNativeMemorySourceCurrent(db, input.companyId, input.actor, input.source, input.transitionEvidence);
}

export interface NativeIssueEffectPrefix {
  readonly policy: NativePayloadSourcePolicy;
  readonly inputs: NativePayloadSourceInput[];
  readonly runId: string;
}

/** Validate the server-only provider/tool output carrier against the settled
 * Messages response, recorded tool-use block, dispatch association, and exact
 * run receipt source set. The caller never supplies this object. */
export async function assertNativeModelOutputCaptureCurrent(db: Db | Transaction, companyId: string, issueId: string,
  capture: NativeModelOutputCapture, expectedToolName: string, currentReader?: AuthorizationActor): Promise<void> {
  const actor = currentReader ?? { type: "none", source: "none" } as AuthorizationActor;
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, companyId, scope);
    if (currentReader && !await nativeSourceReaderHasCompanyAccess(tx, companyId, currentReader))
      throw forbidden("The Native output reader is unavailable");
    await assertNativeModelOutputCaptureCurrentInScope(tx, companyId, issueId, capture, expectedToolName,
      scope, 0, currentReader);
  }));
}

async function assertNativeModelOutputCaptureCurrentInScope(db: Db | Transaction, companyId: string, issueId: string,
  capture: NativeModelOutputCapture, expectedToolName: string, scope: NativeSourceReadScope, depth: number,
  currentReader?: AuthorizationActor): Promise<void> {
  if (depth > 8 || scope.context.work > 512) throw forbidden("The Native output source chain exceeds its bound");
  nativeSourceReadWork(scope);
  const use = capture.managedOpenCodeToolUse;
  if (!use || capture.runId !== capture.dispatch.runId ||
    !["worker_model_dispatch", "conversation_model_dispatch"].includes(capture.dispatch.kind) ||
    capture.dispatch.callId.length > 240 || use.toolName !== expectedToolName ||
    !/^[\x21-\x7e]{1,240}$/.test(use.callId) || !/^[0-9a-f]{64}$/.test(use.argumentsHash) ||
    !/^[0-9a-f]{64}$/.test(use.responseContentHash) || !capture.sourceSet.inputs.some(source =>
      source.kind === "task" && source.issueId === issueId)) throw forbidden("The Native output capture is unavailable");
  const run = await nativeSourceReadRun(db, companyId, capture.runId, scope);
  const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  const receipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  const intents = profile?.nativeAwModelWireIntents;
  const intent = Array.isArray(intents) ? intents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).reservationId === capture.dispatch.reservationId &&
    (value as Record<string, unknown>).modelPurpose === (capture.dispatch.kind === "conversation_model_dispatch" ? "conversation_model" : "worker_model")) as Record<string, unknown>[] : [];
  const associations = Array.isArray(profile?.nativeToolCallDispatchAssociations)
    ? profile.nativeToolCallDispatchAssociations.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).callId === use.callId && typeof (value as Record<string, unknown>).tool === "string" &&
      nativeProviderToolName((value as Record<string, unknown>).tool as string) === use.toolName &&
      (value as Record<string, unknown>).argumentsHash === use.argumentsHash)
    : [];
  const reservation = await nativeSourceReadReservation(db, companyId, capture.dispatch.reservationId, scope);
  const bootstrap = receipt?.success ? receipt.data.bootstrap : null;
  const wire = intent[0];
  const uses = Array.isArray(wire?.responseToolUses) ? wire.responseToolUses.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).id === use.callId &&
    typeof (value as Record<string, unknown>).name === "string" &&
    nativeProviderToolName((value as Record<string, unknown>).name as string) === use.toolName &&
    (value as Record<string, unknown>).argumentsHash === use.argumentsHash) : [];
  const matchingPrefixDispatches = receipt?.success ? receipt.data.dispatches.filter(source =>
    source.inputs.some(value => value.kind === capture.dispatch.kind && isDeepStrictEqual(value, capture.dispatch)) &&
    isDeepStrictEqual(source.policy, capture.sourceSet.policy) &&
    isDeepStrictEqual(source.inputs.filter(value => !(value.kind === capture.dispatch.kind && isDeepStrictEqual(value, capture.dispatch))),
      capture.sourceSet.inputs)) : [];
  const expectedPurpose = capture.dispatch.kind === "worker_model_dispatch" ? "worker_model" : "conversation_model";
  const expectedIdempotencyKey = expectedPurpose === "worker_model"
    ? `worker-model-messages:${capture.runId}:${capture.dispatch.requestHash}`
    : `conversation-model-messages:${capture.runId}:${capture.dispatch.requestHash}`;
  const conversationBinding = nativeSourceRecord(wire?.conversationModelBinding);
  const [conversationIssue] = capture.dispatch.kind === "conversation_model_dispatch"
    ? await db.select().from(issues).where(and(eq(issues.companyId, companyId),
      eq(issues.id, capture.dispatch.issueId))).for("share") : [];
  const [conversationManifest] = capture.dispatch.kind === "conversation_model_dispatch"
    ? await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId),
      eq(agentExecutionManifests.id, capture.dispatch.executionManifestId),
      eq(agentExecutionManifests.agentId, capture.dispatch.agentId),
      eq(agentExecutionManifests.runId, capture.dispatch.runId))).for("share") : [];
  if (!run || run.nativeIssueId !== issueId || run.runtimeMode !== "native" || !receipt?.success || !bootstrap || !reservation ||
    reservation.purpose !== expectedPurpose || reservation.status !== "completed" ||
    intent.length !== 1 || associations.length !== 1 || uses.length !== 1 ||
    matchingPrefixDispatches.length !== 1 ||
    wire?.sourcePolicyHash !== nativeSha256(bootstrap) || wire?.responseContentHash !== use.responseContentHash ||
    reservation.inputHash !== capture.dispatch.requestHash || reservation.providerResponseHash !== capture.dispatch.responseHash ||
    reservation.idempotencyKey !== expectedIdempotencyKey ||
    (capture.dispatch.kind === "conversation_model_dispatch" && (reservation.conversationAgentId !== capture.dispatch.agentId ||
      reservation.conversationRunId !== capture.dispatch.runId || reservation.conversationIssueId !== capture.dispatch.issueId ||
      reservation.conversationSessionGeneration !== capture.dispatch.conversationSessionGeneration ||
      reservation.executionManifestId !== capture.dispatch.executionManifestId || reservation.executionManifestHash !== capture.dispatch.executionManifestHash ||
      wire?.agentId !== capture.dispatch.agentId || conversationBinding.issueId !== capture.dispatch.issueId ||
      conversationBinding.conversationSessionGeneration !== capture.dispatch.conversationSessionGeneration ||
      conversationBinding.executionManifestId !== capture.dispatch.executionManifestId ||
      conversationBinding.executionManifestHash !== capture.dispatch.executionManifestHash ||
      run.agentId !== capture.dispatch.agentId || run.responsibleUserId !== conversationIssue?.conversationUserId ||
      run.contextSnapshot?.conversationSessionGeneration !== capture.dispatch.conversationSessionGeneration ||
      !conversationIssue || conversationIssue.conversationAgentId !== capture.dispatch.agentId ||
      conversationIssue.conversationUserId !== run.responsibleUserId ||
      conversationIssue.conversationSessionGeneration !== capture.dispatch.conversationSessionGeneration ||
      conversationIssue.conversationState !== "active" || conversationIssue.conversationRetiredAt !== null ||
      conversationIssue.executionRunId !== capture.dispatch.runId || conversationIssue.status !== "in_review" ||
      !conversationManifest || conversationManifest.hash !== capture.dispatch.executionManifestHash ||
      conversationManifest.manifest.responsibleUserId !== run.responsibleUserId)) ||
    wire.callId !== capture.dispatch.callId || wire.requestHash !== capture.dispatch.requestHash ||
    wire.wireBodyHash !== capture.dispatch.wireBodyHash || wire.endpoint !== "https://api.anthropic.com/v1/messages" || wire.method !== "POST")
    throw forbidden("The Native output capture is not bound to its settled provider tool use");

  // The producer identity authenticates the immutable receipt above. Current
  // source ACL checks use the actual requesting reader so terminal producer
  // runs do not make otherwise-readable retained Memory inputs inaccessible.
  const actor: AuthorizationActor = currentReader ?? { type: "agent", source: "none", companyId,
    agentId: run.agentId, runId: run.id, onBehalfOfUserId: run.responsibleUserId };
  if (!capture.consumedSourceComponents || capture.consumedSourceComponents.length === 0)
    throw forbidden("The Native output capture lacks its consumed source components");
  await assertNativeManagedConsumedSourceSetCurrentInScope(db, { companyId, issueId, runId: capture.runId,
    actor, components: capture.consumedSourceComponents, sourceSet: capture.sourceSet }, scope);
  const taskInputs = capture.sourceSet.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
    source.kind === "task");
  const taskRootIds = [...new Set([...capture.sourceSet.policy.issueIds, ...taskInputs.map(source => source.issueId)])].sort();
  for (const taskId of taskRootIds) {
    const sources = taskInputs.filter(source => source.issueId === taskId);
    if (sources.length) {
      for (const source of sources) await assertNativeTaskSourceInputCurrentInScope(db, companyId, actor, source, scope);
    } else await assertNativeTaskSnapshotOwnerCurrentInScope(db, companyId, actor, taskId, scope);
  }
  // The exact consumed component walk above revalidated current Memory ACLs
  // for the complete, component-bound policy union. Keep this second walk's
  // independent owner snapshot/body binding, without recursing into those ACL
  // graphs a second time inside the same read scope.
  for (const memoryId of capture.sourceSet.policy.memoryIds) {
    nativeSourceReadWork(scope);
    const [memory] = await db.select({ id: memoryRecords.id, companyId: memoryRecords.companyId,
      payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, memoryId), isNull(memoryRecords.deletedAt), memoryPayloadVisible()));
    const owner = nativePayloadSourceSnapshotSchema.safeParse(memory?.payloadSourceSnapshot);
    const [ownerHash] = await db.execute<{ hash: string }>(sql`select public.aw_native_payload_body_hash('memory_record',to_jsonb(m)) as hash
      from memory_records m where m.company_id=${companyId}::uuid and m.id=${memoryId}::uuid and m.deleted_at is null`);
    const ownerHashMatches = Boolean(owner.success && owner.data.owner.kind === "memory_record" && ownerHash &&
      owner.data.owner.contentHash === ownerHash.hash);
    if (!memory || memory.payloadSourceSnapshotInvalidated || !owner.success || owner.data.owner.kind !== "memory_record" ||
      !ownerHashMatches) {
      if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1") {
        console.error("native_output_memory_owner_test_failure", JSON.stringify({
          rowPresent: Boolean(memory), snapshotInvalidated: memory?.payloadSourceSnapshotInvalidated ?? null,
          ownerSnapshotValid: owner.success, ownerKindMatches: owner.success && owner.data.owner.kind === "memory_record",
          ownerHashPresent: Boolean(ownerHash), ownerHashMatches,
        }));
      }
      throw forbidden("A Native output Memory source is unavailable");
    }
  }
  if (capture.sourceSet.policy.foundationRevisionIds.length) {
    const access = await authorizationService(db).decide({ actor, action: "foundation:read",
      resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
    if (!access.allowed) throw forbidden("A Native output Foundation source is unavailable");
    for (const revisionId of capture.sourceSet.policy.foundationRevisionIds)
      await assertLearnedAssetAnalyticalSources(db, companyId, "document_revision", revisionId, actor);
  }
  const [completionContract] = capture.sourceSet.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "completion_contract" }> => source.kind === "completion_contract");
  if (completionContract) {
    const [current] = await db.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId),
      eq(completionContracts.id, completionContract.contractId), eq(completionContracts.issueId, completionContract.issueId)));
    if (!current || current.revision.toString() !== completionContract.revision || current.canonicalSha256 !== completionContract.contentHash)
      throw forbidden("The Native output completion contract changed");
  }
  for (const source of capture.sourceSet.inputs) if (source.kind === "runtime_instructions") {
    if (source.agentId !== run.agentId) throw forbidden("The Native output runtime instruction owner changed");
    const [agentRow] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, source.agentId)));
    if (!agentRow) throw forbidden("The Native output runtime instruction owner is unavailable");
    await assertAuthoredAgentSnapshotCurrent(db as Db, agentRow).catch(() => {
      throw forbidden("The Native output authored Agent changed");
    });
    const execution = profile?.nativeExecutionInput && typeof profile.nativeExecutionInput === "object" && !Array.isArray(profile.nativeExecutionInput)
      ? profile.nativeExecutionInput as Record<string, unknown> : null;
    const runtimeContext = execution?.runtimeContext as Record<string, unknown> | undefined;
    const instructions = runtimeContext?.instructions as Record<string, unknown> | undefined;
    const bundle = instructions?.bundle as Parameters<typeof readNativeRuntimeAssetText>[0] | undefined;
    if (!bundle || bundle.digest !== source.bundleDigest || bundle.manifestDigest !== source.manifestDigest)
      throw forbidden("The Native output runtime instruction source changed");
    await readNativeRuntimeAssetText(bundle, 256000, { companyId, runId: run.id }).catch(() => {
      throw forbidden("The Native output runtime instruction source was erased");
    });
  }
  for (const source of capture.sourceSet.inputs) if (source.kind === "runtime_skill") {
    const execution = profileRunExecution(run);
    const runtime = execution?.runtimeContext && typeof execution.runtimeContext === "object" && !Array.isArray(execution.runtimeContext)
      ? execution.runtimeContext as Record<string, unknown> : null;
    const skills = Array.isArray(runtime?.skills) ? runtime!.skills as Record<string, unknown>[] : [];
    const selected = skills.find(value => value.key === source.key && value.versionId === source.versionId &&
      (value.bundle as Record<string, unknown> | undefined)?.digest === source.bundleDigest &&
      (value.bundle as Record<string, unknown> | undefined)?.manifestDigest === source.manifestDigest);
    const bundle = selected?.bundle as Parameters<typeof readNativeRuntimeAssetText>[0] | undefined;
    if (!bundle) throw forbidden("The Native output runtime Skill changed");
    await readNativeRuntimeAssetText(bundle, 256000, { companyId, runId: run.id }).catch(() => {
      throw forbidden("The Native output runtime Skill was erased");
    });
    if (source.versionId) {
      const [version] = await db.select({ id: companySkillVersions.id, skillId: companySkillVersions.companySkillId })
        .from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId),
          eq(companySkillVersions.id, source.versionId)));
      if (!version) throw forbidden("The Native output runtime Skill version is unavailable");
      await assertRuntimeSkillSourceRetained(db as Db, companyId, actor, version.skillId, source.versionId).catch(() => {
        throw forbidden("The Native output runtime Skill source changed");
      });
    }
  }
  for (const source of capture.sourceSet.inputs) if (source.kind === "workspace_metadata") {
    const execution = profile?.nativeExecutionInput && typeof profile.nativeExecutionInput === "object" && !Array.isArray(profile.nativeExecutionInput)
      ? profile.nativeExecutionInput as Record<string, unknown> : null;
    const workspace = execution?.workspace as Record<string, unknown> | undefined;
    const binding = execution?.binding as Record<string, unknown> | undefined;
    const tuple = workspace && { cwd: workspace.cwd, repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName };
    if (!tuple || source.runId !== run.id || binding?.executionWorkspaceId !== source.executionWorkspaceId ||
      createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex") !== source.contentHash)
      throw forbidden("The Native output workspace tuple changed");
    if (source.origin === "agent_home") {
      const [competingOwner] = await db.select({ id: executionWorkspaces.id }).from(executionWorkspaces).where(and(
        eq(executionWorkspaces.companyId, companyId), eq(executionWorkspaces.id, source.executionWorkspaceId)));
      if (competingOwner || source.executionWorkspaceId !== run.id || source.sourceVersion !== `agent-home:${run.agentId}:v1` ||
        !isDeepStrictEqual(tuple, { cwd: resolveDefaultAgentWorkspaceDir(run.agentId), repoUrl: null, repoRef: null, branchName: null }))
        throw forbidden("The Native output agent workspace changed");
    } else if (source.origin === "execution_workspace") {
      const [current] = await db.select({ cwd: executionWorkspaces.cwd, repoUrl: executionWorkspaces.repoUrl,
        repoRef: executionWorkspaces.baseRef, branchName: executionWorkspaces.branchName, updatedAt: executionWorkspaces.updatedAt })
        .from(executionWorkspaces).where(and(eq(executionWorkspaces.companyId, companyId), eq(executionWorkspaces.id, source.executionWorkspaceId)));
      if (!current || current.updatedAt.toISOString() !== source.sourceVersion ||
        !isDeepStrictEqual({ cwd: current.cwd, repoUrl: current.repoUrl, repoRef: current.repoRef, branchName: current.branchName }, tuple))
        throw forbidden("The Native output workspace owner changed");
    } else if (source.origin === "task_session") {
      // The task session has no execution_workspace row. Its exact tuple is
      // retained in the server-owned immutable execution input for this run.
      if (source.executionWorkspaceId !== run.id || source.sourceVersion !== `task-session:${run.id}`)
        throw forbidden("The Native task-session workspace source changed");
    } else throw forbidden("The Native output workspace source family is unsupported");
  }
  for (const source of capture.sourceSet.inputs) {
    nativeSourceReadWork(scope);
    if (source.kind === "comment") {
      const [comment] = await db.select({ sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text`, issueId: issueComments.issueId })
        .from(issueComments).where(and(eq(issueComments.companyId, companyId), eq(issueComments.issueId, source.issueId),
          eq(issueComments.id, source.commentId), isNull(issueComments.deletedAt)));
      const { issueService } = await import("./issues.js");
      const view = comment ? await issueService(db as Db).getComment(source.commentId) : null;
      const projection = view && typeof view === "object" ? view as Record<string, unknown> : null;
      if (!comment || comment.sourceVersion !== source.sourceVersion || !projection ||
        nativeSha256({ body: projection.body, presentation: projection.presentation, metadata: projection.metadata }) !== source.contentHash ||
        !await canActorReadIssuePrivacy(db, actor, { id: source.issueId, companyId }))
        throw forbidden("A Native output comment source changed or was erased");
    }
    if (source.kind === "interaction") {
      const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
      const current: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
      await materializeNativeInteractionResponses({ db: db as Db, companyId, issueId: source.issueId, runId: run.id,
        agentId: run.agentId, interactionIds: [source.interactionId], onSourceCapture: value => { current.push(value); } });
      if (current.length !== 1 || !isDeepStrictEqual(current[0], source))
        throw forbidden("A Native output interaction source changed or was erased");
    }
    if (source.kind === "attachment") {
      const [attachment] = await db.select({ attachment: issueAttachments, asset: assets }).from(issueAttachments)
        .innerJoin(assets, and(eq(assets.companyId, issueAttachments.companyId), eq(assets.id, issueAttachments.assetId)))
        .where(and(eq(issueAttachments.companyId, companyId), eq(issueAttachments.issueId, source.issueId),
          eq(issueAttachments.id, source.attachmentId)));
      if (!attachment || attachment.attachment.payloadSourceSnapshotInvalidated || source.assetId !== attachment.asset.id ||
        source.sha256 !== attachment.asset.sha256 || source.byteSize !== attachment.asset.byteSize ||
        source.commentId !== attachment.attachment.issueCommentId || !await canActorReadIssuePrivacy(db, actor, { id: source.issueId, companyId }))
        throw forbidden("A Native output attachment source changed or was erased");
    }
    if (source.kind === "authored_definition") {
      const [agentRow] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, source.agentId)));
      if (!agentRow) throw forbidden("A Native output authored Agent is unavailable");
      await assertAuthoredAgentSnapshotCurrent(db as Db, agentRow).catch(() => {
        throw forbidden("A Native output authored Agent changed");
      });
      const config = agentRow.runtimeConfig && typeof agentRow.runtimeConfig === "object" && !Array.isArray(agentRow.runtimeConfig)
        ? agentRow.runtimeConfig as Record<string, unknown> : {};
      const authored = config[AUTHORED_AGENT_DEFINITION_KEY] && typeof config[AUTHORED_AGENT_DEFINITION_KEY] === "object"
        ? config[AUTHORED_AGENT_DEFINITION_KEY] as Record<string, unknown> : null;
      if (!authored || authored.revisionId !== source.revisionId || authored.definitionHash !== source.definitionHash ||
        (authored.procedureSnapshotHash ?? null) !== source.procedureSnapshotHash)
        throw forbidden("A Native output authored Agent changed");
    }
    if (source.kind === "skill_version") {
      const selected = await skillResolverService(db as Db).authorizedVersion(actor, companyId, source.skillId, source.versionId)
        .catch(() => { throw forbidden("A Native output Skill version is unavailable"); });
      const body = selected.version.fileInventory.find(file => file.path === "SKILL.md")?.content;
      if (selected.skill.key !== source.skillKey || !body || nativeSha256(body) !== source.contentHash)
        throw forbidden("A Native output Skill version changed");
      await assertLearnedAssetAnalyticalSources(db, companyId, "skill_version", source.versionId, actor);
    }
    if (source.kind === "playbook_revision") {
      const [playbook] = await db.select({ body: documentRevisions.body }).from(playbookDocuments)
        .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, playbookDocuments.companyId),
          eq(documentRevisions.documentId, playbookDocuments.documentId), eq(documentRevisions.id, playbookDocuments.approvedRevisionId)))
        .where(and(eq(playbookDocuments.companyId, companyId), eq(playbookDocuments.id, source.playbookId),
          eq(playbookDocuments.approvedRevisionId, source.revisionId), eq(playbookDocuments.status, "approved")));
      if (!playbook || createHash("sha256").update(playbook.body, "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native output Playbook revision changed");
      await assertLearnedAssetAnalyticalSources(db, companyId, "document_revision", source.revisionId, actor);
    }
    if (source.kind === "foundation_revision") {
      const [foundation] = await db.select({ body: documentRevisions.body }).from(foundationDocuments)
        .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, foundationDocuments.companyId),
          eq(documentRevisions.documentId, foundationDocuments.documentId), eq(documentRevisions.id, foundationDocuments.approvedRevisionId)))
        .where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, source.foundationDocumentId),
          eq(foundationDocuments.documentId, source.documentId), eq(foundationDocuments.approvedRevisionId, source.revisionId),
          eq(foundationDocuments.status, "approved"))).for("share", { of: [foundationDocuments, documentRevisions] });
      if (!foundation || createHash("sha256").update(foundation.body, "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native output Foundation revision changed");
      await assertLearnedAssetAnalyticalSources(db, companyId, "document_revision", source.revisionId, actor);
    }
    if (source.kind === "role_pack_version") {
      const { rolePackService } = await import("./role-packs.js");
      let currentInputs: Extract<NativePayloadSourceInput, { kind: "role_pack_version" }>[] = [];
      await rolePackService(db).resolve(actor, companyId, run.agentId, undefined, undefined, values => { currentInputs = values; });
      if (currentInputs.filter(value => isDeepStrictEqual(value, source)).length !== 1)
        throw forbidden("A Native output Role Pack version changed");
      await assertLearnedAssetAnalyticalSources(db, companyId, "role_pack_version", source.versionId, actor);
    }
  }
  for (const source of capture.sourceSet.inputs) {
    if (["task", "project", "memory", "context", "document_revision", "completion_contract", "runtime_instructions", "runtime_skill", "workspace_metadata", "worker_model_dispatch", "conversation_model_dispatch", "tool_result"].includes(source.kind)) {
      if (source.kind === "memory") {
        if (!capture.sourceSet.policy.memoryIds.includes(source.memoryId)) throw forbidden("A Native Memory source is unavailable");
        const evidence = receipt?.success ? nativeMemoryReviewEvidence(receipt.data, source) : undefined;
        await assertNativeMemorySourceCurrent(db, companyId, actor, source, evidence);
      }
      if (source.kind === "document_revision") {
        if (!source.issueId) throw forbidden("A Native output document source is unavailable");
        const [revision] = await db.select({ body: documentRevisions.body,
          payloadSourceProtocolVersion: documentRevisions.payloadSourceProtocolVersion })
          .from(documentRevisions).where(and(eq(documentRevisions.companyId, companyId),
            eq(documentRevisions.id, source.revisionId)));
        if (!revision || revision.payloadSourceProtocolVersion !== 1 ||
          createHash("sha256").update(revision.body, "utf8").digest("hex") !== source.contentHash)
          throw forbidden("A Native output document source changed");
        await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId, issueId: source.issueId,
          revisionId: source.revisionId, actor, requireLatest: false }, scope, depth + 1);
      }
      if (source.kind === "worker_model_dispatch") {
        const [sourceReservation] = await db.select().from(orchestrationModelReservations).where(and(
          eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.id, source.reservationId),
          eq(orchestrationModelReservations.purpose, "worker_model"), eq(orchestrationModelReservations.status, "completed"))).for("share");
        const sourceIntents = Array.isArray(profile?.nativeAwModelWireIntents) ? profile.nativeAwModelWireIntents : [];
        const sourceIntentMatches = sourceIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
          (value as Record<string, unknown>).reservationId === source.reservationId &&
          (value as Record<string, unknown>).callId === source.callId &&
          (value as Record<string, unknown>).requestHash === source.requestHash &&
          (value as Record<string, unknown>).wireBodyHash === source.wireBodyHash &&
          (value as Record<string, unknown>).endpoint === "https://api.anthropic.com/v1/messages" &&
          (value as Record<string, unknown>).method === "POST");
        const sourceDispatchIntent = sourceIntentMatches.length === 1 ? sourceIntentMatches[0] as Record<string, unknown> : null;
        const exactSourceDispatchPrefix = typeof sourceDispatchIntent?.sourceDispatchDigest === "string" &&
          receipt.data.dispatches.some(prefix => prefix.executionInputDigest === sourceDispatchIntent.sourceDispatchDigest &&
            prefix.inputs.some(item => item.kind === "worker_model_dispatch" && isDeepStrictEqual(item, source)));
        const conflictingCopies = receipt.data.dispatches.some(prefix => prefix.inputs.some(item =>
          item.kind === "worker_model_dispatch" && item.reservationId === source.reservationId &&
          !isDeepStrictEqual(item, source)));
        if (source.runId !== capture.runId || !sourceReservation || sourceIntentMatches.length !== 1 ||
          sourceReservation.inputHash !== source.requestHash || sourceReservation.providerResponseHash !== source.responseHash ||
          !exactSourceDispatchPrefix || conflictingCopies || sourceDispatchIntent!.requestHash !== source.requestHash ||
          sourceDispatchIntent!.wireBodyHash !== source.wireBodyHash ||
          typeof sourceDispatchIntent!.responseContentHash !== "string" ||
          !/^[0-9a-f]{64}$/.test(sourceDispatchIntent!.responseContentHash as string) ||
          sourceDispatchIntent!.endpoint !== "https://api.anthropic.com/v1/messages" || sourceDispatchIntent!.method !== "POST")
          throw forbidden("A Native output historical model dispatch is unavailable");
      }
      if (source.kind === "tool_result") {
        const recorded = nativeToolResultReceiptCopies(receipt.data, source);
        if (recorded.exact < 1 || recorded.conflicting || recorded.duplicateWithinEntry)
          throw forbidden("A Native output historical tool result is unavailable");
        const captures = Array.isArray(profile?.nativeToolResultSourceCaptures) ? profile!.nativeToolResultSourceCaptures : [];
        const matching = captures.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
          (value as Record<string, unknown>).callId === source.callId && typeof (value as Record<string, unknown>).tool === "string" &&
          nativeProviderToolName((value as Record<string, unknown>).tool as string) === source.toolName &&
          (value as Record<string, unknown>).resultDigest === source.contentHash &&
          isDeepStrictEqual((value as Record<string, unknown>).source, source));
        if (matching.length !== 1) throw forbidden("A Native output tool result source is unavailable");
        if (source.invocationId) {
          const [invocation] = await db.select({ id: toolInvocations.id, status: toolInvocations.status,
            runId: toolInvocations.runId, issueId: toolInvocations.issueId, toolName: toolInvocations.toolName,
            resultHash: toolInvocations.resultHash }).from(toolInvocations).where(and(
              eq(toolInvocations.companyId, companyId), eq(toolInvocations.id, source.invocationId),
              eq(toolInvocations.runId, capture.runId), eq(toolInvocations.status, "succeeded"))).for("share");
          if (!invocation || invocation.toolName !== source.toolName || invocation.resultHash !== source.contentHash ||
            invocation.issueId !== issueId) throw forbidden("A Native output tool invocation is unavailable");
        } else throw forbidden("A Native output tool invocation is unavailable");
        const captureRow = matching[0] as Record<string, unknown>;
        const documentRevision = captureRow.documentRevision && typeof captureRow.documentRevision === "object" && !Array.isArray(captureRow.documentRevision)
          ? captureRow.documentRevision as Record<string, unknown> : null;
        if (documentRevision) {
          if (typeof documentRevision.issueId !== "string" || typeof documentRevision.revisionId !== "string")
            throw forbidden("A Native output document tool result is unavailable");
          await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId,
            issueId: documentRevision.issueId, revisionId: documentRevision.revisionId, actor, requireLatest: false }, scope, depth + 1);
        }
      }
      continue;
    }
    throw forbidden("A Native output source family is unsupported");
  }
}

/** Revalidate a driver continuation's exact cumulative source prefix before it
 * is sent to another provider request. The run receipt supplies the source
 * identity; completed tool-result and dispatch rows supply the original links. */
export async function assertNativePayloadSourceSetCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativePayloadSourceSetCurrentInScope(tx, input, scope);
  }));
}

/** Revalidate one exact captured Task body against its original owner snapshot,
 * current ACL, and erasure state. This checks source currentness only; callers
 * that qualify a model result must still prove receipt membership and dispatch. */
export async function assertNativeTaskSourceOwnerCurrent(db: Db | Transaction, input: {
  companyId: string;
  actor: AuthorizationActor;
  source: Extract<NativePayloadSourceInput, { kind: "task" }>;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    await assertNativeTaskSourceInputCurrentInScope(tx, input.companyId, input.actor, input.source, scope);
  }));
}

async function assertNativePayloadSourceSetCurrentInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}, scope: NativeSourceReadScope): Promise<void> {
  const policy = nativePayloadSourcePolicySchema.safeParse(input.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(input.inputs);
  if (!policy.success || !inputs.success)
    throw forbidden("The Native source prefix is unavailable");
  const memoEligible = inputs.data.every(source => ["task", "project", "project_workspace", "memory", "context",
    "document_revision", "completion_contract", "runtime_instructions", "workspace_metadata", "worker_model_dispatch", "conversation_model_dispatch",
    "tool_result", "foundation_revision"].includes(source.kind));
  if (!await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("The Native source prefix is unavailable");
  if (!memoEligible) return assertNativePayloadSourceSetCurrentUncachedInScope(db, {
    ...input, policy: policy.data, inputs: inputs.data,
  }, scope);
  const completeKey = `payload-source-set:${nativeSha256({ companyId: input.companyId, issueId: input.issueId,
    runId: input.runId, actor: input.actor, policy: policy.data, inputs: inputs.data })}`;
  if (scope.active.has(completeKey)) throw forbidden("The Native source prefix contains a cycle");
  // Repeated exact components in a cumulative dispatch receipt are common.
  // Reuse only a completed proof in this same transaction. Reader/expiry ACLs
  // are re-read on a hit; the miss path performs them in its original traversal.
  if (scope.complete.has(completeKey)) {
    nativeSourceMemoCount("hits", input.actor);
    const txStats = nativeSourceMemoTransactionStats(scope);
    if (txStats) txStats.hits = Math.min(1_000_000, txStats.hits + 1);
    deferNativeSourceReaderCheck(scope, { companyId: input.companyId, actor: input.actor, runId: input.runId,
      policy: policy.data, inputs: inputs.data });
    return;
  }
  nativeSourceMemoCount("misses", input.actor);
  const txStats = nativeSourceMemoTransactionStats(scope);
  if (txStats) txStats.misses = Math.min(1_000_000, txStats.misses + 1);
  const proofStartedAt = nativeSourceMemoDiagnosticsEnabled() ? performance.now() : 0;
  scope.active.add(completeKey);
  try {
    await assertNativePayloadSourceSetCurrentUncachedInScope(db, {
      ...input, policy: policy.data, inputs: inputs.data,
    }, scope);
    scope.complete.add(completeKey);
    deferNativeSourceReaderCheck(scope, { companyId: input.companyId, runId: input.runId, actor: input.actor,
      policy: policy.data, inputs: inputs.data });
  } finally {
    scope.active.delete(completeKey);
    if (nativeSourceMemoDiagnosticsEnabled()) nativeSourceMemoRecordProofTime(proofStartedAt, scope);
  }
}

/** Validate a newly returned Native read result against its original owners
 * before the result is appended to the Run receipt. This deliberately skips
 * only receipt membership for the outer source set; it still requires the
 * current Run/receipt binding and runs the same current ACL, retention,
 * version, body-hash, and nested-owner checks as an already-recorded set.
 * Read results cannot bootstrap another tool result or model dispatch. */
export async function assertNativeReadResultSourceSetOwnersCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  tool: "get_task_context" | "get_task_history" | "read_chat_attachment";
  sourceSet: NativePayloadSourceSet;
}): Promise<void> {
  const policy = nativePayloadSourcePolicySchema.safeParse(input.sourceSet?.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(input.sourceSet?.inputs);
  const ownerKinds = new Set<NativePayloadSourceInput["kind"]>([
    "task", "project", "project_workspace", "memory", "foundation_revision", "comment", "interaction",
    "document_revision", "attachment", "context", "skill_version", "runtime_skill", "playbook_revision",
    "role_pack_version", "authored_definition", "runtime_instructions", "completion_contract",
    "native_task_wake", "workspace_metadata",
  ]);
  const taskComments = inputs.success ? inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "comment" }> =>
    source.kind === "comment") : [];
  const taskSources = inputs.success ? inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
    source.kind === "task") : [];
  const contextSourceInputs = inputs.success ? inputs.data.filter(source => source.kind === "document_revision" || source.kind === "interaction") : [];
  const deliveredAttachments = inputs.success ? inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "attachment" }> =>
    source.kind === "attachment" && source.disposition === "delivered") : [];
  const exactEmptyHistory = policy.success && inputs.success && inputs.data.length === 0 &&
    isDeepStrictEqual(policy.data, { issueIds: [input.issueId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] });
  const pureTaskContext = policy.success && inputs.success && taskSources.length > 0 &&
    taskSources.length + contextSourceInputs.length === inputs.data.length && policy.data.projectIds.length === 0 && policy.data.runIds.length === 0 &&
    policy.data.memoryIds.length === 0 && policy.data.foundationRevisionIds.length === 0 &&
    policy.data.issueIds.includes(input.issueId) &&
    isDeepStrictEqual([...new Set(taskSources.map(source => source.issueId))].sort(), [...policy.data.issueIds].sort()) &&
    contextSourceInputs.every(source => source.kind === "interaction"
      ? taskSources.some(task => task.issueId === source.issueId)
      : source.issueId !== null && taskSources.some(task => task.issueId === source.issueId));
  if (!policy.success || !inputs.success || !policy.data.issueIds.includes(input.issueId) ||
    inputs.data.some(source => !ownerKinds.has(source.kind)) ||
    (input.tool === "get_task_context" && !pureTaskContext) ||
    (input.tool === "get_task_history" && !exactEmptyHistory &&
      (taskComments.length === 0 || taskComments.some(source => source.issueId !== input.issueId))) ||
    (input.tool === "read_chat_attachment" && deliveredAttachments.every(source => source.issueId !== input.issueId)))
    throw forbidden("The Native read result source set is unavailable");
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    if (!await nativeSourceReaderHasCompanyAccess(tx, input.companyId, input.actor))
      throw forbidden("The Native read result source set is unavailable");
    return assertNativePayloadSourceSetCurrentUncachedInScope(tx, {
      companyId: input.companyId, issueId: input.issueId, runId: input.runId, actor: input.actor,
      policy: policy.data, inputs: inputs.data,
    }, scope, false);
  }));
}

async function assertNativePayloadSourceSetCurrentUncachedInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}, scope: NativeSourceReadScope, requireReceiptMembership = true): Promise<void> {
  const policy = nativePayloadSourcePolicySchema.safeParse(input.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(input.inputs);
  if (!policy.success || !inputs.success)
    throw forbidden("The Native source prefix is unavailable");
  const run = await nativeSourceReadRun(db, input.companyId, input.runId, scope);
  if (run?.nativeIssueId !== input.issueId || run.runtimeMode !== "native")
    throw forbidden("The Native source prefix owner is unavailable");
  const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  const receipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  if (!run || !receipt?.success || receipt.data.binding.companyId !== input.companyId || receipt.data.binding.runId !== input.runId ||
    receipt.data.binding.agentId !== run.agentId || receipt.data.binding.issueId !== input.issueId ||
    receipt.data.binding.responsibleUserId !== (run.responsibleUserId ?? null))
    throw forbidden("The Native source prefix owner is unavailable");

  const matchingDispatches = receipt.data.dispatches.flatMap(prefix => prefix.inputs.flatMap(source => {
    if ((source.kind !== "worker_model_dispatch" && source.kind !== "conversation_model_dispatch") || !isDeepStrictEqual(prefix.policy, policy.data)) return [];
    const preceding = prefix.inputs.filter(value => !(value.kind === source.kind && isDeepStrictEqual(value, source)));
    return isDeepStrictEqual(preceding, inputs.data) ? [{ prefix, dispatch: source }] : [];
  }));
  // NativeSession's acknowledged runner turn is a source prefix of its own,
  // before a managed provider request has produced a worker_model_dispatch.
  // Accept only the exact immutable receipt entry (same cumulative policy and
  // ordered inputs); this does not qualify any provider output by itself.
  const matchingMarkerlessDispatches = receipt.data.dispatches.filter(prefix =>
    isDeepStrictEqual(prefix.policy, policy.data) &&
    !prefix.inputs.some(source => source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch") &&
    isDeepStrictEqual(prefix.inputs, inputs.data));
  const bootstrapMatches = isDeepStrictEqual(receipt.data.bootstrap.policy, policy.data) &&
    isDeepStrictEqual(receipt.data.bootstrap.inputs, inputs.data);
  const matchingAdditionalInputs = receipt.data.additionalInputs.filter(entry =>
    entry.responsibleUserId === run.responsibleUserId &&
    isDeepStrictEqual(entry.policy, policy.data) && isDeepStrictEqual(entry.inputs, inputs.data));
  if (requireReceiptMembership && !matchingDispatches.length && !matchingMarkerlessDispatches.length && !bootstrapMatches && matchingAdditionalInputs.length !== 1)
    throw forbidden("The Native source prefix is not in its original receipt");

  const captures = Array.isArray(profile?.nativeToolResultSourceCaptures)
    ? profile.nativeToolResultSourceCaptures.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[] : [];
  const associations = Array.isArray(profile?.nativeToolCallDispatchAssociations)
    ? profile.nativeToolCallDispatchAssociations.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[] : [];
  const intents = Array.isArray(profile?.nativeAwModelWireIntents)
    ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[] : [];
  let checked = false;
  for (const { dispatch } of matchingDispatches) {
    nativeSourceReadWork(scope);
    const intent = intents.filter(value => value.reservationId === dispatch.reservationId);
    if (intent.length !== 1) throw forbidden("A Native source prefix dispatch receipt is unavailable");
    const uses = Array.isArray(intent[0]!.responseToolUses)
      ? intent[0]!.responseToolUses.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[] : [];
    for (const capture of captures) {
      const source = capture.source as Record<string, unknown> | undefined;
      if (typeof capture.callId !== "string" || typeof capture.tool !== "string" || !source ||
        typeof source.toolName !== "string" || source.kind !== "tool_result" || source.callId !== capture.callId ||
        nativeProviderToolName(source.toolName) !== nativeProviderToolName(capture.tool) ||
        source.contentHash !== capture.resultDigest ||
        !inputs.data.some(value => value.kind === "tool_result" && isDeepStrictEqual(value, source))) continue;
      const captureCallId = capture.callId;
      const captureTool = capture.tool;
      const association = associations.filter(value => value.callId === captureCallId && value.tool === captureTool);
      const use = uses.filter(value => value.id === captureCallId && typeof value.name === "string" &&
        nativeProviderToolName(value.name as string) === nativeProviderToolName(captureTool) &&
        association.some(row => row.argumentsHash === value.argumentsHash));
      if (association.length !== 1 || use.length !== 1) continue;
      const outputCapture: NativeModelOutputCapture = { runId: input.runId,
        sourceSet: { policy: policy.data, inputs: inputs.data }, dispatch,
        managedOpenCodeToolUse: { callId: captureCallId, toolName: nativeProviderToolName(captureTool),
          argumentsHash: use[0]!.argumentsHash as string, responseContentHash: intent[0]!.responseContentHash as string } };
      const consumed = nativeManagedConsumedSourceParts(intent[0]!, { policy: policy.data, inputs: inputs.data });
      if (!consumed) throw forbidden("A Native source prefix consumed source set is unavailable");
      outputCapture.sourceSet = consumed.sourceSet;
      outputCapture.consumedSourceComponents = consumed.components;
      await assertNativeModelOutputCaptureCurrentInScope(db, input.companyId, input.issueId, outputCapture,
        capture.tool, scope, 0, input.actor);
      checked = true;
    }
  }
  if (checked) return;

  // Before the first tool result exists, validate bootstrap owners directly.
  // Families whose complete original reader needs a settled result chain stay denied.
  const taskInputIds = inputs.data.flatMap(source => source.kind === "task" ? [source.issueId] : []);
  const taskRootIds = [...new Set([...policy.data.issueIds, ...taskInputIds])].sort();
  for (const issueId of taskRootIds) {
    const sources = inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
      source.kind === "task" && source.issueId === issueId);
    if (sources.length) {
      for (const source of sources) await assertNativeTaskSourceInputCurrentInScope(db, input.companyId, input.actor, source, scope);
    } else await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, issueId, scope);
  }
  const projectSourceIds = [...new Set([...policy.data.projectIds, ...inputs.data.flatMap(source =>
    source.kind === "project" || source.kind === "project_workspace" ? [source.projectId] : [])])];
  for (const projectId of projectSourceIds) {
    const projectInputs = inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project" }> =>
      source.kind === "project" && source.projectId === projectId);
    const workspaceInputs = inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project_workspace" }> =>
      source.kind === "project_workspace" && source.projectId === projectId);
    await assertNativeProjectSourceCurrentInScope(db, { companyId: input.companyId,
      actor: input.actor, projectId, ...(projectInputs.length ? { sources: projectInputs } : {}),
      ...(workspaceInputs.length ? { workspaceSources: workspaceInputs } : {}) }, scope);
  }
  for (const runId of policy.data.runIds) {
    nativeSourceReadWork(scope);
    const [sourceRun] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, runId))).for("share");
    if (!sourceRun) throw forbidden("A Native source Run is unavailable");
    if (!await canActorReadHeartbeatRunPrivacy(db, input.actor, { id: runId, companyId: input.companyId }))
      throw forbidden("A Native source Run is unavailable");
  }
  const exactMemoryInputIds = new Set(inputs.data.flatMap(source => source.kind === "memory" ? [source.memoryId] : []));
  for (const memoryId of policy.data.memoryIds) {
    nativeSourceReadWork(scope);
    // An exact Memory input below performs the same current ACL read while
    // also validating its version and body. Keep the policy-only check for
    // IDs that have no exact owner input.
    if (exactMemoryInputIds.has(memoryId)) continue;
    if (!await canActorReadMemorySources(db, input.companyId, input.actor, memoryId)) throw forbidden("A Native source Memory is unavailable");
  }
  const contexts = inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "context" }> => source.kind === "context");
  await assertNativeTemporalContextInputsCurrent(db as Db, input.companyId, contexts);
  await assertNativeContextInputOwnersCurrent(db as Db, input.companyId, input.actor, contexts, scope,
    new Set(policy.data.memoryIds.filter(memoryId => !exactMemoryInputIds.has(memoryId))));
  for (const source of inputs.data) {
    nativeSourceReadWork(scope);
    if (source.kind === "task" || source.kind === "project" || source.kind === "project_workspace" || source.kind === "context") continue;
    if (source.kind === "completion_contract") {
      const [contract] = await db.select().from(completionContracts).where(and(eq(completionContracts.companyId, input.companyId),
        eq(completionContracts.id, source.contractId), eq(completionContracts.issueId, source.issueId))).for("share");
      if (!contract || contract.revision.toString() !== source.revision || contract.canonicalSha256 !== source.contentHash)
        throw forbidden("The Native source completion contract changed");
      continue;
    }
    if (source.kind === "document_revision" && source.issueId) {
      await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId: input.companyId, issueId: source.issueId,
        revisionId: source.revisionId, actor: input.actor, requireLatest: false }, scope, 0);
      continue;
    }
    if (source.kind === "memory") {
      if (!input.policy.memoryIds.includes(source.memoryId)) throw forbidden("A Native source Memory is unavailable");
      const evidence = receipt.success ? nativeMemoryReviewEvidence(receipt.data, source) : undefined;
      await assertNativeMemorySourceCurrent(db, input.companyId, input.actor, source, evidence);
      continue;
    }
    if (source.kind === "workspace_metadata") {
      const [workspaceRun] = source.runId === input.runId ? [run] : [];
      const profile = workspaceRun?.runnerProfileJson && typeof workspaceRun.runnerProfileJson === "object" && !Array.isArray(workspaceRun.runnerProfileJson)
        ? workspaceRun.runnerProfileJson as Record<string, unknown> : null;
      const execution = profile?.nativeExecutionInput && typeof profile.nativeExecutionInput === "object" && !Array.isArray(profile.nativeExecutionInput)
        ? profile.nativeExecutionInput as Record<string, unknown> : null;
      const binding = execution?.binding as Record<string, unknown> | undefined;
      const workspace = execution?.workspace as Record<string, unknown> | undefined;
      const tuple = workspace && { cwd: workspace.cwd, repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName };
      if (!tuple || binding?.executionWorkspaceId !== source.executionWorkspaceId ||
        createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native source workspace tuple changed");
      if (source.origin === "agent_home") {
        const [competing] = await db.select({ id: executionWorkspaces.id }).from(executionWorkspaces).where(and(
          eq(executionWorkspaces.companyId, input.companyId), eq(executionWorkspaces.id, source.executionWorkspaceId)));
        if (competing || source.executionWorkspaceId !== input.runId || source.sourceVersion !== `agent-home:${run.agentId}:v1` ||
          !isDeepStrictEqual(tuple, { cwd: resolveDefaultAgentWorkspaceDir(run.agentId), repoUrl: null, repoRef: null, branchName: null }))
          throw forbidden("A Native source agent workspace changed");
      } else if (source.origin === "task_session") {
        if (source.executionWorkspaceId !== input.runId || source.sourceVersion !== `task-session:${input.runId}`)
          throw forbidden("A Native source task-session workspace changed");
      } else if (source.origin === "execution_workspace") {
        const [current] = await db.select({ cwd: executionWorkspaces.cwd, repoUrl: executionWorkspaces.repoUrl,
          repoRef: executionWorkspaces.baseRef, branchName: executionWorkspaces.branchName, updatedAt: executionWorkspaces.updatedAt })
          .from(executionWorkspaces).where(and(eq(executionWorkspaces.companyId, input.companyId),
            eq(executionWorkspaces.id, source.executionWorkspaceId))).for("share");
        if (!current || current.updatedAt.toISOString() !== source.sourceVersion ||
          !isDeepStrictEqual({ cwd: current.cwd, repoUrl: current.repoUrl, repoRef: current.repoRef, branchName: current.branchName }, tuple))
          throw forbidden("A Native source execution workspace changed");
      } else throw forbidden("A Native source workspace origin is unsupported");
      continue;
    }
    if (source.kind === "runtime_instructions") {
      await assertNativeRuntimeInstructionsCurrent(db, input.companyId, input.runId, source);
      continue;
    }
    if (source.kind === "runtime_skill") {
      const execution = profileRunExecution(run);
      if (!execution) throw forbidden("A Native runtime source is unavailable");
      const runtime = execution.runtimeContext && typeof execution.runtimeContext === "object" && !Array.isArray(execution.runtimeContext)
        ? execution.runtimeContext as Record<string, unknown> : null;
      const bundle = (Array.isArray(runtime?.skills) ? runtime!.skills as Record<string, unknown>[] : []).find(value =>
        value.key === source.key && value.versionId === source.versionId)?.bundle as Parameters<typeof readNativeRuntimeAssetText>[0] | undefined;
      if (!bundle || bundle.digest !== source.bundleDigest ||
        bundle.manifestDigest !== source.manifestDigest)
        throw forbidden("A Native runtime asset source changed");
      await readNativeRuntimeAssetText(bundle, 256000, { companyId: input.companyId, runId: input.runId }).catch(() => {
        throw forbidden("A Native runtime asset source was erased");
      });
      continue;
    }
    if (source.kind === "foundation_revision") {
      const [foundation] = await db.select({ document: foundationDocuments, revision: documentRevisions })
        .from(foundationDocuments).innerJoin(documentRevisions, and(eq(documentRevisions.companyId, foundationDocuments.companyId),
          eq(documentRevisions.documentId, foundationDocuments.documentId), eq(documentRevisions.id, foundationDocuments.approvedRevisionId)))
        .where(and(eq(foundationDocuments.companyId, input.companyId), eq(foundationDocuments.id, source.foundationDocumentId),
          eq(foundationDocuments.documentId, source.documentId), eq(foundationDocuments.approvedRevisionId, source.revisionId),
          eq(foundationDocuments.status, "approved"))).for("share", { of: [foundationDocuments, documentRevisions] });
      if (!foundation || createHash("sha256").update(foundation.revision.body, "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native source Foundation revision changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", source.revisionId, input.actor);
      continue;
    }
    if (source.kind === "native_task_wake") {
      const task = inputs.data.find((value): value is Extract<NativePayloadSourceInput, { kind: "task" }> =>
        value.kind === "task" && value.issueId === source.issueId);
      if (source.runId !== input.runId || source.issueId !== input.issueId || !task ||
        task.sourceVersion !== source.sourceVersion || !isDeepStrictEqual(receipt.data.bootstrap.inputs.find(value =>
          value.kind === "native_task_wake" && value.runId === source.runId), source))
        throw forbidden("A Native task wake source changed");
      continue;
    }
    if (source.kind === "worker_model_dispatch") {
      const intents = Array.isArray(profile?.nativeAwModelWireIntents)
        ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).reservationId === source.reservationId) as Record<string, unknown>[] : [];
      const intent = intents[0];
      const exactSourceDispatchPrefix = intent && typeof intent.sourceDispatchDigest === "string"
        ? receipt.data.dispatches.some(prefix => prefix.executionInputDigest === intent.sourceDispatchDigest &&
            prefix.inputs.some(value => value.kind === "worker_model_dispatch" && isDeepStrictEqual(value, source)))
        : false;
      const conflictingCopies = receipt.data.dispatches.some(prefix => prefix.inputs.some(value =>
        value.kind === "worker_model_dispatch" && value.reservationId === source.reservationId &&
        !isDeepStrictEqual(value, source)));
      const reservation = await nativeSourceReadReservation(db, input.companyId, source.reservationId, scope);
      if (source.runId !== input.runId || intents.length !== 1 || !exactSourceDispatchPrefix || conflictingCopies || !reservation ||
        reservation.purpose !== "worker_model" || reservation.status !== "completed" ||
        reservation.inputHash !== source.requestHash || reservation.providerResponseHash !== source.responseHash ||
        intent!.requestHash !== source.requestHash || intent!.wireBodyHash !== source.wireBodyHash ||
        typeof intent!.responseContentHash !== "string" || !/^[0-9a-f]{64}$/.test(intent!.responseContentHash) ||
        intent!.sourcePolicyHash !== nativeSha256(receipt.data.bootstrap) ||
        intent!.endpoint !== "https://api.anthropic.com/v1/messages" || intent!.method !== "POST")
        throw forbidden("A Native historical model dispatch changed");
      continue;
    }
      if (source.kind === "conversation_model_dispatch") {
        const intents = Array.isArray(profile?.nativeAwModelWireIntents)
          ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
              (value as Record<string, unknown>).reservationId === source.reservationId &&
              (value as Record<string, unknown>).modelPurpose === "conversation_model") as Record<string, unknown>[] : [];
        const intent = intents[0];
        const exactSourceDispatchPrefix = intent && typeof intent.sourceDispatchDigest === "string"
          ? receipt.data.dispatches.some(prefix => prefix.executionInputDigest === intent.sourceDispatchDigest &&
              prefix.inputs.some(value => value.kind === "conversation_model_dispatch" && isDeepStrictEqual(value, source)))
          : false;
        const conflictingCopies = receipt.data.dispatches.some(prefix => prefix.inputs.some(value =>
          value.kind === "conversation_model_dispatch" && value.reservationId === source.reservationId &&
          !isDeepStrictEqual(value, source)));
        const reservation = await nativeSourceReadReservation(db, input.companyId, source.reservationId, scope);
        const [manifest] = await db.select().from(agentExecutionManifests).where(and(
          eq(agentExecutionManifests.companyId, input.companyId), eq(agentExecutionManifests.id, source.executionManifestId),
          eq(agentExecutionManifests.agentId, source.agentId), eq(agentExecutionManifests.runId, source.runId))).for("share");
        const [conversationIssue] = await db.select().from(issues).where(and(
          eq(issues.companyId, input.companyId), eq(issues.id, source.issueId))).for("share");
        const binding = nativeSourceRecord(intent?.conversationModelBinding);
        if (source.runId !== input.runId || source.agentId !== run.agentId ||
          source.issueId !== input.issueId || run.responsibleUserId !== receipt.data.binding.responsibleUserId ||
          !manifest || manifest.hash !== source.executionManifestHash || manifest.manifest.responsibleUserId !== run.responsibleUserId ||
          !conversationIssue || conversationIssue.conversationAgentId !== source.agentId ||
          conversationIssue.conversationUserId !== run.responsibleUserId ||
          conversationIssue.conversationSessionGeneration !== source.conversationSessionGeneration ||
          conversationIssue.conversationState !== "active" || conversationIssue.conversationRetiredAt !== null ||
          conversationIssue.executionRunId !== source.runId || conversationIssue.status !== "in_review" ||
          intents.length !== 1 || !exactSourceDispatchPrefix ||
          conflictingCopies || !reservation || reservation.purpose !== "conversation_model" || reservation.status !== "completed" ||
          reservation.inputHash !== source.requestHash || reservation.providerResponseHash !== source.responseHash ||
          reservation.conversationAgentId !== source.agentId || reservation.conversationRunId !== source.runId ||
          reservation.conversationIssueId !== source.issueId ||
          reservation.conversationSessionGeneration !== source.conversationSessionGeneration ||
          reservation.executionManifestId !== source.executionManifestId || reservation.executionManifestHash !== source.executionManifestHash ||
          intent!.agentId !== source.agentId || intent!.callId !== source.callId || intent!.requestHash !== source.requestHash ||
          intent!.wireBodyHash !== source.wireBodyHash || binding.issueId !== source.issueId ||
          binding.conversationSessionGeneration !== source.conversationSessionGeneration ||
          binding.executionManifestId !== source.executionManifestId || binding.executionManifestHash !== source.executionManifestHash ||
          typeof intent!.responseContentHash !== "string" || !/^[0-9a-f]{64}$/.test(intent!.responseContentHash as string) ||
          intent!.sourcePolicyHash !== nativeSha256(receipt.data.bootstrap) ||
          intent!.endpoint !== "https://api.anthropic.com/v1/messages" || intent!.method !== "POST")
          throw forbidden("A Native historical conversation model dispatch changed");
        continue;
      }
    if (source.kind === "tool_result") {
      const projectApiResult = source.toolName === "call_api" && source.invocationId === null;
      const managedProjectCreateResult = source.toolName === "create_project" && source.invocationId === null;
      const nativeReadResultTool = ["get_task_context", "get_task_history", "read_chat_attachment"].includes(source.toolName);
      if ((source.invocationId === null && !projectApiResult && !managedProjectCreateResult && !nativeReadResultTool) ||
        (source.toolName === "call_api" && source.invocationId !== null) ||
        (source.toolName === "create_project" && source.invocationId !== null))
        throw forbidden("A Native tool result requires its original succeeded invocation");
      const captures = Array.isArray(profile?.nativeToolResultSourceCaptures)
        ? profile.nativeToolResultSourceCaptures.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).callId === source.callId &&
            typeof (value as Record<string, unknown>).tool === "string" &&
            nativeProviderToolName((value as Record<string, unknown>).tool as string) === source.toolName &&
            (value as Record<string, unknown>).resultDigest === source.contentHash &&
            isDeepStrictEqual((value as Record<string, unknown>).source, source)) as Record<string, unknown>[] : [];
      const [invocation] = source.invocationId ? await db.select().from(toolInvocations).where(and(
        eq(toolInvocations.companyId, input.companyId), eq(toolInvocations.id, source.invocationId),
        eq(toolInvocations.runId, input.runId), eq(toolInvocations.status, "succeeded"),
        eq(toolInvocations.resultHash, source.contentHash))).for("share") : [];
      const matchingReceiptInputs = nativeToolResultReceiptCopies(receipt.data, source);
      if (source.runId !== input.runId || matchingReceiptInputs.exact < 1 || matchingReceiptInputs.conflicting ||
        matchingReceiptInputs.duplicateWithinEntry || captures.length !== 1 ||
        (projectApiResult || managedProjectCreateResult || nativeReadResultTool ? invocation !== undefined : !invocation || invocation.issueId !== input.issueId ||
          invocation.toolName !== source.toolName || invocation.idempotencyKey !== `aw-native-tool:${input.runId}:${source.callId}`))
        throw forbidden("A Native historical tool result changed");
      const associations = Array.isArray(profile?.nativeToolCallDispatchAssociations)
        ? profile.nativeToolCallDispatchAssociations.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).callId === source.callId && typeof (value as Record<string, unknown>).tool === "string" &&
            nativeProviderToolName((value as Record<string, unknown>).tool as string) === source.toolName)
        : [];
      const providerUses = Array.isArray(profile?.nativeAwModelWireIntents) ? profile.nativeAwModelWireIntents.flatMap(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const uses = Array.isArray((value as Record<string, unknown>).responseToolUses)
          ? (value as Record<string, unknown>).responseToolUses as unknown[] : [];
        return uses.filter(use => use && typeof use === "object" && !Array.isArray(use) &&
          (use as Record<string, unknown>).id === source.callId && typeof (use as Record<string, unknown>).name === "string" &&
          nativeProviderToolName((use as Record<string, unknown>).name as string) === source.toolName);
      }) : [];
      const nativeReadReturn = nativeReadResultTool && source.invocationId === null && captures.length === 1 &&
        captures[0]!.nativeReadResult === true && captures[0]!.managedOpenCode !== true;
      if (associations.length !== 1 || providerUses.length > 1 ||
        (providerUses.length === 0 && !nativeReadReturn) ||
        (providerUses.length === 1 && !associations.some(value =>
          (value as Record<string, unknown>).argumentsHash === (providerUses[0] as Record<string, unknown>).argumentsHash)))
        throw forbidden("A Native historical tool result dispatch changed");
      if (projectApiResult) {
        if (!profile) throw forbidden("A Native Project API profile is unavailable");
        await assertNativeProjectApiToolResultCurrentInScope(db, {
          companyId: input.companyId, run, profile, receipt: receipt.data, source, actor: input.actor, scope,
        });
      }
      const capture = captures[0]!;
      const captureToolName = typeof capture.tool === "string" ? capture.tool : "";
      if (managedProjectCreateResult) {
        const createCapture = nativeSourceRecord(capture.projectCreate);
        const projectReceipt = nativeSourceRecord(createCapture.receipt);
        const outputCapture = nativeSourceRecord(createCapture.outputCapture);
        const sourceSetValue = nativeSourceRecord(createCapture.sourceSet);
        const sourcePolicy = nativePayloadSourcePolicySchema.safeParse(sourceSetValue.policy);
        const sourceInputs = nativePayloadSourceInputSchema.array().safeParse(sourceSetValue.inputs);
        const projectSource = nativePayloadSourceInputSchema.safeParse(projectReceipt.projectSource);
        const workspaceSources = nativePayloadSourceInputSchema.array().safeParse(createCapture.workspaceSources);
        const turnId = typeof capture.turnId === "string" ? capture.turnId : "";
        const argumentsHash = typeof capture.argumentsHash === "string" ? capture.argumentsHash : "";
        const eventSeq = capture.eventSeq;
        const attempt = capture.attempt;
        const createdProjectPolicy = sourcePolicy.success && projectSource.success && projectSource.data.kind === "project"
          ? { ...sourcePolicy.data,
              projectIds: [...new Set([...sourcePolicy.data.projectIds, projectSource.data.projectId])].sort() }
          : null;
        const exactCreateEntries = receipt.data.additionalInputs.filter(entry =>
          entry.responsibleUserId === run.responsibleUserId && createdProjectPolicy && sourceInputs.success &&
          projectSource.success && projectSource.data.kind === "project" && workspaceSources.success &&
          workspaceSources.data.every(value => value.kind === "project_workspace") &&
          isDeepStrictEqual(entry.policy, createdProjectPolicy) &&
          isDeepStrictEqual(entry.inputs, [source, ...sourceInputs.data, projectSource.data, ...workspaceSources.data]));
        const createSourceCopies = receipt.data.additionalInputs.reduce((count, entry) => count + entry.inputs.filter(value =>
          value.kind === "tool_result" && value.callId === source.callId && value.toolName === "create_project").length, 0);
        const turnAssociations = associations.filter(value => {
          const row = value as Record<string, unknown>;
          return row.turnId === turnId && row.argumentsHash === argumentsHash && row.eventSeq === eventSeq && row.attempt === attempt;
        });
        const turns = Array.isArray(profile?.nativeModelInputDispatchIntents)
          ? profile.nativeModelInputDispatchIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).turnId === turnId &&
            (value as Record<string, unknown>).eventSeq === eventSeq &&
            (value as Record<string, unknown>).attempt === attempt) as Record<string, unknown>[] : [];
        const managedUse = nativeSourceRecord(outputCapture.managedOpenCodeToolUse);
        const outputDispatch = nativeSourceRecord(outputCapture.dispatch);
        const exactWireIntents = Array.isArray(profile?.nativeAwModelWireIntents)
          ? profile.nativeAwModelWireIntents.filter(value => {
              if (!value || typeof value !== "object" || Array.isArray(value)) return false;
              const intent = value as Record<string, unknown>;
              const uses = Array.isArray(intent.responseToolUses)
                ? intent.responseToolUses.filter(use => use && typeof use === "object" && !Array.isArray(use) &&
                    (use as Record<string, unknown>).id === source.callId &&
                    typeof (use as Record<string, unknown>).name === "string" &&
                    nativeProviderToolName((use as Record<string, unknown>).name as string) === "create_project" &&
                    (use as Record<string, unknown>).argumentsHash === argumentsHash)
                : [];
              return intent.turnId === turnId && intent.reservationId === outputDispatch.reservationId && uses.length === 1;
            }) as Record<string, unknown>[] : [];
        const exactAssociation = turnAssociations.length === 1 && turns.length === 1 &&
          (turnAssociations[0] as Record<string, unknown>).dispatchId === turns[0]!.dispatchId &&
          (turnAssociations[0] as Record<string, unknown>).eventSeq === turns[0]!.eventSeq &&
          (turnAssociations[0] as Record<string, unknown>).attempt === turns[0]!.attempt;
        if (capture.managedOpenCode !== true || capture.nativeReadResult === true || source.invocationId !== null ||
          !turnId || !/^[0-9a-f]{64}$/.test(argumentsHash) || !Number.isSafeInteger(eventSeq) ||
          !Number.isSafeInteger(attempt) || nativeProviderToolName(captureToolName) !== "create_project" ||
          capture.resultDigest !== source.contentHash || projectReceipt.callId !== source.callId ||
          projectReceipt.tool !== "create_project" || projectReceipt.argumentsHash !== argumentsHash ||
          projectReceipt.resultDigest !== source.contentHash || projectReceipt.responsibleUserId !== run.responsibleUserId ||
          sourceSetValue && !sourcePolicy.success || sourceSetValue && !sourceInputs.success ||
          !projectSource.success || projectSource.data.kind !== "project" ||
          typeof projectReceipt.projectId !== "string" ||
          !workspaceSources.success || workspaceSources.data.some(value => value.kind !== "project_workspace") ||
          managedUse.callId !== source.callId || managedUse.toolName !== "create_project" ||
          managedUse.argumentsHash !== argumentsHash || outputCapture.runId !== input.runId ||
          outputDispatch.kind !== "worker_model_dispatch" || outputDispatch.runId !== input.runId ||
          outputDispatch.reservationId !== exactWireIntents[0]?.reservationId || exactWireIntents.length !== 1 ||
          !exactAssociation || exactCreateEntries.length !== 1 || createSourceCopies !== 1)
          throw forbidden("A Native managed Project result changed");
        const currentProject = await projectService(db as Db).getById(projectReceipt.projectId as string);
        if (!currentProject) throw forbidden("A Native managed Project owner is unavailable");
        const { assertNativeManagedProjectCreateReceiptCurrentInTransaction, managedNativeProjectResultDto } =
          await import("./native-project-output.js");
        await assertNativeManagedProjectCreateReceiptCurrentInTransaction(db as Transaction, {
          companyId: input.companyId, issueId: input.issueId, runId: input.runId, actor: input.actor,
          receipt: projectReceipt as unknown as Parameters<typeof assertNativeManagedProjectCreateReceiptCurrentInTransaction>[1]["receipt"],
          sourceSet: { policy: sourcePolicy.data, inputs: sourceInputs.data },
          outputCapture: outputCapture as unknown as NativeModelOutputCapture,
          result: managedNativeProjectResultDto(currentProject),
        });
      }
      if (source.invocationId === null && nativeReadResultTool) {
        const capturedSourceSet = capture.sourceSet && typeof capture.sourceSet === "object" && !Array.isArray(capture.sourceSet)
          ? capture.sourceSet as Record<string, unknown> : null;
        const sourcePolicy = nativePayloadSourcePolicySchema.safeParse(capturedSourceSet?.policy);
        const sourceInputs = nativePayloadSourceInputSchema.array().safeParse(capturedSourceSet?.inputs);
        const captureSourceInputs = nativePayloadSourceInputSchema.array().safeParse(capture.sourceInputs);
        const turnId = typeof capture.turnId === "string" ? capture.turnId : "";
        const argumentsHash = typeof capture.argumentsHash === "string" ? capture.argumentsHash : "";
        const exactReadEntries = receipt.data.additionalInputs.filter(entry =>
          entry.responsibleUserId === run.responsibleUserId && sourcePolicy.success && sourceInputs.success &&
          isDeepStrictEqual(entry.policy, sourcePolicy.data) &&
          isDeepStrictEqual(entry.inputs, [source, ...sourceInputs.data]));
        const turnAssociations = associations.filter(value => {
          const row = value as Record<string, unknown>;
          return row.turnId === turnId && row.argumentsHash === argumentsHash;
        });
        const turns = Array.isArray(profile?.nativeModelInputDispatchIntents)
          ? profile.nativeModelInputDispatchIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).turnId === turnId) as Record<string, unknown>[] : [];
        const useArgumentsHash = providerUses.length === 1
          ? (providerUses[0] as Record<string, unknown>).argumentsHash : null;
        if (capture.nativeReadResult !== true || !turnId || !/^[0-9a-f]{64}$/.test(argumentsHash) ||
          !sourcePolicy.success || !sourceInputs.success || !captureSourceInputs.success ||
          nativeProviderToolName(captureToolName) !== source.toolName ||
          !isDeepStrictEqual(captureSourceInputs.data, sourceInputs.data) ||
          exactReadEntries.length !== 1 || turns.length !== 1 || turnAssociations.length !== 1 ||
          useArgumentsHash !== null && useArgumentsHash !== argumentsHash ||
          (turnAssociations[0] as Record<string, unknown>).dispatchId !== turns[0]!.dispatchId ||
          (turnAssociations[0] as Record<string, unknown>).eventSeq !== turns[0]!.eventSeq ||
          (turnAssociations[0] as Record<string, unknown>).attempt !== turns[0]!.attempt)
          throw forbidden("A Native read tool result changed");
        await assertNativeReadResultSourceSetOwnersCurrent(db, { companyId: input.companyId,
          issueId: input.issueId, runId: input.runId, actor: input.actor,
          tool: source.toolName as "get_task_context" | "get_task_history" | "read_chat_attachment",
          sourceSet: { policy: sourcePolicy.data, inputs: sourceInputs.data } });
      }
      const contextRead = capture.contextRead && typeof capture.contextRead === "object" && !Array.isArray(capture.contextRead)
        ? capture.contextRead as Record<string, unknown> : null;
      if (source.toolName === "read_context") {
        const capturedSourceSet = contextRead?.sourceSet && typeof contextRead.sourceSet === "object" && !Array.isArray(contextRead.sourceSet)
          ? contextRead.sourceSet as Record<string, unknown> : null;
        const manifestIds = contextRead?.manifestIds;
        const capturedContextInputs = Array.isArray(capturedSourceSet?.inputs) ? capturedSourceSet.inputs : [];
        const embeddedContextInputs = capturedContextInputs.filter((value): value is NativePayloadSourceInput =>
          !!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).kind === "context");
        const contextReceiptEntries = receipt.data.additionalInputs.filter(entry =>
          entry.inputs.some(value => value.kind === "tool_result" && isDeepStrictEqual(value, source)));
        const captureTurnId = typeof capture.turnId === "string" ? capture.turnId : "";
        const exactTurnAssociations = associations.filter(value => (value as Record<string, unknown>).turnId === captureTurnId &&
          (value as Record<string, unknown>).argumentsHash === (providerUses[0] as Record<string, unknown>).argumentsHash);
        const acknowledgedTurns = Array.isArray(profile?.nativeModelInputDispatchIntents)
          ? profile.nativeModelInputDispatchIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).turnId === captureTurnId) as Record<string, unknown>[] : [];
        if (capture.managedOpenCode !== true || !contextRead || contextRead.contentDigest !== source.contentHash ||
          !captureTurnId || exactTurnAssociations.length !== 1 || acknowledgedTurns.length !== 1 ||
          (exactTurnAssociations[0] as Record<string, unknown>).dispatchId !== acknowledgedTurns[0]!.dispatchId ||
          (exactTurnAssociations[0] as Record<string, unknown>).eventSeq !== acknowledgedTurns[0]!.eventSeq ||
          (exactTurnAssociations[0] as Record<string, unknown>).attempt !== acknowledgedTurns[0]!.attempt ||
          !Array.isArray(manifestIds) || !capturedSourceSet ||
          !capturedSourceSet.policy || typeof capturedSourceSet.policy !== "object" ||
          nativeProviderToolName(captureToolName) !== "read_context" || source.toolName !== nativeProviderToolName(captureToolName) ||
          embeddedContextInputs.length !== 1 || contextReceiptEntries.length !== 1 ||
          !isDeepStrictEqual(capturedSourceSet.policy, contextReceiptEntries[0]!.policy) ||
          !isDeepStrictEqual(contextReceiptEntries[0]!.inputs, [source, ...capturedContextInputs]))
          throw forbidden("A Native Context tool result changed");
        await assertNativeContextReadSourceSetCurrentInScope(db, { companyId: input.companyId, agentId: run.agentId,
          runId: input.runId, issueId: input.issueId, actor: input.actor,
          sourceSet: capturedSourceSet as unknown as NativeContextReadBinding["sourceSet"],
          manifestIds: manifestIds as NativeContextReadBinding["manifestIds"] }, scope);
      } else if (contextRead) throw forbidden("A Native Context tool result changed");
      const documentRevision = capture.documentRevision && typeof capture.documentRevision === "object" && !Array.isArray(capture.documentRevision)
        ? capture.documentRevision as Record<string, unknown> : null;
      if (documentRevision) {
        if (typeof documentRevision.issueId !== "string" || typeof documentRevision.revisionId !== "string")
          throw forbidden("A Native historical document tool result changed");
        await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId: input.companyId,
          issueId: documentRevision.issueId, revisionId: documentRevision.revisionId, actor: input.actor, requireLatest: false }, scope, 0);
      }
      continue;
    }
    if (source.kind === "authored_definition") {
      const [owner] = await db.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, source.agentId)));
      if (!owner || source.agentId !== run.agentId) throw forbidden("A Native authored Agent source is unavailable");
      await assertAuthoredAgentSnapshotCurrent(db as Db, owner).catch(() => {
        throw forbidden("A Native authored Agent source changed");
      });
      const config = owner.runtimeConfig && typeof owner.runtimeConfig === "object" && !Array.isArray(owner.runtimeConfig)
        ? owner.runtimeConfig as Record<string, unknown> : {};
      const authored = config[AUTHORED_AGENT_DEFINITION_KEY] && typeof config[AUTHORED_AGENT_DEFINITION_KEY] === "object"
        ? config[AUTHORED_AGENT_DEFINITION_KEY] as Record<string, unknown> : null;
      if (!authored || authored.revisionId !== source.revisionId || authored.definitionHash !== source.definitionHash ||
        (authored.procedureSnapshotHash ?? null) !== source.procedureSnapshotHash)
        throw forbidden("A Native authored Agent source changed");
      continue;
    }
    if (source.kind === "skill_version") {
      const selected = await skillResolverService(db as Db).authorizedVersion(input.actor, input.companyId, source.skillId, source.versionId)
        .catch(() => { throw forbidden("A Native Skill source is unavailable"); });
      const body = selected.version.fileInventory.find(file => file.path === "SKILL.md")?.content;
      if (selected.skill.key !== source.skillKey || !body || nativeSha256(body) !== source.contentHash)
        throw forbidden("A Native Skill source changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "skill_version", source.versionId, input.actor);
      continue;
    }
    if (source.kind === "playbook_revision") {
      const [owner] = await db.select({ body: documentRevisions.body }).from(playbookDocuments)
        .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, playbookDocuments.companyId),
          eq(documentRevisions.documentId, playbookDocuments.documentId), eq(documentRevisions.id, playbookDocuments.approvedRevisionId)))
        .where(and(eq(playbookDocuments.companyId, input.companyId), eq(playbookDocuments.id, source.playbookId),
          eq(playbookDocuments.approvedRevisionId, source.revisionId), eq(playbookDocuments.status, "approved")));
      if (!owner || createHash("sha256").update(owner.body, "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native Playbook source changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", source.revisionId, input.actor);
      continue;
    }
    if (source.kind === "role_pack_version") {
      const { rolePackService } = await import("./role-packs.js");
      let current: Extract<NativePayloadSourceInput, { kind: "role_pack_version" }>[] = [];
      await rolePackService(db as Db).resolve(input.actor, input.companyId, run.agentId, undefined, undefined,
        values => { current = values; });
      if (current.filter(value => isDeepStrictEqual(value, source)).length !== 1)
        throw forbidden("A Native Role Pack source changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "role_pack_version", source.versionId, input.actor);
      continue;
    }
    if (source.kind === "comment") {
      await assertConversationCommentSourceCurrent(db, { companyId: input.companyId, actor: input.actor, source,
        policy: input.policy, inputs: input.inputs }, scope);
      continue;
    }
    if (source.kind === "interaction") {
      const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
      const current: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
      await materializeNativeInteractionResponses({ db: db as Db, companyId: input.companyId, issueId: source.issueId,
        runId: input.runId, agentId: run.agentId, interactionIds: [source.interactionId], onSourceCapture: value => { current.push(value); } });
      if (current.length !== 1 || !isDeepStrictEqual(current[0], source))
        throw forbidden("A Native source Interaction changed or was erased");
      continue;
    }
    if (source.kind === "attachment") {
      const [attachment] = await db.select({ attachment: issueAttachments, asset: assets,
        ownerBodyHash: sql<string>`public.aw_native_payload_body_hash('attachment', to_jsonb(${issueAttachments}))`,
        payloadSourceSnapshotDigestValid: sql<boolean>`(${issueAttachments.payloadSourceSnapshot}->>'digest') = encode(sha256(convert_to((${issueAttachments.payloadSourceSnapshot}-'digest')::text,'UTF8')),'hex')` })
        .from(issueAttachments)
        .innerJoin(assets, and(eq(assets.companyId, issueAttachments.companyId), eq(assets.id, issueAttachments.assetId)))
        .where(and(eq(issueAttachments.companyId, input.companyId), eq(issueAttachments.issueId, source.issueId),
          eq(issueAttachments.id, source.attachmentId)));
      const snapshot = nativePayloadSourceSnapshotSchema.safeParse(attachment?.attachment.payloadSourceSnapshot);
      const snapshotRootsRetained = snapshot.success && snapshot.data.inputs.every(root =>
        input.inputs.some(candidate => isDeepStrictEqual(candidate, root))) &&
        (Object.keys(input.policy) as (keyof NativePayloadSourcePolicy)[]).every(key =>
          snapshot.data.policy[key].every(sourceId => input.policy[key].includes(sourceId)));
      if (!attachment || attachment.attachment.payloadSourceSnapshotInvalidated || !snapshot.success || !snapshotRootsRetained ||
        attachment.payloadSourceSnapshotDigestValid !== true || snapshot.data.digest !== attachment.attachment.payloadSourceSnapshot?.digest ||
        snapshot.data.owner.kind !== "attachment" || snapshot.data.owner.companyId !== input.companyId ||
        snapshot.data.owner.id !== source.attachmentId || snapshot.data.owner.contentHash !== attachment.ownerBodyHash ||
        source.disposition !== "delivered" || source.assetId !== attachment.asset.id ||
        source.sha256 !== attachment.asset.sha256 || source.byteSize !== attachment.asset.byteSize ||
        source.commentId !== attachment.attachment.issueCommentId ||
        !await canActorReadIssuePrivacy(db, input.actor, { id: source.issueId, companyId: input.companyId }))
        throw forbidden("A Native source Attachment changed or was erased");
      if (source.commentId) {
        const { issueService } = await import("./issues.js");
        if (!await issueService(db as Db).getComment(source.commentId)) throw forbidden("A Native source Attachment comment was erased");
      }
      continue;
    }
    if (source.kind === "document_revision") {
      if (!source.issueId) throw forbidden("A Native document source is unavailable");
      await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId: input.companyId, issueId: source.issueId,
        revisionId: source.revisionId, actor: input.actor, requireLatest: false }, scope, 0);
      continue;
    }
    throw forbidden("A Native source family needs a completed original result receipt");
  }
}

function profileRunExecution(run: typeof heartbeatRuns.$inferSelect): Record<string, unknown> | null {
  const profile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  return profile?.nativeExecutionInput && typeof profile.nativeExecutionInput === "object" && !Array.isArray(profile.nativeExecutionInput)
    ? profile.nativeExecutionInput as Record<string, unknown> : null;
}

/** Resolve the exact source prefix associated with a server-owned settled
 * provider tool use. The managed provider capture attests the model dispatch
 * and response association; callers cannot manufacture this carrier. */
export async function readNativeIssueEffectPrefix(tx: Transaction, actor: AuthorizationActor,
  claim: NativeToolEffectClaim | null, capture?: NativeModelOutputCapture, expectedToolName?: string): Promise<NativeIssueEffectPrefix> {
  if (!capture || actor.type !== "agent" || typeof actor.companyId !== "string" || typeof actor.agentId !== "string" || actor.runId !== capture.runId ||
    claim && (!actor.nativeToolEffect || !isDeepStrictEqual(actor.nativeToolEffect, claim)))
    throw forbidden("Native provider input boundary is unavailable");
  const [run] = await tx.select({ nativeIssueId: heartbeatRuns.nativeIssueId }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, actor.companyId), eq(heartbeatRuns.id, capture.runId), eq(heartbeatRuns.agentId, actor.agentId!)));
  if (!run?.nativeIssueId || !expectedToolName) throw forbidden("Native provider input boundary is unavailable");
  await assertNativeModelOutputCaptureCurrent(tx, actor.companyId!, run.nativeIssueId, capture, expectedToolName);
  return { policy: capture.sourceSet.policy, inputs: [...capture.sourceSet.inputs, capture.dispatch], runId: capture.runId };
}

/** Admit a Memory write only when its canonical Tool Gateway invocation is the
 * exact server-owned row for the settled Native provider tool-use. */
export async function assertNativeMemoryToolInvocationCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; actor: AuthorizationActor; capture: NativeModelOutputCapture;
  invocationId: string; status: "executing" | "succeeded"; resultHash?: string | null; currentReader?: AuthorizationActor;
}): Promise<void> {
  const reader = input.currentReader ?? input.actor;
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, reader, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativeMemoryToolInvocationCurrentInScope(tx, input);
  }));
}

async function assertNativeMemoryToolInvocationCurrentInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; actor: AuthorizationActor; capture: NativeModelOutputCapture;
  invocationId: string; status: "executing" | "succeeded"; resultHash?: string | null; currentReader?: AuthorizationActor;
}): Promise<void> {
  const use = input.capture.managedOpenCodeToolUse;
  if (input.actor.type !== "agent" || input.actor.companyId !== input.companyId ||
    input.actor.agentId == null || input.actor.runId !== input.capture.runId ||
    use?.toolName !== "paperclip-self:remember") throw forbidden("Native Memory output binding is unavailable");
  await assertNativeModelOutputCaptureCurrent(db, input.companyId, input.issueId, input.capture,
    "paperclip-self:remember", input.currentReader ?? input.actor);
  const [erased] = await db.select({ key: memoryDeletionMarkers.key }).from(memoryDeletionMarkers).where(and(
    eq(memoryDeletionMarkers.companyId, input.companyId), eq(memoryDeletionMarkers.kind, "source"),
    eq(memoryDeletionMarkers.key, `memory-run-source-erasure:v1:${input.capture.runId}`),
  ));
  if (erased) throw forbidden("Native Memory producer Run was erased");
  const [invocation] = await db.select({ id: toolInvocations.id, companyId: toolInvocations.companyId,
    idempotencyKey: toolInvocations.idempotencyKey,
    agentId: toolInvocations.agentId, runId: toolInvocations.runId, issueId: toolInvocations.issueId,
    toolName: toolInvocations.toolName, argumentsHash: toolInvocations.argumentsHash,
    status: toolInvocations.status, resultHash: toolInvocations.resultHash }).from(toolInvocations)
    .where(and(eq(toolInvocations.companyId, input.companyId), eq(toolInvocations.id, input.invocationId)));
  if (!invocation || invocation.agentId !== input.actor.agentId || invocation.runId !== input.capture.runId ||
    invocation.issueId !== input.issueId || invocation.toolName !== "paperclip-self:remember" ||
    invocation.idempotencyKey !== `aw-native-tool:${input.capture.runId}:${use.callId}` ||
    invocation.argumentsHash !== use.argumentsHash || invocation.status !== input.status ||
    input.status === "succeeded" && invocation.resultHash !== input.resultHash)
    throw forbidden("Native Memory invocation no longer matches its provider tool-use");
}

/** Validate the consumed model prefix and its exact Gateway-created Memory
 * effect binding. The producer dispatch/invocation are provenance, while only
 * retained_run entries in the consumed policy grant whole-Run reads. */
export async function assertNativeMemoryOutputSnapshotCurrent(db: Db | Transaction, input: {
  companyId: string; recordId: string; snapshot: NativePayloadSourceSnapshot; actor: AuthorizationActor;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativeMemoryOutputSnapshotCurrentInScope(tx, input, scope);
  }));
}

async function assertNativeMemoryOutputSnapshotCurrentInScope(db: Db | Transaction, input: {
  companyId: string; recordId: string; snapshot: NativePayloadSourceSnapshot; actor: AuthorizationActor;
}, scope: NativeSourceReadScope): Promise<void> {
  const [ownerBinding] = await db.execute<{ valid: boolean }>(sql`select
    public.aw_native_payload_body_hash('memory_record',to_jsonb(m))=${input.snapshot.owner.contentHash}
      and m.payload_source_snapshot->>'digest'=${input.snapshot.digest}
      and m.payload_source_snapshot_invalidated=false and m.payload_source_protocol_version=1 as valid
    from ${memoryRecords} m where m.company_id=${input.companyId}::uuid and m.id=${input.recordId}::uuid`);
  if (!ownerBinding?.valid) throw forbidden("Native Memory output owner binding is unavailable");
  const dispatches = input.snapshot.inputs.flatMap((source, index) =>
    source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch" ? [{ source, index }] : []);
  if (!dispatches.length) throw forbidden("Native Memory output prefix is unavailable");
  // The writer appends this effect's dispatch after its exact prior prefix.
  const { source: dispatch, index: dispatchIndex } = dispatches[dispatches.length - 1]!;
  if (dispatchIndex !== input.snapshot.inputs.length - 1)
    throw forbidden("Native Memory output prefix is unavailable");
  const [record] = await db.select({ metadata: memoryRecords.metadata }).from(memoryRecords).where(and(
    eq(memoryRecords.companyId, input.companyId), eq(memoryRecords.id, input.recordId)));
  const metadata = record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown> : null;
  const invocationId = typeof metadata?.nativeManagedMemoryInvocationId === "string"
    ? metadata.nativeManagedMemoryInvocationId : null;
  if (!invocationId) throw forbidden("Native Memory output invocation binding is unavailable");
  const run = await nativeSourceReadRun(db, input.companyId, dispatch.runId, scope);
  if (!run?.nativeIssueId || run.runtimeMode !== "native") throw forbidden("Native Memory output owner is unavailable");
  const [invocation] = await db.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, input.companyId),
    eq(toolInvocations.id, invocationId), eq(toolInvocations.runId, dispatch.runId),
    eq(toolInvocations.issueId, run.nativeIssueId), eq(toolInvocations.agentId, run.agentId),
    eq(toolInvocations.toolName, "paperclip-self:remember"), eq(toolInvocations.status, "succeeded")));
  if (!invocation?.resultHash || typeof invocation.idempotencyKey !== "string" ||
    !invocation.idempotencyKey.startsWith(`aw-native-tool:${dispatch.runId}:`))
    throw forbidden("Native Memory output invocation is unavailable");
  const callId = invocation.idempotencyKey.slice(`aw-native-tool:${dispatch.runId}:`.length);
  const profile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  const intentMatches = Array.isArray(profile?.nativeAwModelWireIntents)
    ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).reservationId === dispatch.reservationId &&
      (value as Record<string, unknown>).modelPurpose === (dispatch.kind === "conversation_model_dispatch" ? "conversation_model" : "worker_model")) as Record<string, unknown>[] : [];
  const uses = intentMatches.flatMap(intent => Array.isArray(intent.responseToolUses)
    ? (intent.responseToolUses as unknown[]).filter(value => value && typeof value === "object" && !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).id === "string" && typeof (value as Record<string, unknown>).name === "string" &&
      nativeProviderToolName((value as Record<string, unknown>).name as string) === "paperclip-self:remember" &&
      typeof (value as Record<string, unknown>).argumentsHash === "string") as Record<string, unknown>[] : []);
  const matchingUses = uses.filter(value => value.id === callId);
  const use = matchingUses[0];
  if (intentMatches.length !== 1 || matchingUses.length !== 1 || !use ||
    typeof intentMatches[0]!.responseContentHash !== "string" ||
    !metadata || metadata.nativeManagedMemoryCallId !== callId ||
    metadata.nativeManagedMemoryArgumentsHash !== use.argumentsHash)
    throw forbidden("Native Memory output tool-use is unavailable");
  const inputActor: AuthorizationActor = { type: "agent", source: "none", companyId: input.companyId,
    agentId: run.agentId, runId: run.id, onBehalfOfUserId: run.responsibleUserId };
  const sourceInputs = input.snapshot.inputs.filter((_, index) => index !== dispatchIndex);
  const consumed = nativeManagedConsumedSourceParts(intentMatches[0]!, { policy: input.snapshot.policy, inputs: sourceInputs });
  if (!consumed) throw forbidden("Native Memory output consumed source set is unavailable");
  const capture: NativeModelOutputCapture = { runId: run.id, sourceSet: consumed.sourceSet,
    consumedSourceComponents: consumed.components,
    dispatch, managedOpenCodeToolUse: { callId, toolName: "paperclip-self:remember",
      argumentsHash: use!.argumentsHash as string, responseContentHash: intentMatches[0]!.responseContentHash as string } };
  await assertNativeMemoryToolInvocationCurrent(db, { companyId: input.companyId, issueId: run.nativeIssueId,
    actor: inputActor, capture, invocationId, status: "succeeded", resultHash: invocation.resultHash, currentReader: input.actor });
}

async function assertNativeManagedConsumedSourceSetCurrentInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  components: NativeConsumedSourceComponent[]; sourceSet: NativePayloadSourceSet;
}, scope: NativeSourceReadScope): Promise<void> {
  if (!input || !Array.isArray(input.components) || input.components.length < 1 || input.components.length > 64 ||
    !input.sourceSet || typeof input.sourceSet !== "object" || Array.isArray(input.sourceSet) ||
    !await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("The Native consumed source set is unavailable");
  const actorBinding = { type: input.actor.type, source: input.actor.source, userId: input.actor.userId ?? null,
    agentId: input.actor.agentId ?? null, runId: input.actor.runId ?? null,
    onBehalfOfUserId: input.actor.onBehalfOfUserId ?? null };
  const visitKey = `managed-consumed:${nativeSha256({ companyId: input.companyId, issueId: input.issueId,
    runId: input.runId, actor: actorBinding, components: input.components, sourceSet: input.sourceSet })}`;
  if (scope.active.has(visitKey)) throw forbidden("The Native consumed source graph contains a cycle");
  if (scope.complete.has(visitKey)) return;
  scope.active.add(visitKey);
  try {
    await assertNativeManagedConsumedSourceSetCurrentUncached(db, input, scope);
    scope.complete.add(visitKey);
  } finally {
    scope.active.delete(visitKey);
  }
}

async function assertNativeManagedConsumedSourceSetCurrentUncached(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  components: NativeConsumedSourceComponent[]; sourceSet: NativePayloadSourceSet;
}, scope: NativeSourceReadScope): Promise<void> {
  if (!input || !Array.isArray(input.components) || !input.sourceSet || typeof input.sourceSet !== "object" ||
    Array.isArray(input.sourceSet)) throw forbidden("The Native consumed source set is unavailable");
  const policy = nativePayloadSourcePolicySchema.safeParse(input.sourceSet.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(input.sourceSet.inputs);
  if (!policy.success || !inputs.success || input.components.length < 1 || input.components.length > 64 ||
    !await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("The Native consumed source set is unavailable");
  const run = await nativeSourceReadRun(db, input.companyId, input.runId, scope);
  if (run?.nativeIssueId !== input.issueId || run.runtimeMode !== "native")
    throw forbidden("The Native consumed source receipt is unavailable");
  const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  const receipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  if (!run || !receipt?.success || receipt.data.binding.companyId !== input.companyId ||
    receipt.data.binding.runId !== input.runId || receipt.data.binding.agentId !== run.agentId ||
    receipt.data.binding.issueId !== input.issueId)
    throw forbidden("The Native consumed source receipt is unavailable");

  const wireIntents = Array.isArray(profile?.nativeAwModelWireIntents)
    ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[] : [];
  const componentSets: NativePayloadSourceSet[] = [];
  let inputCount = 0;
  for (const [componentIndex, component] of input.components.entries()) {
    nativeSourceReadWork(scope);
    if (!component || typeof component !== "object" || Array.isArray(component))
      throw forbidden("A Native source component is malformed");
    if (component.kind === "bootstrap") {
      if (Object.keys(component).length !== 1 || input.components.slice(0, componentIndex).some(value => isDeepStrictEqual(value, component)))
        throw forbidden("A Native bootstrap component is malformed");
      componentSets.push({ policy: receipt.data.bootstrap.policy, inputs: receipt.data.bootstrap.inputs });
      continue;
    }
    const expectedKeys = component.kind === "dispatch"
      ? ["kind", "executionInputDigest", "policy", "inputs"]
      : component.kind === "additional_input" ? ["kind", "responsibleUserId", "policy", "inputs"] : [];
    if (!expectedKeys.length || !isDeepStrictEqual(Object.keys(component).sort(), expectedKeys.sort()) ||
      input.components.slice(0, componentIndex).some(value => isDeepStrictEqual(value, component)))
      throw forbidden("A Native source component is malformed");
    const parsedPolicy = nativePayloadSourcePolicySchema.safeParse(component.policy);
    const parsedInputs = nativePayloadSourceInputSchema.array().safeParse(component.inputs);
    if (!parsedPolicy.success || !parsedInputs.success) throw forbidden("The Native source component is malformed");
    const set = { policy: parsedPolicy.data, inputs: parsedInputs.data };
    if (component.kind === "dispatch") {
      if (!/^[0-9a-f]{64}$/.test(component.executionInputDigest)) throw forbidden("A Native dispatch component is malformed");
      const matches = receipt.data.dispatches.filter(value => value.executionInputDigest === component.executionInputDigest &&
        isDeepStrictEqual(value.policy, set.policy) && isDeepStrictEqual(value.inputs, set.inputs));
      const markers = set.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "worker_model_dispatch" | "conversation_model_dispatch" }> =>
        value.kind === "worker_model_dispatch" || value.kind === "conversation_model_dispatch");
      // Cumulative transcript prefixes retain every earlier model dispatch.
      // The current response's marker is the final input appended to this
      // immutable prefix; older markers can share the same acknowledged-turn
      // digest and are validated as preceding sources below.
      const marker = markers.at(-1);
      const markerIntents = marker ? wireIntents.filter(intent => intent.reservationId === marker.reservationId &&
        intent.modelPurpose === (marker.kind === "conversation_model_dispatch" ? "conversation_model" : "worker_model") &&
        intent.sourceDispatchDigest === component.executionInputDigest && intent.callId === marker.callId &&
        intent.requestHash === marker.requestHash && intent.wireBodyHash === marker.wireBodyHash) : [];
      const reservation = marker ? await nativeSourceReadReservation(db, input.companyId, marker.reservationId, scope) : null;
      const expectedPurpose = marker?.kind === "conversation_model_dispatch" ? "conversation_model" : "worker_model";
      const conversationBinding = marker?.kind === "conversation_model_dispatch"
        ? nativeSourceRecord(markerIntents[0]?.conversationModelBinding) : null;
      const [conversationIssue] = marker?.kind === "conversation_model_dispatch"
        ? await db.select().from(issues).where(and(eq(issues.companyId, input.companyId),
          eq(issues.id, marker.issueId))).for("share") : [];
      const [conversationManifest] = marker?.kind === "conversation_model_dispatch"
        ? await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, input.companyId),
          eq(agentExecutionManifests.id, marker.executionManifestId), eq(agentExecutionManifests.agentId, marker.agentId),
          eq(agentExecutionManifests.runId, marker.runId))).for("share") : [];
      const conversationBound = marker?.kind !== "conversation_model_dispatch" || (!!reservation && !!markerIntents[0] &&
        reservation.conversationAgentId === marker.agentId && reservation.conversationRunId === marker.runId &&
        reservation.conversationIssueId === marker.issueId &&
        reservation.conversationSessionGeneration === marker.conversationSessionGeneration &&
        reservation.executionManifestId === marker.executionManifestId && reservation.executionManifestHash === marker.executionManifestHash &&
        conversationBinding?.issueId === marker.issueId &&
        conversationBinding?.conversationSessionGeneration === marker.conversationSessionGeneration &&
        conversationBinding?.executionManifestId === marker.executionManifestId &&
        conversationBinding?.executionManifestHash === marker.executionManifestHash &&
        conversationIssue?.conversationAgentId === marker.agentId && conversationIssue.conversationUserId === run.responsibleUserId &&
        conversationIssue.conversationSessionGeneration === marker.conversationSessionGeneration &&
        conversationIssue.conversationState === "active" && conversationIssue.conversationRetiredAt === null &&
        conversationIssue.executionRunId === marker.runId && conversationIssue.status === "in_review" &&
        conversationManifest?.hash === marker.executionManifestHash &&
        conversationManifest.manifest.responsibleUserId === run.responsibleUserId);
      if (matches.length !== 1 || !marker || marker.runId !== input.runId ||
        markers.filter(value => isDeepStrictEqual(value, marker)).length !== 1 ||
        !isDeepStrictEqual(matches[0]!.inputs.at(-1), marker) || markerIntents.length !== 1 || !reservation ||
        reservation.purpose !== expectedPurpose || !conversationBound || reservation.status !== "completed" || reservation.inputHash !== marker.requestHash ||
        reservation.providerResponseHash !== marker.responseHash ||
        markerIntents[0]!.endpoint !== "https://api.anthropic.com/v1/messages" || markerIntents[0]!.method !== "POST")
        throw forbidden("A Native dispatch component is not in its original receipt");
    } else if (component.kind === "additional_input") {
      if (typeof component.responsibleUserId !== "string") throw forbidden("A Native additional input is malformed");
      const matches = receipt.data.additionalInputs.filter(value => value.responsibleUserId === component.responsibleUserId &&
        isDeepStrictEqual(value.policy, set.policy) && isDeepStrictEqual(value.inputs, set.inputs));
      if (matches.length !== 1) throw forbidden("A Native additional input component is not in its original receipt");
    } else throw forbidden("A Native source component family is unsupported");
    inputCount += set.inputs.length;
    componentSets.push(set);
  }
  if (inputCount > 512) throw forbidden("The Native consumed source graph exceeds its bound");
  const combinedInputs: NativePayloadSourceInput[] = [];
  for (const set of componentSets) for (const source of set.inputs)
    if (!combinedInputs.some(value => isDeepStrictEqual(value, source))) combinedInputs.push(source);
  const policyKeys = ["issueIds", "projectIds", "runIds", "memoryIds", "foundationRevisionIds"] as const;
  const combinedPolicy = Object.fromEntries(policyKeys.map(key => [key,
    [...new Set(componentSets.flatMap(set => set.policy[key]))].sort()])) as NativePayloadSourcePolicy;
  if (!isDeepStrictEqual(combinedInputs, inputs.data) || !isDeepStrictEqual(combinedPolicy, policy.data))
    throw forbidden("The Native consumed source components do not match their source set");
  for (const [index, component] of input.components.entries()) {
    const set = componentSets[index]!;
    const marker = component.kind === "dispatch" ? set.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "worker_model_dispatch" | "conversation_model_dispatch" }> =>
      value.kind === "worker_model_dispatch" || value.kind === "conversation_model_dispatch").at(-1) : undefined;
    const checkedInputs = marker ? set.inputs.filter(value => !isDeepStrictEqual(value, marker)) : set.inputs;
    await assertNativePayloadSourceSetCurrentInScope(db, { companyId: input.companyId, issueId: input.issueId,
      runId: input.runId, actor: input.actor, policy: set.policy, inputs: checkedInputs }, scope);
  }
}

/** Revalidate a managed model request's ordered, server-captured union of
 * original bootstrap/dispatch/additional-input components and current owners. */
export async function assertNativeManagedConsumedSourceSetCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  components: NativeConsumedSourceComponent[]; sourceSet: NativePayloadSourceSet;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativeManagedConsumedSourceSetCurrentInScope(tx, input, scope);
  }));
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

export interface NativeContextReadBinding {
  readonly markdown: string;
  readonly witness: NonNullable<import("./context/context-engine.js").ContextAssemblyResult["nativeBootstrapWitness"]>;
  readonly manifestIds: readonly { companyId: string; contextManifestId: string }[];
  readonly sourceSet: { policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] };
}

/** Rebuild the server-owned Context source tuple for a captured managed
 * read_context result. The tool_result reader calls this after the original
 * provider dispatch and succeeded invocation have been verified. */
export async function assertNativeContextReadSourceSetCurrent(db: Db | Transaction, input: {
  companyId: string; agentId: string; runId: string; issueId: string; actor: AuthorizationActor;
  sourceSet: NativeContextReadBinding["sourceSet"];
  manifestIds: readonly { companyId: string; contextManifestId: string }[];
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor,
    scope => assertNativeContextReadSourceSetCurrentInScope(tx, input, scope)));
}

async function assertNativeContextReadSourceSetCurrentInScope(db: Db | Transaction, input: {
  companyId: string; agentId: string; runId: string; issueId: string; actor: AuthorizationActor;
  sourceSet: NativeContextReadBinding["sourceSet"];
  manifestIds: readonly { companyId: string; contextManifestId: string }[];
}, scope: NativeSourceReadScope): Promise<void> {
  if (!input.sourceSet || typeof input.sourceSet !== "object" || Array.isArray(input.sourceSet))
    throw forbidden("The Native Context read source binding is unavailable");
  await lockNativeSourceReadPrivacy(db, input.companyId, scope);
  const parsedInputs = nativePayloadSourceInputSchema.array().safeParse(input.sourceSet.inputs);
  const parsedPolicy = nativePayloadSourcePolicySchema.safeParse(input.sourceSet.policy);
  const contextInputs = parsedInputs.success ? parsedInputs.data.filter((value): value is Extract<NativePayloadSourceInput, { kind: "context" }> =>
    value.kind === "context") : [];
  if (!parsedInputs.success || !parsedPolicy.success || contextInputs.length !== 1 ||
    input.manifestIds.length !== 1 ||
    input.manifestIds[0]?.companyId !== input.companyId ||
    input.manifestIds[0]?.contextManifestId !== contextInputs[0]!.manifestId ||
    !await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("The Native Context read source binding is unavailable");
  const source = contextInputs[0]!;
  const [manifest] = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, input.companyId),
    eq(contextManifests.id, source.manifestId), eq(contextManifests.runId, input.runId),
    eq(contextManifests.agentId, input.agentId), eq(contextManifests.issueId, input.issueId)));
  const [issue] = await db.select({ projectId: issues.projectId }).from(issues).where(and(
    eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)));
  const items = await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, input.companyId),
    eq(contextManifestItems.manifestId, source.manifestId))).orderBy(contextManifestItems.rank, contextManifestItems.id);
  const roots = await db.select().from(contextManifestMemoryRoots).where(and(eq(contextManifestMemoryRoots.companyId, input.companyId),
    eq(contextManifestMemoryRoots.manifestId, source.manifestId))).orderBy(contextManifestMemoryRoots.memoryRecordId);
  if (!manifest || !issue || items.length > 256 || roots.length > 256 ||
    manifest.queryHash !== source.queryHash || manifest.policySnapshotHash !== source.policySnapshotHash ||
    temporalContextContentHash(manifest, items, roots) !== source.contentHash)
    throw forbidden("The Native Context read source changed");
  if (!await canActorReadIssuePrivacy(db as Db, input.actor, { id: input.issueId, companyId: input.companyId }))
    throw forbidden("A Native Context Task source is unavailable");

  const expectedPolicy: NativePayloadSourcePolicy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  const expectedInputs: NativePayloadSourceInput[] = [];
  const appendSnapshot = (raw: unknown, ownerKind: "issue" | "memory_record", ownerId: string) => {
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(raw);
    if (!snapshot.success || snapshot.data.owner.kind !== ownerKind || snapshot.data.owner.companyId !== input.companyId ||
      snapshot.data.owner.id !== ownerId) throw forbidden("The Native Context owner snapshot is unavailable");
    for (const key of Object.keys(expectedPolicy) as (keyof NativePayloadSourcePolicy)[])
      expectedPolicy[key] = [...new Set([...expectedPolicy[key], ...snapshot.data.policy[key]])].sort();
    for (const nested of snapshot.data.inputs) {
      if (nested.kind === "context") throw forbidden("Nested Native Context sources are unavailable");
      if (!expectedInputs.some(existing => isDeepStrictEqual(existing, nested))) expectedInputs.push(nested);
    }
  };
  if (manifest.projectId) expectedPolicy.projectIds.push(manifest.projectId);
  for (const item of items) {
    if (item.sourceProvider === "august_works_tasks") {
      const ref = /^issue:\/\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(item.sourceRef);
      if (!ref) throw forbidden("The Native Context read has an unsupported Task source");
      expectedPolicy.issueIds = [...new Set([...expectedPolicy.issueIds, ref[1]!])].sort();
      appendSnapshot(item.payloadSourceSnapshot, "issue", ref[1]!);
    } else if (item.sourceProvider === "august_works_memory" || item.sourceProvider === "august_works_derived_memory") {
      const ref = /^memory:\/\/(?:record|derived)\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(item.sourceRef);
      if (!ref) throw forbidden("The Native Context read has an unsupported Memory source");
      if (item.sourceProvider === "august_works_memory") {
        if (!roots.some(root => root.memoryRecordId === ref[1] && root.sourceVersion === item.sourceVersion))
          throw forbidden("The Native Context Memory root is unavailable");
        expectedPolicy.memoryIds = [...new Set([...expectedPolicy.memoryIds, ref[1]!])].sort();
      }
    } else if (item.sourceProvider === "august_works_foundation") {
      const ref = /^foundation:\/\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/(?:whole|\d+)$/i.exec(item.sourceRef);
      if (!ref || item.sourceVersion !== ref[1]) throw forbidden("The Native Context read has an unsupported Foundation source");
      expectedPolicy.foundationRevisionIds = [...new Set([...expectedPolicy.foundationRevisionIds, ref[1]!])].sort();
    } else throw forbidden("The Native Context read source family is unsupported");
  }
  for (const root of roots) {
    expectedPolicy.memoryIds = [...new Set([...expectedPolicy.memoryIds, root.memoryRecordId])].sort();
    appendSnapshot(root.payloadSourceSnapshot, "memory_record", root.memoryRecordId);
  }
  expectedInputs.push(source);
  const references = expectedInputs.length + Object.values(expectedPolicy).reduce((sum, values) => sum + values.length, 0);
  if (references > 256 || !isDeepStrictEqual(parsedPolicy.data, expectedPolicy) || !isDeepStrictEqual(parsedInputs.data, expectedInputs))
    throw forbidden("The Native Context read policy changed");
  for (const projectId of expectedPolicy.projectIds) {
    const [project] = await db.select().from(projects).where(and(eq(projects.companyId, input.companyId), eq(projects.id, projectId)));
    if (!project || !await canActorReadProjectPrivacy(db as Db, input.actor, project))
      throw forbidden("A Native Context Project source is unavailable");
  }
  await assertNativeTemporalContextInputsCurrent(db as Db, input.companyId, [source]);
  await assertNativeContextInputOwnersCurrent(db as Db, input.companyId, input.actor, [source], scope);
}

/** Assemble and bind the exact Native Context body returned by the managed
 * read_context tool. The model supplies only a bounded search query; current
 * owners, policy roots, witness and manifest IDs all come from server reads. */
export async function assembleNativeContextRead(db: Db | Transaction, input: {
  companyId: string; agentId: string; runId: string; issueId: string; projectId: string | null;
  responsibleUserId: string | null; actor: AuthorizationActor; query: string;
}): Promise<NativeContextReadBinding> {
  if (input.actor.type !== "agent" || input.actor.companyId !== input.companyId ||
    input.actor.agentId !== input.agentId || input.actor.runId !== input.runId ||
    (input.actor.onBehalfOfUserId ?? null) !== input.responsibleUserId ||
    !input.query.trim() || input.query.length > 4_000)
    throw forbidden("The Native Context read binding is unavailable");
  const [issue] = await db.select({ id: issues.id, companyId: issues.companyId, projectId: issues.projectId,
    title: issues.title, description: issues.description }).from(issues).where(and(
    eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)));
  const [run] = await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId,
    responsibleUserId: heartbeatRuns.responsibleUserId, status: heartbeatRuns.status,
    nativeIssueId: heartbeatRuns.nativeIssueId, issueId: heartbeatRuns.issueId }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId)));
  if (!issue || issue.projectId !== input.projectId || !run || run.status !== "running" ||
    (run.nativeIssueId ?? run.issueId) !== input.issueId || (run.responsibleUserId ?? null) !== input.responsibleUserId ||
    !await canActorReadIssuePrivacy(db, input.actor, issue))
    throw forbidden("The Native Context read owner is unavailable");

  const [{ contextEngineService }, { instanceSettingsService }] = await Promise.all([
    import("./context/context-engine.js"), import("./instance-settings.js"),
  ]);
  const settings = await instanceSettingsService(db as Db).getExperimental();
  if (settings.enableContextEngineV1 !== true)
    throw forbidden("The Native Context read feature is unavailable");
  const assembled = await contextEngineService(db as Db).assembleNativeBootstrap({ companyId: input.companyId,
    agentId: input.agentId, authorizationActor: input.actor, responsibleUserId: input.responsibleUserId,
    runId: input.runId, issueId: input.issueId, projectId: input.projectId, query: input.query,
    enforceResponsibleUserIntersection: true, intent: "native_task_execution",
    includeFoundation: settings.enableFoundationV1 === true, sensitivityCeiling: "internal" });
  const witness = assembled.nativeBootstrapWitness;
  const manifestId = assembled.packet.manifest?.id;
  if (!witness || !manifestId || assembled.markdown.length > 64_000)
    throw forbidden("The Native Context read witness is unavailable");
  const manifestIds = [{ companyId: input.companyId, contextManifestId: manifestId }];
  const { revalidateNativeBootstrapContextWitness } = await import("./context/context-manifest.js");
  await revalidateNativeBootstrapContextWitness(db as Db, { witness, companyId: input.companyId, runId: input.runId,
    agentId: input.agentId, issueId: input.issueId, renderedMarkdown: assembled.markdown, manifestIds });

  const manifests = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, input.companyId),
    eq(contextManifests.id, manifestId), eq(contextManifests.runId, input.runId), eq(contextManifests.agentId, input.agentId),
    eq(contextManifests.issueId, input.issueId)));
  const items = await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, input.companyId),
    eq(contextManifestItems.manifestId, manifestId))).orderBy(contextManifestItems.rank, contextManifestItems.id);
  const roots = await db.select().from(contextManifestMemoryRoots).where(and(eq(contextManifestMemoryRoots.companyId, input.companyId),
    eq(contextManifestMemoryRoots.manifestId, manifestId))).orderBy(contextManifestMemoryRoots.memoryRecordId);
  if (manifests.length !== 1 || items.length > 256 || roots.length > 256)
    throw forbidden("The Native Context read source set exceeds its bound");
  const witnessClosure = readNativeBootstrapContextWitness(witness, { companyId: input.companyId, runId: input.runId,
    agentId: input.agentId, issueId: input.issueId, renderedMarkdown: assembled.markdown, manifestIds });
  if (!witnessClosure) throw forbidden("The Native Context read source witness is unavailable");
  const contextInput: Extract<NativePayloadSourceInput, { kind: "context" }> = { kind: "context", manifestId,
    queryHash: manifests[0]!.queryHash, policySnapshotHash: manifests[0]!.policySnapshotHash,
    contentHash: temporalContextContentHash(manifests[0]!, items, roots) };
  const sourceSet: NativeContextReadBinding["sourceSet"] = { policy: witnessClosure.policy,
    inputs: [...witnessClosure.inputs, contextInput] };
  await assertNativeContextReadSourceSetCurrent(db, { companyId: input.companyId, agentId: input.agentId,
    runId: input.runId, issueId: input.issueId, actor: input.actor, sourceSet,
    manifestIds: manifestIds.map(value => ({ ...value })) });
  return { markdown: assembled.markdown, witness, manifestIds, sourceSet };
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

async function assertNativeFrozenTaskSnapshotCurrent(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  issueId: string, snapshot: NativePayloadSourceSnapshot, scope: NativeSourceReadScope): Promise<void> {
  const references = snapshot.inputs.length + Object.values(snapshot.policy).reduce((total, values) => total + values.length, 0);
  if (references > 256 || snapshot.inputs.length > 256)
    throw forbidden("The frozen Native Task source closure exceeds its bound");
  if (references === 0) return;
  const dispatches = snapshot.inputs.flatMap((source, index) =>
    source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch" ? [{ source, index }] : []);
  const last = dispatches.at(-1);
  if (!last || last.index !== snapshot.inputs.length - 1 || dispatches.length > 64)
    throw forbidden("The frozen Native Task source closure has no retained dispatch receipt");
  const visitKey = `frozen-task-snapshot:${companyId}:${issueId}:${snapshot.digest}`;
  if (scope.active.has(visitKey)) throw forbidden("The frozen Native Task source graph contains a cycle");
  scope.active.add(visitKey);
  try {
    nativeSourceReadWork(scope);
    const [producer] = await db.select({ issueId: heartbeatRuns.nativeIssueId,
      profile: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, last.source.runId), eq(heartbeatRuns.runtimeMode, "native")));
    if (!producer?.issueId) throw forbidden("The frozen Native Task source producer is unavailable");
    const profile = nativeSourceRecord(producer.profile);
    const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
    const matchingDispatches = receipt.success ? receipt.data.dispatches.filter(value =>
      isDeepStrictEqual(value.policy, snapshot.policy) && isDeepStrictEqual(value.inputs, snapshot.inputs) &&
      value.inputs.at(-1)?.kind === last.source.kind && isDeepStrictEqual(value.inputs.at(-1), last.source)) : [];
    if (!receipt.success || matchingDispatches.length !== 1 || !/^[0-9a-f]{64}$/.test(matchingDispatches[0]!.executionInputDigest))
      throw forbidden("The frozen Native Task dispatch prefix is unavailable");
    const component: NativeConsumedSourceComponent = { kind: "dispatch",
      executionInputDigest: matchingDispatches[0]!.executionInputDigest, policy: snapshot.policy, inputs: snapshot.inputs };
    await assertNativeManagedConsumedSourceSetCurrentInScope(db, { companyId, issueId: producer.issueId,
      runId: last.source.runId, actor, components: [component],
      sourceSet: { policy: snapshot.policy, inputs: snapshot.inputs } }, scope);
  } finally {
    scope.active.delete(visitKey);
  }
}

async function assertNativeTaskSourceInputCurrentInScope(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  source: Extract<NativePayloadSourceInput, { kind: "task" }>, scope: NativeSourceReadScope): Promise<void> {
  nativeSourceReadWork(scope);
  const [task] = await db.select({ id: issues.id, companyId: issues.companyId, identifier: issues.identifier,
    title: issues.title, description: issues.description, workMode: issues.workMode, status: issues.status, priority: issues.priority })
    .from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, source.issueId))).for("share");
  // Task sourceVersion is a row timestamp, so ordinary status/responsibility
  // transitions can advance it while the captured Task payload stays exact.
  // The source constructors have two closed Task projections: the full Task
  // body and the compact ancestor summary. Validate either exact projection,
  // then always validate the owner's current snapshot/dispatch and reader ACL.
  const bodyHash = task ? createHash("sha256").update(JSON.stringify({ id: source.issueId,
    identifier: task.identifier ?? null, title: task.title, description: task.description ?? null,
    workMode: task.workMode }), "utf8").digest("hex") : null;
  const ancestorHash = task ? createHash("sha256").update(JSON.stringify({ id: source.issueId,
    identifier: task.identifier ?? null, title: task.title, status: task.status, priority: task.priority }), "utf8").digest("hex") : null;
  if (!task || (bodyHash !== source.contentHash && ancestorHash !== source.contentHash))
    throw forbidden("A Native source Task changed");
  await assertNativeTaskSnapshotOwnerCurrentInScope(db, companyId, actor, source.issueId, scope);
}

async function assertConversationCommentSourceCurrent(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; source: Extract<NativePayloadSourceInput, { kind: "comment" }>;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}, scope: NativeSourceReadScope) {
  nativeSourceReadWork(scope);
  const [comment] = await db.select({ sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text`,
    payloadSourceSnapshot: issueComments.payloadSourceSnapshot,
    payloadSourceSnapshotInvalidated: issueComments.payloadSourceSnapshotInvalidated,
    ownerBodyHash: sql<string>`public.aw_native_payload_body_hash('comment', to_jsonb(${issueComments}))`,
    payloadSourceSnapshotDigestValid: sql<boolean>`(${issueComments.payloadSourceSnapshot}->>'digest') = encode(sha256(convert_to((${issueComments.payloadSourceSnapshot}-'digest')::text,'UTF8')),'hex')` })
    .from(issueComments).where(and(eq(issueComments.companyId, input.companyId), eq(issueComments.issueId, input.source.issueId),
      eq(issueComments.id, input.source.commentId), isNull(issueComments.deletedAt))).for("share");
  const { issueService } = await import("./issues.js");
  const view = comment ? await issueService(db as Db).getComment(input.source.commentId) : null;
  const projection = view && typeof view === "object" ? view as Record<string, unknown> : null;
  const snapshot = nativePayloadSourceSnapshotSchema.safeParse(comment?.payloadSourceSnapshot);
  const snapshotRootsRetained = snapshot.success && snapshot.data.inputs.every(root =>
    input.inputs.some(candidate => isDeepStrictEqual(candidate, root))) &&
    (Object.keys(input.policy) as (keyof NativePayloadSourcePolicy)[]).every(key =>
      snapshot.data.policy[key].every(sourceId => input.policy[key].includes(sourceId)));
  if (!comment || comment.sourceVersion !== input.source.sourceVersion || !projection ||
    comment.payloadSourceSnapshotInvalidated || !snapshot.success || !snapshotRootsRetained ||
    comment.payloadSourceSnapshotDigestValid !== true || snapshot.data.digest !== comment.payloadSourceSnapshot?.digest ||
    snapshot.data.owner.kind !== "comment" || snapshot.data.owner.companyId !== input.companyId ||
    snapshot.data.owner.id !== input.source.commentId || snapshot.data.owner.contentHash !== comment.ownerBodyHash ||
    nativeCommentProjectionHash({ body: projection.body, presentation: projection.presentation, metadata: projection.metadata }) !== input.source.contentHash ||
    !await canActorReadIssuePrivacy(db, input.actor, { id: input.source.issueId, companyId: input.companyId }))
    throw forbidden("A Native source Comment changed or was erased");
}

async function assertNativeTaskSnapshotOwnerCurrentInScope(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  issueId: string, scope: NativeSourceReadScope, expected?: { snapshot: unknown }): Promise<void> {
  const [owner] = await db.select({ id: issues.id, companyId: issues.companyId,
    conversationAgentId: issues.conversationAgentId, conversationUserId: issues.conversationUserId,
    payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion, payloadSourceSnapshot: issues.payloadSourceSnapshot,
    payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated }).from(issues).where(and(
    eq(issues.companyId, companyId), eq(issues.id, issueId))).for("share");
  if (!owner || owner.payloadSourceSnapshotInvalidated || expected &&
    !isDeepStrictEqual(owner.payloadSourceSnapshot, expected.snapshot))
    throw forbidden("A Native Task source changed or was erased");
  if (owner.payloadSourceProtocolVersion === 1) {
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(owner.payloadSourceSnapshot);
    const [ownerHash] = await db.execute<{ hash: string; digestValid: boolean }>(sql`select
      public.aw_native_payload_body_hash('issue',to_jsonb(i)) as hash,
      encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex')=i.payload_source_snapshot->>'digest'
        as "digestValid" from issues i where i.company_id=${companyId}::uuid and i.id=${issueId}::uuid`);
    if (!snapshot.success || snapshot.data.owner.kind !== "issue" || snapshot.data.owner.companyId !== companyId ||
      snapshot.data.owner.id !== issueId || !ownerHash || !ownerHash.digestValid || snapshot.data.owner.contentHash !== ownerHash.hash)
      throw forbidden("A Native Task source snapshot is unavailable");
    if (owner.conversationAgentId && owner.conversationUserId) {
      const source = snapshot.data.inputs.length === 1 ? snapshot.data.inputs[0] : null;
      const exactCommentRoot = source?.kind === "comment" && source.issueId === issueId &&
        isDeepStrictEqual(snapshot.data.policy, { issueIds: [issueId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] });
      const [comment] = exactCommentRoot ? await db.select({ authorUserId: issueComments.authorUserId,
        authorType: issueComments.authorType }).from(issueComments).where(and(eq(issueComments.companyId, companyId),
        eq(issueComments.issueId, issueId), eq(issueComments.id, source.commentId), isNull(issueComments.deletedAt))).for("share") : [];
      if (!exactCommentRoot || !comment || comment.authorUserId !== owner.conversationUserId || comment.authorType !== "user")
        throw forbidden("The Native conversation source witness is unavailable");
      await assertConversationCommentSourceCurrent(db, { companyId, actor, source, policy: snapshot.data.policy,
        inputs: snapshot.data.inputs }, scope);
    } else await assertNativeFrozenTaskSnapshotCurrent(db, companyId, actor, issueId, snapshot.data, scope);
  } else if (owner.payloadSourceProtocolVersion === 0 || owner.payloadSourceProtocolVersion === null) {
    await assertAnalyticalContextPayloadAccessBatch(db as Db, companyId, actor, [issueId]);
  } else throw forbidden("A Native Task source protocol is unsupported");
  if (!await canActorReadIssuePrivacy(db, actor, { id: issueId, companyId }))
    throw forbidden("A Native Task source is unavailable");
}

async function assertNativeContextInputOwnersCurrent(db: Db, companyId: string, actor: AuthorizationActor,
  inputs: Extract<NativePayloadSourceInput, { kind: "context" }>[], scope: NativeSourceReadScope,
  alreadyValidatedMemoryIds: ReadonlySet<string> = new Set()) {
  if (!inputs.length) return;
  const ids = [...new Set(inputs.map(source => source.manifestId))];
  if (ids.length !== inputs.length) throw forbidden("A Native Context manifest source is ambiguous");
  const manifests = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, companyId), inArray(contextManifests.id, ids))).for("share");
  const items = await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, companyId), inArray(contextManifestItems.manifestId, ids))).for("share");
  const roots = await db.select().from(contextManifestMemoryRoots).where(and(eq(contextManifestMemoryRoots.companyId, companyId), inArray(contextManifestMemoryRoots.manifestId, ids))).for("share");
  if (manifests.length !== ids.length || items.length > 256 || roots.length > 256)
    throw forbidden("A Native Context manifest source is unavailable");
  const taskIds = items.filter(item => item.sourceProvider === "august_works_tasks").map(item => {
    const match = /^issue:\/\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
    if (!match) throw forbidden("A Native Context Task source changed or was erased");
    return match[1]!;
  });
  const taskIssueIds = [...new Set(taskIds)];
  const taskOwners = taskIssueIds.length ? await db.select({ id: issues.id,
    payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion,
    payloadSourceSnapshot: issues.payloadSourceSnapshot, payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated })
    .from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, taskIssueIds))).for("share") : [];
  if (taskOwners.length !== taskIssueIds.length) throw forbidden("A Native Context Task source changed or was erased");
  const taskOwnerById = new Map(taskOwners.map(owner => [owner.id, owner]));
  const legacyTaskIssueIds = new Set(taskIssueIds);
  const taskHashes = taskIssueIds.length ? await db.execute<{ id: string; hash: string; snapshotDigestValid: boolean }>(sql`
    select i.id::text as id,public.aw_native_payload_body_hash('issue',to_jsonb(i)) as hash,
      encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex')=i.payload_source_snapshot->>'digest'
        as "snapshotDigestValid"
    from issues i where i.company_id=${companyId}::uuid and i.id in (${sql.join(taskIssueIds.map(id => sql`${id}::uuid`), sql`, `)})
  `) : [];
  const taskHashById = new Map(taskHashes.map(owner => [owner.id, owner]));
  for (const manifest of manifests) {
    for (const item of items.filter(value => value.manifestId === manifest.id)) {
      nativeSourceReadWork(scope);
      if (item.sourceProvider === "august_works_tasks") {
        const match = /^issue:\/\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
        const owner = match ? taskOwnerById.get(match[1]!) : undefined;
        const ownerHash = match ? taskHashById.get(match[1]!) : undefined;
        const snapshot = nativePayloadSourceSnapshotSchema.safeParse(owner?.payloadSourceSnapshot);
        if (!match || !owner || !ownerHash || owner.payloadSourceSnapshotInvalidated || !snapshot.success ||
          snapshot.data.owner.kind !== "issue" || snapshot.data.owner.companyId !== companyId ||
          snapshot.data.owner.id !== match[1]! || snapshot.data.owner.contentHash !== ownerHash.hash ||
          owner.payloadSourceProtocolVersion === 1 && !ownerHash.snapshotDigestValid ||
          !item.sourceVersion || !item.payloadSourceSnapshot ||
          !isDeepStrictEqual(item.payloadSourceSnapshot, owner.payloadSourceSnapshot))
          throw forbidden("A Native Context Task source changed or was erased");
        if (owner.payloadSourceProtocolVersion === 1) {
          legacyTaskIssueIds.delete(match[1]!);
          await assertNativeFrozenTaskSnapshotCurrent(db, companyId, actor, match[1]!, snapshot.data, scope);
        }
        await canActorReadIssuePrivacy(db, actor, { id: match[1]!, companyId }).then(allowed => {
          if (!allowed) throw forbidden("A Native Context Task source is unavailable");
        });
      } else if (item.sourceProvider === "august_works_memory" || item.sourceProvider === "august_works_derived_memory") {
        const match = /^memory:\/\/(?:record|derived)\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
        if (!match || (!alreadyValidatedMemoryIds.has(match[1]!) &&
          !await canActorReadMemorySources(db, companyId, actor, match[1]!)))
          throw forbidden("A Native Context Memory source is unavailable");
        const [memory] = await db.select({ updatedAt: memoryRecords.updatedAt, title: memoryRecords.title, content: memoryRecords.content,
          payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot, payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated,
          deletedAt: memoryRecords.deletedAt, revokedAt: memoryRecords.revokedAt, supersededByRecordId: memoryRecords.supersededByRecordId })
          .from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, match[1]!), memoryPayloadVisible(), isNull(memoryRecords.deletedAt))).for("share");
        const [memoryHash] = await db.execute<{ hash: string }>(sql`select public.aw_native_payload_body_hash('memory_record',to_jsonb(m)) as hash
          from memory_records m where m.company_id=${companyId}::uuid and m.id=${match[1]!}::uuid and m.deleted_at is null`);
        const memorySnapshot = nativePayloadSourceSnapshotSchema.safeParse(memory?.payloadSourceSnapshot);
        if (!memory || memory.deletedAt || memory.revokedAt || memory.supersededByRecordId || memory.payloadSourceSnapshotInvalidated ||
          !memoryHash || !memorySnapshot.success || memorySnapshot.data.owner.kind !== "memory_record" ||
          memorySnapshot.data.owner.contentHash !== memoryHash.hash || item.sourceVersion !== memory.updatedAt.toISOString() ||
          item.contentHash !== createHash("sha256").update(JSON.stringify({ title: memory.title,
            excerpt: memory.content.slice(0, 64_000) }), "utf8").digest("hex") ||
          !item.payloadSourceSnapshot || !isDeepStrictEqual(item.payloadSourceSnapshot, memory.payloadSourceSnapshot))
          throw forbidden("A Native Context Memory source changed or was erased");
      } else if (item.sourceProvider === "august_works_foundation") {
        const match = /^foundation:\/\/[0-9a-f-]{36}\/([0-9a-f-]{36})\/(?:whole|\d+)$/i.exec(item.sourceRef);
        if (!match || item.sourceVersion !== match[1]) throw forbidden("A Native Context Foundation source is unavailable");
        await assertLearnedAssetAnalyticalSources(db, companyId, "document_revision", match[1]!, actor);
      } else throw forbidden("A Native Context source family is unsupported");
    }
    for (const root of roots.filter(value => value.manifestId === manifest.id)) {
      nativeSourceReadWork(scope);
      const [memory] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
        payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated, revokedAt: memoryRecords.revokedAt,
        supersededByRecordId: memoryRecords.supersededByRecordId, deletedAt: memoryRecords.deletedAt }).from(memoryRecords)
        .where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, root.memoryRecordId), memoryPayloadVisible(), isNull(memoryRecords.deletedAt))).for("share");
      if (!memory || memory.deletedAt || memory.revokedAt || memory.supersededByRecordId || memory.payloadSourceSnapshotInvalidated ||
        !nativePayloadSourceSnapshotSchema.safeParse(memory.payloadSourceSnapshot).success ||
        !isDeepStrictEqual(memory.payloadSourceSnapshot, root.payloadSourceSnapshot) ||
        (!alreadyValidatedMemoryIds.has(root.memoryRecordId) &&
          !await canActorReadMemorySources(db, companyId, actor, root.memoryRecordId)))
        throw forbidden("A Native Context Memory root is unavailable");
    }
  }
  if (legacyTaskIssueIds.size) await assertAnalyticalContextPayloadAccessBatch(db, companyId, actor, [...legacyTaskIssueIds]);
}

export async function assertNativeTemporalContextInputsCurrent(db: Db, companyId: string,
  inputs: Extract<NativePayloadSourceInput, { kind: "context" }>[]) {
  if (inputs.length > 64) throw forbidden("Captured Context source set exceeds its bound");
  const ids = inputs.map(input => input.manifestId);
  if (new Set(ids).size !== ids.length) throw forbidden("Captured Context source set is ambiguous");
  const manifests = ids.length ? await db.select().from(contextManifests).where(and(
    eq(contextManifests.companyId, companyId), inArray(contextManifests.id, ids),
  )).for("share") : [];
  if (manifests.length !== ids.length) throw forbidden("Captured Context source is unavailable");
  const items = ids.length ? await db.select().from(contextManifestItems).where(and(
    eq(contextManifestItems.companyId, companyId), inArray(contextManifestItems.manifestId, ids),
  )).orderBy(contextManifestItems.manifestId, contextManifestItems.rank, contextManifestItems.id).limit(257).for("share") : [];
  const roots = ids.length ? await db.select().from(contextManifestMemoryRoots).where(and(
    eq(contextManifestMemoryRoots.companyId, companyId), inArray(contextManifestMemoryRoots.manifestId, ids),
  )).orderBy(contextManifestMemoryRoots.manifestId, contextManifestMemoryRoots.memoryRecordId).limit(257).for("share") : [];
  if (items.length > 256 || roots.length > 256) throw forbidden("Captured Context source set exceeds its bound");
  for (const input of inputs) {
    const manifest=manifests.find(row=>row.id===input.manifestId);
    if (!manifest || manifest.queryHash!==input.queryHash || manifest.policySnapshotHash!==input.policySnapshotHash ||
      temporalContextContentHash(manifest,items.filter(item=>item.manifestId===manifest.id),roots.filter(root=>root.manifestId===manifest.id))!==input.contentHash)
      throw forbidden("Captured Context source changed");
  }
}

/** Revalidates the original sources of a Native-derived document before any
 * HTTP, download, revision, or Native-tool reader returns its body. The snapshot
 * is evidence only; every referenced owner and current reader policy is checked
 * again. Unknown source families fail closed. */
export async function assertNativeDocumentRevisionCurrentSourceAccess(db: Db, input: {
  companyId: string; issueId: string; revisionId: string; actor: AuthorizationActor; requireLatest?: boolean;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativeDocumentRevisionCurrentSourceAccessInScope(tx as Db, input, scope, 0);
  }));
}

async function assertNativeDocumentRevisionCurrentSourceAccessInScope(db: Db, input: {
  companyId: string; issueId: string; revisionId: string; actor: AuthorizationActor; requireLatest?: boolean;
}, scope: NativeSourceReadScope, depth: number): Promise<void> {
  const activeKey = `${input.companyId}:${input.revisionId}`;
  const completeKey = nativeSha256({ companyId: input.companyId, issueId: input.issueId, revisionId: input.revisionId,
    requireLatest: input.requireLatest !== false, actor: input.actor });
  if (depth > 8 || scope.active.has(activeKey)) throw forbidden("Native document source chain exceeds its bound");
  if (scope.complete.has(completeKey)) {
    const readerSet = scope.deferredReaderSets.get(completeKey);
    if (readerSet) deferNativeSourceReaderCheck(scope, { ...readerSet, actor: input.actor });
    if (readerSet) return;
  }
  nativeSourceReadWork(scope);
  scope.active.add(activeKey);
  // A single read-only source transaction can validate the same document under
  // multiple actor scopes. Reuse only rows already pinned FOR SHARE; latest
  // revision and reader privacy are checked again for every caller below.
  const sourceRowKey = `${input.companyId}:${input.issueId}:${input.revisionId}`;
  let selected = scope.context.documentSources.get(sourceRowKey);
  if (nativeSourceMemoDiagnosticsEnabled()) {
    const key = selected ? "documentRowCacheHits" : "documentRowCacheMisses";
    nativeSourceMemoDiagnostics[key] = Math.min(1_000_000, nativeSourceMemoDiagnostics[key] + 1);
  }
  if (!selected) {
    const [pinned] = await db.select({ revision: documentRevisions, latestRevisionId: documents.latestRevisionId,
      documentId: documents.id, issueId: issueDocuments.issueId }).from(documentRevisions)
      .innerJoin(documents, and(eq(documents.companyId, documentRevisions.companyId), eq(documents.id, documentRevisions.documentId)))
      .innerJoin(issueDocuments, and(eq(issueDocuments.companyId, documents.companyId), eq(issueDocuments.documentId, documents.id)))
      .where(and(eq(documentRevisions.companyId, input.companyId), eq(documentRevisions.id, input.revisionId),
        eq(issueDocuments.issueId, input.issueId))).for("share", { of: [documentRevisions, documents, issueDocuments] });
    if (pinned) {
      selected = pinned;
      scope.context.documentSources.set(sourceRowKey, pinned);
    }
  }
  if (!selected || input.requireLatest !== false && selected.latestRevisionId !== input.revisionId)
    throw forbidden("The selected Native document revision is unavailable");
  const parentKey = `${input.companyId}:${selected.issueId}`;
  let parentTask = scope.context.documentParentTasks.get(parentKey);
  if (nativeSourceMemoDiagnosticsEnabled()) {
    const key = parentTask ? "parentTaskRowCacheHits" : "parentTaskRowCacheMisses";
    nativeSourceMemoDiagnostics[key] = Math.min(1_000_000, nativeSourceMemoDiagnostics[key] + 1);
  }
  if (!parentTask) {
    const [pinned] = await db.select({ id: issues.id, companyId: issues.companyId }).from(issues).where(and(
      eq(issues.companyId, input.companyId), eq(issues.id, selected.issueId))).for("share");
    if (pinned) {
      parentTask = pinned;
      scope.context.documentParentTasks.set(parentKey, pinned);
    }
  }
  if (!parentTask || !await canActorReadIssuePrivacy(db, input.actor, parentTask))
    throw forbidden("The selected Native document Task is unavailable");
  const revision = selected.revision;
  // Protocol-v1 outputs carry their exact historical source prefix. Rechecking
  // the parent Task against every later Context manifest would retroactively
  // attach private sources created after this output (for example, A before R).
  // The complete v1 snapshot below revalidates its exact owners and current
  // readers; legacy revisions retain the broader fail-closed Task check.
  if (revision.payloadSourceProtocolVersion !== 1)
    await assertAnalyticalContextPayloadAccessBatch(db, input.companyId, input.actor, [selected.issueId]);
  if (revision.payloadSourceProtocolVersion === 0 || revision.payloadSourceProtocolVersion === null) {
    scope.active.delete(activeKey); scope.complete.add(completeKey); return;
  }
  if (revision.payloadSourceProtocolVersion !== 1) throw forbidden("The Native document source protocol is unsupported");
  const parsed = nativePayloadSourceSnapshotSchema.safeParse(revision.payloadSourceSnapshot);
  const [ownerHash] = await db.execute<{ hash: string }>(sql`select public.aw_native_payload_body_hash('document_revision',to_jsonb(r)) as hash
    from document_revisions r where r.company_id=${input.companyId}::uuid and r.id=${input.revisionId}::uuid`);
  if (revision.payloadSourceSnapshotInvalidated || !parsed.success || parsed.data.owner.kind !== "document_revision" ||
    parsed.data.owner.companyId !== input.companyId || parsed.data.owner.id !== input.revisionId ||
    !ownerHash || ownerHash.hash !== parsed.data.owner.contentHash)
    throw forbidden("The Native document source snapshot is unavailable");

  const snapshot = parsed.data;
  const policy = snapshot.policy;
  const taskSourceIds = [...new Set([...policy.issueIds, ...snapshot.inputs.flatMap(source =>
    source.kind === "task" ? [source.issueId] : [])])];
  const pinnedTaskSources = taskSourceIds.length ? await db.select({ id: issues.id }).from(issues)
    .where(and(eq(issues.companyId, input.companyId), inArray(issues.id, taskSourceIds))).for("share") : [];
  if (pinnedTaskSources.length !== taskSourceIds.length)
    throw forbidden("A Native document Task source is unavailable");
  for (const issueId of taskSourceIds) {
    const taskInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
      source.kind === "task" && source.issueId === issueId);
    if (taskInputs.length) {
      for (const source of taskInputs)
        await assertNativeTaskSourceInputCurrentInScope(db, input.companyId, input.actor, source, scope);
    } else {
      await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, issueId, scope);
    }
  }
  const projectSourceIds = [...new Set([...policy.projectIds, ...snapshot.inputs.flatMap(source =>
    source.kind === "project" || source.kind === "project_workspace" ? [source.projectId] : [])])];
  for (const projectId of projectSourceIds) {
    const projectInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project" }> =>
      source.kind === "project" && source.projectId === projectId);
    const workspaceInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project_workspace" }> =>
      source.kind === "project_workspace" && source.projectId === projectId);
    await assertNativeProjectSourceCurrentInScope(db, { companyId: input.companyId, actor: input.actor, projectId,
      ...(projectInputs.length ? { sources: projectInputs } : {}), ...(workspaceInputs.length ? { workspaceSources: workspaceInputs } : {}) }, scope);
  }
  const memorySourceIds = [...new Set([...policy.memoryIds, ...snapshot.inputs.flatMap(source =>
    source.kind === "memory" ? [source.memoryId] : [])])];
  for (const memoryId of memorySourceIds) {
    nativeSourceReadWork(scope);
    const [memory] = await db.select({ id: memoryRecords.id, companyId: memoryRecords.companyId,
      payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot, payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated })
      .from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId), eq(memoryRecords.id, memoryId), isNull(memoryRecords.deletedAt), memoryPayloadVisible())).for("share");
    const [memoryHash] = await db.execute<{ hash: string }>(sql`select public.aw_native_payload_body_hash('memory_record',to_jsonb(m)) as hash
      from memory_records m where m.company_id=${input.companyId}::uuid and m.id=${memoryId}::uuid and m.deleted_at is null`);
    const memorySnapshot = nativePayloadSourceSnapshotSchema.safeParse(memory?.payloadSourceSnapshot);
    if (!memory || memory.payloadSourceSnapshotInvalidated || !memorySnapshot.success || !memoryHash ||
      memorySnapshot.data.owner.kind !== "memory_record" || memorySnapshot.data.owner.contentHash !== memoryHash.hash)
      throw forbidden("A Native document Memory source is unavailable");
  }
  for (const runId of policy.runIds) {
    nativeSourceReadWork(scope);
    const [run] = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId })
      .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, runId)));
    if (!run || !await canActorReadHeartbeatRunPrivacy(db, input.actor, run))
      throw forbidden("A Native document run source is unavailable");
  }
  if (policy.foundationRevisionIds.length) {
    const access = await authorizationService(db).decide({ actor: input.actor, action: "foundation:read",
      resource: { type: "company", companyId: input.companyId }, enforceResponsibleUserIntersection: true });
    if (!access.allowed) throw forbidden("A Native document Foundation source is unavailable");
    for (const revisionId of policy.foundationRevisionIds) {
      const [foundation] = await db.select({ foundation: foundationDocuments, body: documentRevisions.body,
        invalidated: documentRevisions.payloadSourceSnapshotInvalidated }).from(foundationDocuments)
        .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, foundationDocuments.companyId),
          eq(documentRevisions.documentId, foundationDocuments.documentId), eq(documentRevisions.id, foundationDocuments.approvedRevisionId)))
        .where(and(eq(foundationDocuments.companyId, input.companyId), eq(foundationDocuments.approvedRevisionId, revisionId),
          eq(foundationDocuments.status, "approved")));
      if (!foundation || foundation.invalidated) throw forbidden("A Native document Foundation source changed or was erased");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", revisionId, input.actor);
    }
  }

  const contextInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "context" }> => source.kind === "context");
  await assertNativeTemporalContextInputsCurrent(db, input.companyId, contextInputs);
  if (contextInputs.length) {
    const ids = contextInputs.map(source => source.manifestId);
    const manifests = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, input.companyId), inArray(contextManifests.id, ids)));
    const items = await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, input.companyId), inArray(contextManifestItems.manifestId, ids)));
    const roots = await db.select().from(contextManifestMemoryRoots).where(and(eq(contextManifestMemoryRoots.companyId, input.companyId), inArray(contextManifestMemoryRoots.manifestId, ids)));
    for (const manifest of manifests) {
      const manifestItems = items.filter(item => item.manifestId === manifest.id);
      for (const item of manifestItems) {
        nativeSourceReadWork(scope);
        if (item.sourceProvider === "august_works_tasks") {
          const match = /^issue:\/\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
          if (!match || !item.sourceVersion || !item.payloadSourceSnapshot)
            throw forbidden("A selected Context Task source changed or was erased");
          await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, match[1]!, scope,
            { snapshot: item.payloadSourceSnapshot });
        } else if (item.sourceProvider === "august_works_memory" || item.sourceProvider === "august_works_derived_memory") {
          const match = /^memory:\/\/(?:record|derived)\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
          if (!match)
            throw forbidden("A selected Context Memory source is unavailable");
        } else if (item.sourceProvider === "august_works_foundation") {
          const match = /^foundation:\/\/[0-9a-f-]{36}\/([0-9a-f-]{36})\/(?:whole|\d+)$/i.exec(item.sourceRef);
          if (!match || item.sourceVersion !== match[1]) throw forbidden("A selected Context Foundation source is unavailable");
          await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", match[1]!, input.actor);
        } else throw forbidden("A selected Context source family is unsupported");
      }
      for (const root of roots.filter(value => value.manifestId === manifest.id)) {
        nativeSourceReadWork(scope);
        const [owner] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
          payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
          .where(and(eq(memoryRecords.companyId, input.companyId), eq(memoryRecords.id, root.memoryRecordId), memoryPayloadVisible())).for("share");
        if (!owner || owner.payloadSourceSnapshotInvalidated || !isDeepStrictEqual(owner.payloadSourceSnapshot, root.payloadSourceSnapshot))
          throw forbidden("A selected Context Memory root is unavailable");
      }
    }
  }

  const dispatchInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "worker_model_dispatch" | "conversation_model_dispatch" }> =>
    source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch");
  const dispatchRunId = dispatchInputs[0]?.runId;
  if (dispatchInputs.some(source => source.runId !== dispatchRunId) || dispatchInputs.length > 64)
    throw forbidden("The Native document source has ambiguous model dispatches");
  let memoryReviewReceipt: NativeRunInputSourceReceipt | undefined;
  if (dispatchInputs.length) {
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, dispatchRunId!), eq(heartbeatRuns.nativeIssueId, input.issueId)));
    const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
      ? run.runnerProfileJson as Record<string, unknown> : null;
    const receipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
    if (receipt?.success) memoryReviewReceipt = receipt.data;
    const managedOutputCaptures = Array.isArray(profile?.nativeToolResultSourceCaptures)
      ? profile.nativeToolResultSourceCaptures.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
        (value as Record<string, unknown>).tool === "write_document" &&
        (value as Record<string, unknown>).documentRevision && typeof (value as Record<string, unknown>).documentRevision === "object" &&
        ((value as Record<string, unknown>).documentRevision as Record<string, unknown>).revisionId === input.revisionId)
      : [];
    let managedCapture: NativeModelOutputCapture | null = null;
    let dispatch: Extract<NativePayloadSourceInput, { kind: "worker_model_dispatch" | "conversation_model_dispatch" }> | undefined;
    let intent: Record<string, unknown> | undefined;
    let uses: Record<string, unknown>[] = [];
    if (managedOutputCaptures.length === 1) {
      const result = managedOutputCaptures[0] as Record<string, unknown>;
      const callId = result.callId;
      const source = result.source as Record<string, unknown> | undefined;
      const callIdText = typeof callId === "string" ? callId : "";
      const associations = Array.isArray(profile?.nativeToolCallDispatchAssociations)
        ? profile.nativeToolCallDispatchAssociations.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
          (value as Record<string, unknown>).callId === callIdText && (value as Record<string, unknown>).tool === "write_document") : [];
      const intents = Array.isArray(profile?.nativeAwModelWireIntents)
        ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[] : [];
      const bound = dispatchInputs.flatMap(candidate => {
        const candidateIntents = intents.filter(value => value.reservationId === candidate.reservationId);
        const candidateUses = candidateIntents.flatMap(value => Array.isArray(value.responseToolUses)
          ? (value.responseToolUses as unknown[]).filter(use => use && typeof use === "object" && !Array.isArray(use) &&
            (use as Record<string, unknown>).id === callIdText && typeof (use as Record<string, unknown>).name === "string" &&
            ((use as Record<string, unknown>).name as string).replace(/^(?:paperclip__|paperclip_|paperclip\.)/, "") === "write_document" &&
            typeof (use as Record<string, unknown>).argumentsHash === "string" &&
            associations.some(association => (association as Record<string, unknown>).argumentsHash === (use as Record<string, unknown>).argumentsHash)) : []);
        return candidateIntents.length === 1 && candidateUses.length === 1
          ? [{ dispatch: candidate, intent: candidateIntents[0]!, use: candidateUses[0] as Record<string, unknown> }] : [];
      });
      if (source?.kind === "tool_result" && source.callId === callIdText && source.toolName === "write_document" &&
        source.contentHash === result.resultDigest && bound.length === 1 && associations.length === 1) {
        dispatch = bound[0]!.dispatch;
        intent = bound[0]!.intent;
        uses = [bound[0]!.use];
        const receiptInputs = snapshot.inputs.filter(value => !(value.kind === dispatch!.kind && isDeepStrictEqual(value, dispatch)));
        const consumed = nativeManagedConsumedSourceParts(intent, { policy, inputs: receiptInputs });
        if (!consumed) throw forbidden("The Native document consumed source set is unavailable");
        managedCapture = { runId: dispatch.runId, sourceSet: consumed.sourceSet,
          consumedSourceComponents: consumed.components, dispatch,
          managedOpenCodeToolUse: { callId: callIdText, toolName: "write_document",
            argumentsHash: uses[0]!.argumentsHash as string,
            responseContentHash: intent.responseContentHash as string } };
      }
    }
    if (dispatchInputs.length === 1 && !dispatch) dispatch = dispatchInputs[0];
    if (!dispatch) throw forbidden("The Native document source has no exact completed model dispatch");
    const receiptInputs = snapshot.inputs.filter(value => !(value.kind === dispatch!.kind && isDeepStrictEqual(value, dispatch)));
    if (!intent) {
      const intents = Array.isArray(profile?.nativeAwModelWireIntents) ? profile.nativeAwModelWireIntents : [];
      const matches = intents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
        (value as Record<string, unknown>).reservationId === dispatch!.reservationId);
      if (matches.length === 1) intent = matches[0] as Record<string, unknown>;
    }
    const expectedPurpose = dispatch.kind === "conversation_model_dispatch" ? "conversation_model" : "worker_model";
    const [reservation] = await db.select().from(orchestrationModelReservations).where(and(
      eq(orchestrationModelReservations.companyId, input.companyId), eq(orchestrationModelReservations.id, dispatch.reservationId),
      eq(orchestrationModelReservations.purpose, expectedPurpose), eq(orchestrationModelReservations.status, "completed")));
    const expectedKey = expectedPurpose === "worker_model" ? `worker-model-messages:${dispatch.runId}:${dispatch.requestHash}`
      : `conversation-model-messages:${dispatch.runId}:${dispatch.requestHash}`;
    const managed = intent?.idempotencyKey === expectedKey;
    const matchingPrefixDispatches = receipt?.success ? receipt.data.dispatches.filter(value =>
      value.inputs.some(source => source.kind === dispatch.kind && isDeepStrictEqual(source, dispatch)) &&
      isDeepStrictEqual(value.policy, policy) && isDeepStrictEqual(value.inputs, snapshot.inputs)) : [];
    const matchingBootstrap = receipt?.success && dispatchInputs.length === 1 &&
      receipt.data.bootstrap.inputs.length === receiptInputs.length && isDeepStrictEqual(receipt.data.bootstrap.policy, policy) &&
      isDeepStrictEqual(receipt.data.bootstrap.inputs, receiptInputs);
    const matchingDispatch = managed
      ? matchingPrefixDispatches.length === 1 && managedCapture !== null
      : matchingBootstrap;
    if (!run || !receipt?.success || !intent || !reservation || !matchingDispatch ||
      intent.callId !== dispatch.callId || intent.requestHash !== dispatch.requestHash || intent.wireBodyHash !== dispatch.wireBodyHash ||
      reservation.providerResponseHash !== dispatch.responseHash || reservation.inputHash !== dispatch.requestHash)
      throw forbidden("The Native document model dispatch source is unavailable");
    if (managed && (reservation.idempotencyKey !== expectedKey ||
      intent.sourcePolicyHash !== nativeSha256(receipt.data.bootstrap) || intent.endpoint !== "https://api.anthropic.com/v1/messages" || intent.method !== "POST"))
      throw forbidden("The Native document managed provider receipt is unavailable");
    if (managed && managedCapture) await assertNativeModelOutputCaptureCurrentInScope(db, input.companyId, input.issueId,
      managedCapture, "write_document", scope, depth + 1, input.actor);
  } else if (snapshot.inputs.length > 0) {
    throw forbidden("A Native document source is missing its original model dispatch");
  }

  const sourceDispatch = dispatchInputs.at(-1);
  for (const source of snapshot.inputs) {
    nativeSourceReadWork(scope);
    if (source.kind === "task" || source.kind === "project" || source.kind === "context" ||
      source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch") continue;
    if (source.kind === "document_revision") {
      if (!source.issueId) throw forbidden("A Native document history source is unavailable");
      const [linked] = await db.select({ body: documentRevisions.body }).from(documentRevisions)
        .innerJoin(issueDocuments, and(eq(issueDocuments.companyId, documentRevisions.companyId),
          eq(issueDocuments.documentId, documentRevisions.documentId)))
        .where(and(eq(documentRevisions.companyId, input.companyId), eq(documentRevisions.id, source.revisionId),
          eq(issueDocuments.issueId, source.issueId)));
      if (!linked || createHash("sha256").update(linked.body, "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native document history source changed");
      await assertNativeDocumentRevisionCurrentSourceAccessInScope(db, { companyId: input.companyId,
        issueId: source.issueId, revisionId: source.revisionId, actor: input.actor, requireLatest: false }, scope, depth + 1);
      continue;
    }
    if (source.kind === "tool_result") continue;
    if (source.kind === "foundation_revision") {
      const [current] = await db.select({ foundation: foundationDocuments, revision: documentRevisions })
        .from(foundationDocuments).innerJoin(documentRevisions, and(
          eq(documentRevisions.companyId, foundationDocuments.companyId),
          eq(documentRevisions.documentId, foundationDocuments.documentId),
          eq(documentRevisions.id, foundationDocuments.approvedRevisionId)))
        .where(and(eq(foundationDocuments.companyId, input.companyId), eq(foundationDocuments.id, source.foundationDocumentId),
          eq(foundationDocuments.documentId, source.documentId), eq(foundationDocuments.approvedRevisionId, source.revisionId),
          eq(foundationDocuments.status, "approved")));
      if (!current || createHash("sha256").update(current.revision.body, "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native document Foundation revision changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", source.revisionId, input.actor);
      continue;
    }
    if (source.kind === "memory") {
      const [memory] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId), eq(memoryRecords.id, source.memoryId),
          memoryPayloadVisible(), isNull(memoryRecords.deletedAt))).for("share");
      const transitionEvidence = memoryReviewReceipt ? nativeMemoryReviewEvidence(memoryReviewReceipt, source) : undefined;
      const versionMatches = Boolean(memory && memory.updatedAt.toISOString() === source.sourceVersion);
      const acceptedReviewMatches = Boolean(memory && !versionMatches && transitionEvidence &&
        await assertNativeMemoryReviewTransitionEvidence(db, input.companyId, source, transitionEvidence, memory));
      const memoryCurrent = Boolean(memory && !memory.revokedAt && !memory.supersededByRecordId &&
        (versionMatches || acceptedReviewMatches) && nativeSha256(memory.content) === source.contentHash);
      if (!memoryCurrent) throw forbidden("A Native document Memory source changed or was erased");
      continue;
    }
    if (source.kind === "role_pack_version") {
      const { rolePackService } = await import("./role-packs.js");
      let currentInputs: Extract<NativePayloadSourceInput, { kind: "role_pack_version" }>[] = [];
      await rolePackService(db).resolve(input.actor, input.companyId, sourceDispatch ?
        (await db.select({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, sourceDispatch.runId))))[0]?.agentId ?? "" : "",
      undefined, undefined, values => { currentInputs = values; });
      if (currentInputs.filter(value => isDeepStrictEqual(value, source)).length !== 1)
        throw forbidden("A Native document Role Pack version changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "role_pack_version", source.versionId, input.actor);
      continue;
    }
    if (source.kind === "native_task_wake") {
      const [run] = await db.select({ agentId: heartbeatRuns.agentId, nativeIssueId: heartbeatRuns.nativeIssueId,
        contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, source.runId)));
      const [task] = await db.select({ id: issues.id, identifier: issues.identifier, title: issues.title,
        description: issues.description, status: issues.status, priority: issues.priority, workMode: issues.workMode,
        sourceVersion: sql<string>`extract(epoch from ${issues.updatedAt})::text` }).from(issues)
        .where(and(eq(issues.companyId, input.companyId), eq(issues.id, source.issueId)));
      const context = run?.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
        ? run.contextSnapshot as Record<string, unknown> : null;
      const current = run && task && run.nativeIssueId === source.issueId && task.id === source.issueId && context
        ? captureNativeTaskWakeSource({ companyId: input.companyId, runId: source.runId, issueId: source.issueId,
          sourceVersion: task.sourceVersion, persistedWakeReason: typeof context.wakeReason === "string" ? context.wakeReason : null,
          task: { id: task.id, identifier: task.identifier, title: task.title, description: task.description,
            status: task.status, priority: task.priority, workMode: task.workMode }, payload: context.paperclipWake }) : null;
      if (!current || !isDeepStrictEqual(current, source)) throw forbidden("A Native document Task wake source changed");
      continue;
    }
    if (source.kind === "comment") {
      const [comment] = await db.select({ comment: issueComments, sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text` })
        .from(issueComments).where(and(eq(issueComments.companyId, input.companyId), eq(issueComments.issueId, source.issueId),
          eq(issueComments.id, source.commentId), isNull(issueComments.deletedAt)));
      const { issueService } = await import("./issues.js");
      const view = comment ? await issueService(db as Db).getComment(source.commentId) : null;
      const projection = view && typeof view === "object" ? view as Record<string, unknown> : null;
      if (!comment || comment.sourceVersion !== source.sourceVersion || !projection ||
        createHash("sha256").update(JSON.stringify({ body: projection.body, presentation: projection.presentation,
          metadata: projection.metadata }), "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native document comment source changed or was erased");
      const [task] = await db.select({ id: issues.id, companyId: issues.companyId }).from(issues).where(and(
        eq(issues.companyId, input.companyId), eq(issues.id, source.issueId)));
      if (!task || !await canActorReadIssuePrivacy(db, input.actor, task))
        throw forbidden("A Native document comment source is no longer readable");
      continue;
    }
    if (source.kind === "interaction") {
      const [run] = sourceDispatch ? await db.select({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, sourceDispatch.runId))) : [];
      if (!run) throw forbidden("A Native document interaction source is unavailable");
      const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
      const current: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
      await materializeNativeInteractionResponses({ db: db as Db, companyId: input.companyId, issueId: source.issueId,
        runId: sourceDispatch!.runId, agentId: run.agentId, interactionIds: [source.interactionId],
        onSourceCapture: value => { current.push(value); } });
      if (current.length !== 1 || !isDeepStrictEqual(current[0], source))
        throw forbidden("A Native document interaction source changed or was erased");
      continue;
    }
    if (source.kind === "attachment") {
      const [attachment] = await db.select({ attachment: issueAttachments, asset: assets }).from(issueAttachments)
        .innerJoin(assets, and(eq(assets.companyId, issueAttachments.companyId), eq(assets.id, issueAttachments.assetId)))
        .where(and(eq(issueAttachments.companyId, input.companyId), eq(issueAttachments.issueId, source.issueId),
          eq(issueAttachments.id, source.attachmentId)));
      if (!attachment || attachment.attachment.payloadSourceSnapshotInvalidated ||
        source.assetId !== attachment.asset.id || source.sha256 !== attachment.asset.sha256 || source.byteSize !== attachment.asset.byteSize ||
        source.commentId !== attachment.attachment.issueCommentId ||
        source.disposition === "delivered" && (source.assetId !== attachment.asset.id || source.sha256 !== attachment.asset.sha256 ||
          source.byteSize !== attachment.asset.byteSize)) throw forbidden("A Native document attachment source changed or was erased");
      await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, source.issueId, scope);
      continue;
    }
    if (source.kind === "authored_definition") {
      const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, source.agentId)));
      if (!agent) throw forbidden("A Native document authored Agent is unavailable");
      await assertAuthoredAgentSnapshotCurrent(db, agent).catch(() => {
        throw forbidden("A Native document authored Agent changed");
      });
      const config = agent.runtimeConfig && typeof agent.runtimeConfig === "object" && !Array.isArray(agent.runtimeConfig)
        ? agent.runtimeConfig as Record<string, unknown> : {};
      const authored = config[AUTHORED_AGENT_DEFINITION_KEY] && typeof config[AUTHORED_AGENT_DEFINITION_KEY] === "object"
        ? config[AUTHORED_AGENT_DEFINITION_KEY] as Record<string, unknown> : null;
      if (!authored || authored.revisionId !== source.revisionId || authored.definitionHash !== source.definitionHash ||
        (authored.procedureSnapshotHash ?? null) !== source.procedureSnapshotHash)
        throw forbidden("A Native document authored Agent changed");
      continue;
    }
    if (source.kind === "skill_version") {
      const selected = await skillResolverService(db as Db).authorizedVersion(input.actor, input.companyId, source.skillId, source.versionId)
        .catch(() => { throw forbidden("A Native document Skill version is unavailable"); });
      const body = selected.version.fileInventory.find(file => file.path === "SKILL.md")?.content;
      if (selected.skill.key !== source.skillKey || !body || nativeSha256(body) !== source.contentHash)
        throw forbidden("A Native document Skill version changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "skill_version", source.versionId, input.actor);
      continue;
    }
    if (source.kind === "runtime_skill") {
      const [run] = sourceDispatch ? await db.select({ profile: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, sourceDispatch.runId))) : [];
      const profile = run?.profile && typeof run.profile === "object" && !Array.isArray(run.profile) ? run.profile as Record<string, unknown> : null;
      const execution = profile?.nativeExecutionInput && typeof profile.nativeExecutionInput === "object" && !Array.isArray(profile.nativeExecutionInput)
        ? profile.nativeExecutionInput as Record<string, unknown> : null;
      const runtime = execution?.runtimeContext && typeof execution.runtimeContext === "object" && !Array.isArray(execution.runtimeContext)
        ? execution.runtimeContext as Record<string, unknown> : null;
      const skills = Array.isArray(runtime?.skills) ? runtime!.skills as Record<string, unknown>[] : [];
      const skill = skills.find(value => value.key === source.key && value.versionId === source.versionId &&
        (value.bundle as Record<string, unknown> | undefined)?.digest === source.bundleDigest &&
        (value.bundle as Record<string, unknown> | undefined)?.manifestDigest === source.manifestDigest);
      const bundle = skill?.bundle as Parameters<typeof readNativeRuntimeAssetText>[0] | undefined;
      if (!bundle) throw forbidden("A Native document runtime Skill changed");
      await readNativeRuntimeAssetText(bundle, 256000, { companyId: input.companyId, runId: sourceDispatch!.runId }).catch(() => {
        throw forbidden("A Native document runtime Skill was erased");
      });
      if (source.versionId) {
        const [version] = await db.select({ id: companySkillVersions.id, skillId: companySkillVersions.companySkillId })
          .from(companySkillVersions).where(and(eq(companySkillVersions.companyId, input.companyId),
            eq(companySkillVersions.id, source.versionId)));
        if (!version) throw forbidden("A Native document runtime Skill version is unavailable");
        await assertRuntimeSkillSourceRetained(db as Db, input.companyId, input.actor, version.skillId, source.versionId).catch(() => {
          throw forbidden("A Native document runtime Skill source changed");
        });
      }
      continue;
    }
    if (source.kind === "playbook_revision") {
      const [playbook] = await db.select({ playbook: playbookDocuments, body: documentRevisions.body })
        .from(playbookDocuments).innerJoin(documentRevisions, and(eq(documentRevisions.companyId, playbookDocuments.companyId),
          eq(documentRevisions.documentId, playbookDocuments.documentId), eq(documentRevisions.id, playbookDocuments.approvedRevisionId)))
        .where(and(eq(playbookDocuments.companyId, input.companyId), eq(playbookDocuments.id, source.playbookId),
          eq(playbookDocuments.approvedRevisionId, source.revisionId), eq(playbookDocuments.status, "approved")));
      if (!playbook || createHash("sha256").update(playbook.body, "utf8").digest("hex") !== source.contentHash)
        throw forbidden("A Native document Playbook revision changed");
      await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", source.revisionId, input.actor);
      continue;
    }
    if (source.kind === "completion_contract") {
      const [contract] = await db.select().from(completionContracts).where(and(eq(completionContracts.companyId, input.companyId),
        eq(completionContracts.id, source.contractId), eq(completionContracts.issueId, source.issueId)));
      if (!contract || contract.revision.toString() !== source.revision || contract.canonicalSha256 !== source.contentHash)
        throw forbidden("The Native document completion contract changed");
      continue;
    }
    if (source.kind === "runtime_instructions") {
      if (!sourceDispatch || source.agentId !== (await db.select({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, sourceDispatch.runId))).then(rows => rows[0]?.agentId)))
        throw forbidden("The Native document runtime instruction owner changed");
      const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, source.agentId)));
      if (!agent) throw forbidden("The Native document runtime instruction owner is unavailable");
      await assertAuthoredAgentSnapshotCurrent(db, agent).catch(() => {
        throw forbidden("The Native document runtime instruction owner changed");
      });
      const [run] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, sourceDispatch.runId)));
      const execution = (run?.runnerProfileJson as Record<string, unknown> | null)?.nativeExecutionInput as Record<string, unknown> | undefined;
      const runtimeContext = execution?.runtimeContext as Record<string, unknown> | undefined;
      const instructions = runtimeContext?.instructions as Record<string, unknown> | undefined;
      const bundle = instructions?.bundle as Parameters<typeof readNativeRuntimeAssetText>[0] | undefined;
      if (!bundle || bundle.digest !== source.bundleDigest || bundle.manifestDigest !== source.manifestDigest)
        throw forbidden("The Native document runtime instruction source changed");
      await readNativeRuntimeAssetText(bundle, 256000, { companyId: input.companyId, runId: sourceDispatch.runId }).catch(() => {
        throw forbidden("The Native document runtime instruction source was erased");
      });
      continue;
    }
    if (source.kind === "workspace_metadata") {
      if (!sourceDispatch || source.runId !== sourceDispatch.runId) throw forbidden("The Native document workspace source is unavailable");
      const [run] = await db.select({ agentId: heartbeatRuns.agentId, runnerProfileJson: heartbeatRuns.runnerProfileJson })
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, source.runId)));
      const execution = (run?.runnerProfileJson as Record<string, unknown> | null)?.nativeExecutionInput as Record<string, unknown> | undefined;
      const binding = execution?.binding as Record<string, unknown> | undefined;
      const workspace = execution?.workspace as Record<string, unknown> | undefined;
      const tuple = workspace && { cwd: workspace.cwd, repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName };
      if (!run || !tuple || binding?.executionWorkspaceId !== source.executionWorkspaceId ||
        createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex") !== source.contentHash)
        throw forbidden("The Native document workspace tuple changed");
      if (source.origin === "agent_home") {
        const [competingOwner] = await db.select({ id: executionWorkspaces.id }).from(executionWorkspaces).where(and(
          eq(executionWorkspaces.companyId, input.companyId), eq(executionWorkspaces.id, source.executionWorkspaceId)));
        if (competingOwner || source.executionWorkspaceId !== source.runId || source.sourceVersion !== `agent-home:${run.agentId}:v1` ||
          !isDeepStrictEqual(tuple, { cwd: resolveDefaultAgentWorkspaceDir(run.agentId), repoUrl: null, repoRef: null, branchName: null }))
          throw forbidden("The Native document agent workspace changed");
      } else if (source.origin === "execution_workspace") {
        const [current] = await db.select({ cwd: executionWorkspaces.cwd, repoUrl: executionWorkspaces.repoUrl,
          repoRef: executionWorkspaces.baseRef, branchName: executionWorkspaces.branchName, updatedAt: executionWorkspaces.updatedAt })
          .from(executionWorkspaces).where(and(eq(executionWorkspaces.companyId, input.companyId),
            eq(executionWorkspaces.id, source.executionWorkspaceId)));
        if (!current || current.updatedAt.toISOString() !== source.sourceVersion ||
          !isDeepStrictEqual({ cwd: current.cwd, repoUrl: current.repoUrl, repoRef: current.repoRef, branchName: current.branchName }, tuple))
          throw forbidden("The Native document workspace owner changed");
      } else if (source.origin === "task_session") {
        // This source is a server-owned per-run workspace tuple, not an
        // independently persisted execution_workspaces row.
        if (source.executionWorkspaceId !== source.runId || source.sourceVersion !== `task-session:${source.runId}`)
          throw forbidden("The Native document task-session workspace source changed");
      } else throw forbidden("The Native document workspace source family is unsupported");
      continue;
    }
    throw forbidden("A Native document source family is unsupported");
  }
  const readerSet = { companyId: input.companyId, runId: dispatchRunId ?? input.revisionId,
    policy: { issueIds: [...new Set([...policy.issueIds, input.issueId, ...taskSourceIds])].sort(),
      projectIds: projectSourceIds, runIds: policy.runIds, memoryIds: memorySourceIds,
      foundationRevisionIds: policy.foundationRevisionIds }, inputs: snapshot.inputs };
  scope.deferredReaderSets.set(completeKey, readerSet);
  deferNativeSourceReaderCheck(scope, { ...readerSet, actor: input.actor });
  scope.active.delete(activeKey);
  scope.complete.add(completeKey);
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
  // Project API DTOs expose joined workspace rows as well as the projects row.
  // Bind the source rows at the original Human Project capture, rather than
  // treating the Project body's hash as provenance for those independent rows.
  const projectWorkspaceInputs = kind === "project" ? sql`coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind','project_workspace','projectId',w.project_id::text,'workspaceId',w.id::text,
      'sourceVersion',w.updated_at::text,
      'contentHash',encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex'))
      order by w.id)
    from project_workspaces w
    where w.company_id=${projects.companyId} and w.project_id=${projects.id}
  ),'[]'::jsonb)` : sql`'[]'::jsonb`;
  return sql<NativePayloadSourceSnapshot>`(
    with payload as (select jsonb_build_object('version',1,'owner',jsonb_build_object(
      'kind',${kind}::text,'companyId',${table.companyId}::text,'id',${table.id}::text,
      'contentHash',public.aw_native_payload_body_hash(${kind}::text,to_jsonb(${table}))),
      'policy',jsonb_build_object('issueIds',${issuePolicy},'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
        'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),
      'inputs',${projectWorkspaceInputs}) as value)
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
