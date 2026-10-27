import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {eq,sql} from "../../server/node_modules/drizzle-orm/index.js";
import {createDb,memoryRecords,analyticalContextRoots,analyticalContextDependencies,contextManifestMemoryRoots,contextManifests,heartbeatRuns,heartbeatRunEvents,issues,nativeRunFinalizations,nativeRunResults,workspaceOperations,businessMetricObservations,businessMetricVersions} from "../../packages/db/src/index.ts";
import {nativeRunInputSourceReceiptSchema} from "../../packages/shared/src/validators/native-payload-source-snapshot.ts";
import {analyticalPurpose,metricDefinition} from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { expect, test, type Page } from "@playwright/test";

import { createLocalAgentJwt } from "../../server/src/agent-auth-jwt";

import { idle, json, send, setup } from "./agent-chat.shared";

test.use({ trace: "retain-on-failure" });
test.setTimeout(120_000);

/**
 * Agent chat session lifecycle coverage: first-open semantics, the feature
 * flag, Stop + queued /new resets, and sidebar discovery. Shared fixtures
 * live in ./agent-chat.shared.ts; project, attachment, and history flows run
 * in agent-chat-projects.spec.ts.
 */
test("built chat initializes after service worker takeover and reload with a slow CPU", async ({
  page,
  context,
  request,
}) => {
  const f = await setup(request, page);
  request = f.request;
  try {
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.goto(f.route);
      await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
      // The failed CI traces stopped before React evaluated, while a service
      // worker forwarded the Vite module graph. Keep this test on shipped assets
      // and cover both first takeover and subsequent controlled navigations.
      const scripts = await page.locator('script[type="module"][src]').evaluateAll(
        (elements) => elements.map((element) => element.getAttribute("src")),
      );
      expect(scripts.length).toBeGreaterThan(0);
      expect(scripts.every((src) => src?.startsWith("/assets/"))).toBe(true);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      for (let reload = 0; reload < 3; reload += 1) {
        await page.reload();
        await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
        expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      }
      expect(await json(await request.get(f.chatPath))).toBeNull();
    } finally {
      await cdp.detach();
    }
  } finally {
    await f.restore();
  }
});

