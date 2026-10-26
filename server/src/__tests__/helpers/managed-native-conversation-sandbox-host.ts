import { constants, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID, sign } from "node:crypto";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import { WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import {
  agentProviderBindings, billingAccounts, billingAccountCompanies, billingSubscriptions, createDb,
  agents, agentExecutionManifests, environmentLeases, runtimeCapacityProfiles, runtimeCells, runtimeHosts, runtimeHostRequestNonces,
  runtimeVersionCatalog, sandboxQualificationRuns,
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
  certBundlePath: string;
  setBrokerToken: (token: string) => void;
}) {
  const { db, actor, companyId, agentId, providerBindingId } = input;
  const brokerOrigin = new URL(input.brokerOrigin).origin;
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
  const capabilities = () => ({ ...Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, true])),
    backend: "openshell", backendVersion: "0.1.2", hostKernelVersion: "controlled-software-host",
    sandboxImageDigest: imageDigest, filesystemEnforcementMode: "hard_requirement", staticPolicyRequiresRecreate: true,
    dynamicNetworkPolicy: true, policyProverBoundaryCheck: true, policyProverCoverage: [...SANDBOX_CONTROLS],
    credentialBindingDimensions: ["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"],
    credentialBrokerProviderProfile: { id: "conversation-broker", hash: "d".repeat(64) },
    modelBrokerProviderProfile: { id: "conversation-model-broker", hash: "e".repeat(64) },
    testedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    qualificationHash: "f".repeat(64), evidenceKind: "protected_host_report" });
  const service = executionSandboxService(db, { operatorUserIds: [actor.userId!], credentialBrokerOrigin: brokerOrigin,
    backendFor: (_binding: unknown, currentActor: AuthorizationActor) => {
      const bridge = transport.bridge(currentActor);
      return {
        backend: "openshell", evidenceKind: "protected_host_report",
        capabilities: async () => bridge.capabilities(identity),
        prepareSandbox: async (scope: SandboxIdentity) => ({ ...scope, backendVersion: "0.1.2", imageDigest }),
        inspectWorkload: async (scope: SandboxIdentity) => ({ ...scope, state: state.get(scope.cellId) ?? "stopped",
          policyHash: policies.get(scope.cellId) ?? null, imageDigest, controlsHealthy: true }),
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
          return { verdict: "pass", observationHash: createHash("sha256").update(`controlled:${value.test.caseId}`).digest("hex") };
        },
      } as any;
    } });
  const binding = await service.create(actor, companyId, { runtimeCellId: cell.id,
    expectedCellGeneration: cell.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy: (() => {
      const boundary = policyFixture(); boundary.riskClass = "C3"; boundary.requiredControls = [...SANDBOX_CONTROLS];
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
        : action === "probe" ? { action, verdict: "pass", observationHash: createHash("sha256").update(`software:${command.probe?.case?.caseId ?? command.probe?.caseId ?? "probe"}`).digest("hex") }
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
  const runtime = runtimeControlService(db, { runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 } } as SaasPlatformConfig,
    undefined, { credentialBrokerOrigin: brokerOrigin, workerModels: input.gateway as any });
  const environmentRuntime = environmentRuntimeService(db, { executeSandboxTask: runtime.executeSandboxTask });
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
  let expectedTaskRoot: string | null = null;
  const execFacts: Array<{ executable: string; cwdExact: boolean; modelCredentialPresent: boolean }> = [];
  relayHost.on("message", raw => {
    let message: Record<string, any>;
    try { message = JSON.parse(raw.toString()) as Record<string, any>; } catch { return; }
    if (message.type !== "exec_open" || !Array.isArray(message.request?.argv) || typeof message.channelId !== "string") return;
    const request = message.request as Record<string, any>;
    const requestEnv = request.env && typeof request.env === "object" ? request.env as Record<string, unknown> : {};
    if (requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN !== brokerOrigin) {
      relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId, exitCode: 126, timedOut: false }));
      return;
    }
    const modelToken = request.modelBrokerCredential?.capabilityToken;
    const modelCredentialPresent = typeof modelToken === "string";
    if (typeof modelToken === "string") input.setBrokerToken(modelToken);
    const argv = request.argv as string[];
    const cwd = typeof request.cwd === "string" && request.cwd.startsWith("/") ? request.cwd : input.root;
    execFacts.push({ executable: argv[0] ?? "", cwdExact: cwd === expectedTaskRoot, modelCredentialPresent });
    const env = { ...process.env, ...requestEnv,
      PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: brokerOrigin } as NodeJS.ProcessEnv;
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    if (typeof request.stdinBase64 === "string") child.stdin.end(Buffer.from(request.stdinBase64, "base64")); else child.stdin.end();
    for (const [stream, output] of [["stdout", child.stdout], ["stderr", child.stderr]] as const)
      output.on("data", (chunk: Buffer) => relayHost.send(JSON.stringify({ type: "exec_output", channelId: message.channelId,
        stream, base64: chunk.toString("base64") })));
    child.on("error", () => relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId, exitCode: 127, timedOut: false })));
    child.on("close", (code, signal) => relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId,
      exitCode: code ?? (signal ? 128 : 1), timedOut: false })));
  });

  const beforeNativeExecution = async ({ runId, issueId }: { runId: string; issueId: string | null }) => {
    if (!issueId) throw new Error("conversation_software_host_issue_missing");
    const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId)).limit(1);
    if (!manifest) throw new Error("conversation_software_host_manifest_missing");
    const scope = await findNativeChatWorkspaceScope(db, { adapterType: "paperclip_runner", environmentDriver: "sandbox",
      companyId, agentId, issueId, instanceRoot: input.root });
    const taskRoot = scope && scope.projectId === null ? nativeChatWorkspaceCwd(scope, null, false) : null;
    if (!taskRoot) throw new Error("conversation_software_host_private_task_root_missing");
    expectedTaskRoot = taskRoot;
    const boundary = policyFixture(); boundary.riskClass = "C3"; boundary.requiredControls = [...SANDBOX_CONTROLS];
    boundary.filesystem.readPaths = [taskRoot]; boundary.filesystem.writePaths = [taskRoot]; boundary.filesystem.deniedPaths = [];
    boundary.process.allowedBinaries = []; boundary.process.allowedSyscalls = []; boundary.network.destinations = [];
    const candidate = structuredClone(boundary);
    candidate.network.destinations = [{ hostname: new URL(brokerOrigin).hostname,
      port: Number(new URL(brokerOrigin).port || 443), methods: ["POST"], pathPrefixes: ["/runtime-tools/model/v1/messages"] }];
    const compiled = await service.compile(actor, companyId, binding.id, { expectedVersion: 2,
      executionManifestId: manifest.id, candidatePolicy: candidate });
    if (compiled.status !== "qualified") throw new Error("conversation_software_host_policy_compile_failed");
    const admittedPromise = service.admit(actor, companyId, binding.id, { expectedVersion: 3, policySnapshotId: compiled.id });
    const admitted = await driveHost(admittedPromise);
    if (admitted.binding.status !== "running") throw new Error("conversation_software_host_workload_not_running");
    const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.heartbeatRunId, runId),
      eq(environmentLeases.status, "active"))).limit(1);
    if (!lease || lease.environmentId !== environment.id) throw new Error("conversation_software_host_run_lease_missing");
    const expectDenied = async (work: Promise<unknown>) => {
      try { await work; return false; } catch { return true; }
    };
    const wrongRunDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId: randomUUID(), leaseId: lease.id,
      command: "true", cwd: taskRoot, timeoutMs: 1000 }));
    const wrongLeaseDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: randomUUID(),
      command: "true", cwd: taskRoot, timeoutMs: 1000 }));
    const wrongCwdDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
      command: "true", cwd: `${taskRoot}/outside`, timeoutMs: 1000 }));
    const broadened = structuredClone(candidate);
    broadened.filesystem.writePaths = ["/"];
    const wrongPolicy = compileSandboxPolicy({ boundary, candidate: broadened, capabilities: capabilities() as any,
      authorizedConnectionGrantHashes: {}, credentialBrokerOrigin: brokerOrigin, credentialBrokerBindings: [], sourcePolicyRefs: [] });
    const wrongPolicyDenied = wrongPolicy.failedBoundaries.includes("filesystem_write_expansion");
    if (!wrongRunDenied || !wrongLeaseDenied || !wrongCwdDenied || !wrongPolicyDenied)
      throw new Error("conversation_software_host_negative_admission_control_failed");
    return { PATH: `${input.opencodeBinary.slice(0, input.opencodeBinary.lastIndexOf("/"))}:${process.env.PATH ?? ""}`,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      NODE_EXTRA_CA_CERTS: input.certBundlePath, SSL_CERT_FILE: input.certBundlePath };
  };

  return {
    sandboxExec: runtime.executeSandboxTask,
    environmentRuntime,
    beforeNativeExecution,
    facts: () => ({ mode: "controlled_signed_host_relay", hostId: host.id, cellId: cell.id,
      bindingId: binding.id, environmentId: environment.id, relayAuthenticated: relayHost.readyState === WebSocket.OPEN,
      execCount: execFacts.length, exactPrivateCwdCount: execFacts.filter(fact => fact.cwdExact).length,
      managedModelCredentialCount: execFacts.filter(fact => fact.modelCredentialPresent).length,
      negativeControls: { wrongRunDenied: true, wrongLeaseDenied: true, wrongCwdDenied: true, wrongPolicyDenied: true },
      executableNames: [...new Set(execFacts.map(fact => fact.executable.split("/").pop() ?? ""))] }),
    close: async () => { relayHost.close(); await new Promise<void>(resolve => relayServer.close(() => resolve())); await runtime.relay.stop(); },
  };
}
