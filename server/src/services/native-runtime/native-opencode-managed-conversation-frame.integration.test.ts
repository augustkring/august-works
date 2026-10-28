import {and,desc,eq,gte,sql} from "drizzle-orm";
import {randomUUID} from "node:crypto";
import {agentPresenceRuntimeBindings,authSessions,authUsers,companyDeletionOperations,companyMemberships,companies,environmentLeases,heartbeatRunEvents,heartbeatRuns,issues,memoryJobs,nativeRunFinalizations,nativeRunResults,projectWorkspaces,projects,runtimeHostCommands} from "@paperclipai/db";
import type {BusinessMetricQuery} from "@paperclipai/shared";
import {instanceSettingsService} from "../instance-settings.js";
import {businessMetricService} from "../business-metrics/service.js";
import {aiGovernanceService} from "../ai-governance/governance-service.js";
import {issueService} from "../issues.js";
import {documentService} from "../documents.js";
import {analyticalPurpose,metricDefinition} from "../../__tests__/helpers/business-metric-fixture.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable, runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { configureManagedConversationSandboxHost } from "../../__tests__/helpers/managed-native-conversation-sandbox-host.js";
import express from "express";
import request from "supertest";
import { actorMiddleware } from "../../middleware/auth.js";
import { errorHandler } from "../../middleware/error-handler.js";
import type { BetterAuthSessionResult } from "../../auth/better-auth.js";
import { projectRoutes } from "../../routes/projects.js";
import { issueRoutes } from "../../routes/issues.js";
import { seedNativePasskeySession } from "../../__tests__/helpers/native-authentication-fixtures.js";
import { nativeCancelOriginTestFactsForRun } from "./native-session-executor.js";
import { redactSensitiveText } from "../../redaction.js";
import { validatePrpEvent } from "../../vendor/paperclip-runner/index.js";
import { memoryJobService } from "../memory/memory-jobs.js";
import { enqueueCompanyManagedOpenCodeRuntimeErasure, readRemoteRuntimeAssetLocator } from "./runtime-asset-retention.js";
import path from "node:path";
import fs from "node:fs/promises";

function qualifiedOpenCodeBinary(): string | null {
  if (process.platform !== "linux") return null;
  const configured = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim();
  if (configured) return configured;
  try { return execFileSync("which", ["opencode"], { encoding: "utf8" }).trim() || null; }
  catch { return null; }
}

