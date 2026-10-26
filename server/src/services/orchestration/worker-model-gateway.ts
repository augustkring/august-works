import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertAuthoredProceduresCurrent } from "../agents/authoring-procedures.js";
import { assertAuthoredAgentManifestCurrent } from "../agents/authored-definition.js";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import {
  agents,
  agentIdentities,
  companies,
  agentExecutionManifests,
  companyMemberships,
  principalPermissionGrants,
  companySecrets,
  companySecretVersions,
  heartbeatRuns,
  heartbeatRunEvents,
  issues,
  orchestrationPlans,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  orchestrationModelReservations,
  costEvents,
  toolInvocations,
  type Db,
} from "@paperclipai/db";
import {
  workerModelBindingSchema,
  conversationModelBindingSchema,
  workerModelCallSchema,
  workerModelResultSchema,
  nativeRunInputSourceReceiptSchema,
  nativePayloadSourceInputSchema,
  nativePayloadSourcePolicySchema,
  type WorkerModelBinding,
  type ConversationModelBinding,
  type WorkerModelCall,
  type NativePayloadSourceInput,
  type NativeRunInputSourceReceipt,
} from "@paperclipai/shared";
import {
  createRuntimeToolsToken,
  verifyRuntimeToolsToken,
  type RuntimeToolsTokenClaims,
} from "../../runtime-tools-token.js";
import { conflict, forbidden } from "../../errors.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { aiConnectionService } from "../ai-connections.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { assertV7Authorization, assertV7Enabled } from "../v7-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { isCurrentConversationModelRoot, isCurrentWorkerConversationRoot } from "../native-runtime/worker-conversation-root.js";
import type { NativeConsumedSourceComponent, NativeModelOutputCapture } from "../native-runtime/native-execution-input.js";
import {
  lockMemoryPrivacy,
  heartbeatMemoryPayloadRetained,
} from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { enqueueSupervisionStop } from "../supervision/supervision-outbox.js";
import { modelReservationService, quoteModelReservation } from "./model-reservations.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";
import { hashContextPolicySnapshot } from "../context/context-manifest.js";
import { assertNativeAnalyticalRunPayloadAccess } from "../analytical-context-authority.js";
import { assertNativeManagedConsumedSourceSetCurrent } from "../native-direct-input.js";
import { assertNativeManagedProjectCreateReceiptCurrent, type NativeProjectCreateReceipt } from "../native-project-output.js";
import {
  anthropicReadOnlyCall,
  anthropicManagedMessagesCall,
  ReadOnlyModelKnownUsageError,
  validateAnthropicManagedMessagesRequest,
  readOnlyModelEnvelopeBytes,
  type ReadOnlyModelWireReceipt,
} from "./read-only-model-transport.js";
import {
  assertWorkerModelProfileCurrent,
  selectWorkerModelProfile,
  type WorkerModelProfile,
} from "./worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { authoringTestRuntime } from "../agents/authoring-test-runtime.js";
import { agentRuntimeCandidateService } from "../agents/authoring-runtime-candidates.js";
import { agentRuntimeCandidateConformanceService } from "../agents/authoring-runtime-candidate-conformance.js";
import { validatePrpEvent, validatePrpStructuredRunResult } from "../../vendor/paperclip-runner/index.js";

type BoundClaims = RuntimeToolsTokenClaims & {
  scope: "worker_model";
  worker_model: WorkerModelBinding;
};
type ConversationClaims = RuntimeToolsTokenClaims & { scope: "conversation_model"; conversation_model: ConversationModelBinding };
type ManagedModelClaims = BoundClaims | ConversationClaims;
type ManagedSourceComponent = NativeConsumedSourceComponent;

function mergeManagedSourceComponents(components: ManagedSourceComponent[], bootstrap: { policy: unknown; inputs: unknown[] }) {
  const ids = { issueIds: new Set<string>(), projectIds: new Set<string>(), runIds: new Set<string>(),
    memoryIds: new Set<string>(), foundationRevisionIds: new Set<string>() };
  const inputs: unknown[] = [];
  for (const component of components) {
    const sourceSet = component.kind === "bootstrap" ? bootstrap : component;
    const policy = managedRecord(sourceSet.policy);
    for (const key of Object.keys(ids) as Array<keyof typeof ids>)
      for (const value of Array.isArray(policy[key]) ? policy[key] as unknown[] : [])
        if (typeof value === "string") ids[key].add(value);
    for (const value of Array.isArray(sourceSet.inputs) ? sourceSet.inputs : [])
      if (!inputs.some(existing => isDeepStrictEqual(existing, value))) inputs.push(value);
  }
  const policy = Object.fromEntries(Object.entries(ids).map(([key, values]) => [key, [...values].sort()])) as Record<string, string[]>;
  return { policy, inputs };
}

/** Resolve one retained assistant message to the exact persisted request prefix
 * that produced it. A matching content hash alone is not enough: the prefix
 * must name the acknowledged Native turn, contain exactly that request's
 * source union, and append this provider response's dispatch marker once. */
export function exactManagedAssistantHistoryPrefix(input: {
  receipt: NativeRunInputSourceReceipt;
  intent: Record<string, unknown>;
  runId: string;
  providerResponseHash: string;
}): NativeRunInputSourceReceipt["dispatches"][number] | null {
  const dispatchDigest = input.intent.sourceDispatchDigest;
  const consumed = managedRecord(input.intent.consumedSourceSet);
  const policy = nativePayloadSourcePolicySchema.safeParse(consumed.policy);
  const sources = nativePayloadSourceInputSchema.array().max(256).safeParse(consumed.inputs);
  const components = input.intent.consumedSourceComponents;
  if (input.receipt.binding.runId !== input.runId || typeof dispatchDigest !== "string" || !/^[0-9a-f]{64}$/.test(dispatchDigest) ||
    typeof input.intent.reservationId !== "string" || typeof input.intent.callId !== "string" ||
    typeof input.intent.requestHash !== "string" || !/^[0-9a-f]{64}$/.test(input.intent.requestHash) ||
    typeof input.intent.wireBodyHash !== "string" || !/^[0-9a-f]{64}$/.test(input.intent.wireBodyHash) ||
    !policy.success || !sources.success || !Array.isArray(components) || components.length < 1 || components.length > 64 ||
    input.intent.consumedSourceSetHash !== nativeSha256({ policy: policy.data, inputs: sources.data })) return null;
  const recomposed = mergeManagedSourceComponents(components as ManagedSourceComponent[], {
    policy: input.receipt.bootstrap.policy, inputs: input.receipt.bootstrap.inputs,
  });
  if (!isDeepStrictEqual(recomposed, { policy: policy.data, inputs: sources.data })) return null;
  const conversationBinding = conversationModelBindingSchema.safeParse(input.intent.conversationModelBinding);
  const markerValue = input.intent.modelPurpose === "conversation_model"
    ? conversationBinding.success ? { kind: "conversation_model_dispatch", runId: input.runId,
      agentId: input.intent.agentId, issueId: conversationBinding.data.issueId,
      conversationSessionGeneration: conversationBinding.data.conversationSessionGeneration,
      executionManifestId: conversationBinding.data.executionManifestId,
      executionManifestHash: conversationBinding.data.executionManifestHash,
      reservationId: input.intent.reservationId, callId: input.intent.callId,
      requestHash: input.intent.requestHash, wireBodyHash: input.intent.wireBodyHash,
      responseHash: input.providerResponseHash } : null
    : input.intent.modelPurpose === undefined || input.intent.modelPurpose === "worker_model"
      ? { kind: "worker_model_dispatch", runId: input.runId, reservationId: input.intent.reservationId,
        callId: input.intent.callId, requestHash: input.intent.requestHash,
        wireBodyHash: input.intent.wireBodyHash, responseHash: input.providerResponseHash } : null;
  const marker = markerValue ? nativePayloadSourceInputSchema.safeParse(markerValue) : null;
  if (!marker?.success || !["worker_model_dispatch", "conversation_model_dispatch"].includes(marker.data.kind)) return null;
  const expectedInputs = nativePayloadSourceInputSchema.array().max(256).safeParse([...sources.data, marker.data]);
  if (!expectedInputs.success) return null;
  const matches = input.receipt.dispatches.filter(dispatch => dispatch.executionInputDigest === dispatchDigest &&
    dispatch.responsibleUserId === input.receipt.binding.responsibleUserId &&
    isDeepStrictEqual(dispatch.policy, policy.data) && isDeepStrictEqual(dispatch.inputs, expectedInputs.data));
  return matches.length === 1 ? matches[0]! : null;
}

/** The OpenCode completion tool returns a fixed server-authored acknowledgement.
 * It is control-plane status, not model-readable workspace data. Admit it only
 * when the exact provider call, acknowledged dispatch, accepted result proposal,
 * and completed tool event are all present in the persisted Native event stream. */
async function assertManagedPaperclipFinishResult(input: {
  db: Db;
  claims: ManagedModelClaims;
  run: typeof heartbeatRuns.$inferSelect;
  profile: Record<string, unknown>;
  providerUse: { toolName: string; argumentsHash: string; intent: Record<string, unknown> };
  callId: string;
  content: string;
  block: Record<string, unknown>;
}): Promise<void> {
  if (input.providerUse.toolName !== "paperclip_finish" || input.block.is_error === true)
    throw forbidden("Managed OpenCode semantic completion result is not the exact server acknowledgement");
  const responseUses = Array.isArray(input.providerUse.intent.responseToolUses)
    ? input.providerUse.intent.responseToolUses.map(managedRecord) : [];
  if (responseUses.length !== 1 || responseUses[0]!.id !== input.callId ||
      managedToolName(String(responseUses[0]!.name ?? "")) !== "paperclip_finish" ||
      responseUses[0]!.argumentsHash !== input.providerUse.argumentsHash)
    throw forbidden("Managed OpenCode semantic completion was not the sole exact provider tool use");

  const dispatchIntents = Array.isArray(input.profile.nativeModelInputDispatchIntents)
    ? input.profile.nativeModelInputDispatchIntents.map(managedRecord).filter(intent =>
        intent.turnInputDigest === input.providerUse.intent.sourceDispatchDigest &&
        intent.responsibleUserId === input.claims.responsible_user_id && intent.continuation === false &&
        typeof intent.dispatchId === "string" && typeof intent.turnId === "string" &&
        Number.isInteger(intent.eventSeq) && Number.isInteger(intent.attempt)) : [];
  if (dispatchIntents.length !== 1)
    throw forbidden("Managed OpenCode semantic completion has no exact acknowledged Native input dispatch");

  const rows = await input.db.select({ eventType: heartbeatRunEvents.eventType, sourceInstanceId: heartbeatRunEvents.sourceInstanceId,
    sourceEventId: heartbeatRunEvents.sourceEventId, sourceSeq: heartbeatRunEvents.sourceSeq,
    sourcePayloadSha256: heartbeatRunEvents.sourcePayloadSha256,
    payload: heartbeatRunEvents.payload }).from(heartbeatRunEvents).where(and(
      eq(heartbeatRunEvents.companyId, input.claims.company_id), eq(heartbeatRunEvents.runId, input.claims.run_id),
      eq(heartbeatRunEvents.sourceInstanceId, input.run.runnerInstanceId!),
      inArray(heartbeatRunEvents.eventType, ["item.started", "run.result.proposed", "item.completed"]))).limit(4096);
  if (rows.length >= 4096) throw forbidden("Managed OpenCode semantic completion event history is ambiguous");
  const events = rows.flatMap(row => {
    const payload = managedRecord(row.payload);
    const event = managedRecord(payload.prpEvent);
    if (!validatePrpEvent(event).ok || event.eventType !== row.eventType || event.runId !== input.claims.run_id ||
        event.sourceInstanceId !== row.sourceInstanceId || event.sourceSeq !== row.sourceSeq ||
        event.normalizedSessionId !== input.run.nativeSessionId || typeof row.sourceEventId !== "string" ||
        row.sourceEventId !== `${input.run.runnerInstanceId}:${input.run.id}:${String(event.sourceSeq)}` ||
        row.sourcePayloadSha256 !== `sha256:${nativeSha256(event)}`) return [];
    return [{ event, payload: managedRecord(event.payload) }];
  });
  const submitted = events.filter(({ event, payload }) => {
    const item = managedRecord(payload.item);
    return event.eventType === "item.started" && event.itemId === input.callId && item.type === "tool_call" &&
      item.id === input.callId && item.name === "paperclip_finish" && nativeSha256(item.arguments) === input.providerUse.argumentsHash;
  });
  if (submitted.length !== 1) throw forbidden("Managed OpenCode semantic completion has no unique persisted provider call");
  const start = submitted[0]!;
  const validation = validatePrpStructuredRunResult(managedRecord(start.payload.item).arguments);
  if (!validation.ok || start.event.turnId !== dispatchIntents[0]!.turnId)
    throw forbidden("Managed OpenCode semantic completion input does not match the acknowledged provider turn");
  const proposals = events.filter(({ event, payload }) => event.eventType === "run.result.proposed" &&
    event.turnId === start.event.turnId && event.itemId === input.callId &&
    validatePrpStructuredRunResult(payload).ok &&
    isDeepStrictEqual(validatePrpStructuredRunResult(payload).result, validation.result));
  const completions = events.filter(({ event, payload }) => {
    const item = managedRecord(payload.item);
    return event.eventType === "item.completed" && event.turnId === start.event.turnId && event.itemId === input.callId &&
      item.type === "tool_result" && item.id === input.callId && item.tool_use_id === input.callId &&
      item.result === "Semantic completion accepted." && payload.kind === "dynamicToolCall";
  });
  const startSeq = start.event.sourceSeq;
  const proposalSeq = proposals[0]?.event.sourceSeq;
  const completionSeq = completions[0]?.event.sourceSeq;
  if (proposals.length !== 1 || completions.length !== 1 ||
      typeof startSeq !== "number" || typeof proposalSeq !== "number" || typeof completionSeq !== "number" ||
      !Number.isInteger(startSeq) || !Number.isInteger(proposalSeq) || !Number.isInteger(completionSeq) ||
      !(startSeq < proposalSeq && proposalSeq < completionSeq))
    throw forbidden("Managed OpenCode semantic completion has no exact server result and acknowledgement events");
  const canonicalResult = { type: "text", text: managedRecord(completions[0]!.payload.item).result };
  if (input.content !== JSON.stringify(canonicalResult) || canonicalResult.text !== "Semantic completion accepted.")
    throw forbidden("Managed OpenCode semantic completion result digest does not match its accepted server result");
}

export type WorkerModelDispatchWireReceipt = ReadOnlyModelWireReceipt & {
  reservationId: string;
  callId: string;
  requestHash: string;
};
type Options = {
  profiles: readonly WorkerModelProfile[];
  sourceSha: string;
  protectedEvidenceOrigin: string;
  fetch?: typeof guardedRemoteHttpFetch;
};

function managedToolName(value: string): string {
  for (const prefix of ["paperclip__", "paperclip_", "paperclip."]) {
    if (value.startsWith(prefix)) {
      const stripped = value.slice(prefix.length);
      return stripped === "self_read_context" ? "read_context" : stripped;
    }
  }
  return value;
}

function managedToolSourceName(value: string): string {
  return value === "self_remember" ? "paperclip-self:remember" : value;
}

function managedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function managedJsonbSha256(db: Db, value: unknown): Promise<string> {
  const [row] = await db.execute<{ digest: string }>(sql`select encode(sha256(convert_to((${JSON.stringify(value)}::jsonb)::text,'UTF8')),'hex') as digest`);
  if (!row || !/^[0-9a-f]{64}$/.test(row.digest)) throw forbidden("Managed OpenCode source receipt digest is unavailable");
  return row.digest;
}

/** Keep database diagnostics finite and content-free at the managed model boundary. */
function managedSqlFailureDetails(error: unknown): Record<string, string> {
  let value: unknown = error;
  for (let depth = 0; depth < 3; depth++) {
    if (!value || typeof value !== "object") break;
    const candidate = value as Record<string, unknown>;
    const code = typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)
      ? candidate.code : undefined;
    const constraint = typeof candidate.constraint_name === "string" && /^[a-zA-Z0-9_]{1,96}$/.test(candidate.constraint_name)
      ? candidate.constraint_name : typeof candidate.constraint === "string" && /^[a-zA-Z0-9_]{1,96}$/.test(candidate.constraint)
        ? candidate.constraint : undefined;
    const table = typeof candidate.table_name === "string" && /^[a-zA-Z0-9_]{1,96}$/.test(candidate.table_name)
      ? candidate.table_name : undefined;
    if (code || constraint || table) return {
      ...(code ? { sqlState: code } : {}),
      ...(constraint ? { constraint } : {}),
      ...(table ? { table } : {}),
    };
    value = candidate.cause;
  }
  return {};
}

