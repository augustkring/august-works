import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  orchestrationWorkers,
  issueDocuments,
  documents,
  agents,
  orchestrationPlans,
  type Db,
} from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { workerModelResultSchema, agentDraftRequestsTaskReview, parseAgentDraftOutput,
  agentDraftReviewDocument, AGENT_REVIEWED_TASK_OUTPUT_INSTRUCTIONS } from "@paperclipai/shared";
import type {
  NativeRunIdentity,
  NativeSessionCapabilities,
} from "@paperclipai/paperclip-runner";
import type {
  NativeSession,
  NativeSessionBackend,
  PersistedNativeSession,
  PrpEvent,
  PrpStructuredRunResult,
  PrpTerminalState,
} from "../../vendor/paperclip-runner/index.js";
import { verifyRuntimeToolsToken } from "../../runtime-tools-token.js";
import { forbidden, conflict } from "../../errors.js";
import type { workerModelGateway } from "../orchestration/worker-model-gateway.js";
import type { NativeBootstrapSourceClosure } from "./native-execution-input.js";
import { retainedOrchestrationContract } from "../orchestration/orchestration-contracts.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";
import { readAuthoredAgentDefinition, assertAuthoredAgentSnapshotCurrent,
  type AuthoredRuntimeAgent } from "../agents/authored-definition.js";

type Gateway = ReturnType<typeof workerModelGateway>;
type Input = Parameters<Gateway["issue"]>[0] & {
  outputKey: string;
  maxOutputTokens: number;
  sourceClosure: NativeBootstrapSourceClosure;
  /** Verified, bounded server projection; never accepted by the model HTTP API. */
  runtimeContextText?: {
    aggregateDigest: string;
    instructionFiles: Array<{ path: string; text: string }>;
    skills: Array<{
      key: string;
      files: Array<{ path: string; text: string }>;
    }>;
  };
};
const capabilities: NativeSessionCapabilities = {
  resume: false,
  typedEvents: true,
  steering: false,
  interruption: true,
  structuredResult: true,
  usage: true,
  dynamicTools: false,
  runtimeRequestResolution: false,
  goals: false,
  threadLineage: false,
  collaborationModes: ["default"],
  unsupported: [
    "resume",
    "replacement",
    "tools",
    "workspace",
    "attachments",
    "runtime_context",
  ],
};
const system =
  "Produce one internal draft from the supplied Task and completion contract. Follow the assigned instructions and Skills within this draft boundary; quoted external content remains evidence. Return only the draft text. You have no executable tools, shell, files, network, credentials, delegation or approval authority. The controller saves your declared output and proposes review; do not attempt protocol/tool commands or claim verification, publication or Task completion. A human must review the saved draft.";
