import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
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
const policyDocument = {
  version: 1,
  filesystem_policy: { include_workdir: false, read_only: ["/etc"], read_write: [] },
  landlock: { compatibility: "hard_requirement" },
  process: { run_as_user: "1000", run_as_group: "1000" },
  network_policies: {},
};
const policyHash = "b".repeat(64);
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
    let sandboxId = randomUUID(),
      phase = "Ready",
      wrongScope = false,
      attached = [{ name: "fixture-provider" }],
      physical = false,
      running = false,
      effectivePolicy = structuredClone(policyDocument),
      configRevision = 1,
      wrongContainerLabels = false,
      containerImageDigest = input("inspect").imageDigest;
    const containerId = "d".repeat(64),
      imageId = "sha256:" + "e".repeat(64);
    const run = async (file, args, options) => {
      calls.push({ args, options });
      assert.equal(options.env.HOME, stateHome);
      assert.equal(options.env.OPENSHELL_GATEWAY_INSECURE, undefined);
      assert.ok(options.timeout <= 6000);
      if (file === "docker") {
        assert.equal(options.env.PATH, process.env.PATH);
        assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
        if (args[0] === "info") return { stdout: "openshell-docker-engine-1\n" };
        if (args[0] === "ps") return { stdout: physical ? `${containerId}\n` : "" };
        if (args[0] === "inspect")
          return {
            stdout: JSON.stringify([
              {
                Id: containerId,
                Image: imageId,
                RepoDigests: [containerImageDigest],
                Config: {
                  Image: imageId,
                  Labels: {
                    "openshell.ai/managed-by": "openshell",
                    "openshell.ai/sandbox-id": sandboxId,
                    "openshell.ai/sandbox-name": scope.sandboxRef,
                    "openshell.ai/sandbox-namespace": "default",
                    "openshell.ai/sandbox-workspace": config.workspace,
                    "openshell.ai/isolation-backend": "openshell-sandbox",
                    "openshell.ai/isolation-role": "sandbox",
                    "aw.company_id": wrongContainerLabels ? randomUUID() : scope.companyId,
                    "aw.binding_id": scope.bindingId,
                    "aw.cell_id": scope.cellId,
                    "aw.generation": "1",
                  },
                },
                State: { Running: running },
              },
            ]),
          };
        throw new Error("fixture-unexpected-docker-command");
      }
      assert.equal(options.env.PATH, "/usr/bin:/bin");
      const command = args.slice(4);
      if (command[0] === "--version") return { stdout: "openshell 0.1.2\n" };
      if (command[0] === "sandbox" && command[1] === "get")
        return {
          stdout: JSON.stringify({
            id: sandboxId,
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
        running = false;
        return { stdout: "Stopped" };
      }
      if (command[0] === "sandbox" && command[1] === "start") {
        phase = "Ready";
        running = true;
        return { stdout: "Started" };
      }
      if (command[0] === "policy" && command[1] === "get")
        return {
          stdout: JSON.stringify({
            sandbox: scope.sandboxRef,
            status: "effective",
            version: 1,
            config_revision: configRevision,
            hash: createHash("sha256").update(JSON.stringify(effectivePolicy)).digest("hex"),
            policy: effectivePolicy,
          }),
        };
      if (command[0] === "policy" && command[1] === "set") {
        assert.equal(command[2], scope.sandboxRef);
        assert.equal(command[3], "--policy");
        assert.ok((await readFile(command[4], "utf8")).length > 0);
        effectivePolicy = JSON.parse(await readFile(command[4], "utf8"));
        return { stdout: "Policy updated" };
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
      replaceSandbox: () => { sandboxId = randomUUID(); },
      clearSandboxIdentity: () => { sandboxId = undefined; },
      enablePhysical: () => { physical = true; },
      setPhase: (value) => { phase = value; running = value === "Ready"; },
      setWrongContainerLabels: () => { wrongContainerLabels = true; },
      setContainerImageDigest: (value) => { containerImageDigest = value; },
      changePolicyRevision: () => { configRevision += 1; },
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

test("reused names and identical labels cannot replace a pinned instance after restart", async () =>
  fixture(async ({ engine, config, root, run, calls, replaceSandbox }) => {
    assert.equal((await engine.execute(randomUUID(), input("inspect"), deadline())).success, true);
    const pinned = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(pinned.version, 2);
    assert.ok(pinned.scopes[scope.bindingId].sandboxId);
    replaceSandbox();
    const restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    for (const action of ["stop", "destroy", "revoke_providers"]) {
      assert.equal((await restarted.execute(randomUUID(), input(action), deadline())).errorCode,
        "sandbox_scope_changed");
    }
    await assert.rejects(restarted.fenceAll(), /sandbox_host_unavailable/);
    assert.ok(calls.every(({ args }) => !args.includes("stop") && !args.includes("delete") && !args.includes("detach")));
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8")).scopes,
      pinned.scopes);
  }));
test("absent gateway identity cannot be learned from labels", async () =>
  fixture(async ({ engine, calls, clearSandboxIdentity }) => {
    clearSandboxIdentity();
    assert.equal((await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_scope_changed");
    assert.ok(calls.every(({ args }) => !args.includes("stop")));
  }));
test("legacy unpinned observations stay fenced during journal migration", async () =>
  fixture(async ({ config, root, run, calls }) => {
    await writeFile(path.join(root, "openshell-journal.json"), JSON.stringify({
      version: 1, scopes: { [scope.bindingId]: scope }, commands: {},
    }));
    const restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    assert.equal((await restarted.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_scope_changed");
    await assert.rejects(restarted.fenceAll(), /sandbox_host_unavailable/);
    assert.ok(calls.every(({ args }) => !args.includes("stop")));
  }));

test("apply and start use pinned OpenShell policy APIs plus exact Docker identity observations", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const applied = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "policy-test", document: policyDocument } },
      deadline(),
    );
    assert.equal(applied.reply.action, "apply");
    assert.equal(applied.reply.applied, true);
    assert.equal(applied.reply.policyHash, policyHash);
    assert.equal(applied.reply.requiresRecreate, false);
    assert.ok(calls.some(({ args }) => args.includes("policy") && args.includes("set")));
    const started = await engine.execute(
      randomUUID(),
      {
        ...input("start"),
        start: {
          policyHash,
          expiresAt: new Date(Date.now() + 50000).toISOString(),
          idempotencyKey: "native-start-1",
        },
      },
      deadline(),
    );
    assert.equal(started.reply.action, "start");
    assert.equal(started.reply.started, true);
    assert.equal(started.reply.containerId, "d".repeat(64));
    assert.equal(started.reply.imageDigest, input("inspect").imageDigest);
    assert.equal(started.reply.policyHash, policyHash);
    assert.ok(calls.some(({ args }) => args.includes("sandbox") && args.includes("start")));
  }));

test("expired source policy deadlines fail before any host or CLI observation", async () =>
  fixture(async ({ engine, calls }) => {
    const expiredApply = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: { policyHash, expiresAt: new Date(0).toISOString(), idempotencyKey: "expired-apply", document: policyDocument } },
      deadline(),
    );
    assert.equal(expiredApply.errorCode, "sandbox_scope_changed");
    const startBeforeItsSourceDeadline = await engine.execute(
      randomUUID(),
      { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 1000).toISOString(), idempotencyKey: "late-start", } },
      deadline(),
    );
    assert.equal(startBeforeItsSourceDeadline.errorCode, "sandbox_scope_changed");
    assert.equal(calls.length, 0);
  }));