async function assertManagedOpenCodeRequestSources(db: Db, claims: ManagedModelClaims, request: Record<string, unknown>): Promise<{
  promptHash: string;
  sourceSetHash: string;
  consumedSourceSet: { policy: Record<string, string[]>; inputs: NativePayloadSourceInput[] };
  consumedSourceComponents: NativeConsumedSourceComponent[];
}> {
  await assertNativeAnalyticalRunPayloadAccess(db, claims.company_id, claims.run_id);
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.id, claims.run_id),
    eq(heartbeatRuns.agentId, claims.sub), eq(heartbeatRuns.status, "running"),
  ));
  const profile = managedRecord(run?.runnerProfileJson);
  const authority = managedRecord(profile.nativeOpenCodeSourceAuthority);
  const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  const schemas = authority.toolSchemas;
  const prompts = authority.authorizedPromptHashes;
  const promptSourceBindings = authority.promptSourceBindings;
  const system = request.system;
  const systemText = typeof system === "string" ? system : Array.isArray(system) && system.every((part) =>
    managedRecord(part).type === "text" && typeof managedRecord(part).text === "string")
    ? (system as Array<{ text: string }>).map((part) => part.text).join("") : null;
  if (!run || authority.version !== 1 || !receipt.success || !Array.isArray(schemas) || !Array.isArray(prompts) ||
    prompts.length === 0 || prompts.length > 64 || prompts.some((value) => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) ||
    !Array.isArray(promptSourceBindings) || promptSourceBindings.length !== prompts.length ||
    promptSourceBindings.some((value) => typeof managedRecord(value).promptHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(managedRecord(value).promptHash as string) || typeof managedRecord(value).sourceSetHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(managedRecord(value).sourceSetHash as string)) ||
    authority.executionInputHash !== nativeSha256(profile.nativeExecutionInput) ||
    !Array.isArray(authority.toolSchemas) || authority.toolSchemasHash !== nativeSha256(schemas) ||
    typeof authority.systemInstructionsHash !== "string" || systemText === null ||
    nativeSha256(systemText) !== authority.systemInstructionsHash ||
    receipt.data.binding.companyId !== claims.company_id || receipt.data.binding.runId !== claims.run_id ||
    receipt.data.binding.agentId !== claims.sub || receipt.data.binding.responsibleUserId !== claims.responsible_user_id ||
    !receipt.data.bootstrap.inputs.some((source) => source.kind === "task") ||
    !receipt.data.bootstrap.inputs.some((source) => source.kind === "completion_contract") ||
    !receipt.data.bootstrap.inputs.some((source) => source.kind === "runtime_instructions") ||
    !receipt.data.bootstrap.inputs.some((source) => source.kind === "workspace_metadata"))
    throw forbidden("Managed OpenCode source closure is missing or no longer current");
  const sourcePolicyHash = nativeSha256(receipt.data.bootstrap);
  const sourceActor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: claims.company_id,
    agentId: claims.sub, runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id };
  const expectedTools = schemas.map((value) => {
    const tool = managedRecord(value);
    return { name: typeof tool.name === "string" ? tool.name : "",
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      input_schema: tool.inputSchema };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const actualTools = (Array.isArray(request.tools) ? request.tools : []).map((value) => {
    const tool = managedRecord(value);
    return { name: typeof tool.name === "string" ? managedToolName(tool.name) : "",
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      input_schema: tool.input_schema };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (!isDeepStrictEqual(actualTools, expectedTools) ||
    actualTools.some((tool) => !["read_document", "write_document", "create_task", "create_project", "self_remember", "read_context", "call_api",
      "get_task_context", "get_task_history", "read_chat_attachment", "query_business_metric", "paperclip_finish", "paperclip_block"].includes(tool.name)))
    throw forbidden("Managed OpenCode tool schemas do not match the exact current Native catalog");

  const intents = Array.isArray(profile.nativeAwModelWireIntents) ? profile.nativeAwModelWireIntents.map(managedRecord) : [];
  const captures = Array.isArray(profile.nativeToolResultSourceCaptures) ? profile.nativeToolResultSourceCaptures.map(managedRecord) : [];
  const associations = Array.isArray(profile.nativeToolCallDispatchAssociations) ? profile.nativeToolCallDispatchAssociations.map(managedRecord) : [];
  let sawAuthorizedUserPrompt = false;
  let currentPromptBinding: { promptHash: string; sourceSetHash: string } | null = null;
  const consumedSourceComponents: ManagedSourceComponent[] = [];
  const priorProviderToolUses = new Map<string, { toolName: string; argumentsHash: string; intent: Record<string, unknown> }>();
  const consumedProviderToolUses = new Set<string>();
  for (const messageValue of Array.isArray(request.messages) ? request.messages : []) {
    const message = managedRecord(messageValue);
    const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] :
      Array.isArray(message.content) ? message.content.map(managedRecord) : [];
    if (message.role === "assistant") {
      const contentHash = nativeSha256(message.content);
      const matchingIntents = intents.filter((intent) => typeof intent.responseContentHash === "string" &&
        intent.sourcePolicyHash === sourcePolicyHash && contentHash === intent.responseContentHash);
      const qualifiedIntents = [] as Array<{ intent: Record<string, unknown>; providerResponseHash: string }>;
      for (const intent of matchingIntents) {
        if (typeof intent.reservationId !== "string") continue;
        const expectedPurpose = claims.scope === "conversation_model" ? "conversation_model" : "worker_model";
        const [reservation] = await db.select().from(orchestrationModelReservations)
          .where(and(eq(orchestrationModelReservations.companyId, claims.company_id),
            eq(orchestrationModelReservations.id, intent.reservationId),
            eq(orchestrationModelReservations.purpose, expectedPurpose),
            eq(orchestrationModelReservations.status, "completed")));
        const conversationBinding = claims.scope === "conversation_model" ? claims.conversation_model : null;
        const exactConversationReservation = !conversationBinding || (reservation?.conversationAgentId === claims.sub &&
          reservation.conversationRunId === claims.run_id && reservation.conversationIssueId === conversationBinding.issueId &&
          reservation.conversationSessionGeneration === conversationBinding.conversationSessionGeneration &&
          reservation.executionManifestId === conversationBinding.executionManifestId &&
          reservation.executionManifestHash === conversationBinding.executionManifestHash);
        if (reservation?.status === "completed" && exactConversationReservation && typeof reservation.providerResponseHash === "string")
          qualifiedIntents.push({ intent, providerResponseHash: reservation.providerResponseHash });
      }
      // The content hash alone is not a dispatch identity: repeated identical
      // provider replies could otherwise make a prior assistant frame ambiguous.
      if (qualifiedIntents.length !== 1)
        throw forbidden("Managed OpenCode assistant history is not an exact persisted provider response");
      const { intent: priorIntent, providerResponseHash } = qualifiedIntents[0]!;
      const toolUses = priorIntent.responseToolUses;
      if (!Array.isArray(toolUses))
        throw forbidden("Managed OpenCode assistant history has an invalid tool-use receipt");
      for (const callValue of toolUses) {
        const call = managedRecord(callValue);
        const id = call.id;
        const toolName = typeof call.name === "string" ? managedToolName(call.name) : "";
        const argumentsHash = call.argumentsHash;
        if (typeof id !== "string" || !/^[\x21-\x7e]{1,200}$/.test(id) || !toolName ||
          typeof argumentsHash !== "string" || !/^[0-9a-f]{64}$/.test(argumentsHash) || priorProviderToolUses.has(id))
          throw forbidden("Managed OpenCode assistant history has an ambiguous tool-use receipt");
        priorProviderToolUses.set(id, { toolName, argumentsHash, intent: priorIntent });
      }
      const exactPrefix = exactManagedAssistantHistoryPrefix({ receipt: receipt.data, intent: priorIntent,
        runId: claims.run_id, providerResponseHash });
      if (!exactPrefix)
        throw forbidden("Managed OpenCode assistant history has no exact dispatch source prefix");
      const prefix = exactPrefix;
      consumedSourceComponents.push({ kind: "dispatch", executionInputDigest: prefix.executionInputDigest,
        policy: prefix.policy, inputs: prefix.inputs });
    } else if (message.role === "user") {
      for (const block of blocks) {
        if (block.type === "text") {
          const promptHash = typeof block.text === "string" ? nativeSha256(block.text) : "";
          const promptBindings = promptSourceBindings.map(managedRecord).filter((binding) => binding.promptHash === promptHash);
          if (typeof block.text !== "string" || !prompts.includes(promptHash) || promptBindings.length !== 1)
            throw forbidden("Managed OpenCode user history is outside the current server-owned prompt receipts");
          const bindingHash = promptBindings[0]!.sourceSetHash;
          if (typeof bindingHash !== "string" || !/^[0-9a-f]{64}$/.test(bindingHash))
            throw forbidden("Managed OpenCode prompt source binding is invalid");
          currentPromptBinding = { promptHash, sourceSetHash: bindingHash };
          const bootstrapSourceSet = { policy: receipt.data.bootstrap.policy, inputs: receipt.data.bootstrap.inputs };
          if (bindingHash === nativeSha256(bootstrapSourceSet)) {
            consumedSourceComponents.push({ kind: "bootstrap" });
          } else {
            const sourceSets = receipt.data.additionalInputs.filter((entry) =>
              nativeSha256({ policy: entry.policy, inputs: entry.inputs }) === bindingHash);
            if (sourceSets.length !== 1) throw forbidden("Managed OpenCode prompt source set is not uniquely in its original receipt");
            const sourceSet = sourceSets[0]!;
            consumedSourceComponents.push({ kind: "additional_input", responsibleUserId: sourceSet.responsibleUserId,
              policy: sourceSet.policy, inputs: sourceSet.inputs });
          }
          sawAuthorizedUserPrompt = true;
          continue;
        }
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string")
          throw forbidden("Managed OpenCode history contains an unsupported user content block");
        const providerUse = priorProviderToolUses.get(block.tool_use_id);
        if (!providerUse || consumedProviderToolUses.has(block.tool_use_id))
          throw forbidden("Managed OpenCode tool result has no preceding provider tool use in this transcript");
        consumedProviderToolUses.add(block.tool_use_id);
        const toolName = providerUse.toolName;
        const nativeDispatches = Array.isArray(profile.nativeModelInputDispatchIntents)
          ? profile.nativeModelInputDispatchIntents.map(managedRecord).filter((item) =>
              item.turnInputDigest === providerUse.intent.sourceDispatchDigest &&
              item.responsibleUserId === claims.responsible_user_id && item.continuation === false &&
              typeof item.turnId === "string" && typeof item.dispatchId === "string") : [];
        const matchingAssociations = nativeDispatches.length === 1 ? associations.filter((item) =>
          item.callId === block.tool_use_id && item.tool === toolName &&
          item.turnId === nativeDispatches[0]!.turnId && item.dispatchId === nativeDispatches[0]!.dispatchId &&
          item.eventSeq === nativeDispatches[0]!.eventSeq && item.attempt === nativeDispatches[0]!.attempt &&
          item.argumentsHash === providerUse.argumentsHash) : [];
        const matchingCaptures = captures.filter((item) => item.managedOpenCode === true && item.callId === block.tool_use_id &&
          item.tool === toolName && typeof item.resultDigest === "string" && matchingAssociations.length === 1 &&
          item.turnId === matchingAssociations[0]!.turnId && item.eventSeq === matchingAssociations[0]!.eventSeq &&
          item.attempt === matchingAssociations[0]!.attempt);
        const content = typeof block.content === "string" ? block.content : Array.isArray(block.content)
          ? block.content.map((part) => typeof managedRecord(part).text === "string" ? managedRecord(part).text : "").join("") : "";
        if (toolName === "paperclip_finish") {
          await assertManagedPaperclipFinishResult({ db, claims, run, profile, providerUse,
            callId: block.tool_use_id, content, block });
          // The provider consumed a server-authored control acknowledgement.
          // The same assistant frame above already contributes its full,
          // acknowledged private-source prefix to the source union.
          continue;
        }
        if (matchingCaptures.length !== 1 || matchingAssociations.length !== 1 ||
          !["read_document", "write_document", "create_task", "create_project", "self_remember", "read_context", "call_api",
            "get_task_context", "get_task_history", "read_chat_attachment", "query_business_metric"].includes(toolName))
        {
          if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1") {
            console.info("managed-native-result-receipt-miss", JSON.stringify({
              toolName,
              nativeDispatchCount: nativeDispatches.length,
              matchingAssociationCount: matchingAssociations.length,
              matchingCaptureCount: matchingCaptures.length,
              sameCallToolCaptureCount: captures.filter(item => item.callId === block.tool_use_id && item.tool === toolName &&
                item.managedOpenCode === true).length,
              sameCallAssociationCount: associations.filter(item => item.callId === block.tool_use_id && item.tool === toolName).length,
              wireIntentCount: intents.length,
              sourceCaptureArrayPresent: Array.isArray(profile.nativeToolResultSourceCaptures),
              associationArrayPresent: Array.isArray(profile.nativeToolCallDispatchAssociations),
              dispatchIntentArrayPresent: Array.isArray(profile.nativeModelInputDispatchIntents),
            }));
          }
          throw forbidden("Managed OpenCode tool result has no original qualified invocation receipt");
        }
        const capture = matchingCaptures[0]!;
        const source = managedRecord(capture.source);
        let result: unknown;
        try { result = JSON.parse(content); } catch { throw forbidden("Managed OpenCode tool result is not its canonical source result"); }
        const contentHash = nativeSha256(result);
        const returnedResultDigest = createHash("sha256").update(JSON.stringify(result), "utf8").digest("hex");
        const invocationId = source.invocationId;
        const sourceResultDigest = toolName === "call_api" ? returnedResultDigest : contentHash;
        if (sourceResultDigest !== capture.resultDigest)
          throw forbidden("managed_opencode_tool_result_capture_digest_mismatch");
        if (source.kind !== "tool_result" || source.contentHash !== sourceResultDigest)
          throw forbidden("managed_opencode_tool_result_source_digest_mismatch");
        const sourceToolName = managedToolSourceName(toolName);
        if (source.callId !== block.tool_use_id || source.toolName !== sourceToolName)
          throw forbidden("managed_opencode_tool_result_identity_mismatch");
        if (toolName === "call_api") {
          const projectSourceResult = nativePayloadSourceInputSchema.safeParse(capture.projectSource);
          const projectReadCaptures = captures.filter((item) => item.managedOpenCode !== true &&
            item.callId === block.tool_use_id && item.turnId === capture.turnId && item.tool === "call_api" &&
            item.eventSeq === capture.eventSeq && item.attempt === capture.attempt &&
            item.operationId === "GET /api/projects/{id}" && item.resultDigest === sourceResultDigest &&
            typeof item.requestHash === "string" && item.source !== null);
          if (!projectSourceResult.success || projectSourceResult.data.kind !== "project" ||
            projectReadCaptures.length !== 1 || source.invocationId !== null || content !== JSON.stringify(result))
            throw forbidden("Managed OpenCode Project API result is not an exact qualified Project read");
          const projectSource = projectSourceResult.data;
          const projectRead = projectReadCaptures[0]!;
          const projectReadSource = nativePayloadSourceInputSchema.safeParse(projectRead.source);
          const resultRecord = managedRecord(result);
          const projectResult = managedRecord(resultRecord.data);
          const apiReceipts = managedRecord(managedRecord(run.resultJson).apiToolReceipts);
          const apiReceipt = managedRecord(apiReceipts[createHash("sha256").update(block.tool_use_id, "utf8").digest("hex")]);
          const association = matchingAssociations[0]!;
          const projectEntries = receipt.data.additionalInputs.filter((entry) =>
            isDeepStrictEqual(entry.inputs, [source, projectSource]) &&
            isDeepStrictEqual(entry.policy, { issueIds: [], projectIds: [projectSource.projectId],
              runIds: [], memoryIds: [], foundationRevisionIds: [] }));
          const exactProjectToolResultCopies = receipt.data.additionalInputs.reduce((count, entry) => count +
            entry.inputs.filter((input) => input.kind === "tool_result" && isDeepStrictEqual(input, source)).length, 0);
          const conflictingProjectToolResults = receipt.data.additionalInputs.some((entry) => entry.inputs.some((input) =>
            input.kind === "tool_result" && input.callId === source.callId && !isDeepStrictEqual(input, source)));
          if (!projectReadSource.success || projectReadSource.data.kind !== "project" ||
            !isDeepStrictEqual(projectReadSource.data, projectSource) ||
            projectRead.projectId !== projectSource.projectId || projectRead.requestHash !== apiReceipt.requestHash ||
            resultRecord.ok !== true || resultRecord.status !== 200 ||
            resultRecord.apiOperationId !== "GET /api/projects/{id}" ||
            projectResult.id !== projectSource.projectId || projectResult.updatedAt !== projectSource.sourceVersion ||
            createHash("sha256").update(JSON.stringify(projectResult), "utf8").digest("hex") !== projectSource.contentHash ||
            apiReceipt.callId !== block.tool_use_id || apiReceipt.turnId !== association.turnId ||
            apiReceipt.eventSeq !== association.eventSeq || apiReceipt.attempt !== association.attempt ||
            apiReceipt.operationId !== "GET /api/projects/{id}" || apiReceipt.method !== "GET" ||
            apiReceipt.pathAndQuery !== `/api/projects/${projectSource.projectId}` ||
            apiReceipt.argumentsHash !== providerUse.argumentsHash || apiReceipt.requestHash !== projectRead.requestHash ||
            apiReceipt.state !== "completed" || apiReceipt.status !== 200 || apiReceipt.resultDigest !== sourceResultDigest ||
            projectEntries.length !== 1 || exactProjectToolResultCopies !== 1 || conflictingProjectToolResults)
            throw forbidden("Managed OpenCode Project API result does not match its exact source receipt");
          const projectSet = projectEntries[0]!;
          consumedSourceComponents.push({ kind: "additional_input", responsibleUserId: projectSet.responsibleUserId,
            policy: projectSet.policy, inputs: projectSet.inputs });
          continue;
        }
        if (toolName === "create_project") {
          const createCapture = managedRecord(capture.projectCreate);
          const createReceipt = managedRecord(createCapture.receipt);
          const outputCapture = managedRecord(createCapture.outputCapture);
          const sourceSetValue = managedRecord(createCapture.sourceSet);
          const projectSourceResult = nativePayloadSourceInputSchema.safeParse(createReceipt.projectSource);
          const workspaceSourcesResult = nativePayloadSourceInputSchema.array().safeParse(createReceipt.workspaceSources);
          const sourcePolicy = nativePayloadSourcePolicySchema.safeParse(sourceSetValue.policy);
          const sourceInputs = nativePayloadSourceInputSchema.array().safeParse(sourceSetValue.inputs);
          const receiptKey = createHash("sha256").update(block.tool_use_id, "utf8").digest("hex");
          const createReceipts = managedRecord(managedRecord(run.resultJson).nativeProjectCreateReceipts);
          const apiReceipt = managedRecord(createReceipts[receiptKey]);
          const projectSource = projectSourceResult.success && projectSourceResult.data.kind === "project"
            ? projectSourceResult.data : null;
          const workspaceSources = workspaceSourcesResult.success && workspaceSourcesResult.data.every(value => value.kind === "project_workspace")
            ? workspaceSourcesResult.data : null;
          const projectDto = managedRecord(result);
          const expectedPolicy = projectSource && sourcePolicy.success ? { ...sourcePolicy.data,
            projectIds: [...new Set([...sourcePolicy.data.projectIds, projectSource.projectId])].sort() } : null;
          const createEntries = expectedPolicy && sourceInputs.success && projectSource && workspaceSources
            ? receipt.data.additionalInputs.filter(entry => entry.responsibleUserId === claims.responsible_user_id &&
                isDeepStrictEqual(entry.policy, expectedPolicy) && isDeepStrictEqual(entry.inputs,
                  [source, ...sourceInputs.data, projectSource, ...workspaceSources])) : [];
          const exactProjectResultCopies = receipt.data.additionalInputs.reduce((count, entry) => count +
            entry.inputs.filter(value => value.kind === "tool_result" && isDeepStrictEqual(value, source)).length, 0);
          const conflictingProjectResults = receipt.data.additionalInputs.some(entry => entry.inputs.some(value =>
            value.kind === "tool_result" && value.callId === source.callId && !isDeepStrictEqual(value, source)));
          const createProjectChecks = {
            managedOpenCode: capture.managedOpenCode === true,
            projectSource: Boolean(projectSource),
            workspaceSources: Boolean(workspaceSources),
            sourcePolicy: sourcePolicy.success,
            sourceInputs: sourceInputs.success,
            toolResultIdentity: source.kind === "tool_result" && source.runId === claims.run_id &&
              source.callId === block.tool_use_id && source.toolName === "create_project" && source.invocationId === null,
            toolResultDigest: source.contentHash === sourceResultDigest,
            receiptIdentity: createReceipt.callId === block.tool_use_id && createReceipt.tool === "create_project" &&
              createReceipt.argumentsHash === providerUse.argumentsHash,
            receiptResultDigest: createReceipt.resultDigest === sourceResultDigest,
            receiptSourceSetHash: sourcePolicy.success && sourceInputs.success && createReceipt.sourceSetHash === nativeSha256({
              policy: sourcePolicy.data, inputs: sourceInputs.data }),
            responsibleHuman: createReceipt.responsibleUserId === claims.responsible_user_id,
            projectIdentity: Boolean(projectSource && createReceipt.projectId === projectSource.projectId &&
              projectDto.id === projectSource.projectId),
            projectPrivate: projectDto.visibility === "private",
            projectSourceVersion: Boolean(projectSource && projectDto.updatedAt === projectSource.sourceVersion),
            projectSourceContentHash: Boolean(projectSource && /^[0-9a-f]{64}$/.test(projectSource.contentHash)),
            snapshotDigest: /^[0-9a-f]{64}$/.test(String(createReceipt.sourceSnapshotDigest ?? "")),
            durableReceiptIdentity: apiReceipt.callId === block.tool_use_id && apiReceipt.tool === "create_project" &&
              apiReceipt.argumentsHash === providerUse.argumentsHash,
            durableReceiptDigest: apiReceipt.resultDigest === sourceResultDigest,
            durableProject: Boolean(projectSource && apiReceipt.projectId === projectSource.projectId),
            durableResponsibleHuman: apiReceipt.responsibleUserId === claims.responsible_user_id,
            durableSourceSetHash: apiReceipt.sourceSetHash === createReceipt.sourceSetHash,
            durableProjectSource: Boolean(projectSource && isDeepStrictEqual(apiReceipt.projectSource, projectSource)),
            durableWorkspaceSources: Boolean(workspaceSources && isDeepStrictEqual(apiReceipt.workspaceSources, workspaceSources)),
            durableSnapshotDigest: apiReceipt.sourceSnapshotDigest === createReceipt.sourceSnapshotDigest,
            exactReceiptPrefix: createEntries.length === 1,
            singleResultCopy: exactProjectResultCopies === 1,
            noConflictingResult: !conflictingProjectResults,
            exactProviderVisibleJson: content === JSON.stringify(result),
          };
          const failedCreateChecks = Object.entries(createProjectChecks).filter(([, passed]) => !passed).map(([name]) => name);
          if (failedCreateChecks.length) {
            if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1")
              console.error("managed-native-create-project-result-checks", JSON.stringify(failedCreateChecks));
            throw forbidden("Managed OpenCode create_project result is not an exact private Project source receipt");
          }
          if (!sourcePolicy.success || !sourceInputs.success)
            throw forbidden("Managed OpenCode create_project source set is malformed");
          await assertNativeManagedProjectCreateReceiptCurrent(db, { companyId: claims.company_id,
            issueId: run.nativeIssueId!, runId: claims.run_id, actor: sourceActor,
            receipt: createReceipt as unknown as NativeProjectCreateReceipt,
            sourceSet: { policy: sourcePolicy.data, inputs: sourceInputs.data },
            outputCapture: outputCapture as unknown as NativeModelOutputCapture, result });
          const createEntry = createEntries[0]!;
          consumedSourceComponents.push({ kind: "additional_input", responsibleUserId: createEntry.responsibleUserId,
            policy: createEntry.policy, inputs: createEntry.inputs });
          continue;
        }
        if (["get_task_context", "get_task_history", "read_chat_attachment", "query_business_metric"].includes(toolName)) {
          const sourceSetValue = managedRecord(capture.sourceSet);
          const sourcePolicy = nativePayloadSourcePolicySchema.safeParse(sourceSetValue.policy);
          const sourceInputs = nativePayloadSourceInputSchema.array().safeParse(sourceSetValue.inputs);
          const capturedInputs = nativePayloadSourceInputSchema.array().safeParse(capture.sourceInputs);
          const readToolResult = source.kind === "tool_result" && source.runId === claims.run_id &&
            source.callId === block.tool_use_id && source.toolName === toolName && source.invocationId === null &&
            source.contentHash === sourceResultDigest;
          const readEntries = receipt.data.additionalInputs.filter(entry => entry.responsibleUserId === claims.responsible_user_id &&
            sourcePolicy.success && sourceInputs.success && isDeepStrictEqual(entry.policy, sourcePolicy.data) &&
            isDeepStrictEqual(entry.inputs, [source, ...sourceInputs.data]));
          const exactReadCopies = receipt.data.additionalInputs.reduce((count, entry) => count +
            entry.inputs.filter(value => value.kind === "tool_result" && isDeepStrictEqual(value, source)).length, 0);
          const conflictingReadCopies = receipt.data.additionalInputs.some(entry => entry.inputs.some(value =>
            value.kind === "tool_result" && value.callId === source.callId && !isDeepStrictEqual(value, source)));
          if (capture.nativeReadResult !== true || !readToolResult || !sourcePolicy.success || !sourceInputs.success ||
            !capturedInputs.success || !isDeepStrictEqual(capturedInputs.data, sourceInputs.data) ||
            capture.argumentsHash !== providerUse.argumentsHash ||
            content !== JSON.stringify(result) || readEntries.length !== 1 || exactReadCopies !== 1 || conflictingReadCopies)
            throw forbidden("Managed OpenCode Native read result is not an exact source receipt");
          const readEntry = readEntries[0]!;
          consumedSourceComponents.push({ kind: "additional_input", responsibleUserId: readEntry.responsibleUserId,
            policy: readEntry.policy, inputs: readEntry.inputs });
          continue;
        }
        if (toolName === "create_task" && source.invocationId === null) {
          const taskRef = managedRecord(capture.taskRef);
          const taskId = taskRef.issueId;
          const taskSource = receipt.data.additionalInputs.flatMap(entry => entry.inputs).find((value): value is Extract<NativePayloadSourceInput, { kind: "task" }> =>
            value.kind === "task" && value.issueId === taskId);
          const expectedTaskPolicy = typeof taskId === "string" ? { issueIds: [taskId], projectIds: [], runIds: [],
            memoryIds: [], foundationRevisionIds: [] } : null;
          const taskEntries = expectedTaskPolicy && taskSource ? receipt.data.additionalInputs.filter(entry =>
            entry.responsibleUserId === claims.responsible_user_id && isDeepStrictEqual(entry.policy, expectedTaskPolicy) &&
            isDeepStrictEqual(entry.inputs, [source, taskSource])) : [];
          const exactTaskResultCopies = receipt.data.additionalInputs.reduce((count, entry) => count + entry.inputs.filter(value =>
            value.kind === "tool_result" && isDeepStrictEqual(value, source)).length, 0);
          const conflictingTaskResults = receipt.data.additionalInputs.some(entry => entry.inputs.some(value =>
            value.kind === "tool_result" && value.callId === source.callId && !isDeepStrictEqual(value, source)));
          const [task] = typeof taskId === "string" ? await db.select({ id: issues.id, companyId: issues.companyId,
            identifier: issues.identifier, title: issues.title, description: issues.description, status: issues.status,
            priority: issues.priority, projectId: issues.projectId, parentId: issues.parentId,
            assigneeAgentId: issues.assigneeAgentId, responsibleUserId: issues.responsibleUserId,
            createdByAgentId: issues.createdByAgentId,
            sourceVersion: sql<string>`extract(epoch from ${issues.updatedAt})::text`,
            contentHash: sql<string>`public.aw_native_payload_body_hash('issue',to_jsonb(${issues}))`,
            hiddenAt: issues.hiddenAt, payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion,
            payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
          }).from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, taskId))).for("share") : [];
          const [conversationRoot] = task?.parentId === null && run.nativeIssueId
            ? await db.select({ conversationAgentId: issues.conversationAgentId,
              conversationUserId: issues.conversationUserId, conversationState: issues.conversationState,
              conversationSessionGeneration: issues.conversationSessionGeneration,
              conversationRetiredAt: issues.conversationRetiredAt, parentId: issues.parentId,
              assigneeAgentId: issues.assigneeAgentId, executionRunId: issues.executionRunId,
              payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion,
              payloadSourceSnapshot: issues.payloadSourceSnapshot,
              payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
            }).from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, run.nativeIssueId))).for("share") : [];
          const conversationModelRootCurrent = claims.scope === "conversation_model" && !!run.nativeIssueId &&
            claims.conversation_model.issueId === run.nativeIssueId && isCurrentConversationModelRoot({
              root: conversationRoot, contextSnapshot: run.contextSnapshot, companyId: claims.company_id,
              agentId: claims.sub, responsibleUserId: claims.responsible_user_id, runId: claims.run_id,
              binding: claims.conversation_model,
            });
          const taskResultChecks = {
            managedCapture: capture.managedOpenCode === true && capture.nativeReadResult !== true && capture.tool === "create_task",
            callAndArgs: capture.callId === block.tool_use_id && capture.argumentsHash === providerUse.argumentsHash,
            resultAndTurn: capture.resultDigest === sourceResultDigest && content === JSON.stringify(result) &&
              capture.turnId === matchingAssociations[0]!.turnId && capture.eventSeq === matchingAssociations[0]!.eventSeq &&
              capture.attempt === matchingAssociations[0]!.attempt,
            sourceIdentity: source.runId === claims.run_id && source.toolName === "create_task" &&
              source.callId === block.tool_use_id && source.invocationId === null && source.contentHash === sourceResultDigest,
            taskRefAndSource: typeof taskId === "string" && Boolean(task && taskSource) &&
              taskSource?.sourceVersion === task?.sourceVersion && taskSource?.contentHash === task?.contentHash,
            taskOwner: task?.parentId === null && task.hiddenAt === null && task.payloadSourceProtocolVersion === 1 &&
              task.payloadSourceSnapshotInvalidated === false && task.createdByAgentId === claims.sub &&
              task.responsibleUserId === claims.responsible_user_id,
            exactReceipt: taskEntries.length === 1 && exactTaskResultCopies === 1 && !conflictingTaskResults,
            currentConversationRoot: conversationModelRootCurrent,
          };
          const failedTaskResultChecks = Object.entries(taskResultChecks).filter(([, valid]) => !valid).map(([name]) => name);
          if (failedTaskResultChecks.length) {
            if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1")
              console.error("managed-native-conversation-task-result-checks", JSON.stringify(failedTaskResultChecks));
            throw forbidden("Managed OpenCode conversation Task result is not an exact current source receipt");
          }
          if (!task) throw forbidden("Managed OpenCode conversation Task source is unavailable");
          consumedSourceComponents.push({ kind: "additional_input", responsibleUserId: taskEntries[0]!.responsibleUserId,
            policy: taskEntries[0]!.policy, inputs: taskEntries[0]!.inputs });
          await assertV7Authorization(db, {
            type: "agent", source: "agent_jwt", companyId: claims.company_id, agentId: claims.sub,
            runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id,
          }, claims.company_id, "issue:read", { type: "issue", companyId: claims.company_id,
            issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId,
            assigneeAgentId: task.assigneeAgentId, assigneeUserId: null, status: task.status });
          continue;
        }
        if (typeof invocationId !== "string")
          throw forbidden("managed_opencode_tool_result_invocation_missing");
        const [invocation] = await db.select().from(toolInvocations).where(and(
          eq(toolInvocations.companyId, claims.company_id), eq(toolInvocations.id, invocationId),
          eq(toolInvocations.runId, claims.run_id), eq(toolInvocations.agentId, claims.sub),
          eq(toolInvocations.toolName, sourceToolName), eq(toolInvocations.status, "succeeded"),
          eq(toolInvocations.resultHash, contentHash),
        ));
        if (!invocation) throw forbidden("Managed OpenCode source tool invocation is no longer current");
        const consumedEntries = receipt.data.additionalInputs.filter(entry => entry.inputs[0]?.kind === "tool_result" &&
          isDeepStrictEqual(entry.inputs[0], source));
        const exactCopies = receipt.data.additionalInputs.reduce((count, entry) => count + entry.inputs.filter(value =>
          value.kind === "tool_result" && isDeepStrictEqual(value, source)).length, 0);
        const conflictingCopies = receipt.data.additionalInputs.some(entry => entry.inputs.some(value =>
          value.kind === "tool_result" && value.callId === source.callId && !isDeepStrictEqual(value, source)));
        if (consumedEntries.length !== 1 || exactCopies < 1 || conflictingCopies ||
          consumedEntries[0]!.inputs.filter(value => value.kind === "tool_result" && isDeepStrictEqual(value, source)).length !== 1)
          throw forbidden("Managed OpenCode tool result source entry is ambiguous");
        const consumedEntry = consumedEntries[0]!;
        consumedSourceComponents.push({ kind: "additional_input", responsibleUserId: consumedEntry.responsibleUserId,
          policy: consumedEntry.policy, inputs: consumedEntry.inputs });
        if (toolName === "create_task") {
          const taskRef = managedRecord(capture.taskRef);
          const taskId = taskRef.issueId;
          const taskSource = receipt.data.additionalInputs.flatMap((entry) => entry.inputs).find((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
            source.kind === "task" && source.issueId === taskId);
          const [task] = typeof taskId === "string" ? await db.select({ id: issues.id, companyId: issues.companyId,
            identifier: issues.identifier, title: issues.title, status: issues.status, priority: issues.priority,
            projectId: issues.projectId, parentId: issues.parentId, assigneeAgentId: issues.assigneeAgentId,
            contentHash: sql<string>`public.aw_native_payload_body_hash('issue',to_jsonb(${issues}))`, hiddenAt: issues.hiddenAt,
            payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
          }).from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, taskId))) : [];
          const [conversationRoot] = task?.parentId === null && run.nativeIssueId
            ? await db.select({ conversationAgentId: issues.conversationAgentId,
              conversationUserId: issues.conversationUserId, conversationState: issues.conversationState,
              conversationSessionGeneration: issues.conversationSessionGeneration,
              conversationRetiredAt: issues.conversationRetiredAt, parentId: issues.parentId,
              assigneeAgentId: issues.assigneeAgentId, executionRunId: issues.executionRunId,
              payloadSourceProtocolVersion: issues.payloadSourceProtocolVersion,
              payloadSourceSnapshot: issues.payloadSourceSnapshot,
              payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
            }).from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, run.nativeIssueId))) : [];
          const workerConversationRootCurrent = !!run.nativeIssueId && claims.scope === "worker_model" && isCurrentWorkerConversationRoot({
            scope: claims.scope, root: conversationRoot, contextSnapshot: run.contextSnapshot,
            companyId: claims.company_id, issueId: run.nativeIssueId, agentId: claims.sub,
            responsibleUserId: run.responsibleUserId, runId: claims.run_id,
          });
          const conversationModelRootCurrent = !!run.nativeIssueId && claims.scope === "conversation_model" &&
            claims.conversation_model.issueId === run.nativeIssueId && isCurrentConversationModelRoot({
              root: conversationRoot, contextSnapshot: run.contextSnapshot, companyId: claims.company_id,
              agentId: claims.sub, responsibleUserId: run.responsibleUserId, runId: claims.run_id,
              binding: claims.conversation_model,
            });
          const taskParentCurrent = task?.parentId === run.nativeIssueId || task?.parentId === null &&
            (workerConversationRootCurrent || conversationModelRootCurrent);
          if (!task || !taskSource || taskSource.contentHash !== task.contentHash ||
            task.payloadSourceSnapshotInvalidated || !taskParentCurrent)
            throw forbidden("Managed OpenCode created Task source is no longer current");
          await assertV7Authorization(db, {
            type: "agent", source: "agent_jwt", companyId: claims.company_id, agentId: claims.sub,
            runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id,
          }, claims.company_id, "issue:read", { type: "issue", companyId: claims.company_id,
            issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId,
            assigneeAgentId: task.assigneeAgentId, assigneeUserId: null, status: task.status });
        } else if (toolName === "read_context") {
          const contextCapture = managedRecord(capture.contextRead);
          const sourceSet = managedRecord(contextCapture.sourceSet);
          const policy = sourceSet.policy;
          const sources = Array.isArray(sourceSet.inputs) ? sourceSet.inputs : [];
          const manifestIds = contextCapture.manifestIds;
          const contextSources = sources.filter((value) => managedRecord(value).kind === "context");
          if (capture.managedOpenCode !== true || contextCapture.contentDigest !== contentHash ||
            !nativePayloadSourcePolicySchema.safeParse(policy).success || !nativePayloadSourceInputSchema.array().safeParse(sources).success ||
            contextSources.length !== 1 || !Array.isArray(manifestIds) ||
            !isDeepStrictEqual(consumedEntry.policy, policy) ||
            !isDeepStrictEqual(consumedEntry.inputs, [source, ...sources]) ||
            source.toolName !== "read_context")
            throw forbidden("Managed OpenCode Context tool result capture is incomplete");
        } else if (toolName === "self_remember") {
          const memorySources = consumedEntry.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "memory" }> =>
            value.kind === "memory");
          const rememberResults = consumedEntry.inputs.filter((value): value is Extract<NativePayloadSourceInput, { kind: "tool_result" }> =>
            value.kind === "tool_result" && value.toolName === "paperclip-self:remember");
          if (memorySources.length !== 1 || !consumedEntry.policy.memoryIds.includes(memorySources[0]!.memoryId))
            throw forbidden("Managed OpenCode Memory result source is incomplete");
          if (rememberResults.length !== 1) throw forbidden("Managed OpenCode Memory result source is incomplete");
        } else {
          let documentRef: Record<string, unknown>;
          if (toolName === "read_document") {
            const priorRead = captures.find((item) => item.managedOpenCode !== true && item.callId === block.tool_use_id && item.tool === "read_document");
            const readSource = managedRecord(priorRead?.source);
            const inputSource = managedRecord(readSource.input);
            if (inputSource.kind !== "document_revision" || inputSource.issueId !== run.nativeIssueId ||
              readSource.returnedResultDigest !== returnedResultDigest) throw forbidden("Managed OpenCode document source capture is incomplete");
            documentRef = { issueId: inputSource.issueId, documentId: inputSource.documentId, revisionId: inputSource.revisionId };
          } else {
            const ref = managedRecord(capture.documentRevision);
            if (ref.issueId !== run.nativeIssueId || typeof ref.documentId !== "string" || typeof ref.revisionId !== "string")
              throw forbidden("Managed OpenCode document write source capture is incomplete");
            documentRef = ref;
          }
        }
      }
    } else {
      // The Messages request validator closes roles to user/assistant. Keep
      // this owner check fail-closed if another caller ever bypasses it.
      throw forbidden("Managed OpenCode history contains an unsupported message role");
    }
  }
  if (!sawAuthorizedUserPrompt) throw forbidden("Managed OpenCode request is missing its server-owned task input");
  if (!currentPromptBinding) throw forbidden("Managed OpenCode request is missing its current Native prompt binding");
  if (priorProviderToolUses.size !== consumedProviderToolUses.size)
    throw forbidden("Managed OpenCode history contains an unresolved prior provider tool use");
  const consumedSourceSet = mergeManagedSourceComponents(consumedSourceComponents, {
    policy: receipt.data.bootstrap.policy, inputs: receipt.data.bootstrap.inputs,
  });
  const parsedPolicy = nativePayloadSourcePolicySchema.safeParse(consumedSourceSet.policy);
  const parsedInputs = nativePayloadSourceInputSchema.array().max(256).safeParse(consumedSourceSet.inputs);
  if (!parsedPolicy.success || !parsedInputs.success ||
    Buffer.byteLength(JSON.stringify(consumedSourceComponents), "utf8") > 512 * 1024)
    throw forbidden("Managed OpenCode consumed source set exceeds its bound");
  await assertNativeManagedConsumedSourceSetCurrent(db, { companyId: claims.company_id, issueId: run.nativeIssueId!,
    runId: claims.run_id, actor: sourceActor, components: consumedSourceComponents,
    sourceSet: { policy: parsedPolicy.data, inputs: parsedInputs.data } });
  return { ...currentPromptBinding,
    consumedSourceSet: { policy: parsedPolicy.data, inputs: parsedInputs.data },
    consumedSourceComponents,
  };
}

