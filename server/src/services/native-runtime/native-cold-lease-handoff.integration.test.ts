import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, environmentLeases, environments, heartbeatRunEvents,
  heartbeatRuns,
  issues, nativeRunFinalizations } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { parseNativeExecutionInput, type NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { buildNativeHarnessBackupManifest, nativeSessionScopeSha256, verifyNativeColdLeaseHandoff } from "./native-session-executor.js";

// CONF15 A2. A Native Run 2 that resumes a retained Run 1 on a new lease is
// accepted only through a server-verified cold lease handoff. Each condition
// is read from durable rows and files; every refusal is a closed code, and the
// executor fails closed with `native_cold_lease_handoff_<code>`.
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Native cold lease handoff (CONF15 A2)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const companyId = randomUUID(), otherCompanyId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
  const environmentId = randomUUID();
  const roots: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-cold-lease-handoff-");
    db = createDb(database.connectionString);
    await db.insert(companies).values([{ id: companyId, name: "Handoff fixture", issuePrefix: "NCH" },
      { id: otherCompanyId, name: "Other handoff fixture", issuePrefix: "NCO" }]);
    await db.insert(agents).values([{ id: agentId, companyId, name: "Handoff agent", adapterType: "paperclip_runner" },
      { id: otherAgentId, companyId, name: "Other handoff agent", adapterType: "paperclip_runner" }]);
    await db.insert(environments).values({ id: environmentId, name: `handoff-sandbox-${environmentId}`, driver: "sandbox" });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    await database?.cleanup();
  }, 30_000);

  const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const remoteCwd = "/sandbox/workspace";

  function executionFor(input: { runId: string; issueId: string; sessionId: string; workspaceId: string;
    companyId?: string; agentId?: string; model?: string }): NativeExecutionInput {
    return parseNativeExecutionInput({ schema: "paperclip.native-execution-input.v2",
      binding: { companyId: input.companyId ?? companyId, runId: input.runId, issueId: input.issueId,
        agentId: input.agentId ?? agentId, executionWorkspaceId: input.workspaceId },
      task: { identifier: input.issueId, title: "Handoff Task", description: null, prompt: "Continue.", workMode: "standard" },
      workspace: { cwd: remoteCwd, repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: input.sessionId, driverKind: "opencode_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "opencode", model: input.model ?? "anthropic/fixture-model" },
      completionContract: { id: randomUUID(), sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Continue.", criteria: [{ id: "objective", requirement: "Answer." }] } },
      interactionResponses: [], credentialBindings: [], executionMode: "default", planningContext: null });
  }

  type Options = {
    sameProviderLease?: boolean;
    acquisition?: "created" | "replacement" | "resumed";
    reusableLeaseConfigured?: boolean;
    priorStatus?: string;
    priorCleanupPending?: boolean | null;
    priorReceipt?: boolean;
    runnerLifecycle?: string;
    coordinatorPhase?: string;
    coordinatorLeaseOwner?: string | null;
    conformance?: boolean;
    priorIssueOverride?: string;
    priorRunnerInstance?: string;
    warm?: boolean;
    backup?: "present" | "absent" | "previous_only" | "foreign_current_profile";
    backupModel?: string;
    stampManifestFrom?: "current" | "other";
    stampSessionScope?: "current" | "other";
    backupSourceProviderLease?: "prior" | "other";
    currentCwd?: string;
  };

  async function seed(options: Options = {}) {
    const ids = { issue: randomUUID(), run1: randomUUID(), run2: randomUUID(), lease1: randomUUID(), lease2: randomUUID(),
      session: randomUUID(), workspace: randomUUID(), runner: randomUUID() };
    const providerLease1 = `sandbox-${randomUUID()}`;
    const providerLease2 = options.sameProviderLease ? providerLease1 : `sandbox-${randomUUID()}`;
    const conformance = options.conformance === true;
    await db.insert(issues).values({ id: ids.issue, companyId, title: "Handoff Task", assigneeAgentId: agentId,
      ...(conformance ? { hiddenAt: new Date(), harnessKind: "provider_conformance" } : {}) });
    const priorIssue = options.priorIssueOverride ?? ids.issue;
    if (priorIssue !== ids.issue)
      await db.insert(issues).values({ id: priorIssue, companyId, title: "Other Task", assigneeAgentId: agentId });
    const execution1 = executionFor({ runId: ids.run1, issueId: priorIssue, sessionId: ids.session, workspaceId: ids.workspace });
    const execution2 = executionFor({ runId: ids.run2, issueId: ids.issue, sessionId: ids.session, workspaceId: ids.workspace });
    const runnerInstanceId = ids.runner;
    const finished = new Date(Date.now() - 60_000);
    await db.insert(heartbeatRuns).values([
      { id: ids.run1, companyId, agentId, scopeKind: "issue", issueId: priorIssue, nativeIssueId: priorIssue,
        runtimeMode: "native", status: options.priorStatus ?? "succeeded", startedAt: new Date(Date.now() - 120_000),
        finishedAt: finished, runnerInstanceId: options.priorRunnerInstance ?? runnerInstanceId,
        nativeSessionId: ids.session, processPid: 4242, processStartedAt: new Date(Date.now() - 119_000),
        nativePhase: "observed", triggerDetail: conformance ? "provider_conformance" : null,
        resultJson: conformance ? { nativeOpenCodeConformanceProbe: true, observedState: "completed" } : {},
        runnerProfileJson: { nativeExecutionInput: execution1 } },
      { id: ids.run2, companyId, agentId, scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue,
        runtimeMode: "native", status: "running", startedAt: new Date(), runnerInstanceId, nativeSessionId: ids.session,
        runnerProfileJson: { nativeExecutionInput: execution2 } },
    ]);
    // The cleanup flag is a projection of the original process event in the
    // same transaction (DB trigger), as the executor records it.
    const cleanupPending = options.priorCleanupPending === undefined ? false : options.priorCleanupPending;
    if (cleanupPending !== null) {
      await db.transaction(async tx => {
        await tx.insert(heartbeatRunEvents).values({ companyId, runId: ids.run1, agentId, seq: 1,
          eventType: cleanupPending ? "native.process_identity_recorded" : "native.remote_workload_stopped",
          payload: { fixture: "cold handoff process event" } });
        await tx.update(heartbeatRuns).set({ nativeProcessCleanupPending: cleanupPending }).where(eq(heartbeatRuns.id, ids.run1));
      });
    }
    await db.insert(nativeRunFinalizations).values({ runId: ids.run1, companyId, issueId: priorIssue,
      phase: options.coordinatorPhase ?? (conformance ? "observed" : "committed"),
      leaseOwner: options.coordinatorLeaseOwner ?? null,
      leaseExpiresAt: options.coordinatorLeaseOwner ? new Date(Date.now() + 60_000) : null });

    // Controller-side state root: Run 1's PRP identity, no local runner state
    // (the runner state lives in the sandbox and in the failover backup).
    const root = mkdtempSync(join(tmpdir(), "native-cold-handoff-"));
    roots.push(root);
    const identity = { runnerInstanceId, environmentLeaseId: ids.lease1, runId: ids.run1, normalizedSessionId: ids.session,
      turnId: "turn-1", itemId: "item-1" };
    mkdirSync(resolve(root, "control-plane"), { recursive: true, mode: 0o700 });
    writeFileSync(resolve(root, "control-plane", "control-plane-state.json"), JSON.stringify({
      schema: "paperclip.runner.durable.control-plane-state.v1", identity,
      ...(options.warm ? { warmTransition: { transitionId: "warm-1" } } : {}) }));
    const backupFor = (directory: string, sourceProviderLeaseId: string, model?: string) => {
      mkdirSync(resolve(directory, "runner"), { recursive: true, mode: 0o700 });
      mkdirSync(resolve(directory, "opencode"), { recursive: true, mode: 0o700 });
      writeFileSync(resolve(directory, "runner", "runner-state.json"), JSON.stringify({
        schema: "paperclip.runner.durable.state.v1", lifecycle: options.runnerLifecycle ?? "suspended", ...identity }));
      writeFileSync(resolve(directory, "opencode", "session.json"), JSON.stringify({ session: "ses_fixture" }));
      const manifestExecution = model ? executionFor({ runId: ids.run2, issueId: ids.issue, sessionId: ids.session,
        workspaceId: ids.workspace, model }) : execution2;
      const manifest = buildNativeHarnessBackupManifest({ backupRoot: directory, execution: manifestExecution, runnerInstanceId,
        providerSessionIdentity: { providerSessionId: "ses_fixture", providerBackendSessionId: "ses_fixture",
          providerSessionIdentity: null }, sourceProviderLeaseId, completedAt: finished.toISOString() });
      writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest));
      return manifest;
    };
    const backups = resolve(root, "failover-backups");
    const sourceProviderLeaseId = options.backupSourceProviderLease === "other" ? `sandbox-${randomUUID()}` : providerLease1;
    let manifestSha256 = `sha256:${"0".repeat(64)}`;
    const backup = options.backup ?? "present";
    if (backup === "present") {
      backupFor(resolve(backups, "current"), sourceProviderLeaseId, options.backupModel);
      manifestSha256 = `sha256:${sha(readFileSync(resolve(backups, "current", "manifest.json")))}`;
    } else if (backup === "previous_only") {
      backupFor(resolve(backups, "previous"), sourceProviderLeaseId, options.backupModel);
    } else if (backup === "foreign_current_profile") {
      // An intact compatible `previous` backup proves the Stop; the newest
      // `current` backup is for another provider profile (model).
      backupFor(resolve(backups, "previous"), sourceProviderLeaseId);
      backupFor(resolve(backups, "current"), sourceProviderLeaseId, "anthropic/other-model");
      manifestSha256 = `sha256:${sha(readFileSync(resolve(backups, "current", "manifest.json")))}`;
    }
    const sessionScopeSha256 = options.stampSessionScope === "other" ? sha(`other-${ids.session}`)
      : nativeSessionScopeSha256(execution2);
    const stamp = { schema: "paperclip.native-harness-backup-stamp.v2", normalizedSessionId: ids.session, runnerInstanceId,
      sessionScopeSha256, sourceProviderLeaseId, authorizedProviderLeaseId: providerLease1,
      manifestSha256: options.stampManifestFrom === "other" ? `sha256:${"f".repeat(64)}` : manifestSha256,
      completedAt: finished.toISOString() };
    const receipt = { schema: "paperclip.remote-termination.v1", companyId, runId: ids.run1, leaseId: ids.lease1,
      provider: "fixture-sandbox", providerLeaseId: providerLease1, state: "stopped", confirmedAt: finished.toISOString() };
    await db.insert(environmentLeases).values([
      { id: ids.lease1, companyId, environmentId, issueId: priorIssue, heartbeatRunId: ids.run1, status: "expired",
        provider: "fixture-sandbox", providerLeaseId: providerLease1, releasedAt: finished, cleanupStatus: "success",
        metadata: { remoteCwd, nativeHarnessBackup: stamp, ...(options.priorReceipt === false ? {} : { remoteExecutionTermination: receipt }) } },
      { id: ids.lease2, companyId, environmentId, issueId: ids.issue, heartbeatRunId: ids.run2, status: "active",
        provider: "fixture-sandbox", providerLeaseId: providerLease2,
        metadata: { remoteCwd: options.currentCwd ?? remoteCwd } },
    ]);
    const acquisition = options.acquisition ?? (options.sameProviderLease ? "resumed" : "created");
    const target = { environmentId, leaseId: ids.lease2, remoteCwd,
      reusableLeaseConfigured: options.reusableLeaseConfigured ?? (options.sameProviderLease ? true : false),
      sandboxLeaseAcquisition: { outcome: acquisition, providerLeaseId: providerLease2,
        ...(acquisition === "replacement" ? { previousProviderLeaseId: providerLease1, reason: "expired" as const } : {}) } };
    const verify = (overrides: { identity?: Record<string, unknown>; runnerInstanceId?: string;
      execution?: NativeExecutionInput } = {}) => verifyNativeColdLeaseHandoff({ db, root,
      identity: overrides.identity ?? identity, execution: overrides.execution ?? execution2,
      runnerInstanceId: overrides.runnerInstanceId ?? runnerInstanceId, target });
    return { ids, root, identity, execution2, verify, providerLease1, providerLease2, manifestSha256 };
  }

  it("accepts a cross-provider-lease handoff only through the verified latest backup", async () => {
    const seeded = await seed();
    const result = await seeded.verify();
    expect(result).toMatchObject({ ok: true, evidence: { currentEnvironmentLeaseId: seeded.ids.lease2,
      priorIdentity: { runId: seeded.ids.run1, environmentLeaseId: seeded.ids.lease1 },
      backup: { root: resolve(seeded.root, "failover-backups", "current"), manifestSha256: seeded.manifestSha256 } } });
  });

  it("accepts a same-provider-lease handoff without a backup restore", async () => {
    const seeded = await seed({ sameProviderLease: true, backup: "absent" });
    // The prior runner state is proven by the backup in production; with no
    // backup the authority lifecycle is indeterminate, so the Stop is unverified.
    expect(await seeded.verify()).toEqual({ ok: false, refusal: "prior_stop_unverified" });
    const withBackup = await seed({ sameProviderLease: true });
    expect(await withBackup.verify()).toMatchObject({ ok: true, evidence: { backup: null } });
  });

  it("does not apply when no prior Run of this session holds another lease", async () => {
    const seeded = await seed();
    expect(await seeded.verify({ identity: { ...seeded.identity, environmentLeaseId: seeded.ids.lease2 } }))
      .toEqual({ ok: false, refusal: "not_applicable" });
    expect(await seeded.verify({ identity: { ...seeded.identity, runId: seeded.ids.run2 } }))
      .toEqual({ ok: false, refusal: "not_applicable" });
    expect(await seeded.verify({ identity: { ...seeded.identity, normalizedSessionId: randomUUID() } }))
      .toEqual({ ok: false, refusal: "not_applicable" });
  });

  // Condition 1: same company, Agent, Task, session scope and runner instance.
  it("refuses a prior Run from another Task, Agent, company or runner instance", async () => {
    expect(await (await seed({ priorIssueOverride: randomUUID() })).verify()).toEqual({ ok: false, refusal: "scope_mismatch" });
    expect(await (await seed({ priorRunnerInstance: randomUUID() })).verify()).toEqual({ ok: false, refusal: "scope_mismatch" });
    const seeded = await seed();
    expect(await seeded.verify({ runnerInstanceId: randomUUID() })).toEqual({ ok: false, refusal: "scope_mismatch" });
    const otherAgent = executionFor({ runId: seeded.ids.run2, issueId: seeded.ids.issue, sessionId: seeded.ids.session,
      workspaceId: seeded.ids.workspace, agentId: otherAgentId });
    expect(await seeded.verify({ execution: otherAgent })).toEqual({ ok: false, refusal: "scope_mismatch" });
    const otherCompany = executionFor({ runId: seeded.ids.run2, issueId: seeded.ids.issue, sessionId: seeded.ids.session,
      workspaceId: seeded.ids.workspace, companyId: otherCompanyId });
    expect(await seeded.verify({ execution: otherCompany })).toEqual({ ok: false, refusal: "scope_mismatch" });
  });

  // Condition 2: no warm-transition evidence or in-memory owner.
  it("refuses while warm-transition evidence is retained", async () => {
    expect(await (await seed({ warm: true })).verify()).toEqual({ ok: false, refusal: "warm_owner_present" });
  });

  // Condition 3: verified Stop of Run 1.
  it("refuses without a verified Stop of the prior Run", async () => {
    for (const options of [{ priorStatus: "running" }, { priorCleanupPending: true }, { priorCleanupPending: null },
      { priorReceipt: false }, { runnerLifecycle: "ready" }] satisfies Options[]) {
      expect(await (await seed(options)).verify(), JSON.stringify(options))
        .toEqual({ ok: false, refusal: "prior_stop_unverified" });
    }
  });

  // Condition 4: Run 1's finalization coordinator is settled.
  it("refuses an unsettled prior coordinator, with only the hidden conformance probe's released shape as an exception", async () => {
    for (const options of [{ coordinatorPhase: "observed" }, { coordinatorPhase: "running" },
      { coordinatorPhase: "committed", coordinatorLeaseOwner: "owner-1" }] satisfies Options[]) {
      expect(await (await seed(options)).verify(), JSON.stringify(options))
        .toEqual({ ok: false, refusal: "prior_coordinator_unsettled" });
    }
    expect(await (await seed({ conformance: true })).verify()).toMatchObject({ ok: true });
    expect(await (await seed({ conformance: true, coordinatorLeaseOwner: "owner-1" })).verify())
      .toEqual({ ok: false, refusal: "prior_coordinator_unsettled" });
    // The exception binds the exact hidden conformance Run and Task.
    const ordinaryTaskProbe = await seed({ conformance: true });
    await db.update(issues).set({ hiddenAt: null }).where(eq(issues.id, ordinaryTaskProbe.ids.issue));
    expect(await ordinaryTaskProbe.verify()).toEqual({ ok: false, refusal: "prior_coordinator_unsettled" });
    const notAProbe = await seed({ conformance: true });
    await db.update(heartbeatRuns).set({ resultJson: {} }).where(eq(heartbeatRuns.id, notAProbe.ids.run1));
    expect(await notAProbe.verify()).toEqual({ ok: false, refusal: "prior_coordinator_unsettled" });
  });

  // Condition 5: the current lease, and another provider lease only through restore.
  it("refuses a current lease off the prior environment or remoteCwd, or a new provider lease without the restore path", async () => {
    expect(await (await seed({ currentCwd: "/sandbox/other" })).verify()).toEqual({ ok: false, refusal: "current_lease_mismatch" });
    expect(await (await seed({ acquisition: "created", reusableLeaseConfigured: true })).verify())
      .toEqual({ ok: false, refusal: "current_lease_mismatch" });
    expect(await (await seed({ acquisition: "resumed" })).verify()).toEqual({ ok: false, refusal: "current_lease_mismatch" });
    expect(await (await seed({ acquisition: "replacement" })).verify()).toMatchObject({ ok: true });
  });

  // Condition 6: the backup is present, latest and not foreign.
  it("refuses a missing backup", async () => {
    expect(await (await seed({ backup: "absent" })).verify()).toEqual({ ok: false, refusal: "prior_stop_unverified" });
    // An older `previous` backup alone proves the Stop but is not the backup to restore.
    expect(await (await seed({ backup: "previous_only" })).verify()).toEqual({ ok: false, refusal: "backup_missing" });
    const tampered = await seed();
    writeFileSync(resolve(tampered.root, "failover-backups", "current", "opencode", "session.json"), "{}");
    // A damaged current backup leaves no verified backup at all.
    expect(await tampered.verify()).toEqual({ ok: false, refusal: "prior_stop_unverified" });
  });

  it("refuses a stale backup", async () => {
    expect(await (await seed({ stampManifestFrom: "other" })).verify()).toEqual({ ok: false, refusal: "backup_stale" });
    expect(await (await seed({ backupSourceProviderLease: "other" })).verify()).toEqual({ ok: false, refusal: "backup_stale" });
  });

  it("refuses a foreign backup", async () => {
    expect(await (await seed({ stampSessionScope: "other" })).verify()).toEqual({ ok: false, refusal: "backup_foreign" });
    // A backup for another provider profile is not compatible with this session.
    const otherProfile = await seed({ backupModel: "anthropic/other-model" });
    expect(await otherProfile.verify()).toEqual({ ok: false, refusal: "prior_stop_unverified" });
    expect(await (await seed({ backup: "foreign_current_profile" })).verify()).toEqual({ ok: false, refusal: "backup_foreign" });
  });
});
