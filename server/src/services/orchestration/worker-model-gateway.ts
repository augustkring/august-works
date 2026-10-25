import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertAuthoredProceduresCurrent } from "../agents/authoring-procedures.js";
import { assertAuthoredAgentManifestCurrent } from "../agents/authored-definition.js";
import { and, eq, or, sql } from "drizzle-orm";
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
  issues,
  orchestrationPlans,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  orchestrationModelReservations,
  toolInvocations,
  type Db,
} from "@paperclipai/db";
import {
  workerModelBindingSchema,
  workerModelCallSchema,
  workerModelResultSchema,
  nativeRunInputSourceReceiptSchema,
  nativePayloadSourceInputSchema,
  type WorkerModelBinding,
  type WorkerModelCall,
  type NativePayloadSourceInput,
} from "@paperclipai/shared";
import {
  createRuntimeToolsToken,
  verifyRuntimeToolsToken,
  type RuntimeToolsTokenClaims,
} from "../../runtime-tools-token.js";
import { conflict, forbidden } from "../../errors.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import { aiConnectionService } from "../ai-connections.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { assertV7Authorization, assertV7Enabled } from "../v7-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
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
import { assertNativeDocumentRevisionCurrentSourceAccess, assertNativePayloadSourceSetCurrent } from "../native-direct-input.js";
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

type BoundClaims = RuntimeToolsTokenClaims & {
  worker_model: WorkerModelBinding;
};
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
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return value;
}

function managedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function managedJsonbSha256(db: Db, value: unknown): Promise<string> {
  const [row] = await db.execute<{ digest: string }>(sql`select encode(sha256(convert_to((${JSON.stringify(value)}::jsonb)::text,'UTF8')),'hex') as digest`);
  if (!row || !/^[0-9a-f]{64}$/.test(row.digest)) throw forbidden("Managed OpenCode source receipt digest is unavailable");
  return row.digest;
}

