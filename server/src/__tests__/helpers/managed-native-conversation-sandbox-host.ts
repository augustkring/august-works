import { constants, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID, sign } from "node:crypto";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { WebSocket } from "ws";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  agentProviderBindings, billingAccounts, billingAccountCompanies, billingSubscriptions, createDb,
  agents, agentExecutionManifests, environmentLeases, heartbeatRuns, issues, runtimeCapacityProfiles, runtimeCells, runtimeHosts, runtimeHostRequestNonces,
  runtimeVersionCatalog, runtimeHostCommands, sandboxQualificationRuns,
} from "@paperclipai/db";
import { SANDBOX_CONTROLS, runtimeRequestSigningInput } from "@paperclipai/shared";
import type { AuthorizationActor } from "../../services/authorization.js";
import { environmentService } from "../../services/environments.js";
import { environmentRuntimeService } from "../../services/environment-runtime.js";
import { executionSandboxService } from "../../services/execution-sandbox/sandbox-service.js";
import type { SandboxIdentity, SandboxProbeCase } from "../../services/execution-sandbox/backend.js";
import { nativeSandboxHostTransport } from "../../services/execution-sandbox/native-host-bridge.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../../services/provider-capabilities.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { runtimeControlService } from "../../services/runtime/control.js";
import type { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { policyFixture } from "./sandbox-fixture.js";
import { findNativeChatWorkspaceScope, nativeChatWorkspaceCwd } from "../../services/native-runtime/native-chat-workspace.js";
import { projectOpenShellPolicy } from "../../services/execution-sandbox/openshell-policy.js";
import { open as unseal } from "../../services/saas/crypto.js";
import { nativeSha256 } from "../../services/native-runtime/canonical.js";
import { compileSandboxPolicy } from "../../services/execution-sandbox/policy-compiler.js";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";

const imageDigest = `fixture.invalid/openshell@sha256:${"a".repeat(64)}`;

function signedRelayProof(hostId: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]) {
  const fields = { hostId, epoch: 1, timestamp: String(Date.now()), nonce: randomBytes(32).toString("base64url") };
  const raw = Buffer.from(JSON.stringify({ hostId, epoch: 1 }));
  const message = runtimeRequestSigningInput("WS", "/api/internal/runtime/relay", createHashHex(raw), fields);
  return { nonce: fields.nonce, proof: { ...fields, signature: sign("sha256", Buffer.from(message), {
    key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
  }).toString("base64url") } };
}