test("chat first open is read-only; concurrent first sends and retries share one task", async ({
  page,
  context,
  request,
}) => {
  const f = await setup(request, page);
  request = f.request;
  try {
    await page.goto(f.route);
    await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
    expect(await json(await request.get(f.chatPath))).toBeNull();
    expect(
      await json(
        await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
      ),
    ).toHaveLength(0);
    const other = await context.newPage();
    await other.goto(f.route);
    const waitForInitialComment = (target: Page) => target.waitForResponse((response) =>
      response.request().method() === "POST" &&
      /\/api\/issues\/[^/]+\/comments$/.test(new URL(response.url()).pathname),
      { timeout: 15_000 },
    );
    const initialCommentResponses = [waitForInitialComment(page), waitForInitialComment(other)];
    await Promise.all([send(page, "Same first message"), send(other, "Same first message")]);
    const initialCommentOutcomes = await Promise.all([
      ...initialCommentResponses,
    ].map((response) => response.then(
      (result) => ({ status: result.status() }),
      (error) => ({ waitError: error instanceof Error ? error.name : "unknown" }),
    )));
    expect(initialCommentOutcomes).toEqual([{ status: 201 }, { status: 201 }]);
    // The second tab only exists to race the initial POST. Close it once both
    // responses are captured so its application polling cannot add background
    // load while the two Native runs finish.
    await other.close();
    const issue = await idle(request, f.chatPath, 2).catch(async (error) => {
      // Temporary, content-free capture of the canonical run/checkpoint facts
      // when concurrent first sends expose a rejected retained-session source.
      const config = JSON.parse(await readFile(process.env.PAPERCLIP_E2E_SERVER_CONFIG!, "utf8"));
      const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
      const db = createDb(`postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`);
      try {
        const chatResponse = await request.get(f.chatPath);
        const failedIssueId = chatResponse.ok() ? (await chatResponse.json()).id : null;
        const [sourceOwner] = failedIssueId ? await db.select({
          companyId: issues.companyId,
          version: issues.payloadSourceProtocolVersion,
          snapshot: issues.payloadSourceSnapshot,
          invalidated: issues.payloadSourceSnapshotInvalidated,
        }).from(issues).where(eq(issues.id, failedIssueId)) : [];
        const sourceSnapshot = sourceOwner?.snapshot && typeof sourceOwner.snapshot === "object"
          ? sourceOwner.snapshot as Record<string, any> : {};
        const sourcePolicy = sourceSnapshot.policy && typeof sourceSnapshot.policy === "object"
          ? sourceSnapshot.policy as Record<string, unknown> : {};
        const inputKinds = ["task", "project", "project_workspace", "memory", "foundation_revision", "comment",
          "interaction", "document_revision", "attachment", "context", "skill_version", "runtime_skill",
          "playbook_revision", "role_pack_version", "authored_definition", "runtime_instructions", "retained_run",
          "retained_workspace", "tool_result", "completion_contract", "native_task_wake", "workspace_metadata",
          "worker_model_dispatch", "conversation_model_dispatch"] as const;
        const inputCounts = Object.fromEntries(inputKinds.map(kind => [kind, 0])) as Record<typeof inputKinds[number], number>;
        let invalidInputCount = 0;
        for (const input of Array.isArray(sourceSnapshot.inputs) ? sourceSnapshot.inputs : []) {
          const kind = input && typeof input === "object" && !Array.isArray(input)
            ? (input as Record<string, unknown>).kind : null;
          if (typeof kind === "string" && Object.hasOwn(inputCounts, kind)) inputCounts[kind as keyof typeof inputCounts] += 1;
          else invalidInputCount += 1;
        }
        const sourceSnapshotShape = {
          version: sourceOwner?.version ?? null,
          invalidated: sourceOwner?.invalidated ?? null,
          ownerKind: typeof sourceSnapshot.owner?.kind === "string" && ["issue", "project", "memory_record", "comment", "document_revision", "attachment"].includes(sourceSnapshot.owner.kind)
            ? sourceSnapshot.owner.kind : null,
          ownerCompanyMatches: sourceSnapshot.owner?.companyId === (sourceOwner?.companyId ?? null),
          ownerTaskMatches: sourceSnapshot.owner?.id === failedIssueId,
          inputCounts,
          invalidInputCount,
          policyCounts: {
            issueIds: Array.isArray(sourcePolicy.issueIds) ? sourcePolicy.issueIds.length : null,
            projectIds: Array.isArray(sourcePolicy.projectIds) ? sourcePolicy.projectIds.length : null,
            runIds: Array.isArray(sourcePolicy.runIds) ? sourcePolicy.runIds.length : null,
            memoryIds: Array.isArray(sourcePolicy.memoryIds) ? sourcePolicy.memoryIds.length : null,
            foundationRevisionIds: Array.isArray(sourcePolicy.foundationRevisionIds) ? sourcePolicy.foundationRevisionIds.length : null,
          },
        };
        const rows = failedIssueId
          ? await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.nativeIssueId, failedIssueId))
          : [];
        const sanitized = rows.map((run) => {
          const profile = typeof run.runnerProfileJson === "object" && run.runnerProfileJson !== null
            ? run.runnerProfileJson as Record<string, any> : {};
          const context = typeof run.contextSnapshot === "object" && run.contextSnapshot !== null
            ? run.contextSnapshot as Record<string, any> : {};
          const checkpoint = profile.sessionCheckpoint && typeof profile.sessionCheckpoint === "object"
            ? profile.sessionCheckpoint as Record<string, any> : null;
          const identity = checkpoint?.identity && typeof checkpoint.identity === "object"
            ? checkpoint.identity as Record<string, any> : {};
          const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
          const intents = Array.isArray(profile.nativeModelInputDispatchIntents)
            ? profile.nativeModelInputDispatchIntents as Array<Record<string, any>> : [];
          const dispatches = receipt.success ? receipt.data.dispatches : [];
          const associations = Array.isArray(profile.nativeToolCallDispatchAssociations)
            ? profile.nativeToolCallDispatchAssociations : [];
          const resultCaptures = Array.isArray(profile.nativeToolResultSourceCaptures)
            ? profile.nativeToolResultSourceCaptures : [];
          const wireIntents = Array.isArray(profile.nativeAwModelWireIntents)
            ? profile.nativeAwModelWireIntents : [];
          const execution = profile.nativeExecutionInput && typeof profile.nativeExecutionInput === "object"
            ? profile.nativeExecutionInput as Record<string, any> : {};
          const binding = execution.binding && typeof execution.binding === "object"
            ? execution.binding as Record<string, any> : {};
          const prior = rows.filter((candidate) => candidate.id !== run.id &&
            candidate.nativeSessionId === run.nativeSessionId && candidate.createdAt < run.createdAt)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
          return {
            runId: run.id,
            nativeSessionId: run.nativeSessionId,
            runnerProcessPid: run.processPid,
            createdAt: run.createdAt.toISOString(),
            startedAt: run.startedAt?.toISOString() ?? null,
            finishedAt: run.finishedAt?.toISOString() ?? null,
            status: run.status,
            runtimeMode: run.runtimeMode,
            sourceProtocolVersion: run.nativeInputSourceProtocolVersion,
            responsibleUserPresent: Boolean(run.responsibleUserId),
            generation: Number.isSafeInteger(context.conversationSessionGeneration)
              ? context.conversationSessionGeneration : null,
            nativeSessionPresent: Boolean(run.nativeSessionId),
            priorSameSessionStatus: prior?.status ?? null,
            priorSameSessionResponsibleUserMatches: prior ? prior.responsibleUserId === run.responsibleUserId : null,
            priorSameSessionGenerationMatches: prior
              ? (prior.contextSnapshot as Record<string, any> | null)?.conversationSessionGeneration === context.conversationSessionGeneration
              : null,
            checkpointPresent: Boolean(checkpoint),
            checkpointSessionPresent: typeof checkpoint?.sessionId === "string",
            checkpointIdentityMatches: {
              run: identity.runId === run.id,
              company: identity.companyId === run.companyId,
              issue: identity.issueId === run.nativeIssueId,
              agent: identity.agentId === run.agentId,
              session: identity.sessionId === run.nativeSessionId,
            },
            toolContractFingerprintPresent: typeof profile.nativeToolContractFingerprint === "string",
            executionBindingMatches: binding.runId === run.id && binding.companyId === run.companyId &&
              binding.issueId === run.nativeIssueId && binding.agentId === run.agentId &&
              execution.session?.normalizedSessionId === run.nativeSessionId,
            receiptValid: receipt.success,
            receiptBindingMatches: receipt.success && receipt.data.binding.runId === run.id &&
              receipt.data.binding.companyId === run.companyId && receipt.data.binding.issueId === run.nativeIssueId &&
              receipt.data.binding.agentId === run.agentId && receipt.data.binding.responsibleUserId === run.responsibleUserId,
            intentCount: intents.length,
            dispatchCount: dispatches.length,
            intentDispatchCountsMatch: intents.length === dispatches.length,
            associationCount: associations.length,
            resultCaptureCount: resultCaptures.length,
            wireIntentCount: wireIntents.length,
          };
        });
        const lifecycleFacts = await Promise.all(rows.map(async (run) => {
          const [current] = await db.select({
            status: heartbeatRuns.status,
            nativePhase: heartbeatRuns.nativePhase,
            errorCode: heartbeatRuns.errorCode,
            executionStage: heartbeatRuns.executionStage,
            lastOutputSeq: heartbeatRuns.lastOutputSeq,
          }).from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
          const [finalization] = await db.select({
            phase: nativeRunFinalizations.phase,
            failureCode: nativeRunFinalizations.failureCode,
            resultPresent: nativeRunFinalizations.resultId,
          }).from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, run.id));
          const results = await db.select({ schemaStatus: nativeRunResults.schemaStatus,
            rejectionCode: nativeRunResults.rejectionCode }).from(nativeRunResults)
            .where(eq(nativeRunResults.runId, run.id));
          const events = await db.select({ eventType: heartbeatRunEvents.eventType,
            sourceSeq: heartbeatRunEvents.sourceSeq, createdAt: heartbeatRunEvents.createdAt })
            .from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, run.id))
            .orderBy(heartbeatRunEvents.seq);
          const operations = await db.select({ phase: workspaceOperations.phase,
            status: workspaceOperations.status }).from(workspaceOperations)
            .where(eq(workspaceOperations.heartbeatRunId, run.id));
          const eventCounts: Record<string, number> = {};
          for (const event of events) eventCounts[event.eventType] = (eventCounts[event.eventType] ?? 0) + 1;
          return {
            status: current?.status ?? null,
            nativePhase: current?.nativePhase ?? null,
            errorCode: current?.errorCode ?? null,
            executionStage: current?.executionStage ?? null,
            lastOutputSeq: current?.lastOutputSeq ?? null,
            finalization: finalization ? {
              phase: finalization.phase,
              failureCode: finalization.failureCode,
              resultPresent: Boolean(finalization.resultPresent),
            } : null,
            results: results.map(({ schemaStatus, rejectionCode }) => ({ schemaStatus, rejectionCode })),
            eventCounts,
            eventTimes: events.map(({ eventType, sourceSeq, createdAt }) => ({
              eventType,
              sourceSeq,
              createdAt: createdAt.toISOString(),
            })),
            workspaceOperations: operations.map(({ phase, status }) => ({ phase, status })),
          };
        }));
        const waitGroups = await db.execute<{
          waitEventType: string | null;
          waitEvent: string | null;
          state: string;
          count: number;
        }>(sql`select wait_event_type as "waitEventType", wait_event as "waitEvent", state, count(*)::int as count
          from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
          group by wait_event_type, wait_event, state`);
        const [blocked] = await db.execute<{ count: number }>(sql`select count(*)::int as count
          from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
          and cardinality(pg_blocking_pids(pid)) > 0`);
        const blockingRows = await db.execute<{
          waiterPid: number;
          blockerPid: number;
          waiterState: string;
          waiterWaitEventType: string | null;
          waiterWaitEvent: string | null;
          blockerState: string;
          blockerWaitEventType: string | null;
          blockerWaitEvent: string | null;
          lockType: string;
          waiterMode: string;
          blockerMode: string | null;
          classId: string | null;
          objectId: string | null;
          objectSubId: number | null;
          relationName: string | null;
          waiterXactAgeMs: number | null;
          blockerXactAgeMs: number | null;
          waiterQueryAgeMs: number | null;
          blockerQueryAgeMs: number | null;
          waiterQuery: string;
          blockerQuery: string;
        }>(sql`select w.pid as "waiterPid", b.pid as "blockerPid", w.state as "waiterState",
          w.wait_event_type as "waiterWaitEventType", w.wait_event as "waiterWaitEvent",
          b.state as "blockerState", b.wait_event_type as "blockerWaitEventType", b.wait_event as "blockerWaitEvent",
          wl.locktype as "lockType", wl.mode as "waiterMode", bl.mode as "blockerMode",
          wl.classid::text as "classId", wl.objid::text as "objectId", wl.objsubid as "objectSubId",
          c.relname as "relationName",
          (extract(epoch from clock_timestamp()-w.xact_start)*1000)::bigint as "waiterXactAgeMs",
          (extract(epoch from clock_timestamp()-b.xact_start)*1000)::bigint as "blockerXactAgeMs",
          (extract(epoch from clock_timestamp()-w.query_start)*1000)::bigint as "waiterQueryAgeMs",
          (extract(epoch from clock_timestamp()-b.query_start)*1000)::bigint as "blockerQueryAgeMs",
          w.query as "waiterQuery", b.query as "blockerQuery"
          from pg_stat_activity w
          join pg_locks wl on wl.pid=w.pid and not wl.granted
          cross join lateral unnest(pg_blocking_pids(w.pid)) as blocked_pid(pid)
          join pg_stat_activity b on b.pid=blocked_pid.pid
          left join pg_locks bl on bl.pid=b.pid and bl.granted and bl.locktype=wl.locktype
            and bl.database is not distinct from wl.database
            and bl.relation is not distinct from wl.relation
            and bl.page is not distinct from wl.page
            and bl.tuple is not distinct from wl.tuple
            and bl.virtualxid is not distinct from wl.virtualxid
            and bl.transactionid is not distinct from wl.transactionid
            and bl.classid is not distinct from wl.classid
            and bl.objid is not distinct from wl.objid
            and bl.objsubid is not distinct from wl.objsubid
          left join pg_class c on c.oid=wl.relation
          where w.datname=current_database() and w.pid<>pg_backend_pid()
          order by w.xact_start nulls last, w.pid limit 32`).catch(() => []);
        const queryClass = (query: string) => ({
          command: /^\s*(select|insert|update|delete|with|commit|rollback|begin|set|call)\b/i.exec(query)?.[1]?.toLowerCase() ?? "other",
          lockFunction: /\bpg_advisory_xact_lock\s*\(/i.test(query) ? "pg_advisory_xact_lock" : null,
          table: /\b(?:from|join|update|into|delete\s+from)\s+(?:"?[a-z_][\w$]*"?\.)?"?([a-z_][\w$]*)"?/i.exec(query)?.[1] ?? null,
        });
        const pgBlockingEdges = blockingRows.map(({ waiterQuery, blockerQuery, ...row }) => ({
          ...row,
          waiterQueryClass: queryClass(waiterQuery),
          blockerQueryClass: queryClass(blockerQuery),
        }));
        const advisoryOwnerCandidates = [
          { owner: "issue-privacy-tree", key: `issue-privacy-tree:${f.company.id}` },
          { owner: "business-event-privacy", key: `business-events:${f.company.id}` },
          { owner: "memory-privacy", key: `memory:privacy:${f.company.id}` },
          ...(failedIssueId ? [{ owner: "native-completion-contract", key: `paperclip:native-completion-contract:${f.company.id}:${failedIssueId}` }] : []),
        ];
        const candidateValues = sql.join(advisoryOwnerCandidates.map(candidate =>
          sql`(${candidate.owner}, ${candidate.key})`,
        ), sql`, `);
        const hashedCandidates = await db.execute<{
          owner: string;
          lockHash: string;
        }>(sql`with candidates(owner, lock_key) as (values ${candidateValues})
          select owner, hashtextextended(lock_key, 0)::text as "lockHash" from candidates`);
        const advisoryKeyMatches = new Set<string>();
        for (const candidate of hashedCandidates) {
          const hash = BigInt(candidate.lockHash);
          const classId = Number(BigInt.asUintN(32, hash >> 32n)).toString();
          const objectId = Number(BigInt.asUintN(32, hash)).toString();
          if (blockingRows.some(row => row.classId === classId && row.objectId === objectId && row.objectSubId === 1))
            advisoryKeyMatches.add(candidate.owner);
        }
        const pgWaitFacts = {
          groups: waitGroups.map(({ waitEventType, waitEvent, state, count }) => ({
            waitEventType, waitEvent, state, count,
          })),
          blockedBackendCount: blocked?.count ?? 0,
          blockingEdges: pgBlockingEdges,
          matchedAdvisoryOwners: [...advisoryKeyMatches],
        };
        let providerTraceFacts: Record<string, unknown> = {
          eventCount: 0,
          turnCompletionCount: 0,
          providerProcessCount: 0,
          providerProcessesAlive: 0,
          providerRuns: [],
        };
        try {
          const tracePath = path.join(process.env.PAPERCLIP_AGENT_CHAT_OUTPUT_DIR!, "native-chat-provider-events.ndjson");
          const trace = (await readFile(tracePath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
          const providerPids = [...new Set(trace.filter(event => Number.isInteger(event.processId))
            .map(event => event.processId as number))];
          const providerRuns = providerPids.map(processId => {
            const events = trace.filter(event => event.processId === processId);
            const parentProcessId = events.find(event => Number.isInteger(event.parentProcessId))?.parentProcessId ?? null;
            const matchedRuns = sanitized.filter(run => run.runnerProcessPid === parentProcessId).map(run => ({
              runId: run.runId,
              nativeSessionId: run.nativeSessionId,
              status: run.status,
            }));
            return {
              processId,
              parentProcessId,
              matchedRuns,
              turnStartCount: events.filter(event => event.event === "turn_start").length,
              finalItemCount: events.filter(event => event.event === "final_item_emitted").length,
              turnCompletionCount: events.filter(event => event.event === "turn_completed_emitted").length,
              alive: (() => { try { process.kill(processId, 0); return true; } catch { return false; } })(),
            };
          });
          providerTraceFacts = {
            eventCount: trace.length,
            turnCompletionCount: trace.filter(event => event.event === "turn_completed_emitted").length,
            providerProcessCount: providerPids.length,
            providerProcessesAlive: providerRuns.filter(run => run.alive).length,
            providerRuns,
          };
        } catch { /* Failure-only diagnostics must not mask the test failure. */ }
        console.info("native-resume-witness-facts", JSON.stringify({ issueAvailable: Boolean(failedIssueId), sourceSnapshotShape, rows: sanitized, lifecycleFacts, providerTraceFacts, pgWaitFacts }));
      } finally {
        await db.$client.end();
      }
      throw error;
    });
    const initialComments = await json(await request.get(`/api/issues/${issue.id}/comments`));
    expect(initialComments.filter((comment: any) => !comment.authorAgentId && comment.body === "Same first message")).toHaveLength(2);
    const resolved = await Promise.all(
      Array.from({ length: 4 }, () =>
        request.post(f.chatPath, { data: {} }).then(json),
      ),
    );
    expect(new Set(resolved.map((row) => row.id))).toEqual(new Set([issue.id]));
    const body = {
      body: "Retry once",
      clientRequestId: "00000000-0000-4000-8000-000000000001",
    };
    const replies = await Promise.all([
      request
        .post(`/api/issues/${issue.id}/comments`, { data: body })
        .then(json),
      request
        .post(`/api/issues/${issue.id}/comments`, { data: body })
        .then(json),
    ]);
    expect(replies[0].id).toBe(replies[1].id);
    await idle(request, f.chatPath, 3);
    await page.reload();
    await expect(
      page.getByText("Reply generation 0: Retry once", { exact: true }),
    ).toBeVisible();
    expect(
      await json(await request.get(`/api/companies/${f.company.id}/issues`)),
    ).toHaveLength(0);
    const dashboard = await json(
      await request.get(`/api/companies/${f.company.id}/dashboard`),
    );
    expect(dashboard.tasks).toEqual({
      open: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
    });
    const count = (
      await json(
        await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
      )
    ).length;
    const settledRuns = await json(
      await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
    );
    const settledRunDetails = await Promise.all(
      settledRuns.map((run: { id: string }) =>
        request.get(`/api/heartbeat-runs/${run.id}`).then(json),
      ),
    );
    // A buffered provider log callback may arrive after its Native result is
    // terminal. It must not rewrite that settled result as a failed run or
    // prevent the idempotent follow-up send from creating its own run.
    expect(settledRunDetails.length).toBeGreaterThan(0);
    expect(settledRunDetails.every((run: { status: string }) => run.status === "succeeded")).toBe(true);
    await page.goto(`/${f.company.issuePrefix}/issues/${issue.identifier}`);
    await page.goto(f.route);
    expect(
      await json(
        await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
      ),
    ).toHaveLength(count);
  } finally {
    await f.restore();
  }
});

