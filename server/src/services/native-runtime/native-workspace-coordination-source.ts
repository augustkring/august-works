import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, asc, eq, inArray, is } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { heartbeatRuns, issues, projectWorkspaces, workspaceOperations, type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { authorizationService, canActorReadIssuePrivacy, type AuthorizationActor } from "../authorization.js";
import { workspaceOperationService, NATIVE_WORKSPACE_COORDINATION_PRIVATE_KEY } from "../workspace-operations.js";
import { nativeSha256 } from "./canonical.js";
import type { NativeRenderedSourceReference } from "./native-execution-input.js";

export type WorkspaceCoordinationTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type WorkspaceCoordinationReadDb = Db | WorkspaceCoordinationTransaction;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const observationSchema = z.object({ schema: z.literal("paperclip.native.workspace-coordination.v1"),
  companyId: z.string().uuid(), runId: z.string().uuid(), agentId: z.string().uuid(), issueId: z.string().uuid(),
  responsibleUserId: z.string(), projectId: z.string().uuid(), projectWorkspaceId: z.string().uuid(),
  holderRunId: z.string().uuid(), holderAgentId: z.string().uuid(), holderIssueId: z.string().uuid(),
  holderIdentifier: z.string().nullable(), observedAt: z.string().datetime(), activityAt: z.string().datetime(),
  appendixHash: digest }).strict();
const captureSchema = z.object({ operationId: z.string().uuid(), observation: observationSchema,
  observationDigest: digest }).strict();
export type NativeWorkspaceCoordinationCapture = z.infer<typeof captureSchema>;
export type NativeWorkspaceHolder = { runId: string; agentId: string; issueId: string; issueIdentifier: string | null };
type Consumer = { companyId: string; runId: string; agentId: string; issueId: string };
const hashText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** The one existing scheduling instruction. Never render a holder title/body. */
export function formatNativeWorkspaceCoordination(holder: NativeWorkspaceHolder): string {
  return `shared workspace is concurrently held by run ${holder.runId} (issue ${holder.issueIdentifier ?? holder.issueId}); ` +
    "expect concurrent mutations, coordinate via commits";
}
export function exactNativeWorkspaceCoordination(value: unknown, consumer: Omit<Consumer, "agentId"> & { agentId?: string | null }): NativeWorkspaceCoordinationCapture | null {
  const parsed = captureSchema.safeParse(value);
  if (!parsed.success) return null;
  const capture = parsed.data, observation = capture.observation;
  return observation.companyId === consumer.companyId && observation.runId === consumer.runId &&
    observation.agentId === consumer.agentId && observation.issueId === consumer.issueId &&
    observation.holderRunId !== observation.runId && observation.holderIssueId !== observation.issueId &&
    capture.observationDigest === nativeSha256(observation) && observation.appendixHash === hashText(formatNativeWorkspaceCoordination({
      runId: observation.holderRunId, agentId: observation.holderAgentId, issueId: observation.holderIssueId,
      issueIdentifier: observation.holderIdentifier })) ? capture : null;
}
export function composeNativeWorkspaceCoordinationMap(input: Consumer & { capture: unknown;
  baseMap: { version: 1; renderedMarkdownDigest: string; renderedMarkdownLength: number; references: NativeRenderedSourceReference[] } | null;
  renderedMarkdown: string }) {
  const capture = exactNativeWorkspaceCoordination(input.capture, input);
  if (!capture || !input.baseMap) return null;
  const observation = capture.observation;
  const appendix = formatNativeWorkspaceCoordination({ runId: observation.holderRunId, agentId: observation.holderAgentId,
    issueId: observation.holderIssueId, issueIdentifier: observation.holderIdentifier });
  const suffix = `\n${appendix}`;
  if (!input.renderedMarkdown.endsWith(suffix)) return null;
  const base = input.renderedMarkdown.slice(0, -suffix.length);
  if (base.length !== input.baseMap.renderedMarkdownLength || hashText(base) !== input.baseMap.renderedMarkdownDigest) return null;
  return { ...input.baseMap, renderedMarkdownDigest: hashText(input.renderedMarkdown),
    renderedMarkdownLength: input.renderedMarkdown.length };
}

async function lockCoordinationPrivacy(tx: WorkspaceCoordinationTransaction, companyId: string) {
  const { lockIssuePrivacyTree } = await import("../issues.js");
  await lockIssuePrivacyTree(tx, companyId, "read");
}
function isCoordinationTransaction(db: WorkspaceCoordinationReadDb): db is WorkspaceCoordinationTransaction {
  return is(db, PgTransaction);
}
async function readStableTuple(db: WorkspaceCoordinationTransaction, observation: z.infer<typeof observationSchema>, reader?: AuthorizationActor) {
  // Company privacy precedes these row locks. Keep canonical Task -> Run order,
  // and deterministic ID order inside each family, including recurring reads.
  const tasks = await db.select().from(issues).where(and(eq(issues.companyId, observation.companyId),
    inArray(issues.id, [observation.issueId, observation.holderIssueId].sort()))).orderBy(asc(issues.id)).for("share");
  const task = tasks.find(row => row.id === observation.issueId), holderTask = tasks.find(row => row.id === observation.holderIssueId);
  const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, observation.companyId),
    inArray(heartbeatRuns.id, [observation.runId, observation.holderRunId].sort()))).orderBy(asc(heartbeatRuns.id)).for("share");
  const run = runs.find(row => row.id === observation.runId), holderRun = runs.find(row => row.id === observation.holderRunId);
  const [workspace] = await db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, observation.companyId),
    eq(projectWorkspaces.id, observation.projectWorkspaceId))).for("share");
  if (!run || !task || !holderRun || !holderTask || !workspace || run.agentId !== observation.agentId ||
    run.responsibleUserId !== observation.responsibleUserId || object(run.contextSnapshot).issueId !== task.id ||
    task.projectId !== observation.projectId || task.projectWorkspaceId !== workspace.id || workspace.projectId !== observation.projectId ||
    holderRun.agentId !== observation.holderAgentId || object(holderRun.contextSnapshot).issueId !== holderTask.id ||
    holderTask.projectId !== observation.projectId || holderTask.projectWorkspaceId !== workspace.id ||
    holderTask.identifier !== observation.holderIdentifier || task.hiddenAt || holderTask.hiddenAt)
    throw forbidden("Native workspace coordination owners changed");
  const human: AuthorizationActor = { type: "board", source: "session", userId: observation.responsibleUserId };
  const agent: AuthorizationActor = { type: "agent", source: "agent_jwt", agentId: observation.agentId, companyId: observation.companyId,
    runId: observation.runId, onBehalfOfUserId: observation.responsibleUserId };
  for (const actor of [human, agent, ...(reader ? [reader] : [])]) for (const target of [task, holderTask]) {
    const decision = await authorizationService(db).decide({ actor, action: "issue:read",
      resource: { type: "issue", companyId: observation.companyId, issueId: target.id, projectId: target.projectId },
      enforceResponsibleUserIntersection: true });
    if (!decision.allowed || !await canActorReadIssuePrivacy(db, actor, target))
      throw forbidden("Native workspace coordination Task reader changed");
  }
  return { run, task, holderRun, holderTask, workspace };
}

