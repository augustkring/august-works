import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import express from "express";
import request from "supertest";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { expect } from "vitest";

import {
  agents,
  authUsers,
  createDb,
  heartbeatRuns,
  completionContracts,
  companyMemberships,
  documentRevisions,
  agentExecutionManifests,
  issueDocuments,
  issues,
  orchestrationModelReservations,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
  nativeRunFinalizations,
  toolInvocations,
} from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema,
  type NativePayloadSourceInput } from "@paperclipai/shared";
import { seedV5Presences, enableV5ForTest } from "./v5-fixtures.js";
import { seedNativePasskeySession } from "./native-authentication-fixtures.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../../services/agent-runtime-fabric.js";
import { aiConnectionService } from "../../services/ai-connections.js";
import { issueService } from "../../services/issues.js";
import { documentService } from "../../services/documents.js";
import { memoryService } from "../../services/memory/memory-service.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { orchestrationService } from "../../services/orchestration/orchestration-service.js";
import { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import { hashContextPolicySnapshot } from "../../services/context/context-manifest.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../../services/provider-capabilities.js";
import { runtimeConnectionIntentRoutes } from "../../routes/connection-intents.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { issueRoutes } from "../../routes/issues.js";
import { setupRunnerPrpWebSocketServer } from "../../realtime/runner-prp-ws.js";
import { prepareNativeHeartbeatRun } from "../../services/native-runtime/prepare-native-run.js";
import { executePaperclipNativeSession } from "../../services/native-runtime/native-session-executor.js";
import { PaperclipControlPlanePort } from "../../services/native-runtime/paperclip-control-plane-port.js";
import { finalizeNativeRun } from "../../services/native-runtime/native-run-finalizer.js";
import { buildNativeExecutionInput, buildNativeBootstrapSourceSet } from "../../services/native-runtime/native-execution-input.js";
import { buildRetainedNativeRuntimeContext } from "../../services/native-runtime/runtime-context.js";
import { getIssueExecutionContext, buildPaperclipTaskMarkdown } from "../../services/heartbeat.js";
import { workerModelProfileSchema, type WorkerModelProfile } from "../../services/orchestration/worker-model-profiles.js";
import { currentNativeControllerIdentity } from "../../services/native-runtime/native-restart-recovery.js";
import { nativeCompletionContractInput } from "../../services/native-runtime/completion-contracts.js";
import { resolveDefaultAgentWorkspaceDir } from "../../home-paths.js";
import { OpenCodeServerDriver } from "@paperclipai/paperclip-runner";
import { buildNativeModelEnvelope, createCodexTaskEnvelope, nativeTaskConstraints } from "../../vendor/paperclip-runner/index.js";
import type { PrpStructuredRunResult, PrpTerminalState } from "../../vendor/paperclip-runner/index.js";

const QUALIFIED_OPENCODE_SHA256 = "513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080";
const sourceSha = "a".repeat(40);
const credential = `e2e-only-${randomUUID()}`;

function toolName(value: unknown): string {
  let name = typeof value === "string" ? value : "";
  for (const prefix of ["paperclip__", "paperclip_", "paperclip."])
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
  return value;
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value)) ?? "undefined").digest("hex");
}

function staticManagedErrorCodes(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === "string") {
    if (/^(?:managed_opencode|native|paperclip)_[a-z0-9_]{2,80}$/.test(value)) return [value];
    if (value.length > 16_384) return [];
    try { return staticManagedErrorCodes(JSON.parse(value), depth + 1); }
    catch { return []; }
  }
  if (Array.isArray(value)) return value.flatMap(item => staticManagedErrorCodes(item, depth + 1));
  if (value && typeof value === "object") return Object.values(value).flatMap(item =>
    staticManagedErrorCodes(item, depth + 1));
  return [];
}

function differencePaths(left: unknown, right: unknown, path = "$"): string[] {
  if (JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right))) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const paths: string[] = [];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1)
      paths.push(...differencePaths(left[index], right[index], `${path}[${index}]`));
    return paths;
  }
  if (left && right && typeof left === "object" && typeof right === "object" &&
    !Array.isArray(left) && !Array.isArray(right)) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    return [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort()
      .flatMap(key => differencePaths(leftRecord[key], rightRecord[key], `${path}.${key}`));
  }
  return [path];
}

function valueCategory(value: unknown): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return value ? "true" : "false";
  return typeof value;
}

function qualifiedOpenCodeBinary(): string {
  const configured = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim();
  if (configured) return configured;
  try { return execFileSync("which", ["opencode"], { encoding: "utf8" }).trim(); }
  catch { throw new Error("Set PAPERCLIP_QUALIFIED_OPENCODE_BINARY or install the qualified OpenCode binary on PATH."); }
}

export async function makeFixtureTreeWritable(target: string): Promise<void> {
  const metadata = await lstat(target).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(target, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory())
    for (const name of await readdir(target)) await makeFixtureTreeWritable(join(target, name));
}

export type ManagedNativeOpenCodeModelStep = {
  tool: "write_document" | "create_task" | "self_remember" | "read_context" | "paperclip_finish";
  id?: string;
  input?: Record<string, unknown>;
};

export type ManagedNativeOpenCodeHumanAction = {
  afterModelToolCallId: string;
  action: "accept_memory_candidate";
};

