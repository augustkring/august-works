import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { activityLog, companyMemberships, heartbeatRuns, projectWorkspaces, projects, type Db } from "@paperclipai/db";
import { nativePayloadSourceInputSchema, nativePayloadSourcePolicySchema, nativePayloadSourceSnapshotSchema, type NativePayloadSourceInput,
  type NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { conflict, forbidden, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { canActorReadProjectPrivacy } from "./authorization.js";
import { assertNativeManagedConsumedSourceSetCurrent, assertNativeModelOutputCaptureCurrent,
  assertNativeProjectSourceCurrent } from "./native-direct-input.js";
import { publicNativePayloadRow } from "./native-payload-public.js";
import { persistActivity, publishActivity } from "./activity-log.js";
import { lockIssuePrivacyTree } from "./issues.js";
import { ensureProjectAccessMember, pinProjectMutationHuman, projectService } from "./projects.js";
import { normalizeProjectRepositoryUrl } from "./project-repositories.js";
import { projectToolContext } from "./project-tool-context.js";
import type { NativeModelOutputCapture, NativePayloadSourceSet } from "./native-runtime/native-execution-input.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { resolveManagedProjectWorkspaceDir } from "../home-paths.js";
import { toolAccessService } from "./tool-access.js";
import { resolveProjectRepositorySelection } from "./project-repositories.js";
import type { NativeToolEffectClaim } from "../agent-auth-jwt.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ProjectSource = Extract<NativePayloadSourceInput, { kind: "project" }>;
type WorkspaceSource = Extract<NativePayloadSourceInput, { kind: "project_workspace" }>;
const nativePayloadSourceSetSchema = z.object({ policy: nativePayloadSourcePolicySchema,
  inputs: nativePayloadSourceInputSchema.array() }).strict();
export const managedNativeProjectArgumentsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4_000).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(255),
  // The owner creates a local primary Workspace named after the Project when
  // the caller selects repositories instead of an explicit Workspace.
  workspace: z.object({ name: z.string().trim().min(1).max(200) }).strict().optional(),
  repositoryIds: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
  repositoryUrls: z.array(z.string().url().max(2_000)).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.workspace && (value.repositoryIds?.length || value.repositoryUrls?.length))
    ctx.addIssue({ code: "custom", path: ["workspace"], message: "Workspace cannot be combined with repository selections" });
});
export type ManagedNativeProjectArguments = z.infer<typeof managedNativeProjectArgumentsSchema>;
export function managedNativeProjectArgumentsJsonSchema() {
  return z.toJSONSchema(managedNativeProjectArgumentsSchema);
}
export const managedNativeProjectApiBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4_000).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(255),
  repositoryIds: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
  repositoryUrls: z.array(z.string().url().max(2_000)).max(100).optional(),
  workspace: z.object({ name: z.string().trim().min(1).max(200) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.workspace && (value.repositoryIds?.length || value.repositoryUrls?.length))
    ctx.addIssue({ code: "custom", path: ["workspace"], message: "Workspace cannot be combined with repository selections" });
});
export function managedNativeProjectApiBodyJsonSchema() {
  const schema = z.toJSONSchema(managedNativeProjectApiBodySchema) as Record<string, unknown>;
  // `$schema` is meaningful only at a JSON Schema document root; this schema
  // is embedded as the `body` property of the runner API tool input.
  delete schema.$schema;
  return schema;
}
export const managedNativeProjectApiCallSchema = z.object({
  operationId: z.literal("POST /api/companies/{companyId}/projects"),
  pathParams: z.object({ companyId: z.string().uuid() }).strict(),
  body: managedNativeProjectApiBodySchema,
}).strict();

/** Resolve the server-owned, per-dispatch API capture after auth middleware
 * consumed its exact signed POST claim. No route or request body can mint it. */