// UI response-contract fixture; original source erasure and fresh native SDK
// admission are separately exercised against PostgreSQL, without this routing.
test("source loss refreshes the read-only chat identity and drops cached history before another send", async ({ page, request }) => {
  const f = await setup(request, page);
  request = f.request;
  try {
    const original = await json(await request.post(f.chatPath, { data: {} }));
    await json(await request.post(`/api/issues/${original.id}/comments`, { data: { body: "Private history before source loss", clientRequestId: "00000000-0000-4000-8000-000000000099" } }));
    await idle(request, f.chatPath, 1);
    await page.goto(f.route);
    await expect(page.getByText("Private history before source loss", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("source-retained-history.png"), fullPage: true });
    let sourceLost = false, refreshed = 0, creations = 0;
    await page.route(`**${f.chatPath}`, async route => {
      if (route.request().method() === "POST") creations++;
      if (sourceLost && route.request().method() === "GET") {
        refreshed++;
        return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
      }
      await route.continue();
    });
    await page.route(`**/api/issues/${original.id}/comments*`, async route => {
      sourceLost = true;
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Analytical conversation source access is unavailable", details: { code: "analytical_source_access_lost" } }) });
    });
    await page.reload();
    await expect.poll(() => refreshed).toBeGreaterThan(0);
    await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
    await expect(page.getByText("Private history before source loss", { exact: true })).toHaveCount(0);
    expect(creations).toBe(0);
    await page.screenshot({ path: test.info().outputPath("source-loss-fresh-draft.png"), fullPage: true });
  } finally { await f.restore(); }
});

