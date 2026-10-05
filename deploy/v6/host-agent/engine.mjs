import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import {
  mkdir,
  writeFile,
  chown,
  rm,
  readFile,
  rename,
  stat,
  open,
} from "node:fs/promises";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createEncryptedBackup, restoreEncryptedBackup } from "./backup.mjs";
import { atomicJson, loadJournal } from "./journal.mjs";
const exec = promisify(execFile);
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DIGEST = /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/;
export function runtimeNetworkRules(cidr) {
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr ?? ""))
    throw new Error("network_cidr_unavailable");
  // Host-bound packets traverse INPUT, not DOCKER-USER. Permit replies to
  // host-initiated Gateway connections while denying new cell-to-host traffic.
  return [
    [
      "INPUT",
      "-s",
      cidr,
      "-m",
      "conntrack",
      "!",
      "--ctstate",
      "ESTABLISHED,RELATED",
      "-j",
      "DROP",
    ],
    ...[
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "169.254.0.0/16",
      "100.64.0.0/10",
      "127.0.0.0/8",
    ].map((destination) => [
      "DOCKER-USER",
      "-s",
      cidr,
      "-d",
      destination,
      "-j",
      "DROP",
    ]),
  ];
}
export async function command(binary, args, timeout = 60000) {
  // Provider credentials and command payloads are never shell source or process environment.
  const { stdout } = await exec(binary, args, {
    timeout,
    maxBuffer: 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      DOCKER_HOST: "unix:///var/run/docker.sock",
    },
  });
  return stdout;
}
export function validateCellCommand(value) {
  if (
    !value ||
    !UUID.test(value.cellId) ||
    !UUID.test(value.companyId) ||
    !/^\d{1,19}$/.test(value.generation) ||
    BigInt(value.generation) < 1n ||
    !DIGEST.test(value.imageDigest)
  )
    throw new Error("invalid_cell_command");
  const c = value.capacity;
  if (
    !c ||
    !Number.isInteger(c.cpuMillis) ||
    c.cpuMillis < 100 ||
    c.cpuMillis > 64000 ||
    !/^\d{1,16}$/.test(c.memoryBytes) ||
    BigInt(c.memoryBytes) < 67108864n ||
    !/^\d{1,16}$/.test(c.diskBytes) ||
    BigInt(c.diskBytes) < 1048576n ||
    !Number.isInteger(c.pidsLimit) ||
    c.pidsLimit < 16 ||
    c.pidsLimit > 16384
  )
    throw new Error("invalid_cell_capacity");
  if (
    typeof value.gatewayToken !== "string" ||
    !/^[A-Za-z0-9_-]{40,128}$/.test(value.gatewayToken)
  )
    throw new Error("invalid_gateway_credential");
  return value;
}
export function gatewayConfiguration(cell) {
  const config = {
    gateway: {
      mode: "local",
      bind: "lan",
      port: 18789,
      auth: { mode: "token", token: cell.gatewayToken },
    },
    agents: { defaults: { workspace: "/home/node/.openclaw/workspace" } },
    discovery: { mdns: { mode: "off" } },
  };
  if (cell.modelProvider) {
    const value = cell.modelProvider,
      endpoints = {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-responses",
        },
        anthropic: {
          baseUrl: "https://api.anthropic.com",
          api: "anthropic-messages",
        },
        openrouter: {
          baseUrl: "https://openrouter.ai/api/v1",
          api: "openai-completions",
        },
      };
    if (
      !endpoints[value.provider] ||
      typeof value.apiKey !== "string" ||
      value.apiKey.length < 8 ||
      value.apiKey.length > 8192 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value.modelId)
    )
      throw new Error("invalid_model_provider_configuration");
    config.models = {
      mode: "merge",
      providers: {
        "aw-byok": {
          ...endpoints[value.provider],
          apiKey: value.apiKey,
          models: [{ id: value.modelId, name: value.modelId }],
        },
      },
    };
    config.agents.defaults.model = { primary: "aw-byok/" + value.modelId };
  }
  return config;
}
export function dockerRunArguments(
  cell,
  stateDir,
  configFile,
  network,
  hostname,
) {
  return [
    "run",
    "--detach",
    "--name",
    "aw-cell-" + cell.cellId,
    "--hostname",
    hostname,
    "--label",
    "aw.cell=" + cell.cellId,
    "--label",
    "aw.company=" + cell.companyId,
    "--label",
    "aw.generation=" + cell.generation,
    "--network",
    network,
    "--restart",
    "no",
    "--read-only",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--cpus",
    (cell.capacity.cpuMillis / 1000).toString(),
    "--memory",
    cell.capacity.memoryBytes,
    "--memory-swap",
    cell.capacity.memoryBytes,
    "--pids-limit",
    String(cell.capacity.pidsLimit),
    "--ulimit",
    "nofile=4096:4096",
    "--log-driver",
    "local",
    "--log-opt",
    "max-size=10m",
    "--log-opt",
    "max-file=2",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=128m",
    "--mount",
    `type=bind,source=${stateDir},target=/home/node/.openclaw`,
    "--mount",
    `type=bind,source=${configFile},target=/run/aw/gateway.json,readonly`,
    "--env",
    "HOME=/home/node",
    "--env",
    "OPENCLAW_STATE_DIR=/home/node/.openclaw",
    "--env",
    "OPENCLAW_CONFIG_PATH=/run/aw/gateway.json",
    "--env",
    "OPENCLAW_DISABLE_BONJOUR=1",
    cell.imageDigest,
    "node",
    "openclaw.mjs",
    "gateway",
    "--bind",
    "lan",
    "--port",
    "18789",
  ];
}
export function runtimeEngine({
  root = "/var/lib/aw-runtime",
  runner = command,
  healthDeadlineMs = 45000,
  backupEndpoint,
} = {}) {
  const journalFile = path.join(root, "journal.json");
  let journal;
  async function initialize() {
    journal = await loadJournal(journalFile);
  }
  async function persist() {
    await atomicJson(journalFile, journal);
  }
  async function pruneAcknowledgedCommands() {
    const cutoff = Date.now() - 30 * 86400000;
    let changed = false;
    for (const [id, entry] of Object.entries(journal.commands)) {
      // A server-accepted terminal receipt is no longer claimable. Keep the
      // replay record for 30 days; never discard an unknown or unacknowledged outcome.
      if (
        entry.result &&
        Number.isFinite(Date.parse(entry.acceptedAt)) &&
        Date.parse(entry.acceptedAt) < cutoff
      ) {
        delete journal.commands[id];
        changed = true;
      }
    }
    if (changed) await persist();
  }
  async function inspect(name) {
    try {
      return JSON.parse(await runner("docker", ["inspect", name]))[0];
    } catch (error) {
      if (/No such (object|container)/.test(String(error.stderr))) return null;
      throw error;
    }
  }
  async function isolateNetwork(network) {
    // Docker network isolation separates cells. Egress rules also deny the host, private services and metadata.
    const details = JSON.parse(
      await runner("docker", ["network", "inspect", network]),
    )[0];
    const cidr = details.IPAM?.Config?.[0]?.Subnet;
    for (const rule of runtimeNetworkRules(cidr)) {
      try {
        await runner("iptables", ["-C", ...rule]);
      } catch {
        await runner("iptables", ["-I", ...rule]);
      }
    }
  }
  async function ensureVolume(cell) {
    const dir = path.join(root, "cells", cell.cellId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chown(dir, 1000, 1000);
    let record = journal.cells[cell.cellId];
    if (!record) {
      record = {
        companyId: cell.companyId,
        generation: cell.generation,
        imageDigest: cell.imageDigest,
        projectId: journal.nextProjectId++,
        status: "stopped",
      };
      journal.cells[cell.cellId] = record;
      await persist();
    }
    // Fail closed on an unqualified filesystem: xfs_quota must successfully enforce every state volume limit.
    await runner("xfs_quota", [
      "-x",
      "-c",
      `project -s -p ${dir} ${record.projectId}`,
      path.join(root, "cells"),
    ]);
    await runner("xfs_quota", [
      "-x",
      "-c",
      `limit -p bhard=${cell.capacity.diskBytes} ${record.projectId}`,
      path.join(root, "cells"),
    ]);
    return dir;
  }
  async function healthy(name) {
    const deadline = Date.now() + healthDeadlineMs;
    while (Date.now() < deadline) {
      const container = await inspect(name);
      if (!container?.State?.Running) throw new Error("gateway_not_running");
      try {
        await runner(
          "docker",
          ["exec", name, "node", "openclaw.mjs", "health", "--json"],
          10000,
        );
        return container;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error("gateway_health_timeout");
  }
  async function execute(id, type, raw) {
    if (!UUID.test(id)) throw new Error("invalid_command_id");
    const cell = validateCellCommand(raw);
    if (!journal) await initialize();
    const { claimToken: _claimToken, ...evidence } = cell;
    if (evidence.backup)
      evidence.backup = { ...evidence.backup, url: undefined };
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ type, payload: evidence }))
      .digest("hex");
    const previous = journal.commands[id];
    if (!previous && Object.keys(journal.commands).length >= 10000) {
      await pruneAcknowledgedCommands();
      // Reserve a bounded emergency allowance for stopping and deleting cells.
      const limit = ["stop", "delete"].includes(type) ? 10256 : 10000;
      if (Object.keys(journal.commands).length >= limit)
        throw new Error("host_command_journal_capacity");
    }
    if (previous && previous.requestHash !== requestHash)
      throw new Error("command_evidence_mismatch");
    if (previous?.result) return previous.result;
    const current = journal.cells[cell.cellId];
    if (
      current &&
      (current.companyId !== cell.companyId ||
        (current.generation !== cell.generation &&
          !(
            ["restore", "migrate"].includes(type) &&
            current.generation === cell.sourceGeneration &&
            BigInt(cell.generation) === BigInt(current.generation) + 1n
          )))
    )
      throw new Error("stale_cell_generation");
    const name = "aw-cell-" + cell.cellId,
      network = "aw-net-" + cell.cellId;
    let container = await inspect(name);
    if (
      container &&
      (container.Config?.Labels?.["aw.company"] !== cell.companyId ||
        (container.Config?.Labels?.["aw.generation"] !== cell.generation &&
          !(
            ["restore", "migrate"].includes(type) &&
            container.Config?.Labels?.["aw.generation"] ===
              cell.sourceGeneration &&
            !container.State?.Running
          )))
    )
      throw new Error("container_scope_mismatch");
    journal.commands[id] = {
      ...previous,
      cellId: cell.cellId,
      generation: cell.generation,
      type,
      requestHash,
      startedAt: new Date().toISOString(),
    };
    await persist();
    let result;
    if (["provision", "start", "upgrade", "rotate_gateway"].includes(type)) {
      if (
        container &&
        container.State?.Running &&
        ["upgrade", "rotate_gateway"].includes(type)
      )
        throw new Error("stop_required_for_image_or_credential_change");
      const stateDir = await ensureVolume(cell);
      const configDir = path.join(root, "secrets", cell.cellId);
      await mkdir(configDir, { recursive: true, mode: 0o700 });
      await chown(configDir, 1000, 1000);
      const configFile = path.join(configDir, "gateway.json");
      await writeFile(configFile, JSON.stringify(gatewayConfiguration(cell)), {
        mode: 0o600,
      });
      await chown(configFile, 1000, 1000);
      if (type === "rotate_gateway") {
        if (container?.State?.Running)
          throw new Error("stop_required_for_image_or_credential_change");
        journal.cells[cell.cellId].status = "stopped";
        result = { success: true, state: "stopped", evidence: {} };
        journal.commands[id].result = result;
        await persist();
        return result;
      }
      if (
        container &&
        container.State?.Running &&
        ["upgrade", "rotate_gateway"].includes(type)
      )
        throw new Error("stop_required_for_image_or_credential_change");
      if (container && !container.State?.Running) {
        await runner("docker", ["rm", name]);
        container = null;
      }
      if (!container) {
        await runner("docker", ["pull", cell.imageDigest], 60000);
        try {
          await runner("docker", ["network", "inspect", network]);
        } catch {
          await runner("docker", [
            "network",
            "create",
            "--driver",
            "bridge",
            "--opt",
            "com.docker.network.bridge.enable_icc=false",
            network,
          ]);
        }
        await isolateNetwork(network);
        await runner(
          "docker",
          dockerRunArguments(
            cell,
            stateDir,
            configFile,
            network,
            "aw-" + cell.cellId.slice(0, 8),
          ),
        );
      }
      container = await healthy(name);
      if (container.Config?.Image !== cell.imageDigest)
        throw new Error("running_image_mismatch");
      const record = journal.cells[cell.cellId];
      record.status = "healthy";
      record.imageDigest = cell.imageDigest;
      record.capacity = cell.capacity;
      result = {
        success: true,
        state: "healthy",
        evidence: {
          gatewayHandshake: true,
          volumeMounted:
            container.Mounts?.some(
              (m) =>
                m.Destination === "/home/node/.openclaw" &&
                m.Source === stateDir,
            ) === true,
          imageDigest: cell.imageDigest,
        },
      };
    } else if (type === "stop") {
      if (container?.State?.Running)
        await runner("docker", ["stop", "--time", "30", name], 40000);
      if ((await inspect(name))?.State?.Running)
        throw new Error("gateway_stop_unconfirmed");
      if (current) current.status = "stopped";
      result = { success: true, state: "stopped", evidence: {} };
    } else if (type === "delete") {
      if (container) await runner("docker", ["rm", "--force", name]);
      if (await inspect(name)) throw new Error("gateway_delete_unconfirmed");
      try {
        await runner("docker", ["network", "rm", network]);
      } catch (error) {
        if (!/No such network/.test(String(error.stderr))) throw error;
      }
      await rm(path.join(root, "cells", cell.cellId), {
        recursive: true,
        force: true,
      });
      await rm(path.join(root, "secrets", cell.cellId), {
        recursive: true,
        force: true,
      });
      if (current) current.status = "deleted";
      result = { success: true, state: "deleted", evidence: {} };
    } else if (["backup", "restore", "migrate"].includes(type)) {
      if (container?.State?.Running)
        throw new Error("stop_required_for_state_snapshot");
      const spec = cell.backup;
      if (
        !spec ||
        !UUID.test(spec.id) ||
        spec.cellId !== cell.cellId ||
        spec.companyId !== cell.companyId ||
        !DIGEST.test(spec.imageDigest) ||
        !/^[a-f0-9]{64}$/.test(spec.key) ||
        !/^[1-9][0-9]{0,18}$/.test(spec.generation)
      )
        throw new Error("invalid_backup_scope");
      const url = new URL(spec.url);
      if (
        url.protocol !== "https:" ||
        url.origin !== new URL(backupEndpoint).origin ||
        url.username ||
        url.password ||
        !url.pathname.endsWith(
          "/companies/" +
            cell.companyId +
            "/runtime-backups/" +
            cell.cellId +
            "/" +
            spec.id +
            ".awb6",
        )
      )
        throw new Error("invalid_backup_object_destination");
      const scratch = path.join(root, "backups");
      await mkdir(scratch, { recursive: true, mode: 0o700 });
      const filename = path.join(scratch, id + ".awb6");
      if (type === "backup") {
        if (
          !current ||
          spec.generation !== cell.generation ||
          spec.imageDigest !== current.imageDigest
        )
          throw new Error("backup_generation_mismatch");
        let evidence = journal.commands[id].backupEvidence;
        if (!evidence) {
          evidence = await createEncryptedBackup(
            path.join(root, "cells", cell.cellId),
            filename,
            spec,
          );
          journal.commands[id].backupEvidence = evidence;
          await persist();
        }
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": evidence.bytes,
          },
          body: createReadStream(filename),
          duplex: "half",
          redirect: "error",
          signal: AbortSignal.timeout(900000),
        });
        if (!response.ok) throw new Error("backup_upload_unconfirmed");
        result = {
          success: true,
          state: "backed_up",
          evidence: {
            backupSha256: evidence.sha256,
            backupBytes: evidence.bytes,
            stateFormat: spec.stateFormat,
          },
        };
      } else {
        if (
          !/^[a-f0-9]{64}$/.test(spec.sha256) ||
          !/^\d+$/.test(spec.bytes) ||
          BigInt(spec.bytes) > BigInt(cell.capacity.diskBytes) + 100000000n
        )
          throw new Error("invalid_restore_integrity_evidence");
        const stateDir = path.join(root, "cells", cell.cellId),
          oldDir = path.join(
            root,
            "cells",
            ".aw-old-" + cell.cellId + "-" + id,
          ),
          quarantineName = ".aw-restore-" + id;
        let receipt;
        try {
          receipt = JSON.parse(
            await readFile(path.join(stateDir, ".aw-restore-receipt"), "utf8"),
          );
        } catch {}
        if (
          receipt?.commandId !== id ||
          receipt?.sha256 !== spec.sha256 ||
          receipt?.backupId !== spec.id
        ) {
          let oldExists = false;
          try {
            await stat(oldDir);
            oldExists = true;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (!oldExists) {
            await rm(filename, { force: true });
            const response = await fetch(url, {
              redirect: "error",
              signal: AbortSignal.timeout(900000),
            });
            if (!response.ok || !response.body)
              throw new Error("backup_download_failed");
            let bytes = 0n;
            await pipeline(
              Readable.fromWeb(response.body),
              new Transform({
                transform(chunk, _enc, cb) {
                  bytes += BigInt(chunk.length);
                  if (bytes > BigInt(spec.bytes))
                    return cb(new Error("backup_download_limit"));
                  cb(null, chunk);
                },
              }),
              createWriteStream(filename, { flags: "wx", mode: 0o600 }),
            );
            if (bytes !== BigInt(spec.bytes))
              throw new Error("backup_download_length_mismatch");
            const dir = await ensureVolume(cell);
            const quarantine = path.join(dir, quarantineName);
            await rm(quarantine, { recursive: true, force: true });
            await restoreEncryptedBackup(
              filename,
              quarantine,
              spec,
              spec.sha256,
            );
            await atomicJson(path.join(quarantine, ".aw-restore-receipt"), {
              commandId: id,
              backupId: spec.id,
              sha256: spec.sha256,
            });
            await chown(
              path.join(quarantine, ".aw-restore-receipt"),
              1000,
              1000,
            );
            if (container) {
              await runner("docker", ["rm", "aw-cell-" + cell.cellId]);
              container = null;
            }
            await rename(stateDir, oldDir);
            const parent = await open(path.dirname(stateDir), "r");
            try {
              await parent.sync();
            } finally {
              await parent.close();
            }
          }
          await rename(path.join(oldDir, quarantineName), stateDir);
          const parent = await open(path.dirname(stateDir), "r");
          try {
            await parent.sync();
          } finally {
            await parent.close();
          }
        }
        journal.cells[cell.cellId] = {
          ...journal.cells[cell.cellId],
          companyId: cell.companyId,
          generation: cell.generation,
          imageDigest: cell.imageDigest,
          status: "stopped",
          capacity: cell.capacity,
        };
        await persist();
        await rm(oldDir, { recursive: true, force: true });
        result = {
          success: true,
          state: "restored",
          evidence: {
            quarantined: true,
            credentialsRemoved: true,
            stateFormat: spec.stateFormat,
            imageDigest: cell.imageDigest,
          },
        };
      }
      journal.commands[id].result = result;
      await persist();
      await rm(filename, { force: true });
      return result;
    } else throw new Error("unsupported_runtime_command");
    journal.commands[id].result = result;
    await persist();
    return result;
  }
  async function inventory() {
    if (!journal) await initialize();
    const cells = [];
    for (const [cellId, record] of Object.entries(journal.cells)) {
      if (record.status === "deleted") continue;
      const container = await inspect("aw-cell-" + cellId);
      let healthy = container?.State?.Running === true;
      if (healthy)
        try {
          await runner(
            "docker",
            [
              "exec",
              "aw-cell-" + cellId,
              "node",
              "openclaw.mjs",
              "health",
              "--json",
            ],
            5000,
          );
        } catch {
          healthy = false;
        }
      if (
        container &&
        (container.Config?.Labels?.["aw.company"] !== record.companyId ||
          container.Config?.Labels?.["aw.generation"] !== record.generation)
      )
        throw new Error("inventory_scope_mismatch");
      const disk = await runner("du", [
        "-sb",
        path.join(root, "cells", cellId),
      ]);
      let memoryBytes = "0",
        cpuMillis = 0;
      if (container?.State?.Running) {
        const pid = container.State.Pid;
        if (!Number.isSafeInteger(pid) || pid < 1)
          throw new Error("container_pid_unavailable");
        const group = (await readFile(`/proc/${pid}/cgroup`, "utf8"))
          .split("\n")
          .find((line) => line.startsWith("0::"))
          ?.slice(3);
        if (!group || group.includes(".."))
          throw new Error("cgroup_v2_required");
        memoryBytes = (
          await readFile(
            path.join("/sys/fs/cgroup", group, "memory.current"),
            "utf8",
          )
        ).trim();
        const stats = await runner(
          "docker",
          [
            "stats",
            "--no-stream",
            "--format",
            "{{json .}}",
            "aw-cell-" + cellId,
          ],
          10000,
        );
        const percent = Number.parseFloat(JSON.parse(stats).CPUPerc);
        if (!Number.isFinite(percent) || percent < 0)
          throw new Error("cpu_sample_unavailable");
        cpuMillis = Math.round(percent * 10);
      }
      cells.push({
        cellId,
        companyId: record.companyId,
        generation: record.generation,
        imageDigest: record.imageDigest,
        status: healthy
          ? "healthy"
          : container?.State?.Running
            ? "failed"
            : "stopped",
        cpuMillis,
        memoryBytes,
        diskBytes: disk.split(/\s/)[0],
      });
    }
    return cells;
  }
  async function endpoint(cellId, generation, companyId) {
    if (!journal) await initialize();
    const cell = journal.cells[cellId];
    if (
      !cell ||
      cell.generation !== generation ||
      cell.companyId !== companyId ||
      cell.status !== "healthy"
    )
      throw new Error("relay_cell_unavailable");
    const container = await inspect("aw-cell-" + cellId);
    const ip =
      container?.NetworkSettings?.Networks?.["aw-net-" + cellId]?.IPAddress;
    if (!container?.State?.Running || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip ?? ""))
      throw new Error("relay_endpoint_unavailable");
    return "ws://" + ip + ":18789";
  }
  async function fenceAll() {
    if (!journal) await initialize();
    for (const [cellId, record] of Object.entries(journal.cells)) {
      if (record.status === "deleted") continue;
      const name = "aw-cell-" + cellId,
        container = await inspect(name);
      if (container?.State?.Running)
        await runner("docker", ["stop", "--time", "10", name], 20000);
      if ((await inspect(name))?.State?.Running)
        throw new Error("host_lease_fence_unconfirmed");
      record.status = "fenced";
    }
    await persist();
  }
  async function fenceCell(cell) {
    validateCellCommand(cell);
    const name = "aw-cell-" + cell.cellId;
    const container = await inspect(name);
    if (!container) return;
    if (
      container.Config?.Labels?.["aw.company"] !== cell.companyId ||
      ![cell.generation, cell.sourceGeneration]
        .filter(Boolean)
        .includes(container.Config?.Labels?.["aw.generation"])
    )
      throw new Error("fence_cell_scope_mismatch");
    if (container.State?.Running)
      await runner("docker", ["stop", "--time", "20", name]);
    const after = await inspect(name);
    if (after?.State?.Running) throw new Error("cell_fence_unconfirmed");
    if (journal?.cells[cell.cellId]) {
      journal.cells[cell.cellId].status = "stopped";
      await persist();
    }
  }
  async function acknowledge(id) {
    if (!UUID.test(id) || !journal?.commands[id]?.result)
      throw new Error("invalid_command_acknowledgement");
    const filename = path.join(root, "backups", id + ".awb6");
    await rm(filename, { force: true });
    await rm(filename + ".quarantine", { force: true });
    journal.commands[id].acceptedAt ??= new Date().toISOString();
    await persist();
  }
  async function recordFailure(id, generation, result) {
    if (!journal) await initialize();
    const entry = journal.commands[id];
    if (!entry || entry.generation !== generation || result.success !== false)
      throw new Error("failure_receipt_scope_mismatch");
    entry.result = result;
    await persist();
  }
  async function receipt(id, generation) {
    if (!journal) await initialize();
    if (!UUID.test(id) || !/^\d{1,19}$/.test(generation))
      throw new Error("invalid_recovery_reference");
    const entry = journal.commands[id];
    return entry?.generation === generation && entry.result
      ? entry.result
      : null;
  }
  return {
    initialize,
    execute,
    inventory,
    endpoint,
    fenceAll,
    fenceCell,
    receipt,
    recordFailure,
    acknowledge,
  };
}
