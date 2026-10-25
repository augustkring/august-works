import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, realpath, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { atomicJson } from "./journal.mjs";

const runFile = promisify(execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const actions = new Set([
  "capabilities",
  "prepare",
  "inspect",
  "effective_policy",
  "apply",
  "start",
  "probe",
  "revoke_providers",
  "stop",
  "destroy",
]);
/** Private native-host controller. The pinned CLI observes only supported
 * OpenShell controls. It cannot attest the complete AW outer boundary. */
export function openShellHostEngine({
  config,
  epoch,
  root = "/var/lib/aw-runtime",
  run = runFile,
  spawnProcess = spawn,
}) {
  const journalFile = path.join(root, "openshell-journal.json");
  let journal = { version: 2, scopes: {}, commands: {} },
    queue = Promise.resolve();
  function serial(work) {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  function validScope(scope) {
    return (
      scope &&
      Object.keys(scope).sort().join(",") ===
        "bindingId,cellGeneration,cellId,companyId,sandboxRef" &&
      [scope.companyId, scope.bindingId, scope.cellId].every(
        (v) => typeof v === "string" && uuid.test(v),
      ) &&
      /^[1-9][0-9]{0,18}$/.test(scope.cellGeneration) &&
      scope.sandboxRef === `aw-v7-${scope.bindingId}`
    );
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
      );
    return value;
  }
  function sameDocument(left, right) {
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  }
  async function privateConfiguration() {
    if (
      !config ||
      !path.isAbsolute(config.executable ?? "") ||
      !/^[a-f0-9]{64}$/.test(config.executableSha256 ?? "") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(config.gateway ?? "") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(config.workspace ?? "") ||
      !path.isAbsolute(config.stateHome ?? "")
    )
      throw new Error("sandbox_host_unavailable");
    const executable = await realpath(config.executable),
      stateHome = await realpath(config.stateHome);
    const [binary, home] = await Promise.all([
      stat(executable),
      stat(stateHome),
    ]);
    const privateOwner = (info) =>
      info.uid === (process.getuid?.() ?? 0) && !(info.mode & 0o022);
    if (
      !binary.isFile() ||
      !(binary.mode & 0o100) ||
      binary.size > 100 * 1024 * 1024 ||
      !privateOwner(binary) ||
      !home.isDirectory() ||
      !privateOwner(home) ||
      home.mode & 0o077 ||
      hash(await readFile(executable)) !== config.executableSha256
    )
      throw new Error("sandbox_host_unavailable");
    return {
      executable,
      stateHome,
      env: { HOME: stateHome, PATH: "/usr/bin:/bin", LANG: "C", NO_COLOR: "1" },
    };
  }
  async function cli(args, deadlineAt, json = true, envOverrides = {}, timeoutCapMs = 6000) {
    const privateConfig = await privateConfiguration();
    const remaining = new Date(deadlineAt).getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error("sandbox_host_unavailable");
    const { stdout } = await run(
      privateConfig.executable,
      ["--gateway", config.gateway, "--workspace", config.workspace, ...args],
      {
        env: { ...privateConfig.env, ...envOverrides },
        timeout: Math.min(timeoutCapMs, remaining),
        maxBuffer: 262144,
        windowsHide: true,
        killSignal: "SIGKILL",
      },
    );
    return json ? JSON.parse(stdout) : stdout;
  }
  async function inspectBrokerProviderProfile(request, deadlineAt) {
    const broker = request.brokerCredential;
    if (!broker) return null;
    const profile = await cli(["profile", "describe", broker.profileId, "--output", "json"], deadlineAt);
    if (!profile || profile.id !== broker.profileId || hash(JSON.stringify(canonical(profile))) !== broker.profileHash ||
      !Array.isArray(profile.credentials) || profile.credentials.length !== 1 ||
      !Array.isArray(profile.endpoints) || profile.endpoints.length !== 1 ||
      !Array.isArray(profile.binaries)) throw new Error("sandbox_operation_unsupported");
    const credential = profile.credentials[0];
    if (credential?.auth_style !== "bearer" || credential.header_name?.toLowerCase() !== "authorization" ||
      credential.env_vars?.length !== 1 || credential.env_vars[0] !== "PAPERCLIP_SANDBOX_BROKER_TOKEN" ||
      credential.token_grant || credential.refresh) throw new Error("sandbox_operation_unsupported");
    const endpoint = profile.endpoints[0];
    const origin = new URL(request.env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN ?? "");
    const port = origin.port ? Number(origin.port) : origin.protocol === "https:" ? 443 : 80;
    const rules = endpoint?.rules;
    if (origin.protocol !== "https:" || endpoint?.host !== origin.hostname || endpoint?.port !== port ||
      endpoint.protocol !== "rest" || endpoint.enforcement !== "enforce" || endpoint.allow_uninspected_credentials === true ||
      endpoint.path || !Array.isArray(rules) || rules.length !== 1 ||
      rules[0]?.allow?.method !== "POST" || rules[0]?.allow?.path !== "/mcp/gateways/*")
      throw new Error("sandbox_operation_unsupported");
    return { profile, origin };
  }
  async function attachBrokerProvider(request, scope, deadlineAt, providerName) {
    const broker = request.brokerCredential;
    if (!broker) return;
    if (Date.parse(broker.expiresAt) <= Date.now() || Date.parse(broker.expiresAt) > Date.parse(deadlineAt))
      throw new Error("exec_timeout");
    const decoded = (() => {
      try { return JSON.parse(Buffer.from(broker.capabilityToken.split(".")[1], "base64url").toString("utf8")); }
      catch { return null; }
    })();
    const capability = decoded?.sandbox_broker;
    if (!decoded || decoded.purpose !== "sandbox_broker" || decoded.aud !== "paperclip-sandbox-broker" ||
      decoded.jti !== request.requestId || capability?.parentRequestId !== request.requestId ||
      capability.bindingId !== request.bindingId || capability.cellId !== scope.cellId ||
      capability.generation !== scope.cellGeneration || capability.hostEpoch !== request.hostEpoch ||
      capability.runId !== request.runId || capability.attemptId !== request.attemptId || capability.attempt !== request.attempt ||
      capability.manifestId !== request.manifestId || capability.manifestHash !== request.manifestHash ||
      capability.policySnapshotId !== request.policySnapshotId || capability.policyHash !== request.policyHash ||
      capability?.endpointOrigin !== request.env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN ||
      capability?.brokerSessionId !== request.env.PAPERCLIP_SANDBOX_BROKER_SESSION_ID ||
      Date.parse(capability?.expiresAt ?? "") !== Date.parse(broker.expiresAt) || decoded.exp * 1000 > Date.parse(broker.expiresAt) + 999 ||
      decoded.company_id !== scope.companyId || decoded.run_id !== request.runId || !Number.isFinite(decoded.exp) || decoded.exp * 1000 <= Date.now())
      throw new Error("sandbox_scope_changed");
    const { origin } = await inspectBrokerProviderProfile(request, deadlineAt);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
      throw new Error("sandbox_operation_unsupported");
    const providerCredentialEnv = "PAPERCLIP_SANDBOX_BROKER_TOKEN";
    const providerEnv = { [providerCredentialEnv]: broker.capabilityToken };
    await cli(["provider", "create", "--name", providerName, "--type", broker.profileId, "--credential", providerCredentialEnv], deadlineAt, false, providerEnv);
    await cli(["provider", "update", providerName, "--credential-expires-at", `${providerCredentialEnv}=${broker.expiresAt}`], deadlineAt, false);
    const waitSeconds = Math.max(1, Math.min(15, Math.floor((Date.parse(deadlineAt) - Date.now()) / 1000)));
    await cli(["sandbox", "provider", "attach", scope.sandboxRef, providerName, "--wait", "--timeout", String(waitSeconds), "--output", "json"], deadlineAt, true, {}, 18_000);
    const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
    if (!Array.isArray(attached.providers) || !attached.providers.some(value => value?.name === providerName) || attached.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
  }
  async function detachAndDeleteBrokerProvider(scope, deadlineAt, providerName) {
    await cli(["sandbox", "provider", "detach", scope.sandboxRef, providerName, "--wait", "--timeout", "15", "--output", "json"], deadlineAt, true, {}, 18_000);
    const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
    if (!Array.isArray(attached.providers) || attached.providers.some(value => value?.name === providerName) || attached.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
    await cli(["provider", "delete", providerName], deadlineAt, false);
  }
  async function deleteQuiescedBrokerProviders(scope, deadlineAt) {
    const pending = Object.values(journal.commands).flatMap(command => {
      const provider = command?.brokerProvider;
      return provider && validScope(provider.scope) && sameDocument(provider.scope, scope) &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.name ?? "")
        ? [provider.name] : [];
    });
    const names = [...new Set(pending)].slice(0, 32);
    for (const name of names) await cli(["provider", "delete", name], deadlineAt, false);
    if (names.length) await serial(async () => {
      for (const command of Object.values(journal.commands)) {
        if (command?.brokerProvider && names.includes(command.brokerProvider.name) && validScope(command.brokerProvider.scope) && sameDocument(command.brokerProvider.scope, scope))
          delete command.brokerProvider;
      }
      await atomicJson(journalFile, journal);
    });
  }
  async function docker(args, deadlineAt, json = true) {
    const privateConfig = await privateConfiguration();
    const remaining = new Date(deadlineAt).getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error("sandbox_host_unavailable");
    const { stdout } = await run("docker", args, {
      env: {
        ...privateConfig.env,
        PATH: process.env.PATH,
        DOCKER_HOST: "unix:///var/run/docker.sock",
      },
      timeout: Math.min(6000, remaining),
      maxBuffer: 262144,
      windowsHide: true,
      killSignal: "SIGKILL",
    });
    return json ? JSON.parse(stdout) : stdout;
  }
  async function observed(scope, deadlineAt) {
    const detail = await cli(
      ["sandbox", "get", scope.sandboxRef, "--output", "json"],
      deadlineAt,
    );
    const labels = {
      "aw.company_id": scope.companyId,
      "aw.binding_id": scope.bindingId,
      "aw.cell_id": scope.cellId,
      "aw.generation": scope.cellGeneration,
    };
    if (
      typeof detail.id !== "string" ||
      !uuid.test(detail.id) ||
      detail.name !== scope.sandboxRef ||
      detail.workspace !== config.workspace ||
      Object.entries(labels).some(
        ([key, value]) => detail.labels?.[key] !== value,
      )
    )
      throw new Error("sandbox_scope_changed");
    const pinned = journal.scopes[scope.bindingId];
    if (pinned) {
      if (
        Object.keys(scope).some((key) => pinned.scope[key] !== scope[key]) ||
        pinned.sandboxId !== detail.id
      ) throw new Error("sandbox_scope_changed");
    } else {
      if (Object.keys(journal.scopes).length >= 256)
        throw new Error("sandbox_host_unavailable");
      // The gateway's immutable sandbox ID is distinct from a reusable name.
      // Persist it before the first effect, so restart cannot adopt a replacement.
      journal.scopes[scope.bindingId] = { scope, sandboxId: detail.id };
      await atomicJson(journalFile, journal);
    }
    return detail;
  }
  async function policy(scope, deadlineAt) {
    const result = await cli(
      ["policy", "get", scope.sandboxRef, "--full", "--output", "json"],
      deadlineAt,
    );
    if (
      result.sandbox !== scope.sandboxRef ||
      result.status !== "effective" ||
      !/^[a-f0-9]{64}$/.test(result.hash ?? "") ||
      !Number.isSafeInteger(result.version) ||
      result.version < 0 ||
      !Number.isSafeInteger(result.config_revision) ||
      result.config_revision < 0 ||
      !result.policy
    )
      throw new Error("sandbox_observation_unavailable");
    await observed(scope, deadlineAt);
    return result;
  }
  async function container(scope, sandbox, imageDigest, deadlineAt) {
    const engineId = (await docker(["info", "--format", "{{.ID}}"], deadlineAt, false)).trim();
    if (!engineId || engineId.length > 200 || /[\r\n\0]/.test(engineId))
      throw new Error("sandbox_operation_unsupported");
    const engineIdHash = hash(engineId);
    const enginePin = journal.scopes[scope.bindingId]?.dockerEngineId;
    if (enginePin && enginePin !== engineIdHash)
      throw new Error("sandbox_scope_changed");
    const idsOutput = await docker(
      [
        "ps",
        "-aq",
        "--filter",
        `label=openshell.ai/sandbox-id=${sandbox.id}`,
        "--filter",
        "label=openshell.ai/isolation-role=sandbox",
      ],
      deadlineAt,
      false,
    );
    const ids = idsOutput.trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]))
      throw new Error("sandbox_operation_unsupported");
    const values = await docker(["inspect", ids[0]], deadlineAt);
    if (!Array.isArray(values) || values.length !== 1)
      throw new Error("sandbox_observation_unavailable");
    const value = values[0];
    const labels = value.Config?.Labels;
    const expectedLabels = {
      "openshell.ai/managed-by": "openshell",
      "openshell.ai/sandbox-id": sandbox.id,
      "openshell.ai/sandbox-name": scope.sandboxRef,
      "openshell.ai/sandbox-workspace": config.workspace,
      "openshell.ai/isolation-backend": "openshell-sandbox",
      "openshell.ai/isolation-role": "sandbox",
      "aw.company_id": scope.companyId,
      "aw.binding_id": scope.bindingId,
      "aw.cell_id": scope.cellId,
      "aw.generation": scope.cellGeneration,
    };
    if (
      value.Id !== ids[0] ||
      Object.entries(expectedLabels).some(([key, expected]) => labels?.[key] !== expected) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(labels?.["openshell.ai/sandbox-namespace"] ?? "") ||
      value.Config?.Image !== value.Image ||
      !Array.isArray(value.RepoDigests) ||
      !value.RepoDigests.includes(imageDigest) ||
      !/^sha256:[a-f0-9]{64}$/.test(value.Image ?? "") ||
      typeof value.State?.Running !== "boolean"
    )
      throw new Error("sandbox_scope_changed");
    const pinned = journal.scopes[scope.bindingId];
    if (pinned.containerId && pinned.containerId !== value.Id)
      throw new Error("sandbox_scope_changed");
    if (pinned.imageId && pinned.imageId !== value.Image)
      throw new Error("sandbox_scope_changed");
    if (
      pinned.namespace &&
      pinned.namespace !== labels["openshell.ai/sandbox-namespace"]
    )
      throw new Error("sandbox_scope_changed");
    if (!pinned.containerId || !pinned.dockerEngineId) {
      journal.scopes[scope.bindingId] = {
        ...pinned,
        containerId: value.Id,
        imageId: value.Image,
        namespace: labels["openshell.ai/sandbox-namespace"],
        dockerEngineId: engineIdHash,
      };
      await atomicJson(journalFile, journal);
    }
    return value;
  }
  async function contain(scope, imageDigest, deadlineAt) {
    try {
      await revokeProviders(scope, deadlineAt);
      await cli(["sandbox", "stop", scope.sandboxRef], deadlineAt, false);
      const stopped = await observed(scope, deadlineAt);
      const workload = await container(scope, stopped, imageDigest, deadlineAt);
      if (stopped.phase !== "Stopped" || workload.State.Running)
        throw new Error("sandbox_observation_unavailable");
      await deleteQuiescedBrokerProviders(scope, deadlineAt);
    } catch {
      throw new Error("sandbox_host_unavailable");
    }
  }
  function staticPolicyMatches(left, right) {
    return (
      sameDocument(left.filesystem_policy, right.filesystem_policy) &&
      sameDocument(left.landlock, right.landlock) &&
      sameDocument(left.process, right.process)
    );
  }
  async function revokeProviders(scope, deadlineAt) {
    const before = await cli(
      ["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "4", "--output", "json"],
      deadlineAt,
    );
    if (!Array.isArray(before.providers) || before.providers.length > 4 || before.next_page_token !== "")
      throw new Error("sandbox_operation_unsupported");
    for (const provider of before.providers) {
      await observed(scope, deadlineAt);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.name ?? ""))
        throw new Error("sandbox_observation_unavailable");
      await cli(
        ["sandbox", "provider", "detach", scope.sandboxRef, provider.name, "--wait", "--timeout", "2", "--output", "json"],
        deadlineAt,
      );
    }
    const after = await cli(
      ["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "4", "--output", "json"],
      deadlineAt,
    );
    if (!Array.isArray(after.providers) || after.providers.length || after.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
    await observed(scope, deadlineAt);
  }
  function samePolicyRevision(result, pinned) {
    return (
      result.hash === pinned.effectivePolicyHash &&
      result.version === pinned.policyVersion &&
      result.config_revision === pinned.configRevision &&
      sameDocument(result.policy, pinned.document)
    );
  }
  async function executeAction(request, deadlineAt) {
    const scope = request.scope;
    const sourceExpiry = request.action === "apply"
      ? request.admission?.expiresAt
      : request.action === "start"
        ? request.start?.expiresAt
        : null;
    if (sourceExpiry !== null && sourceExpiry !== undefined &&
      (!Number.isFinite(Date.parse(sourceExpiry)) ||
        Date.parse(sourceExpiry) <= Date.now() ||
        Date.parse(deadlineAt) > Date.parse(sourceExpiry))) {
      throw new Error("sandbox_scope_changed");
    }
    // Neither a private JSON file nor CLI version/kernel output is physical
    // qualification of credentials, syscalls, resource limits or forced Stop.
    if (request.action === "capabilities")
      return { action: "capabilities", capabilities: null };
    if (request.action === "probe")
      return { action: "probe", verdict: "unsupported", observationHash: null };
    if (!config) throw new Error("sandbox_host_unavailable");
    const version = await cli(["--version"], deadlineAt, false);
    if (version.trim() !== "openshell 0.1.2")
      throw new Error("sandbox_host_unavailable");
    const detail = await observed(scope, deadlineAt);
    if (request.action === "inspect") {
      try {
        const workload = await container(scope, detail, request.imageDigest, deadlineAt);
        let policyHash = null;
        const pinnedPolicy = journal.scopes[scope.bindingId]?.policy;
        if (pinnedPolicy) {
          const currentPolicy = await policy(scope, deadlineAt);
          if (samePolicyRevision(currentPolicy, pinnedPolicy))
            policyHash = pinnedPolicy.policyHash;
        }
        return {
          action: "inspect",
          state: detail.phase === "Error" ? "failed" :
            detail.phase === "Stopped" && !workload.State.Running ? "stopped" :
            detail.phase === "Ready" && workload.State.Running ? "running" : "unknown",
          policyHash,
          imageDigest: request.imageDigest,
          generation: scope.cellGeneration,
          // The command path has physical observations, but the release profile
          // still has no complete qualified capability snapshot.
          controlsHealthy: false,
        };
      } catch {
        return {
          action: "inspect",
          state: "unknown",
          policyHash: null,
          imageDigest: null,
          generation: scope.cellGeneration,
          controlsHealthy: false,
        };
      }
    }
    if (request.action === "effective_policy") {
      const current = await policy(scope, deadlineAt);
      return { action: "effective_policy", document: current.policy };
    }
    if (request.action === "apply") {
      const admission = request.admission;
      if (!admission || Date.parse(admission.expiresAt) <= Date.now()) throw new Error("sandbox_scope_changed");
      const workload = await container(scope, detail, request.imageDigest, deadlineAt);
      if (detail.phase !== "Stopped" || workload.State.Running)
        throw new Error("sandbox_operation_unsupported");
      await revokeProviders(scope, deadlineAt);
      const before = await policy(scope, deadlineAt);
      if (!staticPolicyMatches(before.policy, admission.document))
        return {
          action: "apply",
          applied: false,
          policyHash: null,
          requiresRecreate: true,
          effectivePolicyHash: before.hash,
        };
      const privateConfig = await privateConfiguration();
      const filename = path.join(privateConfig.stateHome, `policy-${randomUUID()}.json`);
      try {
        await writeFile(filename, JSON.stringify(admission.document), {
          flag: "wx",
          mode: 0o600,
        });
        const remaining = Math.floor(
          (new Date(deadlineAt).getTime() - Date.now()) / 1000,
        );
        if (remaining < 1) throw new Error("sandbox_host_unavailable");
        await cli(
          [
            "policy",
            "set",
            scope.sandboxRef,
            "--policy",
            filename,
            "--wait",
            "--timeout",
            String(Math.min(6, remaining)),
          ],
          deadlineAt,
          false,
        );
      } catch (error) {
        let committed = false;
        try {
          committed = sameDocument(
            (await policy(scope, deadlineAt)).policy,
            admission.document,
          );
        } catch {}
        if (!committed) await contain(scope, request.imageDigest, deadlineAt);
        if (committed) {
          const observedPolicy = await policy(scope, deadlineAt);
          journal.scopes[scope.bindingId] = {
            ...journal.scopes[scope.bindingId],
            policy: {
              policyHash: admission.policyHash,
              effectivePolicyHash: observedPolicy.hash,
              policyVersion: observedPolicy.version,
              configRevision: observedPolicy.config_revision,
              document: observedPolicy.policy,
              appliedAt: new Date().toISOString(),
            },
          };
          await atomicJson(journalFile, journal);
          return {
            action: "apply",
            applied: true,
            policyHash: admission.policyHash,
            requiresRecreate: false,
            effectivePolicyHash: observedPolicy.hash,
          };
        }
        if ([
          "sandbox_host_unavailable",
          "sandbox_scope_changed",
          "sandbox_operation_unsupported",
          "sandbox_observation_unavailable",
        ].includes(error?.message)) throw error;
        throw new Error("sandbox_observation_unavailable");
      } finally {
        await unlink(filename).catch(() => {});
      }
      const after = await policy(scope, deadlineAt);
      if (!sameDocument(after.policy, admission.document)) {
        await contain(scope, request.imageDigest, deadlineAt);
        throw new Error("sandbox_observation_unavailable");
      }
      journal.scopes[scope.bindingId] = {
        ...journal.scopes[scope.bindingId],
        policy: {
          policyHash: admission.policyHash,
          effectivePolicyHash: after.hash,
          policyVersion: after.version,
          configRevision: after.config_revision,
          document: after.policy,
          appliedAt: new Date().toISOString(),
        },
      };
      await atomicJson(journalFile, journal);
      return {
        action: "apply",
        applied: true,
        policyHash: admission.policyHash,
        requiresRecreate: false,
        effectivePolicyHash: after.hash,
      };
    }
    if (request.action === "start") {
      const start = request.start;
      if (
        !start ||
        new Date(start.expiresAt) <= new Date() ||
        !/^[a-f0-9]{64}$/.test(start.policyHash)
      )
        throw new Error("sandbox_scope_changed");
      const pinnedPolicy = journal.scopes[scope.bindingId]?.policy;
      if (!pinnedPolicy || pinnedPolicy.policyHash !== start.policyHash)
        throw new Error("sandbox_scope_changed");
      await revokeProviders(scope, deadlineAt);
      const beforePolicy = await policy(scope, deadlineAt);
      if (!samePolicyRevision(beforePolicy, pinnedPolicy))
        throw new Error("sandbox_scope_changed");
      const beforeWorkload = await container(
        scope,
        detail,
        request.imageDigest,
        deadlineAt,
      );
      if (detail.phase === "Ready" && beforeWorkload.State.Running) {
        return {
          action: "start",
          started: true,
          operationId: hash(start.idempotencyKey),
          sandboxId: detail.id,
          containerId: beforeWorkload.Id,
          imageDigest: request.imageDigest,
          policyHash: start.policyHash,
          effectivePolicyHash: beforePolicy.hash,
        };
      }
      if (detail.phase !== "Stopped" || beforeWorkload.State.Running)
        throw new Error("sandbox_operation_unsupported");
      try {
        await cli(["sandbox", "start", scope.sandboxRef], deadlineAt, false);
      } catch {
        // A lost CLI response is resolved from independent gateway and Docker
        // observations below; it is never treated as success by itself.
      }
      const afterDetail = await observed(scope, deadlineAt);
      const afterPolicy = await policy(scope, deadlineAt);
      const afterWorkload = await container(
        scope,
        afterDetail,
        request.imageDigest,
        deadlineAt,
      );
      if (
        afterDetail.phase !== "Ready" ||
        !afterWorkload.State.Running ||
        !samePolicyRevision(afterPolicy, pinnedPolicy)
      ) {
        await contain(scope, request.imageDigest, deadlineAt);
        throw new Error("sandbox_observation_unavailable");
      }
      return {
        action: "start",
        started: true,
        operationId: hash(start.idempotencyKey),
        sandboxId: afterDetail.id,
        containerId: afterWorkload.Id,
        imageDigest: request.imageDigest,
        policyHash: start.policyHash,
        effectivePolicyHash: afterPolicy.hash,
      };
    }
    if (request.action === "stop") {
      await cli(["sandbox", "stop", scope.sandboxRef], deadlineAt, false);
      if ((await observed(scope, deadlineAt)).phase !== "Stopped")
        throw new Error("sandbox_observation_unavailable");
      return { action: "stop", stopped: true };
    }
    if (request.action === "destroy") {
      await cli(["sandbox", "delete", scope.sandboxRef], deadlineAt, false);
      const remaining = await cli(
        [
          "sandbox",
          "list",
          "--selector",
          `aw.binding_id=${scope.bindingId}`,
          "--page-size",
          "10",
          "--output",
          "json",
        ],
        deadlineAt,
      );
      if (
        !Array.isArray(remaining.sandboxes) ||
        remaining.sandboxes.length > 10 ||
        remaining.next_page_token !== "" ||
        remaining.sandboxes.some((value) =>
          value.name === scope.sandboxRef || value.id === detail.id,
        )
      )
        throw new Error("sandbox_observation_unavailable");
      delete journal.scopes[scope.bindingId];
      await atomicJson(journalFile, journal);
      return { action: "destroy", destroyed: true };
    }
    if (request.action === "revoke_providers") {
      const providers = await cli(
        [
          "sandbox",
          "provider",
          "list",
          scope.sandboxRef,
          "--page-size",
          "4",
          "--output",
          "json",
        ],
        deadlineAt,
      );
      if (
        !Array.isArray(providers.providers) ||
        providers.providers.length > 4 ||
        providers.next_page_token !== ""
      )
        throw new Error("sandbox_operation_unsupported");
      for (const provider of providers.providers) {
        await observed(scope, deadlineAt);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.name))
          throw new Error("sandbox_observation_unavailable");
        await cli(
          [
            "sandbox",
            "provider",
            "detach",
            scope.sandboxRef,
            provider.name,
            "--wait",
            "--timeout",
            "2",
            "--output",
            "json",
          ],
          deadlineAt,
        );
      }
      const after = await cli(
        [
          "sandbox",
          "provider",
          "list",
          scope.sandboxRef,
          "--page-size",
          "4",
          "--output",
          "json",
        ],
        deadlineAt,
      );
      if (
        !Array.isArray(after.providers) ||
        after.providers.length ||
        after.next_page_token !== ""
      )
        throw new Error("sandbox_observation_unavailable");
      await observed(scope, deadlineAt);
      return { action: "revoke_providers", revoked: true };
    }
    // CLI sandbox detail does not expose an observed immutable image digest.
    // Configured image/labels therefore cannot earn a preparation receipt.
    throw new Error("sandbox_operation_unsupported");
  }
  async function executeStream(input, onOutput, signal) {
    const request = input?.request;
    const requestKeys = ["requestId", "bindingId", "hostEpoch", "runId", "attemptId", "attempt", "manifestId", "manifestHash", "policySnapshotId", "policyHash", "commandDigest", "deadlineAt", "sandboxRef", "imageDigest", "argv", "cwd", "env", "stdinBase64"];
    const requestKeysWithBroker = [...requestKeys, "brokerCredential"];
    if (!input || !validScope(input.scope) || !request ||
      ![requestKeys, requestKeysWithBroker].some(keys => Object.keys(request).sort().join(",") === keys.slice().sort().join(",")) ||
      !uuid.test(request.requestId) || request.bindingId !== input.scope.bindingId ||
      request.hostEpoch !== epoch || !uuid.test(request.runId) ||
      (request.attemptId !== null && !uuid.test(request.attemptId)) ||
      !Number.isSafeInteger(request.attempt) || request.attempt < 1 ||
      !uuid.test(request.manifestId) || !/^[a-f0-9]{64}$/.test(request.manifestHash) ||
      !uuid.test(request.policySnapshotId) || !/^[a-f0-9]{64}$/.test(request.policyHash) ||
      !/^[a-f0-9]{64}$/.test(request.commandDigest) ||
      request.sandboxRef !== input.scope.sandboxRef ||
      !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/i.test(request.imageDigest) ||
      !Array.isArray(request.argv) || request.argv.length < 1 || request.argv.length > 64 ||
      request.argv.some(value => typeof value !== "string" || !value.length || value.length > 8192) ||
      typeof request.cwd !== "string" || !path.isAbsolute(request.cwd) ||
      !request.env || typeof request.env !== "object" || Array.isArray(request.env) || Object.keys(request.env).length > 64 ||
      Object.entries(request.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof value !== "string" || value.length > 8192 || /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(key)) ||
      (request.brokerCredential !== undefined && (!request.brokerCredential || typeof request.brokerCredential.capabilityToken !== "string" || request.brokerCredential.capabilityToken.length > 16_384 ||
        typeof request.brokerCredential.profileId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(request.brokerCredential.profileId) ||
        typeof request.brokerCredential.profileHash !== "string" || !/^[a-f0-9]{64}$/.test(request.brokerCredential.profileHash) ||
        typeof request.brokerCredential.expiresAt !== "string" || !Number.isFinite(Date.parse(request.brokerCredential.expiresAt)))) ||
      (!!request.brokerCredential !== (typeof request.env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN === "string" && typeof request.env.PAPERCLIP_SANDBOX_BROKER_SESSION_ID === "string")) ||
      typeof request.stdinBase64 !== "string" || request.stdinBase64.length > 512 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.stdinBase64) ||
      typeof input.capabilityToken !== "string" || input.capabilityToken.length > 16384 ||
      typeof onOutput !== "function") throw new Error("sandbox_scope_changed");
    const deadlineAt = request.deadlineAt;
    if (!Number.isFinite(Date.parse(deadlineAt)) || Date.parse(deadlineAt) <= Date.now()) throw new Error("sandbox_host_unavailable");
    const commandDigest = hash(JSON.stringify(canonical({ argv: request.argv, cwd: request.cwd, env: request.env,
      stdinHash: hash(Buffer.from(request.stdinBase64, "base64")), timeoutDeadline: deadlineAt,
      brokerCapabilityHash: request.brokerCredential ? hash(request.brokerCredential.capabilityToken) : null,
      brokerProviderProfile: request.brokerCredential ? { id: request.brokerCredential.profileId, hash: request.brokerCredential.profileHash } : null,
    })));
    if (commandDigest !== request.commandDigest) throw new Error("sandbox_scope_changed");
    const detail = await observed(input.scope, deadlineAt);
    const pinnedPolicy = journal.scopes[input.scope.bindingId]?.policy;
    const effectivePolicy = await policy(input.scope, deadlineAt);
    const workload = await container(input.scope, detail, request.imageDigest, deadlineAt);
    if (!pinnedPolicy || pinnedPolicy.policyHash !== request.policyHash || !samePolicyRevision(effectivePolicy, pinnedPolicy) ||
      detail.phase !== "Ready" || !workload.State.Running) throw new Error("sandbox_operation_unsupported");
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");

    const requestHash = hash(JSON.stringify(canonical({ request: { ...request, stdinBase64: undefined }, stdinHash: hash(Buffer.from(request.stdinBase64, "base64")), scope: input.scope })));
    const privateConfig = await privateConfiguration();
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");
    await serial(async () => {
      const existing = journal.commands[request.requestId];
      if (existing) {
        if (existing.requestHash !== requestHash) throw new Error("sandbox_scope_changed");
        throw new Error("exec_unknown");
      }
      if (Object.keys(journal.commands).length >= 10256) throw new Error("sandbox_host_unavailable");
      journal.commands[request.requestId] = { requestHash, result: null, kind: "exec", state: "claimed",
        ...(request.brokerCredential ? { brokerProvider: {
          name: `awbr-${request.requestId.replaceAll("-", "")}`,
          expiresAt: request.brokerCredential.expiresAt,
          scope: input.scope,
        } } : {}),
      };
      await atomicJson(journalFile, journal);
    });
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");
    const brokerProviderName = request.brokerCredential ? `awbr-${request.requestId.replaceAll("-", "")}` : null;
    if (brokerProviderName) await attachBrokerProvider(request, input.scope, deadlineAt, brokerProviderName);
    const cliArgs = ["--gateway", config.gateway, "--workspace", config.workspace, "sandbox", "exec", "--name", input.scope.sandboxRef, "--workdir", request.cwd];
    for (const key of Object.keys(request.env).sort()) cliArgs.push("--env", `${key}=${request.env[key]}`);
    cliArgs.push("--", ...request.argv);
    const remaining = Math.max(1, Math.min(60_000, Date.parse(deadlineAt) - Date.now()));
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");
    const child = spawnProcess(privateConfig.executable, cliArgs, {
      cwd: privateConfig.stateHome,
      env: privateConfig.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let timedOut = false, outputBytes = 0, settled = false;
    const terminate = () => { if (!settled) child.kill("SIGKILL"); };
    const onAbort = () => terminate();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; terminate(); }, remaining);
    timeout.unref?.();
    const forward = async (stream, source) => {
      for await (const chunk of source) {
        outputBytes += chunk.length;
        if (outputBytes > 64 * 1024 * 1024) { terminate(); throw new Error("exec_rejected"); }
        await onOutput(stream, Buffer.from(chunk));
      }
    };
    const readOutput = Promise.all([forward("stdout", child.stdout), forward("stderr", child.stderr)]);
    child.stdin.end(Buffer.from(request.stdinBase64, "base64"));
    let exitCode;
    try {
      const exited = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signalName) => resolve({ code, signalName }));
      });
      const result = await exited;
      await readOutput;
      settled = true;
      exitCode = Number.isInteger(result.code) ? result.code : (timedOut ? 124 : 1);
    } catch (error) {
      terminate();
      await Promise.allSettled([readOutput]);
      throw error;
    } finally {
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
    if (timedOut) throw new Error("exec_unknown");
    if (brokerProviderName) await detachAndDeleteBrokerProvider(input.scope, deadlineAt, brokerProviderName);
    await serial(async () => {
      journal.commands[request.requestId] = { requestHash, result: { exitCode, timedOut }, kind: "exec", state: "completed" };
      await atomicJson(journalFile, journal);
    });
    return { exitCode, timedOut };
  }
  return {
    async initialize() {
      try {
        journal = JSON.parse(await readFile(journalFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("sandbox_host_unavailable");
      }
      if (journal.version === 1 && journal.scopes && !Array.isArray(journal.scopes)) {
        // Old observations never recorded an immutable gateway ID. Keep them
        // fenced instead of silently adopting whichever instance now owns a name.
        journal = {
          ...journal,
          version: 2,
          scopes: Object.fromEntries(Object.entries(journal.scopes).map(
            ([id, scope]) => [id, { scope, sandboxId: null }],
          )),
        };
      }
      if (
        journal.version !== 2 ||
        !journal.scopes ||
        !journal.commands ||
        Array.isArray(journal.scopes) ||
        Array.isArray(journal.commands) ||
        Object.keys(journal.scopes).length > 256 ||
        Object.entries(journal.scopes).some(([id, v]) =>
          !v || !validScope(v.scope) || id !== v.scope.bindingId ||
          (v.sandboxId !== null && !uuid.test(v.sandboxId ?? "")),
        ) ||
        Object.keys(journal.commands).length > 10256
      )
        throw new Error("sandbox_host_unavailable");
    },
    execute(id, request, deadlineAt) {
      return serial(async () => {
        if (
          !uuid.test(id) ||
          !validScope(request?.scope) ||
          request.version !== 1 ||
          request.hostEpoch !== epoch ||
          !actions.has(request.action) ||
          !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(
            request.imageDigest ?? "",
          ) ||
          typeof request.requesterUserId !== "string" ||
          request.requesterUserId.length > 200 ||
          !Number.isFinite(new Date(deadlineAt).getTime()) ||
          new Date(deadlineAt) <= new Date()
        )
          throw new Error("sandbox_scope_changed");
        if (
          (request.action === "probe") !== Boolean(request.probe) ||
          (request.action === "apply") !== Boolean(request.admission) ||
          (request.action === "start") !== Boolean(request.start) ||
          Object.keys(request).some(
            (key) =>
              ![
                "version",
                "scope",
                "action",
                "hostEpoch",
                "imageDigest",
                "requesterUserId",
                "probe",
                "admission",
                "start",
                "claimToken",
              ].includes(key),
          )
        )
          throw new Error("sandbox_scope_changed");
        const { claimToken: _, ...immutable } = request;
        const requestHash = hash(JSON.stringify(immutable));
        const existing = journal.commands[id];
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("sandbox_scope_changed");
          // An intent persisted before an effect without its completion receipt
          // is ambiguous. Never replay the external operation after that point.
          return existing.result ?? {
            success: false,
            reply: null,
            errorCode: "sandbox_observation_unavailable",
          };
        }
        if (
          Object.keys(journal.commands).length >=
          (["stop", "destroy", "revoke_providers"].includes(request.action)
            ? 10256
            : 10000)
        )
          throw new Error("sandbox_host_unavailable");
        journal.commands[id] = { requestHash, result: null };
        await atomicJson(journalFile, journal);
        let result;
        try {
          result = {
            success: true,
            reply: await executeAction(request, deadlineAt),
            errorCode: null,
          };
        } catch (error) {
          result = {
            success: false,
            reply: null,
            errorCode: [
              "sandbox_host_unavailable",
              "sandbox_scope_changed",
              "sandbox_operation_unsupported",
              "sandbox_observation_unavailable",
            ].includes(error.message)
              ? error.message
              : "sandbox_host_unavailable",
          };
        }
        journal.commands[id] = { requestHash, result };
        await atomicJson(journalFile, journal);
        return result;
      });
    },
    executeStream,
    acknowledge(id) {
      return serial(async () => {
        delete journal.commands[id];
        await atomicJson(journalFile, journal);
      });
    },
    fenceAll() {
      return serial(async () => {
        let incomplete = false;
        for (const { scope } of Object.values(journal.scopes)) {
          try {
            const deadlineAt = new Date(Date.now() + 15000).toISOString();
            await observed(scope, deadlineAt);
            await cli(["sandbox", "stop", scope.sandboxRef], deadlineAt, false);
            if ((await observed(scope, deadlineAt)).phase !== "Stopped")
              incomplete = true;
          } catch {
            incomplete = true;
          }
        }
        if (incomplete) throw new Error("sandbox_host_unavailable");
      });
    },
  };
}