function createHashHex(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function safeSandboxFailureClass(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const known: Array<[string, string]> = [
    ["runner_process_status_unavailable", "runner_process_status_unavailable"],
    ["Current active native Task run is required", "current_native_task_not_active"],
    ["Sandbox execution source changed before claim admission", "source_changed_before_claim"],
    ["A previous sandbox execution on this Task attempt has an unknown outcome", "previous_sandbox_exec_unknown"],
    ["Sandbox execution deadline expired", "sandbox_exec_deadline_expired"],
    ["Sandbox execution scope is stale", "sandbox_exec_scope_stale"],
    ["Sandbox execution capability is no longer active", "sandbox_exec_capability_inactive"],
  ];
  const exact = known.find(([prefix]) => message === prefix || message.startsWith(`${prefix}:`));
  if (exact) return exact[1];
  if (/^[a-z][a-z0-9_:-]{0,99}$/.test(message)) return message;
  return error instanceof Error ? `unclassified_${error.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}` : "non_error_throwable";
}

function safeErrorSourceFrames(error: unknown): Array<{ functionName: string | null; sourceFile: string; line: number }> {
  const stack = error instanceof Error ? error.stack?.split("\n").slice(1) ?? [] : [];
  const frames: Array<{ functionName: string | null; sourceFile: string; line: number }> = [];
  for (const line of stack) {
    const match = /^\s*at (?:(.*?) \()?(.+?):(\d+):\d+\)?$/.exec(line);
    if (!match) continue;
    const sourceFile = match[2]!.split(/[\\/]/).at(-1)!;
    const row = Number(match[3]);
    if (!/^[-\w.]+\.(?:ts|js|mjs|cjs)$/.test(sourceFile) || !Number.isSafeInteger(row)) continue;
    frames.push({ functionName: match[1] || null, sourceFile, line: row });
    if (frames.length >= 8) break;
  }
  return frames;
}

function safeNativePreReceiptFailedChecks(error: unknown): string[] {
  const message = error instanceof Error ? error.message : "";
  const prefix = "Native pre-receipt command is outside the current conversation Run, input, Human and workspace scope:";
  if (!message.startsWith(prefix)) return [];
  const allowed = new Set(["provider", "execution_input", "human_run_manifest", "comment_source", "workspace_roots",
    "trusted_command", "runtime_context_source_authority", "runtime_context_target", "credential_shape", "task_source_owner",
    "workload_credentials"]);
  return message.slice(prefix.length).split(",").filter((value, index, all) => all.indexOf(value) === index && allowed.has(value)).slice(0, 11);
}


export async function configureManagedConversationSandboxHost(input: {
  db: ReturnType<typeof createDb>;
  actor: AuthorizationActor;
  companyId: string;
  agentId: string;
  providerBindingId: string;
  gateway: ReturnType<typeof workerModelGateway>;
  profile: import("../../services/orchestration/worker-model-profiles.js").WorkerModelProfile;
  root: string;
  opencodeBinary: string;
  brokerOrigin: string;
  brokerProxyOrigin: string | null;
  certBundlePath: string;
  setBrokerToken: (token: string) => void;
}) {
  const { db, actor, companyId, agentId, providerBindingId } = input;
  const brokerOrigin = new URL(input.brokerOrigin).origin;
  const taskWorkspaceNamespace = join(await realpath(resolvePaperclipInstanceRoot()), "chat-workspaces", companyId, agentId);
  const runtime = runtimeControlService(db, { runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 } } as SaasPlatformConfig,
    undefined, { credentialBrokerOrigin: brokerOrigin, workerModels: input.gateway as any });
  const purposesByCommandDigest = new Map<string, Array<string | null>>();
  const purposeByRequestId = new Map<string, string | null>();
  const relayCommandOwnerByRequestId = new Map<string, string>();
  const sandboxRelayRequestByError = new WeakMap<object, {
    requestId: string; requestDigest: string; harnessCommandDigest: string; purpose: string | null; sequence: number;
  }>();
  let sandboxRelayRequestSequence = 0;
  const relayRequestFactsForError = (error: unknown) => {
    let candidate: unknown = error;
    for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth++) {
      const facts = sandboxRelayRequestByError.get(candidate);
      if (facts) return facts;
      candidate = "cause" in candidate ? candidate.cause : null;
    }
    return undefined;
  };
  const commandDigest = (command: string, args: readonly string[]) => nativeSha256({ command, args });
  let nativeSessionStartCredentialNegativeControls: { missingTokenDenied: boolean; mismatchedTokenDenied: boolean } | null = null;
  const executeOpenShell = runtime.relay.executeOpenShell.bind(runtime.relay);
  runtime.relay.executeOpenShell = async relayInput => {
    const request = relayInput.request;
    const harnessCommandDigest = commandDigest(request.argv[0]!, request.argv.slice(1));
    const purposeQueue = purposesByCommandDigest.get(harnessCommandDigest);
    const purpose = purposeQueue?.shift() ?? null;
    const requestFacts = { requestId: request.requestId, requestDigest: request.commandDigest,
      harnessCommandDigest, purpose, sequence: ++sandboxRelayRequestSequence };
    purposeByRequestId.set(request.requestId, purpose);
    const credential = request.modelBrokerCredential;
    if (!nativeSessionStartCredentialNegativeControls && request.argv[0] === "sh" &&
      request.argv[3] === "paperclip-runner-launch" && credential) {
      const expectDenied = async (tampered: typeof relayInput.request) => {
        try { await executeOpenShell({ ...relayInput, request: tampered }); return false; }
        catch { return true; }
      };
      const missingTokenDenied = await expectDenied({ ...request, modelBrokerCredential: undefined });
      const mismatchedTokenDenied = await expectDenied({ ...request,
        modelBrokerCredential: { ...credential, capabilityToken: "invalid-model-capability" } });
      nativeSessionStartCredentialNegativeControls = { missingTokenDenied, mismatchedTokenDenied };
    }
    try {
      return await executeOpenShell(relayInput);
    } catch (error) {
      if (error && typeof error === "object") sandboxRelayRequestByError.set(error, requestFacts);
      throw error;
    } finally {
      purposeByRequestId.delete(request.requestId);
    }
  };
  const hostKeys = generateKeyPairSync("rsa", { modulusLength: 3072 });
  await instanceSettingsService(db).updateExperimental({
    sandbox_abstraction_v7: true, openshell_v7: true, runtime_host_agent_v6: true,
    hosted_openclaw_v6: true,
    saas_deployment_profile_v6: true, billing_v6: true, billing_entitlements_v6: true, billing_usage_v6: true,
  });
  await db.insert(runtimeVersionCatalog).values({ imageDigest, providerVersion: "fixture-software-host",
    stateFormat: "v1", hostAgentMinimumVersion: "6.0.0", conformance: { controlledSoftwareHost: true }, status: "approved" });
  await db.insert(runtimeCapacityProfiles).values({ key: "conversation-software-host", cpuMillis: 1000,
    memoryBytes: 1073741824n, diskBytes: 10737418240n, pidsLimit: 128, qualified: false });
  const [host] = await db.insert(runtimeHosts).values({ environment: "test", region: "local", capacityClass: "software-fixture",
    cpuTotalMillis: 4000, memoryTotalBytes: 8000000000n, diskTotalBytes: 40000000000n,
    publicKeyPem: hostKeys.publicKey.export({ type: "spki", format: "pem" }).toString(), status: "READY",
    hostAgentVersion: "6.0.2", lastHeartbeatAt: new Date() }).returning();
  if (!host) throw new Error("conversation_software_host_row_missing");
  const payerUserId = actor.userId;
  if (!payerUserId) throw new Error("conversation_software_host_payer_missing");
  const [account] = await db.insert(billingAccounts).values({ displayName: "Conversation software host fixture", payerUserId }).returning();
  if (!account) throw new Error("conversation_software_host_billing_account_missing");
  await db.insert(billingAccountCompanies).values({ companyId, billingAccountId: account.id });
  for (const productKeys of [["platform", "runtime_standard"], ["runtime_standard"]])
    await db.insert(billingSubscriptions).values({ billingAccountId: account.id,
      providerSubscriptionId: `conversation-software-${randomUUID()}`, status: "active", productKeys,
      currentPeriodEnd: new Date(Date.now() + 86_400_000), providerUpdatedAt: new Date(), sourceHash: "controlled-software-host-fixture" });
  const [cell] = await db.insert(runtimeCells).values({ companyId, billingAccountId: account.id,
    capacityProfile: "conversation-software-host", desiredImageDigest: imageDigest, status: "STOPPED",
    isolationMode: "company_cell", runtimeHostId: host.id, providerBindingId }).returning();
  if (!cell) throw new Error("conversation_software_host_cell_missing");
  const [provider] = await db.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, providerBindingId)).limit(1);
  if (!provider) throw new Error("conversation_software_host_provider_binding_missing");
  const providerService = agentProviderBindingService(db);
  await providerService.attach(actor, companyId, agentId, {
    providerBindingId, providerProfileRef: `aw:cell:${cell.id}:generation:${cell.generation}`,
  });
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) throw new Error("conversation_software_host_agent_missing");
  const providerSnapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId,
    adapterType: agent.adapterType, config: agent.adapterConfig }));
  const providerSnapshotInput = Object.fromEntries(Object.entries(providerSnapshot).filter(([key]) => key !== "hash")) as Omit<typeof providerSnapshot, "hash">;
  await providerService.recordDiscovery(companyId, agentId, providerSnapshotInput,
    Object.fromEntries(providerConformanceRequirements(providerSnapshot, "isolated_per_presence").map(check => [check, true])));
  const qualifiedProvider = await providerService.assertRuntime(companyId, agentId);
  const providerProfileRef = qualifiedProvider.runtime.providerProfileRef;
  if (!providerProfileRef) throw new Error("conversation_software_host_provider_profile_missing");
  input.profile.providerProfileRef = providerProfileRef;
  const providerSnapshotHash = qualifiedProvider.provider.capabilitySnapshotHash;
  if (!providerSnapshotHash) throw new Error("conversation_software_host_provider_snapshot_missing");
  input.profile.providerSnapshotHash = providerSnapshotHash;
  const environment = await environmentService(db).ensureManagedSandboxEnvironment({ companyId,
    name: `Conversation managed sandbox ${agentId}`, provider: "fake", stockVersion: "conversation-software-host-v1",
    config: { image: "ubuntu:24.04", reuseLease: false } }).then(result => result.environment);
  await db.update(agents).set({ defaultEnvironmentId: environment.id }).where(eq(agents.id, agentId));

  const identity: SandboxIdentity = { companyId, bindingId: randomUUID(), cellId: cell.id,
    cellGeneration: cell.generation.toString(), sandboxRef: `aw-v7-${cell.id}` };
  const transport = nativeSandboxHostTransport(db, { operatorUserIds: [actor.userId!] });
  const state = new Map<string, "stopped" | "ready" | "running">();
  const policies = new Map<string, string>();
  const capabilityTestedAt = new Date(Date.now() - 1000).toISOString();
  const capabilityExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const capabilities = () => ({ ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, true])),
    backend: "openshell", backendVersion: "0.1.2", hostKernelVersion: "controlled-software-host",
    sandboxImageDigest: imageDigest, filesystemEnforcementMode: "hard_requirement", staticPolicyRequiresRecreate: true,
    dynamicNetworkPolicy: true, policyProverBoundaryCheck: true, policyProverCoverage: [...SANDBOX_CONTROLS],
    credentialBindingDimensions: ["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"],
    credentialBrokerProviderProfile: { id: "conversation-broker", hash: "d".repeat(64) },
    modelBrokerProviderProfile: { id: "conversation-model-broker", hash: "e".repeat(64) },
    testedAt: capabilityTestedAt, expiresAt: capabilityExpiresAt,
    qualificationHash: "f".repeat(64), evidenceKind: "protected_host_report" });
  const service = executionSandboxService(db, { operatorUserIds: [actor.userId!], credentialBrokerOrigin: brokerOrigin,
    assertRuntimeStartAdmission: (tx, start) => runtime.assertSandboxStartAdmission(tx, start),
    recordRuntimeWorkloadState: (tx, stateChange) => runtime.recordSandboxWorkloadState(tx, stateChange),
    backendFor: (_binding: unknown, currentActor: AuthorizationActor) => {
      const bridge = transport.bridge(currentActor);
      return {
        backend: "openshell", evidenceKind: "protected_host_report",
        capabilities: async () => bridge.capabilities(identity),
        prepareSandbox: async (scope: SandboxIdentity) => ({ ...scope, backendVersion: "0.1.2", imageDigest }),
        // Admission and command execution must consume the exact response from
        // the authenticated Native host relay, including its `generation`
        // field. A local fixture map is not an observed workload receipt.
        inspectWorkload: async (scope: SandboxIdentity) => bridge.inspect(scope),
        applyPolicy: async (value: { policy: unknown; expiresAt: string }) => {
          const policyHash = nativeSha256(value.policy);
          const reply = await bridge.apply({ ...identity, document: projectOpenShellPolicy((value.policy as any).compiledPolicy).document,
            policyHash, expiresAt: value.expiresAt, idempotencyKey: `conversation-software-policy:${policyHash}` });
          state.set(identity.cellId, reply.applied ? "ready" : "stopped"); policies.set(identity.cellId, policyHash);
          return { applied: reply.applied, requiresRecreate: reply.requiresRecreate, observedPolicyHash: reply.policyHash, unsupportedFeatures: [] };
        },
        startWorkload: async (value: { expiresAt: string; policy: unknown; idempotencyKey: string }) => {
          const policyHash = nativeSha256(value.policy);
          const reply = await bridge.start({ ...identity, expiresAt: value.expiresAt, policyHash, idempotencyKey: value.idempotencyKey });
          state.set(identity.cellId, "running"); return { operationId: reply.operationId };
        },
        stopWorkload: async (value: { idempotencyKey: string }) => { const reply = await bridge.stop({ ...identity, idempotencyKey: value.idempotencyKey }); state.set(identity.cellId, "stopped"); return { operationId: reply.operationId }; },
        destroySandbox: (value: { idempotencyKey: string }) => bridge.destroy({ ...identity, idempotencyKey: value.idempotencyKey }),
        probeBoundary: async (value: { test: SandboxProbeCase }) => {
          await bridge.probe({ ...identity, test: value.test });
          return { verdict: "pass", observationHash: createHash("sha256").update(`controlled:${value.test.caseId}`).digest("hex"), contractHash: value.test.contractHash };
        },
      } as any;
    } });
  const binding = await service.create(actor, companyId, { runtimeCellId: cell.id,
    expectedCellGeneration: cell.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy: (() => {
      const boundary = policyFixture(); boundary.riskClass = "C3"; boundary.requiredControls = [...SANDBOX_CONTROLS];
      // The durable maximum is confined to this company/Agent's server-owned
      // chat workspace namespace. Per-run compilation below narrows it again
      // to the exact canonical issue taskRoot before host admission.
      boundary.filesystem.readPaths = [taskWorkspaceNamespace];
      boundary.filesystem.writePaths = [taskWorkspaceNamespace];
      boundary.filesystem.deniedPaths = []; boundary.process.allowedBinaries = []; boundary.process.allowedSyscalls = [];
      boundary.network.destinations = []; return boundary;
    })() });
  const actualIdentity: SandboxIdentity = { ...identity, bindingId: binding.id, sandboxRef: binding.sandboxRef ?? `aw-v7-${binding.id}` };
  await db.update(runtimeCells).set({ providerBindingId }).where(eq(runtimeCells.id, cell.id));
  // Keep the original bridge identity pinned to the durable binding.
  identity.bindingId = binding.id;
  identity.sandboxRef = actualIdentity.sandboxRef;

  const workloadStates = state, workloadPolicies = policies;
  const driveHost = async <T>(work: Promise<T>): Promise<T> => {
    let settled = false;
    const result = work.then(value => ({ value }), error => ({ error })).then(value => { settled = true; return value; });
    const deadline = Date.now() + 30_000;
    while (!settled && Date.now() < deadline) {
      const claim = await transport.claim(host.id);
      if (!claim) { await new Promise(resolve => setTimeout(resolve, 2)); continue; }
      const secret = privateDecrypt({ key: hostKeys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256",
        oaepLabel: Buffer.from("aw-runtime-command-v6") }, Buffer.from(claim.envelope.encryptedKey, "base64url"));
      const command = unseal<Record<string, any>>(claim.envelope.ciphertext, secret.toString("hex"), `command:${claim.id}:${host.id}:1`);
      const action = command.action as string;
      const snapshot = capabilities();
      const common = { generation: command.scope.cellGeneration, imageDigest: command.imageDigest };
      const policyHash = typeof command.admission?.policyHash === "string" ? command.admission.policyHash : "";
      const reply = action === "capabilities" ? { action, capabilities: snapshot }
        : action === "prepare" ? { action, backendVersion: "0.1.2", imageDigest }
        : action === "probe" ? { action, verdict: "pass", observationHash: createHash("sha256").update(`software:${command.probe?.case?.caseId ?? command.probe?.caseId ?? "probe"}`).digest("hex"), contractHash: command.probe?.contractHash }
        : action === "inspect" ? { action, ...common, state: workloadStates.get(command.scope.cellId) ?? "stopped", policyHash: workloadPolicies.get(command.scope.cellId) ?? null, controlsHealthy: true }
        : action === "apply" ? (workloadStates.set(command.scope.cellId, "ready"), workloadPolicies.set(command.scope.cellId, command.admission.policyHash), { action, applied: true, requiresRecreate: false, policyHash: command.admission.policyHash, effectivePolicyHash: command.admission.policyHash })
        : action === "start" ? (workloadStates.set(command.scope.cellId, "running"), workloadPolicies.set(command.scope.cellId, command.start.policyHash), { action, started: true, operationId: claim.id, sandboxId: command.scope.bindingId, containerId: "b".repeat(64), imageDigest, policyHash: command.start.policyHash, effectivePolicyHash: command.start.policyHash })
        : action === "stop" ? (workloadStates.set(command.scope.cellId, "stopped"), { action, stopped: true })
        : action === "revoke_providers" ? { action, revoked: true }
        : action === "destroy" ? { action, destroyed: true }
        : { action, document: projectOpenShellPolicy(policyFixture()).document, policyHash };
      await transport.complete(host.id, claim.id, { claimToken: command.claimToken, generation: command.scope.cellGeneration,
        success: true, reply, errorCode: null });
    }
    if (!settled) throw new Error("conversation_software_host_command_timeout");
    const output = await result;
    if ("error" in output) throw output.error;
    return output.value;
  };
  const qualification = await driveHost(service.qualify(actor, companyId, binding.id, 1));
  if (qualification.status !== "ready") {
    const [report] = qualification.qualificationRunId ? await db.select({ status: sandboxQualificationRuns.status,
      suiteVersion: sandboxQualificationRuns.suiteVersion, evidenceKind: sandboxQualificationRuns.evidenceKind,
      results: sandboxQualificationRuns.results, exceptions: sandboxQualificationRuns.exceptions })
      .from(sandboxQualificationRuns).where(eq(sandboxQualificationRuns.id, qualification.qualificationRunId)).limit(1) : [];
    const results = Array.isArray(report?.results) ? report.results.map(result => ({
      caseId: result.caseId, control: result.control, verdict: result.verdict,
      observationHashPresent: typeof result.observationHash === "string" && /^[a-f0-9]{64}$/.test(result.observationHash),
    })) : [];
    const exceptions = Array.isArray(report?.exceptions) ? report.exceptions.filter((value): value is string =>
      typeof value === "string" && /^[a-z0-9_:-]{1,100}$/.test(value)).slice(0, 32) : [];
    throw new Error(`conversation_software_host_qualification_failed:${JSON.stringify({
      bindingStatus: qualification.status, reportStatus: report?.status ?? null,
      suiteVersion: report?.suiteVersion ?? null, evidenceKind: report?.evidenceKind ?? null, results, exceptions,
    })}`);
  }
  let expectedRunId: string | null = null;
  let expectedIssueId: string | null = null;
  let expectedTaskRoot: string | null = null;
  let acquiredLeaseExpiresAt: string | null = null;
  let preAdmissionObservation: { state: string; generationMatches: boolean; imageDigestMatches: boolean; controlsHealthy: boolean } | null = null;
  let prepareHostForRun: ((runId: string, leaseId: string) => Promise<void>) | null = null;
  let providerImageHome: string | null = null;
  const hostAdmissionByRun = new Map<string, { leaseId: string; promise: Promise<void> }>();
  const sandboxExecutionChecks: Array<Record<string, boolean | number | string | null>> = [];
  const sandboxExecutionFailures: Array<Record<string, unknown>> = [];
  let sandboxExecInvocationSequence = 0;
  let negativeNativeSessionStartControls: { wrongCommandDenied: boolean; wrongRootDenied: boolean; noExecution: boolean } | null = null;
  const executeSandboxTask: typeof runtime.executeSandboxTask = async execInput => {
    if (!execInput.runId || !execInput.leaseId || !prepareHostForRun)
      throw new Error("conversation_software_host_run_binding_unavailable");
    await heartbeatHost();
    // The first runtime command is workspace preparation, before the Native
    // provider callback. Admit the same real manifest-bound host here, at the
    // original RuntimeControl execution seam, before delegating its signed exec.
    await prepareHostForRun(execInput.runId, execInput.leaseId);
    const commandName = execInput.command.toLowerCase().split("/").at(-1) ?? "";
    const args = execInput.args ?? [];
    const runnerLaunch = commandName === "sh" && args[2] === "paperclip-runner-launch";
    if (execInput.runId && (sandboxExecutionChecks.length < 8 || runnerLaunch)) {
      const [run] = await db.select({ status: heartbeatRuns.status, startedAt: heartbeatRuns.startedAt,
        agentId: heartbeatRuns.agentId, nativeIssueId: heartbeatRuns.nativeIssueId,
        responsibleUserId: heartbeatRuns.responsibleUserId, runtimeMode: heartbeatRuns.runtimeMode,
        contextSnapshot: heartbeatRuns.contextSnapshot, resultJson: heartbeatRuns.resultJson })
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, execInput.runId))).limit(1);
      const runContext = run?.contextSnapshot && typeof run.contextSnapshot === "object"
        ? run.contextSnapshot as Record<string, unknown> : {};
      const contextIssueId = typeof runContext.issueId === "string" ? runContext.issueId : null;
      const [contextIssue] = contextIssueId ? await db.select({ conversationAgentId: issues.conversationAgentId,
        conversationUserId: issues.conversationUserId, executionRunId: issues.executionRunId,
        conversationSessionGeneration: issues.conversationSessionGeneration }).from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.id, contextIssueId))).limit(1) : [];
      const [lease] = await db.select({ status: environmentLeases.status, expiresAt: environmentLeases.expiresAt,
        heartbeatRunId: environmentLeases.heartbeatRunId }).from(environmentLeases)
        .where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.id, execInput.leaseId))).limit(1);
      const cancellation = run?.resultJson?.executionCancellation;
      const cancellationRequested = Boolean(cancellation && typeof cancellation === "object" &&
        "state" in cancellation && cancellation.state === "requested");
      const commandKind = commandName.includes("opencode") ? "opencode" : commandName.includes("runner") ? "runner" :
        commandName.includes("rsync") ? "rsync" : commandName === "git" ? "git" :
          commandName === "bash" ? "bash" : commandName === "sh" ? "shell" :
            commandName === "tar" ? "tar" : commandName === "node" ? "node" : "other";
      const commandScript = args[1] ?? "";
      const commandOwner = runnerLaunch ? "runner_process_launch" : args[2] === "paperclip-runner-monitor"
        ? "runner_process_monitor" : args[2] === "paperclip-runner-process-identity"
          ? "runner_process_identity_read" : args[2] === "paperclip-runner-diagnostics"
            ? "runner_diagnostic_tail" : commandScript.startsWith("command -v ")
              ? "managed_runtime_install_probe" : commandScript.startsWith("mkdir -p ")
                ? "managed_runtime_directory_prepare" : commandScript.startsWith("umask 077; install -d -m 0700 ")
                  ? "runner_harness_directory_prepare" : commandScript.includes("runner-state.json") && commandScript.includes("base64 <")
                    ? "runner_harness_state_read" : commandScript.includes("base64 -d")
                      ? "managed_runtime_file_transfer" : commandScript.includes("tar -xf")
                        ? "managed_runtime_archive_extract" : commandScript.startsWith("rm -rf ")
                          ? "managed_runtime_remove" : commandScript.startsWith("chmod ")
                            ? "managed_runtime_permissions" : commandScript.startsWith("test -")
                              ? "managed_runtime_path_probe" : commandScript.startsWith("if ")
                                ? "managed_runtime_listing" : commandScript.startsWith("set ")
                                  ? "managed_runtime_sync" : "other";
      const managedGitContextProbe = commandName === "sh" && args[0] === "-c" && args[2] === "paperclip-git-context" &&
        (args[3] === "managed" || args[3] === "host");
      const unstartedSessionClaimProbe = commandName === "sh" && args[0] === "-c" && args[2] === "paperclip-runner-claim-unstarted-session";
      const credentialEnvNames = Object.keys(execInput.env ?? {})
        .filter(name => /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(name))
        .sort().slice(0, 16).join(",");
      const nativePreparationPurpose = execInput.nativePreparationPurpose ?? null;
      sandboxExecutionChecks.push({ expectedRun: execInput.runId === expectedRunId,
        commandKind, commandOwner, stdinBytes: Buffer.byteLength(execInput.stdin ?? "", "utf8"),
        cwdAbsolute: Boolean(execInput.cwd?.startsWith("/")), argumentCount: (execInput.args ?? []).length,
        runnerLaunch,
        nativePreparationPurpose,
        managedGitContextProbe, unstartedSessionClaimProbe, credentialEnvNames,
        runtimeMode: run?.runtimeMode ?? null, runStatus: run?.status ?? null, runStatusRunning: run?.status === "running",
        startedAtPresent: Boolean(run?.startedAt), agentIdPresent: Boolean(run?.agentId),
        nativeIssueIdPresent: Boolean(run?.nativeIssueId), responsibleUserIdPresent: Boolean(run?.responsibleUserId),
        cancellationRequested, leaseActiveForRun: lease?.status === "active" && lease.heartbeatRunId === execInput.runId,
        leaseExpiryPresent: Boolean(lease?.expiresAt), leaseUnexpired: Boolean(lease?.expiresAt && lease.expiresAt > new Date()),
        contextIssuePresent: Boolean(contextIssueId), contextWakeCommentPresent: typeof runContext.wakeCommentId === "string",
        contextConversationOwnerMatches: contextIssue?.conversationAgentId === agentId && contextIssue?.conversationUserId === actor.userId,
        contextIssueGenerationPresent: contextIssue?.conversationSessionGeneration !== null && contextIssue?.conversationSessionGeneration !== undefined,
        contextIssueExecutionRunMatches: contextIssue?.executionRunId === execInput.runId,
        nativeIssueMatchesContext: Boolean(run?.nativeIssueId && contextIssueId && run.nativeIssueId === contextIssueId) });
    }
    const commandKey = commandDigest(execInput.command, execInput.args ?? []);
    const purposeQueue = purposesByCommandDigest.get(commandKey) ?? [];
    purposeQueue.push(execInput.nativePreparationPurpose ?? null);
    purposesByCommandDigest.set(commandKey, purposeQueue);
    const sandboxExecSequence = ++sandboxExecInvocationSequence;
    const sandboxExecStartedAt = new Date();
    try {
      // Keep the controlled signed host fresh under the long OpenCode prep
      // sequence; the periodic timer alone can be delayed by a busy test loop.
      await heartbeatHost();
      const result = await runtime.executeSandboxTask(execInput);
      if (!result) return null;
      if ((runnerLaunch || result.exitCode === 126 || result.timedOut) &&
          sandboxExecutionFailures.length < 16 && (result.exitCode !== 0 || result.timedOut)) {
        sandboxExecutionFailures.push({
          commandKind: commandName.includes("runner") ? "runner" : commandName === "sh" ? "shell" : "other",
          runnerLaunch,
          nativePreparationPurpose: execInput.nativePreparationPurpose ?? null,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        });
      }
      return result;
    } catch (error) {
      if ((runnerLaunch || sandboxExecutionFailures.length < 16) && sandboxExecutionFailures.length < 16) {
        const rawCode = error && typeof error === "object" && "code" in error ? error.code : null;
        const requestFacts = relayRequestFactsForError(error);
        let claim: { status: string; errorCode: string | null; commandDigest: string | null;
          nativePreparationPurpose: string | null; requestId: string; createdAt: Date } | undefined;
        let unresolvedClaims: Array<{ requestId: string; status: string; errorCode: string | null;
          commandDigest: string | null; nativePreparationPurpose: string | null; attempt: number; createdAt: Date }> = [];
        if (requestFacts) {
          try {
            [claim] = await db.select({
              requestId: runtimeHostCommands.idempotencyKey,
              status: runtimeHostCommands.status,
              errorCode: runtimeHostCommands.errorCode,
              commandDigest: sql<string | null>`${runtimeHostCommands.payload}->>'commandDigest'`,
              nativePreparationPurpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
              createdAt: runtimeHostCommands.createdAt,
            }).from(runtimeHostCommands).where(and(
              eq(runtimeHostCommands.idempotencyKey, requestFacts.requestId),
              eq(runtimeHostCommands.commandType, "sandbox_exec"),
            )).limit(1);
          } catch { /* diagnostics never replace the original sandbox error */ }
        }
        if (!claim && execInput.runId) {
          try {
            [claim] = await db.select({
              requestId: runtimeHostCommands.idempotencyKey,
              status: runtimeHostCommands.status,
              errorCode: runtimeHostCommands.errorCode,
              commandDigest: sql<string | null>`${runtimeHostCommands.payload}->>'commandDigest'`,
              nativePreparationPurpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
              createdAt: runtimeHostCommands.createdAt,
            }).from(runtimeHostCommands).where(and(
              eq(runtimeHostCommands.commandType, "sandbox_exec"),
              sql`${runtimeHostCommands.payload}->>'runId' = ${execInput.runId}`,
              sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = ${execInput.nativePreparationPurpose ?? null}`,
              gte(runtimeHostCommands.createdAt, sandboxExecStartedAt),
            )).orderBy(desc(runtimeHostCommands.createdAt)).limit(1);
          } catch { /* diagnostics never replace the original sandbox error */ }
        }
        if (execInput.runId) {
          try {
            unresolvedClaims = await db.select({
              requestId: runtimeHostCommands.idempotencyKey,
              status: runtimeHostCommands.status,
              errorCode: runtimeHostCommands.errorCode,
              commandDigest: sql<string | null>`${runtimeHostCommands.payload}->>'commandDigest'`,
              nativePreparationPurpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
              attempt: runtimeHostCommands.attempt,
              createdAt: runtimeHostCommands.createdAt,
            }).from(runtimeHostCommands).where(and(
              eq(runtimeHostCommands.companyId, companyId),
              eq(runtimeHostCommands.commandType, "sandbox_exec"),
              sql`${runtimeHostCommands.payload}->>'runId' = ${execInput.runId}`,
              inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
            )).orderBy(desc(runtimeHostCommands.createdAt)).limit(8);
          } catch { /* diagnostics never replace the original sandbox error */ }
        }
        sandboxExecutionFailures.push({
          commandKind: commandName.includes("runner") ? "runner" : commandName === "sh" ? "shell" : "other",
          runnerLaunch,
          nativePreparationPurpose: execInput.nativePreparationPurpose ?? null,
          failureClass: safeSandboxFailureClass(error),
          requestAssociationSource: requestFacts ? "signed_relay_request" : claim ? "persisted_command_claim" : "pre_claim_error",
          requestSequence: requestFacts?.sequence ?? sandboxExecSequence,
          requestId: requestFacts?.requestId ?? claim?.requestId ?? null,
          requestDigest: requestFacts?.requestDigest ?? claim?.commandDigest ?? null,
          harnessCommandDigest: requestFacts?.harnessCommandDigest ?? commandKey,
          claimStatus: claim?.status ?? null,
          claimErrorCode: claim?.errorCode ?? null,
          claimCommandDigest: claim?.commandDigest ?? null,
          claimNativePreparationPurpose: claim?.nativePreparationPurpose ?? null,
          claimAgeMs: claim ? Math.max(0, Date.now() - claim.createdAt.getTime()) : null,
          unresolvedClaims: unresolvedClaims.map(row => ({ requestId: row.requestId, status: row.status,
            errorCode: row.errorCode, commandDigest: row.commandDigest,
            nativePreparationPurpose: row.nativePreparationPurpose, attempt: row.attempt,
            ageMs: Math.max(0, Date.now() - row.createdAt.getTime()),
            relayCommandOwner: relayCommandOwnerByRequestId.get(row.requestId) ?? null })),
          argumentCount: (execInput.args ?? []).length,
          monitorLabelPresent: (execInput.args ?? []).includes("paperclip-runner-monitor"),
          monitorScriptPrefix: (execInput.args?.[1] ?? "").startsWith("set -eu; identity_path=$1;"),
          errorName: error instanceof Error && ["Error", "HttpError", "TypeError"].includes(error.name) ? error.name : "other",
          errorCode: typeof rawCode === "string" && /^[a-z0-9_:-]{1,100}$/i.test(rawCode) ? rawCode : null,
          errorSourceFrames: safeErrorSourceFrames(error),
          nativePreReceiptFailedChecks: safeNativePreReceiptFailedChecks(error),
        });
      }
      throw error;
    } finally {
      if (purposeQueue.length === 0) purposesByCommandDigest.delete(commandKey);
    }
  };
  const environmentRuntime = environmentRuntimeService(db, { executeSandboxTask });
  const relayServer = createServer(); runtime.relay.attach(relayServer);
  relayServer.listen(0, "127.0.0.1"); await once(relayServer, "listening");
  await runtime.relay.listen(0);
  const relayAddress = relayServer.address();
  if (!relayAddress || typeof relayAddress === "string") throw new Error("conversation_software_host_relay_listen_failed");
  const relayHost = new WebSocket(`ws://127.0.0.1:${relayAddress.port}/api/internal/runtime/relay`);
  await once(relayHost, "open");
  const proof = signedRelayProof(host.id, hostKeys.privateKey); relayHost.send(JSON.stringify({ type: "hello", proof: proof.proof }));
  let authenticated = false;
  for (let i = 0; i < 150; i++) {
    const [nonce] = await db.select({ nonce: runtimeHostRequestNonces.nonce }).from(runtimeHostRequestNonces)
      .where(eq(runtimeHostRequestNonces.nonce, proof.nonce)).limit(1);
    if (nonce) { authenticated = true; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!authenticated) throw new Error("conversation_software_host_relay_auth_failed");
  let hostHeartbeatCount = 0;
  let hostHeartbeatFailed = false;
  let hostHeartbeatInFlight: Promise<void> | null = null;
  const postgresLockSnapshots: Array<Record<string, unknown>> = [];
  let postgresLockProbeInFlight = false;
  const probePostgresLocks = async () => {
    if (process.env.PAPERCLIP_RUNTIME_LOCK_DIAGNOSTICS !== "1" || postgresLockProbeInFlight || postgresLockSnapshots.length >= 20) return;
    postgresLockProbeInFlight = true;
    try {
      const [sample] = await db.execute(sql`
        select coalesce(json_agg(json_build_object(
          'pid', activity.pid,
          'applicationName', left(regexp_replace(coalesce(activity.application_name, ''), '[^A-Za-z0-9_.-]', '', 'g'), 64),
          'state', activity.state,
          'waitEventType', activity.wait_event_type,
          'waitEvent', activity.wait_event,
          'xactAgeMs', case when activity.xact_start is null then null
            else greatest(0, (extract(epoch from clock_timestamp() - activity.xact_start) * 1000)::int) end,
          'queryAgeMs', case when activity.query_start is null then null
            else greatest(0, (extract(epoch from clock_timestamp() - activity.query_start) * 1000)::int) end,
          'queryKind', case when activity.query ilike '%pg_advisory_%lock%' then 'advisory_lock'
            when activity.query ilike '%heartbeat_runs%' then 'heartbeat_runs'
            when activity.query ilike '%native_run_finalizations%' then 'native_run_finalizations'
            when activity.query ilike '%runtime_host_commands%' then 'runtime_host_commands'
            when activity.query ilike '%context_manifests%' then 'context_manifests'
            when activity.query ilike '%memory_records%' then 'memory_records'
            else lower(split_part(activity.query, ' ', 1)) end,
          'blockedBy', pg_blocking_pids(activity.pid),
          'locks', (select coalesce(json_agg(json_build_object(
              'lockType', lock.locktype, 'mode', lock.mode, 'granted', lock.granted,
              'classId', case when lock.locktype = 'advisory' then lock.classid::bigint else null end,
              'objectId', case when lock.locktype = 'advisory' then lock.objid::bigint else null end,
              'objectSubId', case when lock.locktype = 'advisory' then lock.objsubid else null end,
              'lockPurpose', case
                when lock.locktype = 'advisory' and lock.objsubid = 1 and
                  lock.classid::bigint = ((hashtextextended(${`business-events:${companyId}`}, 0) >> 32) & 4294967295) and
                  lock.objid::bigint = (hashtextextended(${`business-events:${companyId}`}, 0) & 4294967295)
                  then 'business_events_privacy'
                when lock.locktype = 'advisory' and lock.objsubid = 1 and
                  lock.classid::bigint = ((hashtextextended(${`memory:privacy:${companyId}`}, 0) >> 32) & 4294967295) and
                  lock.objid::bigint = (hashtextextended(${`memory:privacy:${companyId}`}, 0) & 4294967295)
                  then 'memory_privacy'
                else null end,
              'relation', case when lock.relation is null then null else lock.relation::regclass::text end,
              'transactionId', lock.transactionid)), '[]'::json)
            from pg_locks lock where lock.pid = activity.pid and
              (lock.locktype in ('advisory', 'transactionid') or lock.relation = 'heartbeat_runs'::regclass))
        ) order by activity.xact_start asc nulls last), '[]'::json) as sessions
        from pg_stat_activity activity
        where activity.datname = current_database() and activity.pid <> pg_backend_pid()
          and (cardinality(pg_blocking_pids(activity.pid)) > 0 or activity.pid = any(
            select unnest(pg_blocking_pids(waiter.pid)) from pg_stat_activity waiter
            where waiter.datname = current_database() and waiter.pid <> pg_backend_pid()
              and cardinality(pg_blocking_pids(waiter.pid)) > 0
          ) or (activity.xact_start < clock_timestamp() - interval '2 seconds' and exists (
            select 1 from pg_locks held where held.pid = activity.pid and held.relation = 'heartbeat_runs'::regclass
          )))
      `) as unknown as Array<{ sessions: unknown }>;
      const sessions = sample?.sessions;
      if (Array.isArray(sessions) && sessions.length > 0 && postgresLockSnapshots.length < 20)
        postgresLockSnapshots.push({ at: new Date().toISOString(), sessions });
    } catch {
      // The bounded diagnostic must never alter or mask runtime behavior.
    } finally {
      postgresLockProbeInFlight = false;
    }
  };
  const postgresLockProbeTimer = process.env.PAPERCLIP_RUNTIME_LOCK_DIAGNOSTICS === "1"
    ? setInterval(() => { void probePostgresLocks(); }, 250) : null;
  postgresLockProbeTimer?.unref();
  void probePostgresLocks();
  const heartbeatHost = async () => {
    if (hostHeartbeatInFlight) return await hostHeartbeatInFlight;
    const run = async () => {
      const inventoryRows = await db.select({
        cellId: runtimeCells.id, companyId: runtimeCells.companyId, generation: runtimeCells.generation,
        activeImageDigest: runtimeCells.activeImageDigest, desiredImageDigest: runtimeCells.desiredImageDigest,
        status: runtimeCells.status, capacityProfile: runtimeCells.capacityProfile,
      }).from(runtimeCells).where(and(eq(runtimeCells.runtimeHostId, host.id), isNull(runtimeCells.deletedAt)));
      const profileNames = [...new Set(inventoryRows.map(row => row.capacityProfile))];
      const profiles = profileNames.length ? await db.select().from(runtimeCapacityProfiles)
        .where(inArray(runtimeCapacityProfiles.key, profileNames)) : [];
      const profileByName = new Map(profiles.map(profile => [profile.key, profile]));
      const cells = inventoryRows.map(row => {
        const profile = profileByName.get(row.capacityProfile);
        if (!profile) throw new Error("conversation_software_host_capacity_profile_missing");
        const status = row.status === "HEALTHY" ? "healthy" : row.status === "STOPPED" ? "stopped" :
          row.status === "FENCED" ? "fenced" : row.status === "DEGRADED" || row.status === "FAILED" ? "failed" : "starting";
        return { cellId: row.cellId, companyId: row.companyId, generation: row.generation.toString(),
          imageDigest: row.activeImageDigest ?? row.desiredImageDigest, status,
          cpuMillis: profile.cpuMillis, memoryBytes: profile.memoryBytes.toString(), diskBytes: profile.diskBytes.toString() };
      });
      await runtime.heartbeat(host.id, { agentVersion: "6.0.2", cells });
      hostHeartbeatCount++;
    };
    const inFlight = run().catch(error => { hostHeartbeatFailed = true; throw error; });
    hostHeartbeatInFlight = inFlight;
    try { await inFlight; }
    finally { if (hostHeartbeatInFlight === inFlight) hostHeartbeatInFlight = null; }
  };
  await heartbeatHost();
  const hostHeartbeatTimer = setInterval(() => {
    if (!hostHeartbeatInFlight) void heartbeatHost().catch(() => {});
  }, 20_000);
  hostHeartbeatTimer.unref();
  const execFacts: Array<{ executable: string; cwdExact: boolean; modelCredentialPresent: boolean;
    managedModelBrokerOriginPresent: boolean;
    assignedMcpEnvironmentAbsent: boolean; credentialEnvironmentAbsent: boolean;
    exactBrokerProxyConfigured: boolean;
    nativePreparationPurpose: string | null; providerPackImageProbe: boolean;
    exitCode: number | null; timedOut: boolean }> = [];
  relayHost.on("message", raw => {
    let message: Record<string, any>;
    try { message = JSON.parse(raw.toString()) as Record<string, any>; } catch { return; }
    if (message.type !== "exec_open" || !Array.isArray(message.request?.argv) || typeof message.channelId !== "string") return;
    const request = message.request as Record<string, any>;
    const requestEnv = request.env && typeof request.env === "object" ? request.env as Record<string, unknown> : {};
    const nativePreparationPurpose = purposeByRequestId.get(request.requestId) ?? null;
    const requestArgv = request.argv as string[];
    const requestLabel = requestArgv[0] === "sh" && requestArgv[1] === "-c" ? requestArgv[2] : null;
    relayCommandOwnerByRequestId.set(request.requestId, requestLabel === "paperclip-runner-monitor"
      ? "runner_monitor" : requestLabel === "paperclip-runner-process-identity"
        ? "runner_identity_read" : requestLabel === "paperclip-runner-signal"
          ? "runner_signal" : requestLabel === "paperclip-runner-diagnostics"
            ? "runner_diagnostic_read" : requestLabel === "paperclip-runner-launch"
              ? "runner_launch" : requestLabel === "paperclip-runner-failure-check"
                ? "runner_failure_cleanup" : "other");
    const noBrokerPreparation = ["provider_artifact", "native_harness_state", "native_workspace_prepare", "native_runtime_context_prepare"]
      .includes(nativePreparationPurpose ?? "");
    const managedModelOriginMatches = requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === brokerOrigin &&
      Boolean(request.modelBrokerCredential);
    const noCredentialEnvironment = !Object.keys(requestEnv).some(name =>
      /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(name));
    const credentialFreePreparation = noBrokerPreparation && !managedModelOriginMatches &&
      !request.modelBrokerCredential && !request.brokerCredential && noCredentialEnvironment;
    if (!managedModelOriginMatches && !credentialFreePreparation) {
      relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId, exitCode: 126, timedOut: false }));
      return;
    }
    const modelToken = request.modelBrokerCredential?.capabilityToken;
    const modelCredentialPresent = typeof modelToken === "string";
    if (typeof modelToken === "string") input.setBrokerToken(modelToken);
    const argv = request.argv as string[];
    const cwd = typeof request.cwd === "string" && request.cwd.startsWith("/") ? request.cwd : input.root;
    const assignedMcpEnvironmentAbsent = !requestEnv.PAPERCLIP_NATIVE_MCP_NAME &&
      !requestEnv.PAPERCLIP_NATIVE_MCP_URL && !requestEnv.PAPERCLIP_NATIVE_MCP_TOKEN;
    const providerPackImageProbe = nativePreparationPurpose === "provider_artifact" && argv[0] === "sh" &&
      typeof argv[2] === "string" && argv[2].includes("$HOME/.local/share/paperclip-runner/provider-pack");
    const env = { ...process.env, ...requestEnv,
      ...(nativePreparationPurpose === "provider_artifact" && providerImageHome ? { HOME: providerImageHome } : {}),
      ...(request.modelBrokerCredential ? { ANTHROPIC_API_KEY: "paperclip-managed-model-broker" } : {}) } as NodeJS.ProcessEnv;
    if (credentialFreePreparation) {
      for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN",
        "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND", "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS",
        "PAPERCLIP_SANDBOX_BROKER_TOKEN", "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN",
        "PAPERCLIP_SANDBOX_BROKER_SESSION_ID"]) delete env[name];
    }
    const fact = { executable: argv[0] ?? "", cwdExact: cwd === expectedTaskRoot, modelCredentialPresent,
      managedModelBrokerOriginPresent: requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === brokerOrigin,
      assignedMcpEnvironmentAbsent, credentialEnvironmentAbsent: noCredentialEnvironment,
      exactBrokerProxyConfigured: input.brokerProxyOrigin !== null && env.HTTPS_PROXY === input.brokerProxyOrigin &&
        env.https_proxy === input.brokerProxyOrigin && env.NO_PROXY === "localhost,127.0.0.1,::1" &&
        requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === brokerOrigin &&
        ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].every(name => !env[name]),
      nativePreparationPurpose, providerPackImageProbe,
      exitCode: null as number | null, timedOut: false };
    execFacts.push(fact);
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    if (typeof request.stdinBase64 === "string") child.stdin.end(Buffer.from(request.stdinBase64, "base64")); else child.stdin.end();
    for (const [stream, output] of [["stdout", child.stdout], ["stderr", child.stderr]] as const)
      output.on("data", (chunk: Buffer) => relayHost.send(JSON.stringify({ type: "exec_output", channelId: message.channelId,
        stream, base64: chunk.toString("base64") })));
    child.on("error", () => { fact.exitCode = 127; relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId, exitCode: 127, timedOut: false })); });
    child.on("close", (code, signal) => { fact.exitCode = code ?? (signal ? 128 : 1);
      relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId,
      exitCode: fact.exitCode, timedOut: false })); });
  });

  const beforeNativeExecution = async ({ runId, issueId }: { runId: string; issueId: string | null }) => {
    if (!issueId) throw new Error("conversation_software_host_issue_missing");
    if (!prepareHostForRun) throw new Error("conversation_software_host_admission_unavailable");
    const [lease] = await db.select({ id: environmentLeases.id }).from(environmentLeases)
      .where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, runId),
        eq(environmentLeases.status, "active"), eq(environmentLeases.environmentId, environment.id))).limit(1);
    if (!lease) throw new Error("conversation_software_host_run_lease_missing");
    await prepareHostForRun(runId, lease.id);
    if (expectedIssueId !== issueId) throw new Error("conversation_software_host_issue_binding_changed");
    return { PATH: `${input.opencodeBinary.slice(0, input.opencodeBinary.lastIndexOf("/"))}:${process.env.PATH ?? ""}`,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      NODE_EXTRA_CA_CERTS: input.certBundlePath, SSL_CERT_FILE: input.certBundlePath,
      ...(input.brokerProxyOrigin ? { HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: input.brokerProxyOrigin,
        https_proxy: input.brokerProxyOrigin, ALL_PROXY: "", all_proxy: "",
        NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1" } : {}) };
  };

  const prepareHostForRunOnce = async (runId: string, expectedLeaseId: string) => {
    if (expectedRunId === runId && expectedTaskRoot && acquiredLeaseExpiresAt) return;
    if (expectedRunId !== null && expectedRunId !== runId)
      throw new Error("conversation_software_host_run_changed");
    expectedRunId = runId;
    const [run] = await db.select({ status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode,
      nativeIssueId: heartbeatRuns.nativeIssueId, responsibleUserId: heartbeatRuns.responsibleUserId,
      contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).limit(1);
    if (!run || run.status !== "running" || run.runtimeMode !== "native" ||
      run.responsibleUserId !== actor.userId || !run.nativeIssueId)
      throw new Error("conversation_software_host_native_run_binding_invalid");
    const runContext = run.contextSnapshot && typeof run.contextSnapshot === "object"
      ? run.contextSnapshot as Record<string, unknown> : {};
    const issueId = typeof runContext.issueId === "string" ? runContext.issueId : null;
    if (!issueId || issueId !== run.nativeIssueId)
      throw new Error("conversation_software_host_issue_binding_invalid");
    if (expectedIssueId !== null && expectedIssueId !== issueId)
      throw new Error("conversation_software_host_issue_changed");
    expectedIssueId = issueId;
    const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId)).limit(1);
    if (!manifest) throw new Error("conversation_software_host_manifest_missing");
    const conversationGeneration = run?.contextSnapshot && typeof run.contextSnapshot === "object" &&
      "conversationSessionGeneration" in run.contextSnapshot &&
      typeof run.contextSnapshot.conversationSessionGeneration === "number"
        ? run.contextSnapshot.conversationSessionGeneration : null;
    const scope = await findNativeChatWorkspaceScope(db, { adapterType: "paperclip_runner", environmentDriver: "sandbox",
      companyId, agentId, issueId, runId, responsibleUserId: run?.responsibleUserId,
      conversationSessionGeneration: conversationGeneration });
    const taskRoot = scope && scope.projectId === null ? nativeChatWorkspaceCwd(scope, null, false) : null;
    if (!taskRoot) throw new Error("conversation_software_host_private_task_root_missing");
    expectedTaskRoot = taskRoot;
    const boundary = policyFixture(); boundary.riskClass = "C3"; boundary.requiredControls = [...SANDBOX_CONTROLS];
    boundary.filesystem.readPaths = [taskWorkspaceNamespace];
    boundary.filesystem.writePaths = [taskWorkspaceNamespace];
    boundary.filesystem.readPaths = [taskRoot]; boundary.filesystem.writePaths = [taskRoot]; boundary.filesystem.deniedPaths = [];
    boundary.process.allowedBinaries = []; boundary.process.allowedSyscalls = []; boundary.network.destinations = [];
    const candidate = structuredClone(boundary);
    candidate.network.destinations = [{ hostname: new URL(brokerOrigin).hostname,
      port: Number(new URL(brokerOrigin).port || 443), methods: ["POST"], pathPrefixes: ["/runtime-tools/model/v1/messages"] }];
    const compiled = await service.compile(actor, companyId, binding.id, { expectedVersion: 2,
      executionManifestId: manifest.id, candidatePolicy: candidate });
    if (compiled.status !== "qualified") {
      const proof = compiled.compilation as { proverResult?: unknown; failedBoundaries?: unknown; unsupportedFeatures?: unknown } | null;
      const safeNames = (value: unknown) => Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && /^[a-z0-9_:-]{1,80}$/.test(entry)).slice(0, 24)
        : [];
      throw new Error(`conversation_software_host_policy_compile_failed_${JSON.stringify({
        status: compiled.status,
        proverResult: proof && typeof proof.proverResult === "string" ? proof.proverResult : null,
        failedBoundaries: safeNames(proof?.failedBoundaries),
        unsupportedFeatures: safeNames(proof?.unsupportedFeatures),
      })}`);
    }
    const observedBeforeAdmission = await driveHost(transport.bridge(actor).inspect(identity));
    preAdmissionObservation = { state: observedBeforeAdmission.state,
      generationMatches: observedBeforeAdmission.generation === identity.cellGeneration,
      imageDigestMatches: observedBeforeAdmission.imageDigest === imageDigest,
      controlsHealthy: observedBeforeAdmission.controlsHealthy };
    if (observedBeforeAdmission.state !== "stopped" || observedBeforeAdmission.generation !== identity.cellGeneration ||
      observedBeforeAdmission.imageDigest !== imageDigest || !observedBeforeAdmission.controlsHealthy)
      throw new Error(`conversation_software_host_pre_admission_observation_invalid_${JSON.stringify(preAdmissionObservation)}`);
    const admittedPromise = service.admit(actor, companyId, binding.id, { expectedVersion: 3, policySnapshotId: compiled.id });
    const admitted = await driveHost(admittedPromise);
    if (admitted.binding.status !== "running") throw new Error("conversation_software_host_workload_not_running");
    const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
      eq(environmentLeases.id, expectedLeaseId), eq(environmentLeases.heartbeatRunId, runId),
      eq(environmentLeases.environmentId, environment.id), eq(environmentLeases.status, "active"))).limit(1);
    if (!lease) throw new Error("conversation_software_host_run_lease_missing");
    if (!lease.expiresAt || lease.expiresAt <= new Date())
      throw new Error("conversation_software_host_provider_lease_expiry_missing");
    acquiredLeaseExpiresAt = lease.expiresAt.toISOString();
    const expectDenied = async (work: Promise<unknown>) => {
      try { await work; return false; } catch { return true; }
    };
    const wrongRunDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId: randomUUID(), leaseId: lease.id,
      command: "true", cwd: taskRoot, timeoutMs: 1000 }));
    const wrongLeaseDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: randomUUID(),
      command: "true", cwd: taskRoot, timeoutMs: 1000 }));
    const wrongCwdDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
      command: "true", cwd: `${taskRoot}/outside`, timeoutMs: 1000 }));
    const execCountBeforeStartProbes = execFacts.length;
    const wrongSessionStartCommandDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
      command: "sh", args: ["-c", "exit 0", "paperclip-not-runner-launch"], cwd: taskRoot, timeoutMs: 1000,
      nativePreparationPurpose: "native_session_start" }));
    const wrongSessionStartRootDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
      command: "sh", args: ["-c", "exit 0", "paperclip-runner-launch"], cwd: `${taskRoot}/outside`, timeoutMs: 1000,
      nativePreparationPurpose: "native_session_start" }));
    const wrongSessionStartExecuted = execFacts.length !== execCountBeforeStartProbes;
    const broadened = structuredClone(candidate);
    broadened.filesystem.writePaths = ["/"];
    const wrongPolicy = compileSandboxPolicy({ boundary, candidate: broadened, capabilities: capabilities() as any,
      authorizedConnectionGrantHashes: {}, credentialBrokerOrigin: brokerOrigin, credentialBrokerBindings: [], sourcePolicyRefs: [] });
    const wrongPolicyDenied = wrongPolicy.failedBoundaries.includes("filesystem_write_expansion");
    if (!wrongRunDenied || !wrongLeaseDenied || !wrongCwdDenied || !wrongPolicyDenied ||
      !wrongSessionStartCommandDenied || !wrongSessionStartRootDenied || wrongSessionStartExecuted)
      throw new Error("conversation_software_host_negative_admission_control_failed");
    negativeNativeSessionStartControls = { wrongCommandDenied: wrongSessionStartCommandDenied,
      wrongRootDenied: wrongSessionStartRootDenied, noExecution: !wrongSessionStartExecuted };
  };
  prepareHostForRun = async (runId, leaseId) => {
    const existing = hostAdmissionByRun.get(runId);
    if (existing) {
      if (existing.leaseId !== leaseId) throw new Error("conversation_software_host_lease_binding_changed");
      return await existing.promise;
    }
    const promise = prepareHostForRunOnce(runId, leaseId);
    hostAdmissionByRun.set(runId, { leaseId, promise });
    try {
      await promise;
    } catch (error) {
      hostAdmissionByRun.delete(runId);
      throw error;
    }
  };

  const providerPackRoot = process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH?.trim();
  if (!providerPackRoot || !lstatSync(providerPackRoot).isDirectory())
    throw new Error("conversation_software_host_provider_pack_image_missing");
  providerImageHome = mkdtempSync(join(tmpdir(), "paperclip-managed-provider-image-"));
  const preinstalledPack = join(providerImageHome, ".local", "share", "paperclip-runner", "provider-pack");
  mkdirSync(join(providerImageHome, ".local", "share", "paperclip-runner"), { recursive: true, mode: 0o700 });
  symlinkSync(providerPackRoot, preinstalledPack, "dir");

  return {
    sandboxExec: runtime.executeSandboxTask,
    environmentRuntime,
    beforeNativeExecution,
    facts: () => {
      const sandboxStageCounts = execFacts.reduce<Record<string, { calls: number; nonzeroExits: number; timeouts: number }>>((counts, fact) => {
        const stage = fact.nativePreparationPurpose ?? "unclassified";
        const count = counts[stage] ?? { calls: 0, nonzeroExits: 0, timeouts: 0 };
        count.calls++;
        if (fact.exitCode !== null && fact.exitCode !== 0) count.nonzeroExits++;
        if (fact.timedOut) count.timeouts++;
        counts[stage] = count;
        return counts;
      }, {});
      return { mode: "controlled_signed_host_relay", hostId: host.id, cellId: cell.id,
      bindingId: binding.id, environmentId: environment.id, relayAuthenticated: relayHost.readyState === WebSocket.OPEN,
      providerAttestedLeaseExpiresAt: acquiredLeaseExpiresAt,
      preAdmissionObservation,
      hostHeartbeatCount,
      hostHeartbeatFailed,
      postgresLockSnapshots,
      relayCommandOwners: [...relayCommandOwnerByRequestId.entries()]
        .map(([requestId, owner]) => ({ requestId, owner })).slice(-256),
      sandboxExecutionChecks,
      sandboxExecutionFailures,
      sandboxStageCounts,
      execCount: execFacts.length, exactPrivateCwdCount: execFacts.filter(fact => fact.cwdExact).length,
      managedModelCredentialCount: execFacts.filter(fact => fact.modelCredentialPresent).length,
      execFacts,
      assignedMcpEnvironmentAbsentCount: execFacts.filter(fact => fact.assignedMcpEnvironmentAbsent).length,
      negativeControls: { wrongRunDenied: true, wrongLeaseDenied: true, wrongCwdDenied: true, wrongPolicyDenied: true },
      negativeNativeSessionStartControls,
      nativeSessionStartCredentialNegativeControls,
      executableNames: [...new Set(execFacts.map(fact => fact.executable.split("/").pop() ?? ""))] };
    },
    close: async () => { clearInterval(hostHeartbeatTimer); if (postgresLockProbeTimer) clearInterval(postgresLockProbeTimer);
      if (postgresLockProbeInFlight) await new Promise(resolve => setTimeout(resolve, 20));
      if (hostHeartbeatInFlight) await hostHeartbeatInFlight;
      relayHost.close(); await new Promise<void>(resolve => relayServer.close(() => resolve())); await runtime.relay.stop();
      if (providerImageHome) rmSync(providerImageHome, { recursive: true, force: true }); },
  };
}