/** A Native worker's single inference boundary. It never supplies a provider
 * key, session URL or tariff to the worker. Unsupported managed/CLI transports
 * remain closed at orchestration admission: exposing this consumer does not
 * qualify their undisclosed model calls or their physical sandbox. */
export function workerModelGateway(db: Db, options: Options) {
  function profile(companyId: string, agentId: string, profileId?: string, configurationHash?: string) {
    return selectWorkerModelProfile(options.profiles, { companyId, agentId, profileId, configurationHash,
      sourceSha: options.sourceSha, protectedEvidenceOrigin: options.protectedEvidenceOrigin });
  }
  async function current(tx: Db, claims: BoundClaims) {
    const now = new Date(),
      b = claims.worker_model;
    if (claims.scope !== "worker_model" || claims.exp * 1000 <= now.getTime())
      throw forbidden("Current run-scoped worker model capability required");
    await assertV7Enabled(tx, "orchestration_v7");
    const actor: AuthorizationActor = {
      type: "board",
      source: "session",
      userId: claims.responsible_user_id,
    };
    await assertV7Authorization(
      tx,
      actor,
      claims.company_id,
      "company_scope:read",
    );
    const [plan] = await tx
      .select()
      .from(orchestrationPlans)
      .where(
        and(
          eq(orchestrationPlans.companyId, claims.company_id),
          eq(orchestrationPlans.id, b.planId),
        ),
      );
    const [worker] = await tx
      .select()
      .from(orchestrationWorkers)
      .where(
        and(
          eq(orchestrationWorkers.companyId, claims.company_id),
          eq(orchestrationWorkers.id, b.workerId),
          eq(orchestrationWorkers.planId, b.planId),
        ),
      );
    const [attempt] = await tx
      .select()
      .from(orchestrationWorkerAttempts)
      .where(
        and(
          eq(orchestrationWorkerAttempts.companyId, claims.company_id),
          eq(orchestrationWorkerAttempts.id, b.workerAttemptId),
          eq(orchestrationWorkerAttempts.planId, b.planId),
          eq(orchestrationWorkerAttempts.workerId, b.workerId),
        ),
      );
    const [run] = await tx
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, claims.company_id),
          eq(heartbeatRuns.agentId, claims.sub),
          eq(heartbeatRuns.id, claims.run_id),
        ),
      );
    const [manifest] = await tx
      .select()
      .from(agentExecutionManifests)
      .where(
        and(
          eq(agentExecutionManifests.companyId, claims.company_id),
          eq(agentExecutionManifests.id, b.executionManifestId),
          eq(agentExecutionManifests.agentId, claims.sub),
          eq(agentExecutionManifests.runId, claims.run_id),
        ),
      );
    const currentFacts = {
      planPresent: !!plan,
      planNotErased: !!plan && !plan.erasedAt,
      planRunning: plan?.status === "running",
      planStarted: !!plan?.startedAt,
      planVersionMatches: plan?.version === b.expectedPlanVersion,
      planHumanMatches: plan?.executionPrincipal?.type === "user" &&
        plan.executionPrincipal.userId === claims.responsible_user_id,
      planCostBudgetConfigured: plan?.budgets.maxModelCostMinor !== null && plan?.budgets.maxModelCostMinor !== undefined,
      planActionAllowed: plan?.actionClass === "internal_draft",
      planRiskAllowed: !!plan && ["C0", "C1"].includes(plan.riskClass),
      planDeadlineCurrent: !!plan?.startedAt &&
        now.getTime() < plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000,
      workerRunning: worker?.status === "running",
      workerAgentMatches: worker?.agentId === claims.sub,
      attemptRunning: attempt?.status === "running",
      attemptAgentMatches: attempt?.agentId === claims.sub,
      attemptRunMatches: attempt?.runId === claims.run_id,
      attemptManifestMatches: attempt?.executionManifestId === b.executionManifestId,
      runRunning: run?.status === "running",
      runNative: run?.runtimeMode === "native",
      runTaskMatches: !!worker && run?.nativeIssueId === worker.issueId,
      runHumanMatches: run?.responsibleUserId === claims.responsible_user_id,
      manifestHumanMatches: manifest?.manifest.responsibleUserId === claims.responsible_user_id,
      manifestScopesCompanyScoped: !!manifest &&
        manifest.manifest.executionScope.delegatedScopes.every(s => s.companyId === claims.company_id),
    };
    if (Object.values(currentFacts).some(valid => !valid)) {
      if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1")
        console.info("managed-worker-current-predicate-miss", JSON.stringify(currentFacts));
      throw forbidden(
        "Current Native human, internal draft Task, worker attempt and manifest required",
      );
    }
    const [task] = await tx
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, claims.company_id),
          eq(issues.id, worker.issueId),
        ),
      );
    const [root] = await tx
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, claims.company_id),
          eq(issues.id, plan.issueId),
        ),
      );
    const [agent] = await tx
      .select()
      .from(agents)
      .where(
        and(eq(agents.companyId, claims.company_id), eq(agents.id, claims.sub)),
      );
    if (!agent) throw forbidden("The original Native draft Agent is required");
    const selected = agent.adapterType === "paperclip_runner" ? resolvePaperclipRunnerProviderProfile(agent.adapterConfig) : null;
    // Earlier admitted Native workers have a configuration pin instead of an
    // aw_text_only selector. Match that exact pin; an alternative never becomes
    // an implicit default. Existing runtime/manifest guards remain authoritative.
    const p = profile(claims.company_id, claims.sub, selected?.provider === "aw_text_only" ? selected.workerModelProfileId : undefined,
      hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig }));
    if (
      (selected?.provider === "aw_text_only" && p.transport !== "server-text-only-v1") ||
      (p.transport === "server-anthropic-messages-v1" && selected?.provider !== "opencode") ||
      (selected?.provider === "opencode" && p.transport !== "server-anthropic-messages-v1") ||
      (selected?.provider === "opencode" && selected.model !== `anthropic/${p.tariff.model}`)
    ) throw forbidden("The selected managed model transport does not match its exact qualification");
    if (selected?.provider === "aw_text_only" && (selected.model !== p.tariff.model || selected.maxOutputTokens > p.maxOutputTokens))
      throw forbidden("The selected draft model or output ceiling changed");
    const [company] = await tx
      .select({ status: companies.status })
      .from(companies)
      .where(eq(companies.id, claims.company_id));
    const [identity] = agent?.agentIdentityId
      ? await tx
          .select({ status: agentIdentities.status })
          .from(agentIdentities)
          .where(eq(agentIdentities.id, agent.agentIdentityId))
      : [];
    if (
      !task ||
      task.hiddenAt ||
      ["done", "cancelled"].includes(task.status) ||
      task.assigneeAgentId !== claims.sub ||
      task.executionRunId !== claims.run_id ||
      (task.checkoutRunId && task.checkoutRunId !== claims.run_id) ||
      !root ||
      root.hiddenAt ||
      ["done", "cancelled"].includes(root.status) ||
      (plan.mode === "planned_parallel" &&
        (task.parentId !== root.id || task.projectId !== root.projectId)) ||
      task.requestDepth - root.requestDepth > plan.budgets.maxDelegationDepth ||
      !agent ||
      !["idle", "running"].includes(agent.status) ||
      company?.status !== "active" ||
      identity?.status !== "active" ||
      !(await heartbeatMemoryPayloadRetained(
        tx,
        claims.company_id,
        claims.run_id,
      ))
    )
      throw forbidden("Worker execution ownership changed");
    await assertAuthoredAgentManifestCurrent(tx, agent, manifest.manifest.agentDefinitionVersion);
    const procedures = await assertAuthoredProceduresCurrent(tx, agent, claims.responsible_user_id!);
    if (procedures && nativeSha256(manifest.manifest.skills.map(pin => `${pin.skillId}@${pin.versionId}`).sort()) !==
        nativeSha256(procedures.skills.map(pin => `${pin.skillId}@${pin.versionId}`).sort()))
      throw forbidden("The worker inventory does not contain the exact identified procedures");
    if (procedures && nativeSha256(manifest.manifest.playbooks.map(pin => `${pin.playbookId}@${pin.revisionId}`).sort()) !==
        nativeSha256(procedures.playbooks.map(pin => `${pin.playbookId}@${pin.revisionId}`).sort()))
      throw forbidden("The worker inventory does not contain the exact identified Playbooks");
    const taskScope = {
      type: "issue" as const,
      companyId: claims.company_id,
      issueId: task.id,
      projectId: task.projectId,
      parentIssueId: task.parentId,
      assigneeAgentId: task.assigneeAgentId,
      assigneeUserId: task.assigneeUserId,
      status: task.status,
    };
    await assertV7Authorization(
      tx,
      actor,
      claims.company_id,
      "issue:mutate",
      taskScope,
    );
    await assertV7Authorization(tx, actor, claims.company_id, "issue:read", {
      type: "issue",
      companyId: claims.company_id,
      issueId: root.id,
      projectId: root.projectId,
    });
    await assertV7Authorization(
      tx,
      {
        type: "agent",
        source: "agent_jwt",
        companyId: claims.company_id,
        agentId: claims.sub,
        runId: claims.run_id,
        onBehalfOfUserId: claims.responsible_user_id,
      },
      claims.company_id,
      "issue:read",
      taskScope,
    );
    await assertAgentRunWriteAllowed(tx, claims.company_id, {
      agentId: claims.sub,
      runId: claims.run_id,
    });
    const provider = await agentProviderBindingService(tx).assertRuntime(
      claims.company_id,
      claims.sub,
    );
    const providerPin = manifest.manifest.providers.find(
      (pin) =>
        pin.companyId === claims.company_id && pin.agentId === claims.sub,
    );
    if (
      !providerPin ||
      provider.runtime.providerBindingId !== p.providerBindingId ||
      provider.provider.capabilitySnapshotHash !== p.providerSnapshotHash ||
      provider.runtime.conformanceSnapshotHash !== p.providerSnapshotHash ||
      provider.runtime.qualifiedConfigurationHash !==
        p.qualifiedConfigurationHash ||
      provider.runtime.providerProfileRef !== p.providerProfileRef ||
      providerPin.providerBindingId !== p.providerBindingId ||
      providerPin.snapshotHash !== p.providerSnapshotHash ||
      providerPin.profileRef !== p.providerProfileRef
    )
      throw forbidden(
        "Worker provider qualification or immutable manifest pin changed",
      );
    // No existing managed cell is converted to a text-only qualification.
    // Its model boundary must be integrated with physical workload admission.
    if (provider.runtime.providerProfileRef.startsWith("aw:cell:") && p.transport !== "server-anthropic-messages-v1")
      throw forbidden(
        "Managed sandbox text-only calls are not qualified for a physical workload",
      );
    const selection = await aiConnectionService(tx).select({
      companyId: claims.company_id,
      userId: claims.responsible_user_id,
      agentId: claims.sub,
      adapterType: "claude_local",
      binding: p.binding,
      model: p.tariff.model,
    });
    if (selection.attribution.method !== "api_key")
      throw forbidden("Only a current installed API-key grant is supported");
    const ref = selection.grant.credentialSecretRefs.find(
      (r) => r.configPath === "ai.credential",
    );
    const [secret] = ref
      ? await tx
          .select()
          .from(companySecrets)
          .where(
            and(
              eq(companySecrets.companyId, claims.company_id),
              eq(companySecrets.id, ref.secretId),
            ),
          )
      : [];
    const [version] = secret
      ? await tx
          .select()
          .from(companySecretVersions)
          .where(
            and(
              eq(companySecretVersions.secretId, secret.id),
              eq(companySecretVersions.version, secret.latestVersion),
            ),
          )
      : [];
    if (
      !secret ||
      secret.status !== "active" ||
      !version ||
      version.revokedAt ||
      ["disabled", "destroyed"].includes(version.status)
    )
      throw forbidden("Worker provider credential is no longer current");
    const memberships = await tx
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, claims.company_id),
          eq(companyMemberships.principalId, claims.responsible_user_id),
          eq(companyMemberships.principalType, "user"),
        ),
      )
      .orderBy(companyMemberships.id);
    const grants = await tx
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, claims.company_id),
          or(
            and(
              eq(principalPermissionGrants.principalType, "user"),
              eq(
                principalPermissionGrants.principalId,
                claims.responsible_user_id,
              ),
            ),
            and(
              eq(principalPermissionGrants.principalType, "agent"),
              eq(principalPermissionGrants.principalId, claims.sub),
            ),
          ),
        ),
      )
      .orderBy(principalPermissionGrants.id)
      .limit(2001);
    if (grants.length > 2000)
      throw forbidden("Worker authority exceeds the bounded grant envelope");
    const authorityHash = nativeSha256(
      JSON.parse(
        JSON.stringify({
          profile: p,
          binding: b,
          companyId: claims.company_id,
          runId: run.id,
          userId: claims.responsible_user_id,
          manifest: manifest.hash,
          manifestPolicy: manifest.policySnapshotHash,
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            updatedAt: task.updatedAt,
            projectId: task.projectId,
            parentId: task.parentId,
            assigneeAgentId: task.assigneeAgentId,
            assigneeUserId: task.assigneeUserId,
            status: task.status,
            executionRunId: task.executionRunId,
          },
          root: {
            id: root.id,
            title: root.title,
            description: root.description,
            updatedAt: root.updatedAt,
            projectId: root.projectId,
            parentId: root.parentId,
            status: root.status,
          },
          agent: {
            identity: agent.agentIdentityId,
            permissions: agent.permissions,
            adapter: agent.adapterType,
            config: agent.adapterConfig,
            runtime: agent.runtimeConfig,
          },
          provider: {
            id: provider.provider.id,
            snapshot: provider.provider.capabilitySnapshotHash,
            profile: provider.runtime.providerProfileRef,
            configuration: provider.runtime.qualifiedConfigurationHash,
          },
          memberships,
          grants,
          connection: {
            id: selection.connection.id,
            config: selection.connection.config,
            updatedAt: selection.connection.updatedAt,
          },
          grant: {
            id: selection.grant.id,
            updatedAt: selection.grant.updatedAt,
            refs: selection.grant.credentialSecretRefs,
          },
          secret: {
            id: secret.id,
            scope: secret.scope,
            owner: secret.ownerUserId,
            versionId: version.id,
            version: version.version,
            valueSha256: version.valueSha256,
          },
        }),
      ),
    );
    return {
      actor,
      profile: p,
      plan,
      selection,
      authorityHash,
      credentialSha256: version.valueSha256,
    };
  }
  async function currentConversation(tx: Db, claims: ConversationClaims, requireInputReceipt = true) {
    const now = new Date(), binding = claims.conversation_model;
    if (claims.scope !== "conversation_model" || claims.exp * 1000 <= now.getTime())
      throw forbidden("Current Native conversation model capability required");
    await assertV7Enabled(tx, "orchestration_v7");
    const actor: AuthorizationActor = { type: "board", source: "session", userId: claims.responsible_user_id };
    await assertV7Authorization(tx, actor, claims.company_id, "company_scope:read");
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.agentId, claims.sub), eq(heartbeatRuns.id, claims.run_id)));
    const [issue] = await tx.select().from(issues).where(and(
      eq(issues.companyId, claims.company_id), eq(issues.id, binding.issueId)));
    const [manifest] = await tx.select().from(agentExecutionManifests).where(and(
      eq(agentExecutionManifests.companyId, claims.company_id), eq(agentExecutionManifests.id, binding.executionManifestId),
      eq(agentExecutionManifests.agentId, claims.sub), eq(agentExecutionManifests.runId, claims.run_id)));
    if (!run || run.status !== "running" || run.runtimeMode !== "native" || run.scopeKind !== "issue" ||
      run.nativeIssueId !== binding.issueId || run.responsibleUserId !== claims.responsible_user_id ||
      run.contextSnapshot?.conversationSessionGeneration !== binding.conversationSessionGeneration ||
      !issue || issue.conversationAgentId !== claims.sub || issue.conversationUserId !== claims.responsible_user_id ||
      issue.conversationSessionGeneration !== binding.conversationSessionGeneration || issue.conversationState !== "active" ||
      issue.conversationRetiredAt || issue.assigneeAgentId !== claims.sub || issue.executionRunId !== claims.run_id ||
      !["in_review", "in_progress"].includes(issue.status) || !manifest || manifest.hash !== binding.executionManifestHash ||
      manifest.manifest.responsibleUserId !== claims.responsible_user_id ||
      manifest.manifest.executionScope.delegatedScopes.some(scope => scope.companyId !== claims.company_id) ||
      (requireInputReceipt && (run.nativeInputSourceProtocolVersion !== 1 ||
        !nativeRunInputSourceReceiptSchema.safeParse(managedRecord(run.runnerProfileJson).nativeInputSourceReceipt).success)) ||
      !(await heartbeatMemoryPayloadRetained(tx, claims.company_id, claims.run_id)))
      throw forbidden("Current Native conversation Human, generation and manifest are required");
    const issueScope = { type: "issue" as const, companyId: claims.company_id, issueId: issue.id,
      projectId: issue.projectId, parentIssueId: issue.parentId, assigneeAgentId: issue.assigneeAgentId,
      assigneeUserId: issue.assigneeUserId, status: issue.status };
    await assertV7Authorization(tx, actor, claims.company_id, "issue:read", issueScope);
    await assertV7Authorization(tx, { type: "agent", source: "agent_jwt", companyId: claims.company_id,
      agentId: claims.sub, runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id },
    claims.company_id, "issue:read", issueScope);
    await assertAgentRunWriteAllowed(tx, claims.company_id, { agentId: claims.sub, runId: claims.run_id });
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, claims.company_id), eq(agents.id, claims.sub)));
    const [company] = await tx.select({ status: companies.status, budgetMonthlyCents: companies.budgetMonthlyCents })
      .from(companies).where(eq(companies.id, claims.company_id));
    const [identity] = agent?.agentIdentityId
      ? await tx.select({ status: agentIdentities.status }).from(agentIdentities).where(eq(agentIdentities.id, agent.agentIdentityId)) : [];
    if (!agent || agent.adapterType !== "paperclip_runner" || !["idle", "running"].includes(agent.status) ||
      company?.status !== "active" || identity?.status !== "active")
      throw forbidden("The current Native conversation Agent is unavailable");
    const currentTime = new Date(), monthStart = new Date(Date.UTC(currentTime.getUTCFullYear(), currentTime.getUTCMonth(), 1));
    const [companySpend] = await tx.select({ amount: sql<number>`coalesce(sum(${costEvents.costCents}), 0)` })
      .from(costEvents).where(and(eq(costEvents.companyId, claims.company_id), gte(costEvents.occurredAt, monthStart)));
    const [agentSpend] = await tx.select({ amount: sql<number>`coalesce(sum(${costEvents.costCents}), 0)` })
      .from(costEvents).where(and(eq(costEvents.companyId, claims.company_id), eq(costEvents.agentId, claims.sub),
        gte(costEvents.occurredAt, monthStart)));
    const [companyReserved] = await tx.select({ amount: sql<number>`coalesce(sum(${orchestrationModelReservations.maximumMinor}), 0)` })
      .from(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId, claims.company_id),
        eq(orchestrationModelReservations.purpose, "conversation_model"),
        inArray(orchestrationModelReservations.status, ["reserved", "dispatched", "unknown"])));
    const [agentReserved] = await tx.select({ amount: sql<number>`coalesce(sum(${orchestrationModelReservations.maximumMinor}), 0)` })
      .from(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId, claims.company_id),
        eq(orchestrationModelReservations.conversationAgentId, claims.sub), eq(orchestrationModelReservations.purpose, "conversation_model"),
        inArray(orchestrationModelReservations.status, ["reserved", "dispatched", "unknown"])));
    if (company.budgetMonthlyCents <= 0 || agent.budgetMonthlyCents <= 0 ||
      Number(companySpend?.amount ?? 0) + Number(companyReserved?.amount ?? 0) > company.budgetMonthlyCents ||
      Number(agentSpend?.amount ?? 0) + Number(agentReserved?.amount ?? 0) > agent.budgetMonthlyCents)
      throw forbidden("An explicit current company and Native Agent model budget is required");
    const selected = resolvePaperclipRunnerProviderProfile(agent.adapterConfig);
    if (selected?.provider !== "opencode") throw forbidden("Only the exact qualified managed OpenCode profile is supported");
    const p = profile(claims.company_id, claims.sub, undefined,
      hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig }));
    if (p.transport !== "server-anthropic-messages-v1" || selected.model !== `anthropic/${p.tariff.model}`)
      throw forbidden("The selected managed conversation model does not match its qualification");
    await assertAuthoredAgentManifestCurrent(tx, agent, manifest.manifest.agentDefinitionVersion);
    const procedures = await assertAuthoredProceduresCurrent(tx, agent, claims.responsible_user_id);
    if (procedures && nativeSha256(manifest.manifest.skills.map(pin => `${pin.skillId}@${pin.versionId}`).sort()) !==
        nativeSha256(procedures.skills.map(pin => `${pin.skillId}@${pin.versionId}`).sort()))
      throw forbidden("The conversation manifest does not contain the exact identified procedures");
    if (procedures && nativeSha256(manifest.manifest.playbooks.map(pin => `${pin.playbookId}@${pin.revisionId}`).sort()) !==
        nativeSha256(procedures.playbooks.map(pin => `${pin.playbookId}@${pin.revisionId}`).sort()))
      throw forbidden("The conversation manifest does not contain the exact identified Playbooks");
    const provider = await agentProviderBindingService(tx).assertRuntime(claims.company_id, claims.sub);
    const providerPin = manifest.manifest.providers.find(pin => pin.companyId === claims.company_id && pin.agentId === claims.sub);
    if (!providerPin || provider.runtime.providerProfileRef !== p.providerProfileRef ||
      provider.runtime.providerBindingId !== p.providerBindingId || provider.provider.capabilitySnapshotHash !== p.providerSnapshotHash ||
      provider.runtime.conformanceSnapshotHash !== p.providerSnapshotHash ||
      provider.runtime.qualifiedConfigurationHash !== p.qualifiedConfigurationHash ||
      providerPin.providerBindingId !== p.providerBindingId || providerPin.snapshotHash !== p.providerSnapshotHash ||
      providerPin.profileRef !== p.providerProfileRef)
      throw forbidden("Conversation provider qualification or immutable manifest pin changed");
    const selection = await aiConnectionService(tx).select({ companyId: claims.company_id,
      userId: claims.responsible_user_id, agentId: claims.sub, adapterType: "claude_local", binding: p.binding, model: p.tariff.model });
    if (selection.attribution.method !== "api_key") throw forbidden("Only a current installed API-key grant is supported");
    const ref = selection.grant.credentialSecretRefs.find(value => value.configPath === "ai.credential");
    const [secret] = ref ? await tx.select().from(companySecrets).where(and(
      eq(companySecrets.companyId, claims.company_id), eq(companySecrets.id, ref.secretId))) : [];
    const [version] = secret ? await tx.select().from(companySecretVersions).where(and(
      eq(companySecretVersions.secretId, secret.id), eq(companySecretVersions.version, secret.latestVersion))) : [];
    if (!secret || secret.status !== "active" || !version || version.revokedAt || ["disabled", "destroyed"].includes(version.status))
      throw forbidden("Conversation provider credential is no longer current");
    const memberships = await tx.select().from(companyMemberships).where(and(
      eq(companyMemberships.companyId, claims.company_id), eq(companyMemberships.principalId, claims.responsible_user_id),
      eq(companyMemberships.principalType, "user"))).orderBy(companyMemberships.id);
    const grants = await tx.select().from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, claims.company_id), or(
        and(eq(principalPermissionGrants.principalType, "user"), eq(principalPermissionGrants.principalId, claims.responsible_user_id)),
        and(eq(principalPermissionGrants.principalType, "agent"), eq(principalPermissionGrants.principalId, claims.sub)),
      ))).orderBy(principalPermissionGrants.id).limit(2001);
    if (grants.length > 2000) throw forbidden("Conversation authority exceeds the bounded grant envelope");
    const authorityHash = nativeSha256(JSON.parse(JSON.stringify({ profile: p, binding, companyId: claims.company_id,
      companyBudgetMonthlyCents: company.budgetMonthlyCents,
      run: { id: run.id, status: run.status, responsibleUserId: run.responsibleUserId, contextSnapshot: run.contextSnapshot },
      issue: { id: issue.id, updatedAt: issue.updatedAt, conversationAgentId: issue.conversationAgentId,
        conversationUserId: issue.conversationUserId, conversationSessionGeneration: issue.conversationSessionGeneration,
        conversationState: issue.conversationState, conversationRetiredAt: issue.conversationRetiredAt,
        title: issue.title, description: issue.description, status: issue.status, projectId: issue.projectId },
      manifest: manifest.hash, manifestPolicy: manifest.policySnapshotHash,
      agent: { identity: agent.agentIdentityId, permissions: agent.permissions, adapter: agent.adapterType,
        config: agent.adapterConfig, runtime: agent.runtimeConfig, budgetMonthlyCents: agent.budgetMonthlyCents },
      provider: { id: provider.provider.id, snapshot: provider.provider.capabilitySnapshotHash,
        profile: provider.runtime.providerProfileRef, configuration: provider.runtime.qualifiedConfigurationHash },
      memberships, grants, connection: { id: selection.connection.id, config: selection.connection.config,
        updatedAt: selection.connection.updatedAt },
      grant: { id: selection.grant.id, updatedAt: selection.grant.updatedAt, refs: selection.grant.credentialSecretRefs },
      secret: { id: secret.id, scope: secret.scope, owner: secret.ownerUserId, versionId: version.id,
        version: version.version, valueSha256: version.valueSha256 } })));
    return { actor, profile: p, selection, authorityHash, credentialSha256: version.valueSha256, run, issue, manifest };
  }
  async function fence(
    companyId: string,
    planId: string,
    reasonCode = "worker_model_unsettled",
  ) {
    await withV7ActivityTransaction(db, async (tx, publications) => {
      await lockAnalyticalCompany(tx as unknown as Db, companyId);
      await lockMemoryPrivacy(tx, companyId);
      const [plan] = await tx
        .select()
        .from(orchestrationPlans)
        .where(
          and(
            eq(orchestrationPlans.companyId, companyId),
            eq(orchestrationPlans.id, planId),
          ),
        )
        .for("update");
      if (
        !plan ||
        plan.erasedAt ||
        ["completed", "cancelled", "failed"].includes(plan.status)
      )
        return;
      const [paused] = await tx
        .update(orchestrationPlans)
        .set({
          status: "paused",
          version: plan.version + Number(plan.status !== "paused"),
          updatedAt: new Date(),
        })
        .where(eq(orchestrationPlans.id, plan.id))
        .returning();
      const live = await tx
        .select({ id: orchestrationWorkerAttempts.id })
        .from(orchestrationWorkerAttempts)
        .where(
          and(
            eq(orchestrationWorkerAttempts.companyId, companyId),
            eq(orchestrationWorkerAttempts.planId, planId),
            eq(orchestrationWorkerAttempts.status, "running"),
          ),
        );
      const stop = await enqueueSupervisionStop(tx, paused!, {
        actorType: "system",
        actorId: "worker-model-gateway",
        action: "ESCALATE_HUMAN",
        reasonCode,
        rationale:
          "The bounded worker model call requires accountable human resolution",
        attemptIds: live.map((a) => a.id),
      });
      await logActivity(
        tx,
        {
          companyId,
          actorType: "system",
          actorId: "worker-model-gateway",
          action: "orchestration.worker_model_fenced",
          entityType: "orchestration_plan",
          entityId: planId,
          details: { reasonCode, interventionId: stop?.id ?? null },
        },
        publications,
      );
    });
  }
  return {
    runtimeCandidates: agentRuntimeCandidateService(db, options),
    runtimeCandidateConformance: agentRuntimeCandidateConformanceService(db, options),
    qualifyAuthoringTest: authoringTestRuntime(db, options, profile).qualify,
    executeAuthoringTest: authoringTestRuntime(db, options, profile).execute,
    /** Private pre-start qualification. Editable provider configuration is a
     * selector; only the installed operator profile supplies prices/authority. */
    async qualifyDraft(tx: Db, input: { companyId: string; agentId: string; responsibleUserId: string }) {
      await assertV7Enabled(tx, "orchestration_v7");
      await assertV7Authorization(tx, { type: "board", source: "session", userId: input.responsibleUserId }, input.companyId, "company_scope:read");
      const [presence] = await tx.select({ agent: agents, identity: agentIdentities, company: companies }).from(agents)
        .innerJoin(agentIdentities, eq(agentIdentities.id, agents.agentIdentityId))
        .innerJoin(companies, eq(companies.id, agents.companyId))
        .where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)));
      if (!presence || presence.company.status !== "active" || presence.identity.status !== "active" ||
          !["idle", "running"].includes(presence.agent.status) || presence.agent.adapterType !== "paperclip_runner" ||
          presence.agent.runtimeConfig?.aiConnection)
        throw forbidden("Internal drafts require their current native presence");
      await assertAuthoredProceduresCurrent(tx, presence.agent, input.responsibleUserId);
      const selected = resolvePaperclipRunnerProviderProfile(presence.agent.adapterConfig);
      if (selected.provider !== "aw_text_only") throw forbidden("The installed text transport is required");
      const p = profile(input.companyId, input.agentId, selected.workerModelProfileId);
      if (selected.provider !== "aw_text_only" || selected.workerModelProfileId !== p.id ||
          selected.model !== p.tariff.model || selected.maxOutputTokens > p.maxOutputTokens)
        throw forbidden("The draft presence does not select its exact qualified transport");
      const provider = await agentProviderBindingService(tx).assertRuntime(input.companyId, input.agentId);
      if (provider.provider.id !== p.providerBindingId || provider.provider.capabilitySnapshotHash !== p.providerSnapshotHash ||
          provider.runtime.conformanceSnapshotHash !== p.providerSnapshotHash ||
          provider.runtime.qualifiedConfigurationHash !== p.qualifiedConfigurationHash ||
          provider.runtime.providerProfileRef !== p.providerProfileRef || provider.runtime.providerProfileRef.startsWith("aw:cell:"))
        throw forbidden("Draft provider qualification changed or requires physical workload admission");
      const selection = await aiConnectionService(tx).select({ ...input, userId: input.responsibleUserId,
        adapterType: "claude_local", binding: p.binding, model: p.tariff.model });
      const secretRef = selection.grant.credentialSecretRefs.find(ref => ref.configPath === "ai.credential");
      const [credentialVersion] = secretRef ? await tx.select({ secret: companySecrets, version: companySecretVersions }).from(companySecrets)
        .innerJoin(companySecretVersions, and(eq(companySecretVersions.secretId, companySecrets.id), eq(companySecretVersions.version, companySecrets.latestVersion)))
        .where(and(eq(companySecrets.companyId, input.companyId), eq(companySecrets.id, secretRef.secretId))) : [];
      if (selection.attribution.method !== "api_key" || !credentialVersion || credentialVersion.secret.status !== "active" ||
          credentialVersion.version.revokedAt || ["disabled", "destroyed"].includes(credentialVersion.version.status))
        throw forbidden("Draft credential grant is no longer current");
      const quote = quoteModelReservation({ tariff: p.tariff, sourceSha: options.sourceSha,
        inputTokensUpperBound: p.inputTokensUpperBound, maxOutputTokens: selected.maxOutputTokens });
      return { profileId: p.id, model: selected.model, maxOutputTokens: selected.maxOutputTokens,
        maximumEnvelopeBytes: p.maximumEnvelopeBytes, maximumMinor: quote.maximumMinor };
    },
    /** Private controller failure path. Safety fencing does not require the
     * original human still to have access or the capability still to be live. */
    async abandon(claims: RuntimeToolsTokenClaims) {
      const binding = claims.worker_model;
      if (claims.scope !== "worker_model" || !binding)
        throw forbidden("Bound worker model failure receipt required");
      const [attempt] = await db
        .select({ id: orchestrationWorkerAttempts.id })
        .from(orchestrationWorkerAttempts)
        .where(
          and(
            eq(orchestrationWorkerAttempts.companyId, claims.company_id),
            eq(orchestrationWorkerAttempts.planId, binding.planId),
            eq(orchestrationWorkerAttempts.workerId, binding.workerId),
            eq(orchestrationWorkerAttempts.id, binding.workerAttemptId),
            eq(
              orchestrationWorkerAttempts.executionManifestId,
              binding.executionManifestId,
            ),
            eq(orchestrationWorkerAttempts.agentId, claims.sub),
            eq(orchestrationWorkerAttempts.runId, claims.run_id),
          ),
        );
      if (!attempt) throw forbidden("Worker failure receipt binding changed");
      await fence(claims.company_id, binding.planId);
    },
    /** Private controller helper; there is no customer token-issuance route. */
    async issue(input: {
      companyId: string;
      agentId: string;
      runId: string;
      responsibleUserId: string;
      binding: WorkerModelBinding;
    }) {
      const binding = workerModelBindingSchema.parse(input.binding);
      const minted = createRuntimeToolsToken({
        ...input,
        workerModelBinding: binding,
        scope: "worker_model",
      });
      const claims =
        minted && verifyRuntimeToolsToken(minted.token, "worker_model");
      if (!claims?.worker_model)
        throw forbidden("Worker capability signing is unavailable");
      const state = await current(db, claims as BoundClaims);
      return { ...minted!, inputTokensUpperBound: state.profile.inputTokensUpperBound,
        maxOutputTokens: state.profile.maxOutputTokens };
    },
    /** Host-side admission helper. Derive the immutable worker binding from
     * the live attempt; callers cannot submit plan, attempt or manifest IDs. */
    async issueForRun(input: {
      companyId: string;
      agentId: string;
      runId: string;
      responsibleUserId: string;
    }) {
      const matches = await db.select({ attempt: orchestrationWorkerAttempts, worker: orchestrationWorkers, plan: orchestrationPlans })
        .from(orchestrationWorkerAttempts)
        .innerJoin(orchestrationWorkers, and(
          eq(orchestrationWorkers.companyId, orchestrationWorkerAttempts.companyId),
          eq(orchestrationWorkers.id, orchestrationWorkerAttempts.workerId),
        ))
        .innerJoin(orchestrationPlans, and(
          eq(orchestrationPlans.companyId, orchestrationWorkerAttempts.companyId),
          eq(orchestrationPlans.id, orchestrationWorkerAttempts.planId),
        ))
        .where(and(
          eq(orchestrationWorkerAttempts.companyId, input.companyId),
          eq(orchestrationWorkerAttempts.agentId, input.agentId),
          eq(orchestrationWorkerAttempts.runId, input.runId),
          eq(orchestrationWorkerAttempts.status, "running"),
        )).limit(2);
      if (matches.length !== 1 || !matches[0]!.attempt.executionManifestId ||
        matches[0]!.plan.executionPrincipal?.type !== "user" ||
        matches[0]!.plan.executionPrincipal.userId !== input.responsibleUserId)
        throw forbidden("One exact active, accountable worker attempt is required for managed model execution");
      const row = matches[0]!;
      const binding: WorkerModelBinding = {
        planId: row.plan.id,
        workerId: row.worker.id,
        workerAttemptId: row.attempt.id,
        executionManifestId: row.attempt.executionManifestId!,
        expectedPlanVersion: row.plan.version,
      };
      const minted = createRuntimeToolsToken({ ...input, workerModelBinding: binding, scope: "worker_model" });
      const claims = minted && verifyRuntimeToolsToken(minted.token, "worker_model");
      if (!claims?.worker_model) throw forbidden("Worker capability signing is unavailable");
      const state = await current(db, claims as BoundClaims);
      return { ...minted!, inputTokensUpperBound: state.profile.inputTokensUpperBound,
        maxOutputTokens: state.profile.maxOutputTokens };
    },
    /** Private dispatch-time capability for an authenticated Native chat. It
     * may be minted before the executor records its initial input receipt;
     * every broker use still requires that receipt before reservation or IO. */
    async issueForConversationRun(input: {
      companyId: string; agentId: string; runId: string; responsibleUserId: string;
    }) {
      const [run] = await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.id, input.runId)));
      const [issue] = run?.nativeIssueId ? await db.select().from(issues).where(and(
        eq(issues.companyId, input.companyId), eq(issues.id, run.nativeIssueId))) : [];
      const [manifest] = await db.select().from(agentExecutionManifests).where(and(
        eq(agentExecutionManifests.companyId, input.companyId), eq(agentExecutionManifests.agentId, input.agentId),
        eq(agentExecutionManifests.runId, input.runId)));
      if (!run || run.runtimeMode !== "native" || run.status !== "running" || run.scopeKind !== "issue" ||
        run.responsibleUserId !== input.responsibleUserId || !issue || issue.conversationAgentId !== input.agentId ||
        issue.conversationUserId !== input.responsibleUserId || issue.conversationState !== "active" ||
        issue.conversationSessionGeneration === null || issue.executionRunId !== input.runId ||
        !["in_review", "in_progress"].includes(issue.status) ||
        !manifest || manifest.manifest.responsibleUserId !== input.responsibleUserId)
        throw forbidden("One exact active authenticated Native conversation is required");
      const binding: ConversationModelBinding = { issueId: issue.id,
        conversationSessionGeneration: issue.conversationSessionGeneration,
        executionManifestId: manifest.id, executionManifestHash: manifest.hash };
      const minted = createRuntimeToolsToken({ ...input, conversationModelBinding: binding, scope: "conversation_model" });
      const claims = minted && verifyRuntimeToolsToken(minted.token, "conversation_model");
      if (!claims?.conversation_model) throw forbidden("Native conversation capability signing is unavailable");
      const state = await currentConversation(db, claims as ConversationClaims, false);
      return { ...minted!, inputTokensUpperBound: state.profile.inputTokensUpperBound,
        maxOutputTokens: state.profile.maxOutputTokens };
    },
    async call(
      claims: RuntimeToolsTokenClaims,
      raw: WorkerModelCall,
      callerSignal?: AbortSignal,
      internal?: { onWireDispatch?: (receipt: WorkerModelDispatchWireReceipt) => void },
    ) {
      callerSignal?.throwIfAborted();
      if (!claims.worker_model || claims.scope !== "worker_model")
        throw forbidden("Bound worker model capability required");
      const bound = claims as BoundClaims,
        input = workerModelCallSchema.parse(raw);
      const state = await current(db, bound);
      if (input.maxOutputTokens > state.profile.maxOutputTokens)
        throw forbidden(
          "Requested output exceeds the qualified worker envelope",
        );
      const request = {
        model: state.profile.tariff.model,
        system: input.system,
        evidence: input.prompt,
        maxOutputTokens: input.maxOutputTokens,
      };
      if (
        readOnlyModelEnvelopeBytes(request) > state.profile.maximumEnvelopeBytes
      )
        throw forbidden(
          "Worker input exceeds the qualified complete wire envelope",
        );
      const reservations = modelReservationService(db, {
        sourceSha: options.sourceSha,
        qualifiedTariff: async (i) =>
          i.purpose === "worker_model" &&
          i.companyId === claims.company_id &&
          i.planId === bound.worker_model.planId
            ? assertWorkerModelProfileCurrent(state.profile, options.sourceSha, options.protectedEvidenceOrigin).tariff
            : null,
        currentAuthority: async (tx) =>
          (await current(tx, bound)).authorityHash,
      });
      const reservation = await reservations
        .reserve(state.actor, {
          companyId: claims.company_id,
          planId: bound.worker_model.planId,
          workerId: bound.worker_model.workerId,
          workerAttemptId: bound.worker_model.workerAttemptId,
          expectedPlanVersion: bound.worker_model.expectedPlanVersion,
          purpose: "worker_model",
          idempotencyKey: `worker-model:${claims.run_id}:${input.callId}`,
          inputHash: nativeSha256(request),
          authorityHash: state.authorityHash,
          inputTokensUpperBound: state.profile.inputTokensUpperBound,
          maxOutputTokens: input.maxOutputTokens,
        })
        .catch(async (error) => {
          if (
            error instanceof Error &&
            error.message === "Cumulative model reservation budget exhausted"
          )
            await fence(
              claims.company_id,
              bound.worker_model.planId,
              "worker_model_budget_exhausted",
            );
          throw error;
        });
      // Never resend an ambiguous/completed model call or store its prompt/body
      // merely to replay it. A lost response needs a new reviewed continuation.
      if (reservation.status !== "reserved")
        throw conflict("Worker model call cannot be dispatched again");
      await reservations.claimForDispatch(
        state.actor,
        claims.company_id,
        reservation.id,
      );
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(
          30000,
          reservation.expiresAt.getTime() - Date.now(),
          claims.exp * 1000 - Date.now(),
        ),
      );
      const cancel = () => controller.abort();
      callerSignal?.addEventListener("abort", cancel, { once: true });
      let checking = false;
      const assertCurrent = async () => {
        controller.signal.throwIfAborted();
        const fresh = await current(db, bound);
        if (fresh.authorityHash !== state.authorityHash)
          throw forbidden("Worker source authority changed during dispatch");
        return fresh;
      };
      const watch = setInterval(() => {
        if (checking) return;
        checking = true;
        void assertCurrent()
          .catch(cancel)
          .finally(() => {
            checking = false;
          });
      }, 1000);
      let financiallySettled = false;
      try {
        if (callerSignal?.aborted) controller.abort();
        await assertCurrent();
        const credential = await aiConnectionService(db).credential(
          state.selection,
        );
        const fresh = await assertCurrent();
        if (
          createHash("sha256").update(credential).digest("hex") !==
          fresh.credentialSha256
        )
          throw forbidden("Worker credential changed before provider dispatch");
        const result = await anthropicReadOnlyCall(
          request,
          credential,
          controller.signal,
          { fetch: options.fetch, onWireDispatch: async (wire) => {
            if (!internal?.onWireDispatch) return;
            const receipt: WorkerModelDispatchWireReceipt = {
              ...wire, reservationId: reservation.id, callId: input.callId,
              requestHash: nativeSha256(request),
            };
            await db.transaction(async (tx) => {
              const fresh = await current(tx, bound);
              if (fresh.authorityHash !== state.authorityHash)
                throw forbidden("Worker source authority changed before wire dispatch");
              const [run] = await tx.select().from(heartbeatRuns).where(and(
                eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.id, claims.run_id),
                eq(heartbeatRuns.agentId, claims.sub), eq(heartbeatRuns.status, "running"),
              )).for("update");
              const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
                ? run.runnerProfileJson as Record<string, unknown> : null;
              const sourceReceipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
              const rawPrevious = profile?.nativeAwModelWireIntents;
              const previous = rawPrevious === undefined ? [] : rawPrevious;
              if (!run || !profile || !sourceReceipt?.success || !Array.isArray(previous) || previous.length >= 64 ||
                previous.some((item) => item && typeof item === "object" && !Array.isArray(item) &&
                  (item as Record<string, unknown>).reservationId === receipt.reservationId))
                throw forbidden("The Native source receipt cannot bind this model dispatch");
              const intents = [...previous, {
                reservationId: receipt.reservationId, callId: receipt.callId, requestHash: receipt.requestHash,
                wireBodyHash: receipt.bodySha256, endpoint: receipt.endpoint, method: receipt.method,
              }];
              if (Buffer.byteLength(JSON.stringify(intents), "utf8") > 256 * 1024)
                throw forbidden("The Native model wire receipt exceeds its bound");
              await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile, nativeAwModelWireIntents: intents }, updatedAt: new Date() })
                .where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "running")));
            });
            internal?.onWireDispatch?.(receipt);
          } },
        );
        // A known provider charge survives access withdrawal. Settle its
        // bounded receipt before checking whether the result may be disclosed.
        const outcome = await reservations.recordOutcome(
          claims.company_id,
          reservation.id,
          {
            status: "completed",
            providerResponseHash: nativeSha256(result),
            usage: result.usage,
          },
        );
        financiallySettled = outcome.status === "completed";
        if (outcome.status !== "completed")
          throw conflict("Worker model charge could not be confirmed");
        await assertCurrent();
        if (result.text.length > 256000)
          throw conflict("The qualified worker inference envelope was exceeded");
        return workerModelResultSchema.parse({
          reservationId: reservation.id,
          ...result,
        });
      } catch {
        if (!financiallySettled)
          await reservations
            .recordOutcome(claims.company_id, reservation.id, {
              status: "unknown",
              providerResponseHash: null,
              usage: null,
            })
            .catch(() => {});
        const reasonCode = financiallySettled
          ? "worker_model_result_withheld"
          : "worker_model_unsettled";
        await fence(claims.company_id, bound.worker_model.planId, reasonCode);
        throw conflict("Worker model result requires human resolution", {
          code: reasonCode,
        });
      } finally {
        clearTimeout(timeout);
        clearInterval(watch);
        callerSignal?.removeEventListener("abort", cancel);
      }
    },
    /** Tool-capable Messages API for the exact managed OpenCode profile. The
     * actual Anthropic request is treated as the reserved invocation; callers
     * cannot select a destination, model, price or retry identity. */
    async callManagedMessages(
      claims: RuntimeToolsTokenClaims,
      raw: unknown,
      callerSignal?: AbortSignal,
      internal?: { onWireDispatch?: (receipt: WorkerModelDispatchWireReceipt) => void },
    ) {
      callerSignal?.throwIfAborted();
      const bound = claims.scope === "worker_model" && claims.worker_model ? claims as BoundClaims : null;
      const conversation = claims.scope === "conversation_model" && claims.conversation_model ? claims as ConversationClaims : null;
      if (!bound && !conversation) throw forbidden("Bound managed model capability required");
      const modelClaims: ManagedModelClaims = bound ?? conversation!;
      const state = bound ? await current(db, bound) : await currentConversation(db, conversation!);
      if (state.profile.transport !== "server-anthropic-messages-v1")
        throw forbidden("The selected worker profile is not the Messages broker profile");
      const qualifiedInput = validateAnthropicManagedMessagesRequest(raw, {
        model: state.profile.tariff.model,
        maxOutputTokens: state.profile.maxOutputTokens,
        maximumEnvelopeBytes: state.profile.maximumEnvelopeBytes,
      });
      const requestSourceBinding = await assertManagedOpenCodeRequestSources(db, modelClaims,
        qualifiedInput.providerRequest as unknown as Record<string, unknown>);
      const inputHash = nativeSha256(qualifiedInput.providerRequest);
      const callId = `messages:${inputHash}`;
      const reservations = modelReservationService(db, {
        sourceSha: options.sourceSha,
        qualifiedTariff: async (i) =>
          Boolean(bound) && i.purpose === "worker_model" && i.companyId === claims.company_id && i.planId === bound!.worker_model.planId
            ? assertWorkerModelProfileCurrent(state.profile, options.sourceSha, options.protectedEvidenceOrigin).tariff
            : null,
        currentAuthority: async (tx) => bound ? (await current(tx, bound)).authorityHash : state.authorityHash,
        qualifiedConversationTariff: async (i) => conversation && i.companyId === claims.company_id &&
          i.agentId === claims.sub && i.runId === claims.run_id ? state.profile.tariff : null,
        currentConversationAuthority: async (tx, actor, i) => {
          if (!conversation || i.conversationAgentId !== claims.sub || i.conversationRunId !== claims.run_id ||
            i.conversationIssueId !== conversation.conversation_model.issueId ||
            i.conversationSessionGeneration !== conversation.conversation_model.conversationSessionGeneration ||
            i.executionManifestId !== conversation.conversation_model.executionManifestId ||
            i.executionManifestHash !== conversation.conversation_model.executionManifestHash)
            throw forbidden("The Native conversation reservation binding changed");
          return (await currentConversation(tx, conversation)).authorityHash;
        },
      });
      const reservation = bound ? await reservations.reserve(state.actor, {
        companyId: claims.company_id,
        planId: bound.worker_model.planId,
        workerId: bound.worker_model.workerId,
        workerAttemptId: bound.worker_model.workerAttemptId,
        expectedPlanVersion: bound.worker_model.expectedPlanVersion,
        purpose: "worker_model",
        idempotencyKey: `worker-model-messages:${claims.run_id}:${inputHash}`,
        inputHash,
        authorityHash: state.authorityHash,
        inputTokensUpperBound: state.profile.inputTokensUpperBound,
        maxOutputTokens: qualifiedInput.request.max_tokens,
      }).catch(async (error) => {
        if (bound && error instanceof Error && error.message === "Cumulative model reservation budget exhausted")
          await fence(claims.company_id, bound.worker_model.planId, "worker_model_budget_exhausted");
        throw error;
      }) : await reservations.reserveConversation(state.actor, {
        companyId: claims.company_id, conversationAgentId: claims.sub, conversationRunId: claims.run_id,
        conversationIssueId: conversation!.conversation_model.issueId,
        conversationSessionGeneration: conversation!.conversation_model.conversationSessionGeneration,
        executionManifestId: conversation!.conversation_model.executionManifestId,
        executionManifestHash: conversation!.conversation_model.executionManifestHash,
        idempotencyKey: `conversation-model-messages:${claims.run_id}:${inputHash}`, inputHash,
        authorityHash: state.authorityHash, inputTokensUpperBound: state.profile.inputTokensUpperBound,
        maxOutputTokens: qualifiedInput.request.max_tokens,
      });
      if (reservation.status !== "reserved")
        throw conflict("Managed model request cannot be dispatched again");
      if (bound) await reservations.claimForDispatch(state.actor, claims.company_id, reservation.id);
      else await reservations.claimConversationForDispatch(state.actor, claims.company_id, reservation.id);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(
        30000, reservation.expiresAt.getTime() - Date.now(), claims.exp * 1000 - Date.now(),
      ));
      const cancel = () => controller.abort();
      callerSignal?.addEventListener("abort", cancel, { once: true });
      let checking = false;
      const assertCurrent = async () => {
        controller.signal.throwIfAborted();
        const fresh = bound ? await current(db, bound) : await currentConversation(db, conversation!);
        if (fresh.authorityHash !== state.authorityHash)
          throw forbidden("Managed source authority changed during dispatch");
        return fresh;
      };
      const watch = setInterval(() => {
        if (checking) return;
        checking = true;
        void assertCurrent().catch(cancel).finally(() => { checking = false; });
      }, 1000);
      let financiallySettled = false;
      let managedFailureStage:
        | "provider_authority_recheck"
        | "credential_lookup"
        | "credential_recheck"
        | "wire_authority_recheck"
        | "wire_run_binding"
        | "wire_receipt_binding"
        | "wire_intent_budget"
        | "wire_intent_write"
        | "provider_transport"
        | "reservation_settlement"
        | "response_run_binding"
        | "response_history_revalidation"
        | "response_receipt_binding"
        | "response_wire_intent_match"
        | "response_result_identity"
        | "response_source_union"
        | "response_receipt_finalize"
        | "response_capture_write"
        | "post_response_recheck" = "provider_authority_recheck";
      try {
        if (callerSignal?.aborted) controller.abort();
        await assertCurrent();
        managedFailureStage = "credential_lookup";
        const credential = await aiConnectionService(db).credential(state.selection);
        managedFailureStage = "credential_recheck";
        const fresh = await assertCurrent();
        if (createHash("sha256").update(credential).digest("hex") !== fresh.credentialSha256)
          throw forbidden("Worker credential changed before provider dispatch");
        managedFailureStage = "provider_transport";
        const result = await anthropicManagedMessagesCall(raw, {
          model: state.profile.tariff.model,
          maxOutputTokens: state.profile.maxOutputTokens,
          maximumEnvelopeBytes: state.profile.maximumEnvelopeBytes,
          maximumInputTokens: state.profile.inputTokensUpperBound,
        }, credential, controller.signal, {
          fetch: options.fetch,
          onWireDispatch: async (wire) => {
            managedFailureStage = "wire_authority_recheck";
            const receipt: WorkerModelDispatchWireReceipt = {
              ...wire, reservationId: reservation.id, callId, requestHash: inputHash,
            };
            await db.transaction(async (tx) => {
              // Memory candidate writes acquire company privacy locks before
              // reading the current Run. Keep this response receipt TX in the
              // same order before taking its Run row lock.
              await lockAnalyticalCompany(tx as unknown as Db, claims.company_id);
              await lockMemoryPrivacy(tx as unknown as Db, claims.company_id);
              const fresh = bound ? await current(tx, bound) : await currentConversation(tx, conversation!);
              if (fresh.authorityHash !== state.authorityHash)
                throw forbidden("Worker source authority changed before wire dispatch");
              managedFailureStage = "wire_run_binding";
              const [run] = await tx.select().from(heartbeatRuns).where(and(
                eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.id, claims.run_id),
                eq(heartbeatRuns.agentId, claims.sub), eq(heartbeatRuns.status, "running"),
              )).for("update");
              const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
                ? run.runnerProfileJson as Record<string, unknown> : null;
              managedFailureStage = "wire_receipt_binding";
              const sourceReceipt = profile && nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
              // The first dispatch has no wire-intent list yet. Treat only an
              // absent list as empty; malformed or caller-shaped values still
              // fail closed, and every later intent is appended transactionally.
              const prior = profile?.nativeAwModelWireIntents === undefined
                ? [] : profile.nativeAwModelWireIntents;
              if (!run || !profile || !sourceReceipt?.success || !Array.isArray(prior) || prior.length >= 64 ||
                prior.some((entry) => entry && typeof entry === "object" && !Array.isArray(entry) &&
                  (entry as Record<string, unknown>).reservationId === receipt.reservationId))
                throw forbidden("The Native source receipt cannot bind this model dispatch");
              const authority = managedRecord(profile.nativeOpenCodeSourceAuthority);
              const promptBindings = Array.isArray(authority.promptSourceBindings)
                ? authority.promptSourceBindings.map(managedRecord).filter((binding) =>
                    binding.promptHash === requestSourceBinding.promptHash &&
                    binding.sourceSetHash === requestSourceBinding.sourceSetHash)
                : [];
              const matchingSourceDispatches = sourceReceipt.data.dispatches.filter((dispatch) =>
                nativeSha256({ policy: dispatch.policy, inputs: dispatch.inputs }) === requestSourceBinding.sourceSetHash);
              const matchingTurnDigests = [...new Set(matchingSourceDispatches.map((dispatch) => dispatch.executionInputDigest))];
              const nativeInputIntents = Array.isArray(profile.nativeModelInputDispatchIntents)
                ? profile.nativeModelInputDispatchIntents.map(managedRecord).filter((intent) =>
                    intent.turnInputDigest === matchingTurnDigests[0] &&
                    intent.responsibleUserId === run.responsibleUserId &&
                    typeof intent.turnId === "string" && intent.continuation === false)
                : [];
              if (promptBindings.length !== 1 || matchingSourceDispatches.length !== 1 ||
                matchingTurnDigests.length !== 1 || nativeInputIntents.length !== 1 ||
                !/^[0-9a-f]{64}$/.test(matchingTurnDigests[0] ?? ""))
                throw forbidden("The managed request is not bound to one acknowledged Native input dispatch");
              const sourceDispatchDigest = matchingTurnDigests[0]!;
              managedFailureStage = "wire_intent_budget";
              const sourcePolicyHash = nativeSha256(sourceReceipt.data.bootstrap);
              const intents = [...prior, { modelPurpose: bound ? "worker_model" : "conversation_model",
                ...(conversation ? { agentId: claims.sub, conversationModelBinding: conversation.conversation_model } : {}),
                reservationId: receipt.reservationId, callId: receipt.callId,
                requestHash: receipt.requestHash, wireBodyHash: receipt.bodySha256, endpoint: receipt.endpoint,
                method: receipt.method, sourcePolicyHash, sourceDispatchDigest,
                sourceSetHash: requestSourceBinding.sourceSetHash,
                consumedSourceSet: requestSourceBinding.consumedSourceSet,
                consumedSourceSetHash: nativeSha256(requestSourceBinding.consumedSourceSet),
                consumedSourceComponents: requestSourceBinding.consumedSourceComponents,
                idempotencyKey: reservation.idempotencyKey }];
              if (Buffer.byteLength(JSON.stringify(intents), "utf8") > 256 * 1024)
                throw forbidden("The Native model wire receipt exceeds its bound");
              managedFailureStage = "wire_intent_write";
              await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile, nativeAwModelWireIntents: intents }, updatedAt: new Date() })
                .where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "running")));
            });
            internal?.onWireDispatch?.(receipt);
            managedFailureStage = "provider_transport";
          },
        });
        managedFailureStage = "reservation_settlement";
        const outcome = await reservations.recordOutcome(claims.company_id, reservation.id, {
          status: "completed", providerResponseHash: result.responseHash, usage: result.usage,
        });
        financiallySettled = outcome.status === "completed";
        if (outcome.status !== "completed") throw conflict("Worker model charge could not be confirmed");
        const responseContentHash = nativeSha256(result.responseContent);
        managedFailureStage = "response_run_binding";
        await db.transaction(async (tx) => {
          // Source revalidation below uses these same company locks. Taking
          // them before FOR UPDATE matches Memory's company-lock → Run-read
          // order and keeps the final check inside this receipt transaction.
          await lockAnalyticalCompany(tx as unknown as Db, claims.company_id);
          await lockMemoryPrivacy(tx as unknown as Db, claims.company_id);
          const [run] = await tx.select().from(heartbeatRuns).where(and(
            eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.id, claims.run_id),
            eq(heartbeatRuns.agentId, claims.sub), eq(heartbeatRuns.status, "running"),
          )).for("update");
          const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
            ? run.runnerProfileJson as Record<string, unknown> : null;
          const previous = profile?.nativeAwModelWireIntents;
          if (!run || !profile || !Array.isArray(previous)) throw forbidden("The managed model response has no original wire intent");
          managedFailureStage = "response_history_revalidation";
          await assertManagedOpenCodeRequestSources(tx as unknown as Db, modelClaims,
            qualifiedInput.providerRequest as unknown as Record<string, unknown>);
          managedFailureStage = "response_receipt_binding";
          const sourceReceipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
          if (!sourceReceipt.success || sourceReceipt.data.binding.responsibleUserId !== run.responsibleUserId ||
            sourceReceipt.data.bootstrap.executionInputDigest !== await managedJsonbSha256(tx as unknown as Db, profile.nativeExecutionInput))
            throw forbidden("The managed model response lost its exact Native input receipt");
          managedFailureStage = "response_wire_intent_match";
          const matches = previous.map((value, index) => ({ value, index })).filter(({ value }) =>
            value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).reservationId === reservation.id);
          if (matches.length !== 1) throw forbidden("The managed model response does not match one original wire intent");
          const existing = matches[0]!.value as Record<string, unknown>;
          if (existing.responseContentHash !== undefined && existing.responseContentHash !== responseContentHash)
            throw forbidden("The managed model response changed after its original capture");
          const sourceDispatchDigest = existing.sourceDispatchDigest;
          const nativeInputIntents = Array.isArray(profile.nativeModelInputDispatchIntents)
            ? profile.nativeModelInputDispatchIntents.map(managedRecord).filter((intent) =>
                intent.turnInputDigest === sourceDispatchDigest && intent.responsibleUserId === run.responsibleUserId &&
                typeof intent.turnId === "string" && intent.continuation === false)
            : [];
          if (typeof sourceDispatchDigest !== "string" || !/^[0-9a-f]{64}$/.test(sourceDispatchDigest) ||
            nativeInputIntents.length !== 1 || typeof existing.sourceSetHash !== "string" ||
            !/^[0-9a-f]{64}$/.test(existing.sourceSetHash))
            throw forbidden("The managed model response is not bound to one acknowledged Native input dispatch");
          managedFailureStage = "response_result_identity";
          const responseToolUses = result.responseContent.flatMap((block) => block.type === "tool_use"
            ? [{ id: block.id, name: block.name, argumentsHash: nativeSha256(block.input) }] : []);
          const priorToolUseIds = new Set(previous.flatMap((value, index) => {
            if (index === matches[0]!.index || !value || typeof value !== "object" || Array.isArray(value)) return [];
            const calls = (value as Record<string, unknown>).responseToolUses;
            return Array.isArray(calls) ? calls.map((call) => managedRecord(call).id).filter((id): id is string => typeof id === "string") : [];
          }));
          if (responseToolUses.some((call) => priorToolUseIds.has(call.id)))
            throw forbidden("The managed model reused an earlier tool-use identifier");
          const intents = previous.map((value, index) => index === matches[0]!.index
            ? { ...existing, responseContentHash, responseBlockCount: result.responseContent.length, responseToolUses }
            : value);
          const providerDispatch = nativePayloadSourceInputSchema.parse(bound ? { kind: "worker_model_dispatch",
            runId: claims.run_id, reservationId: reservation.id, callId: existing.callId,
            requestHash: existing.requestHash, wireBodyHash: existing.wireBodyHash, responseHash: result.responseHash }
            : { kind: "conversation_model_dispatch", runId: claims.run_id, agentId: claims.sub,
              issueId: conversation!.conversation_model.issueId,
              conversationSessionGeneration: conversation!.conversation_model.conversationSessionGeneration,
              executionManifestId: conversation!.conversation_model.executionManifestId,
              executionManifestHash: conversation!.conversation_model.executionManifestHash,
              reservationId: reservation.id, callId: existing.callId, requestHash: existing.requestHash,
              wireBodyHash: existing.wireBodyHash, responseHash: result.responseHash });
          managedFailureStage = "response_source_union";
          const consumedRaw = managedRecord(existing.consumedSourceSet);
          const consumedPolicy = nativePayloadSourcePolicySchema.safeParse(consumedRaw.policy);
          const consumedInputs = nativePayloadSourceInputSchema.array().max(256).safeParse(consumedRaw.inputs);
          const consumedComponents = existing.consumedSourceComponents;
          if (!consumedPolicy.success || !consumedInputs.success || !Array.isArray(consumedComponents) ||
            consumedComponents.length < 1 || consumedComponents.length > 64 ||
            existing.consumedSourceSetHash !== nativeSha256({ policy: consumedPolicy.data, inputs: consumedInputs.data }) ||
            Buffer.byteLength(JSON.stringify(consumedComponents), "utf8") > 512 * 1024)
            throw forbidden("The managed model response lost its immutable consumed-source binding");
          const sourcePolicy = consumedPolicy.data;
          const uniqueInputs = nativePayloadSourceInputSchema.array().max(256).parse([
            ...consumedInputs.data,
            providerDispatch,
          ]);
          const dispatch = {
            // Receipt dispatches are append-only. Bind this provider response
            // to the acknowledged Native input turn that actually carried its
            // prompt and the exact source closure captured before the provider
            // request. Later receipt inputs must not retroactively become
            // sources for this response.
            executionInputDigest: sourceDispatchDigest,
            responsibleUserId: run.responsibleUserId,
            policy: sourcePolicy,
            inputs: uniqueInputs,
          };
          const { digest: _oldDigest, ...receiptBody } = sourceReceipt.data;
          const nextReceiptBody = { ...receiptBody, dispatches: [...receiptBody.dispatches, dispatch] };
          managedFailureStage = "response_receipt_finalize";
          const nextReceipt = { ...nextReceiptBody, digest: await managedJsonbSha256(tx as unknown as Db, nextReceiptBody) };
          if (!nativeRunInputSourceReceiptSchema.safeParse(nextReceipt).success ||
            Buffer.byteLength(JSON.stringify(intents), "utf8") > 256 * 1024)
            throw forbidden("The managed model source closure exceeds its bound");
          managedFailureStage = "response_capture_write";
          await tx.update(heartbeatRuns).set({ runnerProfileJson: {
            ...profile, nativeAwModelWireIntents: intents, nativeInputSourceReceipt: nextReceipt,
          }, updatedAt: new Date() })
            .where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "running")));
        });
        managedFailureStage = "post_response_recheck";
        await assertCurrent();
        return { reservationId: reservation.id, sse: result.sse };
      } catch (error) {
        if (!financiallySettled && error instanceof ReadOnlyModelKnownUsageError) {
          const outcome = await reservations.recordOutcome(claims.company_id, reservation.id, {
            status: "completed", providerResponseHash: error.knownUsage.responseHash, usage: error.knownUsage.usage,
          }).catch(() => null);
          financiallySettled = outcome?.status === "completed";
        }
        if (!financiallySettled)
          await reservations.recordOutcome(claims.company_id, reservation.id, { status: "unknown", providerResponseHash: null, usage: null }).catch(() => {});
        const reasonCode = conversation
          ? financiallySettled ? "conversation_model_result_withheld" : "conversation_model_unsettled"
          : financiallySettled ? "worker_model_result_withheld" : "worker_model_unsettled";
        if (bound) await fence(claims.company_id, bound.worker_model.planId, reasonCode);
        throw conflict("Worker model result requires human resolution", {
          code: reasonCode,
          stage: managedFailureStage,
          ...managedSqlFailureDetails(error),
        });
      } finally {
        clearTimeout(timeout);
        clearInterval(watch);
        callerSignal?.removeEventListener("abort", cancel);
      }
    },
  };
}
