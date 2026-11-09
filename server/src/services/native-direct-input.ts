import { PROCESS_START_REQUESTED } from "./native-local-process-stop.js";
import { readNativeWorkspaceCoordination } from "./native-runtime/native-workspace-coordination-source.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, gte, inArray, is, isNull, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { activityLog, agents, issues, projects, projectWorkspaces, issueRelations, issueComments, documentRevisions, issueDocuments, issueAttachments, assets,
  contextManifests, contextManifestItems, contextManifestMemoryRoots, accountDeletionOperations, memoryRecords,
  memoryDeletionMarkers,
  completionContracts, heartbeatRuns, heartbeatRunEvents, orchestrationModelReservations, agentExecutionManifests, executionWorkspaces, foundationDocuments,
  nativeRunResults, nativeRunFinalizations, workAssessments, statusDecisions, statusDecisionEffects, documents, companySkills, companySkillVersions, playbookDocuments, rolePacks, rolePackVersions, rolePackItems,
  agentRolePackAssignments, issueThreadInteractions, agentWakeupRequests, issueTreeHolds, type Db } from "@paperclipai/db";
import { toolInvocations } from "@paperclipai/db";
import { nativePayloadSourceInputSchema, nativePayloadSourcePolicySchema, nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema,
  unionNativePayloadSourceInputs, AUTHORED_AGENT_DEFINITION_KEY, conversationModelBindingSchema,
  type NativePayloadSourceInput, type NativePayloadSourcePolicy,
  type NativePayloadSourceSnapshot, type NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { HttpError, forbidden } from "../errors.js";
import { assertAnalyticalContextPayloadAccessBatch } from "./analytical-context-authority.js";
import { activeMemoryNativeSourceRowsScope, activeMemoryTemporalContexts, activeMemoryTemporalReadScopeIdentity,
  withReadPinnedNativeTaskSnapshot, canActorReadHeartbeatRunPrivacy, canActorReadIssuePrivacy,
  canActorReadPinnedIssuePrivacyBatch, canActorReadProjectPrivacy, authorizationService,
  type AuthorizationActor, type MemoryNativeSourceRowsScope, type MemoryPageStructuralProofMemoStore,
  type NativeMutableSourceDependencies, type NativeMutableSourceRowDependency, type NativeMutableSourceRowFamily } from "./authorization.js";
import { activeMemorySourceGraphReadLedger, disableMemorySourceGraphReadCheckpoints, canActorReadMemorySourceSet, canActorReadMemorySources, memoryPayloadVisible } from "./memory/memory-privacy.js";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import { readNativeRuntimeAssetText } from "./native-runtime/runtime-context.js";
import { assertAuthoredAgentSnapshotCurrent } from "./agents/authored-definition.js";
import { readNativeBootstrapContextWitness } from "./context/native-bootstrap-context-witness.js";
import { nativeContextTaskEvidence, nativeContextTaskEvidenceHash } from "./context/context-task-evidence.js";
import { assertLearnedAssetAnalyticalSources } from "./learning/learning-analytical-sources.js";
import { assertRetainedRuntimeSkillSourceCurrent } from "./learning/learning-assets.js";
import { publicNativePayloadRow } from "./native-payload-public.js";
import { projectService } from "./projects.js";
import { skillResolverService } from "./skill-resolver.js";
import { readNativeManualQueueAdoption } from "./native-runtime/manual-queue-adoption.js";
import { nativeContinuationMessageHash, nativeTaskWakeOriginCommentIds, nativeTaskWakeInteraction, nativeContinuationCommentProjection, nativeCommentProjectionHash, nativeSha256 } from "./native-runtime/canonical.js";
import { nativeRetainedRunResumeWitness, nativeToolContractFingerprintForTarget } from "./native-runtime/native-session-resume.js";
import { CAPABILITY_SEMANTIC_TOOL_CATALOG, codexSemanticToolSpecs, parseNativeExecutionInput } from "../vendor/paperclip-runner/index.js";
import { createRunSecretRedactionRegistry } from "./run-secret-redaction.js";
import type { NativeTaskContinuationCapture } from "./execution-continuation.js";
import { sanitizeQuarantinedCommentForHigherTrust, redactQuarantinedBodyForHigherTrust } from "./source-trust.js";
import { captureNativeTaskWakeSource, type NativeConsumedSourceComponent, type NativeModelOutputCapture,
  type NativePayloadSourceSet } from "./native-runtime/native-execution-input.js";
import { captureNativeExecutionStageTaskWakeSource } from "./native-stage-wake-source.js";
import { isCurrentConversationModelRoot } from "./native-runtime/worker-conversation-root.js";
import { issueTreeControlService, isVerifiedIssueTreeControlInteractionWake } from "./issue-tree-control.js";
import type { NativeToolEffectClaim } from "../agent-auth-jwt.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const NATIVE_SOURCE_VALIDATION_WORK_LIMIT = 2048;
type NativeDocumentSourceCurrentRow = { revision: typeof documentRevisions.$inferSelect; latestRevisionId: string | null;
  documentId: string; issueId: string };
interface NativeSourceReadAncestry { work: number; pendingTaskOwner: object; preparingTaskEffect: boolean;
  graphProofs: NativeSiblingToolSourceProofs; graphProofsDisabled: boolean;
activeByActor: Map<string, Set<string>>;
  frozenTaskProofStacks: Map<string, NativeSourceProofFrame[]> }
type NativeProofReaderSets = ReadonlyMap<string, NativeSourceGraphObligations["readerSets"][number]>;
interface NativeSourceProofFrame { visitKey: string; descendants: Set<string>; mutableSources: NativeMutableSourceDependencies;
  readerSelection?: { context: NativeSourceReadContext; sets: Map<string, NativeSourceGraphObligations["readerSets"][number]>; complete: boolean } }
type NativeCompletedTaskSourceProofs = Map<string, { key: string; descendants: Set<string>; mutableSources: NativeMutableSourceDependencies; readerSets?: NativeProofReaderSets }>;
export type NativeSiblingToolSourceProofs = Map<string, { descendants: Set<string>; mutableSources: NativeMutableSourceDependencies;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[]; requiredSets?: NativePayloadSourceSet[];
  validatedDepth?: number; readerObligations?: NativeSourceGraphObligationHandle; readerSets?: NativeProofReaderSets }>;
interface NativeRuntimeSkillRead { companyId: string; actor: AuthorizationActor;
  source: Extract<NativePayloadSourceInput, { kind: "runtime_skill" }>; runId: string }
interface NativeScopedTaskRead {
  companyId: string; actor: AuthorizationActor; issueId: string; contentHash: string; snapshotDigest: string;
  childHandle: NativeSourceGraphObligationHandle; mutableSources: NativeMutableSourceDependencies;
  pending?: NativePendingTaskRead;
  descendants?: Set<string>;
}
interface NativePendingTaskRead {
  owner: object;
  obligations: Omit<NativeSourceGraphObligations, "taskPins"> & {
    taskPins: ReadonlyArray<readonly [string, { contentHash: string; snapshotDigest: string }]>;
  };
  groups: Array<{ key: string; companyId: string; actor: AuthorizationActor; version: number;
    sets: Array<[string, { runId: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }]>;
    issueIds: string[]; memoryIds: string[] }>;
}
interface NativeSourceGraphObligations {
  actorKey: string;
  scopedTasks: NativeScopedTaskRead[];
  readerSets: Array<Parameters<typeof deferNativeSourceReaderCheck>[1]>;
  ownerReads: Array<{ companyId: string; actor: AuthorizationActor; issueIds: string[]; memoryIds: string[] }>;
  taskPins: NativeSourceReadScope["taskTemporalScopes"];
  analyticalReads: Array<{ companyId: string; actor: AuthorizationActor; issueIds: string[] }>;
  readResults: Array<Parameters<typeof deferNativeReadResultOwnerCheck>[1]>;
  runtimeSkills: NativeRuntimeSkillRead[];
}
export interface NativeSourceGraphObligationHandle {
  completed?: NativeSourceGraphObligations;
  unchecked?: { parent: NativeSourceReadContext; descriptor: NativeScopedTaskRead;
    pending: NativePendingTaskRead; memoryTemporalIdentity: string | null };
}

function newNativeMutableSources(): NativeMutableSourceDependencies { return { rows: new Map(), compatible: true }; }
function mergeNativeMutableSources(target: NativeMutableSourceDependencies, source: NativeMutableSourceDependencies) {
  if (!source.compatible) target.compatible = false;
  for (const [key, row] of source.rows) {
    const old = target.rows.get(key);
    if (old && old.digest !== row.digest) target.compatible = false;
    if (target.rows.size >= 512 && !target.rows.has(key)) { target.compatible = false; continue; }
    target.rows.set(key, row);
  }
}
function propagateNativeMutableSources(scope: NativeSourceReadScope, source: NativeMutableSourceDependencies) {
  for (const frame of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? [])
    mergeNativeMutableSources(frame.mutableSources, source);
}
function nativeMutableSourceRowDigest(family: NativeMutableSourceRowFamily, row: object): string {
  const value = row as typeof toolInvocations.$inferSelect;
  const data = family === "invocation" ? { id: value.id, companyId: value.companyId, agentId: value.agentId,
    runId: value.runId, issueId: value.issueId, toolName: value.toolName,
    idempotencyKey: value.idempotencyKey, status: value.status, resultHash: value.resultHash,
    argumentsHash: value.argumentsHash, workflowResultJson: value.workflowResultJson } : row;
  // These private change detectors are not canonical source/receipt hashes.
  // SQL rows have stable field order; order changes only force revalidation.
  // PostgreSQL infinity timestamps parse as invalid Dates: retain their old
  // representation instead of letting Date.toJSON collapse them to SQL NULL.
  if (Object.values(data).some(item => item instanceof Date && !Number.isFinite(item.getTime())))
    return nativeSha256(data);
  return createHash("sha256").update(JSON.stringify(data), "utf8").digest("hex");
}
function recordNativeMutableSourceRow(scope: NativeSourceReadScope, family: NativeMutableSourceRowFamily,
  companyId: string, row: object & { id: string }, reusePinnedObjectDigest = false) {
  const key = `${family}:${companyId}:${row.id}`;
  const prior = scope.currentMutableSourceRows.get(key);
  const digest = reusePinnedObjectDigest && prior?.row === row ? prior.digest : nativeMutableSourceRowDigest(family, row);
  const dependency: NativeMutableSourceRowDependency = { family, companyId, id: row.id, digest };
  scope.currentMutableSourceRows.set(key, { row, digest });
  propagateNativeMutableSources(scope, { rows: new Map([[key, dependency]]), compatible: true });
}
function nativeFrozenMutableProofMap(store: MemoryPageStructuralProofMemoStore, actorKey: string,
  memoryIdentity: string | null): Map<string, NativeMutableSourceDependencies> {
  if (!memoryIdentity) return new Map();
  const owners = store.mutableSourceProofsByOwnerPrefix ??= new Map();
  const key = nativeMemoryStructuralOwnerPrefixKey(actorKey, memoryIdentity);
  const existing = owners.get(key);
  if (existing) return existing;
  const created = new Map<string, NativeMutableSourceDependencies>();
  if (owners.size < 128) owners.set(key, created);
  return created;
}
async function nativeFrozenMutableSourcesCurrent(db: Db | Transaction, companyId: string,
  dependencies: NativeMutableSourceDependencies | undefined, scope: NativeSourceReadScope): Promise<boolean> {
  if (!dependencies?.compatible || !dependencies.rows.size || dependencies.rows.size > 512) return false;
  const pending: Record<NativeMutableSourceRowFamily, string[]> = { run: [], reservation: [], invocation: [], contract: [] };
  for (const [key, row] of dependencies.rows) {
    if (row.companyId !== companyId) return false;
    if (!scope.currentMutableSourceRows.has(key)) pending[row.family].push(row.id);
  }
  for (const family of ["run", "reservation", "invocation", "contract"] as const) {
    const ids = [...new Set(pending[family])];
    if (!ids.length) continue;
    const rows = family === "run" ? await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.id, ids))).for("share") :
      family === "reservation" ? await db.select().from(orchestrationModelReservations).where(and(
        eq(orchestrationModelReservations.companyId, companyId), inArray(orchestrationModelReservations.id, ids))).for("share") :
      family === "invocation" ? await db.select().from(toolInvocations).where(and(
        eq(toolInvocations.companyId, companyId), inArray(toolInvocations.id, ids))).for("share") :
      await db.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId),
        inArray(completionContracts.id, ids))).for("share");
    for (const row of rows) recordNativeMutableSourceRow(scope, family, companyId, row);
    if (rows.length !== ids.length) return false;
  }
  for (const [key, row] of dependencies.rows)
    if (scope.currentMutableSourceRows.get(key)?.digest !== row.digest) return false;
  return true;
}
function captureNativeSourceGraphObligations(context: NativeSourceReadContext, actorKey: string): NativeSourceGraphObligations | undefined {
  const sourceScope = context.scopes.get(actorKey);
  if (context.scopes.size !== 1 || !sourceScope) return undefined;
  const readerSets: NativeSourceGraphObligations["readerSets"] = [], ownerReads: NativeSourceGraphObligations["ownerReads"] = [];
  for (const group of context.deferredReaderChecks.values()) {
    if (nativeSha256(group.actor) !== actorKey) return undefined;
    for (const set of group.sets.values()) readerSets.push({ companyId: group.companyId, actor: group.actor, ...set });
    ownerReads.push({ companyId: group.companyId, actor: group.actor,
      issueIds: [...group.issueIds], memoryIds: [...group.memoryIds] });
  }
  const analyticalReads: NativeSourceGraphObligations["analyticalReads"] = [];
  for (const group of context.deferredAnalyticalTasks.values()) {
    if (nativeSha256(group.actor) !== actorKey) return undefined;
    analyticalReads.push({ companyId: group.companyId, actor: group.actor, issueIds: [...group.issueIds] });
  }
  const readResults = [...context.deferredReadResultChecks.values()];
  if (readResults.some(check => nativeSha256(check.actor) !== actorKey)) return undefined;
  const taskPins: NativeSourceReadScope["taskTemporalScopes"] = new Map();
  for (const [id, pin] of sourceScope.taskTemporalScopes) taskPins.set(id, { ...pin });
  const runtimeSkills = [...(context.runtimeSkillReads?.values() ?? [])];
  if (runtimeSkills.some(check => nativeSha256(check.actor) !== actorKey)) return undefined;
  const scopedTasks = [...context.scopedTaskReads.values()];
  if (scopedTasks.some(check => nativeSha256(check.actor) !== actorKey)) return undefined;
  return { actorKey, readerSets, ownerReads, taskPins, analyticalReads, readResults, runtimeSkills, scopedTasks };
}
function completeNativeSourceGraphObligations(context: NativeSourceReadContext, actorKey: string): NativeSourceGraphObligations | undefined {
  const snapshot = captureNativeSourceGraphObligations(context, actorKey);
  return snapshot && snapshot.scopedTasks.every(check => !check.pending && check.childHandle.completed) ? snapshot : undefined;
}
function nativePendingTaskQueuesArePure(snapshot: Omit<NativeSourceGraphObligations, "taskPins">,
  companyId: string, actorKey: string): boolean {
  const pureKinds = new Set<NativePayloadSourceInput["kind"]>(["task", "runtime_instructions", "workspace_metadata",
    "worker_model_dispatch", "conversation_model_dispatch", "tool_result", "completion_contract", "document_revision"]);
  return snapshot.actorKey === actorKey && [...snapshot.readerSets, ...snapshot.ownerReads].every(check =>
    check.companyId === companyId && nativeSha256(check.actor) === actorKey) && snapshot.analyticalReads.length === 0 && snapshot.readResults.length === 0 && snapshot.runtimeSkills.length === 0 &&
    snapshot.scopedTasks.length === 0 && snapshot.ownerReads.every(group => group.memoryIds.length === 0) &&
    snapshot.readerSets.every(set => set.policy.memoryIds.length === 0 && set.policy.projectIds.length === 0 &&
      set.policy.foundationRevisionIds.length === 0 && set.inputs.every(source => pureKinds.has(source.kind)));
}
function nativeSourceEffectBarrierActive(context: NativeSourceReadContext): boolean {
  for (let current: NativeSourceReadContext | undefined = context; current; current = current.parentContext)
    if (current.ancestry.preparingTaskEffect) return true;
  return false;
}
function nativePendingTaskCanAdopt(scope: NativeSourceReadScope, pending: NativePendingTaskRead, companyId: string): boolean {
  const context = scope.context;
  return pending.owner === context.ancestry.pendingTaskOwner && !context.ancestry.graphProofsDisabled &&
    nativePendingTaskQueuesArePure(pending.obligations, companyId, scope.actorKey) && context.deferredReaderChecks.size === 0 &&
    context.deferredReadResultChecks.size === 0 && context.deferredAnalyticalTasks.size === 0 &&
    context.scopedTaskReads.size === 0 && !context.runtimeSkillReads?.size && scope.taskTemporalScopes.size === 0;
}
function freezeNativePendingTaskData(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Map) for (const [key, item] of value) {
    freezeNativePendingTaskData(key, seen); freezeNativePendingTaskData(item, seen);
  }
  else for (const item of Object.values(value)) freezeNativePendingTaskData(item, seen);
  Object.freeze(value);
}
function adoptNativePendingTaskQueues(scope: NativeSourceReadScope, pending: NativePendingTaskRead): void {
  // This continues the SAME privately owned validation. Its source nodes were
  // already charged when queued. Transfer only unchecked obligations/pins;
  // current rows, checked sets and reader outcomes stay fresh in this scope.
  const data = structuredClone({ obligations: pending.obligations, groups: pending.groups });
  if (nativeSourceMemoDiagnosticsEnabled()) nativeSourceMemoDiagnostics.pendingTaskAdoptions += 1;
  for (const group of data.groups) {
    scope.context.deferredReaderChecks.set(group.key, { companyId: group.companyId, actor: group.actor,
      version: group.version, sets: new Map(group.sets), issueIds: new Set(group.issueIds), memoryIds: new Set(group.memoryIds) });
    scope.context.pendingReaderChecks.add(group.key);
  }
  for (const [id, pin] of data.obligations.taskPins) scope.taskTemporalScopes.set(id, pin);
}
async function replayNativeUncheckedTaskReaders(scope: NativeSourceReadScope,
  handle: NativeSourceGraphObligationHandle | undefined, companyId: string): Promise<boolean> {
  const unchecked = handle?.unchecked;
  if (!unchecked) return false;
  const { parent, descriptor, pending, memoryTemporalIdentity } = unchecked;
  const key = nativeScopedTaskReadKey(descriptor);
  const stillOwned = () => parent.active && parent.db === scope.context.db &&
    parent.ancestry === scope.context.ancestry && !parent.flushingReaders && !scope.context.flushingReaders &&
    !parent.ancestry.graphProofsDisabled && !nativeSourceEffectBarrierActive(scope.context) &&
    pending.owner === scope.context.ancestry.pendingTaskOwner && descriptor.pending === pending &&
    parent.scopedTaskReads.get(key) === descriptor && parent.pendingScopedTaskReads.has(key) &&
    !parent.activeScopedTaskReads.has(key) && descriptor.companyId === companyId &&
    nativeSha256(descriptor.actor) === scope.actorKey && memoryTemporalIdentity !== null &&
    memoryTemporalIdentity === scope.context.memoryTemporalIdentity &&
    memoryTemporalIdentity === activeMemoryTemporalReadScopeIdentity(scope.context.db as Db, descriptor.actor) &&
    nativePendingTaskQueuesArePure(pending.obligations, companyId, scope.actorKey);
  if (!stillOwned()) return false;
  // This is the original parent's unchecked continuation, never a completed
  // reader proof. Recheck its exact Task owner and prefix before replaying ALL
  // queues; the original descriptor remains queued for its own final drain.
  return withReadPinnedNativeTaskSnapshot(scope.context.db as Db, descriptor.actor, companyId, descriptor.issueId,
    async (hash, digest) => {
      if (hash !== descriptor.contentHash || digest !== descriptor.snapshotDigest ||
        activeMemoryTemporalReadScopeIdentity(scope.context.db as Db, descriptor.actor) !== memoryTemporalIdentity ||
        !await nativeSourceReaderHasCompanyAccess(scope.context.db as Db, companyId, descriptor.actor) || !stillOwned()) return false;
      const replayed = await replayNativeSourceGraphObligations(scope,
        { ...pending.obligations, taskPins: new Map(pending.obligations.taskPins) });
      if (replayed && nativeSourceMemoDiagnosticsEnabled()) nativeSourceMemoDiagnostics.uncheckedTaskReplays += 1;
      return replayed;
    });
}
async function replayNativeSourceGraphObligations(scope: NativeSourceReadScope, obligations: NativeSourceGraphObligations,
  readerSets?: NativeProofReaderSets): Promise<boolean> {
  if (scope.actorKey !== obligations.actorKey ||
    [...obligations.readerSets, ...(readerSets?.values() ?? []), ...obligations.ownerReads, ...obligations.analyticalReads,
      ...obligations.readResults, ...obligations.runtimeSkills, ...obligations.scopedTasks].some(check => nativeSha256(check.actor) !== scope.actorKey)) return false;
  for (const [id, pin] of obligations.taskPins) {
    const current = scope.taskTemporalScopes.get(id);
    if (current && (current.contentHash !== pin.contentHash || current.snapshotDigest !== pin.snapshotDigest)) return false;
  }
  for (const check of obligations.runtimeSkills)
    await assertNativeDocumentRuntimeSkillCurrent(scope.context.db as Db, check.companyId, check.actor, check.source, check.runId);
  for (const [id, pin] of obligations.taskPins) scope.taskTemporalScopes.set(id, pin);
  for (const check of obligations.scopedTasks) deferNativeScopedTaskRead(scope, check);
  for (const set of readerSets?.values() ?? obligations.readerSets) deferNativeSourceReaderCheck(scope, set);
  for (const owner of obligations.ownerReads) deferNativeSourceOwnerReaderChecks(scope, owner);
  for (const group of obligations.analyticalReads) deferNativeAnalyticalTaskChecks(scope, group.companyId, group.actor, group.issueIds);
  for (const result of obligations.readResults) deferNativeReadResultOwnerCheck(scope, result);
  return true;
}
function markNativeProofReaderSelectionIncomplete(scope: NativeSourceReadScope): void {
  for (const frame of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? []) {
    if (!frame.readerSelection) continue;
    frame.readerSelection.complete = false;
    frame.readerSelection.sets.clear();
  }
}
function excludeUnpinnedNativeSourceProofs(scope: NativeSourceReadScope,
  policy: NativePayloadSourcePolicy, inputs: NativePayloadSourceInput[]): void {
  if (nativeGraphProofInputsEligible(policy, inputs)) return;
  // These owners are not all pinned or represented by dependency/reader
  // replay. No enclosing local or shared proof may skip their current checks.
  markNativeSourceProofsIncompatible(scope);
}
function markNativeSourceProofsIncompatible(scope: NativeSourceReadScope): void {
  for (const stack of scope.context.ancestry.frozenTaskProofStacks.values())
    for (const frame of stack) frame.mutableSources.compatible = false;
}
function recordNativeProofReaderSet(scope: NativeSourceReadScope, key: string,
  set: NativeSourceGraphObligations["readerSets"][number]): void {
  excludeUnpinnedNativeSourceProofs(scope, set.policy, set.inputs);
  for (const frame of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? []) {
    const selection = frame.readerSelection;
    if (!selection?.complete) continue;
    if (selection.context !== scope.context || !selection.sets.has(key) && selection.sets.size >= 512) {
      selection.complete = false;
      selection.sets.clear();
    } else selection.sets.set(key, set);
  }
}
function recordNativeProofReaderSetUse(scope: NativeSourceReadScope, sets: NativeProofReaderSets | undefined): void {
  if (!sets) { markNativeProofReaderSelectionIncomplete(scope); return; }
  for (const [key, set] of sets) recordNativeProofReaderSet(scope, key, set);
}
function recordNativeRuntimeSkillRead(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  source: NativeRuntimeSkillRead["source"], runId: string) {
  const context = nativeSourceReadScopes.getStore();
  if (!context?.active || context.db !== (db as object)) return;
  const reads = context.runtimeSkillReads ??= new Map();
  const key = nativeSha256({ companyId, actor, source, runId });
  if (!reads.has(key) && reads.size >= 512) throw forbidden("Native runtime Skill reader checks exceed their bound");
  reads.set(key, { companyId, actor, source: { ...source }, runId });
}
function disableNativeSourceGraphCheckpoints(scope: NativeSourceReadScope): void {
  // Same-transaction writes can change owner families beyond the four mutable
  // receipt dependencies. Never retain checkpoints across an effect boundary.
  disableMemorySourceGraphReadCheckpoints();
  scope.context.ancestry.graphProofsDisabled = true;
  scope.context.ancestry.graphProofs.clear();
}
async function withNativeSourceGraphProof(scope: NativeSourceReadScope, proofs: NativeSiblingToolSourceProofs,
  key: string, input: { companyId: string; runId: string; actor: AuthorizationActor;
    policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }, read: () => Promise<void>,
  historicalDocumentDepthHint = 0, deferSourceSetReader = true): Promise<void> {
  if (scope.active.has(key)) throw forbidden("The Native source graph contains a cycle");
  const eligible = nativeGraphProofInputsEligible(input.policy, input.inputs);
  let proof = eligible && !scope.context.ancestry.graphProofsDisabled ? proofs.get(key) : undefined;
  if (proof && !proof.mutableSources.compatible) proof = undefined;
  // Only internal validation before any effect-capable callback may share a
  // completed checkpoint. Callback-free Memory reviews may seal several exact
  // owner contexts on this same transaction; separate roots retain fresh state.
  const ancestryLedger = !scope.context.ancestry.graphProofsDisabled && is(scope.context.db, PgTransaction)
    ? scope.context.ancestry.graphProofs : undefined;
  const memoryLedger = ancestryLedger ? activeMemorySourceGraphReadLedger(scope.context.db) : undefined;
  const readPassKey = JSON.stringify([key, historicalDocumentDepthHint]);
  const ownObligations = ancestryLedger ? (scope.context.readerObligations ??= {}) : undefined;
  if (!proof && eligible) {
    // A completed checkpoint inside a Memory pass remains available to its
    // still-active outer validation. An incomplete preferred entry cannot
    // hide an independently completed checkpoint in the other store.
    for (const retained of [memoryLedger?.get(readPassKey), ancestryLedger?.get(readPassKey)]) {
      const sameContext = retained?.readerObligations !== undefined && retained.readerObligations === ownObligations;
      const obligations = retained?.readerObligations?.completed;
      if (retained && (sameContext || obligations || retained.readerObligations?.unchecked) &&
        !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, retained.descendants) &&
        await nativeFrozenMutableSourcesCurrent(scope.context.db as Db, input.companyId, retained.mutableSources, scope) &&
        (sameContext || (obligations ? await replayNativeSourceGraphObligations(scope, obligations, retained.readerSets) :
          await replayNativeUncheckedTaskReaders(scope, retained.readerObligations, input.companyId)))) {
        proof = retained;
        break;
      }
    }
  }
  let stack = scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey);
  if (!stack) {
    stack = [];
    scope.context.ancestry.frozenTaskProofStacks.set(scope.actorKey, stack);
  }
  if (proof && !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, proof.descendants)) {
    nativeSourceReadWork(scope);
    recordNativeProofReaderSetUse(scope, proof.readerSets);
    if (deferSourceSetReader) deferNativeSourceReaderCheck(scope, input);
    else {
      // Owner-only nodes already registered their exact readers. A repeated
      // use after a flush must still schedule those current checks again.
      const readerKey = `${input.companyId}:${nativeSha256(input.actor)}`;
      if (scope.context.deferredReaderChecks.has(readerKey) && !scope.context.activeReaderChecks.has(readerKey))
        scope.context.pendingReaderChecks.add(readerKey);
    }
    propagateNativeMutableSources(scope, proof.mutableSources);
    for (const parent of stack) addNativeFrozenTaskDescendantClosure(parent.descendants, key, proof.descendants);
    return;
  }
  addNativeSourceActiveVisit(scope, key);
  const frame: NativeSourceProofFrame = { visitKey: key, descendants: new Set<string>(), mutableSources: newNativeMutableSources(),
    readerSelection: { context: scope.context, sets: new Map(), complete: true } };
  stack.push(frame);
  let completed = false;
  try {
    await read();
    completed = true;
  } finally {
    scope.active.delete(key);
    if (stack.at(-1) === frame) stack.pop();
    if (completed) {
      if (eligible) {
        const completedProof = { descendants: frame.descendants, mutableSources: frame.mutableSources,
          policy: input.policy, inputs: input.inputs, ...(ownObligations ? { readerObligations: ownObligations } : {}),
          ...(frame.readerSelection?.complete ? { readerSets: new Map(frame.readerSelection.sets) } : {}) };
        if (proofs.size < 512) proofs.set(key, completedProof);
        if (ancestryLedger && !scope.context.ancestry.graphProofsDisabled && ancestryLedger.size < 512)
          ancestryLedger.set(readPassKey, completedProof);
        if (memoryLedger && !scope.context.ancestry.graphProofsDisabled &&
          activeMemorySourceGraphReadLedger(scope.context.db) === memoryLedger && memoryLedger.size < 512)
          memoryLedger.set(readPassKey, completedProof);
      }
      for (const parent of stack) addNativeFrozenTaskDescendantClosure(parent.descendants, key, frame.descendants);
    }
  }
}
function nativeGraphProofInputsEligible(policy: NativePayloadSourcePolicy, inputs: NativePayloadSourceInput[]): boolean {
  return policy.projectIds.length === 0 && policy.foundationRevisionIds.length === 0 && !inputs.some(source =>
    source.kind === "authored_definition" || source.kind === "skill_version" ||
    source.kind === "playbook_revision" || source.kind === "role_pack_version" ||
    source.kind === "foundation_revision" || source.kind === "attachment" ||
    source.kind === "project" || source.kind === "project_workspace" ||
    source.kind === "tool_result" && (source.toolName === "create_project" || source.toolName === "call_api"));
}
// Every active recursive owner participates in structural proof ancestry.
function addNativeSourceActiveVisit(scope: NativeSourceReadScope, key: string): void {
  for (const frame of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? [])
    frame.descendants.add(key);
  scope.active.add(key);
}
interface NativeSourceReadPinnedRows {
  runs: Map<string, typeof heartbeatRuns.$inferSelect | null>;
  reservations: Map<string, typeof orchestrationModelReservations.$inferSelect | null>;
  documentSources: Map<string, NativeDocumentSourceCurrentRow>;
  documentParentTasks: Map<string, { id: string; companyId: string }>;
}
function nativeSourceReadPinnedRowsForActor(db: Db | Transaction, actor: AuthorizationActor,
  rowScope?: MemoryNativeSourceRowsScope): NativeSourceReadPinnedRows {
  const actorKey = nativeSha256(actor);
  if (rowScope?.transaction === (db as object)) {
    const existing = rowScope.byActor.get(actorKey);
    if (existing && typeof existing === "object") return existing as NativeSourceReadPinnedRows;
    if (rowScope.byActor.size < 128) {
      const created: NativeSourceReadPinnedRows = { runs: new Map(), reservations: new Map(),
        documentSources: new Map(), documentParentTasks: new Map() };
      rowScope.byActor.set(actorKey, created);
      return created;
    }
  }
  return { runs: new Map(), reservations: new Map(), documentSources: new Map(), documentParentTasks: new Map() };
}
interface NativeSourceReadContext { db: object; memoryTemporalIdentity: string | null;
  parentContext?: NativeSourceReadContext; flushingReaders: boolean;
  ancestry: NativeSourceReadAncestry; scopes: Map<string, NativeSourceReadScope>;
  memoryStructuralProofMemoStore: MemoryPageStructuralProofMemoStore;
  pinnedRowsActorKey: string; pinnedRows: NativeSourceReadPinnedRows;
  privacyLockedCompanies: Set<string>; active: boolean;
  readerObligations?: NativeSourceGraphObligationHandle;
  runtimeSkillReads?: Map<string, NativeRuntimeSkillRead>;
  deferredReaderChecks: Map<string, { companyId: string; actor: AuthorizationActor; version: number;
    sets: Map<string, { runId: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }>;
    issueIds: Set<string>; memoryIds: Set<string> }>;
  deferredAnalyticalTasks: Map<string, { companyId: string; actor: AuthorizationActor; issueIds: Set<string>;
    checkedIssueIds: Set<string> }>;
  deferredReadResultChecks: Map<string, { companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
    tool: "get_task_context" | "get_task_history" | "read_chat_attachment" | "query_business_metric"; sourceSet: NativePayloadSourceSet; resultDigest?: string }>;
  checkedReadResultChecks: Set<string>;
  scopedTaskReads: Map<string, NativeScopedTaskRead>; pendingScopedTaskReads: Set<string>; activeScopedTaskReads: Set<string>;
  pendingReaderChecks: Set<string>; activeReaderChecks: Set<string> }
type NativePendingTransitionContext = import("./native-runtime/native-interaction-bridge.js").NativeHistoricalPendingTransitionContext;
type NativeHistoricalPendingTransitionContext = {
  pending?: NativePendingTransitionContext;
  stageBodyReads?: Array<{producer:import("./native-stage-task-body-source.js").NativeFinalizedStageTaskBodyRead;
    edgeKind:"model_output"|"retained_run"|"finalized_summary"|"stage_action";edgeDigest:string}>;
  stageReads?: Array<{ producer: import("./native-stage-wake-source.js").NativeFinalizedStageConsumption;
    edgeKind: "model_output" | "retained_run" | "finalized_summary" | "stage_action"; edgeDigest: string }>;
};
interface NativeSourceReadScope { context: NativeSourceReadContext; actorKey: string; pinnedRows: NativeSourceReadPinnedRows;
  active: Set<string>; completedImmutableSourceLeafProofs: Set<string>;
  frozenTaskSnapshots: Map<string, Set<string>>;
  frozenTaskMutableSources: Map<string, NativeMutableSourceDependencies>;
  currentMutableSourceRows: Map<string, { readonly row: object; readonly digest: string }>;
  taskTemporalScopes: Map<string, { contentHash: string; snapshotDigest: string }>;
  conversationRootComments: Set<string>;
  deferredReaderSets: Map<string, { companyId: string; runId: string; policy: NativePayloadSourcePolicy;
    inputs: NativePayloadSourceInput[] }> }
/** Read-only structural Task proofs retained only by one bounded Memory page.
 * The exact transaction, actor and active Memory owner prefix are rechecked at
 * every use; live reader authority is still flushed by the owning Native scope.
 * Recursive work and cycle ancestry stay on the active Native scope and are
 * never carried forward with completed page proofs. */
export interface NativeMemoryPageStructuralProofMemo {
  readonly transaction: object;
  readonly actorKey: string;
  readonly memoryTemporalIdentity: string;
  readonly frozenTaskSnapshots: Map<string, Set<string>>;
  readonly structuralProofMemoStore: MemoryPageStructuralProofMemoStore;
}
export function nativeFrozenTaskMemoWouldIntersectActiveAncestry(active: ReadonlySet<string>,
  descendants: ReadonlySet<string>): boolean {
  for (const descendant of descendants) if (active.has(descendant)) return true;
  return false;
}
export function addNativeFrozenTaskDescendantClosure(target: Set<string>, visitKey: string,
  descendants: ReadonlySet<string>): void {
  target.add(visitKey);
  for (const descendant of descendants) target.add(descendant);
}
/** Fail closed when exact consumed-source component markers form a cycle. */
export function nativeConsumedSourceComponentsContainCycle(dependencies: readonly (readonly number[])[]): boolean {
  const state = new Uint8Array(dependencies.length);
  const visit = (node: number): boolean => {
    if (!Number.isInteger(node) || node < 0 || node >= dependencies.length) return true;
    if (state[node] === 1) return true;
    if (state[node] === 2) return false;
    state[node] = 1;
    for (const dependency of dependencies[node] ?? []) if (visit(dependency)) return true;
    state[node] = 2;
    return false;
  };
  for (let node = 0; node < dependencies.length; node += 1) if (visit(node)) return true;
  return false;
}
const nativeSourceReadScopes = new AsyncLocalStorage<NativeSourceReadContext>();
const nativeSourceMemoDiagnostics = {
  maxValidationWork: 0,
  pendingTaskCaptures: 0, pendingTaskAdoptions: 0, uncheckedTaskReplays: 0,
  siblingToolSourceProofHits: 0, documentNodeHits: 0,
  frozenTaskMemoByKind: {} as Record<string,
  { eligibleCalls: number; ineligibleCalls: number; hits: number; misses: number }> };
function nativeSourceMemoDiagnosticsEnabled() { return process.env.PAPERCLIP_NATIVE_SOURCE_MEMO_DIAGNOSTICS === "1"; }
function nativeSourceMemoRecordFrozenTask(inputs: NativePayloadSourceInput[], event: "eligible" | "ineligible" | "hit" | "miss") {
  if (!nativeSourceMemoDiagnosticsEnabled()) return;
  for (const source of inputs) {
    const stats = nativeSourceMemoDiagnostics.frozenTaskMemoByKind[source.kind] ??=
      { eligibleCalls: 0, ineligibleCalls: 0, hits: 0, misses: 0 };
    const key = event === "eligible" ? "eligibleCalls" : event === "ineligible" ? "ineligibleCalls" : event === "hit" ? "hits" : "misses";
    stats[key] = Math.min(1_000_000, stats[key] + 1);
  }
}
export function resetNativeSourceMemoDiagnosticsForTest() {
  nativeSourceMemoDiagnostics.maxValidationWork = 0;
  nativeSourceMemoDiagnostics.frozenTaskMemoByKind = {};
  nativeSourceMemoDiagnostics.pendingTaskCaptures = 0;
  nativeSourceMemoDiagnostics.pendingTaskAdoptions = 0;
  nativeSourceMemoDiagnostics.uncheckedTaskReplays = 0;
  nativeSourceMemoDiagnostics.siblingToolSourceProofHits = 0;
  nativeSourceMemoDiagnostics.documentNodeHits = 0;

}
export function nativeSourceMemoDiagnosticsForTest() { return structuredClone(nativeSourceMemoDiagnostics); }
function createNativeSourceReadAncestry(): NativeSourceReadAncestry {
  return { work: 0, pendingTaskOwner: {}, preparingTaskEffect: false, graphProofs: new Map(), graphProofsDisabled: false,
    activeByActor: new Map(),
    frozenTaskProofStacks: new Map() };
}
function nativeSourceReadWork(scope: NativeSourceReadScope) {
  if (++scope.context.ancestry.work > NATIVE_SOURCE_VALIDATION_WORK_LIMIT)
    throw forbidden("The Native source graph exceeds its total-work bound");
}

function mergeNativeFrozenTaskProofMaps(target: Map<string, Set<string>>, source: Map<string, Set<string>>) {
  for (const [key, descendants] of source) {
    let retained = target.get(key);
    if (!retained) { retained = new Set(); target.set(key, retained); }
    for (const descendant of descendants) retained.add(descendant);
  }
}
function nativeMemoryStructuralOwnerPrefixKey(actorKey: string, memoryTemporalIdentity: string) {
  return createHash("sha256").update(JSON.stringify({ actorKey, memoryTemporalIdentity }), "utf8").digest("hex");
}
function memoryStructuralProofMapForScope(store: MemoryPageStructuralProofMemoStore, db: Db | Transaction,
  actorKey: string, memoryTemporalIdentity: string | null, preferred?: Map<string, Set<string>>) {
  if (store.transaction !== (db as object) || !memoryTemporalIdentity) return undefined;
  const ownerPrefixKey = nativeMemoryStructuralOwnerPrefixKey(actorKey, memoryTemporalIdentity);
  const existing = store.proofsByOwnerPrefix.get(ownerPrefixKey);
  const selected = preferred ?? existing ?? (store.proofsByOwnerPrefix.size < 128 ? new Map<string, Set<string>>() : undefined);
  if (!selected) return undefined;
  if (existing && existing !== selected) mergeNativeFrozenTaskProofMaps(selected, existing);
  if (store.proofsByOwnerPrefix.has(ownerPrefixKey) || store.proofsByOwnerPrefix.size < 128)
    store.proofsByOwnerPrefix.set(ownerPrefixKey, selected);
  return selected;
}
function nativeSourceReadScope(db: Db | Transaction, actor: AuthorizationActor,
  ancestry?: NativeSourceReadAncestry, memoryStructuralProofMemoStore?: MemoryPageStructuralProofMemoStore,
  preferredProofs?: Map<string, Set<string>>, preferredPinnedRows?: NativeSourceReadPinnedRows): NativeSourceReadScope {
  const memoryTemporalIdentity = activeMemoryTemporalReadScopeIdentity(db, actor);
  const actorKey = nativeSha256(actor);
  const structuralStore: MemoryPageStructuralProofMemoStore = memoryStructuralProofMemoStore?.transaction === (db as object)
    ? memoryStructuralProofMemoStore
    : { transaction: db as object, proofsByOwnerPrefix: new Map<string, Map<string, Set<string>>>() };
  const pinnedRows = preferredPinnedRows ?? nativeSourceReadPinnedRowsForActor(db, actor,
    activeMemoryNativeSourceRowsScope(db, actor));
  const ownerPrefixProofs = memoryStructuralProofMapForScope(structuralStore, db, actorKey, memoryTemporalIdentity, preferredProofs);
  const readAncestry = ancestry ?? createNativeSourceReadAncestry();
  const context: NativeSourceReadContext = { db: db as object, memoryTemporalIdentity, flushingReaders: false,
    ancestry: readAncestry,
    // Nested source-owner prefixes share only this bounded transaction-local
    // container. Its entries remain keyed by exact actor and Memory prefix;
    // Native contexts, work ancestry, and deferred live-ACL flushes stay isolated.
    memoryStructuralProofMemoStore: structuralStore,
    pinnedRowsActorKey: actorKey, pinnedRows,
    scopes: new Map(), deferredReaderChecks: new Map(),
    deferredAnalyticalTasks: new Map(),
    deferredReadResultChecks: new Map(), checkedReadResultChecks: new Set(),
    scopedTaskReads: new Map(), pendingScopedTaskReads: new Set(), activeScopedTaskReads: new Set(),
    pendingReaderChecks: new Set(), activeReaderChecks: new Set(),
    privacyLockedCompanies: new Set(), active: true };
  let active = context.ancestry.activeByActor.get(actorKey);
  if (!active) { active = new Set(); context.ancestry.activeByActor.set(actorKey, active); }
  const scope: NativeSourceReadScope = { context, actorKey, pinnedRows, active, completedImmutableSourceLeafProofs: new Set(),
    frozenTaskMutableSources: nativeFrozenMutableProofMap(structuralStore, actorKey, memoryTemporalIdentity), currentMutableSourceRows: new Map(),
    frozenTaskSnapshots: ownerPrefixProofs ?? new Map(), taskTemporalScopes: new Map(), conversationRootComments: new Set(), deferredReaderSets: new Map() };
  context.scopes.set(scope.actorKey, scope);
  return scope;
}
function nativeManagedConsumedTaskSourceProofKey(companyId: string, actor: AuthorizationActor,
  source: Extract<NativePayloadSourceInput, { kind: "task" }>, snapshotDigest: string, memoryTemporalIdentity: string | null) {
  return nativeSha256({ phase: "managed-consumed-direct-component-task", companyId, actor, source, snapshotDigest,
    memoryTemporalIdentity });
}
function nativeManagedConsumedTaskSourceProofIdentity(companyId: string, actor: AuthorizationActor,
  source: Extract<NativePayloadSourceInput, { kind: "task" }>, memoryTemporalIdentity: string | null) {
  return nativeSha256({ phase: "managed-consumed-direct-component-task", companyId, actor, source, memoryTemporalIdentity });
}
// Reuse only raw rows pinned by FOR SHARE inside this physical source-read
// transaction. Callers continue checking their own bindings and permissions.
async function nativeSourceReadRun(db: Db | Transaction, companyId: string, runId: string,
  scope: NativeSourceReadScope): Promise<typeof heartbeatRuns.$inferSelect | null> {
  const key = `${companyId}:${runId}`;
  if (scope.pinnedRows.runs.has(key)) {
    const cached = scope.pinnedRows.runs.get(key) ?? null;
    if (cached) recordNativeMutableSourceRow(scope, "run", companyId, cached, true);
    return cached;
  }
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
    eq(heartbeatRuns.id, runId))).for("share");
  if (run) { scope.pinnedRows.runs.set(key, run); recordNativeMutableSourceRow(scope, "run", companyId, run); }
  return run ?? null;
}
async function nativeSourceReadReservation(db: Db | Transaction, companyId: string, reservationId: string,
  scope: NativeSourceReadScope): Promise<typeof orchestrationModelReservations.$inferSelect | null> {
  const key = `${companyId}:${reservationId}`;
  if (scope.pinnedRows.reservations.has(key)) {
    const cached = scope.pinnedRows.reservations.get(key) ?? null;
    if (cached) recordNativeMutableSourceRow(scope, "reservation", companyId, cached, true);
    return cached;
  }
  const [reservation] = await db.select().from(orchestrationModelReservations).where(and(
    eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.id, reservationId))).for("share");
  if (reservation) { scope.pinnedRows.reservations.set(key, reservation); recordNativeMutableSourceRow(scope, "reservation", companyId, reservation); }
  return reservation ?? null;
}
// These are exactly the current-reader and workspace checks consumed by the
// final grouped pass. Receipt membership, source bodies and temporal bindings
// remain validated against the original full source sets before deferral.
function nativeFinalSourceReaderChecks(set: { runId: string; policy: NativePayloadSourcePolicy;
  inputs: NativePayloadSourceInput[] }) {
  const unique = (ids: string[]) => [...new Set(ids)].sort();
  const sources = set.inputs;
  return {
    projectIds: unique([...set.policy.projectIds, ...sources.flatMap(source =>
      source.kind === "project" || source.kind === "project_workspace" ? [source.projectId] : [])]),
    issueIds: unique([...set.policy.issueIds, ...sources.flatMap(source => source.kind === "task" ? [source.issueId] : [])]),
    memoryIds: unique([...set.policy.memoryIds, ...sources.flatMap(source => source.kind === "memory" ? [source.memoryId] : [])]),
    foundationRevisionIds: unique([...set.policy.foundationRevisionIds, ...sources.flatMap(source =>
      source.kind === "foundation_revision" ? [source.revisionId] : [])]),
    runIds: unique([...set.policy.runIds, ...sources.flatMap(source =>
      source.kind === "workspace_metadata" || source.kind === "worker_model_dispatch" ||
      source.kind === "conversation_model_dispatch" || source.kind === "native_task_wake" ||
      source.kind === "tool_result" || source.kind === "retained_run" ? [source.runId] : [])]),
    contextIds: unique(sources.flatMap(source => source.kind === "context" ? [source.manifestId] : [])),
    runtimeInstructions: unique(sources.flatMap(source => source.kind === "runtime_instructions"
      ? [nativeSha256({ runId: set.runId, source })] : [])),
    workspaceSources: unique(sources.flatMap(source => source.kind === "workspace_metadata" ? [nativeSha256(source)] : [])),
  };
}
function deferNativeSourceReaderCheck(scope: NativeSourceReadScope, input: {
  companyId: string; runId: string; actor: AuthorizationActor; policy: NativePayloadSourcePolicy;
  inputs: NativePayloadSourceInput[];
}) {
  const key = `${input.companyId}:${nativeSha256(input.actor)}`;
  let pending = scope.context.deferredReaderChecks.get(key);
  if (!pending) {
    pending = { companyId: input.companyId, actor: input.actor, version: 0, sets: new Map(), issueIds: new Set(), memoryIds: new Set() };
    scope.context.deferredReaderChecks.set(key, pending);
  }
  const set = { runId: input.runId, policy: input.policy, inputs: input.inputs };
  const checks = nativeFinalSourceReaderChecks(set);
  const setKey = nativeSha256(checks);
  // Proof provenance retains the complete original identity even when the
  // final reader queue already has an equivalent set of current checks.
  recordNativeProofReaderSet(scope, `${key}:${nativeSha256(set)}`, { companyId: input.companyId, actor: input.actor, ...set });
  const alreadyQueued = pending.sets.has(setKey) || pending.sets.size > 0 && (() => {
    const queued = [...pending.sets.values()].map(nativeFinalSourceReaderChecks);
    return (Object.keys(checks) as (keyof typeof checks)[]).every(kind =>
      checks[kind].every(value => queued.some(existing => existing[kind].includes(value))));
  })();
  if (!alreadyQueued) {
    nativeSourceReadWork(scope);
    if (pending.sets.size >= 512) throw forbidden("The Native source reader recheck exceeds its work bound");
    pending.sets.set(setKey, set);
    pending.version += 1;
    scope.context.pendingReaderChecks.add(key);
  } else if (!scope.context.activeReaderChecks.has(key)) {
    // Coverage records pending obligations, never an authorization result.
    // After a prior flush, even a covered subset schedules a fresh pass; an
    // active grouped pass already covers every known obligation for this actor.
    scope.context.pendingReaderChecks.add(key);
  }
}
function deferNativeSourceOwnerReaderChecks(scope: NativeSourceReadScope, input: {
  companyId: string; actor: AuthorizationActor; issueIds?: Iterable<string>; memoryIds?: Iterable<string>;
}) {
  const key = `${input.companyId}:${nativeSha256(input.actor)}`;
  let pending = scope.context.deferredReaderChecks.get(key);
  if (!pending) {
    pending = { companyId: input.companyId, actor: input.actor, version: 0, sets: new Map(), issueIds: new Set(), memoryIds: new Set() };
    scope.context.deferredReaderChecks.set(key, pending);
  }
  let changed = false;
  for (const issueId of input.issueIds ?? []) if (!pending.issueIds.has(issueId)) {
    nativeSourceReadWork(scope);
    if (pending.issueIds.size >= 256) throw forbidden("The Native source issue reader recheck exceeds its work bound");
    pending.issueIds.add(issueId); changed = true;
  }
  for (const memoryId of input.memoryIds ?? []) if (!pending.memoryIds.has(memoryId)) {
    nativeSourceReadWork(scope);
    if (pending.memoryIds.size >= 256) throw forbidden("The Native source Memory reader recheck exceeds its work bound");
    pending.memoryIds.add(memoryId); changed = true;
  }
  if (changed) { pending.version += 1; scope.context.pendingReaderChecks.add(key); }
}
function deferNativeAnalyticalTaskChecks(scope: NativeSourceReadScope, companyId: string,
  actor: AuthorizationActor, issueIds: Iterable<string>) {
  const key = `${companyId}:${nativeSha256(actor)}`;
  let group = scope.context.deferredAnalyticalTasks.get(key);
  if (!group) {
    group = { companyId, actor, issueIds: new Set(), checkedIssueIds: new Set() };
    scope.context.deferredAnalyticalTasks.set(key, group);
  }
  for (const issueId of issueIds) {
    if (group.issueIds.has(issueId)) continue;
    nativeSourceReadWork(scope);
    if (group.issueIds.size >= 256) throw forbidden("The Native analytical Task recheck exceeds its work bound");
    group.issueIds.add(issueId);
  }
}
function deferNativeReadResultOwnerCheck(scope: NativeSourceReadScope, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  tool: "get_task_context" | "get_task_history" | "read_chat_attachment" | "query_business_metric"; sourceSet: NativePayloadSourceSet; resultDigest?: string;
}) {
  const key = nativeSha256(input);
  if (scope.context.deferredReadResultChecks.has(key)) return;
  nativeSourceReadWork(scope);
  if (scope.context.deferredReadResultChecks.size >= 512)
    throw forbidden("The Native read-result owner recheck exceeds its work bound");
  scope.context.deferredReadResultChecks.set(key, input);
}
function nativeScopedTaskReadKey(input: Pick<NativeScopedTaskRead,
  "companyId" | "actor" | "issueId" | "contentHash" | "snapshotDigest">): string {
  return `scoped-task-reader:${nativeSha256({ companyId: input.companyId, actor: input.actor,
    issueId: input.issueId, contentHash: input.contentHash, snapshotDigest: input.snapshotDigest })}`;
}
function deferNativeScopedTaskRead(scope: NativeSourceReadScope, input: NativeScopedTaskRead): void {
  const key = nativeScopedTaskReadKey(input);
  const groupKey = `${input.companyId}:${nativeSha256(input.actor)}`;
  if (!scope.context.scopedTaskReads.has(key)) {
    nativeSourceReadWork(scope);
    if (scope.context.scopedTaskReads.size >= 512) throw forbidden("The Native scoped Task recheck exceeds its work bound");
    scope.context.scopedTaskReads.set(key, input);
    scope.context.pendingScopedTaskReads.add(key);
    const group = scope.context.deferredReaderChecks.get(groupKey);
    if (group) { group.version += 1; scope.context.pendingReaderChecks.add(groupKey); }
  } else if (!scope.context.activeScopedTaskReads.has(key) && !scope.context.activeReaderChecks.has(groupKey)) {
    // A known immutable prefix remains an obligation. Reusing a proof after a
    // prior flush must reenter its exact scope and recheck current readers.
    scope.context.pendingScopedTaskReads.add(key);
  }
}
async function recheckNativeScopedTaskRead(scope: NativeSourceReadScope, input: NativeScopedTaskRead): Promise<void> {
  const key = nativeScopedTaskReadKey(input);
  const pending = input.pending;
  input.pending = undefined;
  if (scope.active.has(key)) throw forbidden("The Native scoped Task reader graph contains a cycle");
  nativeSourceReadWork(scope);
  addNativeSourceActiveVisit(scope, key);
  try {
    await withReadPinnedNativeTaskSnapshot(scope.context.db as Db, input.actor, input.companyId, input.issueId,
      async (hash, digest) => {
        if (hash !== input.contentHash || digest !== input.snapshotDigest)
          throw forbidden("The Native scoped Task source changed");
        await withNativeSourceReadScope(scope.context.db as Db, input.actor, input.companyId, async childScope => {
          childScope.context.readerObligations ??= input.childHandle;
          if (pending && nativePendingTaskCanAdopt(childScope, pending, input.companyId) && input.mutableSources.compatible &&
            await nativeFrozenMutableSourcesCurrent(childScope.context.db as Db, input.companyId, input.mutableSources, childScope)) {
            adoptNativePendingTaskQueues(childScope, pending);
            return;
          }
          const completed = input.childHandle.completed;
          if (!childScope.context.ancestry.graphProofsDisabled && completed && input.mutableSources.compatible &&
            await nativeFrozenMutableSourcesCurrent(childScope.context.db as Db, input.companyId, input.mutableSources, childScope) &&
            await replayNativeSourceGraphObligations(childScope, completed)) return;
          // Changed dependencies, incomplete metadata, and effect-disabled
          // ancestry retain the complete current-owner traversal.
          markNativeSourceProofsIncompatible(scope);
          await assertNativeTaskSnapshotOwnerCurrentInScope(childScope.context.db as Db, input.companyId,
            input.actor, input.issueId, childScope);
        });
      });
  } finally { scope.active.delete(key); }
}
async function drainNativeScopedTaskReads(context: NativeSourceReadContext, pendingOnly = false): Promise<void> {
  while (context.pendingScopedTaskReads.size) {
    const keys = [...context.pendingScopedTaskReads].filter(key => !pendingOnly || context.scopedTaskReads.get(key)?.pending);
    if (!keys.length) break;
    for (const key of keys) context.pendingScopedTaskReads.delete(key);
    for (const key of keys) {
      const check = context.scopedTaskReads.get(key);
      if (!check) continue;
      const scope = context.scopes.get(nativeSha256(check.actor));
      context.activeScopedTaskReads.add(key);
      try {
        if (scope) await recheckNativeScopedTaskRead(scope, check);
        else await withNativeSourceReadScope(context.db as Db, check.actor, check.companyId,
          actorScope => recheckNativeScopedTaskRead(actorScope, check));
      } finally { context.activeScopedTaskReads.delete(key); }
      const groupKey = `${check.companyId}:${nativeSha256(check.actor)}`;
      if (context.deferredReaderChecks.has(groupKey)) context.pendingReaderChecks.add(groupKey);
    }
  }
}
async function prepareNativeSourceEffectBoundary(scope: NativeSourceReadScope): Promise<void> {
  const contexts: NativeSourceReadContext[] = [];
  const seen = new Set<NativeSourceReadContext>();
  for (let context: NativeSourceReadContext | undefined = scope.context; context; context = context.parentContext) {
    if (!context.active || seen.has(context) || contexts.length >= 512)
      throw forbidden("The Native pending Task owner is unavailable");
    if (context.ancestry.preparingTaskEffect) throw forbidden("The Native pending Task check cannot enter an effect");
    seen.add(context);
    contexts.push(context);
  }
  const ancestries = new Set(contexts.map(context => context.ancestry));
  for (const ancestry of ancestries) ancestry.preparingTaskEffect = true;
  try {
    for (const context of contexts.reverse()) {
      // A foreign transaction/savepoint keeps this barrier link only. Its
      // ancestor's pending check still runs on that owner's own DB and actor.
      await drainNativeScopedTaskReads(context, true);
    }
  } finally { for (const ancestry of ancestries) ancestry.preparingTaskEffect = false; }
  disableNativeSourceGraphCheckpoints(scope);
  for (const ancestry of ancestries) {
    ancestry.graphProofsDisabled = true;
    ancestry.graphProofs.clear();
  }
}
async function flushNativeSourceReaderChecks(context: NativeSourceReadContext) {
  const wasFlushing = context.flushingReaders;
  context.flushingReaders = true;
  try {
  const checkedWorkspaceSources = new Set<string>();
  while (true) {
    // Finish all exact receipt/owner work and legacy graph walks before the
    // final current-reader pass. Those checks can wait on source rows, so an
    // ACL decision made before them would not be the final authorization.
    for (const [key, check] of context.deferredReadResultChecks) {
      if (context.checkedReadResultChecks.has(key)) continue;
      await assertNativeReadResultSourceSetOwnersCurrent(context.db as Db, check);
      context.checkedReadResultChecks.add(key);
    }
    // Legacy Task payloads still receive their complete retained-context walk.
    // Accumulate exact owner IDs during component validation and drain late
    // roots before the final current-reader pass.
    for (const group of context.deferredAnalyticalTasks.values()) {
      while (true) {
        const pendingIssueIds = [...group.issueIds].filter(issueId => !group.checkedIssueIds.has(issueId));
        if (!pendingIssueIds.length) break;
        await assertAnalyticalContextPayloadAccessBatch(context.db as Db, group.companyId, group.actor, pendingIssueIds,
          undefined, { privacyLockMode: "read" });
        for (const issueId of pendingIssueIds) group.checkedIssueIds.add(issueId);
      }
    }
    // Workspace currentness is independent of the reader actor. Gather the
    // exact tuples across actor groups and run the existing FOR SHARE owner
    // check once per company/source after all deferred owner checks, before
    // any final actor ACL decisions.
    const pendingWorkspaceSources = new Map<string, { companyId: string; source: Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }>; scope: NativeSourceReadScope }>();
    for (const group of context.deferredReaderChecks.values()) {
      const scope = context.scopes.get(nativeSha256(group.actor));
      if (!scope) continue;
      for (const set of group.sets.values()) for (const source of set.inputs) if (source.kind === "workspace_metadata") {
        const key = nativeSha256({ companyId: group.companyId, source });
        if (checkedWorkspaceSources.has(key)) continue;
        if (!pendingWorkspaceSources.has(key)) pendingWorkspaceSources.set(key, { companyId: group.companyId, source, scope });
      }
    }
    const pendingWorkspaceByCompany = new Map<string, { scope: NativeSourceReadScope; sources: Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }>[] }>();
    for (const { companyId, source, scope } of pendingWorkspaceSources.values()) {
      let group = pendingWorkspaceByCompany.get(companyId);
      if (!group) { group = { scope, sources: [] }; pendingWorkspaceByCompany.set(companyId, group); }
      if (group.sources.length >= 512) throw forbidden("The Native source workspace recheck exceeds its work bound");
      group.sources.push(source);
    }
    for (const [companyId, group] of pendingWorkspaceByCompany) {
      await assertNativeWorkspaceMetadataSourcesCurrent(context.db as Db, companyId, group.sources, group.scope);
      for (const source of group.sources) checkedWorkspaceSources.add(nativeSha256({ companyId, source }));
    }
    await drainNativeScopedTaskReads(context);
    if (context.pendingReaderChecks.size) {
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
            issueIds: [...group.issueIds], memoryIds: [...group.memoryIds],
          }, context.scopes.get(nativeSha256(group.actor)));
        } finally { context.activeReaderChecks.delete(key); }
        if (group.version !== version) context.pendingReaderChecks.add(key);
      }
    }
    for (const check of context.runtimeSkillReads?.values() ?? [])
      await assertNativeDocumentRuntimeSkillCurrent(context.db as Db, check.companyId, check.actor, check.source, check.runId);
    const pendingResults = [...context.deferredReadResultChecks.keys()].some(key => !context.checkedReadResultChecks.has(key));
    const pendingAnalytical = [...context.deferredAnalyticalTasks.values()].some(group =>
      [...group.issueIds].some(issueId => !group.checkedIssueIds.has(issueId)));
    if (!pendingResults && !pendingAnalytical && !context.pendingReaderChecks.size && !context.pendingScopedTaskReads.size) break;
  }
  } finally { context.flushingReaders = wasFlushing; }
}
function withNativeSourceReadScope<T>(db: Db | Transaction, actor: AuthorizationActor, companyId: string | null,
  read: (scope: NativeSourceReadScope) => Promise<T>, proofMemo?: NativeMemoryPageStructuralProofMemo,
  privateTaskParent?: { scope: NativeSourceReadScope; check: NativeScopedTaskRead }): Promise<T> {
  const current = nativeSourceReadScopes.getStore();
  const actorKey = nativeSha256(actor);
  const memoryTemporalIdentity = activeMemoryTemporalReadScopeIdentity(db, actor);
  const memoMatches = proofMemo && proofMemo.transaction === (db as object) && proofMemo.actorKey === actorKey &&
    proofMemo.memoryTemporalIdentity === memoryTemporalIdentity && memoryTemporalIdentity !== null;
  // A new public validation may follow writes in this same transaction. Give
  // it private mutable-row maps; never clear a map a nested reader still owns.
  const readPublicInvocation = async (scope: NativeSourceReadScope) => {
    const invocationScope: NativeSourceReadScope = { ...scope,
      frozenTaskSnapshots: scope.frozenTaskSnapshots,
      completedImmutableSourceLeafProofs: new Set(), currentMutableSourceRows: new Map(),
      pinnedRows: { ...scope.pinnedRows, runs: new Map(), reservations: new Map() } };
    scope.context.scopes.set(actorKey, invocationScope);
    if (companyId !== null) await lockNativeSourceReadPrivacy(db, companyId, invocationScope);
    if (companyId !== null && !await nativeSourceReaderHasCompanyAccess(db, companyId, actor))
      throw forbidden("The Native source reader is unavailable");
    const result = await read(invocationScope);
    if (companyId !== null && !await nativeSourceReaderHasCompanyAccess(db, companyId, actor))
      throw forbidden("The Native source reader is unavailable");
    return result;
  };
  if (current?.active && current.db === (db as object) && current.memoryTemporalIdentity === memoryTemporalIdentity) {
    let scope = current.scopes.get(actorKey);
    if (!scope) {
      let active = current.ancestry.activeByActor.get(actorKey);
      if (!active) { active = new Set(); current.ancestry.activeByActor.set(actorKey, active); }
      scope = { context: current, actorKey,
        pinnedRows: nativeSourceReadPinnedRowsForActor(db, actor, activeMemoryNativeSourceRowsScope(db, actor)),
        active, completedImmutableSourceLeafProofs: new Set(), currentMutableSourceRows: new Map(),
        frozenTaskMutableSources: nativeFrozenMutableProofMap(current.memoryStructuralProofMemoStore, actorKey, memoryTemporalIdentity),
        frozenTaskSnapshots: new Map(), taskTemporalScopes: new Map(),
        conversationRootComments: new Set(), deferredReaderSets: new Map() };
      current.scopes.set(actorKey, scope);
    }
    return readPublicInvocation(scope);
  }
  const inheritedContext = current?.active && current.db === (db as object) ? current : undefined;
  const sourceMemoStore = inheritedContext?.memoryStructuralProofMemoStore ??
    (memoMatches && proofMemo?.structuralProofMemoStore.transaction === (db as object)
      ? proofMemo.structuralProofMemoStore : undefined);
  const scope = nativeSourceReadScope(db, actor, inheritedContext?.ancestry,
    sourceMemoStore, memoMatches ? proofMemo?.frozenTaskSnapshots : undefined,
    inheritedContext?.pinnedRowsActorKey === actorKey ? inheritedContext.pinnedRows : undefined);
  // This link is an effect barrier only. Memo ancestry, rows and work budgets
  // still inherit solely through the exact same transaction object above.
  scope.context.parentContext = current?.active ? current : undefined;
  for (let parent = scope.context.parentContext; parent; parent = parent.parentContext)
    if (parent.ancestry.graphProofsDisabled) scope.context.ancestry.graphProofsDisabled = true;
  return nativeSourceReadScopes.run(scope.context, async () => {
    try {
      const result = await readPublicInvocation(scope);
      const parent = privateTaskParent?.scope;
      if (privateTaskParent && parent && inheritedContext === parent.context && parent.context.active &&
        parent.context.db === scope.context.db && nativeSha256(privateTaskParent.check.actor) === actorKey &&
        parent.context.privacyLockedCompanies.has(privateTaskParent.check.companyId) && !parent.context.flushingReaders &&
        !scope.context.ancestry.graphProofsDisabled && !nativeSourceEffectBarrierActive(scope.context) &&
        privateTaskParent.check.mutableSources.compatible) {
        const snapshot = captureNativeSourceGraphObligations(scope.context, actorKey);
        const ownPin = snapshot?.taskPins.get(privateTaskParent.check.issueId);
        if (snapshot && nativePendingTaskQueuesArePure(snapshot, privateTaskParent.check.companyId, actorKey) && ownPin &&
          ownPin.contentHash === privateTaskParent.check.contentHash && ownPin.snapshotDigest === privateTaskParent.check.snapshotDigest) {
          const data = structuredClone({ obligations: { ...snapshot, taskPins: [...snapshot.taskPins] },
            groups: [...scope.context.deferredReaderChecks].map(([key, group]) => ({ key,
              companyId: group.companyId, actor: group.actor, version: group.version,
              sets: [...group.sets], issueIds: [...group.issueIds], memoryIds: [...group.memoryIds] })) });
          freezeNativePendingTaskData(data);
          const pending = Object.freeze({ owner: scope.context.ancestry.pendingTaskOwner, ...data });
          privateTaskParent.check.pending = pending;
          if (scope.context.readerObligations) scope.context.readerObligations.unchecked = {
            parent: parent.context, descriptor: privateTaskParent.check, pending,
            memoryTemporalIdentity: scope.context.memoryTemporalIdentity };
          if (nativeSourceMemoDiagnosticsEnabled()) nativeSourceMemoDiagnostics.pendingTaskCaptures += 1;
          return result;
        }
      }
      await flushNativeSourceReaderChecks(scope.context);
      if (companyId !== null && !await nativeSourceReaderHasCompanyAccess(db, companyId, actor))
        throw forbidden("The Native source reader is unavailable");
      if (scope.context.readerObligations) {
        const obligations = completeNativeSourceGraphObligations(scope.context, actorKey);
        if (obligations) scope.context.readerObligations.completed = obligations;
      }
      return result;
    }
    finally {
      if (nativeSourceMemoDiagnosticsEnabled()) nativeSourceMemoDiagnostics.maxValidationWork =
        Math.max(nativeSourceMemoDiagnostics.maxValidationWork, scope.context.ancestry.work);
      scope.context.active = false;
    }
  });
}
function inNativeSourceReadTransaction<T>(db: Db | Transaction, read: (tx: Db | Transaction) => Promise<T>): Promise<T> {
  if (is(db, PgTransaction)) return read(db);
  return db.transaction(tx => read(tx as unknown as Db));
}
async function lockNativeSourceReadPrivacy(db: Db | Transaction, companyId: string, scope: NativeSourceReadScope) {
  if (scope.context.privacyLockedCompanies.has(companyId)) return;
  const { lockAnalyticalCompany, analyticalPrivacyReadLocked, markAnalyticalPrivacyReadLocked } = await import("./analytical-privacy.js");
  const { lockMemoryPrivacy } = await import("./memory/memory-privacy.js");
  if (!analyticalPrivacyReadLocked(db as object)) {
    // This helper is used only by source/currentness readers. An ALS/savepoint
    // alias may not retain the WeakSet marker from an outer Memory read; reacquire
    // the same shared fences instead of upgrading behind an exclusive writer.
    await lockAnalyticalCompany(db as Db, companyId, "read");
    await lockMemoryPrivacy(db as Db, companyId, "read");
    markAnalyticalPrivacyReadLocked(db as object);
  }
  // The retained Task privacy predicate expands a bounded but very large
  // recursive source graph. PostgreSQL estimates this statement above its JIT
  // threshold, so repeated owner checks can pay LLVM compilation cost even
  // when they run under the same pinned read transaction. Keep all predicate
  // and ACL checks intact; disable JIT only for this source-read transaction.
  await db.execute(sql`set local jit='off'`);
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
  issueIds?: string[]; memoryIds?: string[];
}, scope?: NativeSourceReadScope) {
  if (!input.sets.length && !input.issueIds?.length && !input.memoryIds?.length) return;
  if (!await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("The Native source prefix is unavailable");
  const projectIds = new Set(input.sets.flatMap(set => [...set.policy.projectIds, ...set.inputs.flatMap(source =>
    source.kind === "project" || source.kind === "project_workspace" ? [source.projectId] : [])]));
  const memoryIds = new Set([...input.sets.flatMap(set => [...set.policy.memoryIds, ...set.inputs.flatMap(source =>
    source.kind === "memory" ? [source.memoryId] : [])]), ...(input.memoryIds ?? [])]);
  const issueIds = new Set([...input.sets.flatMap(set => [...set.policy.issueIds, ...set.inputs.flatMap(source =>
    source.kind === "task" ? [source.issueId] : [])]), ...(input.issueIds ?? [])]);
  const runIds = new Set(input.sets.flatMap(set => set.policy.runIds));
  const foundationRevisionIds = new Set(input.sets.flatMap(set => [...set.policy.foundationRevisionIds,
    ...set.inputs.flatMap(source => source.kind === "foundation_revision" ? [source.revisionId] : [])]));
  const runtimeInstructions = new Map<string, { runId: string; source: Extract<NativePayloadSourceInput, { kind: "runtime_instructions" }> }>();
  const contextIds = new Set<string>();
  for (const set of input.sets) for (const source of set.inputs) {
    if (source.kind === "workspace_metadata" || source.kind === "worker_model_dispatch" ||
      source.kind === "conversation_model_dispatch" || source.kind === "native_task_wake" ||
      source.kind === "tool_result" || source.kind === "retained_run") runIds.add(source.runId);
    if (source.kind === "runtime_instructions") runtimeInstructions.set(nativeSha256({ runId: set.runId, source }), { runId: set.runId, source });
    if (source.kind === "context") contextIds.add(source.manifestId);
  }
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
      if (!match) throw forbidden("A Native Context Task source is unavailable");
      issueIds.add(match[1]!);
    }
    for (const root of roots) memoryIds.add(root.memoryRecordId);
  }
  // Context manifests can contribute Task sources that are not direct inputs.
  // Include them in the same current-ACL batch instead of issuing one recursive
  // privacy query per manifest item; exact temporal pins and Memory scope are
  // still resolved by the batch helper before this read returns.
  const temporalTasks = [...issueIds].flatMap(issueId => {
    const temporal = scope?.taskTemporalScopes.get(issueId);
    return temporal ? [{ issueId, contentHash: temporal.contentHash, snapshotDigest: temporal.snapshotDigest }] : [];
  });
  const unscopedIssueIds = [...issueIds].filter(issueId => !scope?.taskTemporalScopes.has(issueId));
  const issueReaders = await canActorReadPinnedIssuePrivacyBatch(db, input.actor, input.companyId,
    temporalTasks, unscopedIssueIds);
  for (const issueId of issueIds) if (issueReaders.get(issueId) !== true)
    throw forbidden("A Native source Task is unavailable");
  if (memoryIds.size && !await canActorReadMemorySourceSet(db as Db, input.companyId, input.actor, [...memoryIds], undefined,
    scope?.context.memoryStructuralProofMemoStore, scope?.context.active ? { nativeInspection: true } : {}))
    throw forbidden("A Native source Memory is unavailable");
  // Runtime bundles are the only filesystem reads in this source pass. Finish
  // them after the batched owner and ACL reads.
  for (const { runId, source } of runtimeInstructions.values())
    await assertNativeRuntimeInstructionsCurrent(db, input.companyId, runId, source, scope);
  for (const revisionId of foundationRevisionIds) {
    await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", revisionId, input.actor);
  }
}
export async function assertNativeWorkspaceMetadataSourcesCurrent(db: Db | Transaction, companyId: string,
  sources: Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }>[], scope?: NativeSourceReadScope) {
  for (const source of sources) {
    if (scope) nativeSourceReadWork(scope);
    const run = scope ? await nativeSourceReadRun(db, companyId, source.runId, scope) :
      (await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.id, source.runId), eq(heartbeatRuns.runtimeMode, "native"))).for("share"))[0] ?? null;
    const execution = run ? profileRunExecution(run) : null;
    const binding = execution?.binding && typeof execution.binding === "object" && !Array.isArray(execution.binding)
      ? execution.binding as Record<string, unknown> : null;
    const workspace = execution?.workspace && typeof execution.workspace === "object" && !Array.isArray(execution.workspace)
      ? execution.workspace as Record<string, unknown> : null;
    const tuple = workspace && { cwd: workspace.cwd, repoUrl: workspace.repoUrl,
      repoRef: workspace.repoRef, branchName: workspace.branchName };
    const workspaceHashMatches = !!tuple && createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex") === source.contentHash;
    const workspaceBindingMatches = binding?.executionWorkspaceId === source.executionWorkspaceId;
    if (!run || run.runtimeMode !== "native" || !tuple || !workspaceBindingMatches || !workspaceHashMatches)
      throw forbidden("A Native source workspace tuple changed");
    if (source.origin === "agent_home") {
      const [competingOwner] = await db.select({ id: executionWorkspaces.id }).from(executionWorkspaces).where(and(
        eq(executionWorkspaces.companyId, companyId), eq(executionWorkspaces.id, source.executionWorkspaceId))).for("share");
      if (source.runId !== run.id || source.executionWorkspaceId !== run.id ||
        source.sourceVersion !== `agent-home:${run.agentId}:v1` || competingOwner ||
        !isDeepStrictEqual(tuple, { cwd: resolveDefaultAgentWorkspaceDir(run.agentId), repoUrl: null, repoRef: null, branchName: null }))
        throw forbidden("A Native source agent workspace changed");
      continue;
    }
    if (source.origin === "task_session") {
      if (source.runId !== run.id || source.executionWorkspaceId !== binding.executionWorkspaceId ||
        source.sourceVersion !== `task-session:${run.id}`)
        throw forbidden("A Native source task-session workspace changed");
      continue;
    }
    if (source.origin === "execution_workspace") {
      const [current] = await db.select({ id: executionWorkspaces.id, cwd: executionWorkspaces.cwd,
        repoUrl: executionWorkspaces.repoUrl, repoRef: executionWorkspaces.baseRef,
        branchName: executionWorkspaces.branchName, updatedAt: executionWorkspaces.updatedAt })
        .from(executionWorkspaces).where(and(eq(executionWorkspaces.companyId, companyId),
          eq(executionWorkspaces.id, source.executionWorkspaceId))).for("share");
      if (!current || source.executionWorkspaceId === run.id || current.updatedAt.toISOString() !== source.sourceVersion ||
        !isDeepStrictEqual({ cwd: current.cwd, repoUrl: current.repoUrl, repoRef: current.repoRef, branchName: current.branchName }, tuple)) {
        if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1") {
          console.info("native_execution_workspace_currentness", JSON.stringify({
            executionWorkspaceRowPresent: Boolean(current),
            sourceIdIsRunId: source.executionWorkspaceId === run.id,
            sourceVersionMatches: current?.updatedAt.toISOString() === source.sourceVersion,
            tupleMatches: current !== undefined && isDeepStrictEqual({ cwd: current.cwd, repoUrl: current.repoUrl,
              repoRef: current.repoRef, branchName: current.branchName }, tuple),
          }));
        }
        throw forbidden("A Native source execution workspace changed");
      }
      continue;
    }
    throw forbidden("A Native source workspace origin is unsupported");
  }
}
async function assertNativeCompletionContractSourceCurrent(db: Db | Transaction, companyId: string, runId: string,
  source: Extract<NativePayloadSourceInput, { kind: "completion_contract" }>, scope: NativeSourceReadScope) {
  const proofKey = nativeCompletionContractProofKey(companyId, runId, source, scope);
  const [contract] = await db.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId),
    eq(completionContracts.id, source.contractId), eq(completionContracts.issueId, source.issueId))).for("share");
  if (!contract || contract.revision.toString() !== source.revision || contract.canonicalSha256 !== source.contentHash)
    throw forbidden("The Native source completion contract changed");
  recordNativeMutableSourceRow(scope, "contract", companyId, contract);
  if (scope.completedImmutableSourceLeafProofs.has(proofKey)) { nativeSourceReadWork(scope); return; }
  // This is structural row currentness only. The owning source set still runs
  // its exact reader ACL pass at the final transaction flush. The bounded set
  // is transaction-local and the row stays pinned by FOR SHARE until release.
  if (scope.completedImmutableSourceLeafProofs.size < 512)
    scope.completedImmutableSourceLeafProofs.add(proofKey);
}
function nativeCompletionContractProofKey(companyId: string, runId: string,
  source: Extract<NativePayloadSourceInput, { kind: "completion_contract" }>, scope: NativeSourceReadScope) {
  return nativeSha256({ companyId, runId, actorKey: scope.actorKey,
    memoryTemporalIdentity: scope.context.memoryTemporalIdentity, source });
}
function nativeManagedSourceLeafProofKey(companyId: string, issueId: string, runId: string,
  source: Extract<NativePayloadSourceInput, { kind: "workspace_metadata" | "runtime_instructions" }>, scope: NativeSourceReadScope) {
  return nativeSha256({ phase: "managed-consumed-run-source-leaf", companyId, issueId, runId,
    actorKey: scope.actorKey, memoryTemporalIdentity: scope.context.memoryTemporalIdentity, source });
}
function hasNativeCompletionContractSourceProof(companyId: string, runId: string,
  source: Extract<NativePayloadSourceInput, { kind: "completion_contract" }>, scope: NativeSourceReadScope) {
  return scope.completedImmutableSourceLeafProofs.has(nativeCompletionContractProofKey(companyId, runId, source, scope));
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

function nativeWirePurposeMatches(value: unknown, kind: "worker_model_dispatch" | "conversation_model_dispatch") {
  const purpose = nativeSourceRecord(value).modelPurpose;
  return kind === "conversation_model_dispatch"
    ? purpose === "conversation_model"
    : purpose === undefined || purpose === "worker_model";
}

async function assertNativeProjectSourceCurrentInScope(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; projectId: string;
  sources?: Extract<NativePayloadSourceInput, { kind: "project" }>[];
  workspaceSources?: Extract<NativePayloadSourceInput, { kind: "project_workspace" }>[];
}, scope: NativeSourceReadScope): Promise<void> {
  const activeKey = `native-project-owner:${input.companyId}:${input.projectId}`;
  if (scope.active.has(activeKey)) throw forbidden("A Native source Project graph contains a cycle");
  addNativeSourceActiveVisit(scope, activeKey);
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

/** Capture the actual public Project projection under its existing source
 * privacy transaction. The current reader validates the complete workspace set. */
export async function captureNativeProjectSource(db: Db, input: {
  companyId: string; projectId: string; actor: AuthorizationActor;
}): Promise<{ input: Extract<NativePayloadSourceInput, { kind: "project" }>;
  payloadSourceSnapshot: NativePayloadSourceSnapshot; workspaces: Array<typeof projectWorkspaces.$inferSelect> }> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    const [row] = await tx.select().from(projects).where(and(eq(projects.companyId, input.companyId),
      eq(projects.id, input.projectId))).for("share");
    if (!row) throw forbidden("A Native source Project is unavailable");
    const workspaces = await tx.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, input.companyId),
      eq(projectWorkspaces.projectId, input.projectId))).for("share");
    const projection = await projectService(tx as Db).getById(input.projectId);
    if (!projection) throw forbidden("A Native source Project is unavailable");
    const source = { kind: "project" as const, projectId: row.id, sourceVersion: row.updatedAt.toISOString(),
      contentHash: createHash("sha256").update(JSON.stringify(publicNativePayloadRow(projection)), "utf8").digest("hex") };
    await assertNativeProjectSourceCurrentInScope(tx, { companyId: input.companyId, actor: input.actor,
      projectId: input.projectId, sources: [source] }, scope);
    return { input: source, payloadSourceSnapshot: nativePayloadSourceSnapshotSchema.parse(row.payloadSourceSnapshot), workspaces };
  }));
}

/** Revalidate a captured Project DTO and its separately mutable workspace rows
 * at a tool-result publication boundary. The caller holds its privacy locks. */
export async function assertNativeProjectSourceCurrent(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; source: Extract<NativePayloadSourceInput, { kind: "project" }>;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
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

/** A Memory may be inherited through a sealed Task/Context source closure. Its
 * review transition belongs to the original `self_remember` Run, even when a
 * later Run is currently consuming that closure. Resolve evidence only through
 * an exact captured tool_result input and that producer Run's immutable source
 * receipt; never infer acceptance from the current Memory body or state alone. */
async function nativeMemoryReviewEvidenceFromSourceSet(db: Db | Transaction, companyId: string,
  memorySource: Extract<NativePayloadSourceInput, { kind: "memory" }>,
  sourceInputs: NativePayloadSourceInput[], fallbackReceipt: NativeRunInputSourceReceipt | undefined,
  scope: NativeSourceReadScope): Promise<Extract<NativePayloadSourceInput, { kind: "tool_result" }> | undefined> {
  const capturedResults = sourceInputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "tool_result" }> =>
    source.kind === "tool_result" && source.toolName === "paperclip-self:remember" && source.invocationId !== null);
  const evidenceByIdentity = new Map<string, Extract<NativePayloadSourceInput, { kind: "tool_result" }>>();
  const recordEvidence = (receipt: NativeRunInputSourceReceipt | undefined) => {
    if (!receipt) return;
    const evidence = nativeMemoryReviewEvidence(receipt, memorySource);
    if (!evidence || !capturedResults.some(source => isDeepStrictEqual(source, evidence))) return;
    evidenceByIdentity.set(nativeSha256(evidence), evidence);
  };
  recordEvidence(fallbackReceipt);
  if (!capturedResults.length) return evidenceByIdentity.size === 1 ? [...evidenceByIdentity.values()][0] : undefined;

  for (const runId of [...new Set(capturedResults.map(source => source.runId))]) {
    if (fallbackReceipt && capturedResults.some(source => source.runId === runId &&
      nativeMemoryReviewEvidence(fallbackReceipt, memorySource)?.runId === runId)) continue;
    nativeSourceReadWork(scope);
    const producer = await nativeSourceReadRun(db, companyId, runId, scope);
    if (!producer || producer.runtimeMode !== "native") continue;
    const profile = producer.runnerProfileJson && typeof producer.runnerProfileJson === "object" && !Array.isArray(producer.runnerProfileJson)
      ? producer.runnerProfileJson as Record<string, unknown> : null;
    const parsed = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
    if (!parsed?.success || parsed.data.binding.companyId !== companyId || parsed.data.binding.runId !== runId ||
      parsed.data.binding.agentId !== producer.agentId || parsed.data.binding.issueId !== producer.nativeIssueId ||
      parsed.data.binding.responsibleUserId !== (producer.responsibleUserId ?? null)) continue;
    recordEvidence(parsed.data);
  }
  return evidenceByIdentity.size === 1 ? [...evidenceByIdentity.values()][0] : undefined;
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
  transitionEvidence?: Extract<NativePayloadSourceInput, { kind: "tool_result" }>, scope?: NativeSourceReadScope,
  nativeInspection = false): Promise<void> {
  const [memory] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
    eq(memoryRecords.id, source.memoryId), isNull(memoryRecords.deletedAt))).for("share");
  if (nativeInspection && memory?.payloadSourceProtocolVersion !== 1)
    throw forbidden("A Native Memory source is unavailable");
  const versionMatches = !!memory && memory.updatedAt.toISOString() === source.sourceVersion;
  const acceptedReviewMatches = !!memory && !versionMatches && await assertNativeMemoryReviewTransitionEvidence(db, companyId,
    source, transitionEvidence, memory);
  const contentHashMatches = !!memory && nativeSha256(memory.content) === source.contentHash;
  // Validate the exact owner row and snapshot now. In a pinned native source
  // transaction, defer only the recursive reader ACL to the grouped after-wait
  // pass so repeated cumulative prefixes check each Memory root once.
  const readable = scope ? true : await canActorReadMemorySources(db as Db, companyId, actor, source.memoryId,
    nativeInspection ? { nativeInspection: true } : {});
  if (scope) deferNativeSourceOwnerReaderChecks(scope, { companyId, actor, memoryIds: [source.memoryId] });
  if (!memory || (!versionMatches && !acceptedReviewMatches) || !contentHashMatches || !readable) {
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
  await assertNativeMemorySourceCurrent(db, input.companyId, input.actor, input.source, input.transitionEvidence, undefined, true);
  if (!await nativeSourceReaderHasCompanyAccess(db, input.companyId, input.actor))
    throw forbidden("A Native Memory source is unavailable");
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
  capture: NativeModelOutputCapture, expectedToolName: string, currentReader?: AuthorizationActor,
  conversationState: "live" | "settled" = "live"): Promise<void> {
  const actor = currentReader ?? { type: "none", source: "none" } as AuthorizationActor;
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, actor, currentReader ? companyId : null, async scope => {
    await lockNativeSourceReadPrivacy(tx, companyId, scope);
    if (currentReader && !await nativeSourceReaderHasCompanyAccess(tx, companyId, currentReader))
      throw forbidden("The Native output reader is unavailable");
    await assertNativeModelOutputCaptureCurrentInScope(tx, companyId, issueId, capture, expectedToolName,
      scope, 0, currentReader, conversationState);
  }));
}

/** Recompute the exact Task-wake source from the persisted Run and current Task
 * owner. This is shared by original receipt validation and captured model
 * outputs so a wake is never admitted by a source-kind allowlist alone. */
async function nativeHistoricalPendingContextForParentInner(db: Db | Transaction, scope: NativeSourceReadScope, input: {
  companyId: string; issueId: string; consumerRunId: string; parent: typeof heartbeatRuns.$inferSelect;
  actor: AuthorizationActor; inherited?: NativePendingTransitionContext;
}): Promise<NativePendingTransitionContext | undefined> {
  const parentReceipt = nativeRunInputSourceReceiptSchema.safeParse(nativeSourceRecord(input.parent.runnerProfileJson).nativeInputSourceReceipt);
  if (!parentReceipt.success || parentReceipt.data.binding.companyId !== input.companyId ||
    parentReceipt.data.binding.issueId !== input.issueId || parentReceipt.data.binding.runId !== input.parent.id) return undefined;
  const edge = { runId: input.parent.id, receiptDigest: parentReceipt.data.digest };
  if (input.inherited) {
    if (input.inherited.parentRunId !== input.consumerRunId || input.inherited.lineage.length >= 64 ||
      input.inherited.lineage.some(step => step.runId === input.parent.id)) throw forbidden("A historical source lineage changed");
    return { ...input.inherited, parentRunId: input.parent.id, parentReceiptDigest: edge.receiptDigest,
      lineage: [...input.inherited.lineage, edge] };
  }
  const consumer = await nativeSourceReadRun(db,input.companyId,input.consumerRunId,scope);
  const receipt = nativeRunInputSourceReceiptSchema.safeParse(nativeSourceRecord(consumer?.runnerProfileJson).nativeInputSourceReceipt);
  const continuation = nativeSourceRecord(nativeSourceRecord(consumer?.contextSnapshot).executionContinuation);
  const outcomes = continuation.interactionOutcomes;
  if (!consumer || !receipt.success || consumer.nativeIssueId !== input.issueId || consumer.agentId !== input.parent.agentId ||
    !Array.isArray(outcomes) || outcomes.length === 0 || outcomes.length > 256 ||
    !outcomes.every(value => nativeSourceRecord(value).kind === "request_confirmation" && typeof nativeSourceRecord(value).id === "string")) return undefined;
  const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
  const terminalSources: NativePendingTransitionContext["terminalSources"] = [];
  await prepareNativeSourceEffectBoundary(scope);
  await materializeNativeInteractionResponses({db:db as Db,companyId:input.companyId,issueId:input.issueId,
    runId:consumer.id,agentId:consumer.agentId,interactionIds:outcomes.map(value=>String(nativeSourceRecord(value).id)),
    onContinuationSourceCapture:value=>{terminalSources.push(value);}});
  if (terminalSources.length !== outcomes.length || terminalSources.some(value=>!receipt.data.bootstrap.inputs.some(source=>
    isDeepStrictEqual(source,value.continuationSource)))) return undefined;
  return {consumerRunId:consumer.id,parentRunId:input.parent.id,parentReceiptDigest:edge.receiptDigest,terminalSources,lineage:[edge]};
}

async function nativeHistoricalPendingContextForParent(db: Db | Transaction, scope: NativeSourceReadScope, input: {
  companyId: string; issueId: string; consumerRunId: string; parent: typeof heartbeatRuns.$inferSelect;
  actor: AuthorizationActor; inherited?: NativeHistoricalPendingTransitionContext;
  edge: {kind:"retained_run" | "finalized_summary" | "stage_action";digest:string};
}): Promise<NativeHistoricalPendingTransitionContext | undefined> {
  const pending=await nativeHistoricalPendingContextForParentInner(db,scope,{...input,inherited:input.inherited?.pending});
  const stageReads=[...(input.inherited?.stageReads ?? [])];
  if (nativeSourceRecord(input.parent.contextSnapshot).source === "issue.execution_stage") {
    const {captureNativeFinalizedStageConsumption}=await import("./native-stage-wake-source.js");
    const producer=await captureNativeFinalizedStageConsumption(db,{companyId:input.companyId,issueId:input.issueId,
      runId:input.parent.id,reader:input.actor,readWork:()=>nativeSourceReadWork(scope)});
    if (producer) {
      const consumer=await nativeSourceReadRun(db,input.companyId,input.consumerRunId,scope);
      const consumerReceipt=nativeRunInputSourceReceiptSchema.safeParse(nativeSourceRecord(consumer?.runnerProfileJson).nativeInputSourceReceipt);
      if(!consumer || !consumerReceipt.success || consumerReceipt.data.binding.companyId !== input.companyId ||
        consumerReceipt.data.binding.issueId !== input.issueId || consumerReceipt.data.binding.runId !== consumer.id ||
        consumerReceipt.data.binding.agentId !== consumer.agentId || consumerReceipt.data.binding.responsibleUserId !== consumer.responsibleUserId)
        throw forbidden("The Stage history consumer receipt changed");
      const edgeDigest=nativeSha256({edge:input.edge,consumerRunId:consumer.id,consumerReceiptDigest:consumerReceipt.data.digest,reader:scope.actorKey});
      if(stageReads.length>=64 || stageReads.some(value=>value.producer.runId===producer.runId && !isDeepStrictEqual(value.producer,producer)))
        throw forbidden("The historical Stage lineage changed");
      if(!stageReads.some(value=>value.producer.runId===producer.runId && value.edgeKind===input.edge.kind && value.edgeDigest===edgeDigest))
        stageReads.push({producer,edgeKind:input.edge.kind,edgeDigest});
    }
  }
  const stageBodyReads=[...(input.inherited?.stageBodyReads ?? [])];
  const {captureNativeFinalizedStageTaskBodyRead}=await import("./native-stage-task-body-source.js");
  const bodyProducer=await captureNativeFinalizedStageTaskBodyRead(db,{companyId:input.companyId,issueId:input.issueId,
    runId:input.parent.id,reader:input.actor});
  if(bodyProducer){
    const consumer=await nativeSourceReadRun(db,input.companyId,input.consumerRunId,scope);
    const receipt=nativeRunInputSourceReceiptSchema.safeParse(nativeSourceRecord(consumer?.runnerProfileJson).nativeInputSourceReceipt);
    if(!consumer || !receipt.success || consumer.nativeIssueId!==input.issueId || receipt.data.binding.runId!==consumer.id ||
      receipt.data.binding.companyId!==input.companyId || receipt.data.binding.issueId!==input.issueId ||
      receipt.data.binding.agentId!==consumer.agentId || receipt.data.binding.responsibleUserId!==consumer.responsibleUserId)
      throw forbidden("The Stage Task history consumer changed");
    const edgeDigest=nativeSha256({edge:input.edge,consumerRunId:consumer.id,consumerReceiptDigest:receipt.data.digest,reader:scope.actorKey});
    if(stageBodyReads.length>=64 || stageBodyReads.some(value=>value.producer.runId===bodyProducer.runId && !isDeepStrictEqual(value.producer,bodyProducer)))
      throw forbidden("The Stage Task history lineage changed");
    if(!stageBodyReads.some(value=>value.producer.runId===bodyProducer.runId && value.edgeKind===input.edge.kind && value.edgeDigest===edgeDigest))
      stageBodyReads.push({producer:bodyProducer,edgeKind:input.edge.kind,edgeDigest});
  }
  return pending || stageReads.length || stageBodyReads.length ? {...(pending?{pending}:{}),...(stageReads.length?{stageReads}:{}),
    ...(stageBodyReads.length?{stageBodyReads}:{})}:undefined;
}

export type NativeTreeHoldInteractionSource = {
  companyId: string; issueId: string; runId: string; agentId: string; responsibleUserId: string;
  wakeupRequestId: string; requestedByUserId: string;
  hold: { holdId: string; rootIssueId: string; mode: "pause"; interaction: true };
  rootSource: Extract<NativePayloadSourceInput, { kind: "task" }> | null;
  commentSources: Extract<NativePayloadSourceInput, { kind: "comment" }>[];
};

/** Source provenance only. Current paid/tool/lifecycle admission never calls this owner. */
async function readNativeTreeHoldInteractionSource(db: Db | Transaction, scope: NativeSourceReadScope, input: {
  companyId: string; issueId: string; runId: string; agentId: string; payload: unknown;
  sources: readonly NativePayloadSourceInput[]; actor: AuthorizationActor; initial: boolean;
}): Promise<NativeTreeHoldInteractionSource> {
  const reject = (): never => { throw forbidden("The original Native pause interaction source is unavailable"); };
  const payload = nativeSourceRecord(input.payload), projection = nativeSourceRecord(payload.activeTreeHold);
  // The rare pause witness has no reusable hold-row proof family. Re-read its
  // owners instead of extending graph caches with a new authorization fact.
  disableNativeSourceGraphCheckpoints(scope);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (payload.treeHoldInteraction !== true || Object.keys(projection).sort().join(",") !== "holdId,interaction,mode,rootIssueId" ||
      typeof projection.holdId !== "string" || typeof projection.rootIssueId !== "string" ||
      !uuid.test(projection.holdId) || !uuid.test(projection.rootIssueId) ||
      projection.mode !== "pause" || projection.interaction !== true) return reject();
  const tasks = await db.select().from(issues).where(and(eq(issues.companyId, input.companyId),
    inArray(issues.id, [...new Set([input.issueId, projection.rootIssueId])].sort()))).orderBy(asc(issues.id)).for("share");
  const task = tasks.find(row => row.id === input.issueId), root = tasks.find(row => row.id === projection.rootIssueId);
  const run = await nativeSourceReadRun(db, input.companyId, input.runId, scope);
  const context = nativeSourceRecord(run?.contextSnapshot), controlHold = nativeSourceRecord(context.activeTreeHold);
  if (!task || !run || run.agentId !== input.agentId || !run.responsibleUserId || !run.wakeupRequestId ||
      (run.nativeIssueId !== null && run.nativeIssueId !== input.issueId) ||
      (context.issueId !== input.issueId && context.taskId !== input.issueId) || context.treeHoldInteraction !== true ||
      !isDeepStrictEqual(projection, { holdId: controlHold.holdId, rootIssueId: controlHold.rootIssueId,
        mode: controlHold.mode, interaction: controlHold.interaction })) return reject();
  const [queue] = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, input.companyId),
    eq(agentWakeupRequests.id, run.wakeupRequestId), eq(agentWakeupRequests.runId, run.id),
    eq(agentWakeupRequests.agentId, run.agentId))).for("share");
  const sourceByReason: Record<string, string> = { issue_commented: "issue.comment",
    issue_reopened_via_comment: "issue.comment.reopen", issue_comment_mentioned: "comment.mention" };
  if (!queue || queue.requestedByActorType !== "user" || !queue.requestedByActorId ||
      !["automation", "on_demand"].includes(queue.source) || !queue.reason || !sourceByReason[queue.reason] ||
      payload.reason !== queue.reason || nativeSourceRecord(queue.payload).issueId !== input.issueId ||
      !(input.initial ? queue.status === "claimed" && run.status === "running" && !run.resultJson?.startupCancellation :
        ["claimed", "completed"].includes(queue.status))) return reject();
  const ids = nativeTaskWakeOriginCommentIds(queue.payload);
  if (!ids.length || ids.length > 256 || new Set(ids).size !== ids.length) return reject();
  if (input.initial && !isDeepStrictEqual([...ids].sort(), nativeTaskWakeOriginCommentIds(context).sort())) return reject();
  const verificationContext = input.initial ? context : { wakeReason: queue.reason,
    source: sourceByReason[queue.reason], wakeCommentIds: ids };
  if (!await isVerifiedIssueTreeControlInteractionWake(db, { companyId: input.companyId, issueId: input.issueId,
    agentId: run.agentId, runId: run.id, wakeupRequestId: queue.id, contextSnapshot: verificationContext,
    requestedByActorType: "user", requestedByActorId: queue.requestedByActorId })) return reject();
  const [hold] = await db.select({ id: issueTreeHolds.id, rootIssueId: issueTreeHolds.rootIssueId,
    mode: issueTreeHolds.mode, status: issueTreeHolds.status }).from(issueTreeHolds).where(and(
      eq(issueTreeHolds.companyId, input.companyId), eq(issueTreeHolds.id, projection.holdId))).for("share");
  if (!hold || hold.rootIssueId !== projection.rootIssueId || hold.mode !== "pause" ||
      !["active", "released"].includes(hold.status)) return reject();
  if (input.initial) {
    const active = await issueTreeControlService(db as Db).getActivePauseHoldGate(input.companyId, input.issueId);
    if (hold.status !== "active" || !active || active.holdId !== hold.id || active.rootIssueId !== hold.rootIssueId) return reject();
  }
  const rootSources = input.sources.filter((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
    source.kind === "task" && source.issueId === hold.rootIssueId);
  const roots = rootSources.filter((source, index) => rootSources.findIndex(value => isDeepStrictEqual(source, value)) === index);
  if (hold.rootIssueId !== input.issueId && roots.length !== 1) return reject();
  if (!root) return reject();
  if (input.initial && hold.rootIssueId !== input.issueId)
    await assertNativeTaskSourceInputCurrentInScope(db, input.companyId, input.actor, roots[0]!, scope);
  const readers: AuthorizationActor[] = [input.actor,
    { type: "board", source: "session", userId: run.responsibleUserId },
    { type: "board", source: "session", userId: queue.requestedByActorId }];
  for (const actor of readers) {
    if (!await nativeSourceReaderHasCompanyAccess(db, input.companyId, actor) ||
        !await canActorReadIssuePrivacy(db, actor, task) || !await canActorReadIssuePrivacy(db, actor, root) ||
        !await canActorReadHeartbeatRunPrivacy(db, actor, { id: run.id, companyId: input.companyId })) return reject();
    deferNativeSourceReaderCheck(scope, { companyId: input.companyId, runId: run.id, actor,
      policy: { issueIds: [...new Set([task.id, root.id])], projectIds: [], runIds: [run.id], memoryIds: [], foundationRevisionIds: [] },
      inputs: [] });
  }
  const commentSources: NativeTreeHoldInteractionSource["commentSources"] = [];
  for (const id of ids) {
    const [currentComment] = await db.select({ row: issueComments,
      sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text` }).from(issueComments).where(and(eq(issueComments.companyId, input.companyId),
      eq(issueComments.issueId, input.issueId), eq(issueComments.id, id), isNull(issueComments.deletedAt))).for("share");
    const comment = currentComment?.row;
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(comment?.payloadSourceSnapshot);
    if (!comment || comment.authorType !== "user" || comment.authorUserId !== queue.requestedByActorId ||
        comment.authorAgentId || comment.createdByRunId || !snapshot.success) return reject();
    const selected = input.sources.filter((source): source is Extract<NativePayloadSourceInput, { kind: "comment" }> =>
      source.kind === "comment" && source.issueId === input.issueId && source.commentId === id);
    if (!selected.length || input.initial && selected.some(source => source.sourceVersion !== currentComment?.sourceVersion)) return reject();
    for (const source of selected) {
      await assertConversationCommentSourceCurrent(db, { companyId: input.companyId, actor: input.actor, source,
        policy: snapshot.data.policy, inputs: [...snapshot.data.inputs, source] }, scope);
      if (!commentSources.some(value => isDeepStrictEqual(value, source))) commentSources.push(source);
    }
  }
  return { companyId: input.companyId, issueId: input.issueId, runId: run.id, agentId: run.agentId,
    responsibleUserId: run.responsibleUserId, wakeupRequestId: queue.id, requestedByUserId: queue.requestedByActorId,
    hold: { holdId: hold.id, rootIssueId: hold.rootIssueId, mode: "pause", interaction: true },
    rootSource: hold.rootIssueId === input.issueId ? null : roots[0]!, commentSources };
}

/** Initial producer capture, before Native runtime selection. No persisted grant or new source kind. */
export async function captureNativeTreeHoldInteractionSource(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string; payload: unknown;
  sources: readonly NativePayloadSourceInput[];
}): Promise<NativeTreeHoldInteractionSource | null> {
  if (nativeSourceRecord(input.payload).treeHoldInteraction !== true) return null;
  return inNativeSourceReadTransaction(db, async tx => {
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId)));
    const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: input.companyId,
      agentId: input.agentId, runId: input.runId, onBehalfOfUserId: run?.responsibleUserId };
    return withNativeSourceReadScope(tx, actor, input.companyId, async scope => {
      await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
      return readNativeTreeHoldInteractionSource(tx, scope, { ...input, actor, initial: true });
    });
  });
}

async function assertNativeTaskWakeSourceCurrentInScope(db: Db | Transaction, scope: NativeSourceReadScope, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  source: Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>;
  inputs: NativePayloadSourceInput[];
  bootstrapInputs: NativeRunInputSourceReceipt["bootstrap"]["inputs"];
  historicalTransition?: NativeHistoricalPendingTransitionContext;
}): Promise<Extract<NativePayloadSourceInput, { kind: "interaction" }>[]> {
  const taskSources = input.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "task" }> =>
    value.kind === "task" && value.issueId === input.issueId);
  const [taskSource] = taskSources;
  const run = await nativeSourceReadRun(db, input.companyId, input.runId, scope);
  const context = run?.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
    ? run.contextSnapshot as Record<string, unknown> : null;
  const savedDependency = nativeSourceRecord(nativeSourceRecord(run?.runnerProfileJson).nativeBootstrapBlockedHumanInteraction);
  const retainedDependencyReader = run?.status === "succeeded" && savedDependency.capture !== undefined;
  const wake = retainedDependencyReader ? savedDependency.wake : context?.paperclipWake;
  const wakeRecord = wake && typeof wake === "object" && !Array.isArray(wake) ? wake as Record<string, unknown> : null;
  const issueValue = wakeRecord?.issue;
  const wakeIssue = issueValue && typeof issueValue === "object" && !Array.isArray(issueValue)
    ? issueValue as Record<string, unknown> : null;
  // The wake is an immutable event captured when this Run was created. Its
  // status/priority and source version must be read from that persisted event.
  // The enclosing source-set validator has already rechecked taskSource
  // through the canonical Task owner/snapshot/ACL path; do not apply that
  // current projection to the historical wake a second time here.
  const wakeTask = wakeIssue && typeof wakeIssue.id === "string" &&
    (typeof wakeIssue.identifier === "string" || wakeIssue.identifier === null) && typeof wakeIssue.title === "string" &&
    (typeof wakeIssue.description === "string" || wakeIssue.description === null) && typeof wakeIssue.status === "string" &&
    typeof wakeIssue.priority === "string" && typeof wakeIssue.workMode === "string"
    ? { id: wakeIssue.id, identifier: wakeIssue.identifier as string | null, title: wakeIssue.title,
      description: wakeIssue.description as string | null, status: wakeIssue.status,
      priority: wakeIssue.priority, workMode: wakeIssue.workMode } : null;
  // Reconstruct the capture from the immutable Run/wake and independently
  // validated constituent source set, never from a saved 'verified' descriptor.
  const continuation = wakeRecord?.executionContinuation;
  const continuationMessages = nativeSourceRecord(continuation).messages;
  const hasBoundedContinuation = Array.isArray(continuationMessages) && continuationMessages.length > 0 && continuationMessages.length <= 256;
  const [admittedWake] = run?.wakeupRequestId ? await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, run.wakeupRequestId),
    eq(agentWakeupRequests.agentId, run.agentId), eq(agentWakeupRequests.runId, input.runId),
  )).limit(1) : [];
  // Control wakes can coalesce into Run context; original wake authority is the exact admitted queue row.
  if (!admittedWake) throw forbidden("The original Native task wake is unavailable");
  const manualQueueAdoption = run ? await readNativeManualQueueAdoption(db as Db, {
    run, issueId: input.issueId, currentWake: admittedWake, readWork: () => nativeSourceReadWork(scope) }) : null;
  // Queue receipts have no mutable-source checkpoint family. Re-read their owner.
  if (nativeSourceRecord(admittedWake.payload).manualUserWake === true) markNativeSourceProofsIncompatible(scope);
  const governedInteractions: import("./native-runtime/native-interaction-bridge.js").NativeGovernedInteractionContinuationCapture[] = [];
  const answeredQuestions: import("./native-runtime/native-interaction-bridge.js").NativeAnsweredQuestionContinuationCapture[] = [];
  const outcomes = nativeSourceRecord(continuation).interactionOutcomes;
  if (run && Array.isArray(outcomes) && outcomes.length > 0 && outcomes.length <= 256 &&
    outcomes.every(value => { const row = nativeSourceRecord(value); return typeof row.id === "string" &&
      row.kind === "ask_user_questions" && row.status === "answered"; })) {
    // These resolver/origin facts have no reusable graph proof family.
    disableNativeSourceGraphCheckpoints(scope);
    const { materializeNativeInteractionResponses, NativeInteractionBridgeError } = await import("./native-runtime/native-interaction-bridge.js");
    await prepareNativeSourceEffectBoundary(scope);
    try {
      await materializeNativeInteractionResponses({ db: db as Db, companyId: input.companyId, issueId: input.issueId,
        runId: input.runId, agentId: run.agentId, interactionIds: outcomes.map(value => String(nativeSourceRecord(value).id)),
        onAnsweredQuestionCapture: value => { answeredQuestions.push(value); } });
    } catch (error) {
      if (error instanceof NativeInteractionBridgeError) throw forbidden("An answered question source changed or was erased");
      throw error;
    }
    if (answeredQuestions.length !== outcomes.length || answeredQuestions.some(value =>
      [value.nativeSource, value.continuationSource].some(expected =>
        !input.bootstrapInputs.some(source => isDeepStrictEqual(source, expected)) ||
        !input.inputs.some(source => isDeepStrictEqual(source, expected)))))
      throw forbidden("An answered question source is missing");
  }
  if (run && admittedWake && Array.isArray(outcomes) && outcomes.length > 0 && outcomes.length <= 256 &&
    outcomes.every(value => { const row = nativeSourceRecord(value); return typeof row.id === "string" &&
      row.kind === "request_confirmation" && ["accepted", "rejected"].includes(String(row.status)); })) {
    const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
    await prepareNativeSourceEffectBoundary(scope);
    await materializeNativeInteractionResponses({ db: db as Db, companyId: input.companyId, issueId: input.issueId,
      runId: input.runId, agentId: run.agentId, interactionIds: outcomes.map(value => String(nativeSourceRecord(value).id)),
      onContinuationSourceCapture: value => { governedInteractions.push(value); } });
    if (governedInteractions.some(value => !input.inputs.some(source => isDeepStrictEqual(source, value.nativeSource)) ||
      !input.inputs.some(source => isDeepStrictEqual(source, value.continuationSource))))
      throw forbidden("A governed continuation source is missing");
  }
  let pendingInteractions: NativeTaskContinuationCapture["pendingInteractions"];
  const unresolvedIds = nativeSourceRecord(continuation).unresolvedInteractionIds;
  if (run && admittedWake && Array.isArray(unresolvedIds) && unresolvedIds.length > 0 && unresolvedIds.length <= 256 &&
    unresolvedIds.every(id => typeof id === "string")) {
    const { captureNativeGovernedPendingInteractions } = await import("./native-runtime/native-interaction-bridge.js");
    if (input.historicalTransition && input.historicalTransition.pending?.parentRunId === input.runId) {
      const { nativeGovernedPendingTransitionCurrent } = await import("./native-runtime/native-interaction-bridge.js");
      pendingInteractions = [];
      for (const id of unresolvedIds) {
        const originals = input.inputs.filter((source): source is Extract<NativePayloadSourceInput,{kind:"interaction"}> =>
          source.kind === "interaction" && source.interactionId === id && source.issueId === input.issueId);
        const matches: NonNullable<NativeTaskContinuationCapture["pendingInteractions"]> = [];
        for (const source of originals) {
          const capture = await nativeGovernedPendingTransitionCurrent({db:db as Db,companyId:input.companyId,issueId:input.issueId,
            agentId:run.agentId,source,context:input.historicalTransition.pending,reader:input.actor,readWork:()=>nativeSourceReadWork(scope)});
          if(capture)matches.push(capture);
        }
        if(matches.length!==1)throw forbidden("A historical pending reference changed");
        pendingInteractions.push(matches[0]!);
      }
    } else pendingInteractions = await captureNativeGovernedPendingInteractions({ db: db as Db, companyId: input.companyId,
      issueId: input.issueId, runId: input.runId, agentId: run.agentId, interactionIds: unresolvedIds, reader: input.actor });
    if (pendingInteractions.some(value => !input.inputs.some(source => isDeepStrictEqual(source, value.source))))
      throw forbidden("A pending continuation source is missing");
  }
  let summary: NativeTaskContinuationCapture["summary"];
  const selectedSummary = nativeSourceRecord(run?.runnerProfileJson).nativeBootstrapContinuationSummaryDocument;
  const selectedSummaryRecord = nativeSourceRecord(selectedSummary), selectedSummarySource = nativeSourceRecord(selectedSummaryRecord.source);
  const selectedSummaryInput = nativePayloadSourceInputSchema.safeParse(selectedSummarySource.input);
  const selectedSummaryRendition = nativeSourceRecord(selectedSummaryRecord.rendition);
  if (selectedSummaryInput.success && selectedSummaryInput.data.kind === "document_revision" &&
    selectedSummaryInput.data.issueId === input.issueId && input.inputs.some(source => isDeepStrictEqual(source,selectedSummaryInput.data)) &&
    typeof selectedSummaryRendition.updatedAt === "string") {
    const originalInput = selectedSummaryInput.data;
    const [document] = await db.select({ revision: documentRevisions, sourceTrust: documents.sourceTrust })
      .from(documentRevisions).innerJoin(documents,and(eq(documents.id,documentRevisions.documentId),eq(documents.companyId,input.companyId)))
      .innerJoin(issueDocuments,and(eq(issueDocuments.documentId,documents.id),eq(issueDocuments.issueId,input.issueId),
        eq(issueDocuments.key,"continuation-summary")))
      .where(and(eq(documentRevisions.companyId,input.companyId),eq(documentRevisions.documentId,originalInput.documentId),
        eq(documentRevisions.id,originalInput.revisionId))).for("share");
    if (document && !document.revision.payloadSourceSnapshotInvalidated &&
      createHash("sha256").update(document.revision.body,"utf8").digest("hex") === originalInput.contentHash &&
      nativeSha256(document.sourceTrust ?? null) === selectedSummaryRecord.rawTrustHash &&
      Number.isFinite(Date.parse(selectedSummaryRendition.updatedAt)) && Date.parse(selectedSummaryRendition.updatedAt) >= document.revision.createdAt.getTime() &&
      run && Date.parse(selectedSummaryRendition.updatedAt) <= run.updatedAt.getTime()) {
      const source = {input:originalInput,payloadSourceSnapshot:document.revision.payloadSourceSnapshot,
        ...(typeof selectedSummarySource.returnedResultDigest === "string" ? {returnedResultDigest:selectedSummarySource.returnedResultDigest} : {})};
      const redactions = createRunSecretRedactionRegistry(db as Db);
      const selected = {key:"continuation-summary",title:document.revision.title,body:document.revision.body,
        sourceTrust:document.sourceTrust ?? null,updatedAt:selectedSummaryRendition.updatedAt};
      for (const rendition of [selected,redactQuarantinedBodyForHigherTrust(selected)]) {
        const current=await redactions.redactForIssue(input.companyId,input.issueId,rendition);
        if(current.body===nativeSourceRecord(continuation).completedWork && isDeepStrictEqual(current,selectedSummaryRendition)) {
          summary={source,rawTrustHash:nativeSha256(document.sourceTrust ?? null),rendition:current};break;
        }
      }
    }
  }
  let finalizedSummary: NativeTaskContinuationCapture["finalizedSummary"];
  if (!summary && run && nativeSourceRecord(continuation).completedWork !== null &&
    (typeof nativeSourceRecord(nativeSourceRecord(continuation).trigger).sourceRunId === "string" ||
      nativeSourceRecord(run.runnerProfileJson).nativeBootstrapStageTrigger)) {
    const { captureNativeFinalizedContinuationSummary } = await import("./execution-continuation.js");
    const profile = nativeSourceRecord(run.runnerProfileJson);
    const savedStageTrigger = profile.nativeBootstrapStageTrigger;
    let selected: NativeTaskContinuationCapture["finalizedSummary"] | null = null;
    if (savedStageTrigger) {
      const { captureNativeStageContinuationForDispatch } = await import("./native-stage-wake-source.js");
      const current = await captureNativeStageContinuationForDispatch(db as Db, { companyId: input.companyId,
        issueId: input.issueId, receiver: run, reader: input.actor });
      if (current && isDeepStrictEqual(current.trigger, savedStageTrigger)) selected = current.summary;
      else {
        const historicalConsumption=input.historicalTransition?.stageReads?.find(value=>value.producer.runId===run.id)?.producer;
        const originalSummary=profile.nativeBootstrapFinalizedContinuationSummary as NativeTaskContinuationCapture["finalizedSummary"]|null;
        if(historicalConsumption && originalSummary?.stageEntryRead){
          selected=await captureNativeFinalizedContinuationSummary({db:db as Db,companyId:input.companyId,issueId:input.issueId,
            agentId:run.agentId,receiverRunId:run.id,sourceRunId:String(nativeSourceRecord(savedStageTrigger).executorRunId),
            reader:input.actor,stageEntryRead:originalSummary.stageEntryRead,stageTrigger:savedStageTrigger as import("./execution-continuation.js").NativeStageTaskContinuationTrigger,
            historicalConsumption,readWork:()=>nativeSourceReadWork(scope)});
        }
      }
    } else {
      selected = await captureNativeFinalizedContinuationSummary({ db: db as Db, companyId: input.companyId,
        issueId: input.issueId, agentId: run.agentId, receiverRunId: run.id,
        sourceRunId: String(nativeSourceRecord(nativeSourceRecord(continuation).trigger).sourceRunId), reader: input.actor });
    }
    const original = nativeSourceRecord(run.runnerProfileJson).nativeBootstrapFinalizedContinuationSummary;
    if (selected && selected.body === nativeSourceRecord(continuation).completedWork && isDeepStrictEqual(selected, original)) {
      const parent = await nativeSourceReadRun(db, input.companyId, selected.sourceRunId, scope);
      const parentTransition = parent ? await nativeHistoricalPendingContextForParent(db, scope, {
        companyId: input.companyId, issueId: input.issueId, consumerRunId: run.id, parent, actor: input.actor,
        inherited: input.historicalTransition, edge:{kind:"finalized_summary",digest:nativeSha256(selected)} }) : undefined;
      for (const set of [selected.parentReceipt.bootstrap, ...selected.parentReceipt.dispatches, ...selected.parentReceipt.additionalInputs]) {
        await assertNativePayloadSourceSetCurrentInScope(db, { companyId: input.companyId, issueId: input.issueId,
          runId: selected.sourceRunId, actor: input.actor, policy: set.policy, inputs: set.inputs }, scope,
          undefined, undefined, new Map(), undefined, 0, parentTransition);
      }
      finalizedSummary = selected;
    }
  }
  const stageActions: NonNullable<NativeTaskContinuationCapture["stageActions"]> = [];
  const completedActions=nativeSourceRecord(continuation).completedActions;
  if(run && Array.isArray(completedActions) && completedActions.length > 0 && completedActions.length <= 64){
    const {captureNativeFinalizedStageConsumption}=await import("./native-stage-wake-source.js");
    const originalActions=nativeSourceRecord(run.runnerProfileJson).nativeBootstrapStageActionSources;
    if(!Array.isArray(originalActions) || originalActions.length !== completedActions.length)
      throw forbidden("The exact Stage action capture is unavailable");
    for(let index=0;index<completedActions.length;index++){
      const action=nativeSourceRecord(completedActions[index]);
      if(typeof action.runId !== "string" || action.runId === run.id) throw forbidden("The Stage action parent changed");
      const selected=await captureNativeFinalizedStageConsumption(db,{companyId:input.companyId,issueId:input.issueId,
        runId:action.runId,reader:input.actor,readWork:()=>nativeSourceReadWork(scope)});
      if(!selected || !isDeepStrictEqual(selected.action,completedActions[index]) || !isDeepStrictEqual(selected,originalActions[index]))
        throw forbidden("The original Stage action owner changed");
      const parent=await nativeSourceReadRun(db,input.companyId,selected.runId,scope);
      const parentReceipt=nativeRunInputSourceReceiptSchema.safeParse(nativeSourceRecord(parent?.runnerProfileJson).nativeInputSourceReceipt);
      if(!parent || !parentReceipt.success || parentReceipt.data.digest !== selected.receiptDigest)
        throw forbidden("The Stage action input receipt changed");
      const context=await nativeHistoricalPendingContextForParent(db,scope,{companyId:input.companyId,issueId:input.issueId,
        consumerRunId:run.id,parent,actor:input.actor,
        inherited:input.historicalTransition?.stageReads ? {stageReads:input.historicalTransition.stageReads}:undefined,
        edge:{kind:"stage_action",digest:nativeSha256({consumerReceipt:input.bootstrapInputs,action:selected})}});
      if(!context?.stageReads?.some(value=>isDeepStrictEqual(value.producer,selected)))
        throw forbidden("The exact Stage action transition is unavailable");
      disableNativeSourceGraphCheckpoints(scope);
      const sets=[parentReceipt.data.bootstrap,...parentReceipt.data.dispatches,...parentReceipt.data.additionalInputs];
      if(sets.length>64) throw forbidden("The Stage action source graph is too large");
      for(const set of sets) await assertNativePayloadSourceSetCurrentInScope(db,{companyId:input.companyId,issueId:input.issueId,
        runId:parent.id,actor:input.actor,policy:set.policy,inputs:set.inputs},scope,
        undefined,undefined,new Map(),undefined,0,context);
      stageActions.push(selected);
    }
  }
  let previousContext: NativeTaskContinuationCapture["previousContext"];
  let retainedSource: NativeTaskContinuationCapture["retainedSource"];
  const resumeDelta = nativeSourceRecord(nativeSourceRecord(continuation).resumeDelta);
  if (typeof resumeDelta.baseRunId === "string") {
    const retained = input.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "retained_run" }> =>
      source.kind === "retained_run" && source.runId === resumeDelta.baseRunId);
    const previous = retained.length === 1 ? await nativeSourceReadRun(db, input.companyId, retained[0]!.runId, scope) : null;
    const messages = nativeSourceRecord(nativeSourceRecord(previous?.contextSnapshot).executionContinuation).messages;
    if (previous && Array.isArray(messages) && messages.length <= 256) {
      previousContext = { runId: previous.id, messages: messages as NativeTaskContinuationCapture["envelope"]["messages"] };
      retainedSource = retained[0];
    }
  }
  let delivery: NativeTaskContinuationCapture["delivery"];
  if (run && admittedWake && governedInteractions.length) {
    const { captureNativeToolActionDelivery } = await import("./tool-action-delivery.js");
    const selected = await captureNativeToolActionDelivery({ db: db as Db, companyId: input.companyId,
      issueId: input.issueId, agentId: run.agentId, runId: run.id, wakeupRequestId: admittedWake.id, reader: input.actor });
    if (selected && input.inputs.some(source => isDeepStrictEqual(source, selected.source))) delivery = selected;
  }
  const admittedInteraction = nativeTaskWakeInteraction(admittedWake?.payload);
  let acceptedPlanReview: NativeTaskContinuationCapture["acceptedPlanReview"];
  const continuationEnvelope = nativeSourceRecord(continuation);
  if (run && admittedWake && run.responsibleUserId && wakeTask && Array.isArray(continuationEnvelope.interactionOutcomes) &&
      continuationEnvelope.interactionOutcomes.length > 0 && wake) {
    const { captureNativeAcceptedPlanReview } = await import("./native-runtime/accepted-plan-review-source.js");
    const selected = await captureNativeAcceptedPlanReview({ db: db as Db, companyId: input.companyId,
      issueId: input.issueId, agentId: run.agentId, runId: input.runId, responsibleUserId: run.responsibleUserId,
      envelope: continuation as NativeTaskContinuationCapture["envelope"], wakePayload: wake, context,
      workMode: wakeTask.workMode, interactionSources: input.inputs.filter((source): source is Extract<NativePayloadSourceInput,{kind:"interaction"}> =>
        source.kind === "interaction" && source.issueId === input.issueId),
      documentSources: input.inputs.filter((source): source is Extract<NativePayloadSourceInput,{kind:"document_revision"}> =>
        source.kind === "document_revision" && source.issueId === input.issueId) });
    if (selected) acceptedPlanReview = selected;
  }
  const continuationCapture: NativeTaskContinuationCapture | null = run && admittedWake && run.responsibleUserId &&
    Array.isArray(continuationMessages) && hasBoundedContinuation && isDeepStrictEqual(context?.executionContinuation, continuation) ? {
      companyId: input.companyId, issueId: input.issueId, agentId: run.agentId, runId: input.runId,
      responsibleUserId: run.responsibleUserId, wakeupRequestId: admittedWake.id,
      envelope: continuation as NativeTaskContinuationCapture["envelope"],
      ...(governedInteractions.length ? { governedInteractions } : {}),
      ...(answeredQuestions.length ? { answeredQuestions } : {}),
      ...(acceptedPlanReview ? { acceptedPlanReview } : {}),
      ...(stageActions.length ? { stageActions } : {}),
      ...(delivery ? { delivery } : {}),
      ...(pendingInteractions?.length ? { pendingInteractions } : {}),
      ...(summary ? { summary } : {}),
      ...(finalizedSummary ? { finalizedSummary } : {}),
      ...(previousContext && retainedSource ? { previousContext, retainedSource } : {}),
      commentSources: continuationMessages.flatMap(message => {
        const m = nativeSourceRecord(message);
        if (!message || typeof message !== "object" || Array.isArray(message) || typeof m.id !== "string") return [];
        const hash = nativeContinuationMessageHash(message as NativeTaskContinuationCapture["envelope"]["messages"][number]);
        return input.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "comment" }> =>
          source.kind === "comment" && source.issueId === input.issueId && source.commentId === m.id && source.contentHash === hash)
          .map(source => ({ input: source, payloadSourceSnapshot: null }));
      }),
      wake: { requestedByActorType: admittedWake.requestedByActorType, requestedByActorId: admittedWake.requestedByActorId,
        reason: admittedWake.reason, originCommentIds: nativeTaskWakeOriginCommentIds(admittedWake.payload),
        ...(admittedInteraction ? { interaction: admittedInteraction } : {}),
        ...(manualQueueAdoption ? { manualQueueAdoption } : {}) },
    } : null;
  let ordinaryPlanRead: Parameters<typeof captureNativeTaskWakeSource>[0]["ordinaryPlanRead"];
  const planContext = nativeSourceRecord(wakeRecord?.planReviewContext);
  if (run && run.responsibleUserId && planContext.interaction === null && typeof planContext.latestRevisionId === "string") {
    disableNativeSourceGraphCheckpoints(scope);
    const planSources = input.bootstrapInputs.filter((source): source is Extract<NativePayloadSourceInput, {kind:"document_revision"}> =>
      source.kind === "document_revision" && source.issueId === input.issueId && source.revisionId === planContext.latestRevisionId);
    const source = planSources[0];
    if (planSources.length !== 1 || !source || !input.inputs.some(value => isDeepStrictEqual(value, source)))
      throw forbidden("The original Native plan source prefix changed");
    // Read the original selected revision, not today's latest pointer and not an
    // invented approved revision. Its ordinary source roots/ACL are checked below.
    const [owner] = await db.select({ revision: documentRevisions, sourceTrust: documents.sourceTrust })
      .from(issueDocuments).innerJoin(documents, and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, input.companyId)))
      .innerJoin(documentRevisions, and(eq(documentRevisions.documentId, documents.id), eq(documentRevisions.companyId, input.companyId)))
      .where(and(eq(issueDocuments.companyId, input.companyId), eq(issueDocuments.issueId, input.issueId), eq(issueDocuments.key, "plan"),
        eq(documents.id, source.documentId), eq(documentRevisions.id, source.revisionId))).for("share");
    if (!owner || owner.revision.payloadSourceSnapshotInvalidated ||
      ![owner.revision.body, redactQuarantinedBodyForHigherTrust({ body: owner.revision.body, sourceTrust: owner.sourceTrust }).body]
        .some(body => createHash("sha256").update(body, "utf8").digest("hex") === source.contentHash))
      throw forbidden("The original Native plan rendition changed or was erased");
    ordinaryPlanRead = { companyId: input.companyId, issueId: input.issueId, runId: input.runId, agentId: run.agentId,
      responsibleUserId: run.responsibleUserId, wakeupRequestId: admittedWake.id, source, revisionNumber: owner.revision.revisionNumber };
  }
  let workspaceCapture: Parameters<typeof captureNativeTaskWakeSource>[0]["workspaceCapture"];
  if (wakeRecord && Object.hasOwn(wakeRecord, "executionWorkspace")) {
    const metadata = input.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }> =>
      source.kind === "workspace_metadata" && source.runId === input.runId);
    const bootstrapMetadata = input.bootstrapInputs.filter(source => source.kind === "workspace_metadata" && source.runId === input.runId);
    if (!run || run.nativeIssueId !== input.issueId || metadata.length !== 1 || bootstrapMetadata.length !== 1 ||
      !isDeepStrictEqual(metadata[0], bootstrapMetadata[0]))
      throw forbidden("The Native wake branch workspace source is unavailable");
    const profile = nativeSourceRecord(run.runnerProfileJson);
    let execution: ReturnType<typeof parseNativeExecutionInput>;
    try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); }
    catch { throw forbidden("The Native wake branch workspace input is unavailable"); }
    if (execution.schema !== "paperclip.native-execution-input.v4" ||
      execution.binding.companyId !== input.companyId || execution.binding.runId !== input.runId ||
      execution.binding.issueId !== input.issueId || execution.binding.agentId !== run.agentId)
      throw forbidden("The Native wake branch workspace binding changed");
    await assertNativeWorkspaceMetadataSourcesCurrent(db, input.companyId, [metadata[0]!], scope);
    workspaceCapture = { execution, source: metadata[0]! };
  }
  const originalCoordinationCapture = nativeSourceRecord(run?.runnerProfileJson).nativeWorkspaceCoordinationCapture;
  if (originalCoordinationCapture !== undefined && !run?.agentId)
    throw forbidden("Native workspace coordination consumer unavailable");
  const workspaceCoordinationCapture = originalCoordinationCapture !== undefined && run?.agentId
    ? await readNativeWorkspaceCoordination(db, { companyId: input.companyId, runId: input.runId,
      agentId: run.agentId, issueId: input.issueId, capture: originalCoordinationCapture, reader: input.actor }) : null;
  const blockedHumanInteraction = run ? retainedDependencyReader
    ? await readRetainedBlockedHumanInteractionOwner(db, scope, run, input.actor, savedDependency, input.bootstrapInputs)
    : await readNativeBlockedHumanInteractionOwner(db, {
      companyId: input.companyId, issueId: input.issueId, runId: input.runId, agentId: run.agentId }) : null;
  // The sealed wake proves an original observation, not today's permission to
  // execute. Releasing its canonical hold must not withdraw a delivered draft.
  const treeHoldInteractionSource = run && wakeRecord?.treeHoldInteraction === true
    ? await readNativeTreeHoldInteractionSource(db, scope, { companyId: input.companyId, issueId: input.issueId,
      runId: input.runId, agentId: run.agentId, payload: wake, sources: input.bootstrapInputs,
      actor: input.actor, initial: false }) : null;
  if (treeHoldInteractionSource && [treeHoldInteractionSource.rootSource, ...treeHoldInteractionSource.commentSources]
      .some(source => source && !input.inputs.some(value => isDeepStrictEqual(value, source))))
    throw forbidden("The original Native pause interaction prefix changed");
  if (blockedHumanInteraction && blockedHumanInteraction.blockers.some(blocker =>
      !input.bootstrapInputs.some(source => isDeepStrictEqual(source, blocker.source)) ||
      !input.inputs.some(source => isDeepStrictEqual(source, blocker.source))))
    throw forbidden("The dependency interaction blocker source changed");
  const current = run && run.nativeIssueId === input.issueId && taskSources.length === 1 && taskSource && wakeTask &&
    taskSource.sourceVersion === input.source.sourceVersion
    ? captureNativeTaskWakeSource({ companyId: input.companyId, runId: input.runId, issueId: input.issueId,
      sourceVersion: taskSource.sourceVersion, agentId: run.agentId, responsibleUserId: run.responsibleUserId,
      workspaceCapture, workspaceCoordinationCapture, blockedHumanInteraction, treeHoldInteractionSource,
      wakeupRequestId: run.wakeupRequestId, continuationCapture, ordinaryPlanRead,
      historicalPendingSources: input.historicalTransition ? pendingInteractions : undefined, persistedWakeReason: admittedWake.reason,
      task: wakeTask, checkoutRunId: context?.paperclipHarnessCheckedOut === true ? input.runId : null,
      commentSources: input.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "comment" }> =>
        value.kind === "comment"), payload: wake }) ?? (workspaceCoordinationCapture ? null : await captureNativeExecutionStageTaskWakeSource(db, {
          companyId: input.companyId, runId: input.runId, issueId: input.issueId, sourceVersion: taskSource.sourceVersion,
          task: wakeTask, runContext: context, payload: wake, workspaceCapture,
          checkoutRunId: context?.paperclipHarnessCheckedOut === true ? input.runId : null,
          commentSources: input.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "comment" }> =>
            value.kind === "comment"), continuationCapture,
          historicalPendingSources: input.historicalTransition ? pendingInteractions : undefined,
          historicalConsumption: input.historicalTransition?.stageReads?.find(value=>value.producer.runId === input.runId)?.producer,
          expectedStageTrigger: nativeSourceRecord(run.runnerProfileJson).nativeBootstrapStageTrigger as
            import("./execution-continuation.js").NativeStageTaskContinuationTrigger|undefined,
          reader:input.actor,
        })) : null;
  if (!current || !isDeepStrictEqual(current, input.source) ||
    input.source.runId !== input.runId || input.source.issueId !== input.issueId ||
    input.bootstrapInputs.filter(value => value.kind === "native_task_wake" && value.runId === input.runId &&
      value.issueId === input.issueId).length !== 1 ||
    !input.bootstrapInputs.some(value => value.kind === "native_task_wake" && isDeepStrictEqual(value, input.source)))
    throw forbidden("A Native task wake source changed");
  return answeredQuestions.flatMap(value => [value.nativeSource, value.continuationSource]);
}

/** Both Run and delivered-document source walkers consume this same rendition. */
async function readNativeQuestionContinuationSource(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string; kind: string | undefined;
  source: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  normal: readonly Extract<NativePayloadSourceInput, { kind: "interaction" }>[];
}): Promise<Extract<NativePayloadSourceInput, { kind: "interaction" }>[]> {
  if (input.kind !== "ask_user_questions" || input.normal.length !== 1 || isDeepStrictEqual(input.normal[0], input.source)) return [];
  const { materializeNativeInteractionResponses, NativeInteractionBridgeError } = await import("./native-runtime/native-interaction-bridge.js");
  const sources: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
  try {
    await materializeNativeInteractionResponses({ db: db as Db, companyId: input.companyId, issueId: input.issueId,
      runId: input.runId, agentId: input.agentId, interactionIds: [input.source.interactionId],
      onAnsweredQuestionCapture: value => { sources.push(value.continuationSource); } });
  } catch (error) {
    if (error instanceof NativeInteractionBridgeError) throw forbidden("A Native question continuation source changed or was erased");
    throw error;
  }
  return sources;
}

/** Source classification only: ordinary historical answers cannot become
 * direct interaction responses or change provider-session recovery authority. */
export async function readNativeTaskWakeQuestionSourcesCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor; sourceSet: NativePayloadSourceSet;
  identity: { eventSeq: number; attempt: number };
}): Promise<Extract<NativePayloadSourceInput, { kind: "interaction" }>[]> {
  const policy = nativePayloadSourcePolicySchema.safeParse(input.sourceSet?.policy);
  const inputs = nativePayloadSourceInputSchema.array().max(256).safeParse(input.sourceSet?.inputs);
  if (!policy.success || !inputs.success) throw forbidden("The Native historical question prefix is unavailable");
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    disableNativeSourceGraphCheckpoints(scope);
    const run = await nativeSourceReadRun(tx, input.companyId, input.runId, scope);
    if (!run || run.runtimeMode !== "native" || run.status !== "running" || run.nativeIssueId !== input.issueId ||
      !run.responsibleUserId || !run.wakeupRequestId || input.actor.type !== "agent" || input.actor.companyId !== input.companyId ||
      input.actor.agentId !== run.agentId || input.actor.runId !== run.id || input.actor.onBehalfOfUserId !== run.responsibleUserId)
      throw forbidden("The Native historical question reader changed");
    const profile = nativeSourceRecord(run.runnerProfileJson);
    const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
    let bootstrapInputs: NativePayloadSourceInput[];
    if (run.nativeInputSourceProtocolVersion === 1 && receipt.success &&
      receipt.data.binding.companyId === input.companyId && receipt.data.binding.issueId === input.issueId &&
      receipt.data.binding.runId === run.id && receipt.data.binding.agentId === run.agentId &&
      receipt.data.binding.responsibleUserId === run.responsibleUserId) {
      bootstrapInputs = receipt.data.bootstrap.inputs;
      // Only already sealed constructor prefixes qualify this branch. New
      // outer additions still pass the ordinary frame/admission source checks.
      await assertNativePayloadSourceSetCurrentInScope(tx, { ...input, policy: receipt.data.bootstrap.policy,
        inputs: bootstrapInputs }, scope);
    } else if (run.nativeInputSourceProtocolVersion === 0 && profile.nativeInputSourceReceipt === undefined &&
      profile.nativeExecutionInput !== undefined &&
      [profile.nativeModelInputDispatchIntents, profile.nativeToolCallDispatchAssociations,
        profile.nativeToolResultSourceCaptures].every(value => value === undefined ||
          Array.isArray(value) && value.length === 0)) {
      // This is the exact first constructor closure, before a receipt can be
      // sealed. It is not a historical-reader fallback or an output witness.
      if (!Number.isSafeInteger(input.identity.eventSeq) || input.identity.eventSeq < 0 ||
        !Number.isSafeInteger(input.identity.attempt) || input.identity.attempt < 1)
        throw forbidden("The Native historical question launch is unavailable");
      const [launch] = await tx.select({ seq: heartbeatRunEvents.seq }).from(heartbeatRunEvents).where(and(
        eq(heartbeatRunEvents.companyId, input.companyId), eq(heartbeatRunEvents.runId, run.id),
        eq(heartbeatRunEvents.agentId, run.agentId), eq(heartbeatRunEvents.seq, input.identity.eventSeq),
        eq(heartbeatRunEvents.eventType, PROCESS_START_REQUESTED))).for("share");
      if (!launch) throw forbidden("The Native historical question launch is unavailable");
      bootstrapInputs = inputs.data;
      for (const source of inputs.data) {
        if (source.kind === "task") await assertNativeTaskSourceInputCurrentInScope(tx, input.companyId, input.actor, source, scope);
        else if (source.kind === "comment") await assertConversationCommentSourceCurrent(tx, {
          companyId: input.companyId, actor: input.actor, source, policy: policy.data, inputs: inputs.data }, scope);
        else if (source.kind === "document_revision") {
          if (!source.issueId) throw forbidden("The Native historical question document is unavailable");
          await assertNativeDocumentRevisionCurrentSourceAccessInScope(tx as unknown as Db, { companyId: input.companyId,
            issueId: source.issueId, revisionId: source.revisionId, actor: input.actor, requireLatest: false }, scope, 0);
        }
      }
    } else throw forbidden("The Native historical question receipt is unavailable");
    const wakes = bootstrapInputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "native_task_wake" }> =>
      source.kind === "native_task_wake");
    if (wakes.length !== 1 || wakes[0]!.runId !== run.id || wakes[0]!.issueId !== input.issueId ||
      !inputs.data.some(source => isDeepStrictEqual(source, wakes[0])))
      throw forbidden("The Native historical question wake changed");
    const [queue] = await tx.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, input.companyId),
      eq(agentWakeupRequests.id, run.wakeupRequestId), eq(agentWakeupRequests.agentId, run.agentId),
      eq(agentWakeupRequests.runId, run.id))).for("share");
    if (!queue || queue.requestedByActorType !== "user" || !queue.requestedByActorId)
      throw forbidden("The Native historical question Human is unavailable");
    const readers: AuthorizationActor[] = [input.actor,
      { type: "board", source: "session", userId: run.responsibleUserId },
      { type: "board", source: "session", userId: queue.requestedByActorId }];
    for (const actor of [...new Map(readers.map(actor => [nativeSha256(actor), actor])).values()]) {
      await assertNativeSourceSetsReaderAccessCurrent(tx, { companyId: input.companyId, actor,
        sets: [{ runId: run.id, policy: policy.data, inputs: inputs.data }] }, scope);
      deferNativeSourceReaderCheck(scope, { companyId: input.companyId, runId: run.id, actor, policy: policy.data, inputs: inputs.data });
    }
    return assertNativeTaskWakeSourceCurrentInScope(tx, scope, { companyId: input.companyId, issueId: input.issueId,
      runId: run.id, actor: input.actor, source: wakes[0]!, inputs: inputs.data, bootstrapInputs });
  }));
}

/** Qualify only the exact null-invocation create_task result produced by an
 * ordinary conversation model turn. The settled provider call, Native dispatch
 * receipt, Human-sealed conversation root, source receipt, and current Task
 * owner all remain required. */
async function assertNativeConversationTaskResultCurrentInScope(db: Db | Transaction, scope: NativeSourceReadScope, input: {
  companyId: string; issueId: string; actor: AuthorizationActor; run: typeof heartbeatRuns.$inferSelect;
  profile: Record<string, unknown>; receipt: NativeRunInputSourceReceipt;
  source: Extract<NativePayloadSourceInput, { kind: "tool_result" }>;
  capture: Record<string, unknown>;
}): Promise<void> {
  const fail = (_reason: "capture_binding" | "additional_input" | "task_owner" | "task_source" |
    "dispatch_association" | "dispatch_turn" | "dispatch_wire" | "dispatch_binding" | "conversation_root"): never => {
    throw forbidden("A Native conversation Task result source changed");
  };
  const capture = input.capture;
  const taskRef = nativeSourceRecord(capture.taskRef);
  const taskId: unknown = taskRef.issueId;
  const turnId = typeof capture.turnId === "string" ? capture.turnId : "";
  const argumentsHash = typeof capture.argumentsHash === "string" ? capture.argumentsHash : "";
  const eventSeq: unknown = capture.eventSeq;
  const attempt: unknown = capture.attempt;
  if (input.source.runId !== input.run.id || input.source.toolName !== "create_task" || input.source.invocationId !== null ||
    capture.managedOpenCode !== true || capture.nativeReadResult === true || capture.tool !== "create_task" ||
    capture.callId !== input.source.callId || capture.resultDigest !== input.source.contentHash ||
    !turnId || !/^[0-9a-f]{64}$/.test(argumentsHash) || !Number.isSafeInteger(eventSeq) || !Number.isSafeInteger(attempt) ||
    typeof taskId !== "string") fail("capture_binding");
  if (typeof taskId !== "string") return fail("capture_binding");
  const qualifiedTaskId = taskId;
  if (!Number.isSafeInteger(eventSeq) || !Number.isSafeInteger(attempt)) fail("capture_binding");
  const qualifiedEventSeq: number = eventSeq as number;
  const qualifiedAttempt: number = attempt as number;

  const additionalEntries = input.receipt.additionalInputs.filter(entry => entry.responsibleUserId === input.run.responsibleUserId &&
    isDeepStrictEqual(entry.inputs[0], input.source));
  const taskInputs = additionalEntries.flatMap(entry => entry.inputs).filter((value): value is Extract<NativePayloadSourceInput, { kind: "task" }> =>
    value.kind === "task" && value.issueId === qualifiedTaskId);
  const expectedPolicy: NativePayloadSourcePolicy = { issueIds: [qualifiedTaskId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  if (additionalEntries.length !== 1 || additionalEntries[0]!.inputs.length !== 2 || taskInputs.length !== 1 ||
    !isDeepStrictEqual(additionalEntries[0]!.policy, expectedPolicy) ||
    !isDeepStrictEqual(additionalEntries[0]!.inputs, [input.source, taskInputs[0]]))
    fail("additional_input");

  const [task] = await db.select({ id: issues.id, parentId: issues.parentId,
    responsibleUserId: issues.responsibleUserId, createdByAgentId: issues.createdByAgentId,
    payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion,
    payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
  }).from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, qualifiedTaskId))).for("share");
  if (!task || task.parentId !== null || task.responsibleUserId !== input.run.responsibleUserId ||
    task.createdByAgentId !== input.run.agentId || task.payloadSourceProtocolVersion !== 1 || task.payloadSourceSnapshotInvalidated)
    fail("task_owner");
  try { await assertNativeTaskSourceInputCurrentInScope(db, input.companyId, input.actor, taskInputs[0]!, scope); }
  catch { fail("task_source"); }

  const associations = Array.isArray(input.profile.nativeToolCallDispatchAssociations)
    ? input.profile.nativeToolCallDispatchAssociations.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).callId === input.source.callId &&
      (value as Record<string, unknown>).turnId === turnId && (value as Record<string, unknown>).tool === "create_task" &&
      (value as Record<string, unknown>).argumentsHash === argumentsHash &&
      (value as Record<string, unknown>).eventSeq === qualifiedEventSeq && (value as Record<string, unknown>).attempt === qualifiedAttempt)
    : [];
  const modelTurns = Array.isArray(input.profile.nativeModelInputDispatchIntents)
    ? input.profile.nativeModelInputDispatchIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).dispatchId === (associations[0] as Record<string, unknown> | undefined)?.dispatchId &&
      (value as Record<string, unknown>).turnId === turnId && (value as Record<string, unknown>).eventSeq === qualifiedEventSeq &&
      (value as Record<string, unknown>).attempt === qualifiedAttempt &&
      (value as Record<string, unknown>).responsibleUserId === input.run.responsibleUserId)
    : [];
  const wireIntents = Array.isArray(input.profile.nativeAwModelWireIntents) ? input.profile.nativeAwModelWireIntents.filter(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const intent = value as Record<string, unknown>;
    const responseUses = Array.isArray(intent.responseToolUses) ? intent.responseToolUses.filter(use => use &&
      typeof use === "object" && !Array.isArray(use) && (use as Record<string, unknown>).id === input.source.callId &&
      typeof (use as Record<string, unknown>).name === "string" &&
      nativeProviderToolName((use as Record<string, unknown>).name as string) === "create_task" &&
      (use as Record<string, unknown>).argumentsHash === argumentsHash) : [];
    const binding = conversationModelBindingSchema.safeParse(intent.conversationModelBinding);
    const dispatchCopies = binding.success && typeof intent.sourceDispatchDigest === "string"
      ? input.receipt.dispatches.filter(dispatch => dispatch.executionInputDigest === intent.sourceDispatchDigest &&
        dispatch.inputs.some(source => source.kind === "conversation_model_dispatch" && source.runId === input.run.id &&
          source.issueId === input.issueId && source.reservationId === intent.reservationId &&
          source.agentId === input.run.agentId && source.conversationSessionGeneration === binding.data.conversationSessionGeneration &&
          source.executionManifestId === binding.data.executionManifestId && source.executionManifestHash === binding.data.executionManifestHash))
      : [];
    return intent.modelPurpose === "conversation_model" && responseUses.length === 1 && binding.success &&
      binding.data.issueId === input.issueId && binding.data.conversationSessionGeneration === input.run.contextSnapshot?.conversationSessionGeneration &&
      typeof intent.reservationId === "string" && dispatchCopies.length === 1 &&
      typeof intent.sourcePolicyHash === "string" && intent.sourcePolicyHash === nativeSha256(input.receipt.bootstrap);
  }) : [];
  const association = associations[0] as Record<string, unknown> | undefined;
  const wireIntent = wireIntents[0] as Record<string, unknown> | undefined;
  const binding = conversationModelBindingSchema.safeParse(wireIntent?.conversationModelBinding);
  const modelTurn = modelTurns[0] as Record<string, unknown> | undefined;
  if (associations.length !== 1) fail("dispatch_association");
  if (modelTurns.length !== 1) fail("dispatch_turn");
  if (wireIntents.length !== 1) fail("dispatch_wire");
  if (!binding.success) return fail("dispatch_binding");
  const currentBinding = binding.data;
  const [conversationRoot] = await db.select({ conversationAgentId: issues.conversationAgentId,
    conversationUserId: issues.conversationUserId, conversationState: issues.conversationState,
    conversationSessionGeneration: issues.conversationSessionGeneration, conversationRetiredAt: issues.conversationRetiredAt,
    parentId: issues.parentId, assigneeAgentId: issues.assigneeAgentId, executionRunId: issues.executionRunId,
    payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion, payloadSourceSnapshot: issues.payloadSourceSnapshot,
    payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
  }).from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).for("share");
  if (!isCurrentConversationModelRoot({ root: conversationRoot, contextSnapshot: input.run.contextSnapshot,
    companyId: input.companyId, agentId: input.run.agentId, responsibleUserId: input.run.responsibleUserId,
    runId: input.run.id, binding: currentBinding }) ||
    association!.dispatchId !== modelTurn!.dispatchId ||
    modelTurn!.turnInputDigest !== wireIntent!.sourceDispatchDigest)
    fail("conversation_root");
}

async function assertNativeModelOutputCaptureCurrentInScope(db: Db | Transaction, companyId: string, issueId: string,
  capture: NativeModelOutputCapture, expectedToolName: string, scope: NativeSourceReadScope, depth: number,
  currentReader?: AuthorizationActor, conversationState: "live" | "settled" = "live",
  siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map(), historicalTransition?: NativeHistoricalPendingTransitionContext): Promise<void> {
  if (historicalTransition) disableNativeSourceGraphCheckpoints(scope);
  if (depth > 8 || !scope.context.active) throw forbidden("The Native output source chain exceeds its bound");
  if (scope.context.ancestry.work > NATIVE_SOURCE_VALIDATION_WORK_LIMIT) throw forbidden("The Native output source chain exceeds its bound");
  nativeSourceReadWork(scope);
  const use = capture.managedOpenCodeToolUse;
  if (!use || capture.runId !== capture.dispatch.runId ||
    !["worker_model_dispatch", "conversation_model_dispatch"].includes(capture.dispatch.kind) ||
    capture.dispatch.callId.length > 240 || use.toolName !== expectedToolName ||
    !/^[\x21-\x7e]{1,240}$/.test(use.callId) || !/^[0-9a-f]{64}$/.test(use.argumentsHash) ||
    !/^[0-9a-f]{64}$/.test(use.responseContentHash) || !capture.sourceSet.inputs.some(source =>
      source.kind === "task" && source.issueId === issueId)) throw forbidden("The Native output capture is unavailable");
  // A same-transaction caller may have changed the current receipt since an
  // earlier proof. The transaction-local pinned-row map is only a read
  // optimization; it cannot establish currentness after our own writes.
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, capture.runId))).for("share");
  const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  const receipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  const intents = profile?.nativeAwModelWireIntents;
  const intent = Array.isArray(intents) ? intents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).reservationId === capture.dispatch.reservationId &&
    nativeWirePurposeMatches(value, capture.dispatch.kind)) as Record<string, unknown>[] : [];
  const associations = Array.isArray(profile?.nativeToolCallDispatchAssociations)
    ? profile.nativeToolCallDispatchAssociations.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).callId === use.callId && typeof (value as Record<string, unknown>).tool === "string" &&
      nativeProviderToolName((value as Record<string, unknown>).tool as string) === use.toolName &&
      (value as Record<string, unknown>).argumentsHash === use.argumentsHash)
    : [];
  const [reservation] = await db.select().from(orchestrationModelReservations).where(and(
    eq(orchestrationModelReservations.companyId, companyId),
    eq(orchestrationModelReservations.id, capture.dispatch.reservationId))).for("share");
  if (run) recordNativeMutableSourceRow(scope, "run", companyId, run);
  if (reservation) recordNativeMutableSourceRow(scope, "reservation", companyId, reservation);
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
      (conversationState === "live"
        ? conversationIssue.conversationSessionGeneration !== capture.dispatch.conversationSessionGeneration ||
          conversationIssue.conversationState !== "active" || conversationIssue.executionRunId !== capture.dispatch.runId ||
          !["in_review", "in_progress"].includes(conversationIssue.status ?? "")
        : conversationIssue.conversationSessionGeneration < capture.dispatch.conversationSessionGeneration ||
          !["active", "waiting"].includes(conversationIssue.conversationState ?? "")) ||
      conversationIssue.conversationRetiredAt !== null ||
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
  if (!currentReader && !await nativeSourceReaderHasCompanyAccess(db, companyId, actor))
    throw forbidden("The Native output reader is unavailable");
  if (!capture.consumedSourceComponents || capture.consumedSourceComponents.length === 0)
    throw forbidden("The Native output capture lacks its consumed source components");
  for (const memoryId of capture.sourceSet.policy.memoryIds) {
    const [memory] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated,
      ownerHash: sql<string>`public.aw_native_payload_body_hash('memory_record',to_jsonb(${memoryRecords}))` })
      .from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, memoryId),
        isNull(memoryRecords.deletedAt), memoryPayloadVisible())).for("share");
    const owner = nativePayloadSourceSnapshotSchema.safeParse(memory?.payloadSourceSnapshot);
    if (!memory || memory.payloadSourceSnapshotInvalidated || !owner.success || owner.data.owner.kind !== "memory_record" ||
      owner.data.owner.companyId !== companyId || owner.data.owner.id !== memoryId || owner.data.owner.contentHash !== memory.ownerHash)
      throw forbidden("A Native output Memory source is unavailable");
  }
  if (capture.sourceSet.policy.foundationRevisionIds.length) {
    const access = await authorizationService(db).decide({ actor, action: "foundation:read",
      resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
    if (!access.allowed) throw forbidden("A Native output Foundation source is unavailable");
    for (const revisionId of capture.sourceSet.policy.foundationRevisionIds)
      await assertLearnedAssetAnalyticalSources(db, companyId, "document_revision", revisionId, actor);
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
    if (source.versionId) {
      await assertRetainedRuntimeSkillSourceCurrent(db as Db, { companyId, actor, producerRunId: run.id,
        source: { ...source, versionId: source.versionId } }).catch(() => {
        throw forbidden("The Native output runtime Skill source changed");
      });
    } else await readNativeRuntimeAssetText(bundle, 256000, { companyId, runId: run.id }).catch(() => {
      throw forbidden("The Native output runtime Skill was erased");
    });
    recordNativeRuntimeSkillRead(db, companyId, actor, source, run.id);
  }
  // On an uncached walk, validate historical Documents at the suffix's depth
  // first. The suffix still enforces that depth when a canonical proof hits.
  if (conversationState === "settled" && nativeSourceRecord(run.contextSnapshot).source === "issue.execution_stage") {
    const {captureNativeFinalizedStageConsumption}=await import("./native-stage-wake-source.js");
    const producer=await captureNativeFinalizedStageConsumption(db,{companyId,issueId,runId:run.id,reader:actor,
      readWork:()=>nativeSourceReadWork(scope)});
    if(producer){
      const stageReads=[...(historicalTransition?.stageReads ?? [])];
      if(stageReads.length>=64 || stageReads.some(value=>value.producer.runId===producer.runId && !isDeepStrictEqual(value.producer,producer)))
        throw forbidden("The settled Stage output lineage changed");
      const edgeDigest=nativeSha256({capture,reader:scope.actorKey});
      if(!stageReads.some(value=>value.producer.runId===producer.runId && value.edgeKind==="model_output" && value.edgeDigest===edgeDigest))
        stageReads.push({producer,edgeKind:"model_output",edgeDigest});
      historicalTransition={...historicalTransition,stageReads};
      disableNativeSourceGraphCheckpoints(scope);
    }
  }
  if(conversationState==="settled"){
    const {captureNativeFinalizedStageTaskBodyRead}=await import("./native-stage-task-body-source.js");
    const producer=await captureNativeFinalizedStageTaskBodyRead(db,{companyId,issueId,runId:run.id,reader:actor});
    if(producer){
      const reads=[...(historicalTransition?.stageBodyReads ?? [])],edgeDigest=nativeSha256({capture,reader:scope.actorKey});
      if(reads.length>=64 || reads.some(value=>value.producer.runId===producer.runId && !isDeepStrictEqual(value.producer,producer)))
        throw forbidden("The settled Stage Task lineage changed");
      if(!reads.some(value=>value.producer.runId===producer.runId && value.edgeKind==="model_output" && value.edgeDigest===edgeDigest))
        reads.push({producer,edgeKind:"model_output",edgeDigest});
      historicalTransition={...historicalTransition,stageBodyReads:reads};disableNativeSourceGraphCheckpoints(scope);
    }
  }
  await assertNativeManagedConsumedSourceSetCurrentInScope(db, { companyId, issueId, runId: capture.runId,
    actor, components: capture.consumedSourceComponents, sourceSet: capture.sourceSet }, scope, siblingToolSourceProofs, depth + 1, historicalTransition);
  // The source-set walk above checks every ordinary owner. Keep the
  // output-specific binding and the few policy/output checks it cannot prove.
  for (const source of capture.sourceSet.inputs) {
    if (["task", "project", "project_workspace", "memory", "context", "document_revision", "completion_contract", "runtime_instructions", "runtime_skill", "workspace_metadata", "worker_model_dispatch", "conversation_model_dispatch", "native_task_wake", "tool_result", "comment", "interaction", "attachment", "authored_definition", "skill_version", "playbook_revision", "foundation_revision", "role_pack_version"].includes(source.kind)) {
      if (source.kind === "memory") {
        if (!capture.sourceSet.policy.memoryIds.includes(source.memoryId)) throw forbidden("A Native Memory source is unavailable");
        const evidence = await nativeMemoryReviewEvidenceFromSourceSet(db, companyId, source, capture.sourceSet.inputs,
          receipt?.success ? receipt.data : undefined, scope);
        await assertNativeMemorySourceCurrent(db, companyId, actor, source, evidence, scope);
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
      }
      if (source.kind === "native_task_wake") {
        const wakeRun = source.runId === capture.runId ? run : await nativeSourceReadRun(db, companyId, source.runId, scope);
        const wakeProfile = wakeRun?.runnerProfileJson && typeof wakeRun.runnerProfileJson === "object" && !Array.isArray(wakeRun.runnerProfileJson)
          ? wakeRun.runnerProfileJson as Record<string, unknown> : null;
        const wakeReceipt = wakeProfile && nativeRunInputSourceReceiptSchema.safeParse(wakeProfile.nativeInputSourceReceipt);
        if (!wakeRun || wakeRun.runtimeMode !== "native" || wakeRun.nativeIssueId !== source.issueId || !wakeReceipt?.success ||
          wakeReceipt.data.binding.companyId !== companyId || wakeReceipt.data.binding.runId !== source.runId ||
          wakeReceipt.data.binding.agentId !== wakeRun.agentId || wakeReceipt.data.binding.issueId !== source.issueId ||
          wakeReceipt.data.binding.responsibleUserId !== (wakeRun.responsibleUserId ?? null))
          throw forbidden("A Native output task wake source is unavailable");
        await assertNativeTaskWakeSourceCurrentInScope(db, scope, {
          companyId, issueId: source.issueId, runId: source.runId, actor, source,
          inputs: capture.sourceSet.inputs, bootstrapInputs: wakeReceipt.data.bootstrap.inputs, historicalTransition,
        });
        continue;
      }
      if (source.kind === "tool_result") {
        const producerRun = source.runId === capture.runId ? run : await nativeSourceReadRun(db, companyId, source.runId, scope);
        const producerProfile = producerRun?.runnerProfileJson && typeof producerRun.runnerProfileJson === "object" && !Array.isArray(producerRun.runnerProfileJson)
          ? producerRun.runnerProfileJson as Record<string, unknown> : null;
        const producerReceipt = producerProfile && nativeRunInputSourceReceiptSchema.safeParse(producerProfile.nativeInputSourceReceipt);
        const producerBindingCurrent = Boolean(producerRun?.runtimeMode === "native" && producerReceipt?.success &&
          producerReceipt.data.binding.companyId === companyId && producerReceipt.data.binding.runId === source.runId &&
          producerReceipt.data.binding.agentId === producerRun.agentId && producerReceipt.data.binding.issueId === producerRun.nativeIssueId &&
          producerReceipt.data.binding.responsibleUserId === (producerRun.responsibleUserId ?? null));
        const recorded = producerReceipt?.success ? nativeToolResultReceiptCopies(producerReceipt.data, source) : null;
        if (!producerRun || !producerBindingCurrent || !producerReceipt?.success || !recorded || recorded.exact < 1 ||
          recorded.conflicting || recorded.duplicateWithinEntry)
          throw forbidden("A Native output historical tool result is unavailable");
        const captures = Array.isArray(producerProfile?.nativeToolResultSourceCaptures) ? producerProfile.nativeToolResultSourceCaptures : [];
        const matching = captures.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
          (value as Record<string, unknown>).callId === source.callId && typeof (value as Record<string, unknown>).tool === "string" &&
          nativeProviderToolName((value as Record<string, unknown>).tool as string) === source.toolName &&
          (value as Record<string, unknown>).resultDigest === source.contentHash &&
          isDeepStrictEqual((value as Record<string, unknown>).source, source));
        if (matching.length !== 1) throw forbidden("A Native output tool result source is unavailable");
        if (source.invocationId) {
          const [invocation] = await db.select({ id: toolInvocations.id, companyId: toolInvocations.companyId,
            agentId: toolInvocations.agentId, idempotencyKey: toolInvocations.idempotencyKey,
            argumentsHash: toolInvocations.argumentsHash, workflowResultJson: toolInvocations.workflowResultJson,
            status: toolInvocations.status,
            runId: toolInvocations.runId, issueId: toolInvocations.issueId, toolName: toolInvocations.toolName,
            resultHash: toolInvocations.resultHash }).from(toolInvocations).where(and(
              eq(toolInvocations.companyId, companyId), eq(toolInvocations.id, source.invocationId),
              eq(toolInvocations.runId, source.runId), eq(toolInvocations.status, "succeeded"))).for("share");
          if (!invocation || invocation.toolName !== source.toolName || invocation.resultHash !== source.contentHash ||
            invocation.issueId !== producerRun?.nativeIssueId) throw forbidden("A Native output tool invocation is unavailable");
          recordNativeMutableSourceRow(scope, "invocation", companyId, invocation);
        } else if (source.toolName === "create_task" && producerReceipt?.success && producerProfile && producerRun) {
          const producerIssueId = producerRun.nativeIssueId;
          if (!producerIssueId) throw forbidden("A Native conversation Task producer is unavailable");
          await assertNativeConversationTaskResultCurrentInScope(db, scope, {
            companyId, issueId: producerIssueId, actor, run: producerRun, profile: producerProfile,
            receipt: producerReceipt.data, source,
            capture: matching[0] as Record<string, unknown>,
          });
        } else if (source.toolName === "create_project" || source.toolName === "call_api") {
          // Managed Native Project outputs and the exact bounded Project API
          // result are not Tool Gateway invocations. Their call/dispatch,
          // receipt, result, source-snapshot, and (for POST) route receipt
          // owners have already run in assertNativeManagedConsumedSourceSetCurrentInScope
          // above; requiring a toolInvocations row here would reject those
          // canonical sources after validating them.
        } else throw forbidden("A Native output tool invocation is unavailable");
        const captureRow = matching[0] as Record<string, unknown>;
        const documentRevision = captureRow.documentRevision && typeof captureRow.documentRevision === "object" && !Array.isArray(captureRow.documentRevision)
          ? captureRow.documentRevision as Record<string, unknown> : null;
        if (documentRevision) {
          if (typeof documentRevision.issueId !== "string" || typeof documentRevision.revisionId !== "string")
            throw forbidden("A Native output document tool result is unavailable");
          await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId,
            issueId: documentRevision.issueId, revisionId: documentRevision.revisionId, actor, requireLatest: false }, scope, depth + 1, siblingToolSourceProofs);
        }
      }
      continue;
    }
    throw forbidden("A Native output source family is unsupported");
  }
  // Every exact component above has completed its row, hash, snapshot, and
  // receipt checks. Recheck this exact captured prefix's current readers only
  // in the outer transaction's final pass, after all source-row waits.
  deferNativeSourceReaderCheck(scope, { companyId, runId: capture.runId, actor,
    policy: capture.sourceSet.policy, inputs: capture.sourceSet.inputs });
  if (!currentReader && !await nativeSourceReaderHasCompanyAccess(db, companyId, actor))
    throw forbidden("The Native output reader is unavailable");

}

/** Revalidate a driver continuation's exact cumulative source prefix before it
 * is sent to another provider request. The run receipt supplies the source
 * identity; completed tool-result and dispatch rows supply the original links. */
export async function assertNativePayloadSourceSetCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativePayloadSourceSetCurrentInScope(tx, input, scope);
  }));
}


export type NativeBlockedHumanInteraction = {
  companyId: string; issueId: string; runId: string; agentId: string; responsibleUserId: string;
  wakeupRequestId: string; requestedByUserId: string; commentSources: Extract<NativePayloadSourceInput, { kind: "comment" }>[];
  commentSourceSnapshots: { input: Extract<NativePayloadSourceInput, { kind: "comment" }>; payloadSourceSnapshot: NativePayloadSourceSnapshot }[];
  unresolvedBlockerIssueIds: string[];
  blockers: { source: Extract<NativePayloadSourceInput, { kind: "task" }>; payloadSourceSnapshot: NativePayloadSourceSnapshot;
    summary: { id: string; identifier: string | null; title: string; status: string; priority: string;
      assigneeAgentId: string | null; assigneeUserId: string | null } }[];
};

/** Current source-owner proof, never a caller flag or a persisted permission. */
async function readNativeBlockedHumanInteractionOwner(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string;
}, expected?: NativeBlockedHumanInteraction): Promise<NativeBlockedHumanInteraction | null> {
  return inNativeSourceReadTransaction(db, async tx => {
    const [initialRun] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId)));
    const originalReadOnlyCatalog = nativeBlockedHumanInteractionCatalog(initialRun, input);
    const initialContext = nativeSourceRecord(initialRun?.contextSnapshot);
    const initialWakePayload = nativeSourceRecord(initialContext.paperclipWake);
    if (!expected && !originalReadOnlyCatalog && initialContext.dependencyBlockedInteraction !== true && initialWakePayload.dependencyBlockedInteraction !== true) {
      const [initialTask] = await tx.select({ status: issues.status }).from(issues)
        .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)));
      // Preserve ordinary callers. This read cannot grant the exception; every
      // candidate below acquires the original privacy/Task/Run source locks.
      if (initialTask?.status !== "blocked") return null;
      const [initialWake] = initialRun?.wakeupRequestId ? await tx.select({ reason: agentWakeupRequests.reason })
        .from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, input.companyId),
          eq(agentWakeupRequests.id, initialRun.wakeupRequestId), eq(agentWakeupRequests.runId, input.runId))) : [];
      // Unrelated review/Stage owners retain their own existing admission.
      // A blocked assignment still fails the unchanged paid status qualifier.
      if (!initialWake || !["issue_commented", "issue_comment_mentioned"].includes(initialWake.reason ?? "")) return null;
    }
    const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: input.companyId,
      agentId: input.agentId, runId: input.runId, onBehalfOfUserId: initialRun?.responsibleUserId };
    return withNativeSourceReadScope(tx, actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).for("share");
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId))).for("share");
    const context = nativeSourceRecord(run?.contextSnapshot);
    const wakePayload = nativeSourceRecord(context.paperclipWake);
    // Existing server-captured interaction fields can tighten a Run's ceiling;
    // they never establish the Human/source authority checked below.
    const previouslyBound = expected !== undefined || nativeBlockedHumanInteractionCatalog(run, input) || context.dependencyBlockedInteraction === true || wakePayload.dependencyBlockedInteraction === true;
    if (!previouslyBound && task?.status !== "blocked") return null;
    const reject = (): never => { throw forbidden("The current Human dependency interaction source is unavailable"); };
    if (!task || !run || run.status !== "running" || run.resultJson?.startupCancellation ||
        task.status !== "blocked" || task.hiddenAt || task.workMode !== "standard" || task.assigneeAgentId !== input.agentId ||
        !run.responsibleUserId || !run.wakeupRequestId ||
        (run.nativeIssueId !== null && run.nativeIssueId !== input.issueId) ||
        (context.issueId !== input.issueId && context.taskId !== input.issueId)) return reject();
    const [wake] = await tx.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, input.companyId),
      eq(agentWakeupRequests.id, run.wakeupRequestId), eq(agentWakeupRequests.agentId, input.agentId),
      eq(agentWakeupRequests.runId, input.runId))).for("share");
    if (!wake || wake.status !== "claimed" || wake.requestedByActorType !== "user" || !wake.requestedByActorId ||
        !["issue_commented", "issue_comment_mentioned"].includes(wake.reason ?? "") ||
        !["automation", "on_demand"].includes(wake.source) ||
        nativeSourceRecord(wake.payload).issueId !== input.issueId) return reject();
    const ids = nativeTaskWakeOriginCommentIds(wake.payload);
    if (!ids.length || ids.length > 256 || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return reject();
    if (run.responsibleUserId !== actor.onBehalfOfUserId) return reject();
    const human: AuthorizationActor = { type: "board", source: "session", userId: wake.requestedByActorId };
    if (!await nativeSourceReaderHasCompanyAccess(tx, input.companyId, actor) ||
        !await nativeSourceReaderHasCompanyAccess(tx, input.companyId, human) ||
        !await canActorReadIssuePrivacy(tx, actor, task) || !await canActorReadIssuePrivacy(tx, human, task) ||
        !await canActorReadHeartbeatRunPrivacy(tx, actor, { id: input.runId, companyId: input.companyId }) ||
        !await canActorReadHeartbeatRunPrivacy(tx, human, { id: input.runId, companyId: input.companyId })) return reject();
    const receipt = nativeRunInputSourceReceiptSchema.safeParse(run.runnerProfileJson?.nativeInputSourceReceipt);
    if (run.runnerProfileJson?.nativeInputSourceReceipt && !receipt.success) return reject();
    const commentSources: NativeBlockedHumanInteraction["commentSources"] = [];
    const commentSourceSnapshots: NativeBlockedHumanInteraction["commentSourceSnapshots"] = [];
    for (const commentId of ids.sort()) {
      const [comment] = await tx.select({ row: issueComments,
        sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text` }).from(issueComments)
        .where(and(eq(issueComments.companyId, input.companyId), eq(issueComments.issueId, input.issueId),
          eq(issueComments.id, commentId), isNull(issueComments.deletedAt))).for("share");
      if (!comment || comment.row.authorType !== "user" || comment.row.authorAgentId || comment.row.createdByRunId ||
          comment.row.authorUserId !== wake.requestedByActorId) return reject();
      const snapshot = nativePayloadSourceSnapshotSchema.safeParse(comment.row.payloadSourceSnapshot);
      if (!snapshot.success) return reject();
      const captured = receipt.success ? receipt.data.bootstrap.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "comment" }> =>
        source.kind === "comment" && source.issueId === input.issueId && source.commentId === commentId) : [];
      if (receipt.success && captured.length < 1) return reject();
      const selected = captured.length ? captured : [{ kind: "comment" as const, issueId: input.issueId, commentId,
        sourceVersion: comment.sourceVersion, contentHash: nativeCommentProjectionHash(comment.row) }];
      for (const source of selected) {
        await assertConversationCommentSourceCurrent(tx, { companyId: input.companyId, actor, source,
          policy: snapshot.data.policy, inputs: [...snapshot.data.inputs, source] }, scope);
        commentSources.push(source);
        commentSourceSnapshots.push({ input: source, payloadSourceSnapshot: snapshot.data });
      }
    }
    const { issueService } = await import("./issues.js");
    const readiness = await issueService(tx as Db).getDependencyReadiness(input.issueId);
    if (readiness.isDependencyReady || readiness.unresolvedBlockerCount < 1) return reject();
    const rows = await tx.select({ row: issues,
      sourceVersion: sql<string>`extract(epoch from ${issues.updatedAt})::text`,
      contentHash: sql<string>`public.aw_native_payload_body_hash('issue',to_jsonb(${issues}))` })
      .from(issueRelations).innerJoin(issues, and(eq(issues.companyId, issueRelations.companyId), eq(issues.id, issueRelations.issueId)))
      .where(and(eq(issueRelations.companyId, input.companyId), eq(issueRelations.type, "blocks"),
        eq(issueRelations.relatedIssueId, input.issueId), inArray(issues.id, readiness.unresolvedBlockerIssueIds)))
      .orderBy(asc(issues.title)).for("share", { of: issues });
    if (rows.length !== readiness.unresolvedBlockerIssueIds.length) return reject();
    const blockers: NativeBlockedHumanInteraction["blockers"] = [];
    for (const blocker of rows) {
      if (!await canActorReadIssuePrivacy(tx, actor, blocker.row) || !await canActorReadIssuePrivacy(tx, human, blocker.row)) return reject();
      const snapshot = nativePayloadSourceSnapshotSchema.safeParse(blocker.row.payloadSourceSnapshot);
      if (!snapshot.success) return reject();
      const source: Extract<NativePayloadSourceInput, { kind: "task" }> = { kind: "task", issueId: blocker.row.id,
        sourceVersion: blocker.sourceVersion, contentHash: blocker.contentHash };
      await assertNativeTaskSourceInputCurrentInScope(tx, input.companyId, actor, source, scope);
      blockers.push({ source, payloadSourceSnapshot: snapshot.data, summary: { id: blocker.row.id,
        identifier: blocker.row.identifier, title: blocker.row.title, status: blocker.row.status, priority: blocker.row.priority,
        assigneeAgentId: blocker.row.assigneeAgentId, assigneeUserId: blocker.row.assigneeUserId } });
    }
    const capture: NativeBlockedHumanInteraction = { companyId: input.companyId, issueId: input.issueId,
      runId: input.runId, agentId: input.agentId, responsibleUserId: run.responsibleUserId,
      wakeupRequestId: wake.id, requestedByUserId: wake.requestedByActorId, commentSources, commentSourceSnapshots, blockers, unresolvedBlockerIssueIds: [...readiness.unresolvedBlockerIssueIds].sort() };
    if (expected && !isDeepStrictEqual(capture, expected)) return reject();
    return capture;
    });
  });
}

/** Historical source review only. This owner is never called by paid
 * admission, wire dispatch, tools or result acceptance. Original rendering is
 * bound by the immutable native_task_wake hash; current ACL/snapshots remain. */
async function readRetainedBlockedHumanInteractionOwner(db: Db | Transaction, scope: NativeSourceReadScope,
  run: typeof heartbeatRuns.$inferSelect, actor: AuthorizationActor, original: unknown,
  bootstrapInputs: NativePayloadSourceInput[]): Promise<NativeBlockedHumanInteraction> {
  const reject = (): never => { throw forbidden("The retained dependency interaction source is unavailable"); };
  const saved = nativeSourceRecord(original), value = nativeSourceRecord(saved.capture), wake = nativeSourceRecord(saved.wake);
  if (run.status !== "succeeded" || run.nativePhase !== "committed" ||
      run.nativeProcessCleanupPending !== false || !run.nativeIssueId || !run.responsibleUserId || !run.wakeupRequestId ||
      value.companyId !== run.companyId || value.issueId !== run.nativeIssueId || value.runId !== run.id || value.agentId !== run.agentId ||
      value.responsibleUserId !== run.responsibleUserId || value.wakeupRequestId !== run.wakeupRequestId || wake.dependencyBlockedInteraction !== true)
    return reject();
  if (!nativeBlockedHumanInteractionCatalog(run, { companyId: run.companyId, issueId: run.nativeIssueId,
      runId: run.id, agentId: run.agentId })) return reject();
  const [coordinator] = await db.select().from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, run.companyId), eq(nativeRunFinalizations.issueId, run.nativeIssueId),
    eq(nativeRunFinalizations.runId, run.id), eq(nativeRunFinalizations.phase, "committed"),
    isNull(nativeRunFinalizations.leaseOwner))).for("share");
  if (!coordinator?.resultId || !coordinator.assessmentId || !coordinator.decisionId || coordinator.failureCode || coordinator.nextAttemptAt)
    return reject();
  const [committed] = await db.select({ accepted: nativeRunResults, assessment: workAssessments, decision: statusDecisions })
    .from(nativeRunResults).innerJoin(workAssessments, and(eq(workAssessments.companyId, nativeRunResults.companyId),
      eq(workAssessments.resultId, nativeRunResults.id), eq(workAssessments.id, coordinator.assessmentId),
      eq(workAssessments.issueId, run.nativeIssueId), eq(workAssessments.runId, run.id)))
    .innerJoin(statusDecisions, and(eq(statusDecisions.companyId, workAssessments.companyId),
      eq(statusDecisions.assessmentId, workAssessments.id), eq(statusDecisions.id, coordinator.decisionId)))
    .where(and(eq(nativeRunResults.companyId, run.companyId), eq(nativeRunResults.issueId, run.nativeIssueId),
      eq(nativeRunResults.runId, run.id), eq(nativeRunResults.id, coordinator.resultId), eq(nativeRunResults.schemaStatus, "accepted"),
      eq(statusDecisions.issueId, run.nativeIssueId), eq(statusDecisions.runId, run.id), eq(statusDecisions.toStatus, "blocked"),
      eq(statusDecisions.applicationState, "applied"), eq(statusDecisions.reasonCode, "durable_dependency_blocker_bound"))).for("share");
  if (!committed || !committed.decision.appliedAt) return reject();
  const resultEnvelope = nativeSourceRecord(committed.accepted.resultJson), result = nativeSourceRecord(resultEnvelope.result);
  const terminal = nativeSourceRecord(resultEnvelope.terminal), decision = nativeSourceRecord(committed.decision.decisionJson);
  const runResult = nativeSourceRecord(run.resultJson);
  if (result.schema !== "paperclip.run_result.v1" || result.reportedWorkDisposition !== "blocked" ||
      nativeSourceRecord(result.completionClaim).objectiveSatisfied !== false ||
      terminal.reportedWorkDisposition !== "blocked" || terminal.runTerminalState !== "succeeded" || terminal.turnTerminalState !== "completed" ||
      committed.accepted.completionContractId !== run.completionContractId || decision.statusAction !== "preserve" ||
      !Array.isArray(decision.effects) || decision.effects.length !== 0 ||
      runResult.finalizationPhase !== "committed" || runResult.assessmentId !== coordinator.assessmentId || runResult.decisionId !== coordinator.decisionId)
    return reject();
  const [effect] = await db.select({ id: statusDecisionEffects.id }).from(statusDecisionEffects).where(and(
    eq(statusDecisionEffects.companyId, run.companyId), eq(statusDecisionEffects.issueId, run.nativeIssueId),
    eq(statusDecisionEffects.decisionId, coordinator.decisionId))).limit(1).for("share");
  const { acceptedResponseDigestMatches } = await import("./native-runtime/native-run-finalizer.js");
  if (effect || !await acceptedResponseDigestMatches(db, run, committed.accepted)) return reject();
  const [queue] = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, run.companyId),
    eq(agentWakeupRequests.id, run.wakeupRequestId), eq(agentWakeupRequests.agentId, run.agentId), eq(agentWakeupRequests.runId, run.id))).for("share");
  if (!committed || !queue || queue.status !== "completed" || queue.requestedByActorType !== "user" || !queue.requestedByActorId || value.requestedByUserId !== queue.requestedByActorId ||
      !["automation", "on_demand"].includes(queue.source) || nativeSourceRecord(queue.payload).issueId !== run.nativeIssueId ||
      !["issue_commented", "issue_comment_mentioned"].includes(queue.reason ?? "")) return reject();
  const human: AuthorizationActor = { type: "board", source: "session", userId: queue.requestedByActorId };
  const [currentTask] = await db.select().from(issues).where(and(eq(issues.companyId, run.companyId), eq(issues.id, run.nativeIssueId))).for("share");
  if (!currentTask || !await canActorReadIssuePrivacy(db, actor, currentTask) || !await canActorReadIssuePrivacy(db, human, currentTask)) return reject();
  if (!await nativeSourceReaderHasCompanyAccess(db, run.companyId, actor) || !await nativeSourceReaderHasCompanyAccess(db, run.companyId, human) ||
      !await canActorReadHeartbeatRunPrivacy(db, actor, { id: run.id, companyId: run.companyId }) ||
      !await canActorReadHeartbeatRunPrivacy(db, human, { id: run.id, companyId: run.companyId })) return reject();
  const commentSources = nativePayloadSourceInputSchema.array().max(256).safeParse(value.commentSources);
  const originalIds = nativeTaskWakeOriginCommentIds(queue.payload).sort();
  if (!commentSources.success || !originalIds.length || commentSources.data.some(source => source.kind !== "comment" ||
      source.issueId !== run.nativeIssueId || !bootstrapInputs.some(input => isDeepStrictEqual(input, source))) ||
      !isDeepStrictEqual([...new Set(commentSources.data.flatMap(source => source.kind === "comment" ? [source.commentId] : []))].sort(), originalIds)) return reject();
  const selectedComments: NativeBlockedHumanInteraction["commentSources"] = [];
  const selectedSnapshots: NativeBlockedHumanInteraction["commentSourceSnapshots"] = [];
  for (const source of commentSources.data) {
    if (source.kind !== "comment") return reject();
    const [comment] = await db.select().from(issueComments).where(and(eq(issueComments.companyId, run.companyId),
      eq(issueComments.issueId, run.nativeIssueId), eq(issueComments.id, source.commentId), isNull(issueComments.deletedAt))).for("share");
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(comment?.payloadSourceSnapshot);
    if (!comment || comment.authorType !== "user" || comment.authorAgentId || comment.createdByRunId ||
        comment.authorUserId !== queue.requestedByActorId || !snapshot.success) return reject();
    await assertConversationCommentSourceCurrent(db, { companyId: run.companyId, actor, source,
      policy: snapshot.data.policy, inputs: [...snapshot.data.inputs, source] }, scope);
    selectedComments.push(source);
    selectedSnapshots.push({ input: source, payloadSourceSnapshot: snapshot.data });
  }
  if (!Array.isArray(value.blockers) || !value.blockers.length || value.blockers.length > 256 ||
      !Array.isArray(value.unresolvedBlockerIssueIds) || value.unresolvedBlockerIssueIds.some(id => typeof id !== "string")) return reject();
  const blockers: NativeBlockedHumanInteraction["blockers"] = [];
  for (const raw of value.blockers) {
    const blocker = nativeSourceRecord(raw), summary = nativeSourceRecord(blocker.summary);
    const source = nativePayloadSourceInputSchema.safeParse(blocker.source);
    if (!source.success || source.data.kind !== "task" || summary.id !== source.data.issueId ||
        !bootstrapInputs.some(input => isDeepStrictEqual(input, source.data))) return reject();
    const [task] = await db.select().from(issues).where(and(eq(issues.companyId, run.companyId), eq(issues.id, source.data.issueId))).for("share");
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(task?.payloadSourceSnapshot);
    const capturedSnapshot = nativePayloadSourceSnapshotSchema.safeParse(blocker.payloadSourceSnapshot);
    if (!task || !snapshot.success || !capturedSnapshot.success || snapshot.data.digest !== capturedSnapshot.data.digest ||
        !await canActorReadIssuePrivacy(db, actor, task) || !await canActorReadIssuePrivacy(db, human, task) ||
        summary.identifier !== task.identifier || summary.title !== task.title || typeof summary.status !== "string" ||
        typeof summary.priority !== "string" || !(summary.assigneeAgentId === null || typeof summary.assigneeAgentId === "string") ||
        !(summary.assigneeUserId === null || typeof summary.assigneeUserId === "string")) return reject();
    await assertNativeTaskSourceInputCurrentInScope(db, run.companyId, actor, source.data, scope);
    blockers.push({ source: source.data, payloadSourceSnapshot: capturedSnapshot.data,
      summary: { id: task.id, identifier: task.identifier, title: task.title, status: summary.status, priority: summary.priority,
        assigneeAgentId: summary.assigneeAgentId, assigneeUserId: summary.assigneeUserId } });
  }
  const ids = value.unresolvedBlockerIssueIds as string[];
  if (!isDeepStrictEqual([...ids].sort(), blockers.map(blocker => blocker.summary.id).sort()) ||
      !Array.isArray(wake.unresolvedBlockerIssueIds) || !isDeepStrictEqual([...wake.unresolvedBlockerIssueIds].sort(), [...ids].sort()) || !isDeepStrictEqual(wake.unresolvedBlockerSummaries, blockers.map(blocker => blocker.summary))) return reject();
  return { companyId: run.companyId, issueId: run.nativeIssueId, runId: run.id, agentId: run.agentId,
    responsibleUserId: run.responsibleUserId, wakeupRequestId: run.wakeupRequestId, requestedByUserId: queue.requestedByActorId,
    commentSources: selectedComments, commentSourceSnapshots: selectedSnapshots, blockers, unresolvedBlockerIssueIds: ids };
}

/** Current paid/tool/wire owner. The lower reader never recursively reads
 * its own bootstrap wake; this wrapper validates that full retained prefix. */
export async function captureNativeBlockedHumanInteraction(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string;
}, expected?: NativeBlockedHumanInteraction): Promise<NativeBlockedHumanInteraction | null> {
  return inNativeSourceReadTransaction(db, async tx => {
    const capture = await readNativeBlockedHumanInteractionOwner(tx, input, expected);
    if (!capture) return null;
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId)));
    const receipt = nativeRunInputSourceReceiptSchema.safeParse(run?.runnerProfileJson?.nativeInputSourceReceipt);
    if (run?.runnerProfileJson?.nativeInputSourceReceipt && !receipt.success)
      throw forbidden("The original dependency interaction source is unavailable");
    if (receipt.success) await assertNativePayloadSourceSetCurrent(tx, { ...input,
      actor: { type: "agent", source: "agent_jwt", companyId: input.companyId, agentId: input.agentId,
        runId: input.runId, onBehalfOfUserId: capture.responsibleUserId }, ...receipt.data.bootstrap });
    return capture;
  });
}

/** Exact server definitions used by the existing managed bridge. The hash is
 * recoverable from actual wire intents even if a mutable catalog is removed. */
function nativeBlockedHumanInteractionCatalogHash(): string {
  return nativeSha256([
    ...CAPABILITY_SEMANTIC_TOOL_CATALOG.filter(tool => NATIVE_BLOCKED_INTERACTION_READ_TOOLS.has(tool.operationId))
      .map(tool => ({ name: tool.operationId, description: tool.description, inputSchema: tool.inputSchema })),
    ...codexSemanticToolSpecs().map(tool => ({ ...structuredClone(tool),
      inputSchema: { ...nativeSourceRecord(tool.inputSchema), additionalProperties: false } })),
  ]);
}

/** A retained actual catalog/hash only tightens; it never admits a Human. */
function nativeBlockedHumanInteractionCatalog(run: typeof heartbeatRuns.$inferSelect | undefined, input: {
  companyId: string; issueId: string; runId: string; agentId: string;
}): boolean {
  const profile = nativeSourceRecord(run?.runnerProfileJson);
  const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  const rawExecution = nativeSourceRecord(profile.nativeExecutionInput);
  if (nativeSourceRecord(rawExecution.provider).kind !== "opencode") return false;
  const authority = nativeSourceRecord(profile.nativeOpenCodeSourceAuthority);
  const wireIntents = Array.isArray(profile.nativeAwModelWireIntents) ? profile.nativeAwModelWireIntents.map(nativeSourceRecord) : [];
  const restrictedHash = nativeBlockedHumanInteractionCatalogHash();
  const originalRestrictedDispatch = wireIntents.some(intent => intent.modelPurpose === "worker_model" && intent.toolSchemasHash === restrictedHash);
  const restrictedCatalog = authority.toolSchemasHash === restrictedHash;
  // The feature has no legacy restricted dispatches. An absent optional hash
  // never reclassifies an ordinary legacy/full-catalog Run.
  if (!originalRestrictedDispatch && !restrictedCatalog) return false;
  let execution: ReturnType<typeof parseNativeExecutionInput>;
  try { execution = parseNativeExecutionInput(rawExecution); }
  catch { throw forbidden("The original dependency interaction catalog is unavailable"); }
  if (!receipt.success || authority.version !== 1 || !Array.isArray(authority.toolSchemas) ||
      authority.toolSchemasHash !== restrictedHash || nativeSha256(authority.toolSchemas) !== restrictedHash ||
      authority.executionInputHash !== nativeSha256(rawExecution) ||
      !isDeepStrictEqual({ companyId: execution.binding.companyId, issueId: execution.binding.issueId,
        runId: execution.binding.runId, agentId: execution.binding.agentId }, input) ||
      !isDeepStrictEqual({ companyId: receipt.data.binding.companyId, issueId: receipt.data.binding.issueId,
        runId: receipt.data.binding.runId, agentId: receipt.data.binding.agentId }, input))
    throw forbidden("The original dependency interaction catalog changed");
  const acknowledged = [receipt.data.bootstrap, ...receipt.data.dispatches, ...receipt.data.additionalInputs]
    .flatMap(set => set.inputs).filter((source): source is Extract<NativePayloadSourceInput, { kind: "worker_model_dispatch" }> =>
      source.kind === "worker_model_dispatch" && source.runId === input.runId);
  if (wireIntents.some(intent => intent.modelPurpose === "worker_model" && intent.toolSchemasHash !== restrictedHash) ||
      acknowledged.some(source => wireIntents.filter(intent => intent.modelPurpose === "worker_model" &&
        intent.reservationId === source.reservationId && intent.callId === source.callId && intent.requestHash === source.requestHash &&
        intent.wireBodyHash === source.wireBodyHash && intent.responseContentHash === source.responseHash &&
        intent.toolSchemasHash === restrictedHash).length !== 1))
    throw forbidden("The original dependency interaction dispatch catalog changed");
  return true;
}

export const NATIVE_BLOCKED_INTERACTION_READ_TOOLS: ReadonlySet<string> = new Set([
  "get_task_context", "get_task_history", "read_document",
]);

export async function assertNativeBlockedInteractionResult(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string;
}, result: unknown): Promise<void> {
  const [accepted] = await db.select({ resultJson: nativeRunResults.resultJson }).from(nativeRunResults)
    .where(and(eq(nativeRunResults.companyId, input.companyId), eq(nativeRunResults.issueId, input.issueId),
      eq(nativeRunResults.runId, input.runId), eq(nativeRunResults.schemaStatus, "accepted"))).limit(1);
  // An exact retained duplicate is not a new result or a new grant. Each result
  // owner still checks its original binding/fingerprint before returning it.
  if (accepted && isDeepStrictEqual(nativeSourceRecord(accepted.resultJson).result, result)) return;
  const capture = await captureNativeBlockedHumanInteraction(db, input);
  if (!capture) return;
  const value = nativeSourceRecord(result), claim = nativeSourceRecord(value.completionClaim);
  if (value.reportedWorkDisposition !== "blocked" || claim.objectiveSatisfied !== false ||
      !Array.isArray(claim.criteria) || claim.criteria.some(item => nativeSourceRecord(item).status === "satisfied") ||
      !Array.isArray(claim.remainingWork) || !claim.remainingWork.some(item => nativeSourceRecord(item).blocksCompletion === true) ||
      !Array.isArray(value.attentionRequests) || value.attentionRequests.length || !Array.isArray(value.artifacts) || value.artifacts.length)
    throw forbidden("A dependency interaction may only report its existing blocked work");
}

/** Revalidate one exact captured Task body against its original owner snapshot,
 * current ACL, and erasure state. This checks source currentness only; callers
 * that qualify a model result must still prove receipt membership and dispatch. */
export async function assertNativeTaskSourceOwnerCurrent(db: Db | Transaction, input: {
  companyId: string;
  actor: AuthorizationActor;
  source: Extract<NativePayloadSourceInput, { kind: "task" }>;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    await assertNativeTaskSourceInputCurrentInScope(tx, input.companyId, input.actor, input.source, scope);
  }));
}

/** Recheck a Task reader under that Task's own immutable protocol-1 Context
 * prefix. Memory readers may contain several Tasks captured at different
 * points in time; applying the enclosing Memory prefix to each Task would let
 * a later Context retroactively change an earlier Task's reader result. */
export async function canActorReadNativeTaskSource(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; issueId: string;
}): Promise<boolean | null> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    const [owner] = await tx.select({ payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion,
      payloadSourceSnapshot: issues.payloadSourceSnapshot }).from(issues).where(and(
      eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).for("share");
    if (!owner) return false;
    if (owner.payloadSourceProtocolVersion === 0 || owner.payloadSourceProtocolVersion === null) return null;
    if (owner.payloadSourceProtocolVersion !== 1) return false;
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(owner.payloadSourceSnapshot);
    if (!snapshot.success || snapshot.data.owner.kind !== "issue" || snapshot.data.owner.companyId !== input.companyId ||
      snapshot.data.owner.id !== input.issueId) return false;
    if (!snapshot.data.inputs.some(source => source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch"))
      return null;
    try {
      return await withReadPinnedNativeTaskSnapshot(tx, input.actor, input.companyId, input.issueId,
        async (currentOwnerHash, currentSnapshotDigest) => {
        if (currentOwnerHash !== snapshot.data.owner.contentHash || currentSnapshotDigest !== snapshot.data.digest)
          return false;
        const source: Extract<NativePayloadSourceInput, { kind: "task" }> = { kind: "task", issueId: input.issueId,
          sourceVersion: "snapshot-owner-current", contentHash: snapshot.data.owner.contentHash };
        await assertNativeTaskSourceInputCurrentInScope(tx, input.companyId, input.actor, source, scope);
        const readable = await canActorReadIssuePrivacy(tx, input.actor, { id: input.issueId, companyId: input.companyId });
        return readable;
      });
    } catch (error) {
      if (error instanceof HttpError && [403, 404, 409, 422].includes(error.status)) {
        return false;
      }
      throw error;
    }
  })).catch(error => {
    // This reader predicate also withholds a public admission/final-check
    // denial, including a revocation within the same transaction.
    if (error instanceof HttpError && [403, 404, 409, 422].includes(error.status)) return false;
    throw error;
  });
}

async function assertNativePayloadSourceSetCurrentInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}, scope: NativeSourceReadScope, completedTaskSourceProofs?: NativeCompletedTaskSourceProofs,
  validatedDispatchSources?: ReadonlySet<string>, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map(), consumerCover?: NativePayloadSourceSet,
  historicalDocumentDepthHint = 0, historicalTransition?: NativeHistoricalPendingTransitionContext): Promise<void> {
  if (historicalTransition) disableNativeSourceGraphCheckpoints(scope);
  const policy = nativePayloadSourcePolicySchema.safeParse(input.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(input.inputs);
  if (!policy.success || !inputs.success)
    throw forbidden("The Native source prefix is unavailable");
  const completeKey = `payload-source-set:${nativeSha256({ companyId: input.companyId, issueId: input.issueId,
    runId: input.runId, actor: input.actor, actorScope: scope.actorKey, memoryTemporalIdentity: scope.context.memoryTemporalIdentity,
    policy: policy.data, inputs: inputs.data, historicalTransition: historicalTransition ?? null })}`;
  return withNativeSourceGraphProof(scope, siblingToolSourceProofs, completeKey, {
    companyId: input.companyId, runId: input.runId, actor: input.actor, policy: policy.data, inputs: inputs.data,
  }, async () => {
    await assertNativePayloadSourceSetCurrentUncachedInScope(db, {
      ...input, policy: policy.data, inputs: inputs.data,
    }, scope, true, completedTaskSourceProofs, validatedDispatchSources, siblingToolSourceProofs, consumerCover, historicalDocumentDepthHint, historicalTransition);
    deferNativeSourceReaderCheck(scope, { companyId: input.companyId, runId: input.runId, actor: input.actor,
      policy: policy.data, inputs: inputs.data });
  }, historicalDocumentDepthHint);
}

/** Validate a newly returned Native read result against its original owners
 * before the result is appended to the Run receipt. This deliberately skips
 * only receipt membership for the outer source set; it still requires the
 * current Run/receipt binding and runs the same current ACL, retention,
 * version, body-hash, and nested-owner checks as an already-recorded set.
 * Read results cannot bootstrap another tool result or model dispatch. */
export async function assertNativeReadResultSourceSetOwnersCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  tool: "get_task_context" | "get_task_history" | "read_chat_attachment" | "query_business_metric";
  sourceSet: NativePayloadSourceSet; resultDigest?: string;
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
  const {NATIVE_ANALYTICAL_RESULT_POLICY_HASH}=await import("./analytical-context-privacy.js");
  const exactAnalyticalResult = policy.success && inputs.success && inputs.data.length === 1 &&
    inputs.data[0]?.kind === "context" && input.resultDigest === inputs.data[0].queryHash &&
    inputs.data[0].policySnapshotHash === NATIVE_ANALYTICAL_RESULT_POLICY_HASH &&
    isDeepStrictEqual(policy.data,{issueIds:[input.issueId],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]});
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
    (input.tool === "query_business_metric" && !exactAnalyticalResult) ||
    (input.tool === "get_task_history" && !exactEmptyHistory &&
      (taskComments.length === 0 || taskComments.some(source => source.issueId !== input.issueId))) ||
    (input.tool === "read_chat_attachment" && deliveredAttachments.every(source => source.issueId !== input.issueId)))
    throw forbidden("The Native read result source set is unavailable");
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    if (!await nativeSourceReaderHasCompanyAccess(tx, input.companyId, input.actor))
      throw forbidden("The Native read result source set is unavailable");
    if(input.tool==="query_business_metric"){
      const boundRun=await nativeSourceReadRun(tx,input.companyId,input.runId,scope);
      if(!boundRun)throw forbidden("The Native analytical read result binding is unavailable");
      const source=inputs.data[0];
      const [manifest]=source?.kind==="context"?await tx.select({id:contextManifests.id}).from(contextManifests).where(and(
        eq(contextManifests.companyId,input.companyId),eq(contextManifests.id,source.manifestId),
        eq(contextManifests.runId,input.runId),eq(contextManifests.issueId,input.issueId),
        eq(contextManifests.agentId,boundRun.agentId),isNull(contextManifests.projectId))).for("share"):[];
      if(!manifest)throw forbidden("The Native analytical read result binding is unavailable");
    }
    return assertNativePayloadSourceSetCurrentUncachedInScope(tx, {
      companyId: input.companyId, issueId: input.issueId, runId: input.runId, actor: input.actor,
      policy: policy.data, inputs: inputs.data,
    }, scope, false);
  }));
}

async function assertNativePayloadSourceSetCurrentUncachedInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
}, scope: NativeSourceReadScope, requireReceiptMembership = true,
  completedTaskSourceProofs?: NativeCompletedTaskSourceProofs, validatedDispatchSources?: ReadonlySet<string>,
  siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map(), consumerCover?: NativePayloadSourceSet,
  historicalDocumentDepthHint = 0, historicalTransition?: NativeHistoricalPendingTransitionContext): Promise<void> {
  if (historicalTransition) disableNativeSourceGraphCheckpoints(scope);
  const policy = nativePayloadSourcePolicySchema.safeParse(input.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(input.inputs);
  if (!policy.success || !inputs.success)
    throw forbidden("The Native source prefix is unavailable");
  excludeUnpinnedNativeSourceProofs(scope, policy.data, inputs.data);
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
        capture.tool, scope, Math.max(0, historicalDocumentDepthHint - 1), input.actor, "settled", siblingToolSourceProofs, historicalTransition);
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
      for (const source of sources) {
        const proofIdentity = !historicalTransition?.stageBodyReads?.length && completedTaskSourceProofs && nativeManagedConsumedTaskSourceProofIdentity(input.companyId,
          input.actor, source, scope.context.memoryTemporalIdentity);
        const taskProof = proofIdentity ? completedTaskSourceProofs?.get(proofIdentity) : undefined;
        if (taskProof && taskProof.mutableSources.compatible && !scope.context.ancestry.graphProofsDisabled &&
          !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, taskProof.descendants)) {
          recordNativeProofReaderSetUse(scope, taskProof.readerSets);
          nativeSourceReadWork(scope);
          propagateNativeMutableSources(scope, taskProof.mutableSources);
          for (const parent of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? [])
            for (const descendant of taskProof.descendants) parent.descendants.add(descendant);
          // Receipt/component membership is still checked independently for
          // every cumulative component. This local traversal may reuse only
          // the exact Task owner+snapshot proof whose row was FOR SHARE pinned
          // earlier in this read-only traversal; current reader ACL is queued
          // again for the mandatory after-wait pass.
          deferNativeSourceOwnerReaderChecks(scope, { companyId: input.companyId, actor: input.actor,
            issueIds: [source.issueId] });
          continue;
        }
        let taskProofStack = scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey);
        if (!taskProofStack) {
          taskProofStack = [];
          scope.context.ancestry.frozenTaskProofStacks.set(scope.actorKey, taskProofStack);
        }
        const taskFrame: NativeSourceProofFrame = { visitKey: typeof proofIdentity === "string" ? proofIdentity : "", descendants: new Set<string>(), mutableSources: newNativeMutableSources(),
          readerSelection: { context: scope.context, sets: new Map(), complete: true } };
        taskProofStack.push(taskFrame);
        try {
          const snapshotDigest = await assertNativeTaskSourceInputCurrentInScope(db, input.companyId, input.actor, source, scope, siblingToolSourceProofs, historicalTransition);
          if (proofIdentity && snapshotDigest) completedTaskSourceProofs!.set(proofIdentity, {
            key: nativeManagedConsumedTaskSourceProofKey(input.companyId, input.actor, source, snapshotDigest,
              scope.context.memoryTemporalIdentity), descendants: taskFrame.descendants, mutableSources: taskFrame.mutableSources,
            ...(taskFrame.readerSelection?.complete ? { readerSets: new Map(taskFrame.readerSelection.sets) } : {}) });
        } finally {
          if (taskProofStack.at(-1) === taskFrame) taskProofStack.pop();
        }
      }
    } else await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, issueId, scope, undefined, undefined, siblingToolSourceProofs);
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
  // Exact Memory inputs below perform their own current ACL check alongside
  // version/body validation. Batch the policy-only roots so the same live
  // principal is checked once around their shared retained-owner traversal.
  const policyOnlyMemoryIds = policy.data.memoryIds.filter(memoryId => !exactMemoryInputIds.has(memoryId));
  for (const _memoryId of policyOnlyMemoryIds) nativeSourceReadWork(scope);
  if (policyOnlyMemoryIds.length) {
    if (!await canActorReadMemorySourceSet(db as Db, input.companyId, input.actor, policyOnlyMemoryIds,
      undefined, undefined, scope.context.active ? { nativeInspection: true } : {}))
      throw forbidden("A Native source Memory is unavailable");
  }
  const contexts = inputs.data.filter((source): source is Extract<NativePayloadSourceInput, { kind: "context" }> => source.kind === "context");
  await assertNativeTemporalContextInputsCurrent(db as Db, input.companyId, contexts);
  await assertNativeContextInputOwnersCurrent(db as Db, input.companyId, input.actor, contexts, scope,
    new Set(policy.data.memoryIds.filter(memoryId => !exactMemoryInputIds.has(memoryId))), completedTaskSourceProofs, siblingToolSourceProofs);
  for (const source of inputs.data) {
    if (source.kind === "task" || source.kind === "project" || source.kind === "project_workspace" || source.kind === "context") continue;
    if ((source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch") &&
      validatedDispatchSources?.has(nativeSha256({ companyId: input.companyId, source }))) continue;
    let runLeafProofKey: string | null = null;
    if (requireReceiptMembership) {
      if (source.kind === "workspace_metadata" || source.kind === "runtime_instructions")
        runLeafProofKey = nativeManagedSourceLeafProofKey(input.companyId, input.issueId, input.runId, source, scope);
    }
    if (runLeafProofKey && scope.completedImmutableSourceLeafProofs.has(runLeafProofKey)) {
      nativeSourceReadWork(scope);
      continue;
    }
    const completionContractProofHit = source.kind === "completion_contract" &&
      hasNativeCompletionContractSourceProof(input.companyId, input.runId, source, scope);
    if (!completionContractProofHit) nativeSourceReadWork(scope);
    if (source.kind === "retained_run") {
      if (!input.policy.runIds.includes(source.runId)) throw forbidden("A retained Native Run is unavailable");
      const previous = await nativeSourceReadRun(db, input.companyId, source.runId, scope);
      const currentProfile = profile;
      const targetKind = currentProfile?.nativeToolContractFingerprint === nativeToolContractFingerprintForTarget("remote")
        ? "remote" : currentProfile?.nativeToolContractFingerprint === nativeToolContractFingerprintForTarget("local") ? "local" : null;
      let currentExecution: ReturnType<typeof parseNativeExecutionInput> | null = null;
      try {
        if (currentProfile?.nativeExecutionInput !== undefined) currentExecution = parseNativeExecutionInput(currentProfile.nativeExecutionInput);
      } catch { currentExecution = null; }
      const generationValue = run.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
        ? (run.contextSnapshot as Record<string, unknown>).conversationSessionGeneration : undefined;
      const generation = Number.isSafeInteger(generationValue) && (generationValue as number) >= 0 ? generationValue as number : null;
      const [sourceIssue] = await db.select({ conversationAgentId: issues.conversationAgentId,
        conversationSessionGeneration: issues.conversationSessionGeneration,
        conversationState: issues.conversationState, conversationRetiredAt: issues.conversationRetiredAt }).from(issues).where(and(
        eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).for("share");
      const witness = previous && currentExecution && targetKind
        ? nativeRetainedRunResumeWitness({ previousRun: previous, currentExecution,
          currentResponsibleUserId: run.responsibleUserId ?? null,
          currentConversationSessionGeneration: generation,
          requireConversationGeneration: sourceIssue?.conversationAgentId != null, executionTargetKind: targetKind })
        : null;
      const conversationGenerationCurrent = sourceIssue?.conversationAgentId == null ||
        (sourceIssue.conversationSessionGeneration === generation && ["active", "waiting"].includes(sourceIssue.conversationState ?? "") &&
          sourceIssue.conversationRetiredAt === null);
      if (!previous || !sourceIssue || !conversationGenerationCurrent || !witness || !isDeepStrictEqual(witness.source, source) ||
        !await canActorReadHeartbeatRunPrivacy(db, input.actor, { id: previous.id, companyId: input.companyId }))
        throw forbidden("The retained Native Run witness is unavailable");
      const parentTransition = await nativeHistoricalPendingContextForParent(db, scope, { companyId: input.companyId,
        issueId: input.issueId, consumerRunId: run.id, parent: previous, actor: input.actor, inherited: historicalTransition, edge:{kind:"retained_run",digest:nativeSha256({source,witness})} });
      for (const componentSet of witness.sets) {
        await assertNativePayloadSourceSetCurrentInScope(db, { companyId: input.companyId, issueId: input.issueId,
          runId: previous.id, actor: input.actor, policy: componentSet.policy, inputs: componentSet.inputs }, scope,
          undefined, undefined, new Map(), undefined, 0, parentTransition);
      }
      continue;
    }
    if (source.kind === "completion_contract") {
      await assertNativeCompletionContractSourceCurrent(db, input.companyId, input.runId, source, scope);
      continue;
    }
    if (source.kind === "document_revision" && source.issueId) {
      await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId: input.companyId, issueId: source.issueId,
        revisionId: source.revisionId, actor: input.actor, requireLatest: false }, scope, 0, siblingToolSourceProofs);
      continue;
    }
    if (source.kind === "memory") {
      if (!input.policy.memoryIds.includes(source.memoryId)) throw forbidden("A Native source Memory is unavailable");
      const evidence = await nativeMemoryReviewEvidenceFromSourceSet(db, input.companyId, source, inputs.data,
        receipt.success ? receipt.data : undefined, scope);
      await assertNativeMemorySourceCurrent(db, input.companyId, input.actor, source, evidence, scope);
      continue;
    }
    if (source.kind === "workspace_metadata") {
      await assertNativeWorkspaceMetadataSourcesCurrent(db as Db, input.companyId, [source], scope);
      if (runLeafProofKey && scope.completedImmutableSourceLeafProofs.size < 512)
        scope.completedImmutableSourceLeafProofs.add(runLeafProofKey);
      continue;
    }
    if (source.kind === "runtime_instructions") {
      await assertNativeRuntimeInstructionsCurrent(db, input.companyId, input.runId, source);
      if (runLeafProofKey && scope.completedImmutableSourceLeafProofs.size < 512)
        scope.completedImmutableSourceLeafProofs.add(runLeafProofKey);
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
      recordNativeRuntimeSkillRead(db, input.companyId, input.actor, source, input.runId);
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
      const sourceRun = source.runId === input.runId ? run : await nativeSourceReadRun(db, input.companyId, source.runId, scope);
      const sourceProfile = sourceRun?.runnerProfileJson && typeof sourceRun.runnerProfileJson === "object" && !Array.isArray(sourceRun.runnerProfileJson)
        ? sourceRun.runnerProfileJson as Record<string, unknown> : null;
      const sourceReceipt = sourceProfile && nativeRunInputSourceReceiptSchema.safeParse(sourceProfile.nativeInputSourceReceipt);
      const sourceBindingCurrent = Boolean(sourceRun?.runtimeMode === "native" && sourceReceipt?.success &&
        sourceReceipt.data.binding.companyId === input.companyId && sourceReceipt.data.binding.runId === source.runId &&
        sourceReceipt.data.binding.agentId === sourceRun.agentId && sourceReceipt.data.binding.issueId === source.issueId &&
        sourceReceipt.data.binding.responsibleUserId === (sourceRun.responsibleUserId ?? null));
      if (!sourceRun || !sourceBindingCurrent || !sourceReceipt?.success || sourceRun.nativeIssueId !== source.issueId || !task ||
        task.sourceVersion !== source.sourceVersion || !isDeepStrictEqual(sourceReceipt.data.bootstrap.inputs.find(value =>
          value.kind === "native_task_wake" && value.runId === source.runId), source))
        throw forbidden("A Native task wake source changed");
      await assertNativeTaskWakeSourceCurrentInScope(db, scope, { companyId: input.companyId, issueId: source.issueId,
        runId: source.runId, actor: input.actor, source, inputs: inputs.data, bootstrapInputs: sourceReceipt.data.bootstrap.inputs, historicalTransition });
      continue;
    }
    if (source.kind === "worker_model_dispatch") {
      const dispatchRun = source.runId === input.runId ? run : await nativeSourceReadRun(db, input.companyId, source.runId, scope);
      const dispatchProfile = dispatchRun?.runnerProfileJson && typeof dispatchRun.runnerProfileJson === "object" && !Array.isArray(dispatchRun.runnerProfileJson)
        ? dispatchRun.runnerProfileJson as Record<string, unknown> : null;
      const dispatchReceipt = dispatchProfile && nativeRunInputSourceReceiptSchema.safeParse(dispatchProfile.nativeInputSourceReceipt);
      const dispatchBindingCurrent = Boolean(dispatchRun?.runtimeMode === "native" && dispatchReceipt?.success &&
        dispatchReceipt.data.binding.companyId === input.companyId && dispatchReceipt.data.binding.runId === source.runId &&
        dispatchReceipt.data.binding.agentId === dispatchRun.agentId && dispatchReceipt.data.binding.issueId === dispatchRun.nativeIssueId &&
        dispatchReceipt.data.binding.responsibleUserId === (dispatchRun.responsibleUserId ?? null));
      const intents = Array.isArray(dispatchProfile?.nativeAwModelWireIntents)
        ? dispatchProfile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).reservationId === source.reservationId) as Record<string, unknown>[] : [];
      const intent = intents[0];
      const exactSourceDispatchPrefix = dispatchReceipt?.success && intent && typeof intent.sourceDispatchDigest === "string"
        ? dispatchReceipt.data.dispatches.some(prefix => prefix.executionInputDigest === intent.sourceDispatchDigest &&
            prefix.inputs.some(value => value.kind === "worker_model_dispatch" && isDeepStrictEqual(value, source)))
        : false;
      const conflictingCopies = dispatchReceipt?.success && dispatchReceipt.data.dispatches.some(prefix => prefix.inputs.some(value =>
        value.kind === "worker_model_dispatch" && value.reservationId === source.reservationId && !isDeepStrictEqual(value, source)));
      if (intent?.toolSchemasHash !== undefined) {
        const catalog = nativeSourceRecord(dispatchProfile?.nativeOpenCodeSourceAuthority);
        if (typeof intent.toolSchemasHash !== "string" || !/^[0-9a-f]{64}$/.test(intent.toolSchemasHash) ||
            !Array.isArray(catalog.toolSchemas) || catalog.toolSchemasHash !== intent.toolSchemasHash ||
            nativeSha256(catalog.toolSchemas) !== intent.toolSchemasHash)
          throw forbidden("The Native historical dispatch catalog changed");
      }
      const reservation = await nativeSourceReadReservation(db, input.companyId, source.reservationId, scope);
      if (!dispatchRun || !dispatchBindingCurrent || !dispatchReceipt?.success || source.runId !== dispatchRun.id ||
        intents.length !== 1 || !exactSourceDispatchPrefix || conflictingCopies || !reservation ||
        reservation.purpose !== "worker_model" || reservation.status !== "completed" ||
        reservation.inputHash !== source.requestHash || reservation.providerResponseHash !== source.responseHash ||
        intent!.requestHash !== source.requestHash || intent!.wireBodyHash !== source.wireBodyHash ||
        typeof intent!.responseContentHash !== "string" || !/^[0-9a-f]{64}$/.test(intent!.responseContentHash) ||
        intent!.sourcePolicyHash !== nativeSha256(dispatchReceipt.data.bootstrap) ||
        intent!.endpoint !== "https://api.anthropic.com/v1/messages" || intent!.method !== "POST")
        throw forbidden("A Native historical model dispatch changed");
      continue;
    }
      if (source.kind === "conversation_model_dispatch") {
        const dispatchRun = source.runId === input.runId ? run : await nativeSourceReadRun(db, input.companyId, source.runId, scope);
        const dispatchProfile = dispatchRun?.runnerProfileJson && typeof dispatchRun.runnerProfileJson === "object" && !Array.isArray(dispatchRun.runnerProfileJson)
          ? dispatchRun.runnerProfileJson as Record<string, unknown> : null;
        const dispatchReceipt = dispatchProfile && nativeRunInputSourceReceiptSchema.safeParse(dispatchProfile.nativeInputSourceReceipt);
        const dispatchBindingCurrent = Boolean(dispatchRun?.runtimeMode === "native" && dispatchReceipt?.success &&
          dispatchReceipt.data.binding.companyId === input.companyId && dispatchReceipt.data.binding.runId === source.runId &&
          dispatchReceipt.data.binding.agentId === dispatchRun.agentId && dispatchReceipt.data.binding.issueId === dispatchRun.nativeIssueId &&
          dispatchReceipt.data.binding.responsibleUserId === (dispatchRun.responsibleUserId ?? null));
        const intents = Array.isArray(dispatchProfile?.nativeAwModelWireIntents)
          ? dispatchProfile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
              (value as Record<string, unknown>).reservationId === source.reservationId &&
              (value as Record<string, unknown>).modelPurpose === "conversation_model") as Record<string, unknown>[] : [];
        const intent = intents[0];
        const exactSourceDispatchPrefix = intent && typeof intent.sourceDispatchDigest === "string"
          ? dispatchReceipt?.success && dispatchReceipt.data.dispatches.some(prefix => prefix.executionInputDigest === intent.sourceDispatchDigest &&
              prefix.inputs.some(value => value.kind === "conversation_model_dispatch" && isDeepStrictEqual(value, source)))
          : false;
        const conflictingCopies = dispatchReceipt?.success && dispatchReceipt.data.dispatches.some(prefix => prefix.inputs.some(value =>
          value.kind === "conversation_model_dispatch" && value.reservationId === source.reservationId &&
          !isDeepStrictEqual(value, source)));
        const reservation = await nativeSourceReadReservation(db, input.companyId, source.reservationId, scope);
        const [manifest] = await db.select().from(agentExecutionManifests).where(and(
          eq(agentExecutionManifests.companyId, input.companyId), eq(agentExecutionManifests.id, source.executionManifestId),
          eq(agentExecutionManifests.agentId, source.agentId), eq(agentExecutionManifests.runId, source.runId))).for("share");
        const [conversationIssue] = await db.select().from(issues).where(and(
          eq(issues.companyId, input.companyId), eq(issues.id, source.issueId))).for("share");
        const binding = nativeSourceRecord(intent?.conversationModelBinding);
        if (!dispatchRun || !dispatchBindingCurrent || !dispatchReceipt?.success || source.runId !== dispatchRun.id ||
          source.agentId !== dispatchRun.agentId || source.issueId !== dispatchRun.nativeIssueId ||
          dispatchRun.responsibleUserId !== dispatchReceipt.data.binding.responsibleUserId ||
          dispatchRun.contextSnapshot?.conversationSessionGeneration !== source.conversationSessionGeneration ||
          !manifest || manifest.hash !== source.executionManifestHash || manifest.manifest.responsibleUserId !== dispatchRun.responsibleUserId ||
          !conversationIssue || conversationIssue.conversationAgentId !== source.agentId ||
          conversationIssue.conversationUserId !== run.responsibleUserId ||
          conversationIssue.conversationSessionGeneration < source.conversationSessionGeneration ||
          !["active", "waiting"].includes(conversationIssue.conversationState ?? "") ||
          conversationIssue.conversationRetiredAt !== null ||
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
          intent!.sourcePolicyHash !== nativeSha256(dispatchReceipt.data.bootstrap) ||
          intent!.endpoint !== "https://api.anthropic.com/v1/messages" || intent!.method !== "POST")
          throw forbidden("A Native historical conversation model dispatch changed");
        continue;
      }
    if (source.kind === "tool_result") {
      // Canonical producer identity is independent of the later consumer.
      const producerRun = await nativeSourceReadRun(db, input.companyId, source.runId, scope);
      if (!producerRun) throw forbidden("A Native historical tool result changed");
      const sourceProfile = producerRun?.runnerProfileJson && typeof producerRun.runnerProfileJson === "object" && !Array.isArray(producerRun.runnerProfileJson)
        ? producerRun.runnerProfileJson as Record<string, unknown> : null;
      const sourceReceipt = sourceProfile && nativeRunInputSourceReceiptSchema.safeParse(sourceProfile.nativeInputSourceReceipt);
      const sourceBindingCurrent = Boolean(producerRun?.runtimeMode === "native" && sourceReceipt?.success &&
        sourceReceipt.data.binding.companyId === input.companyId && sourceReceipt.data.binding.runId === source.runId &&
        sourceReceipt.data.binding.agentId === producerRun.agentId && sourceReceipt.data.binding.issueId === producerRun.nativeIssueId &&
        sourceReceipt.data.binding.responsibleUserId === (producerRun.responsibleUserId ?? null));
      const run = producerRun!;
      const profile = sourceProfile;
      const receipt = sourceReceipt;
      const captures = Array.isArray(profile?.nativeToolResultSourceCaptures)
        ? profile.nativeToolResultSourceCaptures.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).callId === source.callId &&
            typeof (value as Record<string, unknown>).tool === "string" &&
            nativeProviderToolName((value as Record<string, unknown>).tool as string) === source.toolName &&
            (value as Record<string, unknown>).resultDigest === source.contentHash &&
            isDeepStrictEqual((value as Record<string, unknown>).source, source)) as Record<string, unknown>[] : [];
      const capture = captures[0] ?? {};
      const producerEntry = receipt?.success ? receipt.data.additionalInputs.find(entry =>
        entry.inputs.some(value => value.kind === "tool_result" && isDeepStrictEqual(value, source))) : undefined;
      const producerClosures: NativePayloadSourceSet[] = producerEntry ? [producerEntry] : [];
      let producerClosureAvailable = Boolean(producerEntry && sourceBindingCurrent && captures.length === 1);
      const addProducerClosure = (value: unknown) => {
        const record = nativeSourceRecord(value);
        const parsedPolicy = nativePayloadSourcePolicySchema.safeParse(record.policy);
        const parsedInputs = nativePayloadSourceInputSchema.array().safeParse(record.inputs);
        if (parsedPolicy.success && parsedInputs.success)
          producerClosures.push({ policy: parsedPolicy.data, inputs: parsedInputs.data });
        else producerClosureAvailable = false;
      };
      if (capture.sourceSet !== undefined) addProducerClosure(capture.sourceSet);
      const contextClosure = nativeSourceRecord(capture.contextRead).sourceSet;
      if (contextClosure !== undefined) addProducerClosure(contextClosure);
      const producedDocument = nativeSourceRecord(capture.documentRevision);
      if (typeof producedDocument.revisionId === "string") {
        const [owner] = await db.select({ snapshot: documentRevisions.payloadSourceSnapshot }).from(documentRevisions)
          .where(and(eq(documentRevisions.companyId, input.companyId), eq(documentRevisions.id, producedDocument.revisionId))).for("share");
        const snapshot = nativePayloadSourceSnapshotSchema.safeParse(owner?.snapshot);
        if (snapshot.success) producerClosures.push({ policy: snapshot.data.policy, inputs: snapshot.data.inputs });
        else producerClosureAvailable = false;
      }
      const producedTask = nativeSourceRecord(capture.taskRef);
      if (typeof producedTask.issueId === "string") {
        const [owner] = await db.select({ snapshot: issues.payloadSourceSnapshot }).from(issues)
          .where(and(eq(issues.companyId, input.companyId), eq(issues.id, producedTask.issueId))).for("share");
        const snapshot = nativePayloadSourceSnapshotSchema.safeParse(owner?.snapshot);
        if (snapshot.success) producerClosures.push({ policy: snapshot.data.policy, inputs: snapshot.data.inputs });
        else producerClosureAvailable = false;
      }
      // This sibling ledger stays local to the component traversal. Keep
      // every original full prefix for receipt/evidence checks; never replace
      // those prefixes with a sliced union.
      const toolSourceVisitKey = `native-tool-source:${nativeSha256({ companyId: input.companyId,
        issueId: producerRun.nativeIssueId, runId: source.runId, actor: input.actor, actorScope: scope.actorKey,
        memoryTemporalIdentity: scope.context.memoryTemporalIdentity, source,
        captureHash: nativeSha256(capture), producerClosures })}`;
      if (scope.active.has(toolSourceVisitKey)) throw forbidden("The Native tool source graph contains a cycle");
      const siblingProofKey = source.toolName !== "create_project" && source.toolName !== "call_api" &&
        producerClosureAvailable && nativeGraphProofInputsEligible(policy.data, inputs.data) &&
        producerClosures.every(set => nativeGraphProofInputsEligible(set.policy, set.inputs)) ? toolSourceVisitKey : null;
      let siblingProof = siblingProofKey && !scope.context.ancestry.graphProofsDisabled ? siblingToolSourceProofs.get(siblingProofKey) : undefined;
      if (siblingProof && !siblingProof.mutableSources.compatible) siblingProof = undefined;
      // The enclosing saved consumer was already matched against every full
      // original component and its exact ordered union. Component receipt and
      // evidence checks still use input.policy/inputs unchanged.
      const cover = consumerCover ?? { policy: policy.data, inputs: inputs.data };
      const prefixCoversProof = siblingProof && (siblingProof.requiredSets ?? [siblingProof]).every(set =>
        set.inputs.every(required => cover.inputs.some(candidate => isDeepStrictEqual(candidate, required))) &&
        (Object.keys(cover.policy) as (keyof NativePayloadSourcePolicy)[]).every(key =>
          set.policy[key].every(id => cover.policy[key].includes(id))));
      if (siblingProof && prefixCoversProof &&
        !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, siblingProof.descendants)) {
        recordNativeProofReaderSetUse(scope, siblingProof.readerSets);
        propagateNativeMutableSources(scope, siblingProof.mutableSources);
        if (nativeSourceMemoDiagnosticsEnabled()) nativeSourceMemoDiagnostics.siblingToolSourceProofHits =
          Math.min(1_000_000, nativeSourceMemoDiagnostics.siblingToolSourceProofHits + 1);
        // Files can disappear while SQL owners remain pinned. Recheck the
        // exact producer bundles before reusing its structural closure.
        for (const set of siblingProof.requiredSets ?? [siblingProof]) for (const required of set.inputs) {
          if (required.kind === "runtime_skill")
            await assertNativeDocumentRuntimeSkillCurrent(db, input.companyId, input.actor, required, source.runId);
          if (required.kind === "runtime_instructions")
            await assertNativeRuntimeInstructionsCurrent(db, input.companyId, source.runId, required, scope);
        }
        // The source loop charged this hit above. Live authority and retention
        // are checked again by the mandatory current-reader pass.
        deferNativeSourceReaderCheck(scope, { companyId: input.companyId, runId: input.runId,
          actor: input.actor, policy: policy.data, inputs: inputs.data });
        for (const parent of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? [])
          for (const descendant of siblingProof.descendants) parent.descendants.add(descendant);
        continue;
      }
      let siblingProofStack = scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey);
      if (!siblingProofStack) {
        siblingProofStack = [];
        scope.context.ancestry.frozenTaskProofStacks.set(scope.actorKey, siblingProofStack);
      }
      addNativeSourceActiveVisit(scope, toolSourceVisitKey);
      const siblingFrame: NativeSourceProofFrame = { visitKey: toolSourceVisitKey, descendants: new Set([toolSourceVisitKey]), mutableSources: newNativeMutableSources(),
        readerSelection: { context: scope.context, sets: new Map(), complete: true } };
      if (siblingProofKey) siblingProofStack.push(siblingFrame);
      let siblingCompleted = false;
      try {
      const projectCreateCapture = nativeSourceRecord(capture.projectCreate);
      const projectCreateReceipt = nativeSourceRecord(projectCreateCapture.receipt);
      const managedProjectApiCreateResult = source.toolName === "call_api" && source.invocationId === null &&
        projectCreateReceipt.tool === "call_api";
      const stageCommentResult = source.toolName === "call_api" && source.invocationId === null && Object.hasOwn(capture,"stageComment");
      if (stageCommentResult && (capture.projectCreate !== undefined || capture.projectSource !== undefined || capture.operationId !== undefined))
        throw forbidden("A Native Stage API result has mixed owners");
      const projectApiResult = source.toolName === "call_api" && source.invocationId === null && !managedProjectApiCreateResult && !stageCommentResult;
      const managedProjectCreateResult = source.invocationId === null &&
        (source.toolName === "create_project" || managedProjectApiCreateResult);
      const managedConversationTaskResult = source.toolName === "create_task" && source.invocationId === null;
      const nativeReadResultTool = ["get_task_context", "get_task_history", "read_chat_attachment", "query_business_metric"].includes(source.toolName);
      if ((source.invocationId === null && !projectApiResult && !stageCommentResult && !managedProjectCreateResult &&
          !managedConversationTaskResult && !nativeReadResultTool) ||
        (source.toolName === "call_api" && source.invocationId !== null) ||
        (source.toolName === "create_project" && source.invocationId !== null))
        throw forbidden("A Native tool result requires its original succeeded invocation");
      const [invocation] = source.invocationId ? await db.select().from(toolInvocations).where(and(
        eq(toolInvocations.companyId, input.companyId), eq(toolInvocations.id, source.invocationId),
        eq(toolInvocations.runId, source.runId), eq(toolInvocations.status, "succeeded"),
        eq(toolInvocations.resultHash, source.contentHash))).for("share") : [];
      if (invocation) recordNativeMutableSourceRow(scope, "invocation", input.companyId, invocation);
      const matchingReceiptInputs = receipt?.success ? nativeToolResultReceiptCopies(receipt.data, source) : null;
      if (!producerRun || !sourceBindingCurrent || !receipt?.success || !matchingReceiptInputs || matchingReceiptInputs.exact < 1 || matchingReceiptInputs.conflicting ||
        matchingReceiptInputs.duplicateWithinEntry || captures.length !== 1 ||
        (projectApiResult || stageCommentResult || managedProjectCreateResult || managedConversationTaskResult || nativeReadResultTool ? invocation !== undefined : !invocation || invocation.issueId !== producerRun.nativeIssueId ||
          invocation.toolName !== source.toolName || invocation.idempotencyKey !== `aw-native-tool:${source.runId}:${source.callId}`))
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
      if (stageCommentResult) {
        const witness = nativeSourceRecord(capture.stageComment), output = nativeSourceRecord(witness.outputCapture);
        const producerIssueId = producerRun.nativeIssueId;
        if (!producerIssueId) throw forbidden("A Native Stage API Task is unavailable");
        const expectedKeys=["operationId","callId","argumentsHash","resultDigest","commentId","transitionHash","apiReceiptHash","outputCapture"].sort();
        const use=nativeSourceRecord(output.managedOpenCodeToolUse),dispatch=nativeSourceRecord(output.dispatch);
        if(!profile || capture.managedOpenCode!==true || !isDeepStrictEqual(Object.keys(witness).sort(),expectedKeys) ||
          witness.operationId!=="POST /api/issues/{id}/comments" || witness.callId!==source.callId || witness.argumentsHash!==capture.argumentsHash ||
          witness.resultDigest!==source.contentHash || output.runId!==source.runId || use.callId!==source.callId ||
          use.toolName!=="call_api" || use.argumentsHash!==witness.argumentsHash || dispatch.kind!=="worker_model_dispatch" ||
          !Array.isArray(output.consumedSourceComponents) || !Array.isArray(nativeSourceRecord(output.sourceSet).inputs))
          throw forbidden("A Native Stage API result witness changed");
        const api=nativeSourceRecord(nativeSourceRecord(nativeSourceRecord(producerRun.resultJson).apiToolReceipts)[createHash("sha256").update(source.callId).digest("hex")]);
        const {operationId:_operationId,...response}=nativeSourceRecord(api.result);
        const {readNativeManagedStageCommentCapture}=await import("./native-stage-comment-api.js");
        const current=await readNativeManagedStageCommentCapture(db,{companyId:input.companyId,issueId:producerIssueId,runId:source.runId,
          agentId:producerRun.agentId,callId:source.callId,argumentsHash:String(witness.argumentsHash),
          result:{...response,apiOperationId:api.operationId},outputCapture:witness.outputCapture as NativeModelOutputCapture,reader:input.actor});
        if(!isDeepStrictEqual(current,witness))throw forbidden("A Native Stage API result owner changed");
        await assertNativeModelOutputCaptureCurrentInScope(db,input.companyId,producerIssueId,current.outputCapture,"call_api",scope,Math.max(0, historicalDocumentDepthHint - 1),
          input.actor,producerRun.finishedAt?"settled":"live",siblingToolSourceProofs,historicalTransition);
      }
      if (projectApiResult) {
        if (!profile) throw forbidden("A Native Project API profile is unavailable");
        await assertNativeProjectApiToolResultCurrentInScope(db, {
          companyId: input.companyId, run, profile, receipt: receipt.data, source, actor: input.actor, scope,
        });
      }
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
        const expectedProjectTool = source.toolName;
        if (!sourceSetValue || !sourcePolicy.success || !sourceInputs.success)
          throw forbidden("A Native managed Project source set is unavailable");
        const createdProjectPolicy = sourcePolicy.success && projectSource.success && projectSource.data.kind === "project"
          ? { ...sourcePolicy.data,
              projectIds: [...new Set([...sourcePolicy.data.projectIds, projectSource.data.projectId])].sort() }
          : null;
        const exactCreateEntries = receipt.data.additionalInputs.filter(entry =>
          entry.responsibleUserId === run.responsibleUserId && createdProjectPolicy && sourceInputs.success &&
          projectSource.success && projectSource.data.kind === "project" && workspaceSources.success &&
          workspaceSources.data.every(value => value.kind === "project_workspace") &&
          isDeepStrictEqual(entry.policy, createdProjectPolicy) &&
          isDeepStrictEqual(entry.inputs, unionNativePayloadSourceInputs([[source], sourceInputs.data,
            [projectSource.data, ...workspaceSources.data]])));
        const conflictingCreateSourceTuples = receipt.data.additionalInputs.some(entry => entry.inputs.some(value =>
          value.kind === "tool_result" && value.runId === source.runId && value.callId === source.callId &&
          nativeProviderToolName(value.toolName) === expectedProjectTool && !isDeepStrictEqual(value, source)));
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
        const outputWorkerDispatchCurrent = outputDispatch.kind === "worker_model_dispatch" &&
          outputDispatch.runId === source.runId && typeof outputDispatch.reservationId === "string";
        const outputConversationDispatchCurrent = outputDispatch.kind === "conversation_model_dispatch" &&
          outputDispatch.runId === source.runId && outputDispatch.agentId === producerRun.agentId &&
          outputDispatch.issueId === producerRun.nativeIssueId &&
          outputDispatch.conversationSessionGeneration === run.contextSnapshot?.conversationSessionGeneration &&
          typeof outputDispatch.executionManifestId === "string" &&
          typeof outputDispatch.executionManifestHash === "string" && typeof outputDispatch.reservationId === "string";
        const outputDispatchCurrent = outputWorkerDispatchCurrent || outputConversationDispatchCurrent;
        const turnInputDigest = turns[0]?.turnInputDigest;
        const exactWireIntents = Array.isArray(profile?.nativeAwModelWireIntents)
          ? profile.nativeAwModelWireIntents.filter(value => {
              if (!value || typeof value !== "object" || Array.isArray(value)) return false;
              const intent = value as Record<string, unknown>;
              const uses = Array.isArray(intent.responseToolUses)
                ? intent.responseToolUses.filter(use => use && typeof use === "object" && !Array.isArray(use) &&
                    (use as Record<string, unknown>).id === source.callId &&
                    typeof (use as Record<string, unknown>).name === "string" &&
                    nativeProviderToolName((use as Record<string, unknown>).name as string) === expectedProjectTool &&
                    (use as Record<string, unknown>).argumentsHash === argumentsHash)
                : [];
              return typeof turnInputDigest === "string" && /^[0-9a-f]{64}$/.test(turnInputDigest) &&
                typeof intent.sourceDispatchDigest === "string" && /^[0-9a-f]{64}$/.test(intent.sourceDispatchDigest) &&
                intent.sourceDispatchDigest === turnInputDigest &&
                intent.reservationId === outputDispatch.reservationId && uses.length === 1;
            }) as Record<string, unknown>[] : [];
        const exactAssociation = turnAssociations.length === 1 && turns.length === 1 &&
          (turnAssociations[0] as Record<string, unknown>).dispatchId === turns[0]!.dispatchId &&
          (turnAssociations[0] as Record<string, unknown>).eventSeq === turns[0]!.eventSeq &&
          (turnAssociations[0] as Record<string, unknown>).attempt === turns[0]!.attempt;
        if (capture.managedOpenCode !== true || capture.nativeReadResult === true || source.invocationId !== null ||
          !turnId || !/^[0-9a-f]{64}$/.test(argumentsHash) || !Number.isSafeInteger(eventSeq) ||
          !Number.isSafeInteger(attempt) || nativeProviderToolName(captureToolName) !== expectedProjectTool ||
          capture.resultDigest !== source.contentHash || projectReceipt.callId !== source.callId ||
          projectReceipt.tool !== expectedProjectTool || projectReceipt.argumentsHash !== argumentsHash ||
          typeof projectReceipt.resultDigest !== "string" || !/^[0-9a-f]{64}$/.test(projectReceipt.resultDigest) ||
          (!managedProjectApiCreateResult && projectReceipt.resultDigest !== source.contentHash) ||
          projectReceipt.responsibleUserId !== run.responsibleUserId ||
          !projectSource.success || projectSource.data.kind !== "project" ||
          typeof projectReceipt.projectId !== "string" ||
          !workspaceSources.success || workspaceSources.data.some(value => value.kind !== "project_workspace") ||
          managedUse.callId !== source.callId || managedUse.toolName !== expectedProjectTool ||
          managedUse.argumentsHash !== argumentsHash || outputCapture.runId !== source.runId ||
          !outputDispatchCurrent ||
          outputDispatch.reservationId !== exactWireIntents[0]?.reservationId || exactWireIntents.length !== 1 ||
          !exactAssociation || exactCreateEntries.length !== 1 || conflictingCreateSourceTuples)
          throw forbidden("A Native managed Project result changed");
        if (managedProjectApiCreateResult) {
          const apiReceiptKey = createHash("sha256").update(source.callId, "utf8").digest("hex");
          const apiReceipt = nativeSourceRecord(nativeSourceRecord(run.resultJson).apiToolReceipts);
          const apiCallReceipt = nativeSourceRecord(apiReceipt[apiReceiptKey]);
          const apiEffect = nativeSourceRecord(createCapture.apiEffect);
          const apiResult = nativeSourceRecord(apiCallReceipt.result);
          const apiProject = nativeSourceRecord(apiResult.data);
          const providerApiResult = { ...apiResult, apiOperationId: "POST /api/companies/{companyId}/projects" };
          delete (providerApiResult as Record<string, unknown>).operationId;
          const dispatchId = (turnAssociations[0] as Record<string, unknown>).dispatchId;
          if (apiEffect.operationId !== "POST /api/companies/{companyId}/projects" || apiEffect.method !== "POST" ||
            apiEffect.pathAndQuery !== `/api/companies/${input.companyId}/projects` || apiEffect.turnId !== turnId ||
            apiEffect.dispatchId !== dispatchId || apiEffect.eventSeq !== eventSeq || apiEffect.attempt !== attempt ||
            typeof apiEffect.apiReceiptDigest !== "string" || !/^[0-9a-f]{64}$/.test(apiEffect.apiReceiptDigest) ||
            typeof apiEffect.bodyHash !== "string" || !/^[0-9a-f]{64}$/.test(apiEffect.bodyHash) ||
            apiCallReceipt.operationId !== "POST /api/companies/{companyId}/projects" ||
            apiCallReceipt.state !== "completed" || apiCallReceipt.callId !== source.callId ||
            apiCallReceipt.turnId !== apiEffect.turnId || apiCallReceipt.dispatchId !== apiEffect.dispatchId ||
            apiCallReceipt.eventSeq !== apiEffect.eventSeq || apiCallReceipt.attempt !== apiEffect.attempt ||
            apiCallReceipt.method !== apiEffect.method || apiCallReceipt.pathAndQuery !== apiEffect.pathAndQuery ||
            apiCallReceipt.argumentsHash !== argumentsHash ||
            apiCallReceipt.digest !== apiEffect.apiReceiptDigest || apiCallReceipt.bodyHash !== apiEffect.bodyHash ||
            apiResult.ok !== true || apiResult.status !== 201 ||
            apiResult.operationId !== "POST /api/companies/{companyId}/projects" ||
            !isDeepStrictEqual(apiCallReceipt.result, apiResult) ||
            apiCallReceipt.providerResultDigest !== nativeSha256({ ok: true, operationId: "call_api",
              callId: source.callId, result: providerApiResult }) ||
            apiProject.id !== projectReceipt.projectId || nativeSha256(apiProject) !== projectReceipt.resultDigest)
            throw forbidden("A Native managed Project API result receipt changed");
        }
        const currentProject = await projectService(db as Db).getById(projectReceipt.projectId as string);
        if (!currentProject) throw forbidden("A Native managed Project owner is unavailable");
        const producerIssueId = producerRun.nativeIssueId;
        if (!producerIssueId) throw forbidden("A Native managed Project producer is unavailable");
        const { assertNativeManagedProjectCreateReceiptCurrentInTransaction, managedNativeProjectResultDto } =
          await import("./native-project-output.js");
        await assertNativeManagedProjectCreateReceiptCurrentInTransaction(db as Transaction, {
          companyId: input.companyId, issueId: producerIssueId, runId: source.runId, actor: input.actor,
          receipt: projectReceipt as unknown as Parameters<typeof assertNativeManagedProjectCreateReceiptCurrentInTransaction>[1]["receipt"],
          sourceSet: { policy: sourcePolicy.data, inputs: sourceInputs.data },
          outputCapture: outputCapture as unknown as NativeModelOutputCapture,
          result: managedNativeProjectResultDto(currentProject),
        });
      }
      if (managedConversationTaskResult) {
        if (!profile || captures.length !== 1)
          throw forbidden("A Native conversation Task result profile is unavailable");
        const producerIssueId = producerRun.nativeIssueId;
        if (!producerIssueId) throw forbidden("A Native conversation Task producer is unavailable");
        await assertNativeConversationTaskResultCurrentInScope(db, scope, {
          companyId: input.companyId, issueId: producerIssueId, actor: input.actor, run, profile,
          receipt: receipt.data, source, capture: captures[0]!,
        });
      }
      if (source.invocationId === null && nativeReadResultTool) {
        const producerIssueId = producerRun.nativeIssueId;
        if (!producerIssueId) throw forbidden("A Native read result producer is unavailable");
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
        deferNativeReadResultOwnerCheck(scope, { companyId: input.companyId,
          issueId: producerIssueId, runId: source.runId, actor: input.actor,
          tool: source.toolName as "get_task_context" | "get_task_history" | "read_chat_attachment" | "query_business_metric",
          resultDigest: source.contentHash, sourceSet: { policy: sourcePolicy.data, inputs: sourceInputs.data } });
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
        const currentManifestId = Array.isArray(manifestIds) && manifestIds.length === 1 && manifestIds[0] &&
          typeof manifestIds[0] === "object" && !Array.isArray(manifestIds[0])
          ? (manifestIds[0] as Record<string, unknown>).contextManifestId : undefined;
        const currentCompanyId = Array.isArray(manifestIds) && manifestIds.length === 1 && manifestIds[0] &&
          typeof manifestIds[0] === "object" && !Array.isArray(manifestIds[0])
          ? (manifestIds[0] as Record<string, unknown>).companyId : undefined;
        const currentContextInputs = embeddedContextInputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "context" }> =>
          value.kind === "context" && value.manifestId === currentManifestId);
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
          embeddedContextInputs.length === 0 || embeddedContextInputs.length > 64 ||
          new Set(embeddedContextInputs.map(value => (value as Record<string, unknown>).manifestId)).size !== embeddedContextInputs.length ||
          currentContextInputs.length !== 1 || currentCompanyId !== input.companyId || contextReceiptEntries.length !== 1 ||
          !isDeepStrictEqual(capturedSourceSet.policy, contextReceiptEntries[0]!.policy) ||
          !isDeepStrictEqual(contextReceiptEntries[0]!.inputs, [source, ...capturedContextInputs]))
          throw forbidden("A Native Context tool result changed");
        const producerIssueId = producerRun.nativeIssueId;
        if (!producerIssueId) throw forbidden("A Native Context producer is unavailable");
        await assertNativeContextReadSourceSetCurrentInScope(db, { companyId: input.companyId, agentId: run.agentId,
          runId: source.runId, issueId: producerIssueId, actor: input.actor,
          sourceSet: capturedSourceSet as unknown as NativeContextReadBinding["sourceSet"],
          manifestIds: manifestIds as NativeContextReadBinding["manifestIds"] }, scope, siblingToolSourceProofs);
      } else if (contextRead) throw forbidden("A Native Context tool result changed");
      const documentRevision = capture.documentRevision && typeof capture.documentRevision === "object" && !Array.isArray(capture.documentRevision)
        ? capture.documentRevision as Record<string, unknown> : null;
      if (documentRevision) {
        if (typeof documentRevision.issueId !== "string" || typeof documentRevision.revisionId !== "string")
          throw forbidden("A Native historical document tool result changed");
        await assertNativeDocumentRevisionCurrentSourceAccessInScope(db as Db, { companyId: input.companyId,
          issueId: documentRevision.issueId, revisionId: documentRevision.revisionId, actor: input.actor,
          requireLatest: false }, scope, historicalDocumentDepthHint, siblingToolSourceProofs);
      }
      siblingCompleted = true;
      } finally {
        scope.active.delete(toolSourceVisitKey);
        if (siblingProofKey && siblingProofStack.at(-1) === siblingFrame) siblingProofStack.pop();
        if (siblingCompleted && siblingProofKey && siblingToolSourceProofs.size < 512)
          siblingToolSourceProofs.set(siblingProofKey, { descendants: siblingFrame.descendants, mutableSources: siblingFrame.mutableSources,
            policy: producerEntry!.policy, inputs: producerEntry!.inputs, requiredSets: producerClosures,
            ...(siblingFrame.readerSelection?.complete ? { readerSets: new Map(siblingFrame.readerSelection.sets) } : {}) });
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
      const rootTaskInputs = inputs.data.filter((candidate): candidate is Extract<NativePayloadSourceInput, { kind: "task" }> =>
        candidate.kind === "task" && candidate.issueId === source.issueId);
      // A protocol-1 conversation Task snapshot may own this exact Human
      // comment as its sole retained root. The Task owner walk above validates
      // that root, its author binding, and the comment snapshot with the
      // narrowly scoped self-owned issue allowance. Do not revalidate the same
      // comment as an unrelated root with the broader standalone policy. Tie
      // this reuse to the exact Task source present in this component, so a
      // different cumulative prefix cannot inherit the allowance.
      if (rootTaskInputs.some(task => scope.conversationRootComments.has(
        nativeSha256({ companyId: input.companyId, task, source })))) continue;
      await assertConversationCommentSourceCurrent(db, { companyId: input.companyId, actor: input.actor, source,
        policy: input.policy, inputs: input.inputs }, scope);
      continue;
    }
    if (source.kind === "interaction") {
      const [pendingOwner] = await db.select({ status: issueThreadInteractions.status, kind: issueThreadInteractions.kind }).from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.companyId, input.companyId), eq(issueThreadInteractions.issueId, source.issueId),
        eq(issueThreadInteractions.id, source.interactionId))).limit(1);
      if (pendingOwner?.status === "pending") {
        if (historicalTransition?.pending?.parentRunId === input.runId) {
          const { nativeGovernedPendingTransitionCurrent } = await import("./native-runtime/native-interaction-bridge.js");
          const original = await nativeGovernedPendingTransitionCurrent({db:db as Db,companyId:input.companyId,
            issueId:source.issueId,agentId:run.agentId,source,context:historicalTransition.pending,reader:input.actor,
            readWork:()=>nativeSourceReadWork(scope)});
          if (!original) throw forbidden("A historical pending Native interaction source changed");
          continue;
        }
        // Item verdicts can contain a current partial Human response while pending.
        if (pendingOwner.kind !== "request_item_verdicts") {
          const { captureNativeGovernedPendingInteractions } = await import("./native-runtime/native-interaction-bridge.js");
          const pending = await captureNativeGovernedPendingInteractions({ db: db as Db, companyId: input.companyId,
            issueId: source.issueId, runId: input.runId, agentId: run.agentId, interactionIds: [source.interactionId], reader: input.actor });
          if (pending.length !== 1 || !isDeepStrictEqual(pending[0]!.source, source)) throw forbidden("A pending Native interaction source changed");
          continue;
        }
      }
      const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
      const current: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
      const continuationCurrent: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
      await prepareNativeSourceEffectBoundary(scope);
      await materializeNativeInteractionResponses({ db: db as Db, companyId: input.companyId, issueId: source.issueId,
        runId: input.runId, agentId: run.agentId, interactionIds: [source.interactionId], onSourceCapture: value => { current.push(value); },
        onContinuationSourceCapture: value => { continuationCurrent.push(value.continuationSource); } });
      continuationCurrent.push(...await readNativeQuestionContinuationSource(db, { companyId: input.companyId,
        issueId: source.issueId, runId: input.runId, agentId: run.agentId, kind: pendingOwner?.kind, source, normal: current }));
      let deliveryCurrent: Extract<NativePayloadSourceInput, { kind: "interaction" }> | undefined;
      if (current.length === 1 && !isDeepStrictEqual(current[0], source) && !continuationCurrent.some(value => isDeepStrictEqual(value, source))) {
        const consumer = await nativeSourceReadRun(db, input.companyId, input.runId, scope);
        if (consumer?.wakeupRequestId) {
          const { captureNativeToolActionDelivery } = await import("./tool-action-delivery.js");
          const captured = await captureNativeToolActionDelivery({ db: db as Db, companyId: input.companyId, issueId: source.issueId,
            agentId: consumer.agentId, runId: consumer.id, wakeupRequestId: consumer.wakeupRequestId, reader: input.actor });
          deliveryCurrent = captured?.source;
        }
      }
      if (current.length !== 1 || (!isDeepStrictEqual(current[0], source) &&
        (continuationCurrent.length !== 1 || !isDeepStrictEqual(continuationCurrent[0], source)) && !isDeepStrictEqual(deliveryCurrent, source))) {
        const { nativeGovernedPendingTransitionCurrent } = await import("./native-runtime/native-interaction-bridge.js");
        if (!historicalTransition?.pending || historicalTransition.pending.parentRunId !== input.runId || !await nativeGovernedPendingTransitionCurrent({
          db:db as Db,companyId:input.companyId,issueId:source.issueId,agentId:run.agentId,source,
          context:historicalTransition.pending,reader:input.actor,readWork:()=>nativeSourceReadWork(scope)})) throw forbidden("A Native source Interaction changed or was erased");
      }
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
        revisionId: source.revisionId, actor: input.actor, requireLatest: false }, scope, 0, siblingToolSourceProofs);
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
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, reader, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativeMemoryToolInvocationCurrentInScope(tx, input, scope);
  }));
}

function nativeMemoryOwnerReadScopeMatches(db: Db | Transaction, companyId: string,
  reader: AuthorizationActor, scope: NativeSourceReadScope): boolean {
  return is(db, PgTransaction) && scope.context.active && nativeSourceReadScopes.getStore() === scope.context &&
    scope.context.db === (db as object) && !scope.context.ancestry.graphProofsDisabled &&
    scope.context.privacyLockedCompanies.has(companyId) && scope.actorKey === nativeSha256(reader) &&
    scope.context.memoryTemporalIdentity === activeMemoryTemporalReadScopeIdentity(db, reader);
}

async function assertNativeMemoryToolInvocationCurrentInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; actor: AuthorizationActor; capture: NativeModelOutputCapture;
  invocationId: string; status: "executing" | "succeeded"; resultHash?: string | null; currentReader?: AuthorizationActor;
}, scope: NativeSourceReadScope): Promise<void> {
  const use = input.capture.managedOpenCodeToolUse;
  if (input.actor.type !== "agent" || input.actor.companyId !== input.companyId ||
    input.actor.agentId == null || input.actor.runId !== input.capture.runId ||
    use?.toolName !== "paperclip-self:remember") throw forbidden("Native Memory output binding is unavailable");
  const reader = input.currentReader ?? input.actor;
  const conversationState = input.status === "succeeded" ? "settled" : "live";
  if (nativeMemoryOwnerReadScopeMatches(db, input.companyId, reader, scope)) {
    await assertNativeModelOutputCaptureCurrentInScope(db, input.companyId, input.issueId, input.capture,
      "paperclip-self:remember", scope, 0, reader, conversationState);
  } else {
    await assertNativeModelOutputCaptureCurrent(db, input.companyId, input.issueId, input.capture,
      "paperclip-self:remember", reader, conversationState);
  }
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
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativeMemoryOutputSnapshotCurrentInScope(tx, input, scope);
  }));
}

/** Keep checks performed while reading one retained Memory output in the same
 * source scope. The scope is bounded to this exact owner and its captured
 * temporal prefix; callers still perform live reader checks before returning. */
export async function withNativeMemoryOutputSnapshotCurrent<T>(db: Db | Transaction, input: {
  companyId: string; recordId: string; snapshot: NativePayloadSourceSnapshot; actor: AuthorizationActor;
  structuralProofMemo?: NativeMemoryPageStructuralProofMemo;
}, read: (sourceDb: Db | Transaction) => Promise<T>): Promise<T> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    await assertNativeMemoryOutputSnapshotCurrentInScope(tx, input, scope);
    // The callback-free Memory source reviewer owns only fixed internal read
    // callbacks. Other callers may write, and cannot revive an earlier fence.
    if (scope.context.ancestry.graphProofsDisabled || !activeMemorySourceGraphReadLedger(tx))
      await prepareNativeSourceEffectBoundary(scope);
    return read(tx);
  }, input.structuralProofMemo));
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
  const [record] = await db.select({ metadata: memoryRecords.metadata, updatedAt: memoryRecords.updatedAt }).from(memoryRecords).where(and(
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
  recordNativeMutableSourceRow(scope, "invocation", input.companyId, invocation);
  const callId = invocation.idempotencyKey.slice(`aw-native-tool:${dispatch.runId}:`.length);
  const profile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  const intentMatches = Array.isArray(profile?.nativeAwModelWireIntents)
    ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).reservationId === dispatch.reservationId &&
      nativeWirePurposeMatches(value, dispatch.kind)) as Record<string, unknown>[] : [];
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
  const invocationInput: Parameters<typeof assertNativeMemoryToolInvocationCurrent>[1] = {
    companyId: input.companyId, issueId: run.nativeIssueId, actor: inputActor, capture, invocationId,
    status: "succeeded", resultHash: invocation.resultHash, currentReader: input.actor };
  // This is one callback-free owner validation. Its public boundary already
  // owns admission, fresh mutable maps and the final reader/company fences.
  if (nativeMemoryOwnerReadScopeMatches(db, input.companyId, input.actor, scope))
    await assertNativeMemoryToolInvocationCurrentInScope(db, invocationInput, scope);
  else await assertNativeMemoryToolInvocationCurrent(db, invocationInput);
}

async function assertNativeManagedConsumedSourceSetCurrentInScope(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  components: NativeConsumedSourceComponent[]; sourceSet: NativePayloadSourceSet;
}, scope: NativeSourceReadScope, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map(),
  historicalDocumentDepthHint = 0, historicalTransition?: NativeHistoricalPendingTransitionContext): Promise<void> {
  if (historicalTransition) disableNativeSourceGraphCheckpoints(scope);
  if (!input || !Array.isArray(input.components) || input.components.length < 1 || input.components.length > 64 ||
    !input.sourceSet || typeof input.sourceSet !== "object" || Array.isArray(input.sourceSet))
    throw forbidden("The Native consumed source set is unavailable");
  const parsedPolicy = nativePayloadSourcePolicySchema.safeParse(input.sourceSet.policy);
  const parsedInputs = nativePayloadSourceInputSchema.array().safeParse(input.sourceSet.inputs);
  if (!parsedPolicy.success || !parsedInputs.success)
    throw forbidden("The Native consumed source set is unavailable");
  const visitKey = `managed-consumed:${nativeSha256({ companyId: input.companyId, issueId: input.issueId,
    runId: input.runId, actor: input.actor, actorScope: scope.actorKey, memoryTemporalIdentity: scope.context.memoryTemporalIdentity, components: input.components, sourceSet: input.sourceSet, historicalTransition: historicalTransition ?? null })}`;
  return withNativeSourceGraphProof(scope, siblingToolSourceProofs, visitKey, {
    companyId: input.companyId, runId: input.runId, actor: input.actor,
    policy: parsedPolicy.data, inputs: parsedInputs.data,
  }, () => assertNativeManagedConsumedSourceSetCurrentUncached(db, input, scope, siblingToolSourceProofs, historicalDocumentDepthHint, historicalTransition), historicalDocumentDepthHint);
}

async function assertNativeManagedConsumedSourceSetCurrentUncached(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  components: NativeConsumedSourceComponent[]; sourceSet: NativePayloadSourceSet;
}, scope: NativeSourceReadScope, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map(),
  historicalDocumentDepthHint = 0, historicalTransition?: NativeHistoricalPendingTransitionContext): Promise<void> {
  if (!input || !Array.isArray(input.components) || !input.sourceSet || typeof input.sourceSet !== "object" ||
    Array.isArray(input.sourceSet)) throw forbidden("The Native consumed source set is unavailable");
  const policy = nativePayloadSourcePolicySchema.safeParse(input.sourceSet.policy);
  const inputs = nativePayloadSourceInputSchema.array().safeParse(input.sourceSet.inputs);
  if (!policy.success || !inputs.success || input.components.length < 1 || input.components.length > 64)
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
  const validatedDispatchSources = new Set<string>();
  const dispatchComponentIndexBySourceKey = new Map<string, number>();
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
        nativeWirePurposeMatches(intent, marker.kind) &&
        intent.sourceDispatchDigest === component.executionInputDigest && intent.callId === marker.callId &&
        intent.requestHash === marker.requestHash && intent.wireBodyHash === marker.wireBodyHash) : [];
      const reservationIntents = marker ? wireIntents.filter(intent => intent.reservationId === marker.reservationId) : [];
      const conflictingDispatchCopies = marker && receipt.data.dispatches.some(prefix => prefix.inputs.some(value =>
        value.kind === marker.kind && value.reservationId === marker.reservationId && !isDeepStrictEqual(value, marker)));
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
        run.contextSnapshot?.conversationSessionGeneration === marker.conversationSessionGeneration &&
        conversationIssue.conversationSessionGeneration >= marker.conversationSessionGeneration &&
        ["active", "waiting"].includes(conversationIssue.conversationState ?? "") && conversationIssue.conversationRetiredAt === null &&
        conversationManifest?.hash === marker.executionManifestHash &&
        conversationManifest.manifest.responsibleUserId === run.responsibleUserId);
      if (matches.length !== 1 || !marker || marker.runId !== input.runId ||
        markers.filter(value => isDeepStrictEqual(value, marker)).length !== 1 ||
        !isDeepStrictEqual(matches[0]!.inputs.at(-1), marker) || markerIntents.length !== 1 || !reservation ||
        reservationIntents.length !== 1 ||
        conflictingDispatchCopies || markerIntents[0]!.sourcePolicyHash !== nativeSha256(receipt.data.bootstrap) ||
        typeof markerIntents[0]!.responseContentHash !== "string" || !/^[0-9a-f]{64}$/.test(markerIntents[0]!.responseContentHash as string) ||
        reservation.purpose !== expectedPurpose || !conversationBound || reservation.status !== "completed" || reservation.inputHash !== marker.requestHash ||
        reservation.providerResponseHash !== marker.responseHash ||
        (marker.kind === "conversation_model_dispatch" && (markerIntents[0]!.agentId !== marker.agentId ||
          marker.agentId !== run.agentId || marker.issueId !== run.nativeIssueId)) ||
        markerIntents[0]!.endpoint !== "https://api.anthropic.com/v1/messages" || markerIntents[0]!.method !== "POST")
        throw forbidden("A Native dispatch component is not in its original receipt");
      const markerKey = nativeSha256({ companyId: input.companyId, source: marker });
      if (dispatchComponentIndexBySourceKey.has(markerKey))
        throw forbidden("A Native dispatch marker has multiple consumed components");
      dispatchComponentIndexBySourceKey.set(markerKey, componentIndex);
      validatedDispatchSources.add(markerKey);
    } else if (component.kind === "additional_input") {
      if (typeof component.responsibleUserId !== "string") throw forbidden("A Native additional input is malformed");
      const matches = receipt.data.additionalInputs.filter(value => value.responsibleUserId === component.responsibleUserId &&
        isDeepStrictEqual(value.policy, set.policy) && isDeepStrictEqual(value.inputs, set.inputs));
      if (matches.length !== 1) throw forbidden("A Native additional input component is not in its original receipt");
    } else throw forbidden("A Native source component family is unsupported");
    inputCount += set.inputs.length;
    componentSets.push(set);
  }
  const componentDependencies = componentSets.map((set, index) => {
    const component = input.components[index];
    const markers = set.inputs.filter((source): source is Extract<NativePayloadSourceInput,
      { kind: "worker_model_dispatch" | "conversation_model_dispatch" }> =>
      source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch");
    const producedMarker = component?.kind === "dispatch" ? markers.at(-1) : undefined;
    return markers.filter(source => !producedMarker || !isDeepStrictEqual(source, producedMarker)).flatMap(source => {
      const dependency = dispatchComponentIndexBySourceKey.get(nativeSha256({ companyId: input.companyId, source }));
      return dependency === undefined ? [] : [dependency];
    });
  });
  if (nativeConsumedSourceComponentsContainCycle(componentDependencies))
    throw forbidden("The Native consumed source components contain a cycle");
  if (inputCount > 512) throw forbidden("The Native consumed source graph exceeds its bound");
  const combinedInputs: NativePayloadSourceInput[] = [];
  for (const set of componentSets) for (const source of set.inputs)
    if (!combinedInputs.some(value => isDeepStrictEqual(value, source))) combinedInputs.push(source);
  const policyKeys = ["issueIds", "projectIds", "runIds", "memoryIds", "foundationRevisionIds"] as const;
  const combinedPolicy = Object.fromEntries(policyKeys.map(key => [key,
    [...new Set(componentSets.flatMap(set => set.policy[key]))].sort()])) as NativePayloadSourcePolicy;
  if (!isDeepStrictEqual(combinedInputs, inputs.data) || !isDeepStrictEqual(combinedPolicy, policy.data))
    throw forbidden("The Native consumed source components do not match their source set");
  // This local memo is scoped to this read-only component traversal only. It
  // never crosses a source-set call, transaction, actor, or temporal reader
  // scope; ordered component membership above still runs for every component.
  const completedTaskSourceProofs: NativeCompletedTaskSourceProofs = new Map();
  for (const [index, component] of input.components.entries()) {
    const set = componentSets[index]!;
    const marker = component.kind === "dispatch" ? set.inputs.filter((value): value is Extract<NativePayloadSourceInput,
      { kind: "worker_model_dispatch" | "conversation_model_dispatch" }> =>
      value.kind === "worker_model_dispatch" || value.kind === "conversation_model_dispatch").at(-1) : undefined;
    const checkedInputs = marker ? set.inputs.filter(value => !isDeepStrictEqual(value, marker)) : set.inputs;
    await assertNativePayloadSourceSetCurrentInScope(db, { companyId: input.companyId, issueId: input.issueId,
      runId: input.runId, actor: input.actor, policy: set.policy, inputs: checkedInputs }, scope,
      completedTaskSourceProofs, validatedDispatchSources, siblingToolSourceProofs, input.sourceSet, historicalDocumentDepthHint, historicalTransition);
  }
}

/** Revalidate a managed model request's ordered, server-captured union of
 * original bootstrap/dispatch/additional-input components and current owners. */
export async function assertNativeManagedConsumedSourceSetCurrent(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; actor: AuthorizationActor;
  components: NativeConsumedSourceComponent[]; sourceSet: NativePayloadSourceSet;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
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
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId,
    scope => assertNativeContextReadSourceSetCurrentInScope(tx, input, scope)));
}

async function assertNativeContextReadSourceSetCurrentInScope(db: Db | Transaction, input: {
  companyId: string; agentId: string; runId: string; issueId: string; actor: AuthorizationActor;
  sourceSet: NativeContextReadBinding["sourceSet"];
  manifestIds: readonly { companyId: string; contextManifestId: string }[];
}, scope: NativeSourceReadScope, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map()): Promise<void> {
  if (!input.sourceSet || typeof input.sourceSet !== "object" || Array.isArray(input.sourceSet))
    throw forbidden("The Native Context read source binding is unavailable");
  await lockNativeSourceReadPrivacy(db, input.companyId, scope);
  const parsedInputs = nativePayloadSourceInputSchema.array().safeParse(input.sourceSet.inputs);
  const parsedPolicy = nativePayloadSourcePolicySchema.safeParse(input.sourceSet.policy);
  const contextInputs = parsedInputs.success ? parsedInputs.data.filter((value): value is Extract<NativePayloadSourceInput, { kind: "context" }> =>
    value.kind === "context") : [];
  const currentManifestId = input.manifestIds[0]?.contextManifestId;
  const currentSources = contextInputs.filter(value => value.manifestId === currentManifestId);
  if (!parsedInputs.success || !parsedPolicy.success || contextInputs.length === 0 || contextInputs.length > 64 ||
    new Set(contextInputs.map(value => value.manifestId)).size !== contextInputs.length || currentSources.length !== 1 ||
    input.manifestIds.length !== 1 ||
    input.manifestIds[0]?.companyId !== input.companyId)
    throw forbidden("The Native Context read source binding is unavailable");
  const source = currentSources[0]!;
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
    nativeTemporalContextContentHash(manifest, items, roots) !== source.contentHash)
    throw forbidden("The Native Context read source changed");
  const expectedPolicy: NativePayloadSourcePolicy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  const expectedInputs: NativePayloadSourceInput[] = [];
  const appendSnapshot = (raw: unknown, ownerKind: "issue" | "memory_record", ownerId: string) => {
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(raw);
    if (!snapshot.success || snapshot.data.owner.kind !== ownerKind || snapshot.data.owner.companyId !== input.companyId ||
      snapshot.data.owner.id !== ownerId) throw forbidden("The Native Context owner snapshot is unavailable");
    for (const key of Object.keys(expectedPolicy) as (keyof NativePayloadSourcePolicy)[])
      expectedPolicy[key] = [...new Set([...expectedPolicy[key], ...snapshot.data.policy[key]])].sort();
    for (const nested of snapshot.data.inputs) {
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
  await assertNativeTemporalContextInputsCurrent(db as Db, input.companyId, contextInputs);
  await assertNativeContextInputOwnersCurrent(db as Db, input.companyId, input.actor, contextInputs, scope, undefined, undefined, siblingToolSourceProofs);
  // The enclosing source reader flushes this live Task ACL together with the
  // other owners in the same exact Native source scope. The source set and
  // current manifest owners have been fully reconstructed above, so this
  // avoids one serial recursive ACL query per Context result while preserving
  // the pinned Task prefix and checking the ACL before the owner read returns.
  deferNativeSourceOwnerReaderChecks(scope, { companyId: input.companyId, actor: input.actor,
    issueIds: [input.issueId] });
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
    contentHash: nativeTemporalContextContentHash(manifests[0]!, items, roots) };
  const sourceSet: NativeContextReadBinding["sourceSet"] = { policy: witnessClosure.policy,
    inputs: [...witnessClosure.inputs, contextInput] };
  await assertNativeContextReadSourceSetCurrent(db, { companyId: input.companyId, agentId: input.agentId,
    runId: input.runId, issueId: input.issueId, actor: input.actor, sourceSet,
    manifestIds: manifestIds.map(value => ({ ...value })) });
  return { markdown: assembled.markdown, witness, manifestIds, sourceSet };
}

export function nativeTemporalContextContentHash(manifest: typeof contextManifests.$inferSelect,
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

/** Bootstrap checks current rendered facts. Retained outputs keep their
 * consumed facts under the current body/source/audit/reader checks. A changed
 * snapshot must extend only the producing Run's audited workspace binding. */
export async function assertNativeContextTaskSourceCurrent(db: Db | Transaction, input: {
  actor: AuthorizationActor; companyId: string; agentId: string; issueId: string;
  manifest: Pick<typeof contextManifests.$inferSelect, "id" | "companyId" | "agentId" | "runId" | "issueId" | "createdAt">;
  item: typeof contextManifestItems.$inferSelect;
  consumption?: "bootstrap" | "retained";
}): Promise<boolean> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    const { manifest, item, issueId, companyId, agentId, actor } = input;
    const retained = input.consumption === "retained";
    if (item.sourceProvider !== "august_works_tasks" || item.sourceRef !== `issue://${issueId}` ||
        manifest.companyId !== companyId || item.companyId !== companyId || item.manifestId !== manifest.id) return false;
    const [task] = await tx.select({ id: issues.id, identifier: issues.identifier, title: issues.title,
      description: issues.description, status: issues.status, priority: issues.priority, updatedAt: issues.updatedAt,
      protocol: issues.payloadSourceProtocolVersion, snapshot: issues.payloadSourceSnapshot,
      invalidated: issues.payloadSourceSnapshotInvalidated,
      bodyHash: sql<string>`public.aw_native_payload_body_hash('issue',to_jsonb(${issues}))` })
      .from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).for("share");
    if (!task || task.invalidated || !item.sourceVersion || !/^[a-f0-9]{64}$/i.test(item.contentHash)) return false;
    const exactSnapshot = isDeepStrictEqual(task.snapshot, item.payloadSourceSnapshot);
    // A retained output consumed the historical Context facts. Lifecycle
    // metadata may advance; its original body/source closure and current ACLs may not.
    if (retained && exactSnapshot) return true;
    const exactCurrent = task.updatedAt.toISOString() === item.sourceVersion && exactSnapshot;
    if (exactCurrent)
      return Boolean(item.contentHash && nativeContextTaskEvidenceHash(nativeContextTaskEvidence(task)) === item.contentHash);
    if (manifest.agentId !== agentId || manifest.issueId !== issueId || !manifest.runId ||
        !retained && (actor.type !== "agent" || actor.agentId !== agentId || actor.runId !== manifest.runId || actor.companyId !== companyId) ||
        task.protocol !== 1 || task.invalidated || !item.sourceVersion || !item.payloadSourceSnapshot ||
        !task.bodyHash || !item.contentHash ||
        !retained && nativeContextTaskEvidenceHash(nativeContextTaskEvidence(task)) !== item.contentHash) return false;
    const oldResult = nativePayloadSourceSnapshotSchema.safeParse(item.payloadSourceSnapshot);
    const currentResult = nativePayloadSourceSnapshotSchema.safeParse(task.snapshot);
    if (!oldResult.success || !currentResult.success || oldResult.data.owner.kind !== "issue" ||
        oldResult.data.owner.companyId !== companyId || oldResult.data.owner.id !== issueId ||
        currentResult.data.owner.kind !== "issue" || currentResult.data.owner.companyId !== companyId ||
        currentResult.data.owner.id !== issueId || currentResult.data.owner.contentHash !== task.bodyHash ||
        !isDeepStrictEqual(oldResult.data.policy, currentResult.data.policy) ||
        !isDeepStrictEqual(oldResult.data.inputs, currentResult.data.inputs)) return false;
    const oldTransforms = oldResult.data.transforms ?? [];
    const currentTransforms = currentResult.data.transforms ?? [];
    if (currentTransforms.length <= oldTransforms.length ||
        !isDeepStrictEqual(currentTransforms.slice(0, oldTransforms.length), oldTransforms) ||
        !currentTransforms.slice(oldTransforms.length).every(step => step.kind === "workspace_binding" && step.runId === manifest.runId))
      return false;
    const firstSuffix = currentTransforms[oldTransforms.length];
    if (firstSuffix?.kind !== "workspace_binding") return false;
    const [firstSuffixAudit] = await tx.select({ createdAt: activityLog.createdAt }).from(activityLog).where(and(
      eq(activityLog.companyId, companyId), eq(activityLog.id, firstSuffix.activityId),
      eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issueId),
      eq(activityLog.action, "issue.payload_source_workspace_bound"))).limit(1);
    if (!firstSuffixAudit ||
        firstSuffixAudit.createdAt < manifest.createdAt) return false;
    const baseContentHash = currentTransforms[0]?.previousOwnerContentHash ?? currentResult.data.owner.contentHash;
    const base = { version: 1 as const, owner: { ...currentResult.data.owner, contentHash: baseContentHash },
      policy: currentResult.data.policy, inputs: currentResult.data.inputs };
    let prefixContentHash = baseContentHash;
    let prefixDigest = await nativePayloadSourceDigest(tx, base);
    let matchesPrefix = oldTransforms.length === 0 && isDeepStrictEqual(oldResult.data, { ...base, digest: prefixDigest });
    for (let index = 0; index < oldTransforms.length; index += 1) {
      const step = currentTransforms[index]!;
      prefixContentHash = step.nextOwnerContentHash;
      const prefix = currentTransforms.slice(0, index + 1);
      prefixDigest = await nativePayloadSourceDigest(tx, { ...base,
        owner: { ...base.owner, contentHash: prefixContentHash }, transforms: prefix });
      if (index + 1 === oldTransforms.length) {
        matchesPrefix = isDeepStrictEqual(oldResult.data, { ...base,
          owner: { ...base.owner, contentHash: prefixContentHash }, transforms: prefix, digest: prefixDigest });
      }
    }
    if (!matchesPrefix) return false;
    const [run] = await tx.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId,
      nativeIssueId: heartbeatRuns.nativeIssueId, issueId: heartbeatRuns.issueId,
      runtimeMode: heartbeatRuns.runtimeMode, responsibleUserId: heartbeatRuns.responsibleUserId })
      .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, manifest.runId)))
      .for("share");
    if (!run || run.agentId !== agentId || run.runtimeMode !== "native" ||
        (run.nativeIssueId ?? run.issueId) !== issueId || !run.responsibleUserId ||
        !retained && run.responsibleUserId !== actor.onBehalfOfUserId) return false;
    // This walks the complete current source/audit chain and rechecks source ACLs.
    await assertNativeTaskSnapshotOwnerCurrentInScope(tx, companyId, actor, issueId, scope);
    return true;
  }));
}

/** Machine metadata history is checked even for the original empty-policy
 * Human root. The original source closure is still read by its existing owner. */
async function nativeStageTaskOriginalSnapshot(db: Db | Transaction, companyId: string, issueId: string,
  snapshot: NativePayloadSourceSnapshot): Promise<NativePayloadSourceSnapshot> {
  const transforms=snapshot.transforms ?? [];
  if(!transforms.some(step=>step.kind==="native_stage_policy")) return snapshot;
  const [task]=await db.select().from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,issueId))).limit(1).for("share");
  if(!task || task.payloadSourceSnapshotInvalidated) throw forbidden("A Native Stage Task source is unavailable");
  const {readNativeStageTaskBodyStep}=await import("./native-stage-task-body-source.js");
  const original={version:1 as const,owner:{...snapshot.owner,contentHash:transforms[0]!.previousOwnerContentHash},
    policy:snapshot.policy,inputs:snapshot.inputs};
  let digest=await nativePayloadSourceDigest(db,original),bodyHash=original.owner.contentHash;
  const prefix:NonNullable<NativePayloadSourceSnapshot["transforms"]>=[];
  for(const step of transforms){
    if(step.previousSnapshotDigest!==digest || step.previousOwnerContentHash!==bodyHash)
      throw forbidden("A Native Stage Task source history changed");
    if(step.kind==="native_stage_policy") await readNativeStageTaskBodyStep(db,{task,step});
    prefix.push(step);bodyHash=step.nextOwnerContentHash;
    digest=await nativePayloadSourceDigest(db,{...original,owner:{...original.owner,contentHash:bodyHash},transforms:prefix});
  }
  if(snapshot.digest!==digest || snapshot.owner.contentHash!==bodyHash)
    throw forbidden("A Native Stage Task source history changed");
  if(transforms.some(step=>step.kind==="workspace_binding") && !await readAuditedManualRelatedOwner(db,companyId,issueId,snapshot))
    throw forbidden("A Native Stage Task workspace source history changed");
  if(snapshot.inputs.length===0 && Object.values(snapshot.policy).every(values=>values.length===0)){
    if(!task.createdByUserId || task.createdByAgentId || task.originKind!=="manual" || task.parentId || task.projectId || task.conversationAgentId)
      throw forbidden("A Native Stage Task original Human source is unavailable");
    const [audit]=await db.select({id:activityLog.id}).from(activityLog).where(and(eq(activityLog.companyId,companyId),
      eq(activityLog.entityType,"issue"),eq(activityLog.entityId,issueId),eq(activityLog.action,"issue.payload_source_captured"),
      eq(activityLog.actorType,"user"),eq(activityLog.actorId,task.createdByUserId),
      sql`${activityLog.details}->>'producer'='direct_manual_input'`,sql`${activityLog.details}->>'digest'=${await nativePayloadSourceDigest(db,original)}`,
      sql`${activityLog.details}->>'contentHash'=${original.owner.contentHash}`)).limit(1);
    if(!audit) throw forbidden("A Native Stage Task original Human source was erased");
  }
  return {...original,digest:await nativePayloadSourceDigest(db,original)};
}

async function assertNativeFrozenTaskSnapshotCurrent(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  issueId: string, snapshot: NativePayloadSourceSnapshot, scope: NativeSourceReadScope, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map()): Promise<void> {
  snapshot=await nativeStageTaskOriginalSnapshot(db,companyId,issueId,snapshot);
  const references = snapshot.inputs.length + Object.values(snapshot.policy).reduce((total, values) => total + values.length, 0);
  if (references > 256 || snapshot.inputs.length > 256)
    throw forbidden("The frozen Native Task source closure exceeds its bound");
  if (references === 0) return;
  const manualRelatedOwner = snapshot.inputs.length === 0
    ? await readAuditedManualRelatedOwner(db, companyId, issueId, snapshot) : null;
  if (manualRelatedOwner) {
    const key = `manual-child:${companyId}:${issueId}`;
    if (scope.active.has(key)) throw forbidden("The manual child privacy graph contains a cycle");
    addNativeSourceActiveVisit(scope, key);
    try {
      await assertManualRelatedPrivacyCurrent(db, companyId, actor, {
        parentId: snapshot.policy.issueIds[0] ?? null, projectId: snapshot.policy.projectIds[0] ?? null,
        projectWorkspaceId: manualRelatedOwner.projectWorkspaceId,
      });
    } finally { scope.active.delete(key); }
    return;
  }
  const dispatches = snapshot.inputs.flatMap((source, index) =>
    source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch" ? [{ source, index }] : []);
  const last = dispatches.at(-1);
  if (!last || last.index !== snapshot.inputs.length - 1 || dispatches.length > 64)
    throw forbidden("The frozen Native Task source closure has no retained dispatch receipt");
  const visitKey = `frozen-task-snapshot:${companyId}:${issueId}:${snapshot.digest}`;
  if (scope.active.has(visitKey)) throw forbidden("The frozen Native Task source graph contains a cycle");
  addNativeSourceActiveVisit(scope, visitKey);
  try {
    // A Task snapshot can be reached through several later cumulative source
    // prefixes in one read-only transaction. Reuse its structural dispatch
    // proof only when every nested owner family is supported by the ordinary
    // exact source-set validator. The final reader pass is still queued on a
    // hit, so current source ACLs, runtime bundle retention, and actor/company
    // authority are re-evaluated after all source-row waits.
    const reusableKinds = new Set<NativePayloadSourceInput["kind"]>(["task", "project", "project_workspace", "memory", "comment",
      "context", "document_revision", "completion_contract", "runtime_instructions", "workspace_metadata",
      "worker_model_dispatch", "conversation_model_dispatch", "tool_result", "foundation_revision"]);
    const reusable = snapshot.inputs.every(source => reusableKinds.has(source.kind)) &&
      snapshot.policy.foundationRevisionIds.every(revisionId => snapshot.inputs.some(source =>
        source.kind === "foundation_revision" && source.revisionId === revisionId));
    nativeSourceMemoRecordFrozenTask(snapshot.inputs, reusable ? "eligible" : "ineligible");
    const completeKey = `frozen-task-snapshot:${nativeSha256({ companyId, issueId, snapshot })}`;
    let proofStack = scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey);
    if (!proofStack) {
      proofStack = [];
      scope.context.ancestry.frozenTaskProofStacks.set(scope.actorKey, proofStack);
    }
    for (const parent of proofStack) parent.descendants.add(visitKey);
    const cachedDescendants = reusable ? scope.frozenTaskSnapshots.get(completeKey) : undefined;
    // A structural hit may not hide a descendant that is already active in
    // this recursive read. Fall back to the ordinary traversal so its live
    // ancestry/cycle checks reject the cycle.
    const cachedCycle = cachedDescendants
      ? nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, cachedDescendants) : false;
    const cachedMutableSources = scope.frozenTaskMutableSources.get(completeKey);
    const mutableSourcesCurrent = reusable && cachedDescendants && !cachedCycle &&
      await nativeFrozenMutableSourcesCurrent(db, companyId, cachedMutableSources, scope);
    const structuralHit = Boolean(reusable && cachedDescendants && !cachedCycle && mutableSourcesCurrent);
    const cachedReaderProof = !scope.context.ancestry.graphProofsDisabled ? cachedMutableSources?.readerProof : undefined;
    const sameReaderContext = cachedReaderProof?.readerObligations !== undefined &&
      cachedReaderProof.readerObligations === scope.context.readerObligations;
    const completedReaders = cachedReaderProof?.readerObligations.completed;
    let readerProofCurrent: boolean | undefined;
    if (structuralHit && cachedReaderProof && (sameReaderContext || completedReaders)) {
      const ownPin = (sameReaderContext ? scope.taskTemporalScopes : completedReaders?.taskPins)?.get(issueId);
      readerProofCurrent = Boolean(ownPin && ownPin.contentHash === snapshot.owner.contentHash &&
        ownPin.snapshotDigest === snapshot.digest && (sameReaderContext || completedReaders &&
          await replayNativeSourceGraphObligations(scope, completedReaders, cachedReaderProof.readerSets)));
    }
    if (structuralHit && cachedDescendants && readerProofCurrent === true) {
      // Other-context descriptors become reusable only after the original full
      // reader flush and company fence. The existing replay restores exact
      // Task pins and freshly checks Skills and every deferred owner family.
      recordNativeProofReaderSetUse(scope, readerProofCurrent ? cachedReaderProof?.readerSets : undefined);
      propagateNativeMutableSources(scope, cachedMutableSources!);
      // A page-retained proof hit still consumes the active Native scope's
      // work budget and participates in its ancestry/cycle guard.
      nativeSourceReadWork(scope);
      nativeSourceMemoRecordFrozenTask(snapshot.inputs, "hit");
      // Comments are mutable owner rows, so they are deliberately re-read on
      // every frozen Task proof hit. Only the already-validated ancestor and
      // dispatch graph is reused; each exact comment rendition, snapshot, and
      // current reader authority still gets its original check.
      for (const source of snapshot.inputs) if (source.kind === "comment") {
        const rootTask = snapshot.inputs.find((candidate): candidate is Extract<NativePayloadSourceInput, { kind: "task" }> =>
          candidate.kind === "task" && candidate.issueId === source.issueId);
        const selfOwnedConversationTaskId = rootTask && scope.conversationRootComments.has(
          nativeSha256({ companyId, task: rootTask, source })) ? source.issueId : undefined;
        await assertConversationCommentSourceCurrent(db, { companyId, actor, source, policy: snapshot.policy,
          inputs: snapshot.inputs, ...(selfOwnedConversationTaskId ? { selfOwnedConversationTaskId } : {}) }, scope);
      }
      deferNativeSourceReaderCheck(scope, { companyId, runId: last.source.runId, actor,
        policy: snapshot.policy, inputs: snapshot.inputs });
      for (const parent of proofStack) addNativeFrozenTaskDescendantClosure(parent.descendants, visitKey, cachedDescendants);
      return;
    }
    // Charge only a cold recursive proof. The exact-hit path above still checks
    // the per-component receipt and cycle bindings and queues fresh reader
    // authority, but does not repeat this bounded owner graph traversal.
    nativeSourceReadWork(scope);
    if (reusable) nativeSourceMemoRecordFrozenTask(snapshot.inputs, "miss");
    const readerObligations = !scope.context.ancestry.graphProofsDisabled && is(db, PgTransaction)
      ? (scope.context.readerObligations ??= {}) : undefined;
    const proofFrame: NativeSourceProofFrame = { visitKey, descendants: new Set<string>(), mutableSources: newNativeMutableSources(),
      readerSelection: { context: scope.context, sets: new Map(), complete: true } };
    proofStack.push(proofFrame);
    let completed = false;
    try {
    const [producer] = await db.select({ issueId: heartbeatRuns.nativeIssueId,
      profile: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, last.source.runId), eq(heartbeatRuns.runtimeMode, "native")))
      .for("share");
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
      sourceSet: { policy: snapshot.policy, inputs: snapshot.inputs } }, scope, siblingToolSourceProofs);
    completed = true;
    } finally {
      if (proofStack.at(-1) === proofFrame) proofStack.pop();
      if (completed) {
        if (reusable && scope.frozenTaskSnapshots.size < 512) {
          scope.frozenTaskSnapshots.set(completeKey, new Set(proofFrame.descendants));
          const readerProof = proofFrame.readerSelection?.complete && readerObligations && !scope.context.ancestry.graphProofsDisabled
            ? { readerSets: new Map(proofFrame.readerSelection.sets), readerObligations } : undefined;
          scope.frozenTaskMutableSources.set(completeKey, { ...proofFrame.mutableSources,
            ...(readerProof ? { readerProof } : {}) });
        }
        for (const parent of proofStack)
          addNativeFrozenTaskDescendantClosure(parent.descendants, visitKey, proofFrame.descendants);
      }
    }
  } finally {
    scope.active.delete(visitKey);
  }
}

async function assertNativeTaskSourceInputCurrentInScope(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  source: Extract<NativePayloadSourceInput, { kind: "task" }>, scope: NativeSourceReadScope, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map(), historicalTransition?: NativeHistoricalPendingTransitionContext): Promise<string | null> {
  nativeSourceReadWork(scope);
  const [task] = await db.select({ id: issues.id, companyId: issues.companyId, identifier: issues.identifier,
    title: issues.title, description: issues.description, workMode: issues.workMode, status: issues.status,
    priority: issues.priority,
    ownerBodyHash: sql<string>`public.aw_native_payload_body_hash('issue',to_jsonb(${issues}))` })
    .from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, source.issueId))).for("share");
  // New Task sources bind to the canonical payload-only owner hash, which is
  // stable across operational status/assignment changes. Keep exact current
  // projection-hash compatibility for already stored captures.
  const bodyHash = task ? createHash("sha256").update(JSON.stringify({ id: source.issueId,
    identifier: task.identifier ?? null, title: task.title, description: task.description ?? null,
    workMode: task.workMode }), "utf8").digest("hex") : null;
  const ancestorHash = task ? createHash("sha256").update(JSON.stringify({ id: source.issueId,
    identifier: task.identifier ?? null, title: task.title, status: task.status, priority: task.priority }), "utf8").digest("hex") : null;
  let historicalTask=false;
  if(task && task.ownerBodyHash!==source.contentHash && bodyHash!==source.contentHash && ancestorHash!==source.contentHash && historicalTransition?.stageBodyReads?.length){
    const {captureNativeFinalizedStageTaskBodyRead}=await import("./native-stage-task-body-source.js");
    for(const read of historicalTransition.stageBodyReads){
      if(read.producer.companyId!==companyId || read.producer.issueId!==source.issueId || !isDeepStrictEqual(read.producer.taskCapture.input,source)) continue;
      const current=await captureNativeFinalizedStageTaskBodyRead(db,{companyId,issueId:source.issueId,runId:read.producer.runId,reader:actor});
      if(!current || !isDeepStrictEqual(current,read.producer)) throw forbidden("A historical Stage Task owner changed");
      const [owner]=await db.select({snapshot:issues.payloadSourceSnapshot}).from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,source.issueId))).for("share");
      const snapshot=nativePayloadSourceSnapshotSchema.safeParse(owner?.snapshot);
      if(!snapshot.success) throw forbidden("A historical Stage Task source was erased");
      let prefixDigest=read.producer.taskCapture.payloadSourceSnapshot.digest;
      let prefixHash=source.contentHash,matched=false;
      for(const step of snapshot.data.transforms ?? []){
        if(step.previousSnapshotDigest===prefixDigest && step.previousOwnerContentHash===prefixHash) matched=true;
        if(matched){prefixHash=step.nextOwnerContentHash;}
      }
      if(!matched || prefixHash!==snapshot.data.owner.contentHash) throw forbidden("A historical Stage Task source lineage changed");
      historicalTask=true;
    }
    disableNativeSourceGraphCheckpoints(scope);
  }
  if (!task || (!historicalTask && task.ownerBodyHash !== source.contentHash &&
      bodyHash !== source.contentHash && ancestorHash !== source.contentHash)) throw forbidden("A Native source Task changed");
  return assertNativeTaskSnapshotOwnerCurrentInScope(db, companyId, actor, source.issueId, scope, undefined, source, siblingToolSourceProofs);
}

async function assertConversationCommentSourceCurrent(db: Db | Transaction, input: {
  companyId: string; actor: AuthorizationActor; source: Extract<NativePayloadSourceInput, { kind: "comment" }>;
  policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[];
  selfOwnedConversationTaskId?: string;
}, scope: NativeSourceReadScope) {
  nativeSourceReadWork(scope);
  const [comment] = await db.select({ sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text`,
    authorAgentId: issueComments.authorAgentId, authorType: issueComments.authorType, authorUserId: issueComments.authorUserId,
    createdByRunId: issueComments.createdByRunId, createdAt: issueComments.createdAt, updatedAt: issueComments.updatedAt,
    body: issueComments.body, rawPresentation: issueComments.presentation, rawMetadata: issueComments.metadata,
    sourceTrust: issueComments.sourceTrust,
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
  const reject = (): never => { throw forbidden("A Native source Comment changed or was erased"); };
  if (!comment || comment.sourceVersion !== input.source.sourceVersion || projection === null) return reject();
  const snapshotRootsRetained = snapshot.success && snapshot.data.inputs.every(root =>
    input.inputs.some(candidate => isDeepStrictEqual(candidate, root))) &&
    (Object.keys(input.policy) as (keyof NativePayloadSourcePolicy)[]).every(key =>
      snapshot.data.policy[key].every(sourceId => input.policy[key].includes(sourceId) ||
        (key === "issueIds" && input.selfOwnedConversationTaskId === input.source.issueId &&
          sourceId === input.selfOwnedConversationTaskId)));
  if (comment.payloadSourceSnapshotInvalidated || !snapshot.success || !snapshotRootsRetained ||
    comment.payloadSourceSnapshotDigestValid !== true || snapshot.data.digest !== comment.payloadSourceSnapshot?.digest ||
    snapshot.data.owner.kind !== "comment" || snapshot.data.owner.companyId !== input.companyId ||
    snapshot.data.owner.id !== input.source.commentId || snapshot.data.owner.contentHash !== comment.ownerBodyHash) reject();
  const ownerProjectionHash = nativeCommentProjectionHash({ body: comment.body,
    presentation: comment.rawPresentation, metadata: comment.rawMetadata });
  const publicProjectionHash = nativeCommentProjectionHash({ body: projection.body,
    presentation: projection.presentation, metadata: projection.metadata });
  // Original read owners consume three exact comment renditions: the public
  // Native history DTO, the inline wake DTO, and the bounded conversation
  // replay line. Each is reconstructed from this same current owner row; a
  // caller-provided hash is never accepted by itself.
  const inlineWakeProjectionHashes = [comment, projection].map(value => createHash("sha256").update(JSON.stringify({
    body: value.body, presentation: "rawPresentation" in value ? value.rawPresentation : value.presentation,
    metadata: "rawMetadata" in value ? value.rawMetadata : value.metadata,
  }), "utf8").digest("hex"));
  const replayBodies = [comment.body, projection.body].map(body => sanitizeQuarantinedCommentForHigherTrust({ body: String(body ?? ""),
    presentation: comment.rawPresentation, metadata: comment.rawMetadata, sourceTrust: comment.sourceTrust }).body.slice(0, 8000));
  const replayHashes = replayBodies.map(body => createHash("sha256").update(JSON.stringify({
    author: comment.authorAgentId ? "agent" : "user", body,
  }), "utf8").digest("hex"));
  const ordinaryHashes = [ownerProjectionHash, publicProjectionHash, ...inlineWakeProjectionHashes, ...replayHashes];
  if (!ordinaryHashes.includes(input.source.contentHash)) {
    const continuationHashes: string[] = [];
    const redactions = createRunSecretRedactionRegistry(db as Db);
    const redactedInlineHashes: string[] = [];
    for (const value of [
      { body: comment.body, presentation: comment.rawPresentation, metadata: comment.rawMetadata },
      { body: projection.body, presentation: projection.presentation, metadata: projection.metadata },
      sanitizeQuarantinedCommentForHigherTrust({ body: comment.body, presentation: comment.rawPresentation,
        metadata: comment.rawMetadata, sourceTrust: comment.sourceTrust }),
    ]) {
      const redacted = await redactions.redactForIssue(input.companyId, input.source.issueId, value);
      redactedInlineHashes.push(nativeCommentProjectionHash(redacted));
    }
    for (const body of [...new Set([comment.body, sanitizeQuarantinedCommentForHigherTrust({ body: comment.body,
      presentation: comment.rawPresentation, metadata: comment.rawMetadata, sourceTrust: comment.sourceTrust }).body])]) {
      const projection = nativeContinuationCommentProjection({ ...comment, id: input.source.commentId, body, deletedAt: null });
      const redacted = await redactions.redactForIssue(input.companyId, input.source.issueId, projection);
      continuationHashes.push(nativeContinuationMessageHash(redacted));
    }
    if (!continuationHashes.includes(input.source.contentHash) && !redactedInlineHashes.includes(input.source.contentHash)) reject();
  }

  // Comment and every other source input are still validated against this
  // exact current owner above. The Issue reader ACL is time-sensitive and
  // applies once per exact actor/Issue; defer it into the source transaction's
  // final reader pass so cumulative prefixes do not rerun the same recursive
  // privacy query before later owner-row waits.
  if (activeMemoryTemporalContexts(db, input.actor, "issue", input.source.issueId) !== undefined) {
    // This exact Issue is part of the active Memory owner's sourceIssueIds.
    // The sole withReadMemoryTemporalSources caller is
    // canActorReadMemorySources in memory-privacy.ts; its callback performs the
    // mandatory current reader check after this full frozen owner proof returns,
    // while the same captured Context scope is still active. Checking it here
    // would run before the remaining owner waits and could retroactively apply
    // this later Memory prefix to an older Task/comment snapshot.
  } else {
    deferNativeSourceOwnerReaderChecks(scope, { companyId: input.companyId, actor: input.actor,
      issueIds: [input.source.issueId] });
  }
}

async function assertNativeTaskSnapshotOwnerCurrentInScope(db: Db | Transaction, companyId: string, actor: AuthorizationActor,
  issueId: string, scope: NativeSourceReadScope, expected?: { snapshot: unknown },
  validatedTaskSource?: Extract<NativePayloadSourceInput, { kind: "task" }>, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map()): Promise<string | null> {
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
    const validateProtocolOneTask = async (taskScope: NativeSourceReadScope, taskProofs: NativeSiblingToolSourceProofs) => {
      if (owner.conversationAgentId && owner.conversationUserId) {
        const source = snapshot.data.inputs.length === 1 ? snapshot.data.inputs[0] : null;
        const exactCommentRoot = source?.kind === "comment" && source.issueId === issueId &&
          isDeepStrictEqual(snapshot.data.policy, { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] });
        const [comment] = exactCommentRoot ? await db.select({ authorUserId: issueComments.authorUserId,
          authorType: issueComments.authorType }).from(issueComments).where(and(eq(issueComments.companyId, companyId),
          eq(issueComments.issueId, issueId), eq(issueComments.id, source.commentId), isNull(issueComments.deletedAt))).for("share") : [];
        if (source?.kind === "attachment" && source.issueId === issueId && source.commentId === null &&
            source.disposition === "delivered" &&
            isDeepStrictEqual(snapshot.data.policy, { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] })) {
          // An actual first Human upload can seal the pristine shell, just as
          // its first Human comment does. Validate that exact original witness
          // here; the ordinary attachment reader still checks its parent ACL.
          const [uploaded] = await db.select({ attachment: issueAttachments, asset: assets,
            bodyHash: sql<string>`public.aw_native_payload_body_hash('attachment',to_jsonb(${issueAttachments}))`,
            digestValid: sql<boolean>`(${issueAttachments.payloadSourceSnapshot}->>'digest')=encode(sha256(convert_to((${issueAttachments.payloadSourceSnapshot}-'digest')::text,'UTF8')),'hex')` })
            .from(issueAttachments).innerJoin(assets, and(eq(assets.companyId, issueAttachments.companyId),
              eq(assets.id, issueAttachments.assetId))).where(and(eq(issueAttachments.companyId, companyId),
              eq(issueAttachments.issueId, issueId), eq(issueAttachments.id, source.attachmentId))).for("share");
          const uploadSnapshot = nativePayloadSourceSnapshotSchema.safeParse(uploaded?.attachment.payloadSourceSnapshot);
          if (!source.assetId || !source.sha256 || !Number.isSafeInteger(source.byteSize) ||
              source.byteSize === null || source.byteSize <= 0 ||
              !uploaded || uploaded.attachment.payloadSourceProtocolVersion !== 1 ||
              uploaded.attachment.payloadSourceSnapshotInvalidated || !uploaded.digestValid || !uploadSnapshot.success ||
              uploadSnapshot.data.owner.kind !== "attachment" || uploadSnapshot.data.owner.companyId !== companyId ||
              uploadSnapshot.data.owner.id !== source.attachmentId || uploadSnapshot.data.owner.contentHash !== uploaded.bodyHash ||
              !isDeepStrictEqual(uploadSnapshot.data.policy, { ...snapshot.data.policy, issueIds: [issueId] }) || uploadSnapshot.data.inputs.length !== 0 ||
              uploaded.attachment.issueCommentId !== null || uploaded.attachment.originatingRunId !== null ||
              uploaded.asset.createdByAgentId !== null || uploaded.asset.createdByUserId !== owner.conversationUserId ||
              source.assetId !== uploaded.asset.id || source.sha256 !== uploaded.asset.sha256 || source.byteSize !== uploaded.asset.byteSize)
            throw forbidden("The Native conversation upload source witness is unavailable");
          const [capture] = await db.select({ id: activityLog.id }).from(activityLog).where(and(
            eq(activityLog.companyId, companyId), eq(activityLog.actorType, "user"),
            eq(activityLog.actorId, owner.conversationUserId), eq(activityLog.entityType, "issue"),
            eq(activityLog.entityId, issueId), eq(activityLog.action, "attachment.payload_source_captured"),
            sql`${activityLog.details}->>'attachmentId'=${source.attachmentId}`,
            sql`${activityLog.details}->>'assetId'=${uploaded.asset.id}`,
            sql`${activityLog.details}->>'producer'='direct_manual_upload'`,
            sql`${activityLog.details}->>'digest'=${uploadSnapshot.data.digest}`)).limit(1);
          if (!capture) throw forbidden("The Native conversation upload source receipt is unavailable");
        } else {
          if (!exactCommentRoot || !comment || comment.authorUserId !== owner.conversationUserId || comment.authorType !== "user")
            throw forbidden("The Native conversation source witness is unavailable");
          await assertConversationCommentSourceCurrent(db, { companyId, actor, source, policy: snapshot.data.policy,
            inputs: snapshot.data.inputs, selfOwnedConversationTaskId: issueId }, taskScope);
          if (validatedTaskSource?.issueId === issueId)
            taskScope.conversationRootComments.add(nativeSha256({ companyId, task: validatedTaskSource, source }));
        }
      } else await assertNativeFrozenTaskSnapshotCurrent(db, companyId, actor, issueId, snapshot.data, taskScope, taskProofs);
      if (snapshot.data.inputs.some(source =>
        source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch"))
        taskScope.taskTemporalScopes.set(issueId, { contentHash: snapshot.data.owner.contentHash, snapshotDigest: snapshot.data.digest });
      deferNativeSourceOwnerReaderChecks(taskScope, { companyId, actor, issueIds: [issueId] });
    return snapshot.data.digest;
    };
    if (snapshot.data.inputs.some(source =>
      source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch"))
      return withReadPinnedNativeTaskSnapshot(db, actor, companyId, issueId, async () => {
        const current = nativeSourceReadScopes.getStore();
        if (current === scope.context && current.active && current.db === (db as object) &&
          current.memoryTemporalIdentity === activeMemoryTemporalReadScopeIdentity(db, actor) &&
          scope.actorKey === nativeSha256(actor)) {
          if (!current.ancestry.graphProofsDisabled && current.privacyLockedCompanies.has(companyId))
            return validateProtocolOneTask(scope, siblingToolSourceProofs);
          // An effect-disabled matching context still needs fresh public maps.
          return withNativeSourceReadScope(db, actor, companyId,
            freshScope => validateProtocolOneTask(freshScope, new Map()));
        }
        const childHandle: NativeSourceGraphObligationHandle = {};
        const mutableSources = newNativeMutableSources();
        const descriptor: NativeScopedTaskRead = { companyId, actor, issueId, contentHash: snapshot.data.owner.contentHash,
          snapshotDigest: snapshot.data.digest, childHandle, mutableSources };
        const visitKey = nativeScopedTaskReadKey(descriptor);
        if (scope.active.has(visitKey)) throw forbidden("The Native scoped Task source graph contains a cycle");
        const owned = scope.context.scopedTaskReads.get(visitKey);
        if (owned?.pending && owned.descendants && owned.mutableSources.compatible &&
          owned.pending.owner === scope.context.ancestry.pendingTaskOwner &&
          current === scope.context && current.active && current.db === (db as object) &&
          current.privacyLockedCompanies.has(companyId) && !current.flushingReaders &&
          !current.ancestry.graphProofsDisabled && !nativeSourceEffectBarrierActive(current) &&
          !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, owned.descendants) &&
          await nativeFrozenMutableSourcesCurrent(db as Db, companyId, owned.mutableSources, scope) &&
          await nativeSourceReaderHasCompanyAccess(db, companyId, actor)) {
          // The SAME parent still owns this unchecked Task continuation. Its
          // pending reader checks remain queued; this skips only a duplicate
          // structural walk after the fresh exact Task owner checks above.
          nativeSourceReadWork(scope);
          recordNativeProofReaderSetUse(scope, undefined);
          propagateNativeMutableSources(scope, owned.mutableSources);
          for (const frame of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? [])
            addNativeFrozenTaskDescendantClosure(frame.descendants, visitKey, owned.descendants);
          deferNativeScopedTaskRead(scope, owned);
          const ownPin = { contentHash: snapshot.data.owner.contentHash, snapshotDigest: snapshot.data.digest };
          const previous = scope.taskTemporalScopes.get(issueId);
          if (previous && !isDeepStrictEqual(previous, ownPin)) throw forbidden("The Native Task owner scope changed");
          scope.taskTemporalScopes.set(issueId, ownPin);
          deferNativeSourceOwnerReaderChecks(scope, { companyId, actor, issueIds: [issueId] });
          return snapshot.data.digest;
        }
        const descendants = new Set<string>();
        descriptor.descendants = descendants;
        addNativeSourceActiveVisit(scope, visitKey);
        let childContext: NativeSourceReadContext | undefined;
        let result: string;
        try {
          result = await withNativeSourceReadScope(db, actor, companyId, async childScope => {
            childContext = childScope.context;
            childScope.context.readerObligations ??= childHandle;
            const stack = childScope.context.ancestry.frozenTaskProofStacks.get(childScope.actorKey) ?? [];
            childScope.context.ancestry.frozenTaskProofStacks.set(childScope.actorKey, stack);
            const frame: NativeSourceProofFrame = { visitKey, descendants, mutableSources };
            stack.push(frame);
            try { return await validateProtocolOneTask(childScope, new Map()); }
            finally { if (stack.at(-1) === frame) stack.pop(); }
          }, undefined, { scope, check: descriptor });
        } finally { scope.active.delete(visitKey); }
        if (childContext !== scope.context) {
          // Preserve a pure scoped obligation, not its reader results. Its
          // complete queues are replayed only after reentering this Task prefix.
          const retainedHandle = childContext?.readerObligations;
          if (retainedHandle) descriptor.childHandle = retainedHandle;
          if (!retainedHandle?.completed && !descriptor.pending || !mutableSources.compatible)
            markNativeSourceProofsIncompatible(scope);
          deferNativeScopedTaskRead(scope, descriptor);
          const ownPin = { contentHash: snapshot.data.owner.contentHash, snapshotDigest: snapshot.data.digest };
          const previous = scope.taskTemporalScopes.get(issueId);
          if (previous && !isDeepStrictEqual(previous, ownPin)) throw forbidden("The Native Task owner scope changed");
          scope.taskTemporalScopes.set(issueId, ownPin);
          deferNativeSourceOwnerReaderChecks(scope, { companyId, actor, issueIds: [issueId] });
        }
        return result;
      });
    return validateProtocolOneTask(scope, siblingToolSourceProofs);
  } else if (owner.payloadSourceProtocolVersion === 0 || owner.payloadSourceProtocolVersion === null) {
    deferNativeAnalyticalTaskChecks(scope, companyId, actor, [issueId]);
  } else throw forbidden("A Native Task source protocol is unsupported");
  deferNativeSourceOwnerReaderChecks(scope, { companyId, actor, issueIds: [issueId] });
  return null;
}

/** Recognize only the original managed analytical copy owner. Other Memory
 * and Context families continue through their ordinary snapshot validators. */
async function assertNativeAnalyticalResultContextCurrent(db:Db,companyId:string,actor:AuthorizationActor,
 manifest:typeof contextManifests.$inferSelect,items:(typeof contextManifestItems.$inferSelect)[],
 roots:(typeof contextManifestMemoryRoots.$inferSelect)[]):Promise<boolean>{
 const {NATIVE_ANALYTICAL_RESULT_POLICY_HASH}=await import("./analytical-context-privacy.js");
 if(manifest.policySnapshotHash!==NATIVE_ANALYTICAL_RESULT_POLICY_HASH)return false;
 if(!manifest.runId||!manifest.issueId||items.length!==0||roots.length!==1||roots[0]!.payloadSourceSnapshot!==null)
  throw forbidden("The complete Native analytical result source is unavailable");
 const {analyticalContextRoots}=await import("@paperclipai/db");
 const [root]=await db.select().from(analyticalContextRoots).where(and(eq(analyticalContextRoots.companyId,companyId),
  eq(analyticalContextRoots.memoryRecordId,roots[0]!.memoryRecordId))).for("share");
 if(!root||root.contentHash!==roots[0]!.sourceVersion)
  throw forbidden("The Native analytical result source changed");
 const {assertAnalyticalContextPayloadAccess,assertAnalyticalRetentionRootOwnerCurrent}=await import("./analytical-context-authority.js");
 const owner=await assertAnalyticalRetentionRootOwnerCurrent(db,companyId,actor,root.memoryRecordId);
 const [producer]=await db.select({agentId:heartbeatRuns.agentId,responsibleUserId:heartbeatRuns.responsibleUserId,
  nativeIssueId:heartbeatRuns.nativeIssueId}).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,companyId),
  eq(heartbeatRuns.id,manifest.runId))).for("share");
 if(!producer||producer.agentId!==manifest.agentId||producer.nativeIssueId!==manifest.issueId||
  producer.responsibleUserId!==owner.privateOwnerUserId||
  owner.ownerAgentId!==manifest.agentId||owner.sourceRunIds.length!==1||owner.sourceRunIds[0]!==manifest.runId)
  throw forbidden("The Native analytical result owner changed");
 await assertAnalyticalContextPayloadAccess(db,companyId,actor,{runId:manifest.runId},"task");
 return true;
}

async function assertNativeContextInputOwnersCurrent(db: Db, companyId: string, actor: AuthorizationActor,
  inputs: Extract<NativePayloadSourceInput, { kind: "context" }>[], scope: NativeSourceReadScope,
  alreadyValidatedMemoryIds: ReadonlySet<string> = new Set(), completedTaskSourceProofs?: NativeCompletedTaskSourceProofs, siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map()) {
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
    // Pin the rendered Context facts before a graph-proof cache can skip its reader.
    identifier: issues.identifier, title: issues.title, description: issues.description,
    status: issues.status, priority: issues.priority, updatedAt: issues.updatedAt,
    payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion,
    payloadSourceSnapshot: issues.payloadSourceSnapshot, payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
    conversationAgentId: issues.conversationAgentId, conversationUserId: issues.conversationUserId })
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
    const manifestItems = items.filter(value => value.manifestId === manifest.id);
    const manifestRoots = roots.filter(value => value.manifestId === manifest.id);
    if(await assertNativeAnalyticalResultContextCurrent(db,companyId,actor,manifest,manifestItems,manifestRoots)) {
      markNativeSourceProofsIncompatible(scope);
      continue;
    }
    const readOwners = async () => {
    for (const item of manifestItems) {
      nativeSourceReadWork(scope);
      if (item.sourceProvider === "august_works_tasks") {
        const match = /^issue:\/\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
        const owner = match ? taskOwnerById.get(match[1]!) : undefined;
        const ownerHash = match ? taskHashById.get(match[1]!) : undefined;
        const snapshot = nativePayloadSourceSnapshotSchema.safeParse(owner?.payloadSourceSnapshot);
        const contextTaskCurrent = match && owner && snapshot.success
          ? await assertNativeContextTaskSourceCurrent(db, { actor, companyId, agentId: manifest.agentId,
            issueId: match[1]!, manifest, item, consumption: "retained" }) : false;
        if (!match || !owner || !ownerHash || owner.payloadSourceSnapshotInvalidated || !snapshot.success ||
          snapshot.data.owner.kind !== "issue" || snapshot.data.owner.companyId !== companyId ||
          snapshot.data.owner.id !== match[1]! || snapshot.data.owner.contentHash !== ownerHash.hash ||
          owner.payloadSourceProtocolVersion === 1 && !ownerHash.snapshotDigestValid ||
          !item.sourceVersion || !contextTaskCurrent)
          throw forbidden("A Native Context Task source changed or was erased");
        if (owner.payloadSourceProtocolVersion === 1) {
          legacyTaskIssueIds.delete(match[1]!);
          const taskSource = { kind: "task" as const, issueId: match[1]!, sourceVersion: item.sourceVersion,
            contentHash: snapshot.data.owner.contentHash };
          const taskProofIdentity = completedTaskSourceProofs && nativeManagedConsumedTaskSourceProofIdentity(companyId,
            actor, taskSource, scope.context.memoryTemporalIdentity);
          const taskProof = taskProofIdentity ? completedTaskSourceProofs?.get(taskProofIdentity) : undefined;
          const taskProofAlreadyCurrent = Boolean(taskProof && taskProof.mutableSources.compatible &&
            !scope.context.ancestry.graphProofsDisabled && taskProof.key ===
            nativeManagedConsumedTaskSourceProofKey(companyId, actor, taskSource, snapshot.data.digest,
              scope.context.memoryTemporalIdentity) &&
            !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, taskProof.descendants));
          if (taskProofAlreadyCurrent && taskProof) {
            recordNativeProofReaderSetUse(scope, taskProof.readerSets);
            propagateNativeMutableSources(scope, taskProof.mutableSources);
            for (const parent of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? [])
              for (const descendant of taskProof.descendants) parent.descendants.add(descendant);
          }
          // A route-created conversation Task starts from one exact Human
          // comment owner snapshot; it has no prior provider dispatch to retain.
          // Reuse the same strict current-owner/ACL/comment-witness validator
          // as the ordinary Task source path instead of requiring a fictitious
          // frozen model dispatch. All other protocol-v1 Tasks still require
          // their complete retained dispatch closure.
          // When this exact Task capture was already fully validated from the
          // current source prefix in this transaction, the Context item above
          // has still been matched against its pinned live owner snapshot and
          // the owner reader ACL is queued again below. Reuse only that exact
          // actor + Task + active Memory prefix proof; never union task prefixes.
          if (!taskProofAlreadyCurrent) {
            await assertNativeTaskSnapshotOwnerCurrentInScope(db, companyId, actor, match[1]!, scope,
              { snapshot: owner.payloadSourceSnapshot }, undefined, siblingToolSourceProofs);
          }
        }
        deferNativeSourceOwnerReaderChecks(scope, { companyId, actor, issueIds: [match[1]!] });
      } else if (item.sourceProvider === "august_works_memory" || item.sourceProvider === "august_works_derived_memory") {
        const match = /^memory:\/\/(?:record|derived)\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
        if (!match) throw forbidden("A Native Context Memory source is unavailable");
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
        if (!alreadyValidatedMemoryIds.has(match[1]!))
          deferNativeSourceOwnerReaderChecks(scope, { companyId, actor, memoryIds: [match[1]!] });
      } else if (item.sourceProvider === "august_works_foundation") {
        const match = /^foundation:\/\/[0-9a-f-]{36}\/([0-9a-f-]{36})\/(?:whole|\d+)$/i.exec(item.sourceRef);
        if (!match || item.sourceVersion !== match[1]) throw forbidden("A Native Context Foundation source is unavailable");
        await assertLearnedAssetAnalyticalSources(db, companyId, "document_revision", match[1]!, actor);
      } else throw forbidden("A Native Context source family is unsupported");
    }
    for (const root of manifestRoots) {
      nativeSourceReadWork(scope);
      const [memory] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
        payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated, revokedAt: memoryRecords.revokedAt,
        supersededByRecordId: memoryRecords.supersededByRecordId, deletedAt: memoryRecords.deletedAt }).from(memoryRecords)
        .where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, root.memoryRecordId), memoryPayloadVisible(), isNull(memoryRecords.deletedAt))).for("share");
      if (!memory || memory.deletedAt || memory.revokedAt || memory.supersededByRecordId || memory.payloadSourceSnapshotInvalidated ||
        !nativePayloadSourceSnapshotSchema.safeParse(memory.payloadSourceSnapshot).success ||
        !isDeepStrictEqual(memory.payloadSourceSnapshot, root.payloadSourceSnapshot))
        throw forbidden("A Native Context Memory root is unavailable");
      if (!alreadyValidatedMemoryIds.has(root.memoryRecordId))
        deferNativeSourceOwnerReaderChecks(scope, { companyId, actor, memoryIds: [root.memoryRecordId] });
    }
    };
    const reusable = is(db, PgTransaction) && scope.context.db === (db as object) && manifest.projectId === null && manifestItems.every(item =>
      item.sourceProvider === "august_works_tasks" || item.sourceProvider === "august_works_memory" ||
      item.sourceProvider === "august_works_derived_memory");
    if (!reusable) {
      markNativeSourceProofsIncompatible(scope);
      await readOwners();
      continue;
    }
    const contextSource = inputs.find(source => source.manifestId === manifest.id);
    if (!contextSource) throw forbidden("A Native Context manifest source is unavailable");
    const taskBindings = manifestItems.filter(item => item.sourceProvider === "august_works_tasks").map(item => {
      const taskId = item.sourceRef.slice("issue://".length);
      return { owner: taskOwnerById.get(taskId), hash: taskHashById.get(taskId) };
    });
    const ownerKey = `context-owner:${nativeSha256({ companyId, actor, actorScope: scope.actorKey,
      memoryTemporalIdentity: scope.context.memoryTemporalIdentity, source: contextSource,
      manifest, items: manifestItems, roots: manifestRoots, taskBindings,
      alreadyValidatedMemoryIds: [...alreadyValidatedMemoryIds].sort() })}`;
    const reader = { companyId, actor, runId: manifest.runId ?? manifest.id,
      policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] },
      inputs: [contextSource] };
    await withNativeSourceGraphProof(scope, siblingToolSourceProofs, ownerKey, reader, async () => {
      await readOwners();
      for (const binding of taskBindings) {
        const snapshot = nativePayloadSourceSnapshotSchema.safeParse(binding.owner?.payloadSourceSnapshot);
        if (binding.owner?.payloadSourceProtocolVersion !== 1 || !snapshot.success ||
          !snapshot.data.inputs.some(source => source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch")) continue;
        const pin = scope.taskTemporalScopes.get(binding.owner.id);
        if (!pin || pin.contentHash !== snapshot.data.owner.contentHash || pin.snapshotDigest !== snapshot.data.digest)
          markNativeSourceProofsIncompatible(scope);
      }
    }, 0, false);
    // A hit carries the exact current Task pins/readers via the existing
    // completed obligation replay; don't reclassify those v1 owners as legacy.
    for (const binding of taskBindings) if (binding.owner?.payloadSourceProtocolVersion === 1)
      legacyTaskIssueIds.delete(binding.owner.id);
  }
  if (legacyTaskIssueIds.size) deferNativeAnalyticalTaskChecks(scope, companyId, actor, legacyTaskIssueIds);
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
      nativeTemporalContextContentHash(manifest,items.filter(item=>item.manifestId===manifest.id),roots.filter(root=>root.manifestId===manifest.id))!==input.contentHash)
      throw forbidden("Captured Context source changed");
  }
}

async function assertNativeDocumentRuntimeSkillCurrent(db: Db | Transaction, companyId: string,
  actor: AuthorizationActor, source: Extract<NativePayloadSourceInput, { kind: "runtime_skill" }>, runId: string) {
  const [run] = await db.select({ profile: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
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
  if (source.versionId) {
    await assertRetainedRuntimeSkillSourceCurrent(db as Db, { companyId, actor, producerRunId: runId,
      source: { ...source, versionId: source.versionId } }).catch(() => {
      throw forbidden("A Native document runtime Skill source changed");
    });
  } else await readNativeRuntimeAssetText(bundle, 256000, { companyId, runId }).catch(() => {
    throw forbidden("A Native document runtime Skill was erased");
  });
  recordNativeRuntimeSkillRead(db, companyId, actor, source, runId);
}

/** Revalidates the original sources of a Native-derived document before any
 * HTTP, download, revision, or Native-tool reader returns its body. The snapshot
 * is evidence only; every referenced owner and current reader policy is checked
 * again. Unknown source families fail closed. */
export async function assertNativeDocumentRevisionCurrentSourceAccess(db: Db, input: {
  companyId: string; issueId: string; revisionId: string; actor: AuthorizationActor; requireLatest?: boolean;
}): Promise<void> {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, input.actor, input.companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, input.companyId, scope);
    return assertNativeDocumentRevisionCurrentSourceAccessInScope(tx as Db, input, scope, 0);
  }));
}

async function assertNativeDocumentRevisionCurrentSourceAccessInScope(db: Db, input: {
  companyId: string; issueId: string; revisionId: string; actor: AuthorizationActor; requireLatest?: boolean;
}, scope: NativeSourceReadScope, depth: number,
  siblingToolSourceProofs: NativeSiblingToolSourceProofs = new Map()): Promise<void> {
  const activeKey = `${input.companyId}:${input.revisionId}`;
  const completeKey = nativeSha256({ companyId: input.companyId, issueId: input.issueId, revisionId: input.revisionId,
    requireLatest: input.requireLatest !== false, actor: input.actor,
    memoryTemporalIdentity: scope.context.memoryTemporalIdentity, depth });
  if (depth > 8 || scope.active.has(activeKey)) throw forbidden("Native document source chain exceeds its bound");
  // A hit still costs one work unit and checks current owner/body/ACL state.
  nativeSourceReadWork(scope);
  addNativeSourceActiveVisit(scope, activeKey);
  try {
  // Re-read the exact revision, document link, and latest pointer on every
  // use, including a structural proof hit.
  const [selected] = await db.select({ revision: documentRevisions, latestRevisionId: documents.latestRevisionId,
    documentId: documents.id, issueId: issueDocuments.issueId }).from(documentRevisions)
    .innerJoin(documents, and(eq(documents.companyId, documentRevisions.companyId), eq(documents.id, documentRevisions.documentId)))
    .innerJoin(issueDocuments, and(eq(issueDocuments.companyId, documents.companyId), eq(issueDocuments.documentId, documents.id)))
    .where(and(eq(documentRevisions.companyId, input.companyId), eq(documentRevisions.id, input.revisionId),
      eq(issueDocuments.issueId, input.issueId))).for("share", { of: [documentRevisions, documents, issueDocuments] });
  if (!selected || input.requireLatest !== false && selected.latestRevisionId !== input.revisionId)
    throw forbidden("The selected Native document revision is unavailable");
  const [parentTask] = await db.select({ id: issues.id, companyId: issues.companyId }).from(issues).where(and(
    eq(issues.companyId, input.companyId), eq(issues.id, selected.issueId))).for("share");
  if (!parentTask) throw forbidden("The selected Native document Task is unavailable");
  // The exact parent Task row is pinned above; perform its current reader ACL
  // in the shared final pass after any document/source owner waits.
  deferNativeSourceOwnerReaderChecks(scope, { companyId: input.companyId, actor: input.actor,
    issueIds: [selected.issueId] });
  const revision = selected.revision;
  // Protocol-v1 outputs carry their exact historical source prefix. Rechecking
  // the parent Task against every later Context manifest would retroactively
  // attach private sources created after this output (for example, A before R).
  // The complete v1 snapshot below revalidates its exact owners and current
  // readers; legacy revisions retain the broader fail-closed Task check.
  if (revision.payloadSourceProtocolVersion !== 1)
    deferNativeAnalyticalTaskChecks(scope, input.companyId, input.actor, [selected.issueId]);
  if (revision.payloadSourceProtocolVersion === 0 || revision.payloadSourceProtocolVersion === null) {
    scope.active.delete(activeKey); return;
  }
  if (revision.payloadSourceProtocolVersion !== 1) throw forbidden("The Native document source protocol is unsupported");
  const parsed = nativePayloadSourceSnapshotSchema.safeParse(revision.payloadSourceSnapshot);
  const [ownerHash] = await db.execute<{ hash: string; snapshotDigestValid: boolean }>(sql`select
    public.aw_native_payload_body_hash('document_revision',to_jsonb(r)) as hash,
    r.payload_source_snapshot->>'digest'=encode(sha256(convert_to((r.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as "snapshotDigestValid"
    from document_revisions r where r.company_id=${input.companyId}::uuid and r.id=${input.revisionId}::uuid`);
  if (revision.payloadSourceSnapshotInvalidated || !parsed.success || parsed.data.owner.kind !== "document_revision" ||
    parsed.data.owner.companyId !== input.companyId || parsed.data.owner.id !== input.revisionId ||
    !ownerHash || !ownerHash.snapshotDigestValid || ownerHash.hash !== parsed.data.owner.contentHash)
    throw forbidden("The Native document source snapshot is unavailable");

  const snapshot = parsed.data;
  const dispatchInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput,
    { kind: "worker_model_dispatch" | "conversation_model_dispatch" }> =>
    source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch");
  const lastInput = snapshot.inputs.at(-1);
  const writerDispatch = lastInput?.kind === "worker_model_dispatch" || lastInput?.kind === "conversation_model_dispatch"
    ? lastInput : undefined;
  // The server writer appends its own dispatch after all retained inputs.
  // Earlier Runs remain sources; only this exact revision's producer may own
  // the write_document capture and the final appended marker.
  if (dispatchInputs.length > 64 || dispatchInputs.length > 0 && (!writerDispatch ||
    revision.createdByRunId !== writerDispatch.runId ||
    dispatchInputs.filter(source => isDeepStrictEqual(source, writerDispatch)).length !== 1))
    throw forbidden("The Native document source has ambiguous model dispatches");
  const dispatchRunId = writerDispatch?.runId;
  excludeUnpinnedNativeSourceProofs(scope, snapshot.policy, snapshot.inputs);
  const documentProofKey = `document-node:${nativeSha256({ companyId: input.companyId, issueId: input.issueId,
    revisionId: input.revisionId, actor: input.actor, actorScope: scope.actorKey,
    memoryTemporalIdentity: scope.context.memoryTemporalIdentity, requireLatest: input.requireLatest !== false,
    snapshot })}`;
  const documentProofEligible = nativeGraphProofInputsEligible(snapshot.policy, snapshot.inputs);
  let documentProof = documentProofEligible && !scope.context.ancestry.graphProofsDisabled ? siblingToolSourceProofs.get(documentProofKey) : undefined;
  if (documentProof && !documentProof.mutableSources.compatible) documentProof = undefined;
  // The exact owner/body/latest checks above stay fresh. Share only the
  // completed descendant walk within the existing sealed transaction tree.
  const documentLedger = !scope.context.ancestry.graphProofsDisabled && is(scope.context.db, PgTransaction)
    ? scope.context.ancestry.graphProofs : undefined;
  const documentLedgerKey = JSON.stringify([documentProofKey, depth]);
  const ownDocumentReaders = documentLedger ? (scope.context.readerObligations ??= {}) : undefined;
  if (documentProofEligible && (!documentProof || depth > (documentProof.validatedDepth ?? -1))) {
    const retained = documentLedger?.get(documentLedgerKey);
    const sameContext = retained?.readerObligations !== undefined && retained.readerObligations === ownDocumentReaders;
    const obligations = retained?.readerObligations?.completed;
    if (retained && depth <= (retained.validatedDepth ?? -1) && (sameContext || obligations) &&
      !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, retained.descendants) &&
      await nativeFrozenMutableSourcesCurrent(db, input.companyId, retained.mutableSources, scope) &&
      (sameContext || obligations && await replayNativeSourceGraphObligations(scope, obligations, retained.readerSets)))
      documentProof = retained;
  }
  if (documentProof && depth <= (documentProof.validatedDepth ?? -1) &&
    !nativeFrozenTaskMemoWouldIntersectActiveAncestry(scope.active, documentProof.descendants)) {
    recordNativeProofReaderSetUse(scope, documentProof.readerSets);
    propagateNativeMutableSources(scope, documentProof.mutableSources);
    if (nativeSourceMemoDiagnosticsEnabled()) nativeSourceMemoDiagnostics.documentNodeHits =
      Math.min(1_000_000, nativeSourceMemoDiagnostics.documentNodeHits + 1);
    const sourceDispatch = writerDispatch;
    for (const source of snapshot.inputs) {
      if (source.kind === "runtime_instructions") {
        if (!sourceDispatch) throw forbidden("A Native document runtime instruction owner is unavailable");
        await assertNativeRuntimeInstructionsCurrent(db, input.companyId, sourceDispatch.runId, source, scope);
      }
      if (source.kind === "runtime_skill") {
        if (!sourceDispatch) throw forbidden("A Native document runtime Skill owner is unavailable");
        await assertNativeDocumentRuntimeSkillCurrent(db, input.companyId, input.actor, source, sourceDispatch.runId);
      }
      if (source.kind === "native_task_wake") {
        if (!sourceDispatch || source.runId !== sourceDispatch.runId)
          throw forbidden("A Native document task wake source is unavailable");
        const wakeRun = await nativeSourceReadRun(db, input.companyId, source.runId, scope);
        const wakeReceipt = nativeRunInputSourceReceiptSchema.safeParse(nativeSourceRecord(wakeRun?.runnerProfileJson).nativeInputSourceReceipt);
        if (!wakeReceipt.success) throw forbidden("A Native document task wake source is unavailable");
        await assertNativeTaskWakeSourceCurrentInScope(db, scope, { companyId: input.companyId, issueId: input.issueId,
          runId: source.runId, actor: input.actor, source, inputs: snapshot.inputs, bootstrapInputs: wakeReceipt.data.bootstrap.inputs });
      }
    }
    deferNativeSourceReaderCheck(scope, { companyId: input.companyId,
      runId: dispatchRunId ?? input.revisionId,
      actor: input.actor, policy: snapshot.policy, inputs: snapshot.inputs });
    for (const parent of scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey) ?? [])
      for (const descendant of documentProof.descendants) parent.descendants.add(descendant);
    scope.active.delete(activeKey);
    return;
  }
  let documentProofStack = scope.context.ancestry.frozenTaskProofStacks.get(scope.actorKey);
  if (!documentProofStack) {
    documentProofStack = [];
    scope.context.ancestry.frozenTaskProofStacks.set(scope.actorKey, documentProofStack);
  }
  const documentFrame: NativeSourceProofFrame = { visitKey: activeKey, descendants: new Set<string>(), mutableSources: newNativeMutableSources(),
    readerSelection: { context: scope.context, sets: new Map(), complete: true } };
  documentProofStack.push(documentFrame);
  let documentCompleted = false;
  try {
  const policy = snapshot.policy;
  const taskSourceIds = [...new Set([...policy.issueIds, ...snapshot.inputs.flatMap(source =>
    source.kind === "task" ? [source.issueId] : [])])];
  const projectSourceIds = [...new Set([...policy.projectIds, ...snapshot.inputs.flatMap(source =>
    source.kind === "project" || source.kind === "project_workspace" ? [source.projectId] : [])])];
  const memorySourceIds = [...new Set([...policy.memoryIds, ...snapshot.inputs.flatMap(source =>
    source.kind === "memory" ? [source.memoryId] : [])])];
  let managedDocumentSourcesValidated = false;
  let memoryReviewReceipt: NativeRunInputSourceReceipt | undefined;
  let nativeInputReceipt: NativeRunInputSourceReceipt | undefined;
  if (dispatchInputs.length) {
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, dispatchRunId!), eq(heartbeatRuns.nativeIssueId, input.issueId)));
    const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
      ? run.runnerProfileJson as Record<string, unknown> : null;
    const receipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
    if (receipt?.success) {
      memoryReviewReceipt = receipt.data;
      nativeInputReceipt = receipt.data;
    }
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
        source.contentHash === result.resultDigest && bound.length === 1 && associations.length === 1 &&
        isDeepStrictEqual(bound[0]!.dispatch, writerDispatch)) {
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
    if (dispatchInputs.length === 1 && !dispatch) dispatch = writerDispatch;
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
    if (managed && managedCapture) {
      // The capture's original saved components and ordered union exactly match
      // this snapshot before its own dispatch. Validate that graph once.
      await assertNativeModelOutputCaptureCurrentInScope(db, input.companyId, input.issueId,
        managedCapture, "write_document", scope, depth + 1, input.actor, "settled", siblingToolSourceProofs);
      // The payload validator starts document reads at its own boundary. Keep
      // this document chain's original depth guard for every direct revision.
      for (const source of snapshot.inputs) if (source.kind === "document_revision") {
        nativeSourceReadWork(scope);
        if (!source.issueId) throw forbidden("A Native document history source is unavailable");
        await assertNativeDocumentRevisionCurrentSourceAccessInScope(db, { companyId: input.companyId,
          issueId: source.issueId, revisionId: source.revisionId, actor: input.actor, requireLatest: false },
          scope, depth + 1, siblingToolSourceProofs);
      }
      managedDocumentSourcesValidated = true;
    }
  } else if (snapshot.inputs.length > 0) {
    throw forbidden("A Native document source is missing its original model dispatch");
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

  if (!managedDocumentSourcesValidated) {
  const pinnedTaskSources = taskSourceIds.length ? await db.select({ id: issues.id }).from(issues)
    .where(and(eq(issues.companyId, input.companyId), inArray(issues.id, taskSourceIds))).for("share") : [];
  if (pinnedTaskSources.length !== taskSourceIds.length)
    throw forbidden("A Native document Task source is unavailable");
  for (const issueId of taskSourceIds) {
    const taskInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
      source.kind === "task" && source.issueId === issueId);
    if (taskInputs.length) {
      for (const source of taskInputs)
        await assertNativeTaskSourceInputCurrentInScope(db, input.companyId, input.actor, source, scope, siblingToolSourceProofs);
    } else {
      await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, issueId, scope, undefined, undefined, siblingToolSourceProofs);
    }
  }
  for (const projectId of projectSourceIds) {
    const projectInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project" }> =>
      source.kind === "project" && source.projectId === projectId);
    const workspaceInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "project_workspace" }> =>
      source.kind === "project_workspace" && source.projectId === projectId);
    await assertNativeProjectSourceCurrentInScope(db, { companyId: input.companyId, actor: input.actor, projectId,
      ...(projectInputs.length ? { sources: projectInputs } : {}), ...(workspaceInputs.length ? { workspaceSources: workspaceInputs } : {}) }, scope);
  }
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

  const contextInputs = snapshot.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "context" }> => source.kind === "context");
  await assertNativeTemporalContextInputsCurrent(db, input.companyId, contextInputs);
  if (contextInputs.length) {
    const ids = contextInputs.map(source => source.manifestId);
    const manifests = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, input.companyId), inArray(contextManifests.id, ids)));
    const items = await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, input.companyId), inArray(contextManifestItems.manifestId, ids)));
    const roots = await db.select().from(contextManifestMemoryRoots).where(and(eq(contextManifestMemoryRoots.companyId, input.companyId), inArray(contextManifestMemoryRoots.manifestId, ids)));
    for (const manifest of manifests) {
      const manifestItems = items.filter(item => item.manifestId === manifest.id);
      if(await assertNativeAnalyticalResultContextCurrent(db,input.companyId,input.actor,manifest,manifestItems,
        roots.filter(value=>value.manifestId===manifest.id)))continue;
      for (const item of manifestItems) {
        nativeSourceReadWork(scope);
        if (item.sourceProvider === "august_works_tasks") {
          const match = /^issue:\/\/([0-9a-f-]{36})$/i.exec(item.sourceRef);
          if (!match || !item.sourceVersion || !item.payloadSourceSnapshot)
            throw forbidden("A selected Context Task source changed or was erased");
          await assertNativeTaskSnapshotOwnerCurrentInScope(db, input.companyId, input.actor, match[1]!, scope,
            { snapshot: item.payloadSourceSnapshot }, undefined, siblingToolSourceProofs);
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

  const sourceDispatch = dispatchInputs.at(-1);
  for (const source of snapshot.inputs) {
    if (source.kind === "task" || source.kind === "project" || source.kind === "context" ||
      source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch") continue;
    nativeSourceReadWork(scope);
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
        issueId: source.issueId, revisionId: source.revisionId, actor: input.actor, requireLatest: false }, scope, depth + 1, siblingToolSourceProofs);
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
      const transitionEvidence = await nativeMemoryReviewEvidenceFromSourceSet(db, input.companyId, source, snapshot.inputs,
        memoryReviewReceipt ?? nativeInputReceipt, scope);
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
      if (!sourceDispatch || !nativeInputReceipt || source.runId !== sourceDispatch.runId)
        throw forbidden("A Native document task wake source is unavailable");
      await assertNativeTaskWakeSourceCurrentInScope(db, scope, { companyId: input.companyId, issueId: input.issueId,
        runId: sourceDispatch.runId, actor: input.actor, source, inputs: snapshot.inputs, bootstrapInputs: nativeInputReceipt.bootstrap.inputs });
      continue;
    }
    if (source.kind === "comment") {
      const rootTaskInputs = snapshot.inputs.filter((candidate): candidate is Extract<NativePayloadSourceInput, { kind: "task" }> =>
        candidate.kind === "task" && candidate.issueId === source.issueId);
      const selfOwnedConversationTaskId = rootTaskInputs.some(task => scope.conversationRootComments.has(
        nativeSha256({ companyId: input.companyId, task, source }))) ? source.issueId : undefined;
      await assertConversationCommentSourceCurrent(db, { companyId: input.companyId, actor: input.actor, source,
        policy: snapshot.policy, inputs: snapshot.inputs,
        ...(selfOwnedConversationTaskId ? { selfOwnedConversationTaskId } : {}) }, scope);
      continue;
    }
    if (source.kind === "interaction") {
      const [run] = sourceDispatch ? await db.select({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, sourceDispatch.runId))) : [];
      if (!run) throw forbidden("A Native document interaction source is unavailable");
      const [pendingOwner] = await db.select({ status: issueThreadInteractions.status, kind: issueThreadInteractions.kind }).from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.companyId, input.companyId), eq(issueThreadInteractions.issueId, source.issueId),
        eq(issueThreadInteractions.id, source.interactionId))).limit(1);
      if (pendingOwner?.status === "pending") {
        const { captureNativeGovernedPendingInteractions } = await import("./native-runtime/native-interaction-bridge.js");
        const pending = await captureNativeGovernedPendingInteractions({ db: db as Db, companyId: input.companyId,
          issueId: source.issueId, runId: sourceDispatch!.runId, agentId: run.agentId, interactionIds: [source.interactionId] });
        if (pending.length !== 1 || !isDeepStrictEqual(pending[0]!.source, source)) throw forbidden("A pending Native interaction source changed");
        continue;
      }
      const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
      const current: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
      const continuationCurrent: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
      await prepareNativeSourceEffectBoundary(scope);
      await materializeNativeInteractionResponses({ db: db as Db, companyId: input.companyId, issueId: source.issueId,
        runId: sourceDispatch!.runId, agentId: run.agentId, interactionIds: [source.interactionId],
        onSourceCapture: value => { current.push(value); },
        onContinuationSourceCapture: value => { continuationCurrent.push(value.continuationSource); } });
      continuationCurrent.push(...await readNativeQuestionContinuationSource(db, { companyId: input.companyId,
        issueId: source.issueId, runId: sourceDispatch!.runId, agentId: run.agentId, kind: pendingOwner?.kind, source, normal: current }));
      let deliveryCurrent: Extract<NativePayloadSourceInput, { kind: "interaction" }> | undefined;
      if (current.length === 1 && !isDeepStrictEqual(current[0], source) && !continuationCurrent.some(value => isDeepStrictEqual(value, source))) {
        const consumer = await nativeSourceReadRun(db, input.companyId, sourceDispatch!.runId, scope);
        if (consumer?.wakeupRequestId) {
          const { captureNativeToolActionDelivery } = await import("./tool-action-delivery.js");
          const captured = await captureNativeToolActionDelivery({ db: db as Db, companyId: input.companyId, issueId: source.issueId,
            agentId: consumer.agentId, runId: consumer.id, wakeupRequestId: consumer.wakeupRequestId, reader: input.actor });
          deliveryCurrent = captured?.source;
        }
      }
      if (current.length !== 1 || (!isDeepStrictEqual(current[0], source) &&
        (continuationCurrent.length !== 1 || !isDeepStrictEqual(continuationCurrent[0], source)) && !isDeepStrictEqual(deliveryCurrent, source)))
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
      await assertNativeDocumentRuntimeSkillCurrent(db, input.companyId, input.actor, source, sourceDispatch!.runId);
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
      recordNativeMutableSourceRow(scope, "contract", input.companyId, contract);
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
      if (!sourceDispatch) throw forbidden("The Native document workspace source is unavailable");
      await assertNativeWorkspaceMetadataSourcesCurrent(db as Db, input.companyId, [source], scope);
      continue;
    }
    throw forbidden("A Native document source family is unsupported");
  }
  }
  const readerSet = { companyId: input.companyId, runId: dispatchRunId ?? input.revisionId,
    policy: { issueIds: [...new Set([...policy.issueIds, input.issueId, ...taskSourceIds])].sort(),
      projectIds: projectSourceIds, runIds: policy.runIds, memoryIds: memorySourceIds,
      foundationRevisionIds: policy.foundationRevisionIds }, inputs: snapshot.inputs };
  scope.deferredReaderSets.set(completeKey, readerSet);
  deferNativeSourceReaderCheck(scope, { ...readerSet, actor: input.actor });
  documentCompleted = true;
  scope.active.delete(activeKey);
  } finally {
    if (documentProofStack.at(-1) === documentFrame) documentProofStack.pop();
    if (documentCompleted && documentProofEligible) {
      const completedProof = { descendants: documentFrame.descendants, mutableSources: documentFrame.mutableSources,
        policy: snapshot.policy, inputs: snapshot.inputs,
        validatedDepth: Math.max(depth, documentProof?.validatedDepth ?? -1),
        ...(ownDocumentReaders ? { readerObligations: ownDocumentReaders } : {}),
        ...(documentFrame.readerSelection?.complete ? { readerSets: new Map(documentFrame.readerSelection.sets) } : {}) };
      if (siblingToolSourceProofs.size < 512) siblingToolSourceProofs.set(documentProofKey, completedProof);
      if (documentLedger && !scope.context.ancestry.graphProofsDisabled && documentLedger.size < 512)
        documentLedger.set(documentLedgerKey, completedProof);
    }
  }
  } finally {
    scope.active.delete(activeKey);
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
    const contentHash = nativeTemporalContextContentHash(manifest, manifestItems, roots);
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

async function nativePayloadSourceDigest(db: Db | Transaction, snapshot: unknown) {
  const [row] = await db.execute<{ digest: string }>(sql`select encode(sha256(convert_to(${JSON.stringify(snapshot)}::jsonb::text,'UTF8')),'hex') as digest`);
  return row?.digest ?? "";
}
async function nativePayloadSnapshotDigest(db: Db | Transaction, snapshot: Record<string, unknown>) {
  return nativePayloadSourceDigest(db, snapshot);
}

/** Literal Human text contains no copied parent/Project bytes. Only its original
 * capture audit admits the empty byte-input set with these exact privacy edges. */
async function readAuditedManualRelatedOwner(db: Db | Transaction, companyId: string, issueId: string,
  snapshot: NativePayloadSourceSnapshot) {
  const [owner] = await db.select({ parentId: issues.parentId, createdByUserId: issues.createdByUserId, projectId: issues.projectId,
    projectWorkspaceId: issues.projectWorkspaceId,
    createdByAgentId: issues.createdByAgentId, originKind: issues.originKind,
    conversationAgentId: issues.conversationAgentId }).from(issues).where(and(
    eq(issues.companyId, companyId), eq(issues.id, issueId))).for("share");
  if (!owner || !(owner.parentId || owner.projectId) || !owner.createdByUserId || owner.createdByAgentId || owner.originKind !== "manual" ||
      owner.conversationAgentId || snapshot.inputs.length !== 0 || !isDeepStrictEqual(snapshot.policy, {
        issueIds: owner.parentId ? [owner.parentId] : [], projectIds: owner.projectId ? [owner.projectId] : [], runIds: [], memoryIds: [], foundationRevisionIds: [],
      })) return false;
  const transforms = snapshot.transforms ?? [];
  const firstWorkspace=transforms.find(step=>step.kind==="workspace_binding");
  const originalProjectWorkspaceId = firstWorkspace ? firstWorkspace.beforeProjectWorkspaceId : owner.projectWorkspaceId;
  let originalContentHash = snapshot.owner.contentHash;
  let originalDigest = snapshot.digest;
  let priorProjectWorkspaceId = originalProjectWorkspaceId;
  if (transforms.length) {
    originalContentHash = transforms[0]!.previousOwnerContentHash;
    const originalSnapshot = {
      version: 1 as const,
      owner: { ...snapshot.owner, contentHash: originalContentHash },
      policy: snapshot.policy,
      inputs: snapshot.inputs,
    };
    originalDigest = await nativePayloadSnapshotDigest(db, originalSnapshot);
    let prefix: typeof transforms = [];
    let priorContentHash = originalContentHash;
    let priorDigest = originalDigest;
    for (const transform of transforms) {
      if(transform.kind==="native_stage_policy"){
        if(transform.previousOwnerContentHash!==priorContentHash || transform.previousSnapshotDigest!==priorDigest) return null;
        const [task]=await db.select().from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,issueId))).limit(1).for("share");
        if(!task) return null;
        const {readNativeStageTaskBodyStep}=await import("./native-stage-task-body-source.js");
        await readNativeStageTaskBodyStep(db,{task,step:transform});
        prefix=[...prefix,transform];priorContentHash=transform.nextOwnerContentHash;
        priorDigest=await nativePayloadSourceDigest(db,{...originalSnapshot,owner:{...originalSnapshot.owner,contentHash:priorContentHash},transforms:prefix});
        continue;
      }
      if (transform.beforeProjectWorkspaceId !== priorProjectWorkspaceId ||
          transform.previousOwnerContentHash !== priorContentHash ||
          transform.previousSnapshotDigest !== priorDigest) return null;
      const [transition] = await db.select({ id: activityLog.id, actorType: activityLog.actorType,
        actorId: activityLog.actorId, agentId: activityLog.agentId, runId: activityLog.runId,
        details: activityLog.details }).from(activityLog).where(and(
        eq(activityLog.companyId, companyId), eq(activityLog.id, transform.activityId),
        eq(activityLog.action, "issue.payload_source_workspace_bound"),
        eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issueId),
      )).limit(1);
      const details = transition?.details as Record<string, unknown> | null;
      if (!transition || transition.actorType !== "agent" || !transition.agentId ||
          transition.actorId !== transition.agentId || transition.runId !== transform.runId ||
          !details || details.kind !== transform.kind || details.transitionId !== transform.transitionId ||
          details.runId !== transform.runId || details.workspaceId !== transform.workspaceId ||
          details.workspaceTupleHash !== transform.workspaceTupleHash ||
          details.beforeProjectWorkspaceId !== transform.beforeProjectWorkspaceId ||
          details.afterProjectWorkspaceId !== transform.afterProjectWorkspaceId ||
          details.previousSnapshotDigest !== transform.previousSnapshotDigest ||
          details.previousOwnerContentHash !== transform.previousOwnerContentHash ||
          details.nextOwnerContentHash !== transform.nextOwnerContentHash ||
          details.beforePreference !== transform.beforePreference || details.beforeMode !== transform.beforeMode ||
          details.beforeSettingsHash !== transform.beforeSettingsHash ||
          details.afterPreference !== transform.afterPreference || details.afterMode !== transform.afterMode ||
          details.afterSettingsHash !== transform.afterSettingsHash) return null;
      prefix = [...prefix, transform];
      priorProjectWorkspaceId = transform.afterProjectWorkspaceId;
      priorContentHash = transform.nextOwnerContentHash;
      priorDigest = await nativePayloadSourceDigest(db, {
        ...originalSnapshot,
        owner: { ...originalSnapshot.owner, contentHash: priorContentHash },
        transforms: prefix,
      });
    }
    if (snapshot.owner.contentHash !== priorContentHash || snapshot.digest !== priorDigest ||
        owner.projectWorkspaceId !== priorProjectWorkspaceId) return null;
  }
  const [audit] = await db.select({ id: activityLog.id }).from(activityLog).where(and(
    eq(activityLog.companyId, companyId), eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issueId),
    eq(activityLog.action, "issue.payload_source_captured"), eq(activityLog.actorType, "user"),
    eq(activityLog.actorId, owner.createdByUserId),
    sql`${activityLog.details}->>'producer'='direct_manual_related_input'`,
    sql`(${activityLog.details}->>'parentId') is not distinct from ${owner.parentId}::text`,
    sql`(${activityLog.details}->>'projectId') is not distinct from ${owner.projectId}::text`,
    // Older default/implicit captures did not attest an original workspace
    // selector. New capture audits bind the resolved selector explicitly.
    sql`(not (${activityLog.details} ? 'projectWorkspaceId') or
      (${activityLog.details}->>'projectWorkspaceId') is not distinct from ${originalProjectWorkspaceId}::text)`,
    sql`${activityLog.details}->>'digest'=${originalDigest}`,
    sql`${activityLog.details}->>'contentHash'=${originalContentHash}`)).limit(1);
  return audit ? { ...owner, projectWorkspaceId: originalProjectWorkspaceId } : null;
}

/** Original create owner only: revalidate selected privacy dependencies before
 * accepting literal Human text, while retaining each current reader ACL. */
export async function assertManualRelatedSourcesCurrent(db: Db | Transaction, companyId: string,
  actor: AuthorizationActor, related: { parentId: string | null; projectId: string | null; projectWorkspaceId?: string | null }) {
  return inNativeSourceReadTransaction(db, tx => withNativeSourceReadScope(tx, actor, companyId, async scope => {
    await lockNativeSourceReadPrivacy(tx, companyId, scope);
    await assertManualRelatedPrivacyCurrent(tx, companyId, actor, related);
  }));
}

async function assertManualRelatedPrivacyCurrent(db: Db | Transaction, companyId: string,
  actor: AuthorizationActor, related: { parentId: string | null; projectId: string | null; projectWorkspaceId?: string | null }) {
  // Selected IDs constrain the new literal's privacy; they do not say that its
  // bytes consumed parent content, a model prefix, or Project workspace config.
  // Actual byte readers still use their full ordinary source validators.
  if (related.parentId) {
    const [parent] = await db.select({ projectId: issues.projectId,
      invalidated: issues.payloadSourceSnapshotInvalidated }).from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.id, related.parentId))).for("share");
    if (!parent || parent.invalidated || !await canActorReadIssuePrivacy(db, actor, { id: related.parentId, companyId }))
      throw forbidden("The current parent source is unavailable");
    if (related.projectId && parent.projectId && related.projectId !== parent.projectId)
      throw forbidden("The selected parent Project changed");
  }
  if (related.projectId) {
    const [project] = await db.select({ invalidated: projects.payloadSourceSnapshotInvalidated }).from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, related.projectId))).for("share");
    if (!project || project.invalidated || !await canActorReadProjectPrivacy(db, actor, { id: related.projectId, companyId }))
      throw forbidden("The current Project source is unavailable");
  }
  if (related.projectWorkspaceId) {
    if (!related.projectId) throw forbidden("The selected Project workspace source is unavailable");
    // The selector is literal Human input. Lock its actual Project identity;
    // consuming repository bytes/configuration retains separate Source owners.
    const [workspace] = await db.select({ id: projectWorkspaces.id }).from(projectWorkspaces).where(and(
      eq(projectWorkspaces.id, related.projectWorkspaceId), eq(projectWorkspaces.companyId, companyId),
      eq(projectWorkspaces.projectId, related.projectId))).for("share");
    if (!workspace) throw forbidden("The selected Project workspace source is unavailable");
  }
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
