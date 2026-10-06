import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, stat, realpath } from "node:fs/promises";
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
      env: { HOME: stateHome, PATH: "/usr/bin:/bin", LANG: "C", NO_COLOR: "1" },
    };
  }
  async function cli(args, deadlineAt, json = true) {
    const privateConfig = await privateConfiguration();
    const remaining = new Date(deadlineAt).getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error("sandbox_host_unavailable");
    const { stdout } = await run(
      privateConfig.executable,
      ["--gateway", config.gateway, "--workspace", config.workspace, ...args],
      {
        env: privateConfig.env,
        timeout: Math.min(6000, remaining),
        maxBuffer: 262144,
        windowsHide: true,
        killSignal: "SIGKILL",
      },
    );
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
  async function executeAction(request, deadlineAt) {
    const scope = request.scope;
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
    if (request.action === "inspect")
      return {
        action: "inspect",
        state:
          detail.phase === "Stopped"
            ? "stopped"
            : detail.phase === "Error"
              ? "failed"
              : "unknown",
        policyHash: null,
        imageDigest: null,
        generation: scope.cellGeneration,
        controlsHealthy: false,
      };
    if (request.action === "effective_policy") {
      const policy = await cli(
        ["policy", "get", scope.sandboxRef, "--full", "--output", "json"],
        deadlineAt,
      );
      if (
        policy.sandbox !== scope.sandboxRef ||
        policy.status !== "effective" ||
        !policy.policy
      )
        throw new Error("sandbox_observation_unavailable");
      await observed(scope, deadlineAt);
      return { action: "effective_policy", document: policy.policy };
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
          return existing.result;
        }
        if (
          Object.keys(journal.commands).length >=
          (["stop", "destroy", "revoke_providers"].includes(request.action)
            ? 10256
            : 10000)
        )
          throw new Error("sandbox_host_unavailable");
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
