import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { heartbeatRuns, projectWorkspaces, projects, type Db } from "@paperclipai/db";
import { nativePayloadSourceInputSchema, nativePayloadSourceSnapshotSchema, type NativePayloadSourceInput,
  type NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { conflict, forbidden } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { canActorReadProjectPrivacy } from "./authorization.js";
import { assertNativeManagedConsumedSourceSetCurrent, assertNativeModelOutputCaptureCurrent,
  assertNativeProjectSourceCurrent } from "./native-direct-input.js";
import { publicNativePayloadRow } from "./native-payload-public.js";
import { persistActivity, publishActivity } from "./activity-log.js";
import { lockIssuePrivacyTree } from "./issues.js";
import { ensureProjectAccessMember, pinProjectMutationHuman, projectService } from "./projects.js";
import { projectToolContext } from "./project-tool-context.js";
import type { NativeModelOutputCapture, NativePayloadSourceSet } from "./native-runtime/native-execution-input.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { resolveManagedProjectWorkspaceDir } from "../home-paths.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ProjectSource = Extract<NativePayloadSourceInput, { kind: "project" }>;
type WorkspaceSource = Extract<NativePayloadSourceInput, { kind: "project_workspace" }>;
const managedProjectArgumentsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4_000).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(255),
  workspace: z.object({ name: z.string().trim().min(1).max(200) }).strict().optional(),
}).strict();

