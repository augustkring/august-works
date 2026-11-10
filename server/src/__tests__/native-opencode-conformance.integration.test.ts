import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { agentProviderBindings, createDb, environmentLeases, heartbeatRunEvents, heartbeatRuns, issues, orchestrationModelReservations,
  orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts, runtimeCells, runtimeHostCommands } from "@paperclipai/db";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import { nativeOpenCodeConformanceService, registerNativeOpenCodeConformance } from "../services/native-opencode-conformance.js";
import { providerConformanceService } from "../services/provider-conformance.js";
import { quoteModelReservation } from "../services/orchestration/model-reservations.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("registered managed OpenCode conformance bootstrap", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home: string;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "aw-native-opencode-conformance-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    database = await startEmbeddedPostgresTestDatabase("aw-native-opencode-conformance-db-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, 60_000);
  afterAll(async () => {
    registerNativeOpenCodeConformance(db, undefined);
    await database?.cleanup();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  }, 30_000);

  it("runs the registered six-probe owner through exact signed per-presence Hosts", async () => {
    let observedProfiles: ReadonlyMap<string, WorkerModelProfile> | undefined;
    let observedSourceSha: string | undefined;
    let observedProviderKeys: Array<{ runId: string; keyMatchesConfiguredAgent: boolean }> = [];
    let observedStartTuples: Array<{ runId: string; tuple: Record<string, string> }> = [];
    let rejectedBootstrapScopes: string[] = [];
    const result = await withManagedNativeHeartbeatFixture({
      db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
      schedulerMode: "serial", managedOpenCodeConformance: true, sandboxRelay: true,
      providerReply: () => { throw new Error("the native conformance provider stub must own its response"); },
      driveScheduler: async () => { throw new Error("the native conformance branch must not start an ordinary Run"); },
      runOpenCodeConformance: async context => {
        observedProfiles = context.profiles;
        observedSourceSha = context.sourceSha;
        const runnerInstanceId = randomUUID();
        const initialBindings = await db.select().from(agentProviderBindings).where(inArray(agentProviderBindings.id,
          [...context.profiles.values()].map(profile => profile.providerBindingId)));
        expect(initialBindings).toHaveLength(2);
        expect(initialBindings.every(binding => binding.status === "unqualified" && binding.conformance &&
          Object.values(binding.conformance).length > 0 && Object.values(binding.conformance).every(value => value === false))).toBe(true);
        registerNativeOpenCodeConformance(db, nativeOpenCodeConformanceService(db, {
          profiles: [...context.profiles.values()], sourceSha: context.sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid",
          modelBrokerOrigin: context.origin,
          environmentRuntime: context.environmentRuntime, runnerInstanceId,
          prepareSandboxRun: async (actor, input) => {
            if (rejectedBootstrapScopes.length === 0) {
              const companyCells = await db.select({ hostId: runtimeCells.runtimeHostId }).from(runtimeCells)
                .where(eq(runtimeCells.companyId, input.companyId));
              const hostIds = [...new Set(companyCells.flatMap(row => row.hostId ? [row.hostId] : []))];
              const beforeCommands = hostIds.length ? await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands)
                .where(inArray(runtimeHostCommands.runtimeHostId, hostIds)) : [];
              const [beforePlan] = await db.select({ toolActionsUsed: orchestrationPlans.toolActionsUsed,
                budgets: orchestrationPlans.budgets }).from(orchestrationPlans)
                .where(and(eq(orchestrationPlans.companyId, input.companyId), eq(orchestrationPlans.id, input.planId))).limit(1);
              const beforeReservations = await db.select({ id: orchestrationModelReservations.id,
                status: orchestrationModelReservations.status }).from(orchestrationModelReservations)
                .where(and(eq(orchestrationModelReservations.companyId, input.companyId),
                  eq(orchestrationModelReservations.planId, input.planId)));
              const invalid: Array<[string, typeof input, typeof actor]> = [
                ["group", { ...input, groupId: randomUUID() }, actor],
                ["run", { ...input, runId: randomUUID() }, actor],
                ["manifest", { ...input, manifestHash: "0".repeat(64) }, actor],
                ["root", { ...input, workspaceRoot: `${input.workspaceRoot}/../rejected` }, actor],
                ["lease", { ...input, leaseId: randomUUID() }, actor],
                ["human", input, { ...actor, userId: randomUUID() }],
                ["agent", input, { ...actor, type: "agent" as const, agentId: randomUUID() }],
                ["none", input, { ...actor, type: "none" as const, userId: null }],
              ];
              for (const [name, invalidInput, invalidActor] of invalid) {
                await expect(context.prepareSandboxRun(invalidActor, invalidInput)).rejects.toThrow();
                rejectedBootstrapScopes.push(name);
              }
              const afterCells = await db.select({ hostId: runtimeCells.runtimeHostId }).from(runtimeCells)
                .where(eq(runtimeCells.companyId, input.companyId));
              const afterHostIds = [...new Set(afterCells.flatMap(row => row.hostId ? [row.hostId] : []))];
              const afterCommands = afterHostIds.length ? await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands)
                .where(inArray(runtimeHostCommands.runtimeHostId, afterHostIds)) : [];
              const [afterPlan] = await db.select({ toolActionsUsed: orchestrationPlans.toolActionsUsed,
                budgets: orchestrationPlans.budgets }).from(orchestrationPlans)
                .where(and(eq(orchestrationPlans.companyId, input.companyId), eq(orchestrationPlans.id, input.planId))).limit(1);
              const afterReservations = await db.select({ id: orchestrationModelReservations.id,
                status: orchestrationModelReservations.status }).from(orchestrationModelReservations)
                .where(and(eq(orchestrationModelReservations.companyId, input.companyId),
                  eq(orchestrationModelReservations.planId, input.planId)));
              expect(afterCommands).toHaveLength(beforeCommands.length);
              expect(afterPlan).toEqual(beforePlan);
              expect(afterReservations).toEqual(beforeReservations);
            }
            try { return await context.prepareSandboxRun(actor, input); }
            catch (error) {
              const frames = (error instanceof Error ? error.stack ?? "" : "").split("\n").flatMap(line => {
                const match = /server\/src\/([^\s():]+\.ts):(\d+):\d+/.exec(line);
                return match ? [`${match[1]}:${match[2]}`] : [];
              }).slice(0, 6);
              let cause: unknown = error;
              const database: Array<{ code: string; constraint: string | null }> = [];
              for (let depth = 0; depth < 6 && cause && typeof cause === "object"; depth++) {
                const row = cause as Record<string, unknown>;
                if (typeof row.code === "string" && /^[0-9A-Z]{5}$/.test(row.code)) database.push({ code: row.code,
                  constraint: typeof row.constraint_name === "string" && /^[a-z0-9_]{1,128}$/.test(row.constraint_name)
                    ? row.constraint_name : null });
                cause = row.cause;
              }
              console.info("native_conformance_valid_prepare_failure", JSON.stringify({ frames, database }));
              throw error;
            }
          },
        }));
        const result = await providerConformanceService(db).test(context.actor, context.companyIds.primary,
          context.agentIds.primary, { acknowledgeProviderRuns: true, maximumCostCents: 100,
            isolationPeer: { companyId: context.companyIds.peer, agentId: context.agentIds.peer } });
        expect(result.failure).toBeNull();
        observedProviderKeys = context.providerKeyObservations();
        expect(context.profiles.size).toBe(2);
        const hostFacts = context.runtimeFacts() as Record<string, any> | null;
        expect(hostFacts).toMatchObject({ mode: "controlled_two_agent_signed_host_relay" });
        observedStartTuples = Array.isArray(hostFacts?.nativeConformanceStartTupleObservations)
          ? hostFacts.nativeConformanceStartTupleObservations : [];
        expect(observedStartTuples).toHaveLength(6);
        expect(observedStartTuples.map(row => row.runId).sort()).toEqual([...result.runIds].sort());
        const imagePackProbes = Array.isArray(hostFacts?.execFacts)
          ? hostFacts.execFacts.filter((fact: Record<string, unknown>) => fact.providerPackImageProbe === true) : [];
        expect(imagePackProbes.length).toBeGreaterThan(0);
        expect(imagePackProbes.every((fact: Record<string, unknown>) => fact.providerPackImageRootMatches === true &&
          fact.nativePreparationPurpose === "provider_artifact" && fact.exitCode === 0 && fact.timedOut === false)).toBe(true);
        return result;
      },
    });

    expect(result).toMatchObject({
      failure: null,
      checks: { connect: true, identity: true, start: true, stream: true, wait: true,
        resume: true, memoryScoping: true, cancel: true },
    });
    expect(result.binding.status).toBe("active");
    expect(observedProfiles?.size).toBe(2);
    expect(result.runIds).toHaveLength(6);
    expect(new Set(result.runIds).size).toBe(6);
    expect(result.reservationIds).toHaveLength(6);
    expect(new Set(result.reservationIds).size).toBe(6);
    expect(observedProviderKeys).toHaveLength(6);
    expect(observedProviderKeys.every(row => row.keyMatchesConfiguredAgent)).toBe(true);

    const runs = await db.select().from(heartbeatRuns).where(inArray(heartbeatRuns.id, result.runIds));
    expect(runs).toHaveLength(6);
    const orderedRuns = result.runIds.map(id => runs.find(run => run.id === id)!);
    expect(orderedRuns.map(run => run.triggerDetail)).toEqual(Array(6).fill("provider_conformance"));
    expect(orderedRuns.every(run => run.status !== "running" && run.status !== "queued")).toBe(true);
    expect(orderedRuns.map(run => run.contextSnapshot?.providerConformanceGroupId))
      .toEqual(Array(6).fill(result.groupId));
    expect(orderedRuns.every(run => {
      const profile = run.runnerProfileJson as Record<string, any>;
      const source = profile.nativeOpenCodeConformanceSourceAuthority as Record<string, any> | undefined;
      const intents = profile.nativeModelInputDispatchIntents;
      const context = run.contextSnapshot as Record<string, any> | null;
      const dispatch = context?.nativeOpenCodeConformanceDispatch as Record<string, any> | undefined;
      const started = observedStartTuples.find(row => row.runId === run.id)?.tuple;
      return source?.scope === "provider_conformance" && source.probeRunId === run.id &&
        source.qualificationGroupId === result.groupId && source.turnId &&
        /^[a-f0-9]{64}$/.test(source.sourceDigest) && Array.isArray(intents) &&
        intents.length === 1 && intents[0]?.dispatchId === source.dispatchId &&
        intents[0]?.turnId === source.turnId && dispatch &&
        Object.keys(dispatch).sort().join(",") === "authorityHash,dispatchNonce,planId,probeId,profileId,qualificationGroupId" &&
        dispatch.qualificationGroupId === result.groupId && dispatch.planId === context?.providerConformancePlanId &&
        dispatch.profileId === context?.nativeOpenCodeConformanceProfileId &&
        dispatch.probeId === context?.nativeOpenCodeConformanceProbeId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dispatch.dispatchNonce) &&
        /^[a-f0-9]{64}$/.test(dispatch.authorityHash) && started &&
        started.qualificationGroupId === dispatch.qualificationGroupId && started.planId === dispatch.planId &&
        started.profileId === dispatch.profileId && started.probeId === dispatch.probeId &&
        started.dispatchNonce === dispatch.dispatchNonce && started.authorityHash === dispatch.authorityHash &&
        source.dispatchNonce === dispatch.dispatchNonce;
    })).toBe(true);
    const launchEvents = await db.select({ runId: heartbeatRunEvents.runId, eventType: heartbeatRunEvents.eventType })
      .from(heartbeatRunEvents).where(and(inArray(heartbeatRunEvents.runId, result.runIds),
        eq(heartbeatRunEvents.eventType, "native.process_start_requested")));
    expect(launchEvents).toHaveLength(6);

    const taskIds = [...new Set(orderedRuns.map(run => run.nativeIssueId!).filter(Boolean))];
    const tasks = await db.select().from(issues).where(inArray(issues.id, taskIds));
    expect(tasks).toHaveLength(2);
    expect(tasks.every(task => task.hiddenAt !== null && task.harnessKind === "provider_conformance" &&
      task.conversationAgentId === null && task.conversationUserId === null && task.projectId === null)).toBe(true);
    const planIds = [...new Set(orderedRuns.map(run =>
      String(run.contextSnapshot?.providerConformancePlanId)))];
    const plans = await db.select().from(orchestrationPlans).where(inArray(orchestrationPlans.id, planIds));
    expect(plans).toHaveLength(2);
    expect(plans.every(plan => plan.status === "paused" && plan.actionClass === "internal_draft" &&
      plan.riskClass === "C0" && plan.budgets.maxToolActions === 0 && plan.budgets.maxRetries === 0)).toBe(true);
    expect(await db.select().from(orchestrationWorkers).where(inArray(orchestrationWorkers.planId, planIds))).toEqual([]);
    expect(await db.select().from(orchestrationWorkerAttempts).where(inArray(orchestrationWorkerAttempts.planId, planIds))).toEqual([]);

    const workspaces = orderedRuns.map(run => {
      const profile = run.runnerProfileJson as Record<string, any>;
      return profile.nativeOpenCodeConformanceWorkspace as Record<string, any>;
    });
    expect(workspaces.every(workspace => workspace.groupId === result.groupId &&
      /^[a-f0-9]{64}$/.test(workspace.authorityHash) && /^[a-f0-9]{64}$/.test(workspace.descriptorSha256) &&
      /^[a-f0-9]{64}$/.test(workspace.baselineSha256))).toBe(true);
    expect(workspaces.map(workspace => workspace.createdEmpty)).toEqual([true, false, true, false, false, false]);
    const primaryWorkspaceRoots = [0, 1, 4, 5].map(index => workspaces[index]!.taskRoot);
    const peerWorkspaceRoots = [2, 3].map(index => workspaces[index]!.taskRoot);
    expect(new Set(primaryWorkspaceRoots)).toEqual(new Set([primaryWorkspaceRoots[0]]));
    expect(new Set(peerWorkspaceRoots)).toEqual(new Set([peerWorkspaceRoots[0]]));
    expect(primaryWorkspaceRoots[0]).not.toBe(peerWorkspaceRoots[0]);

    const reservations = await db.select().from(orchestrationModelReservations)
      .where(inArray(orchestrationModelReservations.id, result.reservationIds));
    expect(reservations).toHaveLength(6);
    const orderedReservations = result.reservationIds.map(id => reservations.find(row => row.id === id)!);
    expect(observedSourceSha).toBeTruthy();
    const expectedCeilings = orderedRuns.map(run => {
      const profile = observedProfiles!.get(run.agentId)!;
      return quoteModelReservation({ tariff: profile.tariff, sourceSha: observedSourceSha!, inputTokensUpperBound: profile.inputTokensUpperBound,
        maxOutputTokens: profile.maxOutputTokens }).maximumMinor;
    });
    expect(orderedReservations.every(row => row.purpose === "provider_conformance" && row.workerId === null &&
      row.workerAttemptId === null && row.providerWireReceipt?.version === 1 &&
      row.providerWireReceipt.reservationId === row.id && row.providerWireReceipt.requestHash === row.requestHash &&
      row.providerWireReceipt.method === "POST" && row.providerWireReceipt.endpoint === "https://api.anthropic.com/v1/messages" &&
      /^[a-f0-9]{64}$/.test(row.providerWireReceipt.bodySha256))).toBe(true);
    expect(orderedReservations.map(row => row.maximumMinor)).toEqual(expectedCeilings);
    expect(orderedReservations.slice(0, 5).every(row => row.status === "completed" && row.providerResponseHash && row.usage)).toBe(true);
    expect(["unknown", "completed"]).toContain(orderedReservations[5]?.status);

    const leases = await db.select().from(environmentLeases).where(inArray(environmentLeases.heartbeatRunId, result.runIds));
    expect(leases).toHaveLength(6);
    const orderedLeases = result.runIds.map(id => leases.find(lease => lease.heartbeatRunId === id)!);
    expect(orderedLeases.slice(0, 5).every(lease =>
      lease.status === "released" && lease.releasedAt && lease.cleanupStatus === "success")).toBe(true);
    expect(orderedLeases[5]).toMatchObject({ status: "expired", cleanupStatus: "success" });
    expect(orderedLeases.every(lease => {
      const termination = lease.metadata?.remoteExecutionTermination;
      return Boolean(lease.releasedAt && lease.cleanupStatus === "success" &&
        termination && typeof termination === "object");
    })).toBe(true);
    expect(result.unknownChargeReservationIds.length).toBeLessThanOrEqual(1);
  }, 1_200_000);
});
