import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  agents,
  createDb,
  heartbeatRuns,
  completionContracts,
  companyMemberships,
  documentRevisions,
  issueDocuments,
  issues,
  orchestrationModelReservations,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
  nativeRunFinalizations,
} from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema,
  type NativePayloadSourceInput } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { seedV5Presences, enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { seedNativePasskeySession } from "../../__tests__/helpers/native-authentication-fixtures.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../agent-runtime-fabric.js";
import { aiConnectionService } from "../ai-connections.js";
import { issueService } from "../issues.js";
import { documentService } from "../documents.js";
import { instanceSettingsService } from "../instance-settings.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { workerModelGateway } from "../orchestration/worker-model-gateway.js";
import { hashContextPolicySnapshot } from "../context/context-manifest.js";
import { discoverNativeCapabilities } from "../native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../provider-capabilities.js";
import { runtimeConnectionIntentRoutes } from "../../routes/connection-intents.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { issueRoutes } from "../../routes/issues.js";
import { prepareNativeHeartbeatRun } from "./prepare-native-run.js";
import { executePaperclipNativeSession } from "./native-session-executor.js";
import { buildNativeExecutionInput, buildNativeBootstrapSourceSet } from "./native-execution-input.js";
import { buildRetainedNativeRuntimeContext } from "./runtime-context.js";
import { getIssueExecutionContext, buildPaperclipTaskMarkdown } from "../heartbeat.js";
import { workerModelProfileSchema, type WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import { currentNativeControllerIdentity } from "./native-restart-recovery.js";
import { nativeCompletionContractInput } from "./completion-contracts.js";
import { resolveDefaultAgentWorkspaceDir } from "../../home-paths.js";
import { createOpenCodeNativeSessionBackend } from "@paperclipai/paperclip-runner";

const OPENCODE = "/workspace/.cloud-setup/lockfile/node_modules/.pnpm/opencode-linux-x64@1.18.32/node_modules/opencode-linux-x64/bin/opencode";
const sourceSha = "a".repeat(40);
const credential = `e2e-only-${randomUUID()}`;

function toolName(value: unknown): string {
  let name = typeof value === "string" ? value : "";
  for (const prefix of ["paperclip__", "paperclip_", "paperclip."])
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}

async function makeFixtureTreeWritable(target: string): Promise<void> {
  const metadata = await lstat(target).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(target, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory())
    for (const name of await readdir(target)) await makeFixtureTreeWritable(join(target, name));
}

describe("managed OpenCode source-closure binary integration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root: string;

  beforeAll(async () => {
    if (process.platform !== "linux") throw new Error("This fixture pins the installed Linux OpenCode binary.");
    root = await mkdtemp(join(tmpdir(), "managed-opencode-source-e2e-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", `managed-opencode-${randomUUID()}`);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-opencode-e2e-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-opencode-source-e2e-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
      role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true });
  }, 60_000);

  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("executes a governed document write through OpenCode 1.18.32 and the real managed Messages route", async () => {
    expect(execFileSync(OPENCODE, ["--version"], { encoding: "utf8" }).trim()).toBe("1.18.32");
    const runRoot = await mkdtemp(join(root, "run-"));
    const keyPath = join(runRoot, "broker-key.pem");
    const certPath = join(runRoot, "broker-cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
      "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost", "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,digitalSignature,keyCertSign,keyEncipherment"], { stdio: "ignore" });
    await chmod(keyPath, 0o600);
    const certBundlePath = join(runRoot, "broker-trust-bundle.pem");
    await writeFile(certBundlePath, Buffer.concat([await readFile("/etc/ssl/certs/ca-certificates.crt"),
      Buffer.from("\n"), await readFile(certPath)]), { mode: 0o600 });
    const f = await seedV5Presences(db);
    const sessionId = await seedNativePasskeySession(db, f.userId);
    const [membership] = await db.select({ companyId: companyMemberships.companyId,
      membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
      .from(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    if (!membership) throw new Error("Current Human company membership is unavailable.");
    const human = { ...f.actor, sessionId, memberships: [membership] };
    const companyId = f.home;
    const agentId = f.presence.id;
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

    const issued = await aiConnectionService(db).save(companyId, f.userId, {
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
        responsibleUserId: f.userId });
    expect(createTaskResponse.status, JSON.stringify(createTaskResponse.body)).toBe(201);
    const createdTask = createTaskResponse.body as { id: string };
    await db.update(issues).set({ status: "todo", assigneeAgentId: agentId })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, createdTask.id)));
    const task = (await db.select().from(issues).where(eq(issues.id, createdTask.id)))[0]!;
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, responsibleUserId: f.userId,
      status: "running", runtimeMode: "native", nativeIssueId: task.id, contextSnapshot: { issueId: task.id } }).returning();
    const manifest = await agentRuntimeFabricService(db).prepare({ companyId, agentId, runId: run!.id,
      responsibleUserId: f.userId, issueId: task.id, query: task.title });
    const plan = await orchestrationService(db).create(human, companyId, {
      issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
      completionContract: { objective: "Save the internal note", requiredOutputs: [{ key: "note" }],
        businessInvariants: ["Use only this task's private workspace"] },
      budgets: { maxModelCostMinor: 10, maxToolActions: 2 }, workers: [{ key: "writer", issueId: task.id }],
    });
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(),
      executionPrincipal: { type: "user", userId: f.userId } }).where(eq(orchestrationPlans.id, plan.id));
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
    const modelCalls: Array<Record<string, unknown>> = [];
    const brokerRequests: string[] = [];
    const gateway = workerModelGateway(db, {
      profiles: [profile], sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid",
      fetch: async (url, init) => {
        expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
        expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        modelCalls.push(body);
        responseCount += 1;
        const tools = (body.tools as Array<Record<string, unknown>>) ?? [];
        if (responseCount === 1) {
          const writeTool = tools.find(tool => toolName(tool.name) === "write_document");
          if (!writeTool) throw new Error("OpenCode wire omitted the governed write_document tool.");
          return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "managed-e2e-write-1", name: writeTool.name, input: {
              idempotencyKey: "managed-opencode-source-document-v1", key: "managed-source-e2e", title: "Private E2E note",
              body: "This document was written through the governed OpenCode tool boundary.", baseRevisionId: null,
            } }], usage: { input_tokens: 120, output_tokens: 42 } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        const finish = tools.find(tool => toolName(tool.name) === "paperclip_finish");
        if (!finish) throw new Error("OpenCode wire omitted paperclip_finish.");
        const finishInput = {
          schema: "paperclip.run_result.v1", reportedWorkDisposition: "done", summary: "The private note is saved.",
          completionClaim: { contractRevision: String(contractRow.revision), objectiveSatisfied: true,
            criteria: completionContract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })),
            remainingWork: [] }, evidence: [], verification: [], attentionRequests: [], artifacts: [],
        };
        return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "managed-e2e-finish-1", name: finish.name, input: finishInput }],
          usage: { input_tokens: 160, output_tokens: 38 } }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const minted = await gateway.issueForRun({ companyId, agentId, runId: run!.id, responsibleUserId: f.userId });
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use((req, res, next) => {
      brokerRequests.push(`${req.method} ${req.path}`);
      if (req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages") {
        res.status(404).end();
        return;
      }
      // Test TLS mediation stands in for OpenShell host injection. Only the
      // exact Messages endpoint receives a capability minted by issueForRun;
      // the OpenCode child receives no bearer token in its environment.
      req.headers.authorization = `Bearer ${minted.token}`;
      next();
    });
    app.use(runtimeConnectionIntentRoutes(db, gateway));
    app.use(errorHandler);
    const broker = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, app);
    await new Promise<void>((resolveListen, reject) => {
      broker.once("error", reject);
      broker.listen(0, "127.0.0.1", () => { broker.off("error", reject); resolveListen(); });
    });
    const address = broker.address();
    if (!address || typeof address === "string") throw new Error("Expected local HTTPS listener.");
    const runnerEnvironment = { PATH: `${dirname(OPENCODE)}:${process.env.PATH ?? ""}`, SSL_CERT_FILE: certBundlePath,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: `https://127.0.0.1:${address.port}` };
    const diagnostics: string[] = [];
    const backend = createOpenCodeNativeSessionBackend(execution, { runtimeDirectory: join(runRoot, "opencode-runtime"),
      environment: runnerEnvironment, command: OPENCODE, runnerInstanceId: prepared.runnerInstanceId,
      onDiagnostic: message => diagnostics.push(message), fetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        diagnostics.push(`driver request ${method} ${url.pathname}`);
        try {
          const response = await fetch(input, init);
          diagnostics.push(`driver response ${method} ${url.pathname} ${response.status}`);
          return response;
        } catch (error) {
          diagnostics.push(`driver error ${method} ${url.pathname}: ${String(error)}`);
          throw error;
        }
      } });
    try {
      const result = await executePaperclipNativeSession({ db, execution, backend, bootstrapSourceClosure,
        runnerInstanceId: prepared.runnerInstanceId, leaseOwner, turnTimeoutMs: 90_000, adapterType: "paperclip_runner",
        runnerEnvironment }).catch(error => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics.join("\n")}\nBroker: ${brokerRequests.join(", ")}`);
        });
      expect(result.exitCode).toBe(0);
      expect(responseCount).toBeGreaterThanOrEqual(2);
    } finally {
      broker.closeAllConnections();
      await new Promise<void>(resolveClose => broker.close(() => resolveClose()));
    }
    const [persistedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    const sourceReceipt = persistedRun!.runnerProfileJson as Record<string, unknown>;
    expect(sourceReceipt.nativeOpenCodeSourceAuthority).toMatchObject({ version: 1, toolSchemas: expect.any(Array) });
    expect(sourceReceipt.nativeInputSourceProtocolVersion).toBe(1);
    expect(nativeRunInputSourceReceiptSchema.safeParse(sourceReceipt.nativeInputSourceReceipt).success).toBe(true);
    expect(sourceReceipt.nativeToolResultSourceCaptures).toEqual(expect.arrayContaining([
      expect.objectContaining({ managedOpenCode: true, tool: "write_document", callId: "managed-e2e-write-1" }),
    ]));
    const [documentLink] = await db.select().from(issueDocuments)
      .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id)));
    expect(documentLink).toBeDefined();
    const visible = await documentService(db).getIssueDocumentByKey(task.id, "managed-source-e2e");
    expect(visible?.body).toContain("governed OpenCode tool boundary");
    const [snapshotRow] = await db.select({ payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot })
      .from(documentRevisions).where(eq(documentRevisions.id, visible!.latestRevisionId!));
    expect(nativePayloadSourceSnapshotSchema.safeParse(snapshotRow?.payloadSourceSnapshot).success).toBe(true);
    // Exercise the real current-source HTTP reader after the producer run is
    // terminal and the exact output is published on an open Task.
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(heartbeatRuns.id, run!.id));
    const httpDocument = await request(humanApp).get(`/api/issues/${task.id}/documents/managed-source-e2e`).expect(200);
    expect(httpDocument.body.body).toContain("governed OpenCode tool boundary");
    const reservations = await db.select().from(orchestrationModelReservations)
      .where(and(eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.planId, plan.id)));
    expect(reservations.length).toBeGreaterThanOrEqual(2);
    expect(reservations.every(reservation => reservation.status === "completed" && reservation.providerResponseHash)).toBe(true);
    expect(modelCalls.every(call => call.model === model && Array.isArray(call.messages))).toBe(true);
    expect(JSON.stringify(persistedRun!.runnerProfileJson)).not.toContain(minted.token);
  }, 180_000);
});