test("a persisted unknown command intent is never replayed after host restart", async () =>
  fixture(async ({ engine, calls, root }) => {
    await engine.execute(randomUUID(), input("inspect"), deadline());
    const commandId = randomUUID();
    const request = {
      ...input("apply"),
      admission: {
        policyHash,
        expiresAt: new Date(Date.now() + 50000).toISOString(),
        idempotencyKey: "unknown-after-restart",
        document: policyDocument,
      },
    };
    const journalPath = path.join(root, "openshell-journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.commands[commandId] = {
      requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
      result: null,
    };
    await writeFile(journalPath, JSON.stringify(journal), { mode: 0o600 });
    await engine.initialize();
    calls.length = 0;
    const retry = await engine.execute(commandId, request, deadline());
    assert.equal(retry.errorCode, "sandbox_observation_unavailable");
    assert.equal(calls.length, 0);
  }));

test("static policy changes require sandbox recreation before any policy mutation", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const candidate = structuredClone(policyDocument);
    candidate.process.run_as_user = "1001";
    const result = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "static-change", document: candidate } },
      deadline(),
    );
    assert.equal(result.reply.applied, false);
    assert.equal(result.reply.requiresRecreate, true);
    assert.equal(calls.some(({ args }) => args.includes("policy") && args.includes("set")), false);
  }));

test("foreign Docker labels block policy mutation before any effect", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, setWrongContainerLabels }) => {
    enablePhysical();
    setPhase("Stopped");
    setWrongContainerLabels();
    const result = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "foreign-label", document: policyDocument } },
      deadline(),
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("policy") && args.includes("set")), false);
  }));

test("an image repository digest mismatch blocks policy mutation before any effect", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, setContainerImageDigest }) => {
    enablePhysical();
    setPhase("Stopped");
    setContainerImageDigest("fixture.invalid/other@sha256:" + "f".repeat(64));
    const result = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "wrong-image", document: policyDocument } },
      deadline(),
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("policy") && args.includes("set")), false);
  }));

test("a changed OpenShell policy revision blocks workload start", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, changePolicyRevision }) => {
    enablePhysical();
    setPhase("Stopped");
    const applied = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "revision-test", document: policyDocument } },
      deadline(),
    );
    assert.equal(applied.reply.applied, true);
    changePolicyRevision();
    const result = await engine.execute(
      randomUUID(),
      {
        ...input("start"),
        start: {
          policyHash,
          expiresAt: new Date(Date.now() + 50000).toISOString(),
          idempotencyKey: "stale-policy-start",
        },
      },
      deadline(),
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("sandbox") && args.includes("start")), false);
  }));

test("physical inspection never promotes host observations to qualification", async () =>
  fixture(async ({ engine, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Ready");
    assert.deepEqual(
      (await engine.execute(randomUUID(), input("inspect"), deadline())).reply,
      {
        action: "inspect",
        state: "running",
        policyHash: null,
        imageDigest: input("inspect").imageDigest,
        generation: "1",
        controlsHealthy: false,
      },
    );
  }));