/** Only the real busy producer supplies the original selector, under the same
 * initial predicate and locks. No HTTP body can call this recorder. */
export async function recordNativeWorkspaceCoordination(db: Db, input: Consumer & { projectWorkspaceId: string;
  expectedHolder: NativeWorkspaceHolder;
  selectCurrentHolder: (tx: WorkspaceCoordinationTransaction, observedAt: Date) => Promise<NativeWorkspaceHolder | null>;
}): Promise<NativeWorkspaceCoordinationCapture> {
  return db.transaction(async tx => {
    await lockCoordinationPrivacy(tx, input.companyId);
    // These first snapshot reads take no row locks. The actual owner rows are
    // then locked in canonical order, before the original selector is re-run.
    const selected = input.expectedHolder;
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.runId)));
    const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)));
    const [holder] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, selected.runId)));
    if (!run || run.status !== "running" || !run.responsibleUserId || !task?.projectId || !holder)
      throw forbidden("Native workspace coordination admission unavailable");
    let observation = observationSchema.parse({ schema: "paperclip.native.workspace-coordination.v1",
      companyId: input.companyId, runId: input.runId, agentId: input.agentId, issueId: input.issueId,
      responsibleUserId: run.responsibleUserId, projectId: task.projectId, projectWorkspaceId: input.projectWorkspaceId,
      holderRunId: selected.runId, holderAgentId: selected.agentId, holderIssueId: selected.issueId,
      holderIdentifier: selected.issueIdentifier, observedAt: new Date().toISOString(),
      activityAt: (holder.lastOutputAt ?? holder.startedAt ?? holder.createdAt).toISOString(),
      appendixHash: hashText(formatNativeWorkspaceCoordination(selected)) });
    const stable = await readStableTuple(tx, observation);
    const observedAt = new Date(), current = await input.selectCurrentHolder(tx, observedAt);
    if (stable.run.status !== "running" || !current || !isDeepStrictEqual(current, selected))
      throw forbidden("Native workspace coordination selection changed");
    observation = { ...observation, observedAt: observedAt.toISOString(),
      activityAt: (stable.holderRun.lastOutputAt ?? stable.holderRun.startedAt ?? stable.holderRun.createdAt).toISOString() };
    const operation = await workspaceOperationService(tx).createRecorder({ companyId: input.companyId,
      heartbeatRunId: input.runId, issueId: input.issueId }).recordOperation({ phase: "workspace_config_freshness",
      metadata: { [NATIVE_WORKSPACE_COORDINATION_PRIVATE_KEY]: observation }, run: async () => ({ status: "succeeded" }) });
    return { operationId: operation.id, observation, observationDigest: nativeSha256(observation) };
  });
}