export async function consumeManagedNativeProjectApiCapture(db: Db, input: {
  actor: AuthorizationActor;
  claim: NativeToolEffectClaim;
  companyId: string;
  issueId: string;
  rawBody: unknown;
}): Promise<{ capture: NativeModelOutputCapture; body: z.infer<typeof managedNativeProjectApiBodySchema> } | null> {
  const { actor, claim, companyId, issueId } = input;
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId ||
    actor.agentId === undefined || !actor.runId || claim.tool !== "call_api" ||
    claim.operationId !== "POST /api/companies/{companyId}/projects" || claim.method !== "POST" ||
    claim.pathAndQuery !== `/api/companies/${companyId}/projects`)
    throw forbidden("Managed Project API capture does not match the consumed POST claim");
  const callKey = createHash("sha256").update(claim.callId, "utf8").digest("hex");
  return db.transaction(async tx => {
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
      eq(heartbeatRuns.id, actor.runId!), eq(heartbeatRuns.agentId, actor.agentId!),
      eq(heartbeatRuns.nativeIssueId, issueId), eq(heartbeatRuns.status, "running"))).for("update");
    const resultJson = record(run?.resultJson);
    const apiReceipts = record(resultJson.apiToolReceipts);
    const apiReceipt = record(apiReceipts[callKey]);
    const captures = record(resultJson.nativeManagedProjectApiCaptures);
    if (!Object.hasOwn(captures, callKey)) return null;
    const entry = record(captures[callKey]);
    const capture = entry.capture as NativeModelOutputCapture | undefined;
    const use = capture?.managedOpenCodeToolUse;
    const associations = record(run?.runnerProfileJson).nativeToolCallDispatchAssociations;
    const matching = Array.isArray(associations) ? associations.map(record).filter(value => value.callId === claim.callId &&
      value.turnId === claim.turnId && value.tool === "call_api" && value.dispatchId === claim.dispatchId &&
      value.eventSeq === claim.eventSeq && value.attempt === claim.attempt && value.argumentsHash === use?.argumentsHash) : [];
    if (!run || run.responsibleUserId !== actor.onBehalfOfUserId || apiReceipt.digest !== claim.apiReceiptDigest ||
      apiReceipt.operationId !== claim.operationId || apiReceipt.state !== "pending" ||
      apiReceipt.nativeEffectClaimConsumed !== true || apiReceipt.callId !== claim.callId ||
      apiReceipt.turnId !== claim.turnId || apiReceipt.dispatchId !== claim.dispatchId ||
      apiReceipt.eventSeq !== claim.eventSeq || apiReceipt.attempt !== claim.attempt ||
      apiReceipt.method !== claim.method || apiReceipt.pathAndQuery !== claim.pathAndQuery ||
      apiReceipt.bodyHash !== claim.bodyHash || use?.toolName !== "call_api" || use.callId !== claim.callId ||
      !capture || capture.runId !== run.id || matching.length !== 1 ||
      entry.apiReceiptDigest !== claim.apiReceiptDigest || entry.operationId !== claim.operationId)
      throw forbidden("Managed Project API capture is stale or unavailable");
    const parsedBody = managedNativeProjectApiBodySchema.safeParse(input.rawBody);
    if (!parsedBody.success) throw unprocessable("Managed Project API body is invalid");
    delete captures[callKey];
    await tx.update(heartbeatRuns).set({ resultJson: { ...resultJson, nativeManagedProjectApiCaptures: captures } })
      .where(eq(heartbeatRuns.id, run.id));
    return { capture, body: parsedBody.data };
  });
}


export type NativeProjectRepositoryAuthorizationWitness = {
  repositoryId: string;
  connectionId: string;
  grantId: string | null;
  authorizationVersion: string;
};

/** Exact safe result and server-side authorization witnesses for one managed
 * repository-discovery tool call. Credential values and secret payloads never
 * enter this capture or the provider result. */
export type NativeProjectRepositoriesToolResultCapture = {
  callId: string;
  turnId: string;
  argumentsHash: string;
  resultDigest: string;
  responsibleUserId: string;
  /** Canonical safe DTO retained so historical source validation can rederive this read. */
  result: { repositories: import("@paperclipai/shared").ProjectRepository[];
    connectionCount: number; failedConnectionCount: number };
  repositoryAuthorizationWitnesses: NativeProjectRepositoryAuthorizationWitness[];
};

const managedProjectRepositoryListingSchema = z.object({}).strict();
export const managedNativeProjectRepositoriesResultSchema = z.object({
  repositories: z.array(z.object({
    id: z.string().regex(/^\d+$/),
    fullName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/),
    url: z.string().url(),
    private: z.boolean().optional(),
    connections: z.array(z.string().trim().min(1).max(200)).max(100),
  }).strict().refine(repository => repository.url === `https://github.com/${repository.fullName}`)).max(500),
  connectionCount: z.number().int().min(0).max(5000),
  failedConnectionCount: z.number().int().min(0).max(5000),
}).strict();
function publicManagedProjectRepositoryListing(available: {
  repositories: import("@paperclipai/shared").ProjectRepository[];
  connectionCount: number;
  failedConnectionCount: number;
}) {
  return { repositories: available.repositories.map(repository => ({ ...repository,
    connections: [...repository.connections].sort() })), connectionCount: available.connectionCount,
    failedConnectionCount: available.failedConnectionCount };
}

export async function listManagedNativeProjectRepositories(input: {
  db: Db;
  actor: AuthorizationActor;
  companyId: string;
  callId: string;
  turnId: string;
  arguments: unknown;
}): Promise<{ result: { repositories: import("@paperclipai/shared").ProjectRepository[];
  connectionCount: number; failedConnectionCount: number }; capture: NativeProjectRepositoriesToolResultCapture }> {
  const { db, actor, companyId } = input;
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId ||
    !actor.agentId || !actor.runId || !/^[\x21-\x7e]{1,240}$/.test(input.callId) ||
    !/^[\x21-\x7e]{1,240}$/.test(input.turnId))
    throw forbidden("Repository discovery requires an exact managed Native call");
  managedProjectRepositoryListingSchema.parse(input.arguments);
  const context = await projectToolContext(db, actor as never);
  if (context.run.status !== "running" || context.run.runtimeMode !== "native" || !context.userId || context.localTrusted ||
    actor.onBehalfOfUserId !== context.userId)
    throw forbidden("Repository discovery requires the current accountable Human");
  const available = await toolAccessService(db).listProjectRepositories(companyId, context.userId, false, true);
  const result = managedNativeProjectRepositoriesResultSchema.parse(publicManagedProjectRepositoryListing(available));
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 24 * 1024)
    throw unprocessable("The authorized repository listing exceeds the managed tool result bound");
  const witnesses = Object.values(available.repositoryAuthorizationWitnesses ?? {}).flat();
  const repositoryIds = new Set(result.repositories.map(repository => repository.id));
  if (repositoryIds.size !== result.repositories.length || witnesses.some(witness => !repositoryIds.has(witness.repositoryId)) ||
    result.repositories.some(repository => !witnesses.some(witness => witness.repositoryId === repository.id)) ||
    witnesses.some(witness => !isDeepStrictEqual(Object.keys(witness).sort(),
      ["authorizationVersion", "connectionId", "grantId", "repositoryId"]) ||
      !/^[0-9a-f]{64}$/.test(witness.authorizationVersion)))
    throw forbidden("An authorized repository is missing its exact Human authorization witness");
  const capture: NativeProjectRepositoriesToolResultCapture = {
    callId: input.callId, turnId: input.turnId, argumentsHash: nativeSha256(input.arguments),
    resultDigest: nativeSha256(result), responsibleUserId: context.userId, result,
    repositoryAuthorizationWitnesses: witnesses,
  };
  if (Buffer.byteLength(JSON.stringify(capture), "utf8") > 32 * 1024)
    throw unprocessable("The repository result and authorization witness exceed their managed bound");
  return { result, capture };
}