export type NativeProjectCreateReceipt = {
  callId: string;
  tool: "create_project";
  argumentsHash: string;
  resultDigest: string;
  projectId: string;
  responsibleUserId: string;
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
  arguments: z.infer<typeof managedProjectArgumentsSchema>;
  capture: NativeModelOutputCapture;
}): Promise<{ project: Record<string, unknown>; receipt: NativeProjectCreateReceipt; sourceSet: NativePayloadSourceSet }> {
  const { db, actor, companyId, issueId, capture } = input;
  const callId = input.callId;
  const argumentsHash = nativeSha256(input.arguments);
  const args = managedProjectArgumentsSchema.parse(input.arguments);
  const use = capture.managedOpenCodeToolUse;
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId ||
    !actor.agentId || !actor.runId || capture.runId !== actor.runId || !use || use.callId !== callId ||
    use.toolName !== "create_project" || use.argumentsHash !== argumentsHash ||
    !/^[\x21-\x7e]{1,240}$/.test(callId))
    throw forbidden("Managed Project creation requires the exact current provider tool use");

  const sourceSet: NativePayloadSourceSet = { policy: capture.sourceSet.policy, inputs: capture.sourceSet.inputs };
  const sourceSetHash = nativeSha256(sourceSet);
  const key = createHash("sha256").update(callId, "utf8").digest("hex");
  let publication: Awaited<ReturnType<typeof persistActivity>>["publication"] | null = null;
  let result: { project: Record<string, unknown>; receipt: NativeProjectCreateReceipt; sourceSet: NativePayloadSourceSet } | null = null;

  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    // Validate all consumed owner roots before the mutation. The validator pins
    // the source privacy tree and checks the settled response, dispatch, call,
    // arguments and accountable Human through the same transaction.
    await assertNativeModelOutputCaptureCurrent(tx, companyId, issueId, capture, "create_project", actor);
    await lockIssuePrivacyTree(rawTx, companyId);
    const current = await projectToolContext(tx, actor as never, true);
    if (current.issue.id !== issueId || !current.userId || current.localTrusted ||
      (actor.onBehalfOfUserId ?? null) !== current.userId || current.run.status !== "running")
      throw forbidden("Managed Project creation requires the current accountable Human");
    await pinProjectMutationHuman(rawTx, actor, companyId);
    await rawTx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`native-project-create:${capture.runId}:${callId}`},0))`);
    const [run] = await rawTx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.id, capture.runId), eq(heartbeatRuns.companyId, companyId),
      eq(heartbeatRuns.agentId, actor.agentId!), eq(heartbeatRuns.nativeIssueId, issueId),
      eq(heartbeatRuns.status, "running"),
    )).for("update");
    if (!run || run.responsibleUserId !== current.userId) throw forbidden("Managed Project run authority changed");

    // A lock/identity wait may have occurred above. Recheck the complete
    // provider capture and all source owners immediately before creating rows.
    await assertNativeModelOutputCaptureCurrent(tx, companyId, issueId, capture, "create_project", actor);
    const resultJson = record(run.resultJson);
    const receipts = record(resultJson.nativeProjectCreateReceipts);
    const existing = record(receipts[key]);
    if (Object.keys(existing).length) {
      if (existing.callId !== callId || existing.tool !== "create_project" ||
        existing.argumentsHash !== argumentsHash || existing.sourceSetHash !== sourceSetHash ||
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

    if (args.workspace) {
      const cwd = resolveManagedProjectWorkspaceDir({ companyId, projectId: project.id });
      const workspace = await service.createWorkspace(project.id, { name: args.workspace.name,
        sourceType: "local_path", cwd, isPrimary: true });
      if (!workspace) throw forbidden("Managed Project workspace could not be created");
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
    const receipt: NativeProjectCreateReceipt = { callId, tool: "create_project", argumentsHash,
      resultDigest: nativeSha256(dto), projectId: project.id, responsibleUserId: current.userId,
      sourceSetHash, projectSource, workspaceSources, sourceSnapshotDigest: snapshot.digest };
    receipts[key] = receipt;
    await rawTx.update(heartbeatRuns).set({ resultJson: { ...resultJson, nativeProjectCreateReceipts: receipts } })
      .where(eq(heartbeatRuns.id, run.id));
    const activity = await persistActivity(tx, { companyId, actorType: "agent", actorId: actor.agentId!,
      agentId: actor.agentId!, runId: run.id, issueId, action: "project.created", entityType: "project",
      entityId: project.id, details: { source: "managed_native_create_project", sourceSnapshotDigest: snapshot.digest,
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
  if (receipt.tool !== "create_project" || receipt.callId !== outputCapture.managedOpenCodeToolUse?.callId ||
    receipt.argumentsHash !== outputCapture.managedOpenCodeToolUse?.argumentsHash ||
    receipt.resultDigest !== nativeSha256(input.result) || !isDeepStrictEqual(input.result, resultRecord) ||
    receipt.sourceSetHash !== nativeSha256(sourceSet) || !isDeepStrictEqual(sourceSet, outputCapture.sourceSet) ||
    !projectSourceResult.success || projectSourceResult.data.kind !== "project" ||
    !workspaceSourcesResult.success || workspaceSourcesResult.data.some(value => value.kind !== "project_workspace") ||
    workspaceSourcesResult.data.some(value => value.kind !== "project_workspace" ||
      (value as WorkspaceSource).projectId !== receipt.projectId) ||
    outputCapture.runId !== runId || outputCapture.dispatch.runId !== runId ||
    outputCapture.managedOpenCodeToolUse?.toolName !== "create_project")
    throw forbidden("Managed Project result receipt is malformed");

  await assertNativeModelOutputCaptureCurrent(tx as unknown as Db, companyId, issueId, outputCapture, "create_project", actor);
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
  const expectedSourceIssueIds = [...new Set([issueId, ...sourceSet.policy.issueIds])].sort();
  const expectedSourceProjectIds = [...new Set(sourceSet.policy.projectIds)].sort();
  if (!project || project.visibility !== "private" || project.privacyOwnerUserId !== run.responsibleUserId ||
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
  const expectedInputs = [...sourceSet.inputs, ...workspaceSourcesResult.data];
  if (!snapshot.success || snapshot.data.digest !== receipt.sourceSnapshotDigest ||
    !isDeepStrictEqual(snapshot.data.policy, sourceSet.policy) || !isDeepStrictEqual(snapshot.data.inputs, expectedInputs) ||
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
