import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { openShellHostEngine } from "./openshell.mjs";

const scope = {
  companyId: randomUUID(),
  bindingId: randomUUID(),
  cellId: randomUUID(),
  cellGeneration: "1",
};
scope.sandboxRef = `aw-v7-${scope.bindingId}`;
const input = (action) => ({
  version: 1,
  action,
  scope,
  hostEpoch: 1,
  requesterUserId: "fixture-owner",
  imageDigest: "fixture.invalid/image@sha256:" + "a".repeat(64),
});
const deadline = () => new Date(Date.now() + 20000).toISOString();
async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-v7-host-cli-"));
  try {
    const executable = path.join(root, "fixture-cli"),
      stateHome = path.join(root, "private-cli-state");
    await writeFile(executable, "fixture-only-cli", { mode: 0o700 });
    await mkdir(stateHome, { mode: 0o700 });
    const config = {
      executable,
      executableSha256: createHash("sha256")
        .update("fixture-only-cli")
        .digest("hex"),
      stateHome,
      gateway: "fixture-gateway",
      workspace: "fixture-company",
    };
    const calls = [];
    let phase = "Ready",
      wrongScope = false,
      attached = [{ name: "fixture-provider" }];
    const run = async (_file, args, options) => {
      calls.push({ args, options });
      assert.equal(options.env.HOME, stateHome);
      assert.equal(options.env.PATH, "/usr/bin:/bin");
      assert.equal(options.env.OPENSHELL_GATEWAY_INSECURE, undefined);
      assert.ok(options.timeout <= 6000);
      const command = args.slice(4);
      if (command[0] === "--version") return { stdout: "openshell 0.1.2\n" };
      if (command[0] === "sandbox" && command[1] === "get")
        return {
          stdout: JSON.stringify({
            name: scope.sandboxRef,
            workspace: config.workspace,
            phase,
            labels: {
              "aw.company_id": wrongScope ? randomUUID() : scope.companyId,
              "aw.binding_id": scope.bindingId,
              "aw.cell_id": scope.cellId,
              "aw.generation": "1",
            },
          }),
        };
      if (command[0] === "sandbox" && command[1] === "stop") {
        phase = "Stopped";
        return { stdout: "Stopped" };
      }
      if (command[1] === "provider" && command[2] === "list")
        return {
          stdout: JSON.stringify({ providers: attached, next_page_token: "" }),
        };
      if (command[1] === "provider" && command[2] === "detach") {
        attached = [];
        return { stdout: "{}" };
      }
      throw new Error("fixture-unexpected-command");
    };
    const engine = openShellHostEngine({ config, epoch: 1, root, run });
    await engine.initialize();
    await work({
      engine,
      config,
      calls,
      root,
      run,
      swapScope: () => {
        wrongScope = true;
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("CLI fixtures cannot earn complete physical capabilities or passing probes", async () =>
  fixture(async ({ engine, calls }) => {
    assert.deepEqual(
      (await engine.execute(randomUUID(), input("capabilities"), deadline()))
        .reply,
      { action: "capabilities", capabilities: null },
    );
    assert.deepEqual(
      (
        await engine.execute(
          randomUUID(),
          {
            ...input("probe"),
            probe: {
              caseId: "force_stop",
              control: "forceStop",
              expected: "observe",
            },
          },
          deadline(),
        )
      ).reply,
      { action: "probe", verdict: "unsupported", observationHash: null },
    );
    assert.equal(calls.length, 0);
  }));
test("observed metadata cannot substitute for image or complete control enforcement", async () =>
  fixture(async ({ engine }) => {
    const receipt = await engine.execute(
      randomUUID(),
      input("inspect"),
      deadline(),
    );
    assert.deepEqual(receipt.reply, {
      action: "inspect",
      state: "unknown",
      policyHash: null,
      imageDigest: null,
      generation: "1",
      controlsHealthy: false,
    });
    const preparation = await engine.execute(
      randomUUID(),
      input("prepare"),
      deadline(),
    );
    assert.equal(preparation.success, false);
  }));
test("Stop checks immutable scope, targets one sandbox and persists a restart receipt", async () =>
  fixture(async ({ engine, config, calls, root, run }) => {
    const id = randomUUID(),
      receipt = await engine.execute(id, input("stop"), deadline());
    assert.equal(receipt.reply.stopped, true);
    const count = calls.length,
      restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    assert.deepEqual(
      await restarted.execute(id, input("stop"), deadline()),
      receipt,
    );
    assert.equal(calls.length, count);
    assert.ok(
      calls.every(
        ({ args }) =>
          !args.includes("--all") && !args.includes("--gateway-insecure"),
      ),
    );
    await assert.rejects(
      restarted.execute(
        id,
        { ...input("stop"), scope: { ...scope, cellGeneration: "2" } },
        deadline(),
      ),
      /sandbox_scope_changed/,
    );
  }));
test("foreign labels and host epochs cannot run Stop", async () =>
  fixture(async ({ engine, calls, swapScope }) => {
    swapScope();
    assert.equal(
      (await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_scope_changed",
    );
    assert.ok(calls.every(({ args }) => !args.includes("stop")));
    await assert.rejects(
      engine.execute(
        randomUUID(),
        { ...input("stop"), hostEpoch: 2 },
        deadline(),
      ),
      /sandbox_scope_changed/,
    );
  }));
test("binary change and public CLI state close the command without leaking subprocess errors", async () =>
  fixture(async ({ engine, config }) => {
    await writeFile(config.executable, "changed");
    assert.equal(
      (await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_host_unavailable",
    );
    await writeFile(config.executable, "fixture-only-cli");
    await chmod(config.stateHome, 0o755);
    assert.equal(
      (await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_host_unavailable",
    );
  }));
test("provider revocation uses exact private names and unreachable fencing rechecks ownership", async () =>
  fixture(async ({ engine, calls, swapScope }) => {
    assert.equal(
      (
        await engine.execute(
          randomUUID(),
          input("revoke_providers"),
          deadline(),
        )
      ).reply.revoked,
      true,
    );
    assert.ok(
      calls.some(
        ({ args }) =>
          args.includes("detach") &&
          args.includes("fixture-provider") &&
          args.includes("--wait"),
      ),
    );
    swapScope();
    await assert.rejects(engine.fenceAll(), /sandbox_host_unavailable/);
  }));