// Actual native source, authorization, recovery API and UI. The historical
// private retention root is seeded in the isolated DB; this browser case does
// not claim an external LLM or SDK analytical tool invocation.
// Live denial is an explicit UI response-contract fixture. Recipient admission
// and source/IAM changes are independently exercised over real WS + PostgreSQL.
test("live source denial removes cached chat history without a reload or implicit replacement", async ({page,request}) => {
  const f=await setup(request, page);
  request = f.request;
  try{
    const original=await json(await request.post(f.chatPath,{data:{}}));
    await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private cached history before live source denial",clientRequestId:randomUUID()}}));await idle(request,f.chatPath,1);
    const deliveries:Array<(message:string)=>void>=[];
    await page.routeWebSocket("**/api/companies/*/events/ws",socket=>{
      const server=socket.connectToServer();server.onMessage(message=>socket.send(message));deliveries.push(message=>socket.send(message));
    });
    await page.goto(f.route);await expect(page.getByText("Private cached history before live source denial",{exact:true})).toBeVisible();await expect.poll(()=>deliveries.length).toBeGreaterThan(0);
    await page.screenshot({path:test.info().outputPath("live-source-admitted-history.png"),fullPage:true});
    let creations=0;
    const failure={error:"Analytical conversation source access is unavailable",details:{code:"analytical_source_access_lost",conversationIssueId:original.id}};
    await page.route(`**${f.chatPath}`,route=>{if(route.request().method()==="POST")creations++;return route.fulfill({status:403,json:failure});});
    await page.route(`**/api/issues/${original.id}/comments*`,route=>route.fulfill({status:403,json:failure}));
    for(const deliver of deliveries)deliver(JSON.stringify({id:900001,companyId:f.company.id,type:"analytical.context.access_lost",createdAt:new Date().toISOString(),payload:{issueId:original.id,runId:null,code:"analytical_source_access_lost"}}));
    await expect(page.getByText("Private cached history before live source denial",{exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();expect(creations).toBe(0);
    await page.screenshot({path:test.info().outputPath("live-source-hidden-history.png"),fullPage:true});
  }finally{await f.restore();}
});

test("an owner can explicitly recover after source visibility is lost while original metric facts survive", async ({page,request}) => {
  const f=await setup(request, page);
  request = f.request;
  const config=JSON.parse(await readFile(process.env.PAPERCLIP_E2E_SERVER_CONFIG!,"utf8")),pid=await readFile(path.join(config.database.embeddedPostgresDataDir,"postmaster.pid"),"utf8");
  const db=createDb(`postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`);
  try{
    await json(await request.patch("/api/instance/settings/experimental",{data:{analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true,ai_use_cases_v7:true,governance_evidence_v7:true}}));
    const original=await json(await request.post(f.chatPath,{data:{}}));
    await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private analytical history before source visibility changes",clientRequestId:randomUUID()}}));
    await idle(request,f.chatPath,1);
    const priorRuns=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`));
    const priorRunIds=new Set(priorRuns.map((run:any)=>run.id));
    const source=await json(await request.post(`/api/companies/${f.company.id}/issues`,{data:{title:"Canonical metric population for chat retention",status:"done"}}));
    const policy=await json(await request.post(`/api/companies/${f.company.id}/governance-obligations`,{data:analyticalPurpose()}));
    const session=await json(await request.get("/api/auth/get-session"));
    const definition=metricDefinition(policy.id);definition.ownerUserId=session.user.id;
    const metric=await json(await request.post(`/api/companies/${f.company.id}/business-metrics`,{data:{key:"browser_source_recovery",definition}}));
    await json(await request.post(`/api/companies/${f.company.id}/business-metrics/${metric.metric.id}/publish`,{data:{expectedRevision:1,versionId:metric.version.id}}));
    const now=new Date(),command={action:"metric",metricId:metric.metric.id,versionId:metric.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:new Date(now.getTime()+1000).toISOString()};
    const firstMessage=`fixture:${Buffer.from(JSON.stringify(command)).toString("base64url")}`;
    await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:firstMessage,clientRequestId:randomUUID()}}));
    await idle(request,f.chatPath,2);
    await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
    await expect(page.getByText(firstMessage,{exact:true})).toBeVisible();
    const runs=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`)),run=runs.find((r:any)=>!priorRunIds.has(r.id)&&r.contextSnapshot?.issueId===original.id);expect(run).toBeTruthy();
    const [observation]=await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.metricId,metric.metric.id));expect(observation).toBeTruthy();
    const [runRow]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,run.id));expect(runRow).toBeTruthy();
    const retention=await db.select().from(memoryRecords).where(eq(memoryRecords.createdByActorId,"native_analytical_retention")).then(rows=>rows.find(row=>row.companyId===f.company.id&&row.ownerAgentId===f.agent.id));expect(retention).toBeTruthy();
    const currentHumanConversation=await request.get(f.chatPath);expect(currentHumanConversation.status()).toBe(200);
    expect((await currentHumanConversation.json()).id).toBe(original.id);
    const currentHumanHistory=await json(await request.get(`/api/issues/${original.id}/comments`));
    expect(currentHumanHistory.some((comment:any)=>comment.body===firstMessage)).toBe(true);
    expect(runRow!.responsibleUserId).toBe(session.user.id);
    const profile=runRow!.runnerProfileJson as Record<string,any>,captures=Array.isArray(profile.nativeToolResultSourceCaptures)?profile.nativeToolResultSourceCaptures as Array<Record<string,any>>:[];
    const metricCaptures=captures.filter(capture=>capture.tool==="query_business_metric"&&capture.nativeReadResult===true&&capture.sourceSet&&capture.sourceSet.inputs);
    expect(metricCaptures).toHaveLength(1);
    const metricCapture=metricCaptures[0]!,metricSource=metricCapture.source as Record<string,any>,metricSourceSet=metricCapture.sourceSet as {policy:unknown;inputs:Array<Record<string,any>>};
    const turnId=metricCapture.turnId,dispatchIntents=Array.isArray(profile.nativeModelInputDispatchIntents)?profile.nativeModelInputDispatchIntents as Array<Record<string,any>>:[];
    const dispatchAssociations=Array.isArray(profile.nativeToolCallDispatchAssociations)?profile.nativeToolCallDispatchAssociations as Array<Record<string,any>>:[];
    const receipt=profile.nativeInputSourceReceipt as {additionalInputs?:Array<{responsibleUserId:string;policy:unknown;inputs:Array<Record<string,any>>}>}|undefined;
    const parsedReceipt=nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
    const receiptBinding=parsedReceipt.success?parsedReceipt.data.binding:null;
    const matchingAssociations=dispatchAssociations.filter(row=>row.callId===metricCapture.callId&&row.turnId===turnId&&row.tool==="query_business_metric"&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt);
    const exactReceiptInputs=(receipt?.additionalInputs??[]).filter(entry=>entry.responsibleUserId===runRow!.responsibleUserId&&JSON.stringify(entry.policy)===JSON.stringify(metricSourceSet.policy)&&
      Array.isArray(entry.inputs)&&metricSource!==null&&entry.inputs.length===metricSourceSet.inputs.length+1&&
      JSON.stringify(entry.inputs[0])===JSON.stringify(metricSource)&&JSON.stringify(entry.inputs.slice(1))===JSON.stringify(metricSourceSet.inputs));
    expect({turnIdPresent:typeof turnId==="string",matchingDispatchIntentCount:dispatchIntents.filter(row=>row.turnId===turnId&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt).length,
      nativeInputDispatchPresent:Boolean(metricCapture.nativeInputDispatch),matchingDispatchAssociationCount:matchingAssociations.length,sourcePresent:metricSource!==null,
      inputSourceProtocolVersion:runRow!.nativeInputSourceProtocolVersion,
      receiptSchemaValid:parsedReceipt.success,receiptCompanyMatches:receiptBinding?.companyId===runRow!.companyId,
      receiptRunMatches:receiptBinding?.runId===runRow!.id,receiptAgentMatches:receiptBinding?.agentId===runRow!.agentId,
      receiptIssueMatches:receiptBinding?.issueId===runRow!.nativeIssueId,
      receiptHumanMatches:receiptBinding?.responsibleUserId===runRow!.responsibleUserId,
      contextInputCount:metricSourceSet.inputs.filter(input=>input.kind==="context").length,exactReceiptInputCount:exactReceiptInputs.length}).toEqual({
      turnIdPresent:true,matchingDispatchIntentCount:1,nativeInputDispatchPresent:true,matchingDispatchAssociationCount:1,sourcePresent:true,contextInputCount:1,exactReceiptInputCount:1,
      inputSourceProtocolVersion:1,
      receiptSchemaValid:true,receiptCompanyMatches:true,receiptRunMatches:true,receiptAgentMatches:true,receiptIssueMatches:true,receiptHumanMatches:true,
    });
    expect(metricSource).toMatchObject({kind:"tool_result",runId:run.id,callId:metricCapture.callId,toolName:"query_business_metric",invocationId:null,contentHash:metricCapture.resultDigest});
    const resultContextInputs=metricSourceSet.inputs.filter(input=>input.kind==="context");expect(resultContextInputs).toHaveLength(1);
    const resultContextId=resultContextInputs[0]!.manifestId as string;
    const [resultContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,resultContextId));
    expect(resultContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
    const bootstrapContexts=Array.isArray(profile.nativeBootstrapContextManifests)
      ? profile.nativeBootstrapContextManifests as Array<{companyId:string;contextManifestId:string}>
      : [];
    expect(bootstrapContexts).toHaveLength(1);
    const bootstrapContextId=bootstrapContexts[0]!.contextManifestId;
    const [bootstrapContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,bootstrapContextId));
    expect(bootstrapContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
    expect(resultContextId).not.toBe(bootstrapContextId);
    const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,resultContextId));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
    const bootstrapRoots=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,bootstrapContextId));
    expect(bootstrapRoots.some(row=>row.memoryRecordId===retention!.id)).toBe(false);
    expect(receipt.additionalInputs).toContainEqual({responsibleUserId:runRow!.responsibleUserId,policy:metricSourceSet.policy,inputs:[metricSource,...metricSourceSet.inputs]});
    const authority=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,retention!.id)).then(rows=>rows[0]);
    expect(authority?.authorityPins).toContainEqual({kind:"analytical_evidence",source:{type:"metric_observation",id:observation!.id,metricId:metric.metric.id,metricVersionId:metric.version.id}});
    expect((await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.memoryRecordId,retention!.id))).map(row=>row.sourceManifestId)).toContain(observation!.lineageManifestId);
    await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
    await json(await request.patch(`/api/issues/${source.id}`,{data:{hiddenAt:new Date().toISOString()}}));
    const denied=await request.get(f.chatPath);expect(denied.status()).toBe(403);expect((await denied.json()).details.conversationIssueId).toBe(original.id);
    await page.reload();await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();
    await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toHaveCount(0);
    await page.screenshot({path:test.info().outputPath("source-visibility-lost.png"),fullPage:true});
    await page.getByRole("button",{name:"Start a new conversation"}).click();await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
    const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(404);
    expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,retention!.id)))[0]!.deletedAt).not.toBeNull();
    expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,observation!.id)))[0]!.id).toBe(observation!.id);
    expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,metric.version.id)))[0]!.id).toBe(metric.version.id);
    await page.screenshot({path:test.info().outputPath("source-visibility-fresh-native-chat.png"),fullPage:true});
  }finally{await db.$client.end({timeout:0});await f.restore({collectState:false});}
});