describe.skipIf(!qualifiedOpenCodeBinary())("managed Native conversation OpenCode frame", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-native-conversation-frame-"));
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", `conversation-frame-${Date.now()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-native-conversation-frame-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root) { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it("uses the authenticated chat route and actual heartbeat to dispatch a pinned OpenCode turn under a conversation issuer token, without worker-plan rows", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    let liveBoundary: { runId: string; issueId: string; manifestId: string; reservationId: string;
      requestHash: string; wireBodyHash: string; sourceReceiptHash: string; inputTokens: number; outputTokens: number } | null = null;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      beforeProviderResponse: async facts => {
        expect(facts.run.status).toBe("running");
        expect(facts.run.nativeIssueId).toBe(facts.issueId);
        expect(facts.reservation).toMatchObject({ purpose: "conversation_model", status: "dispatched",
          conversationRunId: facts.run.id, conversationIssueId: facts.issueId,
          executionManifestId: facts.manifest.id, executionManifestHash: expect.any(String) });
        expect(facts.sourceReceipt).toMatchObject({ version: 1, binding: { runId: facts.run.id,
          issueId: facts.issueId, responsibleUserId: facts.run.responsibleUserId } });
        expect(facts.tariffSnapshot).toEqual(expect.any(Object));
        expect(facts.quote).toEqual(expect.any(Object));
        expect(facts.budget.companyMonthlyCents).toBeGreaterThan(0);
        expect(facts.budget.agentMonthlyCents).toBeGreaterThan(0);
        expect(facts.profileBinding).toMatchObject({ model: "fixture-managed-conversation-v1",
          providerBindingId: expect.any(String), providerSnapshotHash: expect.any(String),
          qualifiedConfigurationHash: expect.any(String) });
        liveBoundary = { runId: facts.run.id, issueId: facts.issueId, manifestId: facts.manifest.id,
          reservationId: facts.reservation.id, requestHash: facts.request.bodySha256,
          wireBodyHash: facts.request.wireBodySha256, sourceReceiptHash: JSON.stringify(facts.sourceReceipt),
          inputTokens: facts.usage.inputTokens, outputTokens: facts.usage.outputTokens };
      } });
    expect(result.success, JSON.stringify({ runStatus: result.runStatus, runError: result.run?.error,
      errorCode: result.run?.errorCode, stdoutExcerpt: result.run?.stdoutExcerpt,
      stderrExcerpt: result.run?.stderrExcerpt, providerCallCount: result.providerCallCount,
      providerHookInvoked: result.providerHookInvoked, providerHookFailure: result.providerHookFailure,
      providerStubFailure: result.providerStubFailure, providerToolNames: result.providerToolNames,
      issuerFacts: result.issuerFacts, liveBoundary, brokerRequestFacts: result.brokerRequestFacts })).toBe(true);
    expect(result.providerCallCount).toBeGreaterThan(0);
    expect(result.providerKeyMatched).toBe(true);
    expect(liveBoundary).toMatchObject({ runId: result.run?.id, issueId: result.issueId,
      manifestId: result.manifest?.id, reservationId: result.reservation?.id, inputTokens: 100, outputTokens: 32 });
    expect(result.issuerFacts).toHaveLength(1);
    const issuer = result.issuerFacts[0];
    if (!issuer) throw new Error("conversation_frame_issuer_fact_missing");
    expect(issuer).toMatchObject({ scope: "conversation_model", runId: result.run?.id,
      issueId: result.issueId, generation: 0, manifestId: result.manifest?.id });
    expect(issuer.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.run).toMatchObject({ runtimeMode: "native", scopeKind: "issue", nativeIssueId: result.issueId,
      responsibleUserId: expect.any(String), status: "succeeded" });
    expect(result.manifest).toMatchObject({ runId: result.run?.id, agentId: result.run?.agentId });
    expect(result.agentReply).toMatchObject({ authorAgentId: result.run?.agentId, createdByRunId: result.run?.id,
      body: "I’ve received your message and am ready to continue." });
    expect(result.conversationCommentCount).toBe(2);
    expect(result.reviewInteractionCount).toBe(0);
    expect(result.conversationIssue).toMatchObject({ status: "in_review", conversationState: "waiting",
      executionRunId: null });
    expect([403, 404]).toContain(result.foreignWriteStatus);
    expect(result.foreignWriteDidNotMutate).toBe(true);
    expect(result.reservation).toMatchObject({ purpose: "conversation_model", conversationRunId: result.run?.id,
      conversationIssueId: result.issueId, status: "completed" });
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    const sourceReceipt = result.nativeInputSourceReceipt as Record<string, unknown> | null;
    expect(sourceReceipt).toMatchObject({ version: 1, binding: { runId: result.run?.id,
      issueId: result.issueId, responsibleUserId: result.run?.responsibleUserId } });
  }, 240_000);

  it("runs the route-created conversation through RuntimeControl and its signed qualified sandbox relay", async () => {
    vi.stubEnv("PAPERCLIP_MANAGED_OPENCODE_E2E_DIAGNOSTICS", "1");
    vi.stubEnv("PAPERCLIP_NATIVE_CANCEL_ORIGIN_TEST_DIAGNOSTICS", "1");
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
    const settledRunEvidence: { current: Record<string, unknown> | null } = { current: null };
    let eraseRemoteNativeRuntimeAsset: Awaited<ReturnType<typeof configureManagedConversationSandboxHost>>["eraseRemoteNativeRuntimeAsset"] | null = null;
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary, sandboxRelay: true, timeoutSec: 600,
      configureHeartbeat: async context => {
        const host = await configureManagedConversationSandboxHost({ ...context, root });
        eraseRemoteNativeRuntimeAsset = host.eraseRemoteNativeRuntimeAsset;
        return host;
      },
      beforeProviderResponse: async facts => {
        expect(facts.run.status).toBe("running");
        expect(facts.run.nativeIssueId).toBe(facts.issueId);
        expect(facts.reservation).toMatchObject({ purpose: "conversation_model", status: "dispatched",
          conversationRunId: facts.run.id, conversationIssueId: facts.issueId, executionManifestId: facts.manifest.id });
      },
      afterRunSettledBeforeTeardown: async facts => {
        if (!facts.run) return;
        const events = await db.select({ seq: heartbeatRunEvents.seq, eventType: heartbeatRunEvents.eventType,
          payload: heartbeatRunEvents.payload })
          .from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, facts.run.id)).orderBy(heartbeatRunEvents.seq);
        const parsedEvents = events.flatMap(event => {
          const envelope = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown> : {};
          const parsed = validatePrpEvent(envelope.prpEvent);
          return parsed.ok ? [parsed.event] : [];
        });
        const failedTurn = parsedEvents.find(event => event.eventType === "turn.failed");
        const sessionFailed = parsedEvents.find(event => event.eventType === "session.failed");
        const failedTurnPayload = failedTurn?.payload && typeof failedTurn.payload === "object" && !Array.isArray(failedTurn.payload)
          ? failedTurn.payload as Record<string, unknown> : {};
        const sessionFailedPayload = sessionFailed?.payload && typeof sessionFailed.payload === "object" && !Array.isArray(sessionFailed.payload)
          ? sessionFailed.payload as Record<string, unknown> : {};
        const sessionFailureError = sessionFailedPayload.error && typeof sessionFailedPayload.error === "object" &&
          !Array.isArray(sessionFailedPayload.error) ? sessionFailedPayload.error as Record<string, unknown> : {};
        const failedTurnCode = typeof failedTurnPayload.code === "string" && /^[a-z0-9_.:-]{1,100}$/i.test(failedTurnPayload.code)
          ? failedTurnPayload.code : null;
        const sessionFailedCode = typeof sessionFailedPayload.code === "string" && /^[a-z0-9_.:-]{1,100}$/i.test(sessionFailedPayload.code)
          ? sessionFailedPayload.code : null;
        const failureArtifactPath = process.env.PAPERCLIP_NATIVE_RELAY_FAILURE_EVIDENCE_PATH;
        if (typeof failureArtifactPath === "string" &&
          /^\/workspace\/blentera-v10\/doc\/operations\/aw-v10-evidence\/rt01-runtime-probe-contract-2026-10-27\/r[0-9]+\/runner-stderr-redacted\.txt$/.test(failureArtifactPath)) {
          const launchStderr = typeof facts.sandboxRuntimeFacts?.runnerLaunchStderr === "string"
            ? facts.sandboxRuntimeFacts.runnerLaunchStderr : "";
          const runnerDiagnosticTail = typeof facts.sandboxRuntimeFacts?.runnerDiagnosticTail === "string"
            ? facts.sandboxRuntimeFacts.runnerDiagnosticTail : "";
          const redacted = Buffer.from(redactSensitiveText([
            typeof facts.run.stderrExcerpt === "string" ? facts.run.stderrExcerpt : "",
            launchStderr,
            runnerDiagnosticTail,
          ].filter(Boolean).join("\n")), "utf8");
          await writeFile(failureArtifactPath, redacted.subarray(Math.max(0, redacted.length - 8192)),
            { flag: "wx", mode: 0o600 });
          if (sessionFailed || failedTurn) {
            const failurePayload = sessionFailed ? sessionFailedPayload : failedTurnPayload;
            const redactedPayload = Buffer.from(redactSensitiveText(JSON.stringify(failurePayload)), "utf8");
            await writeFile(failureArtifactPath.replace("runner-stderr-redacted.txt", "turn-failure-redacted.txt"),
              redactedPayload.subarray(0, 2048), { flag: "wx", mode: 0o600 });
          }
        }
        const commands = await db.select({ requestId: runtimeHostCommands.idempotencyKey, status: runtimeHostCommands.status,
          errorCode: runtimeHostCommands.errorCode, attempt: runtimeHostCommands.attempt, createdAt: runtimeHostCommands.createdAt,
          purpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
          commandDigest: sql<string | null>`${runtimeHostCommands.payload}->>'commandDigest'` })
          .from(runtimeHostCommands).where(and(eq(runtimeHostCommands.companyId, facts.companyId),
            eq(runtimeHostCommands.commandType, "sandbox_exec"),
            sql`${runtimeHostCommands.payload}->>'runId' = ${facts.run.id}`)).orderBy(runtimeHostCommands.createdAt).limit(256);
        const resultJson = facts.run.resultJson && typeof facts.run.resultJson === "object" && !Array.isArray(facts.run.resultJson)
          ? facts.run.resultJson as Record<string, unknown> : {};
        const nativeCancellation = resultJson.nativeCancellation && typeof resultJson.nativeCancellation === "object" &&
          !Array.isArray(resultJson.nativeCancellation) ? resultJson.nativeCancellation as Record<string, unknown> : {};
        const startupCancellation = resultJson.startupCancellation && typeof resultJson.startupCancellation === "object" &&
          !Array.isArray(resultJson.startupCancellation) ? resultJson.startupCancellation as Record<string, unknown> : {};
        const relayCommandOwners = (Array.isArray(facts.sandboxRuntimeFacts?.relayCommandOwners)
          ? facts.sandboxRuntimeFacts.relayCommandOwners as Array<Record<string, unknown>> : [])
          .filter(owner => typeof owner.requestId === "string" && typeof owner.owner === "string");
        settledRunEvidence.current = {
          eventTypes: events.map(event => event.eventType),
          eventCount: events.length,
          runStartedAt: facts.run.startedAt?.toISOString() ?? null,
          nativeCancellationPresent: Object.keys(nativeCancellation).length > 0,
          nativeCancellationScope: nativeCancellation.scope === "run" ? "run" : nativeCancellation.scope ? "other" : "absent",
          nativeCancellationDispatchState: nativeCancellation.dispatchState === "pending" || nativeCancellation.dispatchState === "acknowledged"
            ? nativeCancellation.dispatchState : nativeCancellation.dispatchState ? "other" : "absent",
          startupCancellationPresent: Object.keys(startupCancellation).length > 0,
          startupCancelledBeforeNativeSelection: startupCancellation.beforeNativeSelection === true,
          sandboxCommandCounts: commands.reduce<Record<string, number>>((counts, command) => {
            const key = `${command.purpose ?? "unclassified"}:${command.status}:${command.errorCode ?? "none"}`;
            counts[key] = (counts[key] ?? 0) + 1;
            return counts;
          }, {}),
          failedSandboxCommands: commands.filter(command => command.status === "FAILED")
            .slice(-16).map(command => ({ requestId: command.requestId, errorCode: command.errorCode,
              attempt: command.attempt, purpose: command.purpose, commandDigest: command.commandDigest,
              relayCommandOwner: relayCommandOwners.find(owner => owner.requestId === command.requestId)?.owner ?? null,
              createdAt: command.createdAt.toISOString() })),
          nativeFailureFacts: facts.run.stderrExcerpt?.match(/\[paperclip-runner\] native session original failure facts: (\{[^\r\n]+\})/)?.[1] ?? null,
          failedTurnEventPresent: Boolean(failedTurn),
          failedTurnCode,
          sessionFailedEventPresent: Boolean(sessionFailed),
          sessionFailedCode,
          failedTurnPayloadKeys: Object.keys(failedTurnPayload).sort().slice(0, 24),
          sessionFailureErrorKeys: Object.keys(sessionFailureError).sort().slice(0, 24),
          runErrorMarkers: ["runner_remote_process_launch_failed", "runner_remote_process_launch_timed_out",
            "runner_remote_process_identity_unavailable", "runner_remote_process_identity_unavailable_cleanup_failed",
            "runner_remote_process_exited", "runner_remote_process_identity_mismatch", "runner_process_status_unavailable",
            "runner_remote_process_signal_failed"].filter(marker => facts.run?.stderrExcerpt?.includes(marker)),
          unresolvedSandboxCommands: commands.filter(command => command.status === "PENDING" || command.status === "CLAIMED")
            .map(command => ({ requestId: command.requestId, status: command.status,
              errorCode: command.errorCode, purpose: command.purpose, attempt: command.attempt,
              commandDigest: command.commandDigest, createdAt: command.createdAt.toISOString() })).slice(0, 32),
        };
        if (facts.run.status === "succeeded") {
          if (!eraseRemoteNativeRuntimeAsset) throw new Error("conversation_remote_native_asset_eraser_missing");
          const [durableRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, facts.run.id)).limit(1);
          if (!durableRun) throw new Error("conversation_remote_native_asset_run_missing");
          const locator = await readRemoteRuntimeAssetLocator(db, durableRun);
          if (!locator) throw new Error("conversation_remote_native_asset_locator_missing");
          const [lease] = await db.select({ metadata: environmentLeases.metadata }).from(environmentLeases).where(and(
            eq(environmentLeases.companyId, facts.companyId), eq(environmentLeases.id, locator.environmentLeaseId))).limit(1);
          const remoteCwd = lease?.metadata && typeof lease.metadata.remoteCwd === "string" ? lease.metadata.remoteCwd : null;
          if (!remoteCwd) throw new Error("conversation_remote_native_asset_cwd_missing");
          const sessionsRoot = path.join(remoteCwd, ".paperclip-runtime", "paperclip-runner", "sessions");
          const siblingSessionRoot = path.join(sessionsRoot, "f".repeat(64));
          await fs.mkdir(siblingSessionRoot, { recursive: true });
          await fs.writeFile(path.join(siblingSessionRoot, "retained-neighbor.txt"), "neighbor remains");
          const operationId = randomUUID();
          await db.update(companies).set({ status: "archived" }).where(eq(companies.id, facts.companyId));
          await db.insert(companyDeletionOperations).values({ id: operationId, companyId: facts.companyId,
            requestedByUserId: facts.actor.userId ?? "managed-runtime-fixture", idempotencyKey: `remote-runtime-erasure-${operationId}`,
            status: "processing", stage: "purge", evidence: { runtimesErasedAt: new Date().toISOString() } });
          if (!durableRun.nativeSessionId) throw new Error("conversation_remote_native_asset_session_missing");
          const coOwnerRunId = randomUUID();
          await db.insert(heartbeatRuns).values({ id: coOwnerRunId, companyId: facts.companyId, agentId: facts.agentId,
            status: "succeeded", runtimeMode: "native", driverKind: "opencode_server",
            nativeSessionId: durableRun.nativeSessionId, runnerInstanceId: durableRun.runnerInstanceId, runnerProfileJson: {} });
          await enqueueCompanyManagedOpenCodeRuntimeErasure(db, facts.companyId, operationId);
          await memoryJobService(db, { eraseRemoteNativeRuntimeAsset }).tick({ limit: 32, companyId: facts.companyId });
          const [blockedJob] = await db.select({ status: memoryJobs.status, resultJson: memoryJobs.resultJson }).from(memoryJobs).where(and(
            eq(memoryJobs.companyId, facts.companyId), eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${facts.run.id}`)))
            .orderBy(desc(memoryJobs.attemptNumber)).limit(1);
          expect(blockedJob?.status).toBe("failed");
          expect((blockedJob?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt).toBeUndefined();
          await expect(fs.stat(path.join(sessionsRoot, locator.normalizedSessionIdDigest))).resolves.toBeDefined();
          await db.delete(memoryJobs).where(and(eq(memoryJobs.companyId, facts.companyId),
            eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${coOwnerRunId}`)));
          await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, coOwnerRunId));
          await enqueueCompanyManagedOpenCodeRuntimeErasure(db, facts.companyId, operationId);
          const jobKey = `runtime-asset-erasure:v1:${facts.run.id}`;
          const [queuedJob] = await db.select().from(memoryJobs).where(and(
            eq(memoryJobs.companyId, facts.companyId), eq(memoryJobs.jobKey, jobKey)))
            .orderBy(desc(memoryJobs.attemptNumber)).limit(1);
          expect(queuedJob?.status).toBe("queued");
          const crashWorkerId = randomUUID();
          const [crashClaim] = await db.update(memoryJobs).set({ status: "running", executionOwnerId: crashWorkerId,
            leaseExpiresAt: new Date(Date.now() + 60_000), startedAt: new Date(), updatedAt: new Date() }).where(and(
            eq(memoryJobs.id, queuedJob!.id), eq(memoryJobs.status, "queued"))).returning();
          if (!crashClaim) throw new Error("conversation_remote_erasure_crash_claim_missing");
          const relatedErasureCommands = async () => (await db.select().from(runtimeHostCommands).where(and(
            eq(runtimeHostCommands.companyId, facts.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
            sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = 'native_provider_data_erasure'`)))
            .filter(command => {
              const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
                ? command.payload as Record<string, unknown> : {};
              const erasure = payload.remoteRuntimeAssetErasure && typeof payload.remoteRuntimeAssetErasure === "object" &&
                !Array.isArray(payload.remoteRuntimeAssetErasure)
                ? payload.remoteRuntimeAssetErasure as Record<string, unknown> : {};
              return erasure.jobKey === jobKey;
            });
          const raceWorker = memoryJobService(db, { ownerId: crashWorkerId,
            eraseRemoteNativeRuntimeAsset: async (currentLocator, commandInput) => {
              const mismatchedLocator = { ...currentLocator, providerLeaseId: `${currentLocator.providerLeaseId}-changed` };
              await expect(eraseRemoteNativeRuntimeAsset!(mismatchedLocator, commandInput)).rejects.toBeDefined();
              await expect(eraseRemoteNativeRuntimeAsset!(currentLocator,
                { ...commandInput, companyPurgeOperationId: randomUUID() })).rejects.toBeDefined();
              const [runtimeBinding] = await db.select().from(agentPresenceRuntimeBindings).where(and(
                eq(agentPresenceRuntimeBindings.companyId, facts.companyId), eq(agentPresenceRuntimeBindings.agentId, facts.agentId),
                eq(agentPresenceRuntimeBindings.status, "active"))).limit(1);
              const generationRef = runtimeBinding && /^aw:cell:([0-9a-f-]{36}):generation:([1-9][0-9]{0,18})$/i
                .exec(runtimeBinding.providerProfileRef);
              if (!runtimeBinding || !generationRef) throw new Error("conversation_remote_erasure_generation_ref_missing");
              await db.update(agentPresenceRuntimeBindings).set({ providerProfileRef:
                `aw:cell:${generationRef[1]}:generation:${BigInt(generationRef[2]!) + 1n}` })
                .where(eq(agentPresenceRuntimeBindings.id, runtimeBinding.id));
              try {
                await expect(eraseRemoteNativeRuntimeAsset!(currentLocator, commandInput)).rejects.toBeDefined();
              } finally {
                await db.update(agentPresenceRuntimeBindings).set({ providerProfileRef: runtimeBinding.providerProfileRef })
                  .where(eq(agentPresenceRuntimeBindings.id, runtimeBinding.id));
              }
              expect(await relatedErasureCommands()).toHaveLength(0);
              const concurrent = await Promise.allSettled([
                eraseRemoteNativeRuntimeAsset!(currentLocator, commandInput),
                eraseRemoteNativeRuntimeAsset!(currentLocator, commandInput),
              ]);
              const receipts = concurrent.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
              expect(receipts.length).toBeGreaterThan(0);
              expect(receipts.every(receipt => receipt.commandRequestId === receipts[0]!.commandRequestId)).toBe(true);
              await db.update(memoryJobs).set({ executionOwnerId: "lost-after-remote-receipt",
                leaseExpiresAt: new Date(Date.now() - 1), updatedAt: new Date() }).where(eq(memoryJobs.id, commandInput.jobId));
              return receipts[0]!;
            } });
          await raceWorker.executeClaimed(crashClaim);
          const [crashedJob] = await db.select().from(memoryJobs).where(eq(memoryJobs.id, crashClaim.id));
          expect(crashedJob).toMatchObject({ status: "running", executionOwnerId: "lost-after-remote-receipt" });
          expect(crashedJob?.leaseExpiresAt && crashedJob.leaseExpiresAt.getTime()).toBeLessThan(Date.now());
          const beforeRecoveryCommands = await relatedErasureCommands();
          expect(beforeRecoveryCommands).toHaveLength(1);
          expect(beforeRecoveryCommands[0]?.status).toBe("SUCCEEDED");
          const recoveryWorker = memoryJobService(db, { ownerId: "remote-erasure-recovery-worker",
            eraseRemoteNativeRuntimeAsset });
          await expect(recoveryWorker.recoverExpiredLeases(new Date(), 32, facts.companyId))
            .resolves.toMatchObject({ recovered: 1, retried: 1 });
          const [retryQueued] = await db.select().from(memoryJobs).where(and(
            eq(memoryJobs.companyId, facts.companyId), eq(memoryJobs.jobKey, jobKey), eq(memoryJobs.attemptNumber, 2)));
          expect(retryQueued?.status).toBe("queued");
          const [retryClaim] = await db.update(memoryJobs).set({ status: "running", executionOwnerId: "remote-erasure-recovery-worker",
            leaseExpiresAt: new Date(Date.now() + 60_000), startedAt: new Date(), updatedAt: new Date() }).where(and(
            eq(memoryJobs.id, retryQueued!.id), eq(memoryJobs.status, "queued"))).returning();
          if (!retryClaim) throw new Error("conversation_remote_erasure_retry_claim_missing");
          await recoveryWorker.executeClaimed(retryClaim);
          const [job] = await db.select({ status: memoryJobs.status, resultJson: memoryJobs.resultJson }).from(memoryJobs).where(and(
            eq(memoryJobs.companyId, facts.companyId), eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${facts.run.id}`)))
            .orderBy(desc(memoryJobs.attemptNumber)).limit(1);
          expect(job?.status).toBe("succeeded");
          expect((job?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt)
            .toMatchObject({ relativePath: locator.relativePath, pathDigest: locator.pathDigest,
              purpose: "native_provider_data_erasure", stopProofBeforeDelete: true, postDeleteAbsent: true,
              stopProof: expect.objectContaining({ runId: facts.run.id,
                normalizedSessionIdDigest: locator.normalizedSessionIdDigest,
                environmentLeaseId: locator.environmentLeaseId, providerLeaseId: locator.providerLeaseId,
                pid: expect.any(Number), processStartFingerprintDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }) });
          expect((job?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt)
            .toMatchObject({ commandRequestId: beforeRecoveryCommands[0]?.idempotencyKey });
          expect(await relatedErasureCommands()).toHaveLength(1);
          await expect(fs.stat(path.join(sessionsRoot, locator.normalizedSessionIdDigest))).rejects.toMatchObject({ code: "ENOENT" });
          await expect(fs.readFile(path.join(siblingSessionRoot, "retained-neighbor.txt"), "utf8")).resolves.toBe("neighbor remains");
        }
      } });
    expect(result.success, JSON.stringify({ runStatus: result.runStatus, runError: result.run?.error,
      run: result.run ? { id: result.run.id, status: result.run.status, startedAt: result.run.startedAt,
        runtimeMode: result.run.runtimeMode, scopeKind: result.run.scopeKind, nativeIssueId: result.run.nativeIssueId,
        runtimeModeReason: result.run.runtimeModeReason, runtimeModeResolvedAt: result.run.runtimeModeResolvedAt,
        responsibleUserId: result.run.responsibleUserId, agentId: result.run.agentId,
        nativePhase: result.run.nativePhase, nativePhaseUpdatedAt: result.run.nativePhaseUpdatedAt,
        executionStage: result.run.executionStage, lastOutputAt: result.run.lastOutputAt,
        lastOutputSeq: result.run.lastOutputSeq, lastOutputStream: result.run.lastOutputStream,
        stdoutExcerptPresent: Boolean(result.run.stdoutExcerpt), stderrExcerptPresent: Boolean(result.run.stderrExcerpt),
        stderrNativeFailureFacts: settledRunEvidence.current?.nativeFailureFacts ?? null,
        executionCancellation: result.run.resultJson?.executionCancellation } : null,
      errorCode: result.run?.errorCode, providerCallCount: result.providerCallCount,
      reservation: result.reservation ? { status: result.reservation.status, purpose: result.reservation.purpose,
        dispatchedAt: result.reservation.dispatchedAt, completedAt: result.reservation.completedAt } : null,
      providerHookInvoked: result.providerHookInvoked, providerHookFailure: result.providerHookFailure,
      providerStubFailure: result.providerStubFailure, brokerRequestFacts: result.brokerRequestFacts,
      cancelOriginFacts: result.run ? nativeCancelOriginTestFactsForRun(result.run.id) : [],
      settledRunEvidence: settledRunEvidence.current,
      sandboxRuntimeFacts: result.sandboxRuntimeFacts })).toBe(true);
    expect(result.providerHookInvoked).toBe(true);
    expect(result.providerKeyMatched).toBe(true);
    expect(result.run).toMatchObject({ runtimeMode: "native", scopeKind: "issue", nativeIssueId: result.issueId,
      responsibleUserId: expect.any(String), status: "succeeded" });
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.agentReply).toMatchObject({ authorAgentId: result.run?.agentId, createdByRunId: result.run?.id,
      body: "I’ve received your message and am ready to continue." });
    expect(result.conversationIssue).toMatchObject({ status: "in_review", conversationState: "waiting",
      executionRunId: result.run?.id });
    expect(result.sandboxRuntimeFacts).toMatchObject({ mode: "controlled_signed_host_relay", relayAuthenticated: true });
    const runtimeFacts = result.sandboxRuntimeFacts as Record<string, unknown> | null;
    expect(typeof runtimeFacts?.providerAttestedLeaseExpiresAt).toBe("string");
    expect(Date.parse(String(runtimeFacts?.providerAttestedLeaseExpiresAt))).toBeGreaterThan(Date.now());
    expect(runtimeFacts?.execCount).toEqual(expect.any(Number));
    expect(Number(runtimeFacts?.execCount)).toBeGreaterThan(0);
    expect(Number(runtimeFacts?.exactPrivateCwdCount)).toBeGreaterThan(0);
    expect(Number(runtimeFacts?.managedModelCredentialCount)).toBeGreaterThan(0);
    expect(Number(runtimeFacts?.assignedMcpEnvironmentAbsentCount)).toBeGreaterThan(0);
    expect(runtimeFacts?.negativeControls).toEqual({ wrongRunDenied: true, wrongLeaseDenied: true,
      wrongCwdDenied: true, wrongPolicyDenied: true });
    expect(runtimeFacts?.negativeNativeSessionStartControls).toEqual({ wrongCommandDenied: true,
      wrongRootDenied: true, noExecution: true });
    expect(runtimeFacts?.nativeSessionStartCredentialNegativeControls).toEqual({ missingTokenDenied: true,
      mismatchedTokenDenied: true });
    const relayExecFacts = Array.isArray(runtimeFacts?.execFacts)
      ? runtimeFacts.execFacts as Array<Record<string, unknown>>
      : [];
    expect(relayExecFacts.some(fact => fact.modelCredentialPresent === true &&
      fact.managedModelBrokerOriginPresent === true && fact.cwdExact === true)).toBe(true);
    expect(relayExecFacts.some(fact => fact.nativePreparationPurpose === "native_workspace_prepare" &&
      fact.modelCredentialPresent === false && fact.managedModelBrokerOriginPresent === false &&
      fact.credentialEnvironmentAbsent === true && fact.assignedMcpEnvironmentAbsent === true &&
      fact.cwdExact === true)).toBe(true);
    expect(relayExecFacts.some(fact => fact.nativePreparationPurpose === "native_runtime_context_prepare" &&
      fact.modelCredentialPresent === false && fact.managedModelBrokerOriginPresent === false &&
      fact.credentialEnvironmentAbsent === true && fact.assignedMcpEnvironmentAbsent === true &&
      fact.cwdExact === true)).toBe(true);
    expect(relayExecFacts.some(fact => fact.nativePreparationPurpose === "provider_artifact" &&
      fact.providerPackImageProbe === true && fact.modelCredentialPresent === false &&
      fact.credentialEnvironmentAbsent === true && fact.cwdExact === true)).toBe(true);
    const sandboxExecutionChecks = Array.isArray(runtimeFacts?.sandboxExecutionChecks)
      ? runtimeFacts.sandboxExecutionChecks as Array<Record<string, unknown>>
      : [];
    expect(sandboxExecutionChecks.length).toBeGreaterThan(0);
    expect(sandboxExecutionChecks.some(check => check.runnerLaunch === true &&
      check.nativePreparationPurpose === "native_session_start")).toBe(true);
    expect(sandboxExecutionChecks.every(check => check.managedGitContextProbe !== true)).toBe(true);
    expect(sandboxExecutionChecks.some(check => check.runtimeMode === "native" &&
      check.runStatusRunning === true && check.nativeIssueIdPresent === true &&
      check.contextIssueExecutionRunMatches === true && check.managedGitContextProbe !== true)).toBe(true);
  }, 300_000);
  it("continues the real conversation after a metric tool result with its original immutable source receipt",async()=>{
    const binary=qualifiedOpenCodeBinary();
    if(!binary)throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_MANAGED_OPENCODE_E2E_DIAGNOSTICS","1");
    let query:BusinessMetricQuery|null=null,receivedMetricResult=false;
    let startupFacts:unknown=null;
    const result=await runManagedNativeConversationFrame({db,root,opencodeBinary:binary,
      configureHeartbeat:async context=>{
        await instanceSettingsService(db).updateExperimental({analytical_lineage_v8:true,business_metrics_v8:true,
          management_reviews_v8:true,management_chat_tools_v8:true,ai_use_cases_v7:true,governance_evidence_v7:true});
        if(!context.actor.userId)throw new Error("metric_fixture_current_human_missing");
        const policy=await aiGovernanceService(db).obligation(context.actor,context.companyId,analyticalPurpose());
        const owner=businessMetricService(db),created=await owner.create(context.companyId,context.actor,{
          key:"conversation-source-receipt",definition:{...metricDefinition(policy.id),ownerUserId:context.actor.userId}});
        await owner.publish(context.companyId,context.actor,created.metric.id,{expectedRevision:1,versionId:created.version.id});
        await issueService(db).create(context.companyId,{title:"Human metric population",status:"todo",
          createdByUserId:context.actor.userId,responsibleUserId:context.actor.userId,assigneeAgentId:context.agentId},db,undefined,
          {manualInputActor:context.actor,privacyActor:context.actor});
        query={metricId:created.metric.id,versionId:created.version.id,from:new Date(Date.now()-86400000).toISOString(),
          until:new Date(Date.now()+3600000).toISOString(),dimensions:[],maxRows:100};
        return {};
      },
      afterRunSettledBeforeTeardown:async facts=>{
        if(!facts.run||facts.run.status==="succeeded")return;
        const [finalization]=await db.select({phase:nativeRunFinalizations.phase,code:nativeRunFinalizations.failureCode,
          detail:nativeRunFinalizations.failureDetail}).from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId,facts.run.id));
        const events=await db.select({type:heartbeatRunEvents.eventType,payload:heartbeatRunEvents.payload})
          .from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId,facts.companyId),eq(heartbeatRunEvents.runId,facts.run.id)))
          .orderBy(heartbeatRunEvents.seq).limit(100);
        const results=await db.select({status:nativeRunResults.schemaStatus,code:nativeRunResults.rejectionCode,
          result:nativeRunResults.resultJson}).from(nativeRunResults).where(eq(nativeRunResults.runId,facts.run.id));
        const closedFacts=(value:unknown,depth=0):unknown=>{
          if(depth>3)return undefined;
          if(typeof value==="boolean"||typeof value==="number")return value;
          if(typeof value==="string")return /^[A-Za-z][A-Za-z0-9_.:-]{0,100}$/.test(value)?value:undefined;
          if(Array.isArray(value))return value.slice(0,10).map(part=>closedFacts(part,depth+1));
          if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).slice(0,30)
            .map(([key,part])=>[key,/id|hash|digest|text|body|token|secret|key|prompt|content|path|arg/i.test(key)?undefined:closedFacts(part,depth+1)]));
          return undefined;
        };
        startupFacts={finalization:closedFacts(finalization),events:events.map(event=>({type:event.type,payload:closedFacts(event.payload)})),
          results:results.map(value=>({status:value.status,code:value.code,result:closedFacts(value.result)}))};
      },
      providerReply:({body,callIndex})=>{
        if(!query)throw new Error("metric_fixture_query_missing");
        if(callIndex===1){
          const tools=Array.isArray(body.tools)?body.tools as Array<Record<string,unknown>>:[];
          const tool=tools.find(value=>typeof value.name==="string"&&value.name.endsWith("query_business_metric"));
          if(!tool)throw new Error("metric_fixture_original_tool_not_advertised");
          return {stop_reason:"tool_use",content:[{type:"tool_use",id:"toolu_native_metric",name:tool.name,input:query}]};
        }
        if(callIndex!==2)throw new Error("metric_fixture_unexpected_provider_retry");
        const messages=Array.isArray(body.messages)?body.messages as Array<Record<string,unknown>>:[];
        const blocks=messages.flatMap(message=>Array.isArray(message.content)?message.content as Array<Record<string,unknown>>:[]);
        const metric=blocks.find(block=>block.type==="tool_result"&&block.tool_use_id==="toolu_native_metric");
        if(!metric||metric.is_error===true)throw new Error("metric_fixture_original_result_missing");
        const content=typeof metric.content==="string"?metric.content:Array.isArray(metric.content)
          ?(metric.content as Array<Record<string,unknown>>).map(part=>typeof part.text==="string"?part.text:"").join(""):"";
        const value=JSON.parse(content);
        expect(value).toMatchObject({tool:"query_business_metric",result:{grade:"native_observation",
          observation:{metricId:query.metricId,versionId:query.versionId}}});
        receivedMetricResult=true;
        return undefined;
      }});
    expect(result.success,JSON.stringify({status:result.runStatus,errorCode:result.run?.errorCode,
      calls:result.providerCallCount,broker:result.brokerRequestFacts,stub:result.providerStubFailure,startupFacts,
      issuerCount:result.issuerFacts.length,executionStage:result.run?.executionStage,
      sourceProtocol:result.run?.nativeInputSourceProtocolVersion,nativeSessionPresent:Boolean(result.run?.nativeSessionId),
      processPidPresent:Boolean(result.run?.processPid),providerTools:result.providerToolNames,
      stderr:result.run?.stderrExcerpt?.slice(0,1600),stdout:result.run?.stdoutExcerpt?.slice(0,1000)})).toBe(true);
    expect(result.providerCallCount).toBe(2);
    expect(receivedMetricResult).toBe(true);
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.agentReply).toMatchObject({authorAgentId:result.run?.agentId,createdByRunId:result.run?.id});
    expect(result.nativeInputSourceReceipt).toMatchObject({additionalInputs:expect.arrayContaining([
      expect.objectContaining({inputs:expect.arrayContaining([
        expect.objectContaining({kind:"tool_result",toolName:"query_business_metric",invocationId:null}),
        expect.objectContaining({kind:"context"})])})])});
  },240_000);

  it("creates one private Project from a current conversation dispatch and carries its exact result into the next request",async()=>{
    const binary=qualifiedOpenCodeBinary();
    if(!binary)throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS","1");
    const callId="conversation-project-create-c0";
    const projectName="Conversation-created private Project";
    const workspaceName="Conversation local workspace";
    let providerConsumedResult=false;
    const projectRead:{current:{projectId:string;ownerStatus:number;foreignStatus:number}|null}={current:null};
    let runDiagnostics:Record<string,unknown>|null=null;
    const result=await runManagedNativeConversationFrame({db,root,opencodeBinary:binary,conversationWorkMode:"standard",
      providerReply:({body,callIndex})=>{
        if(callIndex===1){
          const tools=Array.isArray(body.tools)?body.tools as Array<Record<string,unknown>>:[];
          const tool=tools.find(value=>typeof value.name==="string"&&value.name.endsWith("create_project"));
          if(!tool)throw new Error("conversation_project_create_tool_not_advertised");
          return {stop_reason:"tool_use",content:[{type:"tool_use",id:callId,name:tool.name,input:{
            name:projectName,description:"Created from this authenticated conversation turn.",
            workspace:{name:workspaceName},idempotencyKey:"conversation-project-create-c0" }}]};
        }
        if(callIndex!==2)throw new Error("conversation_project_create_unexpected_provider_retry");
        const messages=Array.isArray(body.messages)?body.messages as Array<Record<string,unknown>>:[];
        const blocks=messages.flatMap(message=>Array.isArray(message.content)?message.content as Array<Record<string,unknown>>:[]);
        const output=blocks.find(block=>block.type==="tool_result"&&block.tool_use_id===callId);
        if(!output||output.is_error===true)throw new Error("conversation_project_create_result_not_delivered");
        const content=typeof output.content==="string"?output.content:Array.isArray(output.content)
          ?(output.content as Array<Record<string,unknown>>).map(part=>typeof part.text==="string"?part.text:"").join(""):"";
        const dto=JSON.parse(content) as Record<string,unknown>;
        expect(dto).toMatchObject({name:projectName,visibility:"private"});
        expect(dto.id).toEqual(expect.any(String));
        providerConsumedResult=true;
        return undefined;
      },
      afterRunSettledBeforeTeardown:async facts=>{
        if(!facts.run)return;
        const runEvents=await db.select({eventType:heartbeatRunEvents.eventType}).from(heartbeatRunEvents)
          .where(eq(heartbeatRunEvents.runId,facts.run.id)).orderBy(heartbeatRunEvents.seq);
        const matchingProjects=await db.select({id:projects.id}).from(projects).where(and(
          eq(projects.companyId,facts.companyId),eq(projects.name,projectName)));
        const failedProfile=facts.run.runnerProfileJson&&typeof facts.run.runnerProfileJson==="object"&&!Array.isArray(facts.run.runnerProfileJson)
          ?facts.run.runnerProfileJson as Record<string,unknown>:{};
        const failedWireIntents=Array.isArray(failedProfile.nativeAwModelWireIntents)?failedProfile.nativeAwModelWireIntents:[];
        const createIntent=failedWireIntents.map(value=>value&&typeof value==="object"&&!Array.isArray(value)
          ?value as Record<string,unknown>:{}).find(value=>Array.isArray(value.responseToolUses)&&
            (value.responseToolUses as Array<Record<string,unknown>>).some(use=>use.id===callId&&use.name?.toString().endsWith("create_project")));
        const consumedSet=createIntent?.consumedSourceSet&&typeof createIntent.consumedSourceSet==="object"&&
          !Array.isArray(createIntent.consumedSourceSet)?createIntent.consumedSourceSet as Record<string,unknown>:{};
        const consumedInputs=Array.isArray(consumedSet.inputs)?consumedSet.inputs:[];
        const sourceKinds=consumedInputs.map(value=>value&&typeof value==="object"&&!Array.isArray(value)
          ?(value as Record<string,unknown>).kind:null);
        const runError=typeof facts.run.error==="string"&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(facts.run.error)
          ?facts.run.error:null;
        runDiagnostics={status:facts.run.status,errorCode:facts.run.errorCode??null,
          errorToken:runError,
          sourceProtocol:facts.run.nativeInputSourceProtocolVersion??null,manifestHash:facts.manifest?.hash??null,
          sourceKinds,
          reservationStatus:facts.reservation?.status??null,eventTypes:runEvents.map(event=>event.eventType),
          matchingProjectCount:matchingProjects.length,
          relayAuthenticated:facts.sandboxRuntimeFacts?.relayAuthenticated??null,
          sandboxExecCount:facts.sandboxRuntimeFacts?.execCount??null,
          modelCredentialCount:facts.sandboxRuntimeFacts?.managedModelCredentialCount??null};
        if(facts.run.status!=="succeeded")return;
        const receipt=facts.nativeInputSourceReceipt as {additionalInputs?:Array<{inputs?:unknown[]}>}|null;
        const rows=Array.isArray(receipt?.additionalInputs)?receipt!.additionalInputs:[];
        const createdEntries=rows.filter(entry=>Array.isArray(entry.inputs)&&entry.inputs.some(value=>{
          const item=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
          return item.kind==="tool_result"&&item.toolName==="create_project"&&item.callId===callId&&item.invocationId===null;
        }));
        expect(createdEntries).toHaveLength(1);
        const createdInputs=createdEntries[0]!.inputs!.map(value=>value&&typeof value==="object"&&!Array.isArray(value)
          ?value as Record<string,unknown>:{});
        const projectSources=createdInputs.filter(value=>value.kind==="project");
        const workspaceSources=createdInputs.filter(value=>value.kind==="project_workspace");
        expect(projectSources).toHaveLength(1);
        expect(workspaceSources).toHaveLength(1);
        const projectId=String(projectSources[0]!.projectId);
        const [project]=await db.select().from(projects).where(and(eq(projects.companyId,facts.companyId),eq(projects.id,projectId)));
        const workspaces=await db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId,facts.companyId),eq(projectWorkspaces.projectId,projectId)));
        expect(project).toMatchObject({name:projectName,visibility:"private",privacyOwnerUserId:facts.actor.userId});
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]).toMatchObject({name:workspaceName,isPrimary:true});

        const [ownerSession]=await db.select({id:authSessions.id,userId:authSessions.userId,token:authSessions.token,
          expiresAt:authSessions.expiresAt}).from(authSessions).where(and(eq(authSessions.id,facts.actor.sessionId!),
          eq(authSessions.userId,facts.actor.userId!)));
        const foreignUserId=`conversation-project-foreign-${randomUUID()}`;
        const now=new Date();
        await db.insert(authUsers).values({id:foreignUserId,name:"Foreign Project reader",email:`${foreignUserId}@test.invalid`,
          emailVerified:true,createdAt:now,updatedAt:now});
        await db.insert(companyMemberships).values({companyId:facts.companyId,principalType:"user",principalId:foreignUserId,
          membershipRole:"member",status:"active"});
        const foreignSessionId=await seedNativePasskeySession(db,foreignUserId);
        const [foreignSession]=await db.select({id:authSessions.id,userId:authSessions.userId,token:authSessions.token,
          expiresAt:authSessions.expiresAt}).from(authSessions).where(and(eq(authSessions.id,foreignSessionId),
          sql`${authSessions.expiresAt}>now()`)).limit(1);
        if(!ownerSession||!foreignSession)throw new Error("conversation_project_human_sessions_missing");
        const app=express();app.use(express.json());
        app.use(actorMiddleware(db,{deploymentMode:"authenticated",resolveSession:async req=>{
          const token=(req.header("cookie")??"").split(";").map(value=>value.trim())
            .map(value=>value.slice(value.indexOf("=")+1)).map(decodeURIComponent).find(Boolean);
          if(!token)return null;
          const [session]=await db.select({id:authSessions.id,userId:authSessions.userId,expiresAt:authSessions.expiresAt})
            .from(authSessions).where(and(eq(authSessions.token,token),sql`${authSessions.expiresAt}>now()`)).limit(1);
          if(!session)return null;
          const [user]=await db.select({id:authUsers.id,name:authUsers.name,email:authUsers.email})
            .from(authUsers).where(eq(authUsers.id,session.userId)).limit(1);
          if(!user)return null;
          const value:BetterAuthSessionResult={session:{id:session.id,userId:session.userId,expiresAt:session.expiresAt},user};
          return value;
        }}));
        app.use("/api",projectRoutes(db));app.use(errorHandler);
        const ownerResponse=await request(app).get(`/api/projects/${projectId}`)
          .set("cookie",`session_token=${encodeURIComponent(ownerSession.token)}`);
        const foreignResponse=await request(app).get(`/api/projects/${projectId}`)
          .set("cookie",`session_token=${encodeURIComponent(foreignSession.token)}`);
        projectRead.current={projectId,ownerStatus:ownerResponse.status,foreignStatus:foreignResponse.status};
      }});
    expect(result.success,JSON.stringify({status:result.runStatus,errorCode:result.run?.errorCode,
      calls:result.providerCallCount,providerHookInvoked:result.providerHookInvoked,providerHookFailure:result.providerHookFailure,
      providerStubFailure:result.providerStubFailure,broker:result.brokerRequestFacts,issuerFacts:result.issuerFacts,
      sourceProtocol:result.run?.nativeInputSourceProtocolVersion,runDiagnostics,
      sandbox:result.sandboxRuntimeFacts&&{mode:result.sandboxRuntimeFacts.mode,relayAuthenticated:result.sandboxRuntimeFacts.relayAuthenticated,
        execCount:result.sandboxRuntimeFacts.execCount,exactPrivateCwdCount:result.sandboxRuntimeFacts.exactPrivateCwdCount,
        managedModelCredentialCount:result.sandboxRuntimeFacts.managedModelCredentialCount,
        executableNames:result.sandboxRuntimeFacts.executableNames}})).toBe(true);
    expect(result.providerCallCount).toBe(2);
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.foreignWriteDidNotMutate).toBe(true);
    expect(providerConsumedResult).toBe(true);
    expect(projectRead.current).toMatchObject({ownerStatus:200});
    expect(projectRead.current?.foreignStatus).toBeGreaterThanOrEqual(400);
    expect(result.nativeInputSourceReceipt).toMatchObject({additionalInputs:expect.arrayContaining([
      expect.objectContaining({inputs:expect.arrayContaining([
        expect.objectContaining({kind:"tool_result",toolName:"create_project",invocationId:null,callId}),
        expect.objectContaining({kind:"project"}),expect.objectContaining({kind:"project_workspace"})])})])});
  },240_000);

  it("creates a source-bound Task from an ordinary conversation model turn and carries the exact result into the next request",async()=>{
    const binary=qualifiedOpenCodeBinary();
    if(!binary)throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS","1");
    const callId="conversation-task-create-c0";
    const taskTitle="Conversation-created private Task";
    const taskPlan="# Execution plan\n\nImplement and verify the clarified outcome.";
    let providerConsumedResult=false;
    const taskResultFacts:{found:boolean;isError:boolean;contentPresent:boolean;jsonParsed:boolean;disposition:string|null;taskPresent:boolean;taskIdPresent:boolean;taskIsRoot:boolean;taskIsTodo:boolean}=
      {found:false,isError:false,contentPresent:false,jsonParsed:false,disposition:null,taskPresent:false,taskIdPresent:false,taskIsRoot:false,taskIsTodo:false};
    const taskRead:{current:{taskId:string;ownerStatus:number;foreignStatus:number}|null}={current:null};
    const result=await runManagedNativeConversationFrame({db,root,opencodeBinary:binary,conversationWorkMode:"standard",
      providerReply:({body,callIndex})=>{
        if(callIndex===1){
          const tools=Array.isArray(body.tools)?body.tools as Array<Record<string,unknown>>:[];
          const tool=tools.find(value=>typeof value.name==="string"&&value.name.endsWith("create_task"));
          if(!tool)throw new Error("conversation_task_create_tool_not_advertised");
          return {stop_reason:"tool_use",content:[{type:"tool_use",id:callId,name:tool.name,input:{
            title:taskTitle,description:"Created from this authenticated conversation turn.",
            initialPlan:taskPlan,
            idempotencyKey:"conversation-task-create-c0"}}]};
        }
        if(callIndex!==2)throw new Error("conversation_task_create_unexpected_provider_retry");
        const messages=Array.isArray(body.messages)?body.messages as Array<Record<string,unknown>>:[];
        const blocks=messages.flatMap(message=>Array.isArray(message.content)?message.content as Array<Record<string,unknown>>:[]);
        const output=blocks.find(block=>block.type==="tool_result"&&block.tool_use_id===callId);
        taskResultFacts.found=!!output;
        taskResultFacts.isError=output?.is_error===true;
        taskResultFacts.contentPresent=typeof output?.content==="string"||Array.isArray(output?.content);
        if(!output||output.is_error===true)throw new Error("conversation_task_create_result_not_delivered");
        const content=typeof output.content==="string"?output.content:Array.isArray(output.content)
          ?(output.content as Array<Record<string,unknown>>).map(part=>typeof part.text==="string"?part.text:"").join(""):"";
        const dto=JSON.parse(content) as Record<string,unknown>;
        taskResultFacts.jsonParsed=true;
        taskResultFacts.disposition=typeof dto.disposition==="string"?dto.disposition:null;
        const task=dto.task&&typeof dto.task==="object"&&!Array.isArray(dto.task)?dto.task as Record<string,unknown>:null;
        taskResultFacts.taskPresent=!!task;
        taskResultFacts.taskIdPresent=typeof task?.id==="string";
        taskResultFacts.taskIsRoot=task?.parentId===null;
        taskResultFacts.taskIsTodo=task?.status==="todo";
        expect(dto.disposition).toBe("applied");
        expect(task).toMatchObject({parentId:null,status:"todo"});
        expect(task?.id).toEqual(expect.any(String));
        providerConsumedResult=true;
        return undefined;
      },
      afterRunSettledBeforeTeardown:async facts=>{
        if(!facts.run)return;
        const diagnosticReceipt=facts.nativeInputSourceReceipt as {additionalInputs?:Array<{inputs?:unknown[]}>}|null;
        const diagnosticTaskSource=(diagnosticReceipt?.additionalInputs??[]).flatMap(entry=>entry.inputs??[])
          .map(value=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{})
          .find(value=>value.kind==="task"&&typeof value.issueId==="string");
        const diagnosticTaskId=typeof diagnosticTaskSource?.issueId==="string"?diagnosticTaskSource.issueId:null;
        const diagnosticStartedAt=facts.run.startedAt;
        if(!diagnosticStartedAt)throw new Error("conversation_task_run_start_time_missing");
        const failedRuns=await db.select({id:heartbeatRuns.id,nativeIssueId:heartbeatRuns.nativeIssueId,
          status:heartbeatRuns.status,errorCode:heartbeatRuns.errorCode,contextSnapshot:heartbeatRuns.contextSnapshot})
          .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,facts.companyId),eq(heartbeatRuns.agentId,facts.agentId),
            eq(heartbeatRuns.status,"failed"),gte(heartbeatRuns.startedAt,diagnosticStartedAt)));
        console.info("conversation_task_setup_failure_ownership",JSON.stringify({mainRunId:facts.run.id,
          mainRunStatus:facts.run.status,mainRunErrorCode:facts.run.errorCode,createdTaskId:diagnosticTaskId,
          failedRuns:failedRuns.map(run=>{
            const context=run.contextSnapshot&&typeof run.contextSnapshot==="object"&&!Array.isArray(run.contextSnapshot)
              ?run.contextSnapshot as Record<string,unknown>:{};
            return {runId:run.id,nativeIssueId:run.nativeIssueId,contextIssueId:typeof context.issueId==="string"?context.issueId:null,
              nativeIssueMatchesCreatedTask:!!diagnosticTaskId&&run.nativeIssueId===diagnosticTaskId,
              contextIssueMatchesCreatedTask:!!diagnosticTaskId&&context.issueId===diagnosticTaskId,
              status:run.status,errorCode:run.errorCode==="setup_failed"?"setup_failed":run.errorCode?"other":"none"};
          })}));
        const [failure]=await db.select({phase:nativeRunFinalizations.phase,attempt:nativeRunFinalizations.attempt,
          failureCode:nativeRunFinalizations.failureCode,failureDetail:nativeRunFinalizations.failureDetail})
          .from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId,facts.run.id)).limit(1);
        const detail=failure?.failureDetail&&typeof failure.failureDetail==="object"&&!Array.isArray(failure.failureDetail)
          ?failure.failureDetail as Record<string,unknown>:{};
        const safeFailureDetail=Object.fromEntries(["code","failureCode","phase","retryReasonCode","retryable"]
          .filter(key=>Object.hasOwn(detail,key)).map(key=>[key,typeof detail[key]==="string"
            ?(/^[a-z0-9_]{2,80}$/i.test(detail[key] as string)?detail[key]:"other"):detail[key]]));
        const runEvents=await db.select({eventType:heartbeatRunEvents.eventType,stream:heartbeatRunEvents.stream,
          level:heartbeatRunEvents.level,message:heartbeatRunEvents.message,payload:heartbeatRunEvents.payload})
          .from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,facts.run.id)).orderBy(heartbeatRunEvents.seq);
        const safeEvents=runEvents.map(event=>{
          const payload=event.payload&&typeof event.payload==="object"&&!Array.isArray(event.payload)
            ?event.payload as Record<string,unknown>:{};
          const safePayload=Object.fromEntries(["phase","failureCode","retryReasonCode","code","attempt","recoveryAction"]
            .filter(key=>Object.hasOwn(payload,key)).map(key=>[key,typeof payload[key]==="string"
              ?(/^[a-z0-9_]{2,80}$/i.test(payload[key] as string)?payload[key]:"other"):payload[key]]));
          const message=event.message??"";
          const messageClass=message.includes("transport interrupted")?"transport_interrupted"
            :message.includes("setup failed")?"setup_failed":message.includes("provider turn")?"provider_turn":message?"other":"none";
          return {eventType:event.eventType,stream:event.stream,level:event.level,messageClass,safePayload};
        });
        console.info("conversation_task_native_failure_phase",JSON.stringify({runId:facts.run.id,
          runStatus:facts.run.status,runErrorCode:facts.run.errorCode,finalizationPhase:failure?.phase??null,
          finalizationAttempt:failure?.attempt??null,finalizationFailureCode:failure?.failureCode??null,safeFailureDetail,
          events:safeEvents}));
        if(facts.run.status!=="succeeded")return;
        const receipt=facts.nativeInputSourceReceipt as {additionalInputs?:Array<{policy?:unknown;inputs?:unknown[]}>}|null;
        const rows=Array.isArray(receipt?.additionalInputs)?receipt!.additionalInputs:[];
        const entries=rows.filter(entry=>Array.isArray(entry.inputs)&&entry.inputs.some(value=>{
          const item=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
          return item.kind==="tool_result"&&item.toolName==="create_task"&&item.callId===callId&&item.invocationId===null;
        }));
        expect(entries).toHaveLength(1);
        const inputs=entries[0]!.inputs!.map(value=>value&&typeof value==="object"&&!Array.isArray(value)
          ?value as Record<string,unknown>:{});
        const taskSources=inputs.filter(value=>value.kind==="task");
        expect(taskSources).toHaveLength(1);
        const taskId=String(taskSources[0]!.issueId);
        expect(entries[0]!.policy).toMatchObject({issueIds:[taskId]});
        expect(inputs).toEqual(expect.arrayContaining([expect.objectContaining({kind:"tool_result",callId,toolName:"create_task",invocationId:null})]));
        const [created]=await db.select().from(issues).where(and(eq(issues.companyId,facts.companyId),eq(issues.id,taskId)));
        // The source result reports the Task's creation status, while the live
        // scheduler may move it to another operational status before this
        // post-run read. Its private owner and immutable source snapshot remain
        // the acceptance evidence here.
        expect(created).toMatchObject({title:taskTitle,parentId:null,responsibleUserId:facts.actor.userId,
          createdByAgentId:facts.agentId,payloadSourceProtocolVersion:1,payloadSourceSnapshotInvalidated:false});
        expect(created?.payloadSourceSnapshot).toMatchObject({owner:{kind:"issue",companyId:facts.companyId,id:taskId}});
        expect((await documentService(db).getIssueDocumentByKey(taskId,"plan"))?.body).toBe(taskPlan);
        const [ownerSession]=await db.select({id:authSessions.id,userId:authSessions.userId,token:authSessions.token})
          .from(authSessions).where(and(eq(authSessions.id,facts.actor.sessionId!),eq(authSessions.userId,facts.actor.userId!)));
        const foreignUserId=`conversation-task-foreign-${randomUUID()}`;
        const now=new Date();
        await db.insert(authUsers).values({id:foreignUserId,name:"Foreign Task reader",email:`${foreignUserId}@test.invalid`,
          emailVerified:true,createdAt:now,updatedAt:now});
        await db.insert(companyMemberships).values({companyId:facts.companyId,principalType:"user",principalId:foreignUserId,
          membershipRole:"member",status:"active"});
        const foreignSessionId=await seedNativePasskeySession(db,foreignUserId);
        const [foreignSession]=await db.select({id:authSessions.id,userId:authSessions.userId,token:authSessions.token})
          .from(authSessions).where(eq(authSessions.id,foreignSessionId)).limit(1);
        if(!ownerSession||!foreignSession)throw new Error("conversation_task_human_sessions_missing");
        const app=express();app.use(express.json());
        app.use(actorMiddleware(db,{deploymentMode:"authenticated",resolveSession:async req=>{
          const token=(req.header("cookie")??"").split(";").map(value=>value.trim())
            .map(value=>value.slice(value.indexOf("=")+1)).map(decodeURIComponent).find(Boolean);
          if(!token)return null;
          const [session]=await db.select({id:authSessions.id,userId:authSessions.userId,expiresAt:authSessions.expiresAt})
            .from(authSessions).where(and(eq(authSessions.token,token),sql`${authSessions.expiresAt}>now()`)).limit(1);
          if(!session)return null;
          const [user]=await db.select({id:authUsers.id,name:authUsers.name,email:authUsers.email})
            .from(authUsers).where(eq(authUsers.id,session.userId)).limit(1);
          if(!user)return null;
          const value:BetterAuthSessionResult={session:{id:session.id,userId:session.userId,expiresAt:session.expiresAt},user};
          return value;
        }}));
        app.use("/api",issueRoutes(db,{} as never));app.use(errorHandler);
        const ownerResponse=await request(app).get(`/api/issues/${taskId}`)
          .set("cookie",`session_token=${encodeURIComponent(ownerSession.token)}`);
        const foreignResponse=await request(app).get(`/api/issues/${taskId}`)
          .set("cookie",`session_token=${encodeURIComponent(foreignSession.token)}`);
        taskRead.current={taskId,ownerStatus:ownerResponse.status,foreignStatus:foreignResponse.status};
      }});
    expect(result.success,JSON.stringify({status:result.runStatus,errorCode:result.run?.errorCode,
      calls:result.providerCallCount,providerStubFailure:result.providerStubFailure,broker:result.brokerRequestFacts,
      sourceProtocol:result.run?.nativeInputSourceProtocolVersion,taskResultFacts,stdout:result.run?.stdoutExcerpt?.slice(0,800),
      stderr:result.run?.stderrExcerpt?.slice(0,1000)})).toBe(true);
    expect(result.providerCallCount).toBe(2);
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.foreignWriteDidNotMutate).toBe(true);
    expect(providerConsumedResult).toBe(true);
    expect(taskRead.current).toMatchObject({ownerStatus:200});
    expect(taskRead.current?.foreignStatus).toBeGreaterThanOrEqual(400);
  },240_000);

});