/** Re-fetch the exact list through current credentials before a managed tool
 * result is sealed, then compare the complete safe result and authority version.
 * The transaction writer performs the final locked membership/grant check. */
export async function revalidateManagedNativeProjectRepositoriesCredentialReach(input: {
  db: Db;
  actor: AuthorizationActor;
  companyId: string;
  result: unknown;
  capture: NativeProjectRepositoriesToolResultCapture;
}): Promise<void> {
  const { db, actor, companyId, capture } = input;
  const context = await projectToolContext(db, actor as never);
  if (context.run.status !== "running" || context.run.runtimeMode !== "native" || !context.userId || context.localTrusted ||
    context.userId !== capture.responsibleUserId || actor.onBehalfOfUserId !== context.userId ||
    capture.resultDigest !== nativeSha256(input.result) || capture.resultDigest !== nativeSha256(capture.result) ||
    !isDeepStrictEqual(capture.result, input.result))
    throw forbidden("The repository listing no longer belongs to the current accountable Human");
  const current = await toolAccessService(db).listProjectRepositories(companyId, context.userId, false, true);
  const currentResult = publicManagedProjectRepositoryListing(current);
  const currentWitnesses = Object.values(current.repositoryAuthorizationWitnesses ?? {}).flat();
  const stable = (values: NativeProjectRepositoryAuthorizationWitness[]) => [...values].sort((a, b) =>
    `${a.repositoryId}:${a.connectionId}:${a.grantId ?? ""}`.localeCompare(`${b.repositoryId}:${b.connectionId}:${b.grantId ?? ""}`));
  if (nativeSha256(currentResult) !== capture.resultDigest || !isDeepStrictEqual(currentResult, input.result) ||
    !isDeepStrictEqual(stable(currentWitnesses), stable(capture.repositoryAuthorizationWitnesses)))
    throw forbidden("Current GitHub repository or credential reach differs from the exact provider result");
}

export async function assertManagedNativeProjectRepositoriesAuthorizationCurrent(db: Db, input: {
  companyId: string;
  runId: string;
  agentId: string;
  issueId: string;
  responsibleUserId: string;
  capture: NativeProjectRepositoriesToolResultCapture;
}): Promise<void> {
  const capturedResult = managedNativeProjectRepositoriesResultSchema.safeParse(input.capture.result);
  const witnessRows = Array.isArray(input.capture.repositoryAuthorizationWitnesses)
    ? input.capture.repositoryAuthorizationWitnesses : [];
  const capturedRepositories = capturedResult.success ? capturedResult.data.repositories : [];
  const capturedRepositoryIds = capturedRepositories.map(repository => repository.id);
  const witnessIds = witnessRows.map(value => value?.repositoryId);
  const witnessIdentities = witnessRows.map(value =>
    `${value?.repositoryId}:${value?.connectionId}:${value?.grantId ?? ""}`);
  if (!Array.isArray(input.capture.repositoryAuthorizationWitnesses) ||
    input.capture.responsibleUserId !== input.responsibleUserId || !capturedResult.success ||
    input.capture.resultDigest !== nativeSha256(input.capture.result) ||
    witnessRows.some(value => !value || typeof value !== "object" || !isDeepStrictEqual(Object.keys(value).sort(),
      ["authorizationVersion", "connectionId", "grantId", "repositoryId"]) ||
      typeof value.repositoryId !== "string" || typeof value.connectionId !== "string" ||
      value.grantId !== null && typeof value.grantId !== "string" ||
      typeof value.authorizationVersion !== "string" || !/^[0-9a-f]{64}$/.test(value.authorizationVersion)) ||
    new Set(capturedRepositoryIds).size !== capturedRepositoryIds.length || new Set(witnessIdentities).size !== witnessIdentities.length ||
    capturedRepositoryIds.some(id => !witnessIds.includes(id)) || witnessIds.some(id => !capturedRepositoryIds.includes(id)))
    throw forbidden("Repository authorization Human, result, or witness changed");
  const [run] = await db.select({ responsibleUserId: heartbeatRuns.responsibleUserId,
    runtimeMode: heartbeatRuns.runtimeMode }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
      eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.nativeIssueId, input.issueId),
      eq(heartbeatRuns.runtimeMode, "native"))).for("update");
  const [membership] = await db.select({ status: companyMemberships.status }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "user"),
    eq(companyMemberships.principalId, input.responsibleUserId), eq(companyMemberships.status, "active"))).for("share");
  if (!run || run.responsibleUserId !== input.responsibleUserId || !membership)
    throw forbidden("Repository discovery requires the current active accountable Human");
  const repositoryIds = [...new Set(input.capture.repositoryAuthorizationWitnesses.map(value => value.repositoryId))];
  await toolAccessService(db).assertProjectRepositoryAuthorizationWitnessesCurrent({
    companyId: input.companyId, userId: input.responsibleUserId, repositoryIds,
    witnesses: input.capture.repositoryAuthorizationWitnesses,
  });
}