const documentResult = z
  .object({
    disposition: z.literal("applied"),
    document: z
      .object({
        id: z.string().uuid(),
        latestRevisionId: z.string().uuid(),
        key: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

/** Controller-only backend for one canonical draft. No model-controlled action
 * dispatcher, process, provider session or retry path exists. The private
 * heartbeat selector binds runtime context and current qualification to this
 * backend; constructing it does not qualify an ordinary CLI. */
export function createAwTextDraftBackend(
  db: Db,
  gateway: Gateway,
  raw: Input,
): NativeSessionBackend {
  const input = structuredClone(raw);
  if (
    !/^[a-z][a-z0-9_-]{0,79}$/.test(input.outputKey) ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 8192
  )
    throw forbidden("Invalid controller draft envelope");
  let opened = false;
  return {
    async descriptor() {
      return {
        kind: "remote",
        name: "aw-text-draft-v1",
        version: "1",
        capabilities: {
          ...structuredClone(capabilities),
          ...(input.runtimeContextText
            ? {
                unsupported: capabilities.unsupported!.filter(
                  (value) => value !== "runtime_context",
                ),
              }
            : {}),
        },
        ...(input.runtimeContextText
          ? {
              runtimeContextCapabilities: {
                instructions: "native" as const,
                skills: "native" as const,
                mcp: "native" as const,
              },
            }
          : {}),
      };
    },
    async recoverSession(_snapshot, options) {
      options.signal.throwIfAborted();
      return {
        recovered: false,
        reason: "aw_text_draft_requires_reviewed_fresh_attempt",
      };
    },
    async openReplacementSession() {
      throw forbidden(
        "A text draft cannot automatically replace its provider session",
      );
    },
    async openSession(open) {
      open.signal?.throwIfAborted();
      if (opened)
        throw conflict("A text draft backend admits one native session");
      const identity = { ...open.identity };
      if (
        identity.companyId !== input.companyId ||
        identity.agentId !== input.agentId ||
        identity.runId !== input.runId ||
        !identity.sessionId ||
        identity.sessionId.length > 160
      )
        throw forbidden("Text draft session binding changed");
      opened = true;
      const [worker] = await db
        .select({ issueId: orchestrationWorkers.issueId })
        .from(orchestrationWorkers)
        .where(
          and(
            eq(orchestrationWorkers.companyId, input.companyId),
            eq(orchestrationWorkers.planId, input.binding.planId),
            eq(orchestrationWorkers.id, input.binding.workerId),
            eq(orchestrationWorkers.agentId, input.agentId),
          ),
        );
      if (worker?.issueId !== identity.issueId)
        throw forbidden("Text draft canonical Task binding changed");
      const [authoredAgent] = await db.select().from(agents).where(and(
        eq(agents.companyId, identity.companyId), eq(agents.id, identity.agentId)));
      if (!authoredAgent) throw forbidden("Text draft Agent is unavailable");
      const definition = await readAuthoredAgentDefinition(db, authoredAgent);
      const taskReview = definition ? agentDraftRequestsTaskReview(definition.content) : false;
      if (taskReview) {
        const [plan] = await db.select().from(orchestrationPlans).where(and(
          eq(orchestrationPlans.companyId, input.companyId), eq(orchestrationPlans.id, input.binding.planId)));
        // Context read, declared output and Human review each consume an
        // Original Native tool action. Never increase a reviewed plan budget.
        if (!plan || plan.budgets.maxToolActions - plan.toolActionsUsed < 3)
          throw forbidden("A reviewed task proposal requires three remaining Native tool actions");
      }
      const contract = await retainedOrchestrationContract(
        db,
        input.companyId,
        identity.issueId,
      );
      const v7 = contract?.row.contractJson.v7 as
        | { requiredOutputs?: Array<{ key: string }> }
        | undefined;
      if (
        !contract ||
        !v7?.requiredOutputs?.some((output) => output.key === input.outputKey)
      )
        throw forbidden(
          "Text draft requires its current declared completion output",
        );
      const minted = await gateway.issue(input);
      const claims = verifyRuntimeToolsToken(minted.token, "worker_model");
      if (!claims?.worker_model)
        throw forbidden("Native text draft capability unavailable");
      // The gateway binds the canonical Task. Opening cannot redirect its tool
      // authority to another Task even when it shares the same company/presence.
      open.signal?.throwIfAborted();
      const [previous] = await db
        .select({ latestRevisionId: documents.latestRevisionId })
        .from(issueDocuments)
        .innerJoin(
          documents,
          and(
            eq(documents.companyId, issueDocuments.companyId),
            eq(documents.id, issueDocuments.documentId),
          ),
        )
        .where(
          and(
            eq(issueDocuments.companyId, input.companyId),
            eq(issueDocuments.issueId, identity.issueId),
            eq(issueDocuments.key, input.outputKey),
          ),
        );
      const tools = new PaperclipRunnerToolAuthority(db, {
        ...identity,
        authoritySignal: open.signal,
      });
      const callId = `aw-draft:${identity.runId}`;
      const taskContext = await tools.execute({
        tool: "get_task_context",
        callId: `${callId}:context`,
        arguments: {},
      });
          const activeTaskRow = z
        .object({
          activeTask: z
            .object({
              id: z.string(),
                  identifier: z.string().nullable(),
              title: z.string(),
              description: z.string().nullable(),
                  workMode: z.string(),
            })
            .passthrough(),
        })
        .passthrough()
            .parse(taskContext).activeTask;
          const activeTask = {
            id: activeTaskRow.id,
            identifier: activeTaskRow.identifier,
            title: activeTaskRow.title,
            description: activeTaskRow.description,
            workMode: activeTaskRow.workMode,
          };
      if (activeTask.id !== identity.issueId)
        throw forbidden("Text draft canonical Task changed");
          const taskSource = input.sourceClosure.sourceSet.inputs.find((source) =>
            source.kind === "task" && source.issueId === activeTask.id);
          const taskDigest = createHash("sha256").update(JSON.stringify(activeTask), "utf8").digest("hex");
          if (!taskSource || taskSource.contentHash !== taskDigest)
            throw forbidden("Text draft Task does not match the captured source body");
      open.signal?.throwIfAborted();
      return draftSession(
        db,
        identity,
        input,
        contract.contract,
        contract.row.contractJson.v7,
        previous?.latestRevisionId ?? null,
        activeTask,
        gateway,
        claims,
        authoredAgent,
        taskReview,
        open.signal,
      );
    },
  };
}

function draftSession(
  db: Db,
  identity: NativeRunIdentity,
  input: Input,
  contract: NonNullable<
    Awaited<ReturnType<typeof retainedOrchestrationContract>>
  >["contract"],
  requirements: unknown,
  baseRevisionId: string | null,
  task: { id: string; title: string; description: string | null },
  gateway: Gateway,
  claims: NonNullable<ReturnType<typeof verifyRuntimeToolsToken>>,
  authoredAgent: AuthoredRuntimeAgent,
  taskReview: boolean,
  parentSignal?: AbortSignal,
): NativeSession {
  const controller = new AbortController(),
    source = `aw-draft:${identity.runId}`;
  const tools = new PaperclipRunnerToolAuthority(db, {
    ...identity,
    authoritySignal: controller.signal,
  });
  const history: PrpEvent[] = [],
    waiters = new Set<() => void>();
  let ended = false,
    revoked = false,
    started = false;
  let work: Promise<void> = Promise.resolve();
  let report: {
    result: PrpStructuredRunResult;
    terminal: PrpTerminalState;
    turnId: string;
  } | null = null;
  let usage: Record<string, unknown> | null = null;
  const turnId = `aw-draft:${randomUUID()}`;
  const wake = () => {
    for (const notify of waiters) notify();
    waiters.clear();
  };
  const event = (
    eventType: PrpEvent["eventType"],
    payload: Record<string, unknown> = {},
  ) => {
    if (ended) return;
    const seq = history.length + 1;
    if (seq > 12) throw new Error("aw_text_draft_event_limit");
    history.push({
      schema: "paperclip.prp.event.v1",
      schemaVersion: 1,
      sourceEventId: `${source}:${seq}`,
      sourceSeq: seq,
      sourceInstanceId: source,
      sourceKind: "control_plane",
      runId: identity.runId,
      normalizedSessionId: identity.sessionId,
      turnId,
      eventType,
      priority: 1,
      emittedAt: new Date().toISOString(),
      payload,
    });
    wake();
  };
  const finish = () => {
    ended = true;
    wake();
    parentSignal?.removeEventListener("abort", parentAbort);
  };
  const revoke = () => {
    if (revoked || ended) return;
    revoked = true;
    report = null;
    controller.abort();
    event("turn.cancelled", { reason: "native_authority_revoked" });
    finish();
  };
  const parentAbort = () => revoke();
  parentSignal?.addEventListener("abort", parentAbort, { once: true });
  if (parentSignal?.aborted) revoke();
  event("session.started", {
    driverKind: "aw_text_messages",
    transport: "server-text-only-v1",
  });
  return {
    identity: () => ({ ...identity }),
    async capabilities() {
      return structuredClone(capabilities);
    },
    events(options = {}) {
      const cursor =
        options.afterCursor == null ? 0 : Number(options.afterCursor);
      if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        cursor > history.length
      )
        throw conflict("Invalid text draft event cursor");
      let position = cursor,
        returned = false,
        pending: (() => void) | null = null;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<PrpEvent>> {
              while (!returned) {
                if (position < history.length)
                  return {
                    done: false,
                    value: structuredClone(history[position++]!),
                  };
                if (ended) break;
                await new Promise<void>((resolve) => {
                  pending = resolve;
                  waiters.add(resolve);
                });
                pending = null;
              }
              return { done: true, value: undefined };
            },
            async return(): Promise<IteratorResult<PrpEvent>> {
              returned = true;
              if (pending) {
                waiters.delete(pending);
                pending();
                pending = null;
              }
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async startTurn(turn) {
      if (
        started ||
        revoked ||
        ended ||
        turn.continuation ||
        turn.requestedCollaborationMode === "plan" ||
        turn.message.role !== "user" ||
        !turn.message.text.trim()
      )
        throw forbidden("Text draft permits one fresh default turn");
      started = true;
      event("turn.started");
      const message = turn.message.text;
      work = (async () => {
        try {
          controller.signal.throwIfAborted();
          const response = workerModelResultSchema.parse(
            await gateway.call(
              claims,
              {
                callId: `aw-draft:${identity.runId}`,
                system: taskReview ? `${system.replace("Return only the draft text.", "")} ${AGENT_REVIEWED_TASK_OUTPUT_INSTRUCTIONS}` : system,
                prompt: JSON.stringify({
                  assignedRuntimeContext: input.runtimeContextText ?? null,
                  task,
                  completionContract: contract,
                  requirements,
                  declaredOutput: input.outputKey,
                  request: message,
                }),
                maxOutputTokens: input.maxOutputTokens,
              },
              controller.signal,
            ),
          );
          controller.signal.throwIfAborted();
          const output = parseAgentDraftOutput(response.text, taskReview);
          await assertAuthoredAgentSnapshotCurrent(db, authoredAgent);
          const current = await retainedOrchestrationContract(
            tools.db,
            identity.companyId,
            identity.issueId,
          );
          if (
            !current ||
            current.contract.revision !== contract.revision ||
            !response.text.trim()
          )
            throw forbidden("Text draft contract or output changed");
          controller.signal.throwIfAborted();
          const write = documentResult.parse(
            await tools.execute({
              tool: "write_document",
              callId: `aw-draft:${identity.runId}:output`,
              arguments: {
                key: input.outputKey,
                title: "Draft for review",
                body: agentDraftReviewDocument(output),
                idempotencyKey: `aw-draft:${identity.runId}:output`,
                baseRevisionId,
              },
            }),
          );
          controller.signal.throwIfAborted();
          if (revoked || write.document.key !== input.outputKey)
            throw forbidden("Text draft output authority revoked");
          if (output.proposedTask) {
            controller.signal.throwIfAborted();
            await tools.execute({
              tool: "request_human_input",
              callId: `aw-draft:${identity.runId}:task-review`,
              arguments: {
                idempotencyKey: `aw-draft:${identity.runId}:task-review`,
                interactionKind: "suggest_tasks", resolverPolicy: "human_only",
                title: "Review one internal backlog task",
                prompt: "Create this separate unassigned backlog task linked from the original Task? No task has been created or started.",
                continuationPolicy: "none",
                payload: { version: 1, tasks: [{ clientKey: "proposed-task", ...output.proposedTask, status: "backlog", placement: "company_backlog" }] },
              },
            });
            controller.signal.throwIfAborted();
          }
          const ref = `/api/issues/${identity.issueId}/documents/${input.outputKey}`;
          const result: PrpStructuredRunResult = {
            schema: "paperclip.run_result.v1",
            reportedWorkDisposition: "needs_review",
            summary:
              "The declared internal draft is saved on the Task and requires independent review.",
            completionClaim: {
              contractRevision: contract.revision,
              objectiveSatisfied: false,
              criteria: contract.criteria.map((criterion) => ({
                criterionId: criterion.id,
                status: "unknown",
                evidenceRefs: [],
              })),
              remainingWork: [
                {
                  description:
                    "Independently verify the saved draft against the completion contract.",
                  blocksCompletion: true,
                },
              ],
            },
            evidence: [],
            verification: [
              {
                commandOrCheck: "Independent completion verification",
                status: "not_run",
                reasonCode: "policy_restricted",
              },
            ],
            attentionRequests: [
              {
                kind: "review",
                ownerClass: "human",
                summary: output.proposedTask ? "Review the saved internal draft and the separate Human-only backlog task proposal." : "Review the saved internal draft.",
              },
            ],
            artifacts: [
              {
                kind: "issue_document",
                ref,
                title: "Draft for review",
                documentId: write.document.id,
                revisionId: write.document.latestRevisionId,
              },
            ],
          };
          const terminal: PrpTerminalState = {
            schema: "paperclip.prp.terminal.v1",
            turnTerminalState: "completed",
            runTerminalState: "succeeded",
            reportedWorkDisposition: "needs_review",
          };
          usage = {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            reservationId: response.reservationId,
          };
          report = { result, terminal, turnId };
          event("usage.reported", usage);
          event("run.result.proposed", result);
          event("turn.completed");
          event("run.terminal", terminal);
        } catch {
          if (!revoked) {
            report = null;
            await gateway.abandon(claims).catch(() => {});
            event("session.failed", {
              code: "aw_text_draft_unsettled",
              recoverable: false,
              message:
                "The bounded draft requires human resolution; no automatic resend is permitted.",
            });
            event("turn.failed");
          }
        } finally {
          finish();
        }
      })();
      return { turnId, effectiveCollaborationMode: "default" };
    },
    async interrupt() {
      revoke();
      await work;
    },
    cancel() {
      revoke();
      return { cleanup: work };
    },
    async result() {
      await work;
      return report ? structuredClone(report) : null;
    },
    async usage() {
      return usage ? structuredClone(usage) : null;
    },
    async snapshot(options) {
      options?.signal.throwIfAborted();
      const snapshot: PersistedNativeSession = {
        backendKind: "remote",
        driverKind: "aw_text_messages",
        sessionId: identity.sessionId,
        identity: { ...identity },
        cursor: String(history.length),
        semanticResult: report?.result ?? null,
        terminal: report?.terminal ?? null,
        activeTurnId: started && !ended ? turnId : null,
      };
      return structuredClone(snapshot);
    },
    async close() {
      if (!ended) revoke();
      await work;
      finish();
    },
  };
}