async function assertManagedOpenCodeRequestSources(db: Db, claims: BoundClaims, request: Record<string, unknown>) {
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
  const system = request.system;
  const systemText = typeof system === "string" ? system : Array.isArray(system) && system.every((part) =>
    managedRecord(part).type === "text" && typeof managedRecord(part).text === "string")
    ? (system as Array<{ text: string }>).map((part) => part.text).join("") : null;
  if (!run || authority.version !== 1 || !receipt.success || !Array.isArray(schemas) || !Array.isArray(prompts) ||
    prompts.length === 0 || prompts.length > 64 || prompts.some((value) => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) ||
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
  const sourcePrefixes = [{ policy: receipt.data.bootstrap.policy, inputs: receipt.data.bootstrap.inputs },
    ...receipt.data.dispatches.map((dispatch) => {
      const currentDispatch = [...dispatch.inputs].reverse().find((source) => source.kind === "worker_model_dispatch");
      if (!currentDispatch) throw forbidden("Managed OpenCode source prefix has no current dispatch");
      return { policy: dispatch.policy, inputs: dispatch.inputs.filter((source) => !isDeepStrictEqual(source, currentDispatch)) };
    })];
  for (const sourceSet of sourcePrefixes)
    await assertNativePayloadSourceSetCurrent(db, {
      companyId: claims.company_id, issueId: run.nativeIssueId!, runId: claims.run_id,
      actor: sourceActor, policy: sourceSet.policy, inputs: sourceSet.inputs,
    });

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
    actualTools.some((tool) => !["read_document", "write_document", "create_task", "paperclip_finish", "paperclip_block"].includes(tool.name)))
    throw forbidden("Managed OpenCode tool schemas do not match the exact current Native catalog");

  const intents = Array.isArray(profile.nativeAwModelWireIntents) ? profile.nativeAwModelWireIntents.map(managedRecord) : [];
  const captures = Array.isArray(profile.nativeToolResultSourceCaptures) ? profile.nativeToolResultSourceCaptures.map(managedRecord) : [];
  const associations = Array.isArray(profile.nativeToolCallDispatchAssociations) ? profile.nativeToolCallDispatchAssociations.map(managedRecord) : [];
  let sawAuthorizedUserPrompt = false;
  const priorProviderToolUses = new Set<string>();
  const consumedProviderToolUses = new Set<string>();
  for (const messageValue of Array.isArray(request.messages) ? request.messages : []) {
    const message = managedRecord(messageValue);
    const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] :
      Array.isArray(message.content) ? message.content.map(managedRecord) : [];
    if (message.role === "assistant") {
      const contentHash = nativeSha256(message.content);
      const matchingIntents = intents.filter((intent) => typeof intent.responseContentHash === "string" &&
        intent.sourcePolicyHash === sourcePolicyHash && contentHash === intent.responseContentHash);
      const qualifiedIntents = [] as Record<string, unknown>[];
      for (const intent of matchingIntents) {
        if (typeof intent.reservationId !== "string") continue;
        const [reservation] = await db.select({ status: orchestrationModelReservations.status,
          providerResponseHash: orchestrationModelReservations.providerResponseHash }).from(orchestrationModelReservations)
          .where(and(eq(orchestrationModelReservations.companyId, claims.company_id),
            eq(orchestrationModelReservations.id, intent.reservationId),
            eq(orchestrationModelReservations.purpose, "worker_model"),
            eq(orchestrationModelReservations.status, "completed")));
        if (reservation?.status === "completed" && typeof reservation.providerResponseHash === "string")
          qualifiedIntents.push(intent);
      }
      // The content hash alone is not a dispatch identity: repeated identical
      // provider replies could otherwise make a prior assistant frame ambiguous.
      if (qualifiedIntents.length !== 1)
        throw forbidden("Managed OpenCode assistant history is not an exact persisted provider response");
      const toolUses = qualifiedIntents[0]!.responseToolUses;
      if (Array.isArray(toolUses)) for (const call of toolUses) {
        const id = managedRecord(call).id;
        if (typeof id === "string") priorProviderToolUses.add(id);
      }
    } else if (message.role === "user") {
      for (const block of blocks) {
        if (block.type === "text") {
          if (typeof block.text !== "string" || !prompts.includes(nativeSha256(block.text)))
            throw forbidden("Managed OpenCode user history is outside the current server-owned prompt receipts");
          sawAuthorizedUserPrompt = true;
          continue;
        }
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string")
          throw forbidden("Managed OpenCode history contains an unsupported user content block");
        if (!priorProviderToolUses.has(block.tool_use_id) || consumedProviderToolUses.has(block.tool_use_id))
          throw forbidden("Managed OpenCode tool result has no preceding provider tool use in this transcript");
        consumedProviderToolUses.add(block.tool_use_id);
        let toolName = "";
        for (const intent of intents) {
          if (intent.sourcePolicyHash !== sourcePolicyHash) continue;
          const calls = intent.responseToolUses;
          if (Array.isArray(calls)) {
            const call = calls.map(managedRecord).find((part) => part.id === block.tool_use_id);
            if (call && typeof call.name === "string") toolName = managedToolName(call.name);
          }
        }
        const capture = captures.find((item) => item.managedOpenCode === true && item.callId === block.tool_use_id &&
          item.tool === toolName && typeof item.resultDigest === "string");
        if (!capture || !["read_document", "write_document", "create_task"].includes(toolName) ||
          !associations.some((item) => item.callId === block.tool_use_id && item.tool === toolName && typeof item.turnId === "string"))
          throw forbidden("Managed OpenCode tool result has no original qualified invocation receipt");
        const source = managedRecord(capture.source);
        const content = typeof block.content === "string" ? block.content : Array.isArray(block.content)
          ? block.content.map((part) => typeof managedRecord(part).text === "string" ? managedRecord(part).text : "").join("") : "";
        let result: unknown;
        try { result = JSON.parse(content); } catch { throw forbidden("Managed OpenCode tool result is not its canonical source result"); }
        const contentHash = nativeSha256(result);
        const returnedResultDigest = createHash("sha256").update(JSON.stringify(result), "utf8").digest("hex");
        const invocationId = source.invocationId;
        if (contentHash !== capture.resultDigest || source.kind !== "tool_result" || source.contentHash !== contentHash ||
          source.callId !== block.tool_use_id || source.toolName !== toolName || typeof invocationId !== "string")
          throw forbidden("Managed OpenCode tool result does not match its persisted source capture");
        const [invocation] = await db.select().from(toolInvocations).where(and(
          eq(toolInvocations.companyId, claims.company_id), eq(toolInvocations.id, invocationId),
          eq(toolInvocations.runId, claims.run_id), eq(toolInvocations.agentId, claims.sub),
          eq(toolInvocations.toolName, toolName), eq(toolInvocations.status, "succeeded"),
          eq(toolInvocations.resultHash, contentHash),
        ));
        if (!invocation) throw forbidden("Managed OpenCode source tool invocation is no longer current");
        if (toolName === "create_task") {
          const taskRef = managedRecord(capture.taskRef);
          const taskId = taskRef.issueId;
          const taskSource = receipt.data.additionalInputs.flatMap((entry) => entry.inputs).find((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
            source.kind === "task" && source.issueId === taskId);
          const [task] = typeof taskId === "string" ? await db.select({ id: issues.id, companyId: issues.companyId,
            identifier: issues.identifier, title: issues.title, status: issues.status, priority: issues.priority,
            projectId: issues.projectId, parentId: issues.parentId, assigneeAgentId: issues.assigneeAgentId,
            sourceVersion: sql<string>`extract(epoch from ${issues.updatedAt})::text`, hiddenAt: issues.hiddenAt,
            payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated,
          }).from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, taskId), eq(issues.parentId, run.nativeIssueId!))) : [];
          const currentTaskSourceHash = task && createHash("sha256").update(JSON.stringify({ id: task.id,
            identifier: task.identifier ?? null, title: task.title, status: task.status, priority: task.priority }), "utf8").digest("hex");
          if (!task || !taskSource || taskSource.sourceVersion !== task.sourceVersion ||
            taskSource.contentHash !== currentTaskSourceHash || task.payloadSourceSnapshotInvalidated)
            throw forbidden("Managed OpenCode created Task source is no longer current");
          await assertV7Authorization(db, {
            type: "agent", source: "agent_jwt", companyId: claims.company_id, agentId: claims.sub,
            runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id,
          }, claims.company_id, "issue:read", { type: "issue", companyId: claims.company_id,
            issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId,
            assigneeAgentId: task.assigneeAgentId, assigneeUserId: null, status: task.status });
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
          await assertNativeDocumentRevisionCurrentSourceAccess(db, {
            companyId: claims.company_id, issueId: run.nativeIssueId!,
            revisionId: documentRef.revisionId as string,
            actor: { type: "agent", source: "agent_jwt", companyId: claims.company_id,
              agentId: claims.sub, runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id },
            // The tool result binds the exact immutable revision read by the model.
            // A later revision does not erase that historical source; the reader
            // and every source owner still receive current ACL/erasure checks.
            requireLatest: false,
          });
        }
      }
    }
  }
  if (!sawAuthorizedUserPrompt) throw forbidden("Managed OpenCode request is missing its server-owned task input");
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
    if (
      !plan ||
      plan.erasedAt ||
      plan.status !== "running" ||
      !plan.startedAt ||
      plan.version !== b.expectedPlanVersion ||
      plan.executionPrincipal?.type !== "user" ||
      plan.executionPrincipal.userId !== claims.responsible_user_id ||
      plan.budgets.maxModelCostMinor === null ||
      plan.actionClass !== "internal_draft" ||
      !["C0", "C1"].includes(plan.riskClass) ||
      now.getTime() >=
        plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000 ||
      !worker ||
      worker.status !== "running" ||
      worker.agentId !== claims.sub ||
      !attempt ||
      attempt.status !== "running" ||
      attempt.agentId !== claims.sub ||
      attempt.runId !== claims.run_id ||
      attempt.executionManifestId !== b.executionManifestId ||
      !run ||
      run.status !== "running" ||
      run.runtimeMode !== "native" ||
      run.nativeIssueId !== worker.issueId ||
      run.responsibleUserId !== claims.responsible_user_id ||
      !manifest ||
      manifest.manifest.responsibleUserId !== claims.responsible_user_id ||
      manifest.manifest.executionScope.delegatedScopes.some(
        (s) => s.companyId !== claims.company_id,
      )
    )
      throw forbidden(
        "Current Native human, internal draft Task, worker attempt and manifest required",
      );
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
  async function fence(
    companyId: string,
    planId: string,
    reasonCode = "worker_model_unsettled",
  ) {
    await withV7ActivityTransaction(db, async (tx, publications) => {
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
      await current(db, claims as BoundClaims);
      return minted!;
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
      await current(db, claims as BoundClaims);
      return minted!;
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
        financiallySettled = true;
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
      if (!claims.worker_model || claims.scope !== "worker_model")
        throw forbidden("Bound worker model capability required");
      const bound = claims as BoundClaims;
      const state = await current(db, bound);
      if (state.profile.transport !== "server-anthropic-messages-v1")
        throw forbidden("The selected worker profile is not the Messages broker profile");
      const qualifiedInput = validateAnthropicManagedMessagesRequest(raw, {
        model: state.profile.tariff.model,
        maxOutputTokens: state.profile.maxOutputTokens,
        maximumEnvelopeBytes: state.profile.maximumEnvelopeBytes,
      });
      await assertManagedOpenCodeRequestSources(db, bound, qualifiedInput.request as unknown as Record<string, unknown>);
      const inputHash = nativeSha256(qualifiedInput.providerRequest);
      const callId = `messages:${inputHash}`;
      const reservations = modelReservationService(db, {
        sourceSha: options.sourceSha,
        qualifiedTariff: async (i) =>
          i.purpose === "worker_model" && i.companyId === claims.company_id && i.planId === bound.worker_model.planId
            ? assertWorkerModelProfileCurrent(state.profile, options.sourceSha, options.protectedEvidenceOrigin).tariff
            : null,
        currentAuthority: async (tx) => (await current(tx, bound)).authorityHash,
      });
      const reservation = await reservations.reserve(state.actor, {
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
        if (error instanceof Error && error.message === "Cumulative model reservation budget exhausted")
          await fence(claims.company_id, bound.worker_model.planId, "worker_model_budget_exhausted");
        throw error;
      });
      if (reservation.status !== "reserved")
        throw conflict("Worker model request cannot be dispatched again");
      await reservations.claimForDispatch(state.actor, claims.company_id, reservation.id);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(
        30000, reservation.expiresAt.getTime() - Date.now(), claims.exp * 1000 - Date.now(),
      ));
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
        void assertCurrent().catch(cancel).finally(() => { checking = false; });
      }, 1000);
      let financiallySettled = false;
      try {
        if (callerSignal?.aborted) controller.abort();
        await assertCurrent();
        const credential = await aiConnectionService(db).credential(state.selection);
        const fresh = await assertCurrent();
        if (createHash("sha256").update(credential).digest("hex") !== fresh.credentialSha256)
          throw forbidden("Worker credential changed before provider dispatch");
        const result = await anthropicManagedMessagesCall(raw, {
          model: state.profile.tariff.model,
          maxOutputTokens: state.profile.maxOutputTokens,
          maximumEnvelopeBytes: state.profile.maximumEnvelopeBytes,
          maximumInputTokens: state.profile.inputTokensUpperBound,
        }, credential, controller.signal, {
          fetch: options.fetch,
          onWireDispatch: async (wire) => {
            const receipt: WorkerModelDispatchWireReceipt = {
              ...wire, reservationId: reservation.id, callId, requestHash: inputHash,
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
              const prior = profile?.nativeAwModelWireIntents;
              if (!run || !profile || !sourceReceipt?.success || !Array.isArray(prior) || prior.length >= 64 ||
                prior.some((entry) => entry && typeof entry === "object" && !Array.isArray(entry) &&
                  (entry as Record<string, unknown>).reservationId === receipt.reservationId))
                throw forbidden("The Native source receipt cannot bind this model dispatch");
              const sourcePolicyHash = nativeSha256(sourceReceipt.data.bootstrap);
              const intents = [...prior, { reservationId: receipt.reservationId, callId: receipt.callId,
                requestHash: receipt.requestHash, wireBodyHash: receipt.bodySha256, endpoint: receipt.endpoint,
                method: receipt.method, sourcePolicyHash }];
              if (Buffer.byteLength(JSON.stringify(intents), "utf8") > 256 * 1024)
                throw forbidden("The Native model wire receipt exceeds its bound");
              await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile, nativeAwModelWireIntents: intents }, updatedAt: new Date() })
                .where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "running")));
            });
            internal?.onWireDispatch?.(receipt);
          },
        });
        const outcome = await reservations.recordOutcome(claims.company_id, reservation.id, {
          status: "completed", providerResponseHash: result.responseHash, usage: result.usage,
        });
        financiallySettled = true;
        if (outcome.status !== "completed") throw conflict("Worker model charge could not be confirmed");
        const responseContentHash = nativeSha256(result.responseContent);
        await db.transaction(async (tx) => {
          const [run] = await tx.select().from(heartbeatRuns).where(and(
            eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.id, claims.run_id),
            eq(heartbeatRuns.agentId, claims.sub), eq(heartbeatRuns.status, "running"),
          )).for("update");
          const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
            ? run.runnerProfileJson as Record<string, unknown> : null;
          const previous = profile?.nativeAwModelWireIntents;
          if (!run || !profile || !Array.isArray(previous)) throw forbidden("The managed model response has no original wire intent");
          await assertManagedOpenCodeRequestSources(tx as unknown as Db, bound,
            qualifiedInput.request as unknown as Record<string, unknown>);
          const sourceReceipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
          if (!sourceReceipt.success || sourceReceipt.data.binding.responsibleUserId !== run.responsibleUserId ||
            sourceReceipt.data.bootstrap.executionInputDigest !== await managedJsonbSha256(tx as unknown as Db, profile.nativeExecutionInput))
            throw forbidden("The managed model response lost its exact Native input receipt");
          const matches = previous.map((value, index) => ({ value, index })).filter(({ value }) =>
            value && typeof value === "object" && !Array.isArray(value) &&
            (value as Record<string, unknown>).reservationId === reservation.id);
          if (matches.length !== 1) throw forbidden("The managed model response does not match one original wire intent");
          const existing = matches[0]!.value as Record<string, unknown>;
          if (existing.responseContentHash !== undefined && existing.responseContentHash !== responseContentHash)
            throw forbidden("The managed model response changed after its original capture");
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
          const providerDispatch = nativePayloadSourceInputSchema.parse({ kind: "worker_model_dispatch",
            runId: claims.run_id, reservationId: reservation.id, callId: existing.callId,
            requestHash: existing.requestHash, wireBodyHash: existing.wireBodyHash, responseHash: result.responseHash });
          const allInputs = [
            ...sourceReceipt.data.bootstrap.inputs,
            ...sourceReceipt.data.dispatches.flatMap((dispatch) => dispatch.inputs),
            ...sourceReceipt.data.additionalInputs.flatMap((entry) => entry.inputs),
            providerDispatch,
          ];
          const uniqueInputs = [...new Map(allInputs.map((source) => [JSON.stringify(source), source])).values()];
          const policyKeys = ["issueIds", "projectIds", "runIds", "memoryIds", "foundationRevisionIds"] as const;
          const sourcePolicy = Object.fromEntries(policyKeys.map((key) => [key, [...new Set([
            ...sourceReceipt.data.bootstrap.policy[key],
            ...sourceReceipt.data.dispatches.flatMap((dispatch) => dispatch.policy[key]),
            ...sourceReceipt.data.additionalInputs.flatMap((entry) => entry.policy[key]),
          ])].sort()])) as typeof sourceReceipt.data.bootstrap.policy;
          const dispatch = {
            executionInputDigest: sourceReceipt.data.bootstrap.executionInputDigest,
            responsibleUserId: run.responsibleUserId,
            policy: sourcePolicy,
            inputs: nativePayloadSourceInputSchema.array().parse(uniqueInputs),
          };
          const { digest: _oldDigest, ...receiptBody } = sourceReceipt.data;
          const nextReceiptBody = { ...receiptBody, dispatches: [...receiptBody.dispatches, dispatch] };
          const nextReceipt = { ...nextReceiptBody, digest: await managedJsonbSha256(tx as unknown as Db, nextReceiptBody) };
          if (!nativeRunInputSourceReceiptSchema.safeParse(nextReceipt).success ||
            Buffer.byteLength(JSON.stringify(intents), "utf8") > 256 * 1024)
            throw forbidden("The managed model source closure exceeds its bound");
          await tx.update(heartbeatRuns).set({ runnerProfileJson: {
            ...profile, nativeAwModelWireIntents: intents, nativeInputSourceReceipt: nextReceipt,
          }, updatedAt: new Date() })
            .where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "running")));
        });
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
        const reasonCode = financiallySettled ? "worker_model_result_withheld" : "worker_model_unsettled";
        await fence(claims.company_id, bound.worker_model.planId, reasonCode);
        throw conflict("Worker model result requires human resolution", { code: reasonCode });
      } finally {
        clearTimeout(timeout);
        clearInterval(watch);
        callerSignal?.removeEventListener("abort", cancel);
      }
    },
  };
}