export async function runManagedNativeOpenCodeFixture(input: {
  db: ReturnType<typeof createDb>;
  connectionString: string;
  root: string;
  instanceId: string;
  steps?: ManagedNativeOpenCodeModelStep[];
  humanActions?: ManagedNativeOpenCodeHumanAction[];
  reuseIdentity?: { companyId: string; agentId: string; aliceUserId: string; bobUserId: string };
  onPreserveDebugArtifacts?: () => void;
}) {
  const { db, root, instanceId } = input;
  await instanceSettingsService(db).getExperimental();
  await enableV5ForTest(db);
  await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
    role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true,
    enableContextEngineV1: true, enableCollectiveMemoryV1: true, enablePrivateAgentMemoryV1: true });
  const defaultSteps: ManagedNativeOpenCodeModelStep[] = [
    { tool: "write_document", id: "managed-e2e-write-1", input: {
      idempotencyKey: "managed-opencode-source-document-v1", key: "managed-source-e2e", title: "Private E2E note",
      body: "This document was written through the governed OpenCode tool boundary.", baseRevisionId: null,
    } },
    { tool: "paperclip_finish", id: "managed-e2e-finish-1" },
  ];
  const modelSteps = input.steps ?? defaultSteps;
  if (modelSteps.length < 2 || modelSteps.at(-1)?.tool !== "paperclip_finish" ||
    modelSteps.slice(0, -1).some(step => step.tool === "paperclip_finish") ||
    new Set(modelSteps.map((step, index) => step.id ?? `managed-e2e-${step.tool}-${index}`)).size !== modelSteps.length)
    throw new Error("managed_fixture_model_steps_invalid");
  for (const action of input.humanActions ?? []) {
    const target = modelSteps.find((step, index) =>
      (step.id ?? `managed-e2e-${step.tool}-${index}`) === action.afterModelToolCallId);
    if (action.action !== "accept_memory_candidate" || target?.tool !== "self_remember")
      throw new Error("managed_fixture_human_action_invalid");
  }
  const acceptedMemoryIds: string[] = [];
  const completedHumanActions = new Set<string>();
    const opencodeBinary = qualifiedOpenCodeBinary();
    expect(execFileSync(opencodeBinary, ["--version"], { encoding: "utf8" }).trim()).toBe("1.18.32");
    expect(createHash("sha256").update(await readFile(opencodeBinary)).digest("hex")).toBe(QUALIFIED_OPENCODE_SHA256);
    const runRoot = await mkdtemp(join(root, "run-"));
    const keyPath = join(runRoot, "broker-key.pem");
    const certPath = join(runRoot, "broker-cert.pem");
    const caKeyPath = join(runRoot, "broker-ca-key.pem");
    const caCertPath = join(runRoot, "broker-ca-cert.pem");
    const csrPath = join(runRoot, "broker.csr");
    const extensionsPath = join(runRoot, "broker-extensions.cnf");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKeyPath,
      "-out", caCertPath, "-days", "1", "-subj", "/CN=Managed OpenCode E2E Test CA", "-addext",
      "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"], { stdio: "ignore" });
    execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
      "-out", csrPath, "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
    await writeFile(extensionsPath, "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n");
    execFileSync("openssl", ["x509", "-req", "-in", csrPath, "-CA", caCertPath, "-CAkey", caKeyPath,
      "-CAcreateserial", "-out", certPath, "-days", "1", "-sha256", "-extfile", extensionsPath], { stdio: "ignore" });
    await chmod(keyPath, 0o600);
    const certBundlePath = join(runRoot, "broker-trust-bundle.pem");
    await writeFile(certBundlePath, Buffer.concat([await readFile("/etc/ssl/certs/ca-certificates.crt"),
      Buffer.from("\n"), await readFile(caCertPath)]), { mode: 0o600 });
    const f = input.reuseIdentity ? null : await seedV5Presences(db);
    const companyId = input.reuseIdentity?.companyId ?? f!.home;
    const agentId = input.reuseIdentity?.agentId ?? f!.presence.id;
    const aliceUserId = input.reuseIdentity?.aliceUserId ?? f!.userId;
    const sessionId = await seedNativePasskeySession(db, aliceUserId);
    const [membership] = await db.select({ companyId: companyMemberships.companyId,
      membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
      .from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, aliceUserId)));
    if (!membership) throw new Error("Current Human company membership is unavailable.");
    const [agentRow] = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    if (!agentRow) throw new Error("The reused Native Agent is unavailable in its company.");
    const baseHumanActor = f?.actor ?? { type: "board" as const, source: "session" as const,
      userId: aliceUserId, companyIds: [companyId] };
    const human = { ...baseHumanActor, sessionId, memberships: [membership] };
    let bobUserId = input.reuseIdentity?.bobUserId ?? randomUUID();
    if (!input.reuseIdentity) {
      const userTimestamp = new Date();
      await db.insert(authUsers).values({ id: bobUserId, name: "Temporal Bob", email: `${bobUserId}@example.test`,
        createdAt: userTimestamp, updatedAt: userTimestamp });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: bobUserId,
        status: "active", membershipRole: "admin" });
    }
    const bobSessionId = await seedNativePasskeySession(db, bobUserId);
    const [bobMembership] = await db.select({ companyId: companyMemberships.companyId,
      membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
      .from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, bobUserId)));
    if (!bobMembership) throw new Error("Temporal Bob company membership is unavailable.");
    const bobActor = { type: "board" as const, source: "session" as const, userId: bobUserId,
      companyIds: [companyId], sessionId: bobSessionId, memberships: [bobMembership] };
    const aliceMemoryActor = { principal: { type: "user" as const, userId: aliceUserId } };
    const bobMemoryActor = { principal: { type: "user" as const, userId: bobUserId } };
    const containsRemember = modelSteps.some(step => step.tool === "self_remember");
    if (containsRemember) {
      const memories = memoryService(db);
      const binding = await memories.createCompanyBinding(companyId, {
        key: `managed-opencode-${randomUUID()}`, name: "Managed OpenCode E2E Memory", providerKey: "local",
      }, aliceMemoryActor);
      await memories.addBindingTarget(companyId, binding.id, { targetType: "company", targetId: companyId }, aliceMemoryActor);
      await memories.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, aliceMemoryActor);
    }
    const profileId = randomUUID();
    const model = "fixture-managed-opencode-v1";
    const adapterConfig = { provider: "opencode", model: `anthropic/${model}`, lifecycleMode: "per_turn" };
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig, runtimeConfig: {} })
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));

    const providers = agentProviderBindingService(db);
    const providerBinding = await providers.create(human, companyId, agentId, {
      providerType: "paperclip_native", providerAgentRef: agentId, isolationMode: "isolated_per_presence", providerEndpointRef: null,
    });
    const attached = await providers.attach(human, companyId, agentId, {
      providerBindingId: providerBinding.id, providerProfileRef: agentId,
    });
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({
      companyId, adapterType: "paperclip_runner", config: adapterConfig,
    }));
    await providers.recordDiscovery(companyId, agentId, snapshot,
      Object.fromEntries(providerConformanceRequirements(snapshot, providerBinding.isolationMode).map(check => [check, true])));
    const provider = await providers.assertRuntime(companyId, agentId);

    const issued = await aiConnectionService(db).save(companyId, aliceUserId, {
      provider: "anthropic", method: "api_key", ownership: "shared", name: "Fixture managed model",
      apiKey: "fixture", allAgents: false, agentIds: [agentId],
    }, credential);
    const qualifiedHash = hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig });
    const profile: WorkerModelProfile = workerModelProfileSchema.parse({
      id: profileId, companyId, workerAgentId: agentId, providerBindingId: provider.provider.id,
      providerSnapshotHash: provider.provider.capabilitySnapshotHash,
      providerProfileRef: provider.runtime.providerProfileRef, qualifiedConfigurationHash: qualifiedHash,
      binding: { provider: "anthropic", method: "api_key", mode: "shared", ...issued },
      transport: "server-anthropic-messages-v1", contract: "anthropic-messages-tools-2023-06-01",
      maximumEnvelopeBytes: 64000, inputTokensUpperBound: 100000, maxOutputTokens: 1024,
      tariff: { provider: "anthropic", model, currency: "USD", inputMinorPerMillion: 0, outputMinorPerMillion: 0,
        fixedMinor: 1, qualificationHash: "b".repeat(64), sourceSha, testedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
      qualificationEvidenceRef: "https://protected.test.invalid/qualification/managed-opencode-fixture.json",
      qualificationArtifactSha256: "c".repeat(64),
    });

    const humanApp = express();
    humanApp.use(express.json());
    humanApp.use((req, _res, next) => { req.actor = human as typeof req.actor; next(); });
    humanApp.use("/api", issueRoutes(db, {} as never)); humanApp.use(errorHandler);
    const createTaskResponse = await request(humanApp).post(`/api/companies/${companyId}/issues`)
      .send({ title: "Save a private source-bound note", description: "Create a short internal note and finish the task.",
        responsibleUserId: aliceUserId });
    expect(createTaskResponse.status, JSON.stringify(createTaskResponse.body)).toBe(201);
    const createdTask = createTaskResponse.body as { id: string };
    await db.update(issues).set({ status: "todo", assigneeAgentId: agentId })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, createdTask.id)));
    const task = (await db.select().from(issues).where(eq(issues.id, createdTask.id)))[0]!;
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, responsibleUserId: aliceUserId,
      status: "running", runtimeMode: "native", nativeIssueId: task.id, contextSnapshot: { issueId: task.id } }).returning();
    const manifest = await agentRuntimeFabricService(db).prepare({ companyId, agentId, runId: run!.id,
      responsibleUserId: aliceUserId, issueId: task.id, query: task.title });
    const plan = await orchestrationService(db).create(human, companyId, {
      issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", actionClass: "internal_draft", riskClass: "C0",
      completionContract: { objective: "Complete the managed source-bound task", requiredOutputs: (() => {
        const keys = modelSteps.filter(step => step.tool === "write_document")
          .map(step => step.input?.key).filter((key): key is string => typeof key === "string");
        return keys.map(key => ({ key }));
      })(),
        businessInvariants: ["Use only this task's private workspace"] },
      budgets: { maxModelCostMinor: Math.max(10, modelSteps.length * 2), maxToolActions: modelSteps.length + 2 },
      workers: [{ key: "writer", issueId: task.id }],
    });
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(),
      executionPrincipal: { type: "user", userId: aliceUserId } }).where(eq(orchestrationPlans.id, plan.id));
    const [worker] = await db.update(orchestrationWorkers).set({ status: "running", attemptCount: 1 })
      .where(eq(orchestrationWorkers.planId, plan.id)).returning();
    await db.insert(orchestrationWorkerAttempts).values({ companyId, planId: plan.id, workerId: worker!.id,
      agentId, runId: run!.id, executionManifestId: manifest!.record.id, attempt: 1 });
    await db.update(issues).set({ status: "in_progress", executionRunId: run!.id })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
    const [contractRow] = await db.select().from(completionContracts)
      .where(and(eq(completionContracts.companyId, companyId), eq(completionContracts.issueId, task.id)));
    if (!contractRow) throw new Error("Native completion contract was not persisted.");
    const prepared = await prepareNativeHeartbeatRun({ db, run: run!, issue: task, environmentLeaseId: randomUUID() });
    let runtimeInputs: NativePayloadSourceInput[] = [];
    const agent = (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!;
    const runtimeContext = await buildRetainedNativeRuntimeContext({ db, agent, runId: run!.id,
      runtimeConfig: {}, runtimeSkillEntries: [], onAuthoredSourceCapture: (capture) => { runtimeInputs = capture.inputs; } });
    const taskCapture: { value: { input: NativePayloadSourceInput; payloadSourceSnapshot: unknown } | null } = { value: null };
    const selectedTask = await getIssueExecutionContext(db, companyId, task.id, capture => { taskCapture.value = capture; });
    const taskSource = taskCapture.value;
    if (!selectedTask || !taskSource || taskSource.input.kind !== "task") throw new Error("Current task source capture is unavailable.");
    const renderedReferences: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
    const taskPrompt = buildPaperclipTaskMarkdown({ issue: { id: task.id, identifier: selectedTask.identifier,
      title: selectedTask.title, description: selectedTask.description, workMode: selectedTask.workMode } },
    { onRenderedSource: source => renderedReferences.push(source) });
    if (!taskPrompt) throw new Error("Canonical task renderer returned no source-bound prompt.");
    const completionContract = nativeCompletionContractInput(contractRow.contractJson);
    const agentWorkspace = resolveDefaultAgentWorkspaceDir(agentId);
    await mkdir(agentWorkspace, { recursive: true, mode: 0o700 });
    const workspace = { id: run!.id, cwd: agentWorkspace, repoUrl: null, repoRef: null, branchName: null };
    const execution = buildNativeExecutionInput({ companyId, runId: run!.id, agentId,
      issue: { id: task.id, identifier: selectedTask.identifier, title: selectedTask.title,
        description: selectedTask.description, workMode: selectedTask.workMode }, taskPrompt,
      workspace, normalizedSessionId: prepared.normalizedSessionId, provider: "opencode", model: `anthropic/${model}`,
      lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null },
      completionContract: { id: contractRow.id, sha256: contractRow.canonicalSha256,
        schemaVersion: contractRow.schemaVersion, contract: completionContract }, runtimeContext });
    const managedTaskEnvelope = createCodexTaskEnvelope({
      objective: execution.completionContract.contract.objective,
      contractRevision: execution.completionContract.contract.revision,
      criteria: execution.completionContract.contract.criteria,
      constraints: ["Work only inside the supplied working directory.", ...nativeTaskConstraints(execution),
        "Return one semantic completion result through paperclip_finish or paperclip_block."],
    });
    const canonicalManagedPrompt = JSON.stringify({ task: managedTaskEnvelope,
      message: JSON.stringify(buildNativeModelEnvelope(execution)) });
    const canonicalManagedPromptHash = canonicalHash(canonicalManagedPrompt);
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, runId: run!.id, agentId, issueId: task.id,
      renderedMarkdown: taskPrompt, renderedMarkdownDigest: createHash("sha256").update(taskPrompt, "utf8").digest("hex"),
      references: renderedReferences, candidates: [{ kind: "task", id: task.id, input: taskSource.input,
        payloadSourceSnapshot: taskSource.payloadSourceSnapshot }], runtimeInputs,
      additionalInputs: [
        { kind: "completion_contract", issueId: task.id, contractId: contractRow.id,
          revision: String(contractRow.revision), contentHash: contractRow.canonicalSha256 },
        { kind: "workspace_metadata", runId: run!.id, executionWorkspaceId: execution.binding.executionWorkspaceId,
          origin: "agent_home", sourceVersion: `agent-home:${agentId}:v1`,
          contentHash: createHash("sha256").update(JSON.stringify({ cwd: execution.workspace.cwd,
            repoUrl: execution.workspace.repoUrl, repoRef: execution.workspace.repoRef,
            branchName: execution.workspace.branchName }), "utf8").digest("hex") },
      ], contextManifestIds: [], rolePackInputs: [], unsupportedInputPresent: false });
    if (!sourceSet) throw new Error("Canonical source collector did not close the task input.");
    const bootstrapSourceClosure = { sourceSet,
      taskEnvelopeDigest: createHash("sha256").update(JSON.stringify(execution.task), "utf8").digest("hex") };
    const profileBlob = { ...(run!.runnerProfileJson as Record<string, unknown>), nativeExecutionInput: execution };
    await db.update(heartbeatRuns).set({ runnerProfileJson: profileBlob }).where(eq(heartbeatRuns.id, run!.id));
    const leaseOwner = `managed-opencode-e2e:${randomUUID()}`;
    const controller = await currentNativeControllerIdentity();
    await db.insert(nativeRunFinalizations).values({ runId: run!.id, companyId, issueId: task.id,
      phase: "running", attempt: 1, leaseOwner, leaseExpiresAt: new Date(Date.now() + 120_000),
      controllerBootId: controller.bootId, controllerPid: controller.pid,
      controllerProcessStartedAt: controller.processStartedAt });

    let responseCount = 0;
    const fakeFetchEntrances: Array<{ host: string; path: string; apiKeyHeader: boolean; bearerHeader: boolean }> = [];
    const modelCalls: Array<Record<string, unknown>> = [];
    const contextResultConsumers: Array<{ callId: string; consumed: boolean }> = [];
    const brokerRequests: string[] = [];
    const submittedPromptFacts: Array<{ length: number; sha256: string }> = [];
    let managedConfigReadOnlyVerified = false;
    const gateway = workerModelGateway(db, {
      profiles: [profile], sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid",
      fetch: async (url, init) => {
        const requestUrl = new URL(String(url));
        const requestHeaders = new Headers(init.headers);
        fakeFetchEntrances.push({ host: requestUrl.host, path: requestUrl.pathname,
          apiKeyHeader: requestHeaders.has("x-api-key"), bearerHeader: requestHeaders.has("authorization") });
        expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
        expect(requestHeaders.get("x-api-key")).toBe(credential);
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        modelCalls.push(body);
        responseCount += 1;
        if (responseCount > 1 && modelSteps[responseCount - 2]?.tool === "read_context") {
          const previousStep = modelSteps[responseCount - 2]!;
          const callId = previousStep.id ?? `managed-e2e-${previousStep.tool}-${responseCount - 2}`;
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const toolResults = messages.flatMap(message => {
            if (!message || typeof message !== "object") return [];
            const content = (message as Record<string, unknown>).content;
            return Array.isArray(content) ? content : [];
          }).filter(block => block && typeof block === "object") as Array<Record<string, unknown>>;
          contextResultConsumers.push({ callId, consumed: toolResults.some(block =>
            block.type === "tool_result" && block.tool_use_id === callId && block.is_error !== true &&
            (typeof block.content === "string" || Array.isArray(block.content))) });
        }
        if (responseCount > 1) {
          const previousStep = modelSteps[responseCount - 2]!;
          const previousCallId = previousStep.id ?? `managed-e2e-${previousStep.tool}-${responseCount - 2}`;
          for (const action of input.humanActions ?? []) {
            if (action.afterModelToolCallId !== previousCallId || completedHumanActions.has(previousCallId)) continue;
            if (action.action !== "accept_memory_candidate" || previousStep.tool !== "self_remember")
              throw new Error("managed_fixture_human_action_unqualified");
            const idempotencyKey = `aw-native-tool:${run!.id}:${previousCallId}`;
            const [invocation] = await db.select({ workflowResultJson: toolInvocations.workflowResultJson,
              status: toolInvocations.status, toolName: toolInvocations.toolName })
              .from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId),
                eq(toolInvocations.idempotencyKey, idempotencyKey)));
            if (!invocation || invocation.status !== "succeeded" || invocation.toolName !== "paperclip-self:remember")
              throw new Error("managed_fixture_memory_candidate_invocation_unavailable");
            const result = (typeof invocation.workflowResultJson === "string"
              ? JSON.parse(invocation.workflowResultJson) : invocation.workflowResultJson) as { record?: { id?: unknown; reviewState?: unknown } };
            if (typeof result.record?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(result.record.id) ||
              result.record.reviewState !== "pending")
              throw new Error("managed_fixture_memory_candidate_unavailable");
            await memoryService(db).reviewCandidate(companyId, result.record.id, { decision: "accept" }, aliceMemoryActor);
            acceptedMemoryIds.push(result.record.id);
            completedHumanActions.add(previousCallId);
          }
        }
        const tools = (body.tools as Array<Record<string, unknown>>) ?? [];
        const step = modelSteps[responseCount - 1];
        if (!step) throw new Error("Managed fixture provider exhausted its configured model steps.");
        const findTool = (name: ManagedNativeOpenCodeModelStep["tool"]) => tools.find(tool => {
          if (name === "paperclip_finish") return tool.name === "paperclip_finish" || toolName(tool.name) === "finish";
          return toolName(tool.name) === name;
        });
        if (step.tool === "paperclip_finish") {
          const finish = findTool(step.tool);
          if (!finish) throw new Error("OpenCode wire omitted paperclip_finish.");
          const finishInput = {
            schema: "paperclip.run_result.v1", reportedWorkDisposition: "done", summary: "The managed task is complete.",
            completionClaim: { contractRevision: String(contractRow.revision), objectiveSatisfied: true,
              criteria: completionContract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })),
              remainingWork: [] }, evidence: [], verification: [], attentionRequests: [], artifacts: [],
          };
          return new Response(JSON.stringify({ id: `msg_managed_e2e_${responseCount}`, type: "message", role: "assistant", model, stop_reason: "tool_use",
            content: [{ type: "tool_use", id: step.id ?? `managed-e2e-finish-${responseCount}`, name: finish.name, input: finishInput }],
            usage: { input_tokens: 160, output_tokens: 38 } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        const selected = findTool(step.tool);
        if (!selected) throw new Error(`OpenCode wire omitted the governed ${step.tool} tool.`);
        return new Response(JSON.stringify({ id: "msg_managed_e2e_finish", type: "message", role: "assistant", model, stop_reason: "tool_use",
          content: [{ type: "tool_use", id: step.id ?? `managed-e2e-${step.tool}-${responseCount}`, name: selected.name, input: step.input ?? {} }],
          usage: { input_tokens: 120, output_tokens: 42 } }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const minted = await gateway.issueForRun({ companyId, agentId, runId: run!.id, responsibleUserId: aliceUserId });
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use((req, res, next) => {
      brokerRequests.push(`${req.method} ${req.path}`);
      res.on("finish", () => brokerRequests.push(`response ${req.method} ${req.path} ${res.statusCode}`));
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        brokerRequests.push(`response-body ${req.method} ${req.path} ${JSON.stringify(body)}`);
        return originalJson(body);
      }) as typeof res.json;
      if (req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages") {
        res.status(404).end();
        return;
      }
      const wire = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      const messages = Array.isArray(wire.messages) ? wire.messages : [];
      const tools = Array.isArray(wire.tools) ? wire.tools : [];
      const toolResultFacts = messages.flatMap(message => {
        const item = message && typeof message === "object" ? message as Record<string, unknown> : {};
        return (Array.isArray(item.content) ? item.content : []).flatMap(block => {
          const value = block && typeof block === "object" ? block as Record<string, unknown> : {};
          if (value.type !== "tool_result") return [];
          return [{ isError: value.is_error === true, staticErrorCodes: staticManagedErrorCodes(value.content) }];
        });
      });
      const shape = {
        keys: Object.keys(wire).sort(), model: wire.model, max_tokens: wire.max_tokens, stream: wire.stream,
        messages: messages.map((message) => {
          const item = message && typeof message === "object" ? message as Record<string, unknown> : {};
          const content = Array.isArray(item.content) ? item.content : null;
          return { role: item.role, contentType: typeof item.content,
            blocks: content?.map((block) => {
              const value = block && typeof block === "object" ? block as Record<string, unknown> : {};
              return { type: value.type, keys: Object.keys(value).sort() };
            }) ?? null };
        }),
        tools: tools.map((tool) => tool && typeof tool === "object"
          ? { keys: Object.keys(tool as Record<string, unknown>).sort(), name: (tool as Record<string, unknown>).name }
          : { kind: typeof tool }),
        toolChoice: wire.tool_choice && typeof wire.tool_choice === "object"
          ? { keys: Object.keys(wire.tool_choice as Record<string, unknown>).sort(), type: (wire.tool_choice as Record<string, unknown>).type }
          : wire.tool_choice,
      };
      brokerRequests.push(`managed-request-shape ${JSON.stringify({ ...shape, toolResultFacts })}`);
      // Test TLS mediation stands in for OpenShell host injection. Only the
      // exact Messages endpoint receives a capability minted by issueForRun;
      // the OpenCode child receives no bearer token in its environment.
      const continueRequest = async () => {
        const [persisted] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
          .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
        const profileBlob = persisted?.runnerProfileJson && typeof persisted.runnerProfileJson === "object"
          ? persisted.runnerProfileJson as Record<string, unknown> : {};
        const authority = profileBlob.nativeOpenCodeSourceAuthority && typeof profileBlob.nativeOpenCodeSourceAuthority === "object"
          ? profileBlob.nativeOpenCodeSourceAuthority as Record<string, unknown> : {};
        const nativeReceipt = nativeRunInputSourceReceiptSchema.safeParse(profileBlob.nativeInputSourceReceipt);
        const wireIntents = profileBlob.nativeAwModelWireIntents;
        const expected = Array.isArray(authority.toolSchemas) ? authority.toolSchemas.map(value =>
          value && typeof value === "object" ? value as Record<string, unknown> : {}) : [];
        const actual = tools.map(value => value && typeof value === "object" ? value as Record<string, unknown> : {});
        const authorizedPromptHashes = Array.isArray(authority.authorizedPromptHashes)
          ? authority.authorizedPromptHashes.filter((value): value is string => typeof value === "string") : [];
        const userTextFacts = messages.flatMap(message => {
          const item = message && typeof message === "object" ? message as Record<string, unknown> : {};
          if (item.role !== "user") return [];
          const content = Array.isArray(item.content) ? item.content : [];
          return content.flatMap(block => {
            const value = block && typeof block === "object" ? block as Record<string, unknown> : {};
            return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
          });
        }).map((value, index) => ({ index, length: value.length, matchesAuthorizedPrompt: authorizedPromptHashes.includes(
          canonicalHash(value)),
          matchesCanonicalExecutionPrompt: canonicalHash(value) === canonicalManagedPromptHash,
          matchesSubmittedPrompt: submittedPromptFacts.some(prompt => prompt.sha256 === canonicalHash(value)),
          jsonShape: (() => {
            try {
              const parsed = JSON.parse(value) as Record<string, unknown>;
              const task = parsed.task && typeof parsed.task === "object" ? parsed.task as Record<string, unknown> : {};
              const messageText = parsed.message;
              let nestedMessageShape: string[] = [];
              if (typeof messageText === "string") {
                try {
                  const nested = JSON.parse(messageText) as Record<string, unknown>;
                  nestedMessageShape = Object.keys(nested).sort();
                } catch { /* shape only; malformed data is denied by the route */ }
              }
              return { topLevelKeys: Object.keys(parsed).sort(), taskKeys: Object.keys(task).sort(),
                messageType: typeof messageText, messageLength: typeof messageText === "string" ? messageText.length : null,
                nestedMessageKeys: nestedMessageShape };
            } catch { return { parseable: false }; }
          })() }));
        const schemaComparison = expected.map(schema => {
          const actualSchema = actual.find(candidate => toolName(candidate.name) === schema.name);
          const expectedInput = schema.inputSchema;
          const actualInput = actualSchema?.input_schema;
          return { name: schema.name,
            descriptionEqual: actualSchema?.description === schema.description,
            expectedDescriptionPresent: typeof schema.description === "string",
            actualDescriptionPresent: typeof actualSchema?.description === "string",
            expectedDescriptionLength: typeof schema.description === "string" ? schema.description.length : null,
            actualDescriptionLength: typeof actualSchema?.description === "string" ? actualSchema.description.length : null,
            expectedDescriptionPrefixesActual: typeof schema.description === "string" && typeof actualSchema?.description === "string"
              ? schema.description.startsWith(actualSchema.description) : null,
            actualDescriptionPrefixesExpected: typeof schema.description === "string" && typeof actualSchema?.description === "string"
              ? actualSchema.description.startsWith(schema.description) : null,
            schemaEqual: canonicalHash(expectedInput) === canonicalHash(actualInput),
            expectedSchemaKeys: expectedInput && typeof expectedInput === "object" ? Object.keys(expectedInput).sort() : [],
            actualSchemaKeys: actualInput && typeof actualInput === "object" ? Object.keys(actualInput).sort() : [],
            descriptionDiffPaths: differencePaths(schema.description, actualSchema?.description, "description"),
            schemaDiffPaths: differencePaths(expectedInput, actualInput, "input_schema"),
            expectedAdditionalProperties: expectedInput && typeof expectedInput === "object"
              ? valueCategory((expectedInput as Record<string, unknown>).additionalProperties) : "absent",
            actualAdditionalProperties: actualInput && typeof actualInput === "object"
              ? valueCategory((actualInput as Record<string, unknown>).additionalProperties) : "absent",
            expectedSchemaHash: canonicalHash(expectedInput), actualSchemaHash: canonicalHash(actualInput) };
        });
        brokerRequests.push(`managed-tool-schema-comparison ${JSON.stringify({ expectedNames: expected.map(schema => schema.name),
          actualNames: actual.map(schema => toolName(schema.name)), tools: schemaComparison, userTextFacts,
          nativeReceiptPresent: nativeReceipt.success,
          bootstrapSourceKinds: nativeReceipt.success ? nativeReceipt.data.bootstrap.inputs.map(source => source.kind).sort() : [],
          nativeReceiptDispatchCount: nativeReceipt.success ? nativeReceipt.data.dispatches.length : null,
          wireIntentArray: Array.isArray(wireIntents), wireIntentCount: Array.isArray(wireIntents) ? wireIntents.length : null,
          toolResultCaptureCount: Array.isArray(profileBlob.nativeToolResultSourceCaptures)
            ? profileBlob.nativeToolResultSourceCaptures.length : null,
          submittedPromptFacts: submittedPromptFacts.map(prompt => ({ length: prompt.length,
            matchesAuthorizedPrompt: authorizedPromptHashes.includes(prompt.sha256),
            matchesCanonicalExecutionPrompt: prompt.sha256 === canonicalManagedPromptHash,
            matchesWireText: userTextFacts.some(fact => fact.length === prompt.length && fact.matchesSubmittedPrompt) })),
          authorizedPromptCount: authorizedPromptHashes.length, canonicalManagedPromptLength: canonicalManagedPrompt.length,
          authorityContainsCanonicalPrompt: authorizedPromptHashes.includes(canonicalManagedPromptHash) })}`);
        req.headers.authorization = `Bearer ${minted.token}`;
        next();
      };
      if (managedConfigReadOnlyVerified) void continueRequest().catch(next);
      else void assertManagedConfigIsReadOnlyBeforeSpawn().then(() => {
        managedConfigReadOnlyVerified = true;
        return continueRequest();
      }).catch(next);
    });
    app.use(runtimeConnectionIntentRoutes(db, gateway));
    app.use((error: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const name = error instanceof Error ? error.name : "UnknownError";
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack?.split("\n").slice(1, 5).join(" | ") : "";
      brokerRequests.push(`route-error ${req.method} ${req.path} ${name}: ${message} ${stack}`);
      next(error);
    });
    app.use(errorHandler);
    const broker = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, app);
    await new Promise<void>((resolveListen, reject) => {
      broker.once("error", reject);
      broker.listen(0, "127.0.0.1", () => { broker.off("error", reject); resolveListen(); });
    });
    const address = broker.address();
    if (!address || typeof address === "string") throw new Error("Expected local HTTPS listener.");
    setupRunnerPrpWebSocketServer(broker, { apiUrl: `https://127.0.0.1:${address.port}` });
    const runnerEnvironment = { PATH: `${dirname(opencodeBinary)}:${process.env.PATH ?? ""}`, SSL_CERT_FILE: certBundlePath,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: String(profile.inputTokensUpperBound),
      PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: String(profile.maxOutputTokens),
      PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: `https://127.0.0.1:${address.port}` };
    const qualifiedOpenCodeSha256 = createHash("sha256")
      .update(await readFile(opencodeBinary)).digest("hex");
    const diagnostics: string[] = [];
    const openCodeProcessFacts: Array<{ shaMatchesQualifiedBinary: boolean; managedEnvironment: Record<string, boolean> }> = [];
    const capabilityPayload = JSON.parse(Buffer.from(minted.token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    const workerModelClaims = capabilityPayload.worker_model && typeof capabilityPayload.worker_model === "object"
      ? capabilityPayload.worker_model as Record<string, unknown> : {};
    const [livePlan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id));
    const [liveWorker] = await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.id, worker!.id));
    const [liveAttempt] = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, run!.id));
    const [liveRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    const [liveManifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.id, manifest!.record.id));
    const liveTask = (await db.select().from(issues).where(eq(issues.id, task.id)))[0];
    const manifestBody = liveManifest?.manifest as Record<string, unknown> | undefined;
    const manifestPrincipal = manifestBody?.responsibleUserId;
    diagnostics.push(`governance fixture predicates: ${JSON.stringify({
      planStatus: livePlan?.status, planActionClass: livePlan?.actionClass, planRiskClass: livePlan?.riskClass,
      planStarted: livePlan?.startedAt instanceof Date, planUnexpired: livePlan?.startedAt instanceof Date &&
        Date.now() < livePlan.startedAt.getTime() + Number(livePlan.budgets.maxWallClockSeconds) * 1000,
      planVersionMatchesCapability: livePlan?.version === workerModelClaims.expectedPlanVersion,
      budgetCostAvailable: livePlan?.budgets.maxModelCostMinor !== null && livePlan?.budgets.maxModelCostMinor !== undefined,
      workerRunning: liveWorker?.status === "running", workerAgentMatches: liveWorker?.agentId === agentId,
      attemptRunning: liveAttempt?.status === "running", attemptAgentMatches: liveAttempt?.agentId === agentId,
      attemptRunMatches: liveAttempt?.runId === run!.id, attemptManifestMatches: liveAttempt?.executionManifestId === manifest!.record.id,
      runRunning: liveRun?.status === "running", runNative: liveRun?.runtimeMode === "native",
      runTaskMatches: liveRun?.nativeIssueId === task.id, runUserMatches: liveRun?.responsibleUserId === aliceUserId,
      manifestPrincipalMatches: manifestPrincipal === aliceUserId,
      manifestScopesCompanyScoped: !!liveManifest?.manifest.executionScope.delegatedScopes.every(scope => scope.companyId === companyId),
      taskAssigned: liveTask?.assigneeAgentId === agentId, taskRunMatches: liveTask?.executionRunId === run!.id,
    })}`);
    let runtimeDirectory = "";
    let configDirectory = "";
    let completedNativeFinalization: {
      result: Record<string, unknown>; terminal: PrpTerminalState; turnId: string | null;
      normalizedSessionId: string; sourceInstanceId: string;
    } | null = null;
    const processTreeTimers: ReturnType<typeof setInterval>[] = [];
    let managedProviderConfigReported = false;
    const pgMonitor = postgres(input.connectionString, { max: 1 });
    let pgMonitorTimer: ReturnType<typeof setInterval> | undefined;
    let pgMonitorInFlight = false;
    const inspectPostgresWaits = async () => {
      if (pgMonitorInFlight) return;
      pgMonitorInFlight = true;
      try {
        const [sample] = await pgMonitor<{ active: number; idleInTransaction: number; waiters: Array<{
          pid: number; waitEventType: string | null; waitEvent: string | null; blockedBy: number[]; queryKind: string;
        }> }[]>`
          select count(*) filter (where state = 'active')::int as active,
            count(*) filter (where state = 'idle in transaction')::int as "idleInTransaction",
            coalesce(json_agg(json_build_object('pid', pid, 'waitEventType', wait_event_type,
              'waitEvent', wait_event, 'blockedBy', pg_blocking_pids(pid),
              'queryKind', case when query ilike '%issues%' then 'issues'
                when query ilike '%heartbeat_runs%' then 'heartbeat_runs'
                when query ilike '%native_run_finalizations%' then 'run_finalizations'
                else lower(split_part(query, ' ', 1)) end))
              filter (where state = 'active' and wait_event_type is not null), '[]'::json) as waiters
          from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
        `;
        if (sample) diagnostics.push(`independent PG wait sample: ${JSON.stringify(sample)}`);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code : "unavailable";
        diagnostics.push(`independent PG wait sample unavailable: ${code}`);
      } finally {
        pgMonitorInFlight = false;
      }
    };
    const findManagedOpenCodeConfig = async (directory: string, depth = 0): Promise<string | null> => {
      if (depth > 16) return null;
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          const found = await findManagedOpenCodeConfig(path, depth + 1);
          if (found) return found;
        } else if (entry.isFile() && entry.name === "opencode.json" &&
          directory.endsWith(`${join("config", "opencode")}`)) return directory;
      }
      return null;
    };
    const assertManagedConfigIsReadOnlyBeforeSpawn = async () => {
      if (!configDirectory) {
        const found = await findManagedOpenCodeConfig(join(root, "instances", instanceId));
        if (!found) throw new Error("managed_opencode_config_not_found");
        configDirectory = found;
        runtimeDirectory = dirname(dirname(dirname(configDirectory)));
      }
      const [directory, ignore, config, plugin] = await Promise.all([
        stat(configDirectory), stat(join(configDirectory, ".gitignore")),
        stat(join(configDirectory, "opencode.json")), stat(join(configDirectory, "plugins", "paperclip-source-witness.js")),
      ]);
      const modes = [directory.mode & 0o777, ignore.mode & 0o777, config.mode & 0o777, plugin.mode & 0o777];
      if (modes.some((mode, index) => mode !== [0o500, 0o400, 0o400, 0o400][index]))
        throw new Error(`managed_opencode_config_not_read_only_before_spawn:${modes.map(mode => mode.toString(8)).join(",")}`);
      diagnostics.push(`managed config modes before spawn: ${modes.map(mode => mode.toString(8)).join(",")}`);
      if (!managedProviderConfigReported) {
        const config = JSON.parse(await readFile(join(configDirectory, "opencode.json"), "utf8")) as Record<string, unknown>;
        const provider = config.provider && typeof config.provider === "object"
          ? (config.provider as Record<string, unknown>).anthropic as Record<string, unknown> | undefined : undefined;
        const options = provider?.options && typeof provider.options === "object"
          ? provider.options as Record<string, unknown> : {};
        diagnostics.push(`managed provider config: apiKey=${options.apiKey === "paperclip-managed-model-broker" ? "placeholder" : "missing"} baseURL=${typeof options.baseURL === "string" && options.baseURL.startsWith("https://127.0.0.1:") ? "local" : "missing"}`);
        managedProviderConfigReported = true;
      }
    };
    const onSpawn = async ({ pid }: { pid: number }) => {
      diagnostics.push(`runner process pid ${pid}`);
      const observed = new Set<number>();
      const inspect = async () => {
        const descendants: Array<{ pid: number; parent: number }> = [];
        const pending = [pid];
        const parents = new Map<number, number>();
        for (let depth = 0; pending.length > 0 && depth < 8; depth += 1) {
          const parentPid = pending.shift()!;
          const children = await readFile(`/proc/${parentPid}/task/${parentPid}/children`, "utf8").catch(() => "");
          for (const rawChildPid of children.trim().split(/\s+/)) {
            const childPid = Number(rawChildPid);
            if (!Number.isSafeInteger(childPid) || childPid <= 0 || parents.has(childPid)) continue;
            parents.set(childPid, parentPid);
            descendants.push({ pid: childPid, parent: parentPid });
            pending.push(childPid);
          }
        }
        for (const { pid: childPid, parent: parentPid } of descendants) {
          if (observed.has(childPid)) continue;
          observed.add(childPid);
          const [executablePath, comm, environmentText] = await Promise.all([
            readlink(`/proc/${childPid}/exe`).catch(() => "unknown"),
            readFile(`/proc/${childPid}/comm`, "utf8").catch(() => "unknown"),
            readFile(`/proc/${childPid}/environ`, "utf8").catch(() => ""),
          ]);
          const environment = environmentText.split("\0");
          const executable = executablePath.split("/").at(-1) || "unknown";
          const isOpenCodeProcess = /opencode/i.test(executable);
          let openCodeShaMatches: boolean | null = null;
          let openCodeManagedEnvironment: Record<string, boolean> | null = null;
          if (isOpenCodeProcess) {
            const runningHash = await readFile(`/proc/${childPid}/exe`).then(bytes =>
              createHash("sha256").update(bytes).digest("hex")).catch(() => "");
            openCodeShaMatches = runningHash === qualifiedOpenCodeSha256;
            openCodeManagedEnvironment = {
              brokerOrigin: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")),
              inputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=")),
              outputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=")),
              placeholderKey: environment.includes("ANTHROPIC_API_KEY=paperclip-managed-model-broker"),
            };
            openCodeProcessFacts.push({ shaMatchesQualifiedBinary: openCodeShaMatches, managedEnvironment: openCodeManagedEnvironment });
          }
          diagnostics.push(`runner descendant pid=${childPid} parent=${parentPid} executable=${executable} comm=${comm.trim()} openCode=${isOpenCodeProcess ? "yes" : "no"} brokerOrigin=${environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")) ? "present" : "missing"} inputCap=${environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=")) ? "present" : "missing"} outputCap=${environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=")) ? "present" : "missing"} placeholderKey=${environment.includes("ANTHROPIC_API_KEY=paperclip-managed-model-broker") ? "present" : "missing"}`);
          if (isOpenCodeProcess)
            diagnostics.push(`OpenCode child qualification: ${JSON.stringify({ shaMatchesQualifiedBinary: openCodeShaMatches, managedEnvironment: openCodeManagedEnvironment })}`);
        }
      };
      const timer = setInterval(() => { void inspect(); }, 250);
      void inspect();
      processTreeTimers.push(timer);
    };
    try {
      const result = await executePaperclipNativeSession({ db, execution, bootstrapSourceClosure, useRunnerd: true, onSpawn,
        runnerInstanceId: prepared.runnerInstanceId, leaseOwner, turnTimeoutMs: 90_000, adapterType: "paperclip_runner",
        runnerEnvironment, onLog: async (stream, chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const envelope = JSON.parse(line) as Record<string, unknown>;
              const event = envelope.event && typeof envelope.event === "object" ? envelope.event as Record<string, unknown> : null;
              if (event) {
                const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
                if (event.eventType === "turn.submitted") {
                  const submittedText = typeof payload.text === "string" ? payload.text :
                    payload.message && typeof payload.message === "object" && typeof (payload.message as Record<string, unknown>).text === "string"
                      ? (payload.message as Record<string, unknown>).text as string : null;
                  if (submittedText !== null) submittedPromptFacts.push({ length: submittedText.length,
                    sha256: canonicalHash(submittedText) });
                  diagnostics.push(`turn submitted prompt metadata: ${JSON.stringify({ textPresent: submittedText !== null,
                    textLength: submittedText?.length ?? null })}`);
                }
                const safe = { eventType: event.eventType, payloadType: payload.type, status: payload.status,
                  code: payload.code, reasonCode: payload.reasonCode,
                  tool: typeof payload.name === "string" ? payload.name : undefined,
                  payloadKeys: Object.keys(payload).sort() };
                diagnostics.push(`runner ${stream} event: ${JSON.stringify(safe)}`);
                if (event.eventType === "semantic_tool.result") {
                  const semantic = payload.semantic_tool && typeof payload.semantic_tool === "object"
                    ? payload.semantic_tool as Record<string, unknown> : {};
                  const correlation = semantic.correlation && typeof semantic.correlation === "object"
                    ? semantic.correlation as Record<string, unknown> : {};
                  diagnostics.push(`runner semantic tool result: ${JSON.stringify({
                    code: typeof semantic.code === "string" && /^[a-z0-9_]{1,100}$/.test(semantic.code) ? semantic.code : null,
                    outcome: semantic.outcome, phase: semantic.phase,
                    callIdPresent: typeof semantic.callId === "string" && semantic.callId.length > 0,
                    operationIdPresent: typeof semantic.operationId === "string" && semantic.operationId.length > 0,
                    operationReceiptIdPresent: typeof semantic.operationReceiptId === "string" && semantic.operationReceiptId.length > 0,
                    correlationKeys: Object.keys(correlation).sort(),
                  })}`);
                }
                if (event.eventType === "session.started")
                  void assertManagedConfigIsReadOnlyBeforeSpawn().catch(() => diagnostics.push("managed config probe unavailable"));
                if (event.eventType === "session.started" && !pgMonitorTimer) {
                  pgMonitorTimer = setInterval(() => { void inspectPostgresWaits(); }, 5_000);
                  void inspectPostgresWaits();
                }
                if (event.eventType === "turn.failed") {
                  const failure = payload.error;
                  if (typeof failure === "string")
                    diagnostics.push(`runner turn failure: ${failure.replaceAll(credential, "<redacted>").slice(0, 240)}`);
                  else if (failure && typeof failure === "object" && !Array.isArray(failure)) {
                    const details = failure as Record<string, unknown>;
                    const data = details.data && typeof details.data === "object" && !Array.isArray(details.data)
                      ? details.data as Record<string, unknown> : {};
                    diagnostics.push(`runner turn failure: ${JSON.stringify({ name: details.name, code: details.code,
                      message: typeof details.message === "string" ? details.message.replaceAll(credential, "<redacted>").slice(0, 240) : undefined,
                      keys: Object.keys(details).sort(), dataKeys: Object.keys(data).sort(), dataCode: data.code,
                      dataStatus: data.statusCode ?? data.status,
                      dataMessage: typeof data.message === "string" ? data.message.replaceAll(credential, "<redacted>").slice(0, 240) : undefined })}`);
                  }
                }
              }
            } catch {
              if (stream === "stderr" && /(?:error|failed|failure|denied|unavailable|timeout|timed out|disconnect|exit code|command_execution_failed)/i.test(line))
                diagnostics.push(`runner stderr: ${line.replace(/\s+/g, " ").slice(0, 240)}`);
            }
          }
        } }).catch(error => {
          input.onPreserveDebugArtifacts?.();
          const failure = error instanceof Error ? error as Error & { code?: unknown; cause?: { code?: unknown }; stage?: unknown } : null;
          const safeCode = (value: unknown) => typeof value === "string" && /^[a-z0-9_]{1,120}$/i.test(value) ? value : undefined;
          const frames = failure?.stack?.split("\n").slice(1)
            .filter(line => /^\s*at /.test(line)).slice(0, 6)
            .map(line => line.trim().replace(/\s+/g, " ").slice(0, 220)) ?? [];
          const metadata = { name: failure?.name ?? "UnknownError", code: safeCode(failure?.code),
            causeCode: safeCode(failure?.cause?.code), stage: safeCode(failure?.stage), frames };
          diagnostics.push(`execution failure metadata: ${JSON.stringify(metadata)}`);
          const safeMessage = safeCode(failure?.message) ?? "native_session_execution_failed";
          throw new Error(`${safeMessage}\n${diagnostics.join("\n")}\nBroker: ${brokerRequests.join(", ")}\nArtifacts: ${runRoot}`);
        });
      if (result.exitCode !== 0) {
        input.onPreserveDebugArtifacts?.();
        const [failedRun] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
          .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
        const failedProfile = failedRun?.runnerProfileJson && typeof failedRun.runnerProfileJson === "object"
          ? failedRun.runnerProfileJson as Record<string, unknown> : {};
        const failedIntents = Array.isArray(failedProfile.nativeAwModelWireIntents) ? failedProfile.nativeAwModelWireIntents : [];
        const writeUses = failedIntents.flatMap(value => {
          const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return Array.isArray(intent.responseToolUses) ? intent.responseToolUses.flatMap(useValue => {
            const use = useValue && typeof useValue === "object" ? useValue as Record<string, unknown> : {};
            return toolName(use.name) === "write_document" && use.id === "managed-e2e-write-1" ? [use] : [];
          }) : [];
        });
        const associations = Array.isArray(failedProfile.nativeToolCallDispatchAssociations)
          ? failedProfile.nativeToolCallDispatchAssociations as Array<Record<string, unknown>> : [];
        const captures = Array.isArray(failedProfile.nativeToolResultSourceCaptures)
          ? failedProfile.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
        const invocations = await db.select({ toolName: toolInvocations.toolName, status: toolInvocations.status })
          .from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, run!.id)));
        const documentPrefixFacts = await Promise.all(modelSteps.filter(step => step.tool === "write_document").map(async step => {
          const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step)}`;
          const key = typeof step.input?.key === "string" ? step.input.key : "";
          const visible = key ? await documentService(db).getIssueDocumentByKey(task.id, key) : undefined;
          const [revision] = visible?.latestRevisionId ? await db.select({ payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot })
            .from(documentRevisions).where(eq(documentRevisions.id, visible.latestRevisionId)) : [];
          const snapshot = revision?.payloadSourceSnapshot && typeof revision.payloadSourceSnapshot === "object"
            ? revision.payloadSourceSnapshot as Record<string, unknown> : {};
          const snapshotInputs = Array.isArray(snapshot.inputs) ? snapshot.inputs as Array<Record<string, unknown>> : [];
          const matchingIntents = failedIntents.filter(value => {
            const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
            return Array.isArray(intent.responseToolUses) && intent.responseToolUses.some(useValue => {
              const use = useValue && typeof useValue === "object" ? useValue as Record<string, unknown> : {};
              return use.id === callId && toolName(use.name) === "write_document";
            });
          });
          const components = matchingIntents.flatMap(value => {
            const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
            return Array.isArray(intent.consumedSourceComponents)
              ? intent.consumedSourceComponents as Array<Record<string, unknown>> : [];
          });
          const ownToolResultInComponents = components.some(component =>
            (Array.isArray(component.inputs) ? component.inputs as Array<Record<string, unknown>> : [])
              .some(source => source.kind === "tool_result" && source.callId === callId));
          return { snapshotInputCount: snapshotInputs.length,
            snapshotInputKinds: snapshotInputs.map(source => typeof source.kind === "string" ? source.kind : "unknown").sort(),
            snapshotIncludesOwnToolResult: snapshotInputs.some(source => source.kind === "tool_result" && source.callId === callId),
            matchingIntentCount: matchingIntents.length,
            consumedComponentCount: components.length,
            consumedComponentKinds: components.map(component => typeof component.kind === "string" ? component.kind : "unknown").sort(),
            intentSetIncludesOwnToolResult: ownToolResultInComponents };
        }));
        const writeInvocationStatusCounts = Object.fromEntries(["executing", "succeeded", "failed", "cancelled"].map(status =>
          [status, invocations.filter(value => value.toolName === "write_document" && value.status === status).length]));
        diagnostics.push(`managed write capture facts: ${JSON.stringify({ providerWriteUseCount: writeUses.length,
          matchingAssociationCount: associations.filter(value => value.callId === "managed-e2e-write-1" &&
            toolName(value.tool) === "write_document").length,
          matchingCaptureCount: captures.filter(value => value.callId === "managed-e2e-write-1" &&
            value.managedOpenCode === true && toolName(value.tool) === "write_document").length,
          writeInvocationStatusCounts,
          succeededCanonicalInvocationCount: invocations.filter(value => value.toolName === "write_document" &&
            value.status === "succeeded").length,
          managedToolResultErrorCodes: diagnostics.flatMap(line => [...line.matchAll(/managed_opencode_tool_result_[a-z_]+/g)]
            .map(match => match[0]).filter((value, index, all) => all.indexOf(value) === index)) })}`);
        diagnostics.push(`managed document prefix facts: ${JSON.stringify(documentPrefixFacts)}`);
        throw new Error(`managed_opencode_runner_exit_${result.exitCode}; providerResponses=${responseCount}; fakeFetchEntrances=${JSON.stringify(fakeFetchEntrances)}\n${diagnostics.join("\n")}\nBroker: ${brokerRequests.join(", ")}\nArtifacts: ${runRoot}`);
      }
      completedNativeFinalization = (result as unknown as Record<string, unknown>).nativeFinalization as NonNullable<typeof completedNativeFinalization>;
      expect(responseCount).toBeGreaterThanOrEqual(2);
      const assertManagedConfigCleanup = async () => {
        expect((await stat(configDirectory)).mode & 0o777).toBe(0o700);
        expect((await stat(join(configDirectory, ".gitignore"))).mode & 0o777).toBe(0o400);
        await expect(stat(join(configDirectory, "opencode.json"))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(join(configDirectory, "plugins", "paperclip-source-witness.js"))).rejects.toMatchObject({ code: "ENOENT" });
      };
      await assertManagedConfigCleanup();
      // Reopen the same normalized session directory to exercise warm XDG
      // reuse: the driver must restore owner write bits before replacing its
      // files, then return the directory and ignore file to read-only before
      // OpenCode starts and attempts its implicit SDK install.
      const warmDriver = new OpenCodeServerDriver({ model: execution.provider.model!,
        runtimeDirectory, command: opencodeBinary, runnerInstanceId: prepared.runnerInstanceId,
        systemInstructions: "Warm managed runtime startup probe.", environment: runnerEnvironment,
        onSpawn: assertManagedConfigIsReadOnlyBeforeSpawn,
        onDiagnostic: message => diagnostics.push(message) });
      const warmSession = await warmDriver.openSession({ runId: run!.id,
        normalizedSessionId: prepared.normalizedSessionId, workingDirectory: execution.workspace.cwd });
      await warmSession.close({ reason: "managed E2E warm-start probe complete" });
      await assertManagedConfigCleanup();
    } finally {
      for (const timer of processTreeTimers) clearInterval(timer);
      if (pgMonitorTimer) clearInterval(pgMonitorTimer);
      await pgMonitor.end({ timeout: 1 });
      broker.closeAllConnections();
      await new Promise<void>(resolveClose => broker.close(() => resolveClose()));
    }
    const [persistedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    const sourceReceipt = persistedRun!.runnerProfileJson as Record<string, unknown>;
    expect(sourceReceipt.nativeOpenCodeSourceAuthority).toMatchObject({ version: 1, toolSchemas: expect.any(Array) });
    expect(persistedRun!.nativeInputSourceProtocolVersion).toBe(1);
    expect(nativeRunInputSourceReceiptSchema.safeParse(sourceReceipt.nativeInputSourceReceipt).success).toBe(true);
    const effectSteps = modelSteps.filter(step => ["write_document", "create_task", "self_remember", "read_context"]
      .includes(step.tool));
    const capturedResults = Array.isArray(sourceReceipt.nativeToolResultSourceCaptures)
      ? sourceReceipt.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
    for (const [index, step] of effectSteps.entries()) {
      const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step)}`;
      expect(capturedResults, `missing managed output source capture for step ${index}:${step.tool}`)
        .toEqual(expect.arrayContaining([expect.objectContaining({ managedOpenCode: true, callId })]));
    }
    const documentSteps = modelSteps.filter(step => step.tool === "write_document");
    // Exercise the real current-source HTTP reader after the producer run is
    // terminal and the exact output is published on an open Task.
    const nativeFinalization = completedNativeFinalization;
    expect(nativeFinalization).not.toBeNull();
    if (!nativeFinalization) throw new Error("managed_opencode_finalization_missing");
    const controlPlane = new PaperclipControlPlanePort(db, {
      companyId, issueId: task.id, runId: run!.id, agentId,
      sessionId: nativeFinalization.normalizedSessionId,
      completionContractId: contractRow.id, completionContractSha256: contractRow.canonicalSha256,
      sourceInstanceId: nativeFinalization.sourceInstanceId,
      controlPlaneSourceInstanceId: nativeFinalization.sourceInstanceId,
    });
    await controlPlane.completeRun({ result: nativeFinalization.result as PrpStructuredRunResult,
      terminal: nativeFinalization.terminal, turnId: nativeFinalization.turnId,
      callerResultId: `managed-opencode-e2e:${run!.id}` });
    await finalizeNativeRun({ db, runId: run!.id, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    const [terminalRun] = await db.select({ status: heartbeatRuns.status, nativePhase: heartbeatRuns.nativePhase })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    expect(terminalRun?.status).toBe("succeeded");
    expect(completedHumanActions.size).toBe(input.humanActions?.length ?? 0);
    const bobApp = express();
    bobApp.use(express.json());
    bobApp.use((req, _res, next) => { req.actor = bobActor as typeof req.actor; next(); });
    bobApp.use("/api", issueRoutes(db, {} as never)); bobApp.use(errorHandler);
    const documents = [] as Array<{ key: string; id: string | null; snapshot: unknown; aliceHttpStatus: number; bobHttpStatus: number }>;
    for (const step of documentSteps) {
      const key = typeof step.input?.key === "string" ? step.input.key : null;
      if (!key) throw new Error("managed_fixture_document_key_missing");
      const visibleDocument = await documentService(db).getIssueDocumentByKey(task.id, key);
      const [documentLink] = await db.select().from(issueDocuments)
        .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id)));
      expect(documentLink).toBeDefined();
      const expectedBody = step.input?.body;
      if (typeof expectedBody === "string") expect(visibleDocument?.body).toContain(expectedBody);
      let snapshot: unknown;
      if (visibleDocument?.latestRevisionId) {
        const [snapshotRow] = await db.select({ payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot })
          .from(documentRevisions).where(eq(documentRevisions.id, visibleDocument.latestRevisionId));
        expect(nativePayloadSourceSnapshotSchema.safeParse(snapshotRow?.payloadSourceSnapshot).success).toBe(true);
        snapshot = snapshotRow?.payloadSourceSnapshot;
      }
      const aliceHttpDocument = await request(humanApp).get(`/api/issues/${task.id}/documents/${encodeURIComponent(key)}`);
      expect(aliceHttpDocument.status).toBe(200);
      if (typeof expectedBody === "string") expect(aliceHttpDocument.body.body).toContain(expectedBody);
      const bobHttpDocument = await request(bobApp).get(`/api/issues/${task.id}/documents/${encodeURIComponent(key)}`);
      documents.push({ key, id: visibleDocument?.id ?? null, snapshot,
        aliceHttpStatus: aliceHttpDocument.status, bobHttpStatus: bobHttpDocument.status });
    }
    const reservations = await db.select().from(orchestrationModelReservations)
      .where(and(eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.planId, plan.id)));
    expect(reservations.length).toBeGreaterThanOrEqual(2);
    expect(reservations.every(reservation => reservation.status === "completed" && reservation.providerResponseHash)).toBe(true);
    expect(modelCalls.every(call => call.model === model && Array.isArray(call.messages))).toBe(true);
    expect(JSON.stringify(persistedRun!.runnerProfileJson)).not.toContain(minted.token);
    const actualInvocations = await db.select().from(toolInvocations)
      .where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, run!.id)));
    const toolResults = actualInvocations.flatMap(invocation => {
      try {
        if (typeof invocation.idempotencyKey !== "string" || !invocation.idempotencyKey.startsWith(`aw-native-tool:${run!.id}:`)) return [];
        const result = (typeof invocation.workflowResultJson === "string"
          ? JSON.parse(invocation.workflowResultJson) : invocation.workflowResultJson) as Record<string, unknown>;
        const record = result.record && typeof result.record === "object" ? result.record as Record<string, unknown> : null;
        const task = result.task && typeof result.task === "object" ? result.task as Record<string, unknown> : null;
        return [{ invocationId: invocation.id, callId: invocation.idempotencyKey.slice(`aw-native-tool:${run!.id}:`.length),
          toolName: invocation.toolName, status: invocation.status, result,
          memoryId: typeof record?.id === "string" ? record.id : null,
          taskId: typeof task?.id === "string" ? task.id : null }];
      } catch { return []; }
    });
    const memoryOutputs = await Promise.all(toolResults.filter(value => value.toolName === "paperclip-self:remember" && value.memoryId)
      .map(async value => ({ ...value, currentForAlice: await memoryService(db).get(companyId, value.memoryId!, aliceMemoryActor),
        currentForBob: await memoryService(db).get(companyId, value.memoryId!, bobMemoryActor) })));
    const childTaskIds = toolResults.flatMap(value => value.taskId ? [value.taskId] : []);
    const childTasks = childTaskIds.length ? await db.select().from(issues)
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, childTaskIds))) : [];
    const contextReadCaptures = capturedResults.filter(value => value.contextRead !== undefined);
    return {
      companyId,
      agentId,
      reuseIdentity: { companyId, agentId, aliceUserId, bobUserId },
      runId: run!.id,
      issueId: task.id,
      aliceUserId,
      aliceActor: human,
      bobActor,
      aliceMemoryActor,
      bobUserId,
      bobMemoryActor,
      documents,
      sourceReceipt: sourceReceipt.nativeInputSourceReceipt,
      toolResultSourceCaptures: sourceReceipt.nativeToolResultSourceCaptures,
      toolInvocations: actualInvocations,
      toolResults,
      memoryOutputs,
      acceptedMemoryIds,
      contextReadCaptures,
      contextResultConsumers,
      childTasks,
      modelCalls: modelCalls.length,
      completedRun: terminalRun,
      nativeFinalization,
    };
}