/** An immutable admission observation, not a requirement that the holder must
 * remain running. All current stable owners and privacy are still required. */
export async function readNativeWorkspaceCoordination(db: WorkspaceCoordinationReadDb, input: Consumer & {
  capture: unknown; reader: AuthorizationActor }): Promise<NativeWorkspaceCoordinationCapture> {
  return isCoordinationTransaction(db) ? readCoordinationInTransaction(db, input)
    : db.transaction(tx => readCoordinationInTransaction(tx, input));
}
async function readCoordinationInTransaction(db: WorkspaceCoordinationTransaction, input: Consumer & {
  capture: unknown; reader: AuthorizationActor }): Promise<NativeWorkspaceCoordinationCapture> {
  const capture = exactNativeWorkspaceCoordination(input.capture, input);
  if (!capture) throw forbidden("Native workspace coordination capture invalid");
  await lockCoordinationPrivacy(db, input.companyId);
  await readStableTuple(db, capture.observation, input.reader);
  const [operation] = await db.select().from(workspaceOperations).where(and(eq(workspaceOperations.companyId, input.companyId),
    eq(workspaceOperations.heartbeatRunId, input.runId), eq(workspaceOperations.issueId, input.issueId),
    eq(workspaceOperations.id, capture.operationId))).for("share");
  const original = observationSchema.safeParse(object(operation?.metadata)[NATIVE_WORKSPACE_COORDINATION_PRIVATE_KEY]);
  if (!operation || operation.phase !== "workspace_config_freshness" || operation.status !== "succeeded" ||
    !operation.finishedAt || operation.command !== null || operation.cwd !== null || !original.success ||
    !isDeepStrictEqual(original.data, capture.observation) || nativeSha256(original.data) !== capture.observationDigest ||
    Date.parse(original.data.observedAt) > operation.startedAt.getTime())
    throw forbidden("Native workspace coordination observation unavailable");
  return capture;
}