test("feature flag blocks new sends and resets while preserving existing history", async ({
  page,
  request,
}) => {
  const f = await setup(request, page);
  request = f.request;
  try {
    await page.goto(f.route);
    await send(page, "Visible history");
    const issue = await idle(request, f.chatPath);
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { enableAgentChat: false },
      }),
    );
    for (const body of ["blocked message", "/new"])
      expect(
        (
          await request.post(`/api/issues/${issue.id}/comments`, {
            data: { body },
          })
        ).status(),
      ).toBe(404);
    await page.reload();
    await expect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
    expect(
      (await json(await request.get(`/api/issues/${issue.id}/comments`))).some(
        (c: any) => c.body.includes("Visible history"),
      ),
    ).toBe(true);
    expect((await request.post(f.chatPath, { data: {} })).status()).toBe(404);
  } finally {
    await f.restore();
  }
});

test("Stop then queued /new resets unpause the conversation without losing history", async ({
  page,
  request,
}) => {
  const f = await setup(request, page);
  request = f.request;
  try {
    await page.goto(f.route);
    await send(page, { action: "hold" });
    await expect
      .poll(async () => {
        const chat = await json(await request.get(f.chatPath));
        return (
          chat &&
          (
            await json(await request.get(`/api/issues/${chat.id}/comments`))
          ).some(
            (c: any) => c.body === "Provider is streaming and ready to stop.",
          )
        );
      })
      .toBe(true);
    const issue = await json(await request.get(f.chatPath));
    const active = (
      await json(await request.get(`/api/issues/${issue.id}/live-runs`))
    )[0];
    await page.getByTestId("task-chat-composer-stop").click();
    await expect
      .poll(
        async () =>
          (await json(await request.get(`/api/heartbeat-runs/${active.id}`)))
            .status,
      )
      .toBe("cancelled");
    const staleToken = createLocalAgentJwt(
      f.agent.id,
      f.company.id,
      "process",
      active.id,
    );
    expect(staleToken).toBeTruthy();
    const late = await request.post(`/api/issues/${issue.id}/comments`, {
      headers: { Authorization: `Bearer ${staleToken}` },
      data: { body: "Forbidden late response" },
    });
    expect([403, 409]).toContain(late.status());
    const mutation = await request.post(
      `/api/companies/${f.company.id}/projects`,
      {
        headers: { Authorization: `Bearer ${staleToken}` },
        data: { name: "Cancelled project" },
      },
    );
    expect([403, 409]).toContain(mutation.status());
    expect(
      await json(await request.get(`/api/companies/${f.company.id}/projects`)),
    ).toHaveLength(0);
    await send(page, "/new");
    await send(page, "/new");
    await send(page, "Fresh followup");
    await idle(request, f.chatPath, 2);
    const fresh = await json(await request.get(f.chatPath));
    expect(fresh.id).toBe(issue.id);
    expect(fresh.conversationSessionGeneration).toBe(2);
    await expect(
      page.getByText("Reply generation 2: Fresh followup", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("New session", { exact: true })).toHaveCount(2);
    await expect(
      page.getByRole("separator", { name: "Run completed", exact: true }),
    ).toHaveCount(0);
    const runs = await json(
      await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
    );
    const detailed = await Promise.all(
      runs.map((run: any) =>
        request.get(`/api/heartbeat-runs/${run.id}`).then(json),
      ),
    );
    expect(
      detailed.filter((run) => run.contextSnapshot?.conversationReset),
    ).toHaveLength(2);
    expect(
      detailed
        .filter((run) => run.contextSnapshot?.conversationReset)
        .every((run) => !run.sessionIdAfter),
    ).toBe(true);
  } finally {
    await f.restore();
  }
});

test("sidebar discovery, stars, recent agents, configuration links, and drafts survive switching", async ({
  page,
  request,
}) => {
  const f = await setup(request, page);
  request = f.request;
  try {
    await page.goto(`/${f.company.issuePrefix}/dashboard`);
    const nav = page.getByRole("navigation");
    const chatLinks = nav.locator('a[href*="/chats/"]');
    await expect(chatLinks).toHaveText(["Alpha"]);
    const compose = nav.getByRole("button", { name: "Chat with an agent", exact: true });
    await compose.click();
    const picker = page.getByRole("dialog", { name: "Choose a Co-worker to ask", exact: true });
    await expect(
      picker.getByRole("listbox", { name: "Suggestions" }).getByRole("option"),
    ).toHaveCount(6);
    const search = picker.getByRole("combobox", {
      name: "Search Co-workers by name or role",
    });
    await search.fill("Beta");
    await search.press("Enter");
    await expect(picker).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
    expect(await json(await request.get(`/api/companies/${f.company.id}/chats/${f.agents[1].id}`))).toBeNull();
    for (const agent of f.agents) {
      await page.goto(`/${f.company.issuePrefix}/chats/${agent.id}`);
      await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
    }
    await expect(chatLinks).toHaveText(["Alpha", "Zeta", "Epsilon", "Delta", "Gamma"]);
    const star = page.getByRole("button", { name: "Star Zeta", exact: true });
    await page.getByTestId("task-chat-composer-input").hover();
    await expect(star).toHaveCSS("opacity", "0");
    // Enter from the preceding link. Clicking the rich editor first can leave
    // a pending selection update that restores editor focus; Shift+Tab there
    // also cycles work modes instead of moving backwards through the sidebar.
    await nav.getByRole("link", { name: "Zeta", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(star).toBeFocused();
    await expect(star).toHaveCSS("opacity", "1");
    await star.click();
    await page.goto(f.route);
    await page.getByRole("button", { name: "Star Alpha", exact: true }).click();
    await expect(nav.locator('a[href*="/chats/"]').first()).toHaveText("Alpha");
    await expect(nav.locator('a[href*="/chats/"]').nth(1)).toHaveText("Zeta");
    const editor = page
      .getByTestId("task-chat-composer-input")
      .locator('[contenteditable="true"]');
    await editor.fill("Unsent draft for Alpha");
    await nav.getByRole("link", { name: "Zeta", exact: true }).click();
    await expect(editor).toHaveText("");
    await nav.getByRole("link", { name: "Alpha", exact: true }).click();
    await expect(editor).toContainText("Unsent draft for Alpha");
    const recent = await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(([key]) =>
          key.startsWith("paperclip.recentAgentChats:"),
        ),
      ),
    );
    await page.getByRole("link", { name: /Configure Alpha/ }).click();
    await expect(page).toHaveURL(/\/agents\/.*\/runtime/);
    const backgroundPath = `/api/companies/${f.company.id}/chats/${f.agents[1].id}`;
    const background = await json(
      await request.post(backgroundPath, { data: {} }),
    );
    await json(
      await request.post(`/api/issues/${background.id}/comments`, {
        data: {
          body: "Background activity",
          clientRequestId: "00000000-0000-4000-8000-000000000099",
        },
      }),
    );
    await idle(request, backgroundPath);
    expect(
      await page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([key]) =>
            key.startsWith("paperclip.recentAgentChats:"),
          ),
        ),
      ),
    ).toEqual(recent);
    await compose.click();
    const searchAgain = picker.getByRole("combobox", {
      name: "Search Co-workers by name or role",
    });
    await expect(searchAgain).toHaveValue("");
    await searchAgain.fill("Beta");
    await searchAgain.press("Enter");
    await expect(picker).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
    await expect(page.getByText("Background activity", { exact: true })).toBeVisible();
  } finally {
    await f.restore();
  }
});
