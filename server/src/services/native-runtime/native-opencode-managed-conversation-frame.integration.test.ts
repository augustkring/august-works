import {and,desc,eq,gte,inArray,sql} from "drizzle-orm";
import {createHash,randomUUID} from "node:crypto";
import {agents,authSessions,authUsers,companyDeletionOperations,companyMemberships,companies,environmentLeases,heartbeatRunEvents,heartbeatRuns,issues,memoryJobs,nativeRunFinalizations,nativeRunResults,projectWorkspaces,projects,runtimeHostCommands,runtimeSandboxBindings} from "@paperclipai/db";
import { SANDBOX_HOST_COMMAND, type BusinessMetricQuery } from "@paperclipai/shared";
import {instanceSettingsService} from "../instance-settings.js";
import {businessMetricService} from "../business-metrics/service.js";
import {aiGovernanceService} from "../ai-governance/governance-service.js";
import {issueService} from "../issues.js";
import {documentService} from "../documents.js";
import {analyticalPurpose,metricDefinition} from "../../__tests__/helpers/business-metric-fixture.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { isRemoteAssetErasureErrorCode } from "./runtime-asset-erasure-errors.js";
import { validatePrpEvent } from "../../vendor/paperclip-runner/index.js";
import { memoryJobService } from "../memory/memory-jobs.js";
import * as modelReservationOwner from "../orchestration/model-reservations.js";
import { verifyNativeCleanupRuntimeState } from "../execution-sandbox/run-lease-cleanup.js";
import { agentIdentityService } from "../agent-identities.js";
import { enqueueCompanyManagedOpenCodeRuntimeErasure, readRemoteRuntimeAssetLocator,
  readRemoteNativeSessionStartBinding, remoteRuntimeAssetLocatorDigest } from "./runtime-asset-retention.js";
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
  let preserveFailure = false;
  let instanceId = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-native-conversation-frame-"));
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `conversation-frame-${Date.now()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    database = await startEmbeddedPostgresTestDatabase("managed-native-conversation-frame-",
      { preserveDataOnFailure: () => preserveFailure });
    db = createDb(database.connectionString);
  }, 60_000);
  afterEach(context => { if (context.task.result?.state === "fail") preserveFailure = true; });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root && preserveFailure) {
      await fs.writeFile(path.join(root, "native-c7-preserved-state.json"), JSON.stringify({
        dataDir: database.dataDir, root, instanceId,
      }, null, 2), { mode: 0o600 });
      console.info("native_c7_failure_state_preserved", JSON.stringify({ dataDir: database.dataDir, root }));
    } else if (root) { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
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
    const originalExpiryEvidence: { providerLeaseExpiresAt?: string; protectedReportExpiresAt?: number;
      finalLeaseExpiresAt?: string; finalLeaseRetired?: boolean } = {};
    let eraseRemoteNativeRuntimeAsset: Awaited<ReturnType<typeof configureManagedConversationSandboxHost>>["eraseRemoteNativeRuntimeAsset"] | null = null;
    const sandboxHostFacts: { read?: () => Record<string, unknown> } = {};
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const originalReservationFactory = modelReservationOwner.modelReservationService;
    const restoreWireMethods: Array<() => void> = [];
    const reservationFactorySpy = vi.spyOn(modelReservationOwner, "modelReservationService")
      .mockImplementation((reservationDb, reservationOptions) => {
        const service = originalReservationFactory(reservationDb, reservationOptions);
        const originalWireDispatch = service.recordWireDispatch;
        restoreWireMethods.push(() => { service.recordWireDispatch = originalWireDispatch; });
        service.recordWireDispatch = async (...args) => {
          try { return await originalWireDispatch.apply(service, args); }
          catch (error) {
            const staticSentinels = new Map([
              ["Only one current, undisclosed provider dispatch may record its wire receipt", "wire_reservation_not_current"],
              ["The original Native conversation principal and reservation are required", "wire_conversation_principal"],
              ["Native conversation authority changed before provider dispatch", "wire_conversation_authority_changed"],
              ["The original model reservation plan is required", "wire_plan_missing"],
              ["The original model reservation principal is required", "wire_principal_changed"],
              ["Model tariff or reservation scope changed before provider dispatch", "wire_tariff_or_scope_changed"],
              ["Managed model dispatch requires its exact provider call ID", "wire_call_id_missing"],
              ["Non-tool model dispatch cannot attach a provider tool call ID", "wire_call_id_forbidden"],
              ["The provider wire endpoint does not match the qualified reservation provider", "wire_endpoint"],
              ["The original model reservation changed before its wire receipt was retained", "wire_receipt_fenced"],
              ["No current Native conversation model price ceiling is qualified", "wire_tariff_unavailable"],
              ["Current qualified model price ceiling and bounded token envelope are required", "wire_tariff_or_bounds_invalid"],
            ]);
            const chain: Array<Record<string, unknown>> = [];
            let cause: unknown = error;
            for (let depth = 0; depth < 3 && cause && typeof cause === "object"; depth++) {
              const value = cause as Record<string, unknown>;
              const status = typeof value.status === "number" ? value.status : value.statusCode;
              const sourceFrames = typeof value.stack === "string" ? value.stack.split("\n").flatMap(frame => {
                const match = /(?:^|[/\\])(model-reservations|worker-model-gateway|v7-authorization|authorization|native-direct-input|memory-privacy)\.ts:(\d+):\d+\)?$/.exec(frame.trim());
                return match ? [{ source: `${match[1]}.ts`, line: Number(match[2]) }] : [];
              }).slice(0, 6) : [];
              chain.push({ sentinel: typeof value.message === "string" ? staticSentinels.get(value.message) ?? "unclassified" : "unclassified",
                errorClass: typeof value.name === "string" && ["Error", "HttpError", "PostgresError", "TypeError", "RangeError", "AbortError"].includes(value.name)
                  ? value.name : "Other",
                status: typeof status === "number" && status >= 400 && status <= 599 ? status : null,
                sqlState: typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code) ? value.code : null,
                sourceFrames,
              });
              cause = value.cause;
            }
            console.info("native_c7_original_wire_failure", JSON.stringify({ chain }));
            throw error;
          }
        };
        return service;
      });
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary, sandboxRelay: true, timeoutSec: 600,
      sandboxRelayDnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      configureHeartbeat: async context => {
        const host = await configureManagedConversationSandboxHost({ ...context, root, wallClockSeconds: 300 });
        eraseRemoteNativeRuntimeAsset = host.eraseRemoteNativeRuntimeAsset;
        sandboxHostFacts.read = host.facts;
        const modelRequest = host.modelRequest.bind(host);
        host.modelRequest = async (body, signal) => {
          try { return await modelRequest(body, signal); }
          catch (error) {
            const details = error && typeof error === "object" && "details" in error && error.details &&
              typeof error.details === "object" ? error.details as Record<string, unknown> : {};
            const stages = new Set(["provider_authority_recheck", "credential_lookup", "credential_recheck",
              "wire_authority_recheck", "wire_run_binding", "wire_receipt_binding", "wire_intent_budget",
              "wire_intent_write", "provider_transport", "reservation_settlement", "response_run_binding",
              "response_history_revalidation", "response_receipt_binding", "response_wire_intent_match",
              "response_result_identity", "response_source_union", "response_receipt_finalize",
              "response_capture_write", "post_response_recheck"]);
            const codes = new Set(["conversation_model_unsettled", "conversation_model_result_withheld",
              "worker_model_unsettled", "worker_model_result_withheld"]);
            console.info("native_c7_model_gateway_failure", JSON.stringify({
              code: typeof details.code === "string" && codes.has(details.code) ? details.code : "unknown",
              stage: typeof details.stage === "string" && stages.has(details.stage) ? details.stage : "unknown",
              sqlState: typeof details.sqlState === "string" && /^[0-9A-Z]{5}$/.test(details.sqlState)
                ? details.sqlState : null,
              constraint: typeof details.constraint === "string" && /^[A-Za-z0-9_]{1,96}$/.test(details.constraint)
                ? details.constraint : null,
            }));
            throw error;
          }
        };
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
        if (facts.run.status !== "succeeded") {
          preserveFailure = true;
          await fs.writeFile(path.join(root, "native-c7-failed-run-checkpoint.json"), JSON.stringify({
            dataDir: database.dataDir, root, instanceId, companyId: facts.companyId, agentId: facts.agentId,
            runId: facts.run.id, issueId: facts.issueId,
          }, null, 2), { mode: 0o600 });
          const leases = await db.select({ status: environmentLeases.status, expiresAt: environmentLeases.expiresAt,
            cleanupStatus: environmentLeases.cleanupStatus }).from(environmentLeases).where(and(
            eq(environmentLeases.companyId, facts.companyId), eq(environmentLeases.heartbeatRunId, facts.run.id)));
          const spans = await db.select({ eventType: heartbeatRunEvents.eventType, payload: heartbeatRunEvents.payload })
            .from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, facts.companyId),
              eq(heartbeatRunEvents.runId, facts.run.id))).orderBy(desc(heartbeatRunEvents.seq)).limit(24);
          const commands = await db.select({ status: runtimeHostCommands.status, errorCode: runtimeHostCommands.errorCode,
            createdAt: runtimeHostCommands.createdAt, completedAt: runtimeHostCommands.completedAt,
            deadlineAt: runtimeHostCommands.deadlineAt,
            purpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
          }).from(runtimeHostCommands).where(and(eq(runtimeHostCommands.companyId, facts.companyId),
            sql`${runtimeHostCommands.payload}->>'runId' = ${facts.run.id}`))
            .orderBy(desc(runtimeHostCommands.createdAt)).limit(8);
          const failureAt = facts.run.finishedAt?.getTime() ?? Date.now();
          const safeSpan = (value: unknown) => {
            const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
            return Object.fromEntries(["name", "stage", "durationMs", "elapsedMs", "totalMs", "budgetMs", "remainingMs"]
              .flatMap(key => typeof record[key] === "number" || typeof record[key] === "boolean" ||
                typeof record[key] === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(record[key] as string)
                ? [[key, record[key]]] : []));
          };
          console.info("native_c7_failed_run_facets", JSON.stringify({ status: facts.run.status,
            errorCode: facts.run.errorCode, nativePhase: facts.run.nativePhase,
            elapsedSinceRunStartMs: facts.run.startedAt ? failureAt - facts.run.startedAt.getTime() : null,
            providerCallCount: facts.providerCallCount, providerHookInvoked: facts.providerHookInvoked,
            leases: leases.map(lease => ({ status: lease.status, cleanupStatus: lease.cleanupStatus,
              originalExpiryMinusFailureMs: lease.expiresAt ? lease.expiresAt.getTime() - failureAt : null })),
            spans: spans.map(span => ({ eventType: span.eventType, facts: safeSpan(span.payload) })),
            commands: commands.map(command => ({ status: command.status, errorCode: command.errorCode,
              purpose: command.purpose, durationMs: command.completedAt ? command.completedAt.getTime() - command.createdAt.getTime() : null,
              originalDeadlineMinusFailureMs: command.deadlineAt.getTime() - failureAt })),
          }));
        }
        expect(facts.run.status).toBe("succeeded");
        expect(facts.providerCallCount).toBeGreaterThan(0);
        expect(facts.providerHookInvoked).toBe(true);
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
          const [finalization] = await db.select({ phase: nativeRunFinalizations.phase,
            leaseOwner: nativeRunFinalizations.leaseOwner, leaseExpiresAt: nativeRunFinalizations.leaseExpiresAt })
            .from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, facts.companyId),
              eq(nativeRunFinalizations.runId, facts.run.id))).limit(1);
          expect(finalization).toMatchObject({ phase: "committed", leaseOwner: null, leaseExpiresAt: null });
          await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: false, openshell_v7: false });
          expect(await instanceSettingsService(db).getExperimental()).toMatchObject({
            sandbox_abstraction_v7: false, openshell_v7: false,
          });
          const locator = await readRemoteRuntimeAssetLocator(db, durableRun);
          if (!locator) throw new Error("conversation_remote_native_asset_locator_missing");
          // Preserve the provider's original business-lease stamp. A canonical
          // stopped/released lease needs no synthetic expiry rewrite for cleanup.
          const [originalLease] = await db.select({ expiresAt: environmentLeases.expiresAt }).from(environmentLeases).where(and(
            eq(environmentLeases.companyId, facts.companyId), eq(environmentLeases.id, locator.environmentLeaseId),
            eq(environmentLeases.heartbeatRunId, facts.run.id))).limit(1);
          if (!(originalLease?.expiresAt instanceof Date) || !Number.isFinite(originalLease.expiresAt.getTime()))
            throw new Error("conversation_remote_erasure_original_provider_expiry_missing");
          originalExpiryEvidence.providerLeaseExpiresAt = originalLease.expiresAt.toISOString();
          expect(facts.sandboxRuntimeFacts?.providerAttestedLeaseExpiresAt)
            .toBe(originalExpiryEvidence.providerLeaseExpiresAt);
          const startBinding = await readRemoteNativeSessionStartBinding(db, locator);
          if (!startBinding) throw new Error("conversation_remote_erasure_signed_start_binding_missing");
          const [oldBinding] = await db.select({ capabilitySnapshot: runtimeSandboxBindings.capabilitySnapshot })
            .from(runtimeSandboxBindings).where(and(eq(runtimeSandboxBindings.companyId, facts.companyId),
              eq(runtimeSandboxBindings.id, startBinding.bindingId))).limit(1);
          const oldCapabilitySnapshot = oldBinding?.capabilitySnapshot && typeof oldBinding.capabilitySnapshot === "object" &&
            !Array.isArray(oldBinding.capabilitySnapshot)
            ? oldBinding.capabilitySnapshot as Record<string, unknown> : null;
          if (!oldCapabilitySnapshot) throw new Error("conversation_remote_erasure_old_capability_snapshot_missing");
          const originalReportExpiresAt = Date.parse(String(oldCapabilitySnapshot.expiresAt));
          expect(Number.isFinite(originalReportExpiresAt)).toBe(true);
          originalExpiryEvidence.protectedReportExpiresAt = originalReportExpiresAt;
          const [lease] = await db.select({ metadata: environmentLeases.metadata }).from(environmentLeases).where(and(
            eq(environmentLeases.companyId, facts.companyId), eq(environmentLeases.id, locator.environmentLeaseId))).limit(1);
          const remoteCwd = lease?.metadata && typeof lease.metadata.remoteCwd === "string" ? lease.metadata.remoteCwd : null;
          if (!remoteCwd) throw new Error("conversation_remote_native_asset_cwd_missing");
          const identityPath = path.join(remoteCwd, ".paperclip-runtime", "paperclip-runner", "sessions",
            locator.normalizedSessionIdDigest, "runner", "runner-process.identity");
          const statePath = path.join(remoteCwd, ".paperclip-runtime", "paperclip-runner", "sessions",
            locator.normalizedSessionIdDigest, "runner", "runner-state.json");
          const markerLines = (await fs.readFile(identityPath, "utf8")).trimEnd().split("\n");
          const initialRunnerStateBytes = await fs.readFile(statePath);
          const runnerState = JSON.parse(initialRunnerStateBytes.toString("utf8")) as Record<string, unknown>;
          console.info("managed remote process identity binding facts", {
            markerShapeValid: markerLines.length === 5,
            persistedPidMatchesMarker: durableRun.processPid === Number(markerLines[1]),
            persistedStartMatchesMarker: durableRun.processStartedAt?.toISOString() === markerLines[2],
            runIdentityMatchesMarker: durableRun.runnerInstanceId === markerLines[3] && locator.runnerInstanceId === markerLines[3],
            stateRunMatches: runnerState.runId === locator.runId,
            stateRunnerMatches: runnerState.runnerInstanceId === locator.runnerInstanceId,
            stateLeaseMatches: runnerState.environmentLeaseId === locator.environmentLeaseId,
            stateSessionMatches: typeof runnerState.normalizedSessionId === "string" &&
              createHash("sha256").update(runnerState.normalizedSessionId).digest("hex") === locator.normalizedSessionIdDigest,
          });
          const [leaseLifecycle] = await db.select({ status: environmentLeases.status,
            leasePolicy: environmentLeases.leasePolicy, releasedAt: environmentLeases.releasedAt,
            cleanupStatus: environmentLeases.cleanupStatus, expiresAt: environmentLeases.expiresAt,
            provider: environmentLeases.provider, providerLeaseId: environmentLeases.providerLeaseId })
            .from(environmentLeases).where(and(eq(environmentLeases.companyId, facts.companyId),
              eq(environmentLeases.id, locator.environmentLeaseId))).limit(1);
          console.info("managed remote erasure current lease lifecycle", {
            status: leaseLifecycle?.status ?? "missing", leasePolicy: leaseLifecycle?.leasePolicy ?? "missing",
            releasedAtPresent: leaseLifecycle?.releasedAt !== null && leaseLifecycle?.releasedAt !== undefined,
            cleanupStatus: leaseLifecycle?.cleanupStatus ?? "missing",
            expiresInMs: leaseLifecycle?.expiresAt ? leaseLifecycle.expiresAt.getTime() - Date.now() : null,
            remoteProvider: Boolean(leaseLifecycle?.provider && leaseLifecycle.provider !== "local"),
            providerLeaseIdPresent: Boolean(leaseLifecycle?.providerLeaseId),
          });
          const sessionsRoot = path.join(remoteCwd, ".paperclip-runtime", "paperclip-runner", "sessions");
          const siblingSessionRoot = path.join(sessionsRoot, "f".repeat(64));
          await fs.mkdir(siblingSessionRoot, { recursive: true });
          await fs.writeFile(path.join(siblingSessionRoot, "retained-neighbor.txt"), "neighbor remains");
          const operationId = randomUUID();
          const purgeActor = { ...facts.actor, companyIds: [...new Set([...(facts.actor.companyIds ?? []), facts.guestCompanyId])] };
          await agentIdentityService(db).rehome(purgeActor, facts.companyId, facts.identityId, facts.guestCompanyId);
          const [guestAgent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, facts.guestCompanyId)).limit(1);
          if (!guestAgent) throw new Error("conversation_remote_erasure_guest_agent_missing");
          await db.update(companies).set({ status: "archived" }).where(eq(companies.id, facts.companyId));
          await db.insert(companyDeletionOperations).values({ id: operationId, companyId: facts.companyId,
            requestedByUserId: facts.actor.userId ?? "managed-runtime-fixture", idempotencyKey: `remote-runtime-erasure-${operationId}`,
            status: "processing", stage: "purge", evidence: { runtimesErasedAt: new Date().toISOString() } });
          if (!durableRun.nativeSessionId) throw new Error("conversation_remote_native_asset_session_missing");
          const coOwnerRunId = randomUUID();
          await db.insert(heartbeatRuns).values({ id: coOwnerRunId, companyId: facts.companyId, agentId: facts.agentId,
            status: "succeeded", runtimeMode: "native", driverKind: "opencode_server",
            nativeSessionId: durableRun.nativeSessionId, runnerInstanceId: durableRun.runnerInstanceId, runnerProfileJson: {} });
          const foreignTenantRunId = randomUUID();
          await db.insert(heartbeatRuns).values({ id: foreignTenantRunId, companyId: facts.guestCompanyId, agentId: guestAgent.id,
            status: "succeeded", runtimeMode: "native", driverKind: "opencode_server",
            nativeSessionId: durableRun.nativeSessionId, runnerInstanceId: durableRun.runnerInstanceId, runnerProfileJson: {} });
          await enqueueCompanyManagedOpenCodeRuntimeErasure(db, facts.companyId, operationId);
          await db.update(memoryJobs).set({ submittedAt: new Date(Date.now() + 60_000) }).where(and(
            eq(memoryJobs.companyId, facts.companyId), eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${coOwnerRunId}`)));
          await memoryJobService(db, { eraseRemoteNativeRuntimeAsset }).tick({ limit: 1, companyId: facts.companyId });
          const [blockedJob] = await db.select({ id: memoryJobs.id, status: memoryJobs.status, errorCode: memoryJobs.errorCode,
            attemptNumber: memoryJobs.attemptNumber, resultJson: memoryJobs.resultJson }).from(memoryJobs).where(and(
            eq(memoryJobs.companyId, facts.companyId), eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${facts.run.id}`),
            eq(memoryJobs.attemptNumber, 1)))
            .limit(1);
          expect(blockedJob?.status).toBe("failed");
          expect(blockedJob?.errorCode).toBe("native_asset_erasure_retained_coowner");
          expect((blockedJob?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt).toBeUndefined();
          await expect(fs.stat(path.join(sessionsRoot, locator.normalizedSessionIdDigest))).resolves.toBeDefined();
          await db.delete(memoryJobs).where(and(eq(memoryJobs.companyId, facts.companyId),
            eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${coOwnerRunId}`)));
          await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, coOwnerRunId));
          const remainingSessionOwners = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId,
            status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode, driverKind: heartbeatRuns.driverKind })
            .from(heartbeatRuns).where(and(eq(heartbeatRuns.nativeSessionId, durableRun.nativeSessionId),
              eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.driverKind, "opencode_server")));
          console.log("managed remote erasure retained session owner facts", remainingSessionOwners.map(owner => ({
            currentRun: owner.id === facts.run!.id, sameCompany: owner.companyId === facts.companyId,
            status: owner.status, runtimeMode: owner.runtimeMode, driverKind: owner.driverKind,
          })));
          expect(remainingSessionOwners.some(owner => owner.id === foreignTenantRunId && owner.companyId === facts.guestCompanyId)).toBe(true);
          expect(remainingSessionOwners.some(owner => owner.id === facts.run!.id)).toBe(true);
          const jobKey = `runtime-asset-erasure:v1:${facts.run.id}`;
          const crashWorkerId = randomUUID();
          let signalReceiptCaptured!: () => void;
          const receiptCaptured = new Promise<void>(resolve => { signalReceiptCaptured = resolve; });
          let resumeLostWorker!: () => void;
          const resumeLostWorkerAfterRecovery = new Promise<void>(resolve => { resumeLostWorker = resolve; });
          const relatedErasureCommands = async () => (await db.select().from(runtimeHostCommands).where(and(
            eq(runtimeHostCommands.companyId, facts.companyId), eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
            sql`${runtimeHostCommands.payload}->>'action' = 'erase_native_session'`)))
            .filter(command => {
              const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
                ? command.payload as Record<string, unknown> : {};
              const erasure = payload.__stoppedNativeErasure && typeof payload.__stoppedNativeErasure === "object" &&
                !Array.isArray(payload.__stoppedNativeErasure)
                ? payload.__stoppedNativeErasure as Record<string, unknown> : {};
              return erasure.jobKey === jobKey;
            });
          const raceWorker = memoryJobService(db, { ownerId: crashWorkerId,
            eraseRemoteNativeRuntimeAsset: async (currentLocator, commandInput) => {
              const mismatchedLocator = { ...currentLocator, providerLeaseId: `${currentLocator.providerLeaseId}-changed` };
              await expect(eraseRemoteNativeRuntimeAsset!(mismatchedLocator, commandInput)).rejects.toBeDefined();
              await expect(eraseRemoteNativeRuntimeAsset!(currentLocator,
                { ...commandInput, companyPurgeOperationId: randomUUID() })).rejects.toBeDefined();
              await expect(eraseRemoteNativeRuntimeAsset!(currentLocator,
                { ...commandInput, jobId: randomUUID() })).rejects.toBeDefined();
              await expect(eraseRemoteNativeRuntimeAsset!(currentLocator,
                { ...commandInput, jobAttemptNumber: commandInput.jobAttemptNumber + 1 })).rejects.toBeDefined();
              await expect(eraseRemoteNativeRuntimeAsset!(currentLocator,
                { ...commandInput, executionOwnerId: randomUUID() })).rejects.toBeDefined();
              expect(await relatedErasureCommands()).toHaveLength(0);
              const possibleStartCommands = await db.select().from(runtimeHostCommands).where(and(
                eq(runtimeHostCommands.companyId, facts.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
                eq(runtimeHostCommands.status, "SUCCEEDED"),
                sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = 'native_session_start'`,
                sql`${runtimeHostCommands.payload}->>'runId' = ${currentLocator.runId}`,
                sql`${runtimeHostCommands.payload}->>'leaseId' = ${currentLocator.environmentLeaseId}`,
              ));
              const startClaim = possibleStartCommands.find(command => {
                const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
                  ? command.payload as Record<string, unknown> : {};
                const binding = payload.remoteNativeSessionStartBinding && typeof payload.remoteNativeSessionStartBinding === "object" &&
                  !Array.isArray(payload.remoteNativeSessionStartBinding)
                  ? payload.remoteNativeSessionStartBinding as Record<string, unknown> : {};
                return binding.locatorDigest === remoteRuntimeAssetLocatorDigest(currentLocator);
              });
              if (!startClaim || startClaim.safeResult?.exitCode !== 0 || startClaim.safeResult.timedOut !== false)
                throw new Error("conversation_remote_erasure_signed_start_claim_missing");
              const startPayload = startClaim.payload && typeof startClaim.payload === "object" && !Array.isArray(startClaim.payload)
                ? startClaim.payload as Record<string, unknown> : {};
              const startBinding = startPayload.remoteNativeSessionStartBinding &&
                typeof startPayload.remoteNativeSessionStartBinding === "object" &&
                !Array.isArray(startPayload.remoteNativeSessionStartBinding)
                ? startPayload.remoteNativeSessionStartBinding as Record<string, unknown> : {};
              const [sandboxBinding] = await db.select().from(runtimeSandboxBindings).where(and(
                eq(runtimeSandboxBindings.companyId, facts.companyId),
                eq(runtimeSandboxBindings.id, String(startBinding.bindingId)))).limit(1);
              if (!sandboxBinding || sandboxBinding.status !== "stopped")
                throw new Error("conversation_remote_erasure_canonical_stopped_binding_missing");
              const [originalLease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, currentLocator.environmentLeaseId));
              if (!originalLease?.metadata?.remoteExecutionTermination)
                throw new Error("conversation_remote_erasure_canonical_stop_receipt_missing");
              // DB stopped state alone is insufficient. Remove only its proof
              // reference temporarily; never renew the binding or business lease.
              const { remoteExecutionTermination: _physicalProof, ...withoutProof } = originalLease.metadata;
              await db.update(environmentLeases).set({ metadata: withoutProof }).where(eq(environmentLeases.id, originalLease.id));
              try {
                await expect(eraseRemoteNativeRuntimeAsset!(currentLocator, commandInput)).rejects.toBeDefined();
              } finally {
                await db.update(environmentLeases).set({ metadata: originalLease.metadata }).where(eq(environmentLeases.id, originalLease.id));
              }
              expect(await relatedErasureCommands()).toHaveLength(0);
              await db.update(runtimeHostCommands).set({ status: "FAILED" })
                .where(eq(runtimeHostCommands.id, startClaim.id));
              try {
                await expect(eraseRemoteNativeRuntimeAsset!(currentLocator, commandInput)).rejects.toMatchObject({
                  details: { code: "native_asset_erasure_target_unqualified" },
                });
              } finally {
                await db.update(runtimeHostCommands).set({ status: "SUCCEEDED" })
                  .where(eq(runtimeHostCommands.id, startClaim.id));
              }
              expect(await relatedErasureCommands()).toHaveLength(0);
              // This case selected a 300-second original boundary before
              // qualification. Never shorten or renew its admitted expiry here.
              // Let the originally admitted protected report expire naturally
              // after fail-closed generation checks. The successful cleanup
              // below must use only the original signed stopped-session cleanup authority.
              const reportExpiryWaitMs = originalReportExpiresAt - Date.now() + 1;
              if (reportExpiryWaitMs > 0) {
                if (reportExpiryWaitMs > 300_000) throw new Error("conversation_remote_erasure_report_ttl_exceeds_test_bound");
                await new Promise(resolve => setTimeout(resolve, reportExpiryWaitMs));
              }
              expect(Date.now()).toBeGreaterThan(originalReportExpiresAt);
              const [leaseAfterReportExpiry] = await db.select().from(environmentLeases).where(and(
                eq(environmentLeases.companyId, facts.companyId), eq(environmentLeases.id, locator.environmentLeaseId),
                eq(environmentLeases.heartbeatRunId, facts.run!.id))).limit(1);
              expect(["expired", "released"]).toContain(leaseAfterReportExpiry?.status);
              expect(leaseAfterReportExpiry?.releasedAt).toBeInstanceOf(Date);
              expect(leaseAfterReportExpiry?.cleanupStatus).toBe("success");
              expect(leaseAfterReportExpiry?.expiresAt?.getTime()).toBe(leaseLifecycle?.expiresAt?.getTime());
              expect(await verifyNativeCleanupRuntimeState(db, { companyId: facts.companyId,
                runId: facts.run!.id, leaseId: locator.environmentLeaseId },
                leaseAfterReportExpiry?.metadata?.remoteExecutionTermination)).not.toBeNull();
              const concurrent = await Promise.allSettled([
                eraseRemoteNativeRuntimeAsset!(currentLocator, commandInput),
                eraseRemoteNativeRuntimeAsset!(currentLocator, commandInput),
              ]);
              const rejectionFacts = concurrent.flatMap(result => result.status === "rejected" ? [result.reason] : [])
                .map(reason => {
                  const details = reason && typeof reason === "object" && "details" in reason &&
                    reason.details && typeof reason.details === "object" ? reason.details as Record<string, unknown> : {};
                  const frames = reason instanceof Error ? (reason.stack ?? "").split("\n").slice(1, 9)
                    .flatMap(line => {
                      const match = /^\s*at (?:(.*?) \()?(.+?):(\d+):\d+\)?$/.exec(line);
                      if (!match) return [];
                      const sourceFile = match[2]!.split(/[\\/]/).at(-1)!;
                      const row = Number(match[3]);
                      return /^[-\w.]+\.(?:ts|js|mjs|cjs)$/.test(sourceFile) && Number.isSafeInteger(row)
                        ? [`${sourceFile}:${row}`] : [];
                    }).slice(0, 6) : [];
                  const protocolFacts: Record<string, boolean | number | null> = {};
                  for (const key of ["upstreamStatus", "exitCode", "timedOut", "stdoutBytes", "stdoutLineCount",
                    "runIdMatches", "providerLeaseIdMatches", "pidMatches", "startedAtMatches", "stoppedAtValid",
                    "processIdentityDigestValid", "processStartFingerprintDigestValid"] as const) {
                    const value = details[key];
                    if (typeof value === "boolean" || typeof value === "number" || value === null) protocolFacts[key] = value;
                  }
                  return { name: reason instanceof Error ? reason.name : "non_error_throwable",
                    status: reason && typeof reason === "object" && "status" in reason &&
                      typeof reason.status === "number" ? reason.status : null,
                    code: isRemoteAssetErasureErrorCode(details.code) ? details.code : null,
                    protocolFacts,
                    failedChecks: Array.isArray(details.failedChecks)
                      ? details.failedChecks.filter((check): check is string => typeof check === "string" && [
                        "cell_current", "host_current", "binding_running", "manifest_current", "agent_present",
                        "signed_start_binding_current", "start_manifest_hash_matches", "start_policy_hash_matches",
                        "capability_snapshot_valid", "capability_unexpired", "image_matches", "host_agent_version",
                        "qualification_matches", "policy_unexpired", "execution_authorization_present", "policy_manifest_matches",
                        "policy_capability_matches", "policy_has_no_credentials",
                      ].includes(check)).sort() : [], frames };
                });
              // Admission facts are a pre-callback snapshot. Read the live owner at THIS rejection.
              let hostRuntime: Record<string, unknown> = {};
              let liveHostFactsReadSucceeded = false;
              try { hostRuntime = sandboxHostFacts.read?.() ?? {}; liveHostFactsReadSucceeded = Boolean(sandboxHostFacts.read); }
              catch { /* Diagnostics must not mask the original erasure rejection. */ }
              // These existing private arrays contain only boolean/count/closed-enum closure facts, no identities/paths.
              const liveClosureObservations = Array.isArray(hostRuntime.nativeSessionBackingObservations)
                ? hostRuntime.nativeSessionBackingObservations.filter((value): value is Record<string, unknown> => Boolean(value &&
                  typeof value === "object" && !Array.isArray(value) && value.processWitnessPresent === true)).slice(-4) : [];
              const liveHandleScanFailures = Array.isArray(hostRuntime.nativeSessionHandleScanFailures)
                ? hostRuntime.nativeSessionHandleScanFailures.slice(-8) : [];
              const erasureExecFacts = Array.isArray(hostRuntime.execFacts) ? hostRuntime.execFacts
                .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" &&
                  !Array.isArray(value) && value.nativePreparationPurpose === "native_provider_data_erasure"))
                .slice(-4).map(value => ({ exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
                  timedOut: value.timedOut === true, credentialEnvironmentAbsent: value.credentialEnvironmentAbsent === true,
                  assignedMcpEnvironmentAbsent: value.assignedMcpEnvironmentAbsent === true,
                  scriptFailureGuard: typeof value.erasureFailureGuard === "string" &&
                    /^(?:(?:target_arguments|target_directories|lock_acquire|state_files|state_binding|process_marker|process_stop|process_marker_absence|state_recheck|session_delete|post_delete_check|receipt)|process_stop\/(?:marker_wait|marker_present|marker_fields|process_observation|process_session|term_signal|term_wait|kill_signal|kill_wait|dead_process_classification|dead_process_state|process_group|marker_recheck|marker_remove)):[0-9]{1,3}$/.test(value.erasureFailureGuard)
                    ? value.erasureFailureGuard : null })) : [];
              const erasureExecutionFailures = Array.isArray(hostRuntime.sandboxExecutionFailures) ? hostRuntime.sandboxExecutionFailures
                .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" &&
                  !Array.isArray(value) && value.nativePreparationPurpose === "native_provider_data_erasure"))
                .slice(-4).map(value => ({ failureClass: typeof value.failureClass === "string" && /^[a-z][a-z0-9_:-]{0,99}$/.test(value.failureClass)
                  ? value.failureClass : "unclassified", claimStatus: typeof value.claimStatus === "string" &&
                    ["PENDING", "CLAIMED", "SUCCEEDED", "FAILED", "EXPIRED"].includes(value.claimStatus) ? value.claimStatus : null,
                  claimErrorCode: typeof value.claimErrorCode === "string" &&
                    ["remote_asset_erasure_unknown", "exec_capability_unavailable"].includes(value.claimErrorCode)
                    ? value.claimErrorCode : null,
                  requestAssociationSource: typeof value.requestAssociationSource === "string" &&
                    ["signed_relay_request", "persisted_command_claim", "pre_claim_error"].includes(value.requestAssociationSource)
                    ? value.requestAssociationSource : "unknown" })) : [];
              const receipts = concurrent.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
              if (!receipts.length) console.info("managed remote erasure dispatch rejection facts", JSON.stringify({
                rejectionFacts, erasureExecFacts, erasureExecutionFailures,
                liveHostFactsReadSucceeded, liveClosureObservations, liveHandleScanFailures,
              }));
              expect(receipts.length).toBeGreaterThan(0);
              expect(receipts.every(receipt => receipt.commandRequestId === receipts[0]!.commandRequestId)).toBe(true);
              const [durableErasure] = await db.select().from(runtimeHostCommands).where(and(
                eq(runtimeHostCommands.companyId, facts.companyId),
                eq(runtimeHostCommands.id, receipts[0]!.commandRequestId),
                eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
              )).limit(1);
              expect(durableErasure).toBeDefined();
              const privateClaim = durableErasure!.payload.__stoppedNativeErasure as Record<string, unknown>;
              const descriptor = durableErasure!.payload.nativeSessionErasure as Record<string, unknown>;
              expect(privateClaim).toMatchObject({ jobId: commandInput.jobId, jobKey: commandInput.jobKey,
                jobAttemptNumber: commandInput.jobAttemptNumber, executionOwnerId: commandInput.executionOwnerId,
                locatorDigest: remoteRuntimeAssetLocatorDigest(locator), companyPurgeOperationId: operationId });
              expect(durableErasure!.payload.requesterUserId).toBeUndefined();
              expect(durableErasure!.payload.cleanupAttestation).toBeUndefined();
              expect(durableErasure!.safeResult).toMatchObject({ action: "erase_native_session", erased: true,
                sessionDigest: locator.normalizedSessionIdDigest, startBindingDigest: descriptor.startBindingDigest,
                sandboxId: descriptor.sandboxId, containerId: descriptor.containerId,
                upperLayerAbsent: true, mergedViewAbsent: true, stoppedBefore: true, stoppedAfter: true });
              expect(receipts[0]!.stopProof).toMatchObject({ schema: "paperclip.native-sandbox-workload-stop.v1",
                runtimeOperationId: expect.any(String), receiptDigest: privateClaim.stopReceiptDigest,
                startBindingDigest: descriptor.startBindingDigest, sandboxId: descriptor.sandboxId,
                containerId: descriptor.containerId });
              const [checkpoint] = await db.select({ resultJson: memoryJobs.resultJson }).from(memoryJobs)
                .where(eq(memoryJobs.id, commandInput.jobId));
              expect(checkpoint?.resultJson?.remoteRuntimeAssetRemovalReceipt).toEqual(receipts[0]);
              await db.update(memoryJobs).set({ leaseExpiresAt: new Date(Date.now() - 1), updatedAt: new Date() })
                .where(and(eq(memoryJobs.id, commandInput.jobId), eq(memoryJobs.status, "running"),
                  eq(memoryJobs.executionOwnerId, crashWorkerId)));
              signalReceiptCaptured();
              // Model a worker that disappears after its durable receipt, then
              // resumes only after another worker has recovered the job.
              await resumeLostWorkerAfterRecovery;
              return receipts[0]!;
            } });
          const commandInputJobId = blockedJob!.id;
          const cleanupAttestationCommandFacts = async () => {
            const commands = await db.select({ status: runtimeHostCommands.status, errorCode: runtimeHostCommands.errorCode,
              deadlineAt: runtimeHostCommands.deadlineAt, payload: runtimeHostCommands.payload })
              .from(runtimeHostCommands).where(eq(runtimeHostCommands.companyId, facts.companyId));
            return commands.flatMap(command => {
              const request = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
                ? command.payload as Record<string, unknown> : {};
              const proof = request.cleanupAttestation && typeof request.cleanupAttestation === "object" &&
                !Array.isArray(request.cleanupAttestation) ? request.cleanupAttestation as Record<string, unknown> : {};
              if (proof.jobId !== commandInputJobId || !["capabilities", "probe"].includes(String(request.action))) return [];
              const probe = request.probe && typeof request.probe === "object" && !Array.isArray(request.probe)
                ? request.probe as Record<string, unknown> : {};
              return [{ action: request.action, probeCaseId: typeof probe.caseId === "string" && /^[a-z0-9_]{1,80}$/.test(probe.caseId)
                ? probe.caseId : null, status: command.status, errorCode: typeof command.errorCode === "string" &&
                /^[a-z0-9_:-]{1,100}$/.test(command.errorCode) ? command.errorCode : null,
                deadlineExpired: command.deadlineAt.getTime() <= Date.now() }];
            }).slice(-24);
          };
          let lostWorkerTick: Promise<void> | null = null;
          let lostWorkerReleased = false;
          const releaseLostWorker = () => {
            if (lostWorkerReleased) return;
            lostWorkerReleased = true;
            resumeLostWorker();
          };
          try {
            let lostWorkerOutcome: "settled" | "rejected" | null = null;
            lostWorkerTick = raceWorker.tick({ now: new Date(Date.now() + 61_000), limit: 1, companyId: facts.companyId })
              .then(() => { lostWorkerOutcome = "settled" as const; }, () => { lostWorkerOutcome = "rejected" as const; });
              // This race starts before the callback's natural report-expiry
              // wait. Include its bounded 300s remainder, the cleanup authority's
              // 60s aggregate freshness deadline, the final erase command's
              // separate 60s deadline, and 10s for durable receipt/job writes.
              // These fixture bounds do not change the production deadlines.
              const cleanupReceiptWaitBudgetMs = 430_000;
            let cleanupReceiptTimeout: ReturnType<typeof setTimeout> | undefined;
            const receiptOrCompletion = await Promise.race([
              receiptCaptured.then(() => "receipt" as const),
              lostWorkerTick.then(() => "worker_completed" as const),
              new Promise<"timeout">(resolve => {
                cleanupReceiptTimeout = setTimeout(() => resolve("timeout"), cleanupReceiptWaitBudgetMs);
              }),
            ]);
            if (cleanupReceiptTimeout) clearTimeout(cleanupReceiptTimeout);
            if (receiptOrCompletion !== "receipt") {
              const [failedJob] = await db.select({ status: memoryJobs.status, errorCode: memoryJobs.errorCode,
                error: memoryJobs.error, executionOwnerId: memoryJobs.executionOwnerId,
                attemptNumber: memoryJobs.attemptNumber, resultJson: memoryJobs.resultJson })
                .from(memoryJobs).where(eq(memoryJobs.id, blockedJob!.id));
              console.log("managed remote erasure pre-receipt failure", {
                outcome: receiptOrCompletion,
                workerOutcome: lostWorkerOutcome,
                job: failedJob ?? null,
                cleanupAttestationCommands: await cleanupAttestationCommandFacts(),
                commandReceipts: (await relatedErasureCommands()).map(command => ({ requestId: command.idempotencyKey,
                  status: command.status, errorCode: command.errorCode,
                  purpose: command.payload.nativePreparationPurpose ?? null, attempt: command.attempt })).slice(0, 8),
              });
            }
            expect(receiptOrCompletion).toBe("receipt");
            const [crashedJob] = await db.select().from(memoryJobs).where(eq(memoryJobs.id, blockedJob!.id));
            console.log("managed remote erasure crash-window outcome", {
              jobId: crashedJob?.id ?? null,
              status: crashedJob?.status ?? null,
              errorCode: crashedJob?.errorCode ?? null,
              error: crashedJob?.error ?? null,
              executionOwnerIdPresent: Boolean(crashedJob?.executionOwnerId),
              attemptNumber: crashedJob?.attemptNumber ?? null,
              commandReceipts: (await relatedErasureCommands()).map(command => ({
                requestId: command.idempotencyKey,
                status: command.status,
                errorCode: command.errorCode,
                purpose: command.payload.nativePreparationPurpose ?? null,
                attempt: command.attempt,
              })).slice(0, 8),
            });
            expect(crashedJob).toMatchObject({ status: "running", executionOwnerId: crashWorkerId });
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
            // The canonical tick drains company-scoped queued work in submitted
            // order. Keep ticking boundedly until the recovered attempt is the
            // one claimed, rather than assuming it is the only queued job.
            for (let retryTick = 0; retryTick < 32; retryTick++) {
              const [currentRetry] = await db.select({ status: memoryJobs.status }).from(memoryJobs)
                .where(eq(memoryJobs.id, retryQueued!.id));
              if (currentRetry?.status === "succeeded") break;
              expect(currentRetry?.status).toBe("queued");
              const tickResult = await recoveryWorker.tick({ limit: 1, companyId: facts.companyId });
              if (tickResult.processed === 0) break;
            }
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
                  schema: "paperclip.native-sandbox-workload-stop.v1", runtimeOperationId: expect.any(String),
                  receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }) });
            expect((job?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt)
              .toMatchObject({ commandRequestId: beforeRecoveryCommands[0]?.id });
            const hostFactsAfterErasure = sandboxHostFacts.read?.();
            const backingTransfers = Array.isArray(hostFactsAfterErasure?.nativeSessionBackingTransfers)
              ? hostFactsAfterErasure.nativeSessionBackingTransfers as Array<Record<string, unknown>> : [];
            const backingObservations = Array.isArray(hostFactsAfterErasure?.nativeSessionBackingObservations)
              ? hostFactsAfterErasure.nativeSessionBackingObservations as Array<Record<string, unknown>> : [];
            const erasureFacts = backingObservations.filter(fact => typeof fact.exactReply === "boolean");
            const closureFacts = backingObservations.filter(fact => fact.processWitnessPresent === true);
            expect(hostFactsAfterErasure?.nativeRunnerClosureWitness).toMatchObject({
              present: true, phase: "gone_verified", launchMatched: true, nonceMatches: true, runnerMatches: true,
              identityMatched: true, runPidStartedAtMatched: true, identityVerdict: "gone", processGone: true,
              previousLiveGroupKnown: true, previousLiveSessionKnown: true, processGroupLive: 0,
              processSessionLive: 0, fdOrCwdSessionsHolders: 0, fdOrCwdScanComplete: true,
              noSessionHandles: true, stopCheckerExit: 3, stopReceiptMatched: true,
            });
            expect(closureFacts.length).toBeGreaterThan(0);
            for (const closureFact of closureFacts) expect(closureFact).toMatchObject({
              processWitnessPresent: true, processWitnessPhase: "gone_verified", launchMatched: true,
              nonceMatches: true, runnerMatches: true, identityMatched: true, runPidStartedAtMatched: true,
              identityVerdict: "gone", processGone: true, previousLiveGroupKnown: true,
              previousLiveSessionKnown: true, processGroupLive: 0, processSessionLive: 0,
              fdOrCwdSessionsHolders: 0, fdOrCwdScanComplete: true, noSessionHandles: true,
              stopReceiptMatched: true, noActiveHostExecStreams: true, closureWitnessComplete: true,
            });
            expect(backingTransfers).toHaveLength(1);
            expect(backingTransfers[0]).toMatchObject({ sessionDigest: locator.normalizedSessionIdDigest,
              taskRootMatches: true, rootIdentityWitnessed: true, witnessMatched: true });
            expect(Number(backingTransfers[0]?.fileCount)).toBeGreaterThan(0);
            expect(Number(backingTransfers[0]?.byteCount)).toBeGreaterThan(0);
            expect(erasureFacts.length).toBeGreaterThan(0);
            for (const erasureFact of erasureFacts) expect(erasureFact).toMatchObject({ exactReply: true,
              targetAbsent: true, logicalTargetAbsent: true, neighborPresent: true,
              actualRunnerFilesBacked: true, runnerStateFilePresent: true, runnerIdentityFilePresent: true,
              backingWitnessMatches: true,
              originalContainerArchiveRoot200: true,
              originalContainerArchiveTarget404: true, helperContainersRemoved: true });
            expect(erasureFacts.some(erasureFact => erasureFact.backingMoved === true)).toBe(true);
            expect(erasureFacts.every(erasureFact => erasureFact.backingMoved === true ||
              erasureFact.replayAliasExact === true)).toBe(true);
            releaseLostWorker();
            await lostWorkerTick;
            const [staleAttempt] = await db.select({ status: memoryJobs.status, errorCode: memoryJobs.errorCode,
              error: memoryJobs.error, resultJson: memoryJobs.resultJson }).from(memoryJobs)
              .where(eq(memoryJobs.id, blockedJob!.id));
            expect(staleAttempt).toMatchObject({ status: "failed", errorCode: "worker_lost" });
            expect((staleAttempt?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt)
              .toMatchObject({ commandRequestId: beforeRecoveryCommands[0]?.id });
            expect(await relatedErasureCommands()).toHaveLength(1);
            await expect(fs.stat(path.join(sessionsRoot, locator.normalizedSessionIdDigest))).rejects.toMatchObject({ code: "ENOENT" });
            await expect(fs.readFile(path.join(siblingSessionRoot, "retained-neighbor.txt"), "utf8")).resolves.toBe("neighbor remains");
            const [finalLease] = await db.select({ expiresAt: environmentLeases.expiresAt,
              status: environmentLeases.status, releasedAt: environmentLeases.releasedAt,
              cleanupStatus: environmentLeases.cleanupStatus }).from(environmentLeases).where(and(
                eq(environmentLeases.companyId, facts.companyId), eq(environmentLeases.id, locator.environmentLeaseId),
                eq(environmentLeases.heartbeatRunId, facts.run!.id))).limit(1);
            originalExpiryEvidence.finalLeaseExpiresAt = finalLease?.expiresAt?.toISOString();
            originalExpiryEvidence.finalLeaseRetired = Boolean(finalLease &&
              ["released", "expired", "retained"].includes(finalLease.status) &&
              finalLease.releasedAt !== null && finalLease.cleanupStatus === "success");
            expect(originalExpiryEvidence.finalLeaseRetired).toBe(true);
            expect(originalExpiryEvidence.finalLeaseExpiresAt).toBe(originalExpiryEvidence.providerLeaseExpiresAt);
          } finally {
            // Do not let a timed-out fake worker continue its signed relay into
            // the next integration case. Its exact host-command deadlines bound
            // the drain after the crash-window gate is released.
            releaseLostWorker();
            if (lostWorkerTick) await lostWorkerTick;
          }
        }
      } }).finally(() => {
        for (const restore of restoreWireMethods) restore();
        reservationFactorySpy.mockRestore();
      });
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
    // A completed conversation turn leaves no active execution pointer. The
    // authenticated-route case above asserts the same post-turn state.
    expect(result.conversationIssue).toMatchObject({ status: "in_review", conversationState: "waiting",
      executionRunId: null });
    expect(result.sandboxRuntimeFacts).toMatchObject({ mode: "controlled_signed_host_relay", relayAuthenticated: true });
    const runtimeFacts = result.sandboxRuntimeFacts as Record<string, unknown> | null;
    const providerExpiry = Date.parse(String(runtimeFacts?.providerAttestedLeaseExpiresAt));
    const reportExpiry = originalExpiryEvidence.protectedReportExpiresAt;
    const boundedRemainingMs = (value: number | undefined) => typeof value === "number" && Number.isFinite(value)
      ? Math.max(-3_600_000, Math.min(3_600_000, value - Date.now())) : null;
    console.info("managed remote erasure expiry-domain facts", {
      providerExpiryRecorded: Number.isFinite(providerExpiry),
      providerStampMatchesOriginal: runtimeFacts?.providerAttestedLeaseExpiresAt === originalExpiryEvidence.providerLeaseExpiresAt,
      finalLeaseExpiryMatchesOriginal: originalExpiryEvidence.finalLeaseExpiresAt === originalExpiryEvidence.providerLeaseExpiresAt,
      finalLeaseRetired: originalExpiryEvidence.finalLeaseRetired === true,
      originalProtectedReportExpired: typeof reportExpiry === "number" && Number.isFinite(reportExpiry) && reportExpiry < Date.now(),
      originalProviderRemainingMs: boundedRemainingMs(providerExpiry),
      originalReportRemainingMs: boundedRemainingMs(reportExpiry),
    });
    expect(typeof runtimeFacts?.providerAttestedLeaseExpiresAt).toBe("string");
    expect(Number.isFinite(providerExpiry)).toBe(true);
    expect(runtimeFacts?.providerAttestedLeaseExpiresAt).toBe(originalExpiryEvidence.providerLeaseExpiresAt);
    expect(originalExpiryEvidence.finalLeaseExpiresAt).toBe(originalExpiryEvidence.providerLeaseExpiresAt);
    expect(originalExpiryEvidence.finalLeaseRetired).toBe(true);
    // The original protected report expires naturally; the provider's separate
    // 600s lease remains unchanged and is already closed by the canonical Stop.
    expect(typeof reportExpiry).toBe("number");
    expect(reportExpiry).toBeLessThan(Date.now());
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
  }, 900_000);
  it("continues the real conversation after a metric tool result with its original immutable source receipt",async()=>{
    const binary=qualifiedOpenCodeBinary();
    if(!binary)throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_MANAGED_OPENCODE_E2E_DIAGNOSTICS","1");
    let query:BusinessMetricQuery|null=null,receivedMetricResult=false;
    let startupFacts:unknown=null;
    const result=await runManagedNativeConversationFrame({db,root,opencodeBinary:binary,
      prepareNativeRuntimeContext:async context=>{
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
