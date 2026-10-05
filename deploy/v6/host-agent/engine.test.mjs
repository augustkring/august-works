import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  gatewayConfiguration,
  dockerRunArguments,
  runtimeEngine,
  validateCellCommand,
} from "./engine.mjs";
const cell = {
  cellId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  generation: "1",
  imageDigest: "ghcr.io/example/openclaw@sha256:" + "a".repeat(64),
  gatewayToken: "x".repeat(43),
  capacity: {
    cpuMillis: 1500,
    memoryBytes: "536870912",
    diskBytes: "1073741824",
    pidsLimit: 128,
  },
};
test("journal pressure removes only old server-accepted receipts and preserves recovery outcomes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-host-journal-"));
  const commands = Object.fromEntries(
    Array.from({ length: 10000 }, (_, i) => [
      "fixture-" + i,
      {
        generation: "1",
        startedAt: "2020-01-01T00:00:00Z",
        ...(i < 5000
          ? { result: { success: true }, acceptedAt: "2020-01-01T00:00:00Z" }
          : {}),
      },
    ]),
  );
  commands["fixture-9999"] = {
    generation: "1",
    result: { success: true },
    acceptedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(root, "journal.json"),
    JSON.stringify({ version: 1, nextProjectId: 10000, cells: {}, commands }),
  );
  const runner = async () => {
    const error = new Error("missing");
    error.stderr = "No such object";
    throw error;
  };
  try {
    const engine = runtimeEngine({ root, runner });
    const id = "33333333-3333-4333-8333-333333333333";
    await engine.execute(id, "stop", cell);
    await engine.acknowledge(id);
    const journal = JSON.parse(
      await readFile(path.join(root, "journal.json"), "utf8"),
    );
    assert.equal(Object.keys(journal.commands).length, 5001);
    assert.ok(journal.commands["fixture-5000"]);
    assert.ok(journal.commands["fixture-9999"]);
    assert.ok(journal.commands[id].acceptedAt);
    assert.equal(journal.commands["fixture-0"], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("cell containers have explicit resource and isolation limits with no published ports, host network or socket", () => {
  const args = dockerRunArguments(
    cell,
    "/var/lib/aw-runtime/cells/" + cell.cellId,
    "/var/lib/aw-runtime/secrets/" + cell.cellId + "/gateway.json",
    "aw-net-" + cell.cellId,
    "aw-fixture",
  );
  assert.equal(args[args.indexOf("--user") + 1], "1000:1000");
  assert.equal(args[args.indexOf("--cap-drop") + 1], "ALL");
  assert.equal(args[args.indexOf("--cpus") + 1], "1.5");
  assert.equal(args[args.indexOf("--memory") + 1], cell.capacity.memoryBytes);
  assert.equal(args[args.indexOf("--pids-limit") + 1], "128");
  assert.ok(args.every((arg) => typeof arg === "string"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("no-new-privileges:true"));
  assert.ok(!args.includes("--privileged"));
  assert.ok(!args.includes("--publish"));
  assert.ok(!args.includes("-p"));
  assert.ok(!args.includes("host"));
  assert.ok(!args.join(" ").includes("docker.sock"));
  assert.ok(!args.join(" ").includes(cell.gatewayToken));
  assert.throws(() => validateCellCommand({ ...cell, cellId: "../other" }));
  assert.throws(() =>
    validateCellCommand({
      ...cell,
      imageDigest: "ghcr.io/example/openclaw:latest",
    }),
  );
});
test("durable command replay recovers after agent restart and rejects a different company or generation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-host-engine-"));
  const calls = [];
  let container = null;
  const runner = async (binary, args) => {
    calls.push([binary, args]);
    if (binary === "docker" && args[0] === "inspect") {
      if (!container) {
        const error = new Error("missing");
        error.stderr = "No such object";
        throw error;
      }
      return JSON.stringify([container]);
    }
    if (binary === "docker" && args[0] === "network" && args[1] === "inspect")
      return JSON.stringify([
        { IPAM: { Config: [{ Subnet: "172.30.0.0/24" }] } },
      ]);
    if (binary === "docker" && args[0] === "run")
      container = {
        Config: {
          Image: cell.imageDigest,
          Labels: {
            "aw.company": cell.companyId,
            "aw.generation": cell.generation,
          },
        },
        State: { Running: true },
        Mounts: [
          {
            Destination: "/home/node/.openclaw",
            Source: path.join(root, "cells", cell.cellId),
          },
        ],
      };
    if (binary === "docker" && args[0] === "stop")
      container.State.Running = false;
    return "";
  };
  try {
    const id = "33333333-3333-4333-8333-333333333333";
    const engine = runtimeEngine({ root, runner });
    const result = await engine.execute(id, "provision", cell);
    assert.equal(result.evidence.gatewayHandshake, true);
    assert.equal(result.evidence.volumeMounted, true);
    assert.equal(
      calls.filter(([binary, args]) => binary === "docker" && args[0] === "run")
        .length,
      1,
    );
    const restarted = runtimeEngine({ root, runner });
    assert.deepEqual(await restarted.receipt(id, "1"), result);
    assert.equal(await restarted.receipt(id, "2"), null);
    assert.deepEqual(await restarted.execute(id, "provision", cell), result);
    assert.equal(
      calls.filter(([binary, args]) => binary === "docker" && args[0] === "run")
        .length,
      1,
    );
    await assert.rejects(
      () =>
        restarted.execute("44444444-4444-4444-8444-444444444444", "start", {
          ...cell,
          companyId: "55555555-5555-4555-8555-555555555555",
        }),
      /stale_cell_generation/,
    );
    await assert.rejects(
      () =>
        restarted.execute("44444444-4444-4444-8444-444444444444", "start", {
          ...cell,
          generation: "2",
        }),
      /stale_cell_generation/,
    );
    const quota = calls.filter(([binary]) => binary === "xfs_quota");
    assert.equal(quota.length, 2);
    assert.ok(
      quota[1][1].join(" ").includes("bhard=" + cell.capacity.diskBytes),
    );
    await restarted.fenceAll();
    assert.equal(container.State.Running, false);
    const journal = JSON.parse(
      await readFile(path.join(root, "journal.json"), "utf8"),
    );
    assert.equal(journal.cells[cell.cellId].status, "fenced");
    assert.ok(!JSON.stringify(journal).includes(cell.gatewayToken));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("unqualified filesystem quota enforcement prevents container creation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-host-quota-"));
  let started = false;
  const runner = async (binary, args) => {
    if (binary === "docker" && args[0] === "inspect") {
      const error = new Error("missing");
      error.stderr = "No such object";
      throw error;
    }
    if (binary === "xfs_quota") throw new Error("quota_unavailable");
    if (binary === "docker" && args[0] === "run") started = true;
    return "";
  };
  try {
    await assert.rejects(
      () =>
        runtimeEngine({ root, runner }).execute(
          "33333333-3333-4333-8333-333333333333",
          "provision",
          cell,
        ),
      /quota_unavailable/,
    );
    assert.equal(started, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BYOK uses fixed public provider endpoints and keeps keys out of Docker arguments", () => {
  const provider = {
      provider: "anthropic",
      modelId: "fixture-model",
      apiKey: "fixture-private-key",
    },
    configured = { ...cell, modelProvider: provider };
  const config = gatewayConfiguration(configured);
  assert.equal(
    config.models.providers["aw-byok"].baseUrl,
    "https://api.anthropic.com",
  );
  assert.equal(config.agents.defaults.model.primary, "aw-byok/fixture-model");
  assert.equal(config.models.providers["aw-byok"].apiKey, provider.apiKey);
  assert(
    !dockerRunArguments(configured, "/state", "/config", "network", "host")
      .join(" ")
      .includes(provider.apiKey),
  );
  assert.throws(() =>
    gatewayConfiguration({
      ...cell,
      modelProvider: { ...provider, provider: "http://169.254.169.254" },
    }),
  );
});