export type NativeProjectCreateReceipt = {
  callId: string;
  tool: "create_project" | "call_api";
  argumentsHash: string;
  commandKeyHash: string;
  commandFingerprint: string;
  /** Canonical digest of the returned Project DTO, separate from API and provider envelopes. */
  resultDigest: string;
  projectId: string;
  responsibleUserId: string;
  /** The source closure sealed when the Project was first created. A retry
   * may carry a newer model prefix but must preserve this original closure. */
  projectSourceSet: NativePayloadSourceSet;
  projectSourceSetHash: string;
  sourceSetHash: string;
  projectSource: ProjectSource;
  workspaceSources: WorkspaceSource[];
  sourceSnapshotDigest: string;
};

/** Create the bounded internal Project output of one settled managed Native call.
 * The tool never chooses visibility, owner, source IDs, or a host path. */
export async function createManagedNativeProjectOutput(input: {
  db: Db;
  actor: AuthorizationActor;
  companyId: string;
  issueId: string;
  callId: string;
  tool?: "create_project" | "call_api";
  arguments: Record<string, unknown>;
  capture: NativeModelOutputCapture;
}): Promise<{ project: Record<string, unknown>; receipt: NativeProjectCreateReceipt; sourceSet: NativePayloadSourceSet }> {
  const { db, actor, companyId, issueId, capture } = input;
  const callId = input.callId;
  const outputTool = input.tool ?? "create_project";
  // Bind dedicated-tool retries to exact provider JSON. The API arm instead
  // uses the original call_api hash sealed in its provider capture.
  const directArgumentsHash = nativeSha256(input.arguments);
  const args = outputTool === "create_project"
    ? managedNativeProjectArgumentsSchema.parse(input.arguments)
    : (() => {
        const body = managedNativeProjectApiBodySchema.parse(input.arguments);
        return { ...body, workspace: body.workspace ?? { name: body.name } };
      })();
  const effectiveWorkspace = args.workspace ?? { name: args.name };
  const repositories = new Map<string, { id: string; fullName: string; url: string; metadata: { githubRepositoryId: string } | null }>();
  let repositoryAuthorizationWitnesses: Array<{ repositoryId: string; connectionId: string; grantId: string | null }> = [];
  if (args.repositoryIds?.length) {
    const context = await projectToolContext(db, actor as never, true);
    if (!context.userId || context.localTrusted) throw forbidden("Managed Project repository selection requires the current accountable Human");
    const available = await toolAccessService(db).listProjectRepositories(companyId, context.userId, false, true);
    const selected = resolveProjectRepositorySelection(args.repositoryIds, available.repositories);
    repositoryAuthorizationWitnesses = selected.flatMap(repository =>
      available.repositoryAuthorizationWitnesses?.[repository.id] ?? []);
    if (selected.some(repository => !repositoryAuthorizationWitnesses.some(witness =>
      witness.repositoryId === repository.id)))
      throw forbidden("A selected repository has no accountable Human authorization witness");
    for (const repository of selected) repositories.set(repository.url.toLowerCase(), {
      id: repository.id, fullName: repository.fullName, url: repository.url,
      metadata: { githubRepositoryId: repository.id },
    });
  }
  for (const repositoryUrl of args.repositoryUrls ?? []) {
    const normalized = normalizeProjectRepositoryUrl(repositoryUrl);
    const dedupeKey = normalized.url.toLowerCase();
    if (!repositories.has(dedupeKey)) repositories.set(dedupeKey, { ...normalized, id: normalized.url, metadata: null });
  }
  const normalizedRepositories = [...repositories.values()];
  const use = capture.managedOpenCodeToolUse;
  const argumentsHash = use?.argumentsHash;
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId ||
    !actor.agentId || !actor.runId || capture.runId !== actor.runId || !use || use.callId !== callId ||
    use.toolName !== outputTool || (outputTool === "create_project" && use.argumentsHash !== directArgumentsHash) ||
    typeof argumentsHash !== "string" || !/^[0-9a-f]{64}$/.test(argumentsHash) ||
    !/^[\x21-\x7e]{1,240}$/.test(callId))
    throw forbidden("Managed Project creation requires the exact current provider tool use");

  const sourceSet: NativePayloadSourceSet = { policy: capture.sourceSet.policy, inputs: capture.sourceSet.inputs };
  const sourceSetHash = nativeSha256(sourceSet);
  const callReceiptKey = createHash("sha256").update(callId, "utf8").digest("hex");
  const commandIdempotencyKey = `project:${companyId}:${actor.agentId}:${issueId}:${args.idempotencyKey}`;
  const commandKeyHash = nativeSha256(commandIdempotencyKey);
  const commandFingerprint = nativeSha256({ name: args.name, description: args.description ?? null,
    workspace: effectiveWorkspace, repositories: normalizedRepositories.map(({ id, fullName, url }) => ({ id, fullName, url })) });
  let publication: Awaited<ReturnType<typeof persistActivity>>["publication"] | null = null;
  let result: { project: Record<string, unknown>; receipt: NativeProjectCreateReceipt; sourceSet: NativePayloadSourceSet } | null = null;

  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    // Validate all consumed owner roots before the mutation. The validator pins
    // the source privacy tree and checks the settled response, dispatch, call,
    // arguments and accountable Human through the same transaction.
    await assertNativeModelOutputCaptureCurrent(tx, companyId, issueId, capture, outputTool, actor);
    await lockIssuePrivacyTree(rawTx, companyId);
    const current = await projectToolContext(tx, actor as never, true);
    if (current.issue.id !== issueId || !current.userId || current.localTrusted ||
      (actor.onBehalfOfUserId ?? null) !== current.userId || current.run.status !== "running")
      throw forbidden("Managed Project creation requires the current accountable Human");
    await pinProjectMutationHuman(rawTx, actor, companyId);
    // Share the authenticated Projects API receipt lock so a direct API create
    // and a managed Native retry with the same scoped key cannot race.
    await rawTx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${commandIdempotencyKey},0))`);
    const [run] = await rawTx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.id, capture.runId), eq(heartbeatRuns.companyId, companyId),
      eq(heartbeatRuns.agentId, actor.agentId!), eq(heartbeatRuns.nativeIssueId, issueId),
      eq(heartbeatRuns.status, "running"),
    )).for("update");
    if (!run || run.responsibleUserId !== current.userId) throw forbidden("Managed Project run authority changed");

    // A lock/identity wait may have occurred above. Recheck the complete
    // provider capture and all source owners immediately before creating rows.
    await assertNativeModelOutputCaptureCurrent(tx, companyId, issueId, capture, outputTool, actor);
    if (args.repositoryIds?.length)
      await toolAccessService(tx).assertProjectRepositoryAuthorizationWitnessesCurrent({ companyId,
        userId: current.userId, repositoryIds: args.repositoryIds, witnesses: repositoryAuthorizationWitnesses });
    const resultJson = record(run.resultJson);
    const receipts = record(resultJson.nativeProjectCreateReceipts);
    const existing = record(receipts[callReceiptKey]);
    if (Object.keys(existing).length) {
      if (existing.callId !== callId || existing.tool !== outputTool ||
        existing.argumentsHash !== argumentsHash || existing.sourceSetHash !== sourceSetHash ||
        existing.commandKeyHash !== commandKeyHash || existing.commandFingerprint !== commandFingerprint ||
        typeof existing.projectId !== "string") throw conflict("Managed Project call was replayed with different inputs");
      const project = await projectService(tx).getById(existing.projectId as string);
      if (!project || !(await canActorReadProjectPrivacy(tx, actor, project))) throw forbidden("Managed Project result is unavailable");
      const dto = managedNativeProjectResultDto(project);
      const dtoDigest = nativeSha256(dto);
      if (dtoDigest !== existing.resultDigest) throw conflict("Managed Project result changed after creation");
      const snapshot = nativePayloadSourceSnapshotSchema.safeParse(project.payloadSourceSnapshot);
      const currentProjectSource: ProjectSource = { kind: "project", projectId: project.id,
        sourceVersion: project.updatedAt.toISOString(),
        contentHash: createHash("sha256").update(JSON.stringify(dto), "utf8").digest("hex") };
      if (!snapshot.success || snapshot.data.digest !== existing.sourceSnapshotDigest ||
        !isProjectSource(existing.projectSource) || !isDeepStrictEqual(currentProjectSource, existing.projectSource) ||
        !Array.isArray(existing.workspaceSources) ||
        !isDeepStrictEqual(snapshot.data.inputs.filter((value): value is WorkspaceSource => value.kind === "project_workspace"),
          existing.workspaceSources)) throw conflict("Managed Project source receipt changed");
      await assertNativeProjectSourceCurrent(tx, { companyId, actor, source: existing.projectSource });
      result = { project: dto, receipt: existing as unknown as NativeProjectCreateReceipt, sourceSet };
      return;
    }

    // Provider call IDs change across retries. The explicit command key binds
    // the logical create across those IDs, while the fingerprint prevents a
    // reused key from silently selecting a different Project or source set.
    const [priorActivity] = await rawTx.select({ entityId: activityLog.entityId, details: activityLog.details })
      .from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "project.created"),
        eq(activityLog.entityType, "project"), eq(activityLog.actorType, "agent"), eq(activityLog.actorId, actor.agentId!),
        sql`${activityLog.details}->>'idempotencyKey' = ${commandIdempotencyKey}`)).limit(1);
    if (priorActivity) {
      const priorDetails = record(priorActivity.details);
      if (priorDetails.source !== "managed_native_create_project" ||
        priorDetails.nativeCommandFingerprint !== commandFingerprint)
        throw conflict("Managed Project idempotency key was used with different inputs");
      const project = await projectService(tx).getById(priorActivity.entityId);
      if (!project || !(await canActorReadProjectPrivacy(tx, actor, project))) throw forbidden("Managed Project result is unavailable");
      const dto = managedNativeProjectResultDto(project);
      const snapshot = nativePayloadSourceSnapshotSchema.safeParse(project.payloadSourceSnapshot);
      const projectSource: ProjectSource = { kind: "project", projectId: project.id,
        sourceVersion: project.updatedAt.toISOString(),
        contentHash: createHash("sha256").update(JSON.stringify(dto), "utf8").digest("hex") };
      const workspaceSources = snapshot.success ? snapshot.data.inputs.filter((value): value is WorkspaceSource =>
        value.kind === "project_workspace" && value.projectId === project.id) : [];
      const projectSourceSet: NativePayloadSourceSet | null = snapshot.success ? {
        policy: snapshot.data.policy,
        inputs: snapshot.data.inputs.filter(value => !(value.kind === "project_workspace" && value.projectId === project.id)),
      } : null;
      const originalIssueIds = projectSourceSet ? [...new Set([issueId, ...projectSourceSet.policy.issueIds])].sort() : [];
      const originalProjectIds = projectSourceSet ? [...new Set(projectSourceSet.policy.projectIds)].sort() : [];
      if (!snapshot.success || project.visibility !== "private" || project.privacyOwnerUserId !== current.userId ||
        project.sourceProvenanceQualified !== true || !Array.isArray(project.sourceIssueIds) ||
        !isDeepStrictEqual([...project.sourceIssueIds].sort(), originalIssueIds) ||
        !Array.isArray(project.sourceProjectIds) || !isDeepStrictEqual([...project.sourceProjectIds].sort(), originalProjectIds) ||
        snapshot.data.digest !== priorDetails.sourceSnapshotDigest ||
        !projectSourceSet ||
        !isDeepStrictEqual(snapshot.data.inputs, [...projectSourceSet.inputs, ...workspaceSources]))
        throw conflict("Managed Project idempotency result changed after creation");
      await assertNativeProjectSourceCurrent(tx, { companyId, actor, source: projectSource });
      await assertNativeManagedConsumedSourceSetCurrent(tx, { companyId, issueId, runId: capture.runId,
        actor, components: capture.consumedSourceComponents ?? [], sourceSet });
      const receipt: NativeProjectCreateReceipt = { callId, tool: outputTool, argumentsHash,
        commandKeyHash, commandFingerprint, resultDigest: nativeSha256(dto), projectId: project.id,
        responsibleUserId: current.userId, projectSourceSet, projectSourceSetHash: nativeSha256(projectSourceSet),
        sourceSetHash, projectSource, workspaceSources,
        sourceSnapshotDigest: snapshot.data.digest };
      receipts[callReceiptKey] = receipt;
      await rawTx.update(heartbeatRuns).set({ resultJson: { ...resultJson, nativeProjectCreateReceipts: receipts } })
        .where(eq(heartbeatRuns.id, run.id));
      result = { project: dto, receipt, sourceSet };
      return;
    }

    // Managed output from private or public input is kept private until a
    // separate, authorized publication operation exists.
    const sourceIssueIds = [...new Set([issueId, ...sourceSet.policy.issueIds])].sort();
    const sourceProjectIds = [...new Set(sourceSet.policy.projectIds)].sort();
    const service = projectService(tx);
    const project = await service.create(companyId, {
      name: args.name,
      description: args.description ?? null,
      status: "backlog",
      visibility: "private",
      privacyOwnerUserId: current.userId,
      sourceProvenanceQualified: true,
      sourceIssueIds,
      sourceProjectIds,
      payloadSourceProtocolVersion: 1,
      payloadSourceSnapshot: null,
      payloadSourceSnapshotInvalidated: false,
      env: null,
      goalId: null,
      goalIds: [],
      executionWorkspacePolicy: null,
    }, rawTx);
    // The managed constructor has already pinned the accountable Human and
    // exact caller run. Grant only that actual creating Agent access before
    // the service's normal actor-read check; the receipt and Project remain
    // private to the Human and this authorized producer.
    if (!actor.agentId) throw forbidden("Managed Project creating Agent is unavailable");
    await ensureProjectAccessMember(rawTx, { companyId, projectId: project.id,
      subjectType: "agent", subjectId: actor.agentId });
    if (!(await canActorReadProjectPrivacy(tx, actor, project))) throw forbidden("Managed Project result is unavailable");

    const cwd = resolveManagedProjectWorkspaceDir({ companyId, projectId: project.id });
    const workspace = await service.createWorkspace(project.id, { name: effectiveWorkspace.name,
      sourceType: "local_path", cwd, isPrimary: true });
    if (!workspace) throw forbidden("Managed Project workspace could not be created");
    const repositoryWorkspaces = [];
    for (const repository of normalizedRepositories) {
      const repositoryWorkspace = await service.createWorkspace(project.id, {
        name: repository.fullName, repoUrl: repository.url, metadata: repository.metadata ?? undefined,
      });
      if (!repositoryWorkspace) throw forbidden("Managed Project repository workspace could not be created");
      repositoryWorkspaces.push({ workspace: repositoryWorkspace, repository });
    }

    // Workspace insertion uses a nested owner lock. Recheck the full consumed
    // graph after that wait while the original owner privacy locks remain held.
    await assertNativeManagedConsumedSourceSetCurrent(tx, { companyId, issueId, runId: capture.runId,
      actor, components: capture.consumedSourceComponents ?? [], sourceSet });

    const workspaceRows = await rawTx.select({ workspaceId: projectWorkspaces.id,
      sourceVersion: sql<string>`${projectWorkspaces.updatedAt}::text`,
      contentHash: sql<string>`encode(sha256(convert_to(to_jsonb(${projectWorkspaces})::text,'UTF8')),'hex')` })
      .from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, companyId), eq(projectWorkspaces.projectId, project.id)))
      .orderBy(projectWorkspaces.id);
    const workspaceSources: WorkspaceSource[] = workspaceRows.map(row => ({ kind: "project_workspace", projectId: project.id,
      workspaceId: row.workspaceId, sourceVersion: row.sourceVersion, contentHash: row.contentHash }));
    const snapshotInputs = [...sourceSet.inputs, ...workspaceSources];
    if (new Set(snapshotInputs.map(value => JSON.stringify(value))).size !== snapshotInputs.length)
      throw forbidden("Managed Project source closure is ambiguous");
    const policyJson = JSON.stringify(sourceSet.policy), inputsJson = JSON.stringify(snapshotInputs);
    const [sealed] = await rawTx.execute<{ snapshot: NativePayloadSourceSnapshot }>(sql`select
      (select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'))
        from (select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','project',
          'companyId',p.company_id::text,'id',p.id::text,
          'contentHash',public.aw_native_payload_body_hash('project',to_jsonb(p))),
          'policy',${policyJson}::jsonb,'inputs',${inputsJson}::jsonb) as value) payload)
      as snapshot from projects p where p.company_id=${companyId}::uuid and p.id=${project.id}::uuid`);
    const snapshot = nativePayloadSourceSnapshotSchema.parse(sealed?.snapshot);
    const [updated] = await rawTx.update(projects).set({ payloadSourceProtocolVersion: 1,
      payloadSourceSnapshot: snapshot, payloadSourceSnapshotInvalidated: false })
      .where(and(eq(projects.companyId, companyId), eq(projects.id, project.id),
        eq(projects.privacyOwnerUserId, current.userId), eq(projects.visibility, "private"))).returning();
    if (!updated) throw conflict("Managed Project source snapshot was not stored");

    const hydrated = await service.getById(project.id);
    if (!hydrated || !(await canActorReadProjectPrivacy(tx, actor, hydrated))) throw forbidden("Managed Project result is unavailable");
    const dto = managedNativeProjectResultDto(hydrated);
    const projectSource: ProjectSource = { kind: "project", projectId: project.id,
      sourceVersion: hydrated.updatedAt.toISOString(),
      contentHash: createHash("sha256").update(JSON.stringify(dto), "utf8").digest("hex") };
    await assertNativeProjectSourceCurrent(tx, { companyId, actor, source: projectSource });
    await assertNativeManagedConsumedSourceSetCurrent(tx, { companyId, issueId, runId: capture.runId,
      actor, components: capture.consumedSourceComponents ?? [], sourceSet });
    const receipt: NativeProjectCreateReceipt = { callId, tool: outputTool, argumentsHash,
      commandKeyHash, commandFingerprint,
      resultDigest: nativeSha256(dto), projectId: project.id, responsibleUserId: current.userId,
      projectSourceSet: sourceSet, projectSourceSetHash: nativeSha256(sourceSet), sourceSetHash,
      projectSource, workspaceSources, sourceSnapshotDigest: snapshot.digest };
    receipts[callReceiptKey] = receipt;
    await rawTx.update(heartbeatRuns).set({ resultJson: { ...resultJson, nativeProjectCreateReceipts: receipts } })
      .where(eq(heartbeatRuns.id, run.id));
    const activity = await persistActivity(tx, { companyId, actorType: "agent", actorId: actor.agentId!,
      agentId: actor.agentId!, runId: run.id, issueId, action: "project.created", entityType: "project",
      entityId: project.id, details: { name: project.name, description: project.description,
        icon: project.icon, status: project.status, sourceIssueId: issueId,
        idempotencyKey: commandIdempotencyKey, nativeCommandFingerprint: commandFingerprint,
        repositories: repositoryWorkspaces.map(({ repository }) => ({
          id: repository.id, name: repository.fullName, url: repository.url,
        })), workspaceId: workspace.id, envKeys: [],
        source: "managed_native_create_project", sourceSnapshotDigest: snapshot.digest,
        workspaceIds: workspaceSources.map(value => value.workspaceId) } });
    publication = activity.publication;
    result = { project: dto, receipt, sourceSet };
  });
  if (publication) publishActivity(publication);
  if (!result) throw forbidden("Managed Project creation did not produce a qualified result");
  return result;
}

/** Verify the durable Project-create receipt at the model-result boundary. This
 * proves the returned DTO still matches its original Project+Workspace owners
 * and the complete consumed source closure; receipt fields alone grant no access. */
export async function assertNativeManagedProjectCreateReceiptCurrent(db: Db, input: {
  companyId: string;
  issueId: string;
  runId: string;
  actor: AuthorizationActor;
  receipt: NativeProjectCreateReceipt;
  sourceSet: NativePayloadSourceSet;
  outputCapture: NativeModelOutputCapture;
  result: unknown;
  allowSucceededRun?: boolean;
}): Promise<void> {
  await db.transaction(tx => assertNativeManagedProjectCreateReceiptCurrentInTransaction(tx, input));
}

/** In-scope form for the original Gateway result transaction. */
export async function assertNativeManagedProjectCreateReceiptCurrentInTransaction(tx: Transaction, input: {
  companyId: string;
  issueId: string;
  runId: string;
  actor: AuthorizationActor;
  receipt: NativeProjectCreateReceipt;
  sourceSet: NativePayloadSourceSet;
  outputCapture: NativeModelOutputCapture;
  result: unknown;
  /** Completion verifiers may recheck the same settled receipt after the run succeeds. */
  allowSucceededRun?: boolean;
}): Promise<void> {
  const { companyId, issueId, runId, actor, receipt, sourceSet, outputCapture } = input;
  const projectSourceResult = nativePayloadSourceInputSchema.safeParse(receipt.projectSource);
  const workspaceSourcesResult = nativePayloadSourceInputSchema.array().safeParse(receipt.workspaceSources);
  const resultRecord = record(input.result);
  if (receipt.tool !== outputCapture.managedOpenCodeToolUse?.toolName || receipt.callId !== outputCapture.managedOpenCodeToolUse?.callId ||
    receipt.argumentsHash !== outputCapture.managedOpenCodeToolUse?.argumentsHash ||
    receipt.resultDigest !== nativeSha256(input.result) || !isDeepStrictEqual(input.result, resultRecord) ||
    receipt.sourceSetHash !== nativeSha256(sourceSet) || !isDeepStrictEqual(sourceSet, outputCapture.sourceSet) ||
    !projectSourceResult.success || projectSourceResult.data.kind !== "project" ||
    !workspaceSourcesResult.success || workspaceSourcesResult.data.some(value => value.kind !== "project_workspace") ||
    workspaceSourcesResult.data.some(value => value.kind !== "project_workspace" ||
      (value as WorkspaceSource).projectId !== receipt.projectId) ||
    outputCapture.runId !== runId || outputCapture.dispatch.runId !== runId ||
    !["create_project", "call_api"].includes(outputCapture.managedOpenCodeToolUse?.toolName ?? ""))
    throw forbidden("Managed Project result receipt is malformed");

  await assertNativeModelOutputCaptureCurrent(tx as unknown as Db, companyId, issueId, outputCapture, receipt.tool, actor,
    input.allowSucceededRun ? "settled" : "live");
  const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId),
      eq(heartbeatRuns.nativeIssueId, issueId), inArray(heartbeatRuns.status,
        input.allowSucceededRun ? ["running", "succeeded"] : ["running"]),
    )).for("share");
  if (!run || run.responsibleUserId !== receipt.responsibleUserId ||
    actor.type !== "agent" || actor.agentId !== run.agentId || actor.onBehalfOfUserId !== run.responsibleUserId)
    throw forbidden("Managed Project accountable Human changed");
  const receipts = record(record(run.resultJson).nativeProjectCreateReceipts);
  const key = createHash("sha256").update(receipt.callId, "utf8").digest("hex");
  if (!isDeepStrictEqual(receipts[key], receipt)) throw forbidden("Managed Project creation receipt is unavailable");

  const project = await projectService(tx as unknown as Db).getById(receipt.projectId);
  const projectSourceSet = nativePayloadSourceSetSchema.safeParse(receipt.projectSourceSet);
  const expectedSourceIssueIds = projectSourceSet.success
    ? [...new Set([issueId, ...projectSourceSet.data.policy.issueIds])].sort() : [];
  const expectedSourceProjectIds = projectSourceSet.success ? [...new Set(projectSourceSet.data.policy.projectIds)].sort() : [];
  if (!project || project.visibility !== "private" || project.privacyOwnerUserId !== run.responsibleUserId ||
    !projectSourceSet.success || receipt.projectSourceSetHash !== nativeSha256(projectSourceSet.data) ||
    project.sourceProvenanceQualified !== true || !Array.isArray(project.sourceIssueIds) ||
    !isDeepStrictEqual([...project.sourceIssueIds].sort(), expectedSourceIssueIds) ||
    !Array.isArray(project.sourceProjectIds) ||
    !isDeepStrictEqual([...project.sourceProjectIds].sort(), expectedSourceProjectIds) ||
    !(await canActorReadProjectPrivacy(tx as unknown as Db, actor, project)))
    throw forbidden("Managed Project owner is unavailable");
  const dto = managedNativeProjectResultDto(project);
  const exactProjectSource: ProjectSource = { kind: "project", projectId: project.id,
    sourceVersion: project.updatedAt.toISOString(),
    contentHash: createHash("sha256").update(JSON.stringify(dto), "utf8").digest("hex") };
  const snapshot = nativePayloadSourceSnapshotSchema.safeParse(project.payloadSourceSnapshot);
  const expectedInputs = projectSourceSet.success
    ? [...projectSourceSet.data.inputs, ...workspaceSourcesResult.data] : [];
  if (!snapshot.success || snapshot.data.digest !== receipt.sourceSnapshotDigest ||
    !projectSourceSet.success || receipt.projectSourceSetHash !== nativeSha256(projectSourceSet.data) ||
    !isDeepStrictEqual(snapshot.data.policy, projectSourceSet.data.policy) || !isDeepStrictEqual(snapshot.data.inputs, expectedInputs) ||
    !isDeepStrictEqual(exactProjectSource, projectSourceResult.data) ||
    !isDeepStrictEqual(dto, input.result) || receipt.resultDigest !== nativeSha256(dto))
    throw forbidden("Managed Project snapshot no longer matches its output capture");
  await assertNativeManagedConsumedSourceSetCurrent(tx as unknown as Db, { companyId, issueId, runId, actor,
    components: outputCapture.consumedSourceComponents ?? [], sourceSet });
  await assertNativeProjectSourceCurrent(tx as unknown as Db, { companyId, actor, source: projectSourceResult.data });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Match the exact JSON value observed by the provider (not database Date instances). */
export function managedNativeProjectResultDto(project: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(publicNativePayloadRow(project))) as Record<string, unknown>;
}

function isProjectSource(value: unknown): value is ProjectSource {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === "project" &&
    typeof (value as Record<string, unknown>).projectId === "string" &&
    typeof (value as Record<string, unknown>).sourceVersion === "string" &&
    typeof (value as Record<string, unknown>).contentHash === "string";
}
