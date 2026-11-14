import { createHash, randomUUID } from "node:crypto";
import { managedNativeBrowserCasesForCohort, type ManagedNativeBrowserCohort } from "./managed-native-browser-cases.js";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect as browserExpect, type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { activityLog, agentWakeupRequests, agents, analyticalContextDependencies, analyticalContextRoots, businessMetricObservations,
  businessMetricVersions, contextManifestMemoryRoots, contextManifests, createDb, documentRevisions, documents, heartbeatRuns,
  issueComments, issueDocuments, memoryRecords, projectWorkspaces, projects } from "@paperclipai/db";
import { createApp } from "../../app.js";
import { createLocalAgentJwt } from "../../agent-auth-jwt.js";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable, runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { setupLiveEventsWebSocketServer } from "../../realtime/live-events-ws.js";
import { nativeSha256 } from "./canonical.js";
import { analyticalPurpose, metricDefinition } from "../../__tests__/helpers/business-metric-fixture.js";
import { aiGovernanceService } from "../../services/ai-governance/governance-service.js";
import { businessMetricService } from "../../services/business-metrics/service.js";
import { issueService } from "../../services/issues.js";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { instanceSettingsService } from "../../services/instance-settings.js";

const managedBrowserApiRouteClass = (rawUrl: string, origin: string): string | null => {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return null;
    const path = url.pathname;
    if (path === "/api/health") return "health";
    if (path === "/api/auth/get-session") return "auth_session";
    if (path === "/api/cli-auth/me") return "board_access";
    if (path === "/api/instance/settings/experimental") return "experimental_settings";
    if (path === "/api/companies") return "companies";
    if (/^\/api\/companies\/[^/]+\/agents$/.test(path)) return "company_agents";
    if (/^\/api\/companies\/[^/]+\/chats\/[^/]+$/.test(path)) return "agent_chat";
    return "other_same_origin_api";
  } catch {
    return null;
  }
};

const managedBrowserRouteClass = (rawUrl: string, origin: string): string => {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== origin) return "other_origin";
    if (/^\/[^/]+\/chats\/[^/]+$/.test(url.pathname)) return "company_chat";
    if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) return "auth";
    if (url.pathname === "/onboarding") return "onboarding";
    if (/^\/[^/]+\/dashboard$/.test(url.pathname)) return "company_dashboard";
    return "other_same_origin_route";
  } catch {
    return "unavailable";
  }
};

function attachManagedBrowserEntryDiagnostic(page: Page, origin: string) {
  const responseCounts = new Map<string, { routeClass: string; status: number; count: number }>();
  const pageErrorNames = new Set<string>();
  const allowedErrorNames = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
  const onResponse = (response: Response) => {
    const routeClass = managedBrowserApiRouteClass(response.url(), origin);
    if (!routeClass) return;
    const status = response.status();
    const key = `${routeClass}:${status}`;
    const existing = responseCounts.get(key);
    if (existing) existing.count = Math.min(99, existing.count + 1);
    else if (responseCounts.size < 16) responseCounts.set(key, { routeClass, status, count: 1 });
  };
  const onPageError = (error: Error) => {
    pageErrorNames.add(allowedErrorNames.has(error.name) ? error.name : "Other");
  };
  page.on("response", onResponse);
  page.on("pageerror", onPageError);
  return {
    async reportFailure(entry: "project_card_entry" | "repository_card_entry" | "governed_handoff_entry", composer: Locator, claim: Locator) {
      let documentFacts: Record<string, unknown> = { readyState: "unavailable", mainPresent: false, statusRolePresent: false, alertRolePresent: false, composerElementPresent: false };
      try {
        documentFacts = await page.evaluate(() => ({
          readyState: document.readyState,
          mainPresent: document.querySelector("main") !== null,
          statusRolePresent: document.querySelector('[role="status"]') !== null,
          alertRolePresent: document.querySelector('[role="alert"]') !== null,
          composerElementPresent: document.querySelector('[data-testid="task-chat-composer-input"]') !== null,
        }));
      } catch { /* Keep fixed unavailable facts if the document is gone. */ }
      let composerVisible = false, claimVisible = false, loadingStatusVisible = false, noBoardAccessVisible = false;
      try { composerVisible = await composer.isVisible(); } catch { /* unavailable */ }
      try { claimVisible = await claim.isVisible(); } catch { /* unavailable */ }
      try { loadingStatusVisible = await page.getByRole("status").first().isVisible(); } catch { /* unavailable */ }
      try { noBoardAccessVisible = await page.getByRole("heading", { name: "No organization access", exact: true }).isVisible(); } catch { /* unavailable */ }
      let routeClass = "unavailable";
      try { routeClass = managedBrowserRouteClass(page.url(), origin); } catch { /* unavailable */ }
      console.error(JSON.stringify({
        kind: "managed_browser_entry_wait_diagnostic_v1",
        entry,
        page: { routeClass, sameOrigin: routeClass !== "other_origin" && routeClass !== "unavailable", ...documentFacts, composerVisible, claimVisible, loadingStatusVisible, noBoardAccessVisible },
        apiResponseStatusCounts: [...responseCounts.values()].slice(0, 16),
        pageErrorNames: [...pageErrorNames].slice(0, 8),
      }));
    },
    dispose() {
      page.off("response", onResponse);
      page.off("pageerror", onPageError);
    },
  };
}


const binary = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY;
const executablePath = process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE;

function successfulProgressToolResult(messages: Array<Record<string, unknown>>, toolUseId: string, issueId: string): string {
  const blocks = messages.flatMap(message => Array.isArray(message.content)
    ? message.content as Array<Record<string, unknown>> : []);
  const result = blocks.find(block => block.type === "tool_result" && block.tool_use_id === toolUseId);
  expect(result, `missing report_progress tool_result ${toolUseId}`).toBeDefined();
  expect(result!.is_error, `report_progress tool_result ${toolUseId} failed`).not.toBe(true);
  const content = typeof result!.content === "string" ? result!.content
    : Array.isArray(result!.content) ? (result!.content as Array<Record<string, unknown>>)
      .map(part => typeof part.text === "string" ? part.text : "").join("") : "";
  const parsed: unknown = JSON.parse(content);
  expect(parsed).toMatchObject({ issueId, disposition: "applied", commentId: expect.any(String) });
  return (parsed as { commentId: string }).commentId;
}

export function registerManagedNativeBrowserCohort(cohort: ManagedNativeBrowserCohort) {
// This opt-in cohort needs the qualified runtime and a real browser. The
// canonical qualification runner rejects an all-skipped invocation.
describe.skipIf(!binary || !existsSync(binary) || !executablePath || !existsSync(executablePath))(
  "managed Native conversation through the browser",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
    let db: ReturnType<typeof createDb>;
    let root = "";
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "managed-native-browser-"));
      vi.stubEnv("PAPERCLIP_HOME", root);
      vi.stubEnv("PAPERCLIP_VITE_CACHE_DIR", join(root, "vite-cache"));
      vi.stubEnv("PAPERCLIP_INSTANCE_ID", `managed-browser-${randomUUID()}`);
      database = await startEmbeddedPostgresTestDatabase("managed-native-browser-");
      db = createDb(database.connectionString);
    }, 60_000);
    afterAll(async () => {
      await db?.$client.end({ timeout: 0 });
      await database?.cleanup();
      vi.unstubAllEnvs();
      if (root) {
        await makeConversationFixtureTreeWritable(root);
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000);

    it.each(managedNativeBrowserCasesForCohort(cohort))(
      "exercises the qualified Native browser route: $label",
      async scenario => {
      const browser = await chromium.launch({ executablePath, headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      let browserContext: BrowserContext | undefined;
      let page: Page | undefined;
      let origin = "";
      let route = "";
      let companyIdForApi = "";
      let consumedProjectId: string | null = null;
      let uploadedAttachment: { id: string; contentPath: string; filename: string } | null = null;
      let providerSawAttachment = false;
      let modeProjectToolAdvertised: boolean | null = null;
      let modeProjectToolResult = "";
      let modeProjectRejectionClass = "";
      let firstPlanRevisionId: string | null = null;
      let planWriteError: string | null = null;
      let discoveredRepositoryIds: string[] = [];
      let githubWireCalls = 0;
      let stopIssueId: string | null = null;
      let stopAgentId: string | null = null;
      let stopActiveRunId: string | null = null;
      let stopResetActionsCompleted = false;
      let stopProgressCommentId: string | null = null;
      let preStopQueuedCommentId: string | null = null;
      const preStopQueuedCommentBody = "Old topic queued before Stop";
      let featureFlagProgressCommentId: string | null = null;
      const historyProgressResultCommentIds: string[] = [];
      let workflowChatIssueId: string | null = null;
      let reusedProjectId: string | null = null;
      let planApprovalRevisionId: string | null = null;
      let recoveryMetricId: string | null = null;
      let recoveryMetricVersionId: string | null = null;
      let recoverySourceIssueId: string | null = null;
      let recoveryObservationId: string | null = null;
      let recoveryRetentionId: string | null = null;
      let recoveryQuery: { metricId: string; versionId: string; from: string; until: string;
        dimensions: string[]; maxRows: number } | null = null;
      const welcomePlan = "# Welcome plan\nWrite a friendly welcome.";
      const approvedPlan = "# Approved welcome\nWrite two friendly sentences.";
      const reusedTaskPlan = "# Welcome task\nWrite a friendly welcome for the selected audience.";
      const workflowProjectName = scenario.label === "split handoff commits plans before execution without chat children"
        ? "Welcome project" : scenario.label === "plan approval hands the preserved revision to an assigned task"
          ? "Approved plan project" : "Garden club";
      let previousEnableAgentChat: boolean | null = null;
      let featureSettingsCookie = "";
      let featureSettingsTouched = false;
      let controlledProviderCallIndex = 0;
      let activeReplyGateReached = false;
      let signalActiveReplyGateReached!: () => void;
      const activeReplyGateReady = new Promise<void>(resolve => { signalActiveReplyGateReached = resolve; });
      let releaseActiveReply!: () => void;
      const activeReplyGate = new Promise<void>(resolve => { releaseActiveReply = resolve; });
      const workflowProject = scenario.label === "split handoff commits plans before execution without chat children" ||
        scenario.label === "plan approval hands the preserved revision to an assigned task";
      const name = scenario.repositorySelection ? "Selected repositories" : workflowProject ? workflowProjectName
        : `Browser private Project ${randomUUID().slice(0, 8)}`;
      const callId = `browser-project-${randomUUID()}`;
      const repositoryUrls = ["https://github.com/octocat/Hello-World.git",
        "https://github.com/octocat/Spoon-Knife", "https://github.com/octocat/Hello-World"];
      const projectArgs = { name, ...(workflowProject ? {} : { repositoryUrls }), idempotencyKey: callId };
      const originalFetch = globalThis.fetch;
      let repositoryWireInstalled = false;
      try {
        if (scenario.repositorySelection) {
          const credential = "paperclip-e2e-repository-fixture";
          const githubRepositories = [
            { id: 101, full_name: "chat-fixture/frontend", private: false },
            { id: 102, full_name: "octocat/Hello-World", private: false },
          ];
          globalThis.fetch = async (input, init) => {
            const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
            let url: URL | null = null;
            try { url = new URL(rawUrl); } catch { /* delegate malformed/non-URL inputs to native fetch */ }
            if (url?.origin === "https://api.github.com") {
              const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
              const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
              if (method !== "GET" || url.pathname !== "/user/repos" ||
                  url.searchParams.get("per_page") !== "100" || !url.searchParams.has("page"))
                throw new Error("managed_browser_github_wire_rejected_unexpected_request");
              if (headers.get("authorization") !== `Bearer ${credential}`)
                throw new Error("managed_browser_github_wire_credential_mismatch");
              githubWireCalls += 1;
              return new Response(JSON.stringify(githubRepositories), {
                status: 200, headers: { "content-type": "application/json" },
              });
            }
            return originalFetch(input, init);
          };
          repositoryWireInstalled = true;
        }
        const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary!,
          conversationWorkMode: "standard",
          providerRequestBodyLimitBytes: scenario.label === "shared history loads older messages without replacing the latest turn"
            ? 64 * 1024 : undefined,
          managedPrimaryAgentName: scenario.label.startsWith("sidebar discovery") ? "Alpha" : undefined,
          managedAgentNames: scenario.label.startsWith("sidebar discovery")
            ? ["Beta", "Gamma", "Delta", "Epsilon", "Zeta"] : undefined,
          prepareNativeRuntimeContext: async context => {
            if (scenario.label !== "owner recovers after source visibility loss while metric lineage survives") return;
            await instanceSettingsService(db).updateExperimental({ analytical_lineage_v8: true,
              business_metrics_v8: true, management_reviews_v8: true, management_chat_tools_v8: true,
              ai_use_cases_v7: true, governance_evidence_v7: true });
            if (!context.actor.userId) throw new Error("managed_browser_recovery_human_missing");
            const policy = await aiGovernanceService(db).obligation(context.actor, context.companyId, analyticalPurpose());
            const created = await businessMetricService(db).create(context.companyId, context.actor, {
              key: "managed_browser_source_recovery", definition: { ...metricDefinition(policy.id),
                ownerUserId: context.actor.userId },
            });
            await businessMetricService(db).publish(context.companyId, context.actor, created.metric.id,
              { expectedRevision: 1, versionId: created.version.id });
            const source = await issueService(db).create(context.companyId, {
              title: "Canonical metric population for managed chat recovery", status: "done",
              createdByUserId: context.actor.userId, responsibleUserId: context.actor.userId,
              assigneeAgentId: context.agentId,
            }, db, undefined, { manualInputActor: context.actor, privacyActor: context.actor });
            recoveryMetricId = created.metric.id;
            recoveryMetricVersionId = created.version.id;
            recoverySourceIssueId = source.id;
            recoveryQuery = { metricId: created.metric.id, versionId: created.version.id,
              from: new Date(Date.now() - 86_400_000).toISOString(), until: new Date(Date.now() + 3_600_000).toISOString(),
              dimensions: [], maxRows: 100 };
          },
          configureHeartbeat: scenario.label.startsWith("sidebar discovery") ? undefined : async context => {
            const { configureManagedSerialSchedulerSandboxHost } = await import(
              "../../__tests__/helpers/managed-native-conversation-sandbox-host.js");
            return configureManagedSerialSchedulerSandboxHost({ ...context, root: context.runHome });
          },
          conversationPrompt: scenario.label.startsWith("sidebar discovery") ? "Reply after the sidebar background Native turn."
            : scenario.sourceUi === "owner_recovery" ? "Observe the published metric and explain its result."
            : scenario.sourceUi === "reload" ? "Private history before source loss"
            : scenario.sourceUi === "live" ? "Private cached history before live source denial"
              : scenario.label === "plan approval hands the preserved revision to an assigned task"
                ? "Draft the approved welcome plan and ask me to approve handoff before creating work."
                : scenario.mode ? `Create a project named ${name}.`
                  : scenario.featureFlag ? "Please continue the active turn and acknowledge after the flag changes."
                    : scenario.repositorySelection ? "Discover the connected repositories and create a project using the selected repositories."
                      : scenario.label === "shared history loads older messages without replacing the latest turn"
                      ? "Archive this conversation history in the shared transcript."
                        : scenario.label === "read-only first open and concurrent first sends"
                          ? "Reply to the first message and its idempotent retry."
                          : scenario.label === "Stop then queued /new resets unpause the conversation without losing history"
                            ? "Keep working until the Human stops this turn, then acknowledge the fresh follow-up."
                            : scenario.label === "split handoff commits plans before execution without chat children"
                              ? "Create a project, write the welcome plan, and split the work into two assigned tasks."
                              : scenario.label === "shared questions resume and existing project reuse creates no project card"
                                ? "Ask who the welcome note is for, then create a task in my existing Garden club project."
                                : undefined,
          createConversationApp: async ({ heartbeat, resolveSession, resolveSessionFromHeaders }) => {
            const server = createServer();
            await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
            const closeServer = () => new Promise<void>((resolve, reject) => {
              server.closeAllConnections();
              server.close(error => error ? reject(error) : resolve());
            });
            const address = server.address();
            if (!address || typeof address === "string") {
              await closeServer();
              throw new Error("managed_browser_listener_missing");
            }
            origin = `http://127.0.0.1:${address.port}`;
            try {
              const app = await createApp(db, { heartbeat, resolveSession, uiMode: "vite-dev", serverPort: address.port,
                storageService: createStorageService(createLocalDiskStorageProvider(join(root, "storage"))),
                deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1",
                allowedHostnames: ["127.0.0.1"], authReady: true, companyDeletionEnabled: false,
                instanceId: process.env.PAPERCLIP_INSTANCE_ID, localPluginDir: join(root, "plugins"),
                managedPluginAutoInstall: [], decisionServiceOptions: { wakeOriginAgent: async () => undefined } });
              server.on("request", app);
              const liveEvents = setupLiveEventsWebSocketServer(server, db, {
                deploymentMode: "authenticated", resolveSessionFromHeaders,
              });
              return { app, origin, close: async () => {
                const shutdownErrors: unknown[] = [];
                try {
                  if (previousEnableAgentChat !== null && featureSettingsCookie && featureSettingsTouched) {
                    const restored = await fetch(`${origin}/api/instance/settings/experimental`, {
                      method: "PATCH",
                      headers: { cookie: featureSettingsCookie, origin, "content-type": "application/json" },
                      body: JSON.stringify({ enableAgentChat: previousEnableAgentChat }),
                    });
                    if (!restored.ok) throw new Error(`managed_browser_feature_flag_restore_failed_${restored.status}`);
                  }
                } catch (error) { shutdownErrors.push(error); }
                for (const client of liveEvents.clients) client.terminate();
                try { await new Promise<void>(resolve => liveEvents.close(() => resolve())); }
                catch (error) { shutdownErrors.push(error); }
                try { await app.locals.paperclipShutdown?.(); }
                catch (error) { shutdownErrors.push(error); }
                try { await closeServer(); }
                catch (error) { shutdownErrors.push(error); }
                if (shutdownErrors.length) throw new AggregateError(shutdownErrors, "managed_browser_app_shutdown_failed");
              } };
            } catch (error) {
              await closeServer();
              throw error;
            }
          },
          driveConversation: async context => {
            companyIdForApi = context.companyId;
            if (scenario.label === "Stop then queued /new resets unpause the conversation without losing history")
              stopAgentId = context.agentId;
            if (scenario.label === "split handoff commits plans before execution without chat children" ||
                scenario.label === "plan approval hands the preserved revision to an assigned task" ||
                scenario.label === "shared questions resume and existing project reuse creates no project card") {
              browserContext = await browser.newContext();
              const [cookieName, ...cookieValue] = context.humanCookie.split("=");
              await browserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
              page = await browserContext.newPage();
              route = context.conversationRoute;
              if (scenario.label === "shared questions resume and existing project reuse creates no project card") {
                const project = await browserContext.request.post(
                  `${context.origin}/api/companies/${context.companyId}/projects`, {
                    headers: { origin: context.origin }, data: { name: "Garden club" },
                  });
                expect(project.status()).toBe(201);
                reusedProjectId = (await project.json() as { id: string }).id;
              }
              const opened = await browserContext.request.post(`${context.origin}${context.chatPath}`, {
                headers: { origin: context.origin }, data: {},
              });
              expect(opened.status()).toBe(200);
              const chat = await opened.json() as { id: string };
              workflowChatIssueId = chat.id;
              context.onConversationOpened(chat.id);
              const entryDiagnostic = attachManagedBrowserEntryDiagnostic(page, context.origin);
              const composer = page.getByTestId("task-chat-composer-input").last()
                .locator('[contenteditable="true"],textarea').first();
              const claim = page.getByRole("button", { name: "Claim this instance", exact: true });
              try {
                await page.goto(`${context.origin}${route}`);
                await browserExpect(composer.or(claim).first()).toBeVisible({ timeout: 30_000 });
                if (await claim.isVisible()) {
                  const claimed = page.waitForResponse(response => response.request().method() === "POST" &&
                    new URL(response.url()).pathname === "/api/bootstrap/claim");
                  await claim.click();
                  expect((await claimed).status()).toBe(200);
                  await page.goto(`${context.origin}${route}`);
                }
                await browserExpect(composer).toBeVisible({ timeout: 30_000 });
              } catch (error) {
                try { await entryDiagnostic.reportFailure("governed_handoff_entry", composer, claim); }
                catch { /* Keep the original browser assertion as the test failure. */ }
                throw error;
              } finally {
                entryDiagnostic.dispose();
              }
              if (scenario.label === "plan approval hands the preserved revision to an assigned task") {
                await page.getByTestId("task-chat-composer-mode").click();
                await page.getByTestId("task-chat-composer-mode-menu").getByText("Plan mode", { exact: true }).click();
              }
              const sendHumanMessage = async (text: string) => {
                await composer.fill(text);
                const sent = page!.waitForResponse(response => response.request().method() === "POST" &&
                  new URL(response.url()).pathname === `/api/issues/${chat.id}/comments`);
                await page!.getByTestId("task-chat-composer-send").last().click();
                const response = await sent;
                expect(response.status()).toBe(201);
                return await response.json() as { id: string };
              };
              const initial = await sendHumanMessage(context.prompt);
              let wakeCommentId = initial.id;
              if (scenario.label === "shared questions resume and existing project reuse creates no project card") {
                await browserExpect(page.getByRole("radio", { name: "Garden club", exact: true }).last())
                  .toBeVisible({ timeout: 60_000 });
                await page.getByRole("radio", { name: "Garden club", exact: true }).last().click();
                await page.getByRole("button", { name: "Submit answers", exact: true }).last().click();
                await browserExpect(page.getByText("Reply generation 0: Clarification received.", { exact: true }))
                  .toBeVisible({ timeout: 60_000 });
                wakeCommentId = (await sendHumanMessage("Create one assigned task in the existing Garden club project.")).id;
              } else if (scenario.label === "plan approval hands the preserved revision to an assigned task") {
                await browserExpect(page.getByRole("button", { name: "Approve handoff", exact: true }).last())
                  .toBeVisible({ timeout: 60_000 });
                const planResponse = await browserContext.request.get(
                  `${context.origin}/api/issues/${chat.id}/documents/plan`, { headers: { origin: context.origin } });
                expect(planResponse.status()).toBe(200);
                const plan = await planResponse.json() as { latestRevisionId: string };
                planApprovalRevisionId = plan.latestRevisionId;
                expect(planApprovalRevisionId).toBeTruthy();
                expect(await (await browserContext.request.get(
                  `${context.origin}/api/companies/${context.companyId}/projects`, { headers: { origin: context.origin } })).json()).toHaveLength(0);
                expect(await (await browserContext.request.get(
                  `${context.origin}/api/companies/${context.companyId}/issues`, { headers: { origin: context.origin } })).json()).toHaveLength(0);
                await page.getByRole("button", { name: "Approve handoff", exact: true }).last().click();
              }
              return { issueId: chat.id, wakeCommentId };
            }
            if (scenario.repositorySelection) {
              browserContext = await browser.newContext();
              const [cookieName, ...cookieValue] = context.humanCookie.split("=");
              await browserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
              page = await browserContext.newPage();
              route = context.conversationRoute;
              const secretResponse = await browserContext.request.post(
                `${context.origin}/api/companies/${context.companyId}/secrets`, {
                  headers: { origin: context.origin },
                  data: { name: "Deterministic GitHub credential", value: "paperclip-e2e-repository-fixture" },
                });
              expect(secretResponse.status()).toBe(201);
              const secret = await secretResponse.json() as { id: string };
              const connectionResponse = await browserContext.request.post(
                `${context.origin}/api/companies/${context.companyId}/tools/connections`, {
                  headers: { origin: context.origin },
                  data: {
                    name: "Fixture GitHub", applicationName: "Fixture GitHub", transport: "rest_api",
                    authKind: "api_key", credentialPolicy: "shared", status: "active", enabled: true,
                    config: { sourceTemplateKey: "github", baseUrl: "https://api.github.com" },
                    credentialSecretRefs: [{ configPath: "headers.Authorization", secretId: secret.id,
                      versionSelector: "latest" }],
                  },
                });
              expect(connectionResponse.status()).toBe(201);
              await page.goto(`${context.origin}${route}`);
              const composer = page.getByTestId("task-chat-composer-input").last()
                .locator('[contenteditable="true"],textarea').first();
              await browserExpect(composer).toBeVisible({ timeout: 30_000 });
              const repositoryResponse = await browserContext.request.get(
                `${context.origin}/api/companies/${context.companyId}/project-repositories`, {
                  headers: { origin: context.origin },
                });
              expect(repositoryResponse.status()).toBe(200);
              const catalog = await repositoryResponse.json() as { repositories: Array<{ id: string; fullName: string; url: string }> };
              expect(catalog.repositories.map(repository => repository.id).sort()).toEqual(["101", "102"]);
              expect(catalog.repositories.map(repository => repository.fullName).sort()).toEqual([
                "chat-fixture/frontend", "octocat/Hello-World",
              ]);
              const opened = await browserContext.request.post(`${context.origin}${context.chatPath}`, {
                headers: { origin: context.origin },
              });
              expect(opened.status()).toBe(200);
              const chat = await opened.json() as { id: string };
              context.onConversationOpened(chat.id);
              await page.goto(`${context.origin}${route}`);
              await browserExpect(composer).toBeVisible({ timeout: 30_000 });
              await composer.fill(context.prompt);
              const sent = page.waitForResponse(response => response.request().method() === "POST" &&
                new URL(response.url()).pathname === `/api/issues/${chat.id}/comments`);
              await page.getByTestId("task-chat-composer-send").last().click();
              const response = await sent;
              expect(response.status()).toBe(201);
              const comment = await response.json() as { id: string };
              return { issueId: chat.id, wakeCommentId: comment.id };
            }
            if (scenario.label === "read-only first open and concurrent first sends") {
              browserContext = await browser.newContext();
              const [cookieName, ...cookieValue] = context.humanCookie.split("=");
              await browserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
              page = await browserContext.newPage();
              route = context.conversationRoute;
              await page.goto(`${context.origin}${route}`);
              const composer = page.getByTestId("task-chat-composer-input").last()
                .locator('[contenteditable="true"],textarea').first();
              await browserExpect(composer).toBeVisible({ timeout: 30_000 });
              const untouched = await browserContext.request.get(`${context.origin}${context.chatPath}`);
              expect(untouched.status()).toBe(200);
              expect(await untouched.json()).toBeNull();
              const runsBefore = await browserContext.request.get(
                `${context.origin}/api/companies/${context.companyId}/heartbeat-runs`, { headers: { origin: context.origin } });
              expect(runsBefore.status()).toBe(200);
              expect(await runsBefore.json()).toHaveLength(0);
              const other = await browserContext.newPage();
              await other.goto(`${context.origin}${route}`);
              const otherComposer = other.getByTestId("task-chat-composer-input").last()
                .locator('[contenteditable="true"],textarea').first();
              await browserExpect(otherComposer).toBeVisible({ timeout: 30_000 });
              const waitForInitialComment = (target: Page) => target.waitForResponse(response =>
                response.request().method() === "POST" &&
                /\/api\/issues\/[^/]+\/comments$/.test(new URL(response.url()).pathname), { timeout: 30_000 });
              const firstResponse = waitForInitialComment(page);
              const secondResponse = waitForInitialComment(other);
              await Promise.all([composer.fill("Same first message"), otherComposer.fill("Same first message")]);
              await Promise.all([page.getByTestId("task-chat-composer-send").last().click(),
                other.getByTestId("task-chat-composer-send").last().click()]);
              const first = await firstResponse, second = await secondResponse;
              expect([first.status(), second.status()]).toEqual([201, 201]);
              const issue = await browserContext.request.get(`${context.origin}${context.chatPath}`);
              expect(issue.status()).toBe(200);
              const chat = await issue.json() as { id: string };
              context.onConversationOpened(chat.id);
              await other.close();
              const retryBody = { body: "Retry once", clientRequestId: "00000000-0000-4000-8000-000000000001" };
              const retries = await Promise.all([
                browserContext.request.post(`${context.origin}/api/issues/${chat.id}/comments`, { headers: { origin: context.origin }, data: retryBody }),
                browserContext.request.post(`${context.origin}/api/issues/${chat.id}/comments`, { headers: { origin: context.origin }, data: retryBody }),
              ]);
              expect(retries.map(response => response.status())).toEqual([201, 201]);
              expect((await retries[0]!.json() as { id: string }).id).toBe((await retries[1]!.json() as { id: string }).id);
              return { issueId: chat.id, wakeCommentId: (await retries[0]!.json() as { id: string }).id };
            }
            if (scenario.featureFlag) {
              browserContext = await browser.newContext();
              const [cookieName, ...cookieValue] = context.humanCookie.split("=");
              await browserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
              page = await browserContext.newPage();
              route = context.conversationRoute;
              await page.goto(`${context.origin}${route}`);
              const composer = page.getByTestId("task-chat-composer-input").last()
                .locator('[contenteditable="true"],textarea').first();
              const claim = page.getByRole("button", { name: "Claim this instance", exact: true });
              await browserExpect(composer.or(claim).first()).toBeVisible({ timeout: 30_000 });
              if (await claim.isVisible()) {
                const claimed = page.waitForResponse(response => response.request().method() === "POST" &&
                  new URL(response.url()).pathname === "/api/bootstrap/claim");
                await claim.click();
                expect((await claimed).status()).toBe(200);
                await page.goto(`${context.origin}${route}`);
              }
              featureSettingsCookie = context.humanCookie;
              const settingsResponse = await browserContext.request.get(
                `${context.origin}/api/instance/settings/experimental`, { headers: { origin: context.origin } });
              expect(settingsResponse.status()).toBe(200);
              const initialSettings = await settingsResponse.json() as { enableAgentChat: boolean };
              previousEnableAgentChat = initialSettings.enableAgentChat;
              const enable = await browserContext.request.patch(
                `${context.origin}/api/instance/settings/experimental`, {
                  headers: { origin: context.origin }, data: { enableAgentChat: true },
                });
              expect(enable.status()).toBe(200);
              expect((await enable.json() as { enableAgentChat: boolean }).enableAgentChat).toBe(true);
              featureSettingsTouched = true;
              const opened = await browserContext.request.post(`${context.origin}${context.chatPath}`, {
                headers: { origin: context.origin },
              });
              expect(opened.status()).toBe(200);
              const chat = await opened.json() as { id: string };
              context.onConversationOpened(chat.id);
              await page.goto(`${context.origin}${route}`);
              await browserExpect(composer).toBeVisible({ timeout: 30_000 });
              await composer.fill(context.prompt);
              const sent = page.waitForResponse(response => response.request().method() === "POST" &&
                new URL(response.url()).pathname === `/api/issues/${chat.id}/comments`);
              await page.getByTestId("task-chat-composer-send").last().click();
              expect((await sent).status()).toBe(201);
              try {
                await browserExpect.poll(() => activeReplyGateReached, { timeout: 60_000 }).toBe(true);
                const running = await browserContext.request.get(
                  `${context.origin}/api/issues/${chat.id}/live-runs`, { headers: { origin: context.origin } });
                expect(running.status()).toBe(200);
                expect(await running.json()).toHaveLength(1);
                const comments = await browserContext.request.get(
                  `${context.origin}/api/issues/${chat.id}/comments`, { headers: { origin: context.origin } });
                expect(comments.status()).toBe(200);
                const progress = await comments.json() as Array<{ authorAgentId?: string | null; body: string }>;
                expect(progress.some(comment => comment.authorAgentId === context.agentId &&
                  comment.body === "Turn started before feature disable.")).toBe(true);
                const disabled = await browserContext.request.patch(
                  `${context.origin}/api/instance/settings/experimental`, {
                    headers: { origin: context.origin }, data: { enableAgentChat: false },
                  });
                expect(disabled.status()).toBe(200);
                expect((await disabled.json() as { enableAgentChat: boolean }).enableAgentChat).toBe(false);
              } finally {
                if (activeReplyGateReached) releaseActiveReply();
              }
              const acceptedComment = await sent;
              const acceptedCommentBody = await acceptedComment.json() as { id: string };
              return { issueId: chat.id, wakeCommentId: acceptedCommentBody.id };
            }
            if (scenario.attachment) {
              const currentBrowserContext = await browser.newContext();
              browserContext = currentBrowserContext;
              const [cookieName, ...cookieValue] = context.humanCookie.split("=");
              await currentBrowserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
              page = await currentBrowserContext.newPage();
              route = context.conversationRoute;
              await page.goto(`${context.origin}${route}`);
              const composer = page.getByTestId("task-chat-composer-input").last()
                .locator('[contenteditable="true"],textarea').first();
              const claim = page.getByRole("button", { name: "Claim this instance", exact: true });
              await browserExpect(composer.or(claim).first()).toBeVisible({ timeout: 30_000 });
              if (await claim.isVisible()) {
                const claimed = page.waitForResponse(response => response.request().method() === "POST" &&
                  new URL(response.url()).pathname === "/api/bootstrap/claim");
                await claim.click();
                expect((await claimed).status()).toBe(200);
                await page.goto(`${context.origin}${route}`);
              }
              const before = await currentBrowserContext.request.get(`${context.origin}${context.chatPath}`);
              expect(before.status()).toBe(200);
              expect(await before.json()).toBeNull();
              await page.locator('input[type="file"]').last().setInputFiles({ name: "chat-notes.txt",
                mimeType: "text/plain", buffer: Buffer.from("Attachment acceptance content") });
              await browserExpect.poll(async () => {
                const openedResponse = await currentBrowserContext.request.get(`${context.origin}${context.chatPath}`);
                if (!openedResponse.ok()) return false;
                const openedChat = await openedResponse.json() as { id?: string } | null;
                return typeof openedChat?.id === "string";
              }, { timeout: 30_000 }).toBe(true);
              const openedResponse = await currentBrowserContext.request.get(`${context.origin}${context.chatPath}`);
              const openedChat = await openedResponse.json() as { id: string };
              context.onConversationOpened(openedChat.id);
              const runsBeforeSend = await currentBrowserContext.request.get(
                `${context.origin}/api/companies/${context.companyId}/heartbeat-runs`);
              expect(runsBeforeSend.status()).toBe(200);
              expect(await runsBeforeSend.json()).toHaveLength(0);
              await browserExpect(page.getByTestId("task-chat-composer-attachments")).toContainText("chat-notes.txt");
              const attachmentsResponse = await currentBrowserContext.request.get(
                `${context.origin}/api/issues/${openedChat.id}/attachments`);
              expect(attachmentsResponse.status()).toBe(200);
              const attachments = await attachmentsResponse.json() as Array<{ id: string; contentPath: string; filename: string }>;
              expect(attachments).toHaveLength(1);
              uploadedAttachment = attachments[0]!;
              expect(uploadedAttachment.filename).toBe("chat-notes.txt");
              await composer.fill("Read these notes later; just acknowledge.");
              const sent = page.waitForResponse(response => response.request().method() === "POST" &&
                new URL(response.url()).pathname === `/api/issues/${openedChat.id}/comments`);
              await page.getByTestId("task-chat-composer-send").last().click();
              const response = await sent;
              expect(response.status()).toBe(201);
              const comment = await response.json() as { id: string };
              return { issueId: openedChat.id, wakeCommentId: comment.id };
            }
            const currentBrowserContext = await browser.newContext();
            browserContext = currentBrowserContext;
            const [cookieName, ...cookieValue] = context.humanCookie.split("=");
            await currentBrowserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
            const opened = await currentBrowserContext.request.post(`${context.origin}${context.chatPath}`, {
              headers: { origin: context.origin } });
            expect(opened.status()).toBe(200);
            const chat = await opened.json() as { id: string };
            if (scenario.label === "Stop then queued /new resets unpause the conversation without losing history") stopIssueId = chat.id;
            context.onConversationOpened(chat.id);
            const mode = await currentBrowserContext.request.patch(`${context.origin}/api/issues/${chat.id}`, {
              headers: { origin: context.origin }, data: { workMode: "standard" } });
            expect(mode.status()).toBe(200);
            page = await currentBrowserContext.newPage();
            route = context.conversationRoute;
            const entryDiagnostic = attachManagedBrowserEntryDiagnostic(page, context.origin);
            const composer = page.getByTestId("task-chat-composer-input").last()
              .locator('[contenteditable="true"],textarea').first();
            const claim = page.getByRole("button", { name: "Claim this instance", exact: true });
            try {
              await page.goto(`${context.origin}${route}`);
              await browserExpect(composer.or(claim).first()).toBeVisible({ timeout: 30_000 });
            } catch (error) {
              try { await entryDiagnostic.reportFailure("project_card_entry", composer, claim); } catch { /* Preserve the original error. */ }
              throw error;
            } finally {
              entryDiagnostic.dispose();
            }
            if (await claim.isVisible()) {
              const claimed = page.waitForResponse(response => response.request().method() === "POST" &&
                new URL(response.url()).pathname === "/api/bootstrap/claim");
              await claim.click();
              expect((await claimed).status()).toBe(200);
              await page.goto(`${context.origin}${route}`);
            }
            await browserExpect(composer).toBeVisible({ timeout: 30_000 });
            if (scenario.label.startsWith("sidebar discovery")) {
              const managedAgents = context.managedAgents ?? [];
              if (managedAgents.length !== 6) throw new Error("managed_browser_sidebar_agents_missing");
              const dashboard = `${context.origin}${context.conversationRoute.split("/chats/")[0]}/dashboard`;
              await page.goto(dashboard);
              const nav = page.getByRole("navigation");
              const chatLinks = nav.locator('a[href*="/chats/"]');
              await browserExpect(chatLinks).toHaveText(["Alpha"]);
              const compose = nav.getByRole("button", { name: "Chat with an agent", exact: true });
              await compose.click();
              const picker = page.getByRole("dialog", { name: "Choose a Co-worker to ask", exact: true });
              await browserExpect(picker.getByRole("listbox", { name: "Suggestions" }).getByRole("option")).toHaveCount(6);
              const search = picker.getByRole("combobox", { name: "Search Co-workers by name or role" });
              await search.fill("Beta"); await search.press("Enter");
              await browserExpect(picker).not.toBeVisible();
              await browserExpect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
              expect(await (await currentBrowserContext.request.get(
                `${context.origin}/api/companies/${context.companyId}/chats/${managedAgents[1]!.id}`, { headers: { origin: context.origin } })).json()).toBeNull();
              for (const agent of managedAgents) {
                await page.goto(`${context.origin}${context.conversationRoute.split("/chats/")[0]}/chats/${agent.id}`);
                await browserExpect(page.getByTestId("task-chat-composer-input")).toBeVisible();
              }
              await browserExpect(chatLinks).toHaveText(["Alpha", "Zeta", "Epsilon", "Delta", "Gamma"]);
              const star = page.getByRole("button", { name: "Star Zeta", exact: true });
              await page.getByTestId("task-chat-composer-input").hover();
              await browserExpect(star).toHaveCSS("opacity", "0");
              await nav.getByRole("link", { name: "Zeta", exact: true }).focus();
              await page.keyboard.press("Tab");
              await browserExpect(star).toBeFocused(); await browserExpect(star).toHaveCSS("opacity", "1");
              await star.click();
              await page.goto(dashboard);
              await page.getByRole("button", { name: "Star Alpha", exact: true }).click();
              await browserExpect(chatLinks.first()).toHaveText("Alpha");
              await browserExpect(chatLinks.nth(1)).toHaveText("Zeta");
              const editor = page.getByTestId("task-chat-composer-input").locator('[contenteditable="true"]');
              await editor.fill("Unsent draft for Alpha");
              await nav.getByRole("link", { name: "Zeta", exact: true }).click();
              await browserExpect(editor).toHaveText("");
              await nav.getByRole("link", { name: "Alpha", exact: true }).click();
              await browserExpect(editor).toContainText("Unsent draft for Alpha");
              const recent = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
                .filter(([key]) => key.startsWith("paperclip.recentAgentChats:"))));
              await page.getByRole("link", { name: /Configure Alpha/ }).click();
              await browserExpect(page).toHaveURL(/\/agents\/.*\/runtime/);
              const betaChatPath = `/api/companies/${context.companyId}/chats/${managedAgents[1]!.id}`;
              const background = await currentBrowserContext.request.post(`${context.origin}${betaChatPath}`,
                { headers: { origin: context.origin }, data: {} });
              expect(background.status()).toBe(200);
              const backgroundChat = await background.json() as { id: string };
              const backgroundSend = await currentBrowserContext.request.post(
                `${context.origin}/api/issues/${backgroundChat.id}/comments`,
                { headers: { origin: context.origin }, data: { body: "Background activity", clientRequestId: randomUUID() } });
              expect(backgroundSend.status()).toBe(201);
              await browserExpect.poll(async () => {
                const runs = await currentBrowserContext.request.get(
                  `${context.origin}/api/companies/${context.companyId}/heartbeat-runs`, { headers: { origin: context.origin } });
                if (!runs.ok()) return "unavailable";
                const rows = await runs.json() as Array<{ agentId: string; nativeIssueId: string; status: string }>;
                return rows.find(run => run.agentId === managedAgents[1]!.id && run.nativeIssueId === backgroundChat.id)?.status ?? "missing";
              }, { timeout: 120_000 }).toBe("succeeded");
              expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
                .filter(([key]) => key.startsWith("paperclip.recentAgentChats:"))))).toEqual(recent);
              await compose.click();
              const searchAgain = picker.getByRole("combobox", { name: "Search Co-workers by name or role" });
              await browserExpect(searchAgain).toHaveValue("");
              await searchAgain.fill("Beta"); await searchAgain.press("Enter");
              await browserExpect(picker).not.toBeVisible();
              await browserExpect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
              await browserExpect(page.getByText("Background activity", { exact: true })).toBeVisible();
              await page.goto(`${context.origin}${context.conversationRoute}`);
              await browserExpect(page.getByTestId("task-chat-composer-input")).toBeVisible();
              await composer.fill(context.prompt);
              const sent = page.waitForResponse(response => response.request().method() === "POST" &&
                new URL(response.url()).pathname === `/api/issues/${chat.id}/comments`);
              await page.getByTestId("task-chat-composer-send").last().click();
              const response = await sent;
              expect(response.status()).toBe(201);
              const comment = await response.json() as { id: string };
              return { issueId: chat.id, wakeCommentId: comment.id };
            }
            if (scenario.mode) {
              await page.getByTestId("task-chat-composer-mode").click();
              await page.getByTestId("task-chat-composer-mode-menu")
                .getByText(`${scenario.mode === "ask" ? "Ask" : "Plan"} mode`, { exact: true }).click();
            }
            await composer.fill(context.prompt);
            const sent = page.waitForResponse(response => response.request().method() === "POST" &&
              new URL(response.url()).pathname === `/api/issues/${chat.id}/comments`);
            await page.getByTestId("task-chat-composer-send").last().click();
            const response = await sent;
            expect(response.status()).toBe(201);
            const comment = await response.json() as { id: string };
            return { issueId: chat.id, wakeCommentId: comment.id };
          },
          providerReply: async ({ body, callIndex, issueId, runId, completionContract }) => {
            controlledProviderCallIndex = callIndex;
            if (scenario.label === "Stop then queued /new resets unpause the conversation without losing history" &&
                preStopQueuedCommentId && stopActiveRunId && runId !== stopActiveRunId) {
              const [successorRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
              const wakeCommentIds = Array.isArray(successorRun?.contextSnapshot?.wakeCommentIds)
                ? successorRun.contextSnapshot.wakeCommentIds : [];
              expect(wakeCommentIds).not.toContain(preStopQueuedCommentId);
            }
            if (scenario.label.startsWith("sidebar discovery"))
              return { stop_reason: "end_turn", content: [{ type: "text", text: "Background Native activity acknowledged." }] };
            if (scenario.label === "owner recovers after source visibility loss while metric lineage survives") {
              if (!recoveryQuery) throw new Error("managed_browser_recovery_metric_not_prepared");
              const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
              const metricTool = tools.find(tool => tool.name.endsWith("query_business_metric"));
              if (!metricTool) throw new Error("managed_browser_recovery_metric_tool_not_advertised");
              if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use",
                id: `managed-browser-recovery-metric-${runId}`, name: metricTool.name, input: recoveryQuery }] };
              if (callIndex === 2) {
                const messages = Array.isArray(body.messages) ? body.messages as Array<{ content?: Array<Record<string, unknown>> }> : [];
                const result = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
                  .find(block => block.type === "tool_result" && block.tool_use_id === `managed-browser-recovery-metric-${runId}`);
                if (!result || result.is_error === true) throw new Error("managed_browser_recovery_metric_result_missing");
                return { stop_reason: "end_turn", content: [{ type: "text", text: "The published metric was observed with its original source lineage." }] };
              }
              throw new Error(`managed_browser_recovery_unexpected_call_${callIndex}`);
            }
            if (scenario.label === "split handoff commits plans before execution without chat children" ||
                scenario.label === "plan approval hands the preserved revision to an assigned task" ||
                scenario.label === "shared questions resume and existing project reuse creates no project card") {
              const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
              const messages = Array.isArray(body.messages)
                ? body.messages as Array<{ content: Array<Record<string, unknown>> }> : [];
              const findTool = (suffix: string) => tools.find(value => value.name.endsWith(suffix));
              const outputFor = (toolUseId: string) => messages.flatMap(message =>
                Array.isArray(message.content) ? message.content : []).find(block =>
                  block.type === "tool_result" && block.tool_use_id === toolUseId);
              const textFor = (toolUseId: string) => {
                const content = outputFor(toolUseId)?.content;
                return typeof content === "string" ? content : Array.isArray(content)
                  ? content.map(part => String(part.text ?? "")).join("") : "";
              };
              const requireTool = (suffix: string) => {
                const tool = findTool(suffix);
                if (!tool) throw new Error(`managed_browser_workflow_tool_missing_${suffix}`);
                return tool.name;
              };
              if (issueId === workflowChatIssueId && callIndex === 1)
                expect(JSON.stringify(body)).toContain('status: "backlog"');
              if (scenario.label === "plan approval hands the preserved revision to an assigned task" &&
                  issueId === workflowChatIssueId && callIndex === 4) {
                const requestText = JSON.stringify(body);
                expect(requestText).toContain("this approval does not create or start their separate V10 execution plans");
                expect(requestText).toContain("draft Tasks are ready in Backlog");
              }
              if (issueId !== workflowChatIssueId) {
                const write = findTool("write_document");
                const finish = findTool("paperclip_finish");
                if (callIndex === 1) {
                  if (!write) throw new Error("managed_browser_handoff_task_write_document_missing");
                  const [plan] = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(
                    documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
                    .where(and(eq(issueDocuments.companyId, companyIdForApi), eq(issueDocuments.issueId, issueId),
                      eq(issueDocuments.key, "plan"))).limit(1);
                  if (!plan?.body) throw new Error("managed_browser_handoff_task_plan_missing");
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `${runId}-output`,
                    name: write.name, input: { idempotencyKey: `managed-browser-task-output-${runId}`,
                      key: "output", title: "Output", body: `Execution received plan: ${plan.body}`,
                      baseRevisionId: null } }] };
                }
                if (callIndex === 2) {
                  expect(outputFor(`${runId}-output`)?.is_error).not.toBe(true);
                  if (!finish) throw new Error("managed_browser_handoff_task_finish_missing");
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `${runId}-finish`,
                    name: finish.name, input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
                      summary: "Executed the preserved task plan.", completionClaim: {
                        contractRevision: completionContract.revision, objectiveSatisfied: true,
                        criteria: completionContract.criteria.map(criterion => ({ criterionId: criterion.id,
                          status: "satisfied", evidenceRefs: [] })), remainingWork: [],
                      }, evidence: [], verification: [], attentionRequests: [], artifacts: [] } }] };
                }
                throw new Error(`managed_browser_handoff_task_unexpected_call_${callIndex}`);
              }
              if (scenario.label === "shared questions resume and existing project reuse creates no project card") {
                if (callIndex === 1) {
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "managed-browser-audience-question",
                    name: requireTool("request_human_input"), input: {
                      idempotencyKey: `managed-browser-audience-${callId}`, interactionKind: "questions",
                      title: "Welcome note audience", prompt: "Who is the welcome note for?",
                      continuationPolicy: "wake_assignee", payload: { version: 1, questions: [{
                        id: "audience", prompt: "Who is the welcome note for?", selectionMode: "single", required: true,
                        options: [{ id: "garden", label: "Garden club" }, { id: "book", label: "Book club" }],
                      }] },
                    } }] };
                }
                if (callIndex === 2) {
                  expect(outputFor("managed-browser-audience-question")?.is_error).not.toBe(true);
                  return { stop_reason: "end_turn", content: [{ type: "text", text: "Please choose an audience." }] };
                }
                if (callIndex === 3)
                  return { stop_reason: "end_turn", content: [{ type: "text", text: "Reply generation 0: Clarification received." }] };
                if (callIndex === 4) {
                  if (!reusedProjectId) throw new Error("managed_browser_reuse_project_not_created");
                  const taskInput = { title: "Welcome note handoff", projectId: reusedProjectId, status: "backlog",
                    initialPlan: reusedTaskPlan, idempotencyKey: `${callId}-reuse-task` };
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "reuse-task-create",
                    name: requireTool("create_task"), input: taskInput }] };
                }
                if (callIndex === 5) {
                  expect(outputFor("reuse-task-create")?.is_error).not.toBe(true);
                  const created = JSON.parse(textFor("reuse-task-create")) as { task?: { id?: string } };
                  expect(created.task?.id).toBeTruthy();
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "reuse-task-retry",
                    name: requireTool("create_task"), input: { title: "Welcome note handoff", projectId: reusedProjectId, status: "backlog",
                      initialPlan: reusedTaskPlan, idempotencyKey: `${callId}-reuse-task` } }] };
                }
                if (callIndex === 6) {
                  expect(outputFor("reuse-task-retry")?.is_error).not.toBe(true);
                  const first = JSON.parse(textFor("reuse-task-create")) as { task: { id: string } };
                  const replay = JSON.parse(textFor("reuse-task-retry")) as { task: { id: string } };
                  expect(replay.task.id).toBe(first.task.id);
                  return { stop_reason: "end_turn", content: [{ type: "text", text: "Handed off to the existing Garden club project." }] };
                }
                throw new Error(`managed_browser_reuse_unexpected_call_${callIndex}`);
              }
              if (scenario.label === "plan approval hands the preserved revision to an assigned task") {
                if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "approved-plan-write",
                  name: requireTool("write_document"), input: { idempotencyKey: `approved-plan-${callId}`,
                    key: "plan", title: "Plan", body: approvedPlan, baseRevisionId: null } }] };
                if (callIndex === 2) {
                  expect(outputFor("approved-plan-write")?.is_error).not.toBe(true);
                  const document = JSON.parse(textFor("approved-plan-write")) as { document: {
                    id: string; latestRevisionId: string; latestRevisionNumber: number;
                  } };
                  expect(document.document.latestRevisionId).toBeTruthy();
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "approved-plan-confirmation",
                    name: requireTool("request_human_input"), input: {
                      idempotencyKey: `approved-plan-confirmation-${document.document.latestRevisionId}`,
                      interactionKind: "confirmation", title: "Approve handoff", prompt: "Approve handoff of this plan?",
                      targetRevisionId: document.document.latestRevisionId, continuationPolicy: "wake_assignee",
                      payload: { version: 1, prompt: "Approve handoff of this plan?", target: {
                        type: "issue_document", issueId, documentId: document.document.id, key: "plan",
                        revisionId: document.document.latestRevisionId,
                        revisionNumber: document.document.latestRevisionNumber,
                      } },
                    } }] };
                }
                if (callIndex === 3) {
                  expect(outputFor("approved-plan-confirmation")?.is_error).not.toBe(true);
                  return { stop_reason: "end_turn", content: [{ type: "text", text: "The welcome plan is ready for approval." }] };
                }
                if (callIndex === 4) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "approved-project-create",
                  name: requireTool("create_project"), input: projectArgs }] };
                if (callIndex === 5) {
                  expect(outputFor("approved-project-create")?.is_error).not.toBe(true);
                  const project = JSON.parse(textFor("approved-project-create")) as { id: string; name: string; visibility: string };
                  expect(project).toMatchObject({ name: workflowProjectName, visibility: "private" });
                  consumedProjectId = project.id;
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "approved-project-retry",
                    name: requireTool("create_project"), input: projectArgs }] };
                }
                if (callIndex === 6) {
                  expect(outputFor("approved-project-retry")?.is_error).not.toBe(true);
                  expect((JSON.parse(textFor("approved-project-retry")) as { id: string }).id).toBe(consumedProjectId);
                  const taskInput = { title: "Execution 1", projectId: consumedProjectId, status: "backlog", initialPlan: approvedPlan,
                    idempotencyKey: `${callId}-approved-task` };
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "approved-task-create",
                    name: requireTool("create_task"), input: taskInput }] };
                }
                if (callIndex === 7) {
                  expect(outputFor("approved-task-create")?.is_error).not.toBe(true);
                  const task = JSON.parse(textFor("approved-task-create")) as { task: { id: string } };
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "approved-task-retry",
                    name: requireTool("create_task"), input: { title: "Execution 1", projectId: consumedProjectId, status: "backlog",
                      initialPlan: approvedPlan, idempotencyKey: `${callId}-approved-task` } }] };
                }
                if (callIndex === 8) {
                  expect(outputFor("approved-task-retry")?.is_error).not.toBe(true);
                  const first = JSON.parse(textFor("approved-task-create")) as { task: { id: string } };
                  const replay = JSON.parse(textFor("approved-task-retry")) as { task: { id: string } };
                  expect(replay.task.id).toBe(first.task.id);
                  return { stop_reason: "end_turn", content: [{ type: "text", text: "The approved plan was handed off." }] };
                }
                throw new Error(`managed_browser_approval_unexpected_call_${callIndex}`);
              }
              if (scenario.label === "split handoff commits plans before execution without chat children") {
                if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "split-project-create",
                  name: requireTool("create_project"), input: projectArgs }] };
                if (callIndex === 2) {
                  expect(outputFor("split-project-create")?.is_error).not.toBe(true);
                  const project = JSON.parse(textFor("split-project-create")) as { id: string; name: string; visibility: string };
                  expect(project).toMatchObject({ name: workflowProjectName, visibility: "private" });
                  consumedProjectId = project.id;
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "split-project-retry",
                    name: requireTool("create_project"), input: projectArgs }] };
                }
                if (callIndex === 3) {
                  expect(outputFor("split-project-retry")?.is_error).not.toBe(true);
                  expect((JSON.parse(textFor("split-project-retry")) as { id: string }).id).toBe(consumedProjectId);
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "split-plan-write",
                    name: requireTool("write_document"), input: { idempotencyKey: `split-plan-${callId}`,
                      key: "plan", title: "Plan", body: welcomePlan, baseRevisionId: null } }] };
                }
                if (callIndex === 4) {
                  expect(outputFor("split-plan-write")?.is_error).not.toBe(true);
                  const firstTask = { title: "Execution 1", projectId: consumedProjectId, status: "backlog",
                    initialPlan: `${welcomePlan}\nPart 1`, idempotencyKey: `${callId}-split-0` };
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "split-task-0-create",
                    name: requireTool("create_task"), input: firstTask }] };
                }
                if (callIndex === 5) {
                  expect(outputFor("split-task-0-create")?.is_error).not.toBe(true);
                  const input = { title: "Execution 1", projectId: consumedProjectId, status: "backlog",
                    initialPlan: `${welcomePlan}\nPart 1`, idempotencyKey: `${callId}-split-0` };
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "split-task-0-retry",
                    name: requireTool("create_task"), input }] };
                }
                if (callIndex === 6) {
                  expect(outputFor("split-task-0-retry")?.is_error).not.toBe(true);
                  const created = JSON.parse(textFor("split-task-0-create")) as { task: { id: string } };
                  const replay = JSON.parse(textFor("split-task-0-retry")) as { task: { id: string } };
                  expect(replay.task.id).toBe(created.task.id);
                  const input = { title: "Execution 2", projectId: consumedProjectId, status: "backlog",
                    initialPlan: `${welcomePlan}\nPart 2`, idempotencyKey: `${callId}-split-1` };
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "split-task-1-create",
                    name: requireTool("create_task"), input }] };
                }
                if (callIndex === 7) {
                  expect(outputFor("split-task-1-create")?.is_error).not.toBe(true);
                  const input = { title: "Execution 2", projectId: consumedProjectId, status: "backlog",
                    initialPlan: `${welcomePlan}\nPart 2`, idempotencyKey: `${callId}-split-1` };
                  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "split-task-1-retry",
                    name: requireTool("create_task"), input }] };
                }
                if (callIndex === 8) {
                  expect(outputFor("split-task-1-retry")?.is_error).not.toBe(true);
                  const created = JSON.parse(textFor("split-task-1-create")) as { task: { id: string } };
                  const replay = JSON.parse(textFor("split-task-1-retry")) as { task: { id: string } };
                  expect(replay.task.id).toBe(created.task.id);
                  return { stop_reason: "end_turn", content: [{ type: "text", text: "Handed off two execution tasks." }] };
                }
                throw new Error(`managed_browser_split_unexpected_call_${callIndex}`);
              }
            }
            if (scenario.label === "Stop then queued /new resets unpause the conversation without losing history") {
              if (callIndex === 1) {
                const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
                const progress = tools.find(value => value.name.endsWith("report_progress"));
                if (!progress) throw new Error("managed_browser_stop_report_progress_tool_missing");
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "stop-stream-ready",
                  name: progress.name, input: { idempotencyKey: `stop-ready-${callId}`, body: "Provider is streaming and ready to stop." } }] };
              }
              if (callIndex === 2) {
                const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
                stopProgressCommentId = successfulProgressToolResult(messages, "stop-stream-ready", issueId);
                return { stop_reason: "end_turn", content: [{ type: "text", text: "Stopped turn must not be accepted." }] };
              }
              return { stop_reason: "end_turn", content: [{ type: "text", text: "Reply generation 2: Fresh followup" }] };
            }
            if (scenario.label === "shared history loads older messages without replacing the latest turn") {
              const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
              const messages = Array.isArray(body.messages)
                ? body.messages as Array<Record<string, unknown>> : [];
              const priorId = `history-${String(callIndex - 2).padStart(2, "0")}`;
              if (callIndex > 1)
                historyProgressResultCommentIds.push(successfulProgressToolResult(messages, priorId, issueId));
              if (callIndex <= 65) {
                const progress = tools.find(value => value.name.endsWith("report_progress"));
                if (!progress) throw new Error("managed_browser_history_report_progress_tool_missing");
                const index = callIndex - 1;
                const suffix = String(index).padStart(2, "0");
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `history-${suffix}`,
                  name: progress.name, input: { idempotencyKey: `managed-browser-history-${callId}-${suffix}`,
                    body: `History message ${suffix}` } }] };
              }
              return { stop_reason: "end_turn", content: [{ type: "text", text: "History archive ready." }] };
            }
            if (scenario.label === "read-only first open and concurrent first sends") {
              const expectedText = callIndex <= 2 ? "Same first message" : "Retry once";
              const generation = callIndex <= 2 ? 0 : 0;
              return { stop_reason: "end_turn", content: [{ type: "text",
                text: `Reply generation ${generation}: ${expectedText}` }] };
            }
            if (scenario.repositorySelection) {
              const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
              const messages = Array.isArray(body.messages)
                ? body.messages as Array<{ content: Array<Record<string, unknown>> }> : [];
              const outputFor = (toolUseId: string) => messages
                .flatMap(message => Array.isArray(message.content) ? message.content : [])
                .find(block => block.type === "tool_result" && block.tool_use_id === toolUseId);
              const textFor = (toolUseId: string) => {
                const content = outputFor(toolUseId)?.content;
                return typeof content === "string" ? content : Array.isArray(content)
                  ? content.map(part => String(part.text ?? "")).join("") : "";
              };
              const listTool = tools.find(value => value.name.endsWith("list_project_repositories"));
              const projectTool = tools.find(value => value.name.endsWith("create_project"));
              if (callIndex === 1) {
                if (!listTool) throw new Error("managed_browser_repository_discovery_tool_missing");
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "repository-discovery",
                  name: listTool.name, input: {} }] };
              }
              if (callIndex === 2) {
                expect(outputFor("repository-discovery")?.is_error).not.toBe(true);
                const catalog = JSON.parse(textFor("repository-discovery")) as { repositories: Array<{ id: string }> };
                discoveredRepositoryIds = catalog.repositories.map(repository => repository.id).sort();
                expect(discoveredRepositoryIds).toEqual(["101", "102"]);
                if (!projectTool) throw new Error("managed_browser_repository_create_project_tool_missing");
                const input = { name, idempotencyKey: callId, repositoryIds: scenario.repositorySelection.ids,
                  ...(scenario.repositorySelection.urls.length ? { repositoryUrls: scenario.repositorySelection.urls } : {}) };
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: callId,
                  name: projectTool.name, input }] };
              }
              if (callIndex === 3) {
                expect(outputFor(callId)?.is_error).not.toBe(true);
                const project = JSON.parse(textFor(callId)) as { id: string; name: string; visibility: string };
                expect(project).toMatchObject({ name, visibility: "private" });
                consumedProjectId = project.id;
                return { stop_reason: "end_turn", content: [{ type: "text", text: "Project created." }] };
              }
              throw new Error(`managed_browser_repository_unexpected_provider_call_${callIndex}`);
            }
            if (scenario.featureFlag) {
              const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
              const messages = Array.isArray(body.messages)
                ? body.messages as Array<{ content: Array<Record<string, unknown>> }> : [];
              if (callIndex === 1) {
                const progressTool = tools.find(value => value.name.endsWith("report_progress"));
                if (!progressTool) throw new Error("managed_browser_feature_flag_report_progress_tool_missing");
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "feature-flag-progress",
                  name: progressTool.name, input: { idempotencyKey: `feature-flag-progress-${callId}`,
                    body: "Turn started before feature disable." } }] };
              }
              if (callIndex === 2) {
                featureFlagProgressCommentId = successfulProgressToolResult(
                  messages as Array<Record<string, unknown>>, "feature-flag-progress", issueId);
                return { stop_reason: "end_turn", content: [{ type: "text",
                  text: "Active turn settled after feature disable." }] };
              }
              if (callIndex === 3) return { stop_reason: "end_turn", content: [{ type: "text",
                text: "Visible history remains available." }] };
              throw new Error(`managed_browser_feature_flag_unexpected_provider_call_${callIndex}`);
            }
            if (scenario.sourceUi && scenario.sourceUi !== "owner_recovery") {
              expect(callIndex).toBe(1);
              return undefined;
            }
            if (scenario.attachment) {
              expect(callIndex).toBe(1);
              const messages = JSON.stringify(body.messages);
              providerSawAttachment = messages.includes(".paperclip-inbound") && messages.includes("chat-notes.txt");
              expect(providerSawAttachment).toBe(true);
              return undefined;
            }
            const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
            const messages = Array.isArray(body.messages)
              ? body.messages as Array<{ content: Array<Record<string, unknown>> }> : [];
            const outputFor = (toolUseId: string) => messages
              .flatMap(message => Array.isArray(message.content) ? message.content : [])
              .find(block => block.type === "tool_result" && block.tool_use_id === toolUseId);
            const textFor = (toolUseId: string) => {
              const content = outputFor(toolUseId)?.content;
              return typeof content === "string" ? content : Array.isArray(content)
                ? content.map(part => String(part.text ?? "")).join("") : "";
            };
            const projectTool = tools.find(value => value.name.endsWith("create_project"));
            const apiTool = tools.find(value => value.name.endsWith("call_api"));
            const writeDocumentTool = tools.find(value => value.name.endsWith("write_document"));
            if (scenario.mode) {
              if (callIndex === 1) {
                modeProjectToolAdvertised = Boolean(projectTool);
                expect(modeProjectToolAdvertised).toBe(false);
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: callId,
                  // The catalog intentionally excludes this mode-forbidden tool.
                  // This controlled response checks the pinned SDK's local unknown-tool result;
                  // it does not ask the Paperclip server to deny an advertised operation.
                  name: "paperclip-self:create_project", input: projectArgs }] };
              }
              if (callIndex === 2) {
                const result = outputFor(callId);
                expect(result?.is_error).toBe(true);
                modeProjectToolResult = textFor(callId);
                expect(modeProjectToolResult).toContain("Unknown tool: paperclip-self:create_project");
                modeProjectRejectionClass = "sdk-unknown-tool";
                return { stop_reason: "end_turn", content: [{ type: "text",
                  text: `Project mutation ${modeProjectRejectionClass}: ${modeProjectToolResult}` }] };
              }
              if (scenario.mode === "planning" && callIndex === 3) {
                if (!writeDocumentTool) throw new Error("managed_browser_plan_write_document_tool_missing");
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "managed-plan-draft",
                  name: writeDocumentTool.name, input: { key: "plan", title: "Plan",
                    body: "# Draft plan\nDiscuss the goal.", baseRevisionId: null,
                    idempotencyKey: `managed-plan-draft-${callId}` } }] };
              }
              if (scenario.mode === "planning" && callIndex === 4) {
                const result = outputFor("managed-plan-draft");
                if (result?.is_error) planWriteError = textFor("managed-plan-draft");
                expect(result?.is_error).not.toBe(true);
                return undefined;
              }
              if (scenario.mode === "planning" && callIndex === 5) {
                if (!writeDocumentTool || !firstPlanRevisionId)
                  throw new Error("managed_browser_plan_revision_base_missing");
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "managed-plan-revision",
                  name: writeDocumentTool.name, input: { key: "plan", title: "Plan",
                    body: "# Revised plan\nDiscuss the revised goal.", baseRevisionId: firstPlanRevisionId,
                    idempotencyKey: `managed-plan-revision-${callId}` } }] };
              }
              if (scenario.mode === "planning" && callIndex === 6) {
                const result = outputFor("managed-plan-revision");
                if (result?.is_error) planWriteError = textFor("managed-plan-revision");
                expect(result?.is_error).not.toBe(true);
                return undefined;
              }
              throw new Error(`managed_browser_mode_unexpected_provider_call_${callIndex}`);
            }
            if (callIndex === 1) {
              if (scenario.directApi) {
                if (!apiTool) throw new Error("managed_browser_call_api_tool_missing");
                return { stop_reason: "tool_use", content: [{ type: "tool_use", id: callId, name: apiTool.name,
                  input: { operationId: "POST /api/companies/{companyId}/projects",
                    pathParams: { companyId: companyIdForApi }, body: projectArgs } }] };
              }
              if (!projectTool) throw new Error("managed_browser_project_tool_missing");
              return { stop_reason: "tool_use", content: [{ type: "tool_use", id: callId, name: projectTool.name,
                input: scenario.invalid ? scenario.invalid(name, callId) : projectArgs }] };
            }
            if (callIndex === 2) {
              if (scenario.invalid) {
                const output = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
                  .find(block => block.type === "tool_result" && block.tool_use_id === callId);
                expect(output?.is_error).toBe(true);
                const failure = textFor(callId);
                return { stop_reason: "end_turn", content: [{ type: "text", text: `Expected tool result: ${failure}` }] };
              }
              expect(outputFor(callId)?.is_error).not.toBe(true);
              let project: { id: string; name: string; visibility: string };
              if (scenario.directApi) {
                const envelope = JSON.parse(textFor(callId)) as { ok: boolean; callId: string;
                  result: { ok: boolean; status: number; data: typeof project } };
                expect(envelope).toMatchObject({ ok: true, callId, result: { ok: true, status: 201 } });
                project = envelope.result.data;
              } else project = JSON.parse(textFor(callId)) as typeof project;
              expect(project).toMatchObject({ name, visibility: "private" });
              consumedProjectId = project.id;
              if (!projectTool) throw new Error("managed_browser_project_retry_tool_missing");
              return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `${callId}-retry`,
                name: projectTool.name, input: projectArgs }] };
            }
            if (scenario.invalid) throw new Error(`managed_browser_invalid_project_unexpected_provider_retry_${callIndex}`);
            if (callIndex === 3) {
              expect(outputFor(`${callId}-retry`)?.is_error).not.toBe(true);
              const retried = JSON.parse(textFor(`${callId}-retry`)) as { id: string; name: string };
              expect(retried).toMatchObject({ id: consumedProjectId, name });
              return undefined;
            }
            // The browser journey below sends /new through the real chat UI.
            // Its next provider response is an ordinary controlled model reply.
            expect(callIndex).toBe(4);
            return undefined;
          },
          beforeProviderResponse: async () => {
            if (scenario.featureFlag && controlledProviderCallIndex === 2) {
              activeReplyGateReached = true;
              signalActiveReplyGateReached();
              await activeReplyGate;
            }
            if (scenario.label === "Stop then queued /new resets unpause the conversation without losing history" &&
                controlledProviderCallIndex === 2) {
              if (!page || !browserContext || !stopIssueId) throw new Error("managed_browser_stop_context_missing");
              await browserExpect.poll(async () => {
                const response = await browserContext!.request.get(`${origin}/api/issues/${stopIssueId}/comments`, { headers: { origin } });
                if (!response.ok()) return false;
                const comments = await response.json() as Array<{ body: string }>;
                return comments.some(comment => comment.body === "Provider is streaming and ready to stop.");
              }, { timeout: 30_000 }).toBe(true);
              const live = await browserContext.request.get(`${origin}/api/issues/${stopIssueId}/live-runs`, { headers: { origin } });
              expect(live.status()).toBe(200);
              const active = (await live.json() as Array<{ id: string }>)[0];
              if (!active) throw new Error("managed_browser_stop_active_run_missing");
              stopActiveRunId = active.id;
              const sendFromUi = async (text: string) => {
                const composer = page!.getByTestId("task-chat-composer-input").last()
                  .locator('[contenteditable="true"],textarea').first();
                await composer.fill(text);
                const sent = page!.waitForResponse(response => response.request().method() === "POST" &&
                  new URL(response.url()).pathname === `/api/issues/${stopIssueId}/comments`);
                await page!.getByTestId("task-chat-composer-send").last().click();
                const response = await sent;
                expect(response.status()).toBe(201);
                return await response.json() as { id: string };
              };
              preStopQueuedCommentId = (await sendFromUi(preStopQueuedCommentBody)).id;
              expect(preStopQueuedCommentId).toBeTruthy();
              await browserExpect.poll(async () => {
                const wakes = await db.select().from(agentWakeupRequests).where(and(
                  eq(agentWakeupRequests.companyId, companyIdForApi),
                  eq(agentWakeupRequests.agentId, stopAgentId!),
                  eq(agentWakeupRequests.status, "deferred_issue_execution"),
                ));
                return wakes.find(wake => {
                  const context = wake.payload?._paperclipWakeContext as Record<string, unknown> | undefined;
                  const ids = Array.isArray(context?.wakeCommentIds) ? context.wakeCommentIds : [];
                  return wake.payload?.commentId === preStopQueuedCommentId || context?.wakeCommentId === preStopQueuedCommentId || ids.includes(preStopQueuedCommentId);
                }) ?? null;
              }, { timeout: 30_000 }).toBeTruthy();
              await page.getByTestId("task-chat-composer-stop").click();
              await browserExpect.poll(async () => {
                const response = await browserContext!.request.get(`${origin}/api/heartbeat-runs/${active.id}`, { headers: { origin } });
                return response.ok() ? (await response.json() as { status: string }).status : "unavailable";
              }, { timeout: 30_000 }).toBe("cancelled");
              const staleToken = stopAgentId ? createLocalAgentJwt(stopAgentId, companyIdForApi, "process", active.id) : null;
              if (!staleToken) throw new Error("managed_browser_stop_stale_token_missing");
              const late = await browserContext.request.post(`${origin}/api/issues/${stopIssueId}/comments`, {
                headers: { origin, authorization: `Bearer ${staleToken}` }, data: { body: "Forbidden late response" },
              });
              expect([403, 404, 409]).toContain(late.status());
              const mutation = await browserContext.request.post(`${origin}/api/companies/${companyIdForApi}/projects`, {
                headers: { origin, authorization: `Bearer ${staleToken}` }, data: { name: "Cancelled project" },
              });
              expect([403, 404, 409]).toContain(mutation.status());
              const projectsResponse = await browserContext.request.get(`${origin}/api/companies/${companyIdForApi}/projects`, { headers: { origin } });
              expect(projectsResponse.status()).toBe(200);
              expect(await projectsResponse.json()).toHaveLength(0);
              await sendFromUi("/new");
              await sendFromUi("/new");
              await sendFromUi("Fresh followup");
              stopResetActionsCompleted = true;
            }
          },
          afterRunSettledBeforeTeardown: async facts => {
            if (scenario.label === "Stop then queued /new resets unpause the conversation without losing history")
              expect(facts.run?.status).toBe("cancelled");
            else expect(facts.run?.status).toBe("succeeded");
            if (scenario.label === "shared history loads older messages without replacing the latest turn") {
              if (facts.providerWireBodyBytes.length < 66 || facts.providerWireBodyBytes.some(bytes => bytes > 64 * 1024))
                throw new Error("managed_browser_history_provider_wire_size_bound_missing_or_exceeded");
            }
            if (scenario.label === "Ask mode denies project mutation" ||
                scenario.label === "Plan mode denies project mutation and revises plan") {
              expect(modeProjectToolAdvertised).toBe(false);
              expect(modeProjectToolResult).toContain("Unknown tool: paperclip-self:create_project");
              const profile = facts.run?.runnerProfileJson && typeof facts.run.runnerProfileJson === "object"
                ? facts.run.runnerProfileJson as Record<string, unknown> : {};
              const associations = Array.isArray(profile.nativeToolCallDispatchAssociations)
                ? profile.nativeToolCallDispatchAssociations as Array<Record<string, unknown>> : [];
              expect(associations.some(association => ["create_project", "call_api"].includes(String(association.tool))))
                .toBe(false);
            }
            if (scenario.label.startsWith("sidebar discovery")) {
              const namedAgents = await db.select({ id: agents.id, name: agents.name }).from(agents)
                .where(eq(agents.companyId, facts.companyId));
              const beta = namedAgents.find(agent => agent.name === "Beta");
              const alpha = namedAgents.find(agent => agent.name === "Alpha");
              expect(beta).toBeTruthy(); expect(alpha?.id).toBe(facts.agentId);
              const runs = await db.select().from(heartbeatRuns).where(and(
                eq(heartbeatRuns.companyId, facts.companyId), eq(heartbeatRuns.agentId, beta!.id)));
              expect(runs).toHaveLength(1);
              expect(runs[0]).toMatchObject({ status: "succeeded", runtimeMode: "native", nativeIssueId: expect.any(String) });
              const betaComments = await db.select().from(issueComments).where(and(
                eq(issueComments.companyId, facts.companyId), eq(issueComments.issueId, runs[0]!.nativeIssueId!)));
              expect(betaComments.some(comment => comment.body === "Background activity" && comment.authorUserId === facts.actor.userId)).toBe(true);
              expect(betaComments.some(comment => comment.authorAgentId === beta!.id && comment.createdByRunId === runs[0]!.id)).toBe(true);
              const activeHosts = facts.sandboxRuntimeFacts ?? {};
              expect(activeHosts).toMatchObject({ mode: "conversation_multi_agent_serial_signed_hosts" });
              return;
            }
            if (scenario.label === "owner recovers after source visibility loss while metric lineage survives") {
              if (!browserContext || !page || !recoveryMetricId || !recoveryMetricVersionId || !recoverySourceIssueId || !facts.run)
                throw new Error("managed_browser_recovery_facts_missing");
              const [observation] = await db.select().from(businessMetricObservations)
                .where(eq(businessMetricObservations.metricId, recoveryMetricId));
              expect(observation).toBeTruthy();
              recoveryObservationId = observation!.id;
              const [runRow] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, facts.run.id));
              expect(runRow?.responsibleUserId).toBe(facts.actor.userId);
              const profile = runRow!.runnerProfileJson as Record<string, unknown>;
              const captures = Array.isArray(profile.nativeToolResultSourceCaptures)
                ? profile.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
              const metricCaptures = captures.filter(capture => capture.tool === "query_business_metric" &&
                capture.nativeReadResult === true && capture.sourceSet && typeof capture.sourceSet === "object" &&
                !Array.isArray(capture.sourceSet) && Array.isArray((capture.sourceSet as Record<string, unknown>).inputs));
              expect(metricCaptures).toHaveLength(1);
              const capture = metricCaptures[0]!;
              const sourceSet = capture.sourceSet as { policy: unknown; inputs: Array<Record<string, unknown>> };
              const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
              expect(receipt.success).toBe(true);
              const receiptInputs = receipt.success ? receipt.data.additionalInputs : [];
              const toolSource = capture.source as { kind?: string; runId?: string; callId?: string;
                toolName?: string; contentHash?: string } | null;
              const exactReceiptInput = receiptInputs.find(entry => entry.responsibleUserId === runRow!.responsibleUserId &&
                JSON.stringify(entry.policy) === JSON.stringify(sourceSet.policy) &&
                entry.inputs.length === sourceSet.inputs.length + 1 &&
                JSON.stringify(entry.inputs[0]) === JSON.stringify(toolSource) &&
                entry.inputs.slice(1).every((input, index) => JSON.stringify(input) === JSON.stringify(sourceSet.inputs[index])));
              expect(runRow!.nativeInputSourceProtocolVersion).toBe(1);
              expect(toolSource).toMatchObject({ kind: "tool_result", runId: facts.run.id,
                callId: capture.callId, toolName: "query_business_metric", invocationId: null,
                contentHash: capture.resultDigest });
              const binding = receipt.success ? receipt.data.binding : null;
              expect(binding).toMatchObject({ companyId: facts.companyId, runId: facts.run.id,
                agentId: facts.agentId, issueId: facts.issueId, responsibleUserId: facts.actor.userId });
              expect(exactReceiptInput).toBeTruthy();
              const runProfile = runRow!.runnerProfileJson as Record<string, unknown>;
              const dispatchIntents = Array.isArray(runProfile.nativeModelInputDispatchIntents)
                ? runProfile.nativeModelInputDispatchIntents as Array<Record<string, unknown>> : [];
              const associations = Array.isArray(runProfile.nativeToolCallDispatchAssociations)
                ? runProfile.nativeToolCallDispatchAssociations as Array<Record<string, unknown>> : [];
              expect(dispatchIntents.filter(intent => intent.eventSeq === capture.eventSeq &&
                intent.attempt === capture.attempt).length).toBe(1);
              expect(associations.filter(association => association.callId === capture.callId &&
                association.eventSeq === capture.eventSeq && association.attempt === capture.attempt).length).toBe(1);
              const [retention] = await db.select().from(memoryRecords).where(and(
                eq(memoryRecords.createdByActorId, "native_analytical_retention"),
                eq(memoryRecords.companyId, facts.companyId), eq(memoryRecords.ownerAgentId, facts.agentId)));
              expect(retention).toBeTruthy();
              recoveryRetentionId = retention!.id;
              const sourceInputs = sourceSet.inputs.filter(input => input.kind === "context");
              expect(sourceInputs).toHaveLength(1);
              const resultContextId = sourceInputs[0]!.manifestId as string;
              const [resultContext] = await db.select().from(contextManifests).where(eq(contextManifests.id, resultContextId));
              expect(resultContext).toMatchObject({ companyId: facts.companyId, runId: facts.run.id,
                agentId: facts.agentId, issueId: facts.issueId });
              const retainedRoots = await db.select().from(contextManifestMemoryRoots)
                .where(eq(contextManifestMemoryRoots.manifestId, resultContextId));
              expect(retainedRoots.some(row => row.memoryRecordId === retention!.id)).toBe(true);
              const bootstrap = Array.isArray(runProfile.nativeBootstrapContextManifests)
                ? runProfile.nativeBootstrapContextManifests as Array<{ contextManifestId: string }> : [];
              expect(bootstrap).toHaveLength(1);
              expect(bootstrap[0]!.contextManifestId).not.toBe(resultContextId);
              const bootstrapRoots = await db.select().from(contextManifestMemoryRoots)
                .where(eq(contextManifestMemoryRoots.manifestId, bootstrap[0]!.contextManifestId));
              expect(bootstrapRoots.some(row => row.memoryRecordId === retention!.id)).toBe(false);
              const roots = await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId, retention!.id));
              expect(roots.some(row => Array.isArray(row.authorityPins) && row.authorityPins.some(pin =>
                typeof pin === "object" && pin !== null && (pin as { kind?: unknown }).kind === "analytical_evidence" &&
                JSON.stringify(pin).includes(recoveryObservationId!)))).toBe(true);
              const dependencies = await db.select().from(analyticalContextDependencies)
                .where(eq(analyticalContextDependencies.memoryRecordId, retention!.id));
              expect(dependencies.some(row => row.sourceManifestId === observation!.lineageManifestId)).toBe(true);
              await page.goto(`${origin}${route}`);
              await browserExpect(page.getByText("Observe the published metric and explain its result.", { exact: true })).toBeVisible();
              const hidden = await browserContext.request.patch(`${origin}/api/issues/${recoverySourceIssueId}`, {
                headers: { origin }, data: { hiddenAt: new Date().toISOString() },
              });
              expect(hidden.status()).toBe(200);
              const denied = await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/chats/${facts.agentId}`,
                { headers: { origin } });
              expect(denied.status()).toBe(403);
              expect((await denied.json() as { details?: { conversationIssueId?: string } }).details?.conversationIssueId).toBe(facts.issueId);
              await page.reload();
              await browserExpect(page.getByRole("button", { name: "Start a new conversation" })).toBeVisible();
              await browserExpect(page.getByText("Observe the published metric and explain its result.", { exact: true })).toHaveCount(0);
              await page.getByRole("button", { name: "Start a new conversation" }).click();
              await browserExpect(page.getByTestId("task-chat-composer-input")).toBeVisible();
              const fresh = await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/chats/${facts.agentId}`,
                { headers: { origin } });
              expect(fresh.status()).toBe(200);
              expect((await fresh.json() as { id: string }).id).not.toBe(facts.issueId);
              const oldHistory = await browserContext.request.get(`${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
              expect(oldHistory.status()).toBe(404);
              const [deletedRetention] = await db.select({ deletedAt: memoryRecords.deletedAt })
                .from(memoryRecords).where(eq(memoryRecords.id, retention!.id));
              expect(deletedRetention?.deletedAt).not.toBeNull();
              expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id, observation!.id))).length).toBe(1);
              expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id, recoveryMetricVersionId!))).length).toBe(1);
              return;
            }
            if (scenario.label === "split handoff commits plans before execution without chat children" ||
                scenario.label === "plan approval hands the preserved revision to an assigned task" ||
                scenario.label === "shared questions resume and existing project reuse creates no project card") {
              if (!browserContext || !page || !workflowChatIssueId) throw new Error("managed_browser_workflow_context_missing");
              const issueList = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin } });
              expect(issueList.status()).toBe(200);
              const taskRows = await issueList.json() as Array<{ id: string; title: string; status: string;
                updatedAt: string; parentId: string | null; projectId: string | null; assigneeAgentId: string | null }>;
              const expectedTaskCount = scenario.label === "split handoff commits plans before execution without chat children" ? 2 : 1;
              expect(taskRows).toHaveLength(expectedTaskCount);
              const expectedProjectId = scenario.label === "shared questions resume and existing project reuse creates no project card"
                ? reusedProjectId : consumedProjectId;
              expect(expectedProjectId).toBeTruthy();
              const expectedInitialPlans = scenario.label === "split handoff commits plans before execution without chat children"
                ? ["Welcome plan\nPart 1", "Welcome plan\nPart 2"]
                : scenario.label === "plan approval hands the preserved revision to an assigned task"
                  ? [approvedPlan] : [reusedTaskPlan];
              taskRows.sort((left, right) => left.title.localeCompare(right.title));
              const createdPlans: Array<{ id: string; taskId: string; workerId: string }> = [];
              for (const [index, task] of taskRows.entries()) {
                expect(task).toMatchObject({ status: "backlog", parentId: null, projectId: expectedProjectId,
                  assigneeAgentId: facts.agentId });
                const initialPlanResponse = await browserContext.request.get(
                  `${origin}/api/issues/${task.id}/documents/plan`, { headers: { origin } });
                expect(initialPlanResponse.status()).toBe(200);
                const initialPlan = await initialPlanResponse.json() as { body: string };
                expect(initialPlan.body).toBe(expectedInitialPlans[index]);

                // The chat handoff creates a standalone Task and its persisted initialPlan. A Human
                // separately writes and starts the bounded V10 plan through the existing control API.
                // This keeps chat-plan approval distinct from orchestration-plan approval.
                const createdPlanResponse = await browserContext.request.post(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans`, { headers: { origin }, data: {
                    issueId: task.id, expectedIssueUpdatedAt: task.updatedAt, riskClass: "C0", actionClass: "internal_draft",
                    workload: "semantic", workflowId: null, acceptedPlanRevisionId: null,
                    supervisionPolicy: { repeatedFailureThreshold: 3, noProgressSeconds: null,
                      minCheckIntervalSeconds: 30, maxSupervisorChecks: 100, maxVerifierCalls: 1, maxVerificationDepth: 1 },
                    completionContract: { objective: `Complete the exact persisted Task plan: ${initialPlan.body}`,
                      requiredOutputs: [{ kind: "task_document", key: "output", jsonSchema: null }],
                      businessInvariants: ["Follow the exact persisted task plan for this internal draft."],
                      evidenceRequirements: ["The output document records completed work against the exact task plan."],
                      prohibitedOutcomes: ["Do not send externally, spend money, delete data, or change permissions."],
                      requiredPostconditions: [] },
                    budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 0, maxRetries: 0,
                      maxWallClockSeconds: 300, maxModelCostMinor: 1000, maxToolActions: 8 },
                    workers: [{ key: "execution", issueId: task.id, dependsOn: [] }],
                  } });
                expect(createdPlanResponse.status()).toBe(201);
                const createdPlan = await createdPlanResponse.json() as { id: string; issueId: string; status: string;
                  version: number; createdBy: string | null; acceptedPlanRevisionId: string | null; budgets: Record<string, unknown> };
                expect(createdPlan).toMatchObject({ issueId: task.id, status: "draft", acceptedPlanRevisionId: null,
                  createdBy: facts.actor.userId, budgets: { maxWorkerCount: 1, maxParallelWorkers: 1,
                    maxDelegationDepth: 0, maxRetries: 0, maxWallClockSeconds: 300, maxModelCostMinor: 1000, maxToolActions: 8 } });
                const detailBeforeStartResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}`, { headers: { origin } });
                expect(detailBeforeStartResponse.status()).toBe(200);
                const detailBeforeStart = await detailBeforeStartResponse.json() as { status: string; version: number;
                  completionContractId: string; workers: Array<{ id: string; issueId: string; status: string }>; attempts: Array<unknown> };
                expect(detailBeforeStart).toMatchObject({ status: "draft", workers: [{ issueId: task.id, status: "waiting" }], attempts: [] });
                expect(detailBeforeStart.version).toBe(createdPlan.version);
                const worker = detailBeforeStart.workers.find(row => row.issueId === task.id);
                expect(worker).toBeTruthy();
                createdPlans.push({ id: createdPlan.id, taskId: task.id, workerId: worker!.id });
              }
              // Prove none of the Native create_task calls dispatched a Worker on its own.
              const preStartLedger = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/heartbeat-runs`, { headers: { origin } });
              expect(preStartLedger.status()).toBe(200);
              const preStartRuns = await preStartLedger.json() as Array<{ contextSnapshot?: { issueId?: string } }>;
              expect(preStartRuns.some(run => taskRows.some(task => run.contextSnapshot?.issueId === task.id))).toBe(false);
              for (const createdPlan of createdPlans) {
                const detailResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}`, { headers: { origin } });
                const detail = await detailResponse.json() as { version: number; attempts: Array<unknown> };
                const startResponse = await browserContext.request.post(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}/decisions`, {
                    headers: { origin }, data: { expectedVersion: detail.version, action: "start",
                      rationale: "Start the reviewed bounded internal draft for this assigned Task." },
                  });
                expect(startResponse.status()).toBe(200);
                const started = await startResponse.json() as { plan: { status: string }; runtime?: unknown };
                expect(started.plan.status).toBe("running");
                const afterStartResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}`, { headers: { origin } });
                const afterStart = await afterStartResponse.json() as { status: string; attempts: Array<unknown> };
                expect(afterStart.status).toBe("running");
                expect(afterStart.attempts).toHaveLength(0);
                const task = taskRows.find(row => row.id === createdPlan.taskId)!;
                const readyResponse = await browserContext.request.patch(`${origin}/api/issues/${task.id}`, {
                  headers: { origin }, data: { status: "todo" },
                });
                expect(readyResponse.status()).toBe(200);
              }
              await browserExpect.poll(async () => {
                for (const createdPlan of createdPlans) {
                  // Reading the canonical packet reconciles a terminal heartbeat run into its
                  // worker attempt. A plan-detail GET alone does not perform that reconciliation.
                  const response = await browserContext!.request.get(
                    `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}/verification-packet`, { headers: { origin } });
                  if (!response.ok()) return false;
                  const packet = await response.json() as { liveAttempts: number; deterministicFailures: string[];
                    evidence: Array<{ type: string }> };
                  if (packet.liveAttempts !== 0 || packet.deterministicFailures.length !== 0 ||
                      !packet.evidence.some(evidence => evidence.type === "task_document")) return false;
                }
                return true;
              }, { timeout: 120_000 }).toBe(true);
              // A successful worker attempt only supplies evidence. The current Human must review the
              // live verification packet and explicitly record the existing independent-review action
              // before the status committer can complete the Task or its orchestration plan.
              for (const createdPlan of createdPlans) {
                const planResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}`, { headers: { origin } });
                expect(planResponse.status()).toBe(200);
                const planBeforeReview = await planResponse.json() as { id: string; status: string; version: number };
                expect(planBeforeReview).toMatchObject({ id: createdPlan.id, status: "running" });
                const issueResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin } });
                expect(issueResponse.status()).toBe(200);
                const rows = await issueResponse.json() as Array<{ id: string; status: string }>;
                expect(rows.find(row => row.id === createdPlan.taskId)?.status).toBe("in_review");
                const packetResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}/verification-packet`, { headers: { origin } });
                expect(packetResponse.status()).toBe(200);
                const packet = await packetResponse.json() as { planId: string; planVersion: number; issueId: string;
                  resultHash: string; contract: { businessInvariants: string[]; evidenceRequirements: string[]; prohibitedOutcomes: string[] };
                  evidence: Array<{ ref: string; type: string }>; deterministicFailures: string[]; liveAttempts: number;
                  policy: { humanRequired: boolean } };
                expect(packet).toMatchObject({ planId: createdPlan.id, planVersion: planBeforeReview.version,
                  issueId: createdPlan.taskId, liveAttempts: 0, deterministicFailures: [] });
                const reviewedOutput = packet.evidence.find(evidence => evidence.type === "task_document");
                expect(reviewedOutput?.ref).toBeTruthy();
                const taskIndex = taskRows.findIndex(task => task.id === createdPlan.taskId);
                expect(taskIndex).toBeGreaterThanOrEqual(0);
                const expectedPlanText = expectedInitialPlans[taskIndex]!;
                const planDocumentResponse = await browserContext.request.get(
                  `${origin}/api/issues/${createdPlan.taskId}/documents/plan`, { headers: { origin } });
                expect(planDocumentResponse.status()).toBe(200);
                const planDocument = await planDocumentResponse.json() as { id: string; body: string; latestRevisionId: string };
                expect(planDocument.body).toBe(expectedPlanText);
                const outputDocumentResponse = await browserContext.request.get(
                  `${origin}/api/issues/${createdPlan.taskId}/documents/output`, { headers: { origin } });
                expect(outputDocumentResponse.status()).toBe(200);
                const outputDocument = await outputDocumentResponse.json() as { id: string; body: string; latestRevisionId: string };
                expect(outputDocument.body).toContain(expectedPlanText);
                expect(outputDocument.body).toContain(planDocument.body);
                expect(reviewedOutput).toMatchObject({ sourceId: outputDocument.id,
                  sourceVersion: outputDocument.latestRevisionId });
                const judgement = (values: string[]) => values.map((_, index) => ({ index, satisfied: true,
                  evidenceRefs: [reviewedOutput!.ref] }));
                const reviewed = await browserContext.request.post(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}/verify`, {
                    headers: { origin }, data: { expectedPlanVersion: packet.planVersion, workerId: null,
                      expectedResultHash: packet.resultHash, result: "pass",
                      rationale: "I reviewed the persisted Task plan and the exact Native output in this current evidence packet.",
                      objectiveSatisfied: true, businessInvariants: judgement(packet.contract.businessInvariants),
                      evidenceRequirements: judgement(packet.contract.evidenceRequirements),
                      prohibitedOutcomes: judgement(packet.contract.prohibitedOutcomes), uncertainties: [],
                      explicitHighImpactApproval: packet.policy.humanRequired },
                  });
                expect(reviewed.status()).toBe(200);
                expect(await reviewed.json()).toMatchObject({ planId: createdPlan.id, issueId: createdPlan.taskId,
                  reviewerType: "human", reviewerId: facts.actor.userId, result: "pass", resultHash: packet.resultHash });
                const completedPlanResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan.id}`, { headers: { origin } });
                expect(completedPlanResponse.status()).toBe(200);
                expect(await completedPlanResponse.json()).toMatchObject({ id: createdPlan.id, status: "completed" });
              }
              await browserExpect.poll(async () => {
                const response = await browserContext!.request.get(
                  `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin } });
                if (!response.ok()) return false;
                const rows = await response.json() as Array<{ id: string; status: string }>;
                return taskRows.every(task => rows.find(row => row.id === task.id)?.status === "done");
              }, { timeout: 120_000 }).toBe(true);
              const settledIssueList = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin } });
              expect(settledIssueList.status()).toBe(200);
              const tasks = await settledIssueList.json() as Array<{ id: string; title: string; status: string;
                parentId: string | null; projectId: string | null; assigneeAgentId: string | null }>;
              const settledTasks = tasks.filter(task => taskRows.some(row => row.id === task.id));
              expect(settledTasks).toHaveLength(expectedTaskCount);
              for (const [index, before] of taskRows.entries()) {
                const settledTask = settledTasks.find(task => task.id === before.id);
                expect(settledTask).toBeTruthy();
                if (!settledTask) throw new Error("managed_browser_settled_handoff_task_missing");
                expect(settledTask).toMatchObject({ id: before.id, title: before.title, status: "done",
                  parentId: null, projectId: expectedProjectId, assigneeAgentId: facts.agentId });

                const planResponse = await browserContext.request.get(
                  `${origin}/api/issues/${settledTask.id}/documents/plan`, { headers: { origin } });
                expect(planResponse.status()).toBe(200);
                const plan = await planResponse.json() as { body: string; updatedAt: string };
                expect(plan.body).toBe(expectedInitialPlans[index]);

                const outputResponse = await browserContext.request.get(
                  `${origin}/api/issues/${settledTask.id}/documents/output`, { headers: { origin } });
                expect(outputResponse.status()).toBe(200);
                const output = await outputResponse.json() as { body: string };
                expect(output.body).toContain(expectedInitialPlans[index]);
                expect(output.body).toContain(plan.body);

                const createdPlan = createdPlans.find(row => row.taskId === settledTask.id);
                expect(createdPlan).toBeTruthy();
                const detailResponse = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/orchestration/plans/${createdPlan!.id}`, { headers: { origin } });
                expect(detailResponse.status()).toBe(200);
                const detail = await detailResponse.json() as { id: string; issueId: string; status: string;
                  completionContractId: string; workers: Array<{ id: string; issueId: string; completionContractId: string }>;
                  attempts: Array<{ workerId: string; runId: string | null; workflowRunId: string | null; status: string; attempt: number }> };
                expect(detail).toMatchObject({ id: createdPlan!.id, issueId: settledTask.id, status: "completed",
                  workers: [{ id: createdPlan!.workerId, issueId: settledTask.id }] });
                expect(detail.attempts).toHaveLength(1);
                const attempt = detail.attempts[0]!;
                expect(attempt).toMatchObject({ workerId: createdPlan!.workerId, workflowRunId: null,
                  status: "succeeded", attempt: 1 });
                expect(attempt.runId).toBeTruthy();
                const [run] = await db.select().from(heartbeatRuns).where(and(
                  eq(heartbeatRuns.companyId, facts.companyId), eq(heartbeatRuns.id, attempt.runId!),
                  eq(heartbeatRuns.issueId, settledTask.id), eq(heartbeatRuns.agentId, facts.agentId)));
                expect(run).toBeTruthy();
                expect(run).toMatchObject({ runtimeMode: "native", status: "succeeded", issueId: settledTask.id,
                  nativeIssueId: settledTask.id, agentId: facts.agentId,
                  completionContractId: detail.workers[0]!.completionContractId });
                expect(run!.startedAt).toBeInstanceOf(Date);
                expect(Date.parse(plan.updatedAt)).toBeLessThanOrEqual(run!.startedAt!.getTime());

                const [outputDocument] = await db.select({ documentId: issueDocuments.documentId }).from(issueDocuments).where(and(
                  eq(issueDocuments.companyId, facts.companyId), eq(issueDocuments.issueId, settledTask.id), eq(issueDocuments.key, "output")));
                expect(outputDocument).toBeTruthy();
                const outputRevisions = await db.select().from(documentRevisions).where(and(
                  eq(documentRevisions.companyId, facts.companyId), eq(documentRevisions.documentId, outputDocument!.documentId)))
                  .orderBy(desc(documentRevisions.revisionNumber));
                expect(outputRevisions[0]?.createdByRunId).toBe(attempt.runId);
              }
              const projectRows = await db.select().from(projects).where(and(
                eq(projects.companyId, facts.companyId), eq(projects.id, expectedProjectId!)));
              expect(projectRows).toHaveLength(1);
              expect(projectRows[0]).toMatchObject({ visibility: "private", privacyOwnerUserId: facts.actor.userId });
              const projectListResponse = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/projects`, { headers: { origin } });
              expect(projectListResponse.status()).toBe(200);
              expect(await projectListResponse.json()).toHaveLength(1);
              if (scenario.label === "split handoff commits plans before execution without chat children") {
                expect(settledTasks.map(task => task.title)).toEqual(["Execution 1", "Execution 2"]);
                const chatPlan = await browserContext.request.get(
                  `${origin}/api/issues/${workflowChatIssueId}/documents/plan`, { headers: { origin } });
                expect((await chatPlan.json() as { body: string }).body).toContain("Welcome plan");
                expect((await browserContext.request.post(`${origin}/api/companies/${facts.companyId}/issues`, {
                  headers: { origin }, data: { title: "Invalid child", parentId: workflowChatIssueId },
                })).status()).toBe(422);
                expect((await browserContext.request.patch(`${origin}/api/issues/${settledTasks[0]!.id}`, {
                  headers: { origin }, data: { parentId: workflowChatIssueId },
                })).status()).toBe(422);
                await page.goto(`${origin}${route}`);
                await browserExpect(page.getByRole("article", { name: "Project created: Welcome project", exact: true })).toHaveCount(1);
              } else if (scenario.label === "plan approval hands the preserved revision to an assigned task") {
                const chatPlanResponse = await browserContext.request.get(
                  `${origin}/api/issues/${workflowChatIssueId}/documents/plan`, { headers: { origin } });
                expect(chatPlanResponse.status()).toBe(200);
                const chatPlan = await chatPlanResponse.json() as { body: string; latestRevisionId: string };
                expect(chatPlan.body).toContain("Approved welcome");
                expect(chatPlan.latestRevisionId).toBe(planApprovalRevisionId);
                await page.goto(`${origin}${route}`);
                await browserExpect(page.getByRole("article", { name: "Project created: Approved plan project", exact: true })).toHaveCount(1);
              } else {
                expect(settledTasks[0]!.projectId).toBe(reusedProjectId);
                const interactionsResponse = await browserContext.request.get(
                  `${origin}/api/issues/${workflowChatIssueId}/interactions`, { headers: { origin } });
                expect(interactionsResponse.status()).toBe(200);
                const interactions = await interactionsResponse.json() as Array<{ kind: string; status: string; result?: unknown }>;
                expect(interactions.some(interaction => interaction.kind === "ask_user_questions" &&
                  interaction.status === "answered" && interaction.result !== null)).toBe(true);
                const chat = await browserContext.request.get(`${origin}/api/issues/${workflowChatIssueId}`, { headers: { origin } });
                expect((await chat.json() as { status: string }).status).toBe("in_review");
                await page.goto(`${origin}${route}`);
                await browserExpect(page.getByRole("article", { name: /Project created:/ })).toHaveCount(0);
                const ordinaryChild = await browserContext.request.post(
                  `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin },
                    data: { title: "Ordinary delegation still works", parentId: settledTasks[0]!.id } });
                expect(ordinaryChild.status()).toBe(201);
                expect(await ordinaryChild.json()).toMatchObject({ parentId: settledTasks[0]!.id });
              }
              return;
            }
            if (scenario.label === "Stop then queued /new resets unpause the conversation without losing history") {
              if (!browserContext || !page || !stopIssueId || !stopActiveRunId || !stopResetActionsCompleted ||
                  !stopProgressCommentId || !facts.run || facts.run.id !== stopActiveRunId || facts.run.status !== "cancelled")
                throw new Error("managed_browser_stop_lifecycle_incomplete");
              const fresh = await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/chats/${facts.agentId}`, { headers: { origin } });
              expect(fresh.status()).toBe(200);
              expect(await fresh.json()).toMatchObject({ id: stopIssueId, conversationSessionGeneration: 2 });
              const commentsResponse = await browserContext.request.get(`${origin}/api/issues/${stopIssueId}/comments`, { headers: { origin } });
              const comments = await commentsResponse.json() as Array<{ id: string; body: string; authorAgentId?: string | null; createdByRunId?: string | null }>;
              expect(comments.some(comment => comment.id === preStopQueuedCommentId && comment.body === preStopQueuedCommentBody)).toBe(true);
              expect(comments.some(comment => comment.id === stopProgressCommentId && comment.authorAgentId === stopAgentId &&
                comment.body === "Provider is streaming and ready to stop.")).toBe(true);
              expect(comments.some(comment => comment.body === "Forbidden late response")).toBe(false);
              const freshReply = comments.find(comment => comment.body === "Reply generation 2: Fresh followup");
              expect(freshReply?.authorAgentId).toBe(stopAgentId);
              expect(freshReply?.createdByRunId).toBeTruthy();
              const freshRunResponse = await browserContext.request.get(
                `${origin}/api/heartbeat-runs/${freshReply!.createdByRunId}`, { headers: { origin } });
              expect(freshRunResponse.status()).toBe(200);
              expect(await freshRunResponse.json()).toMatchObject({ status: "succeeded", agentId: stopAgentId,
                nativeIssueId: stopIssueId });
              const projectResponse = await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/projects`, { headers: { origin } });
              expect(await projectResponse.json()).toHaveLength(0);
              await page.reload();
              await browserExpect(page.getByText("New session", { exact: true })).toHaveCount(2);
              await browserExpect(page.getByRole("separator", { name: "Run completed", exact: true })).toHaveCount(0);
              const runsResponse = await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/heartbeat-runs`, { headers: { origin } });
              const runs = await runsResponse.json() as Array<{ id: string }>;
              const details = await Promise.all(runs.map(run => browserContext!.request.get(`${origin}/api/heartbeat-runs/${run.id}`, { headers: { origin } }).then(response => response.json())));
              expect(details.some((run: { id: string; status: string }) => run.id === stopActiveRunId && run.status === "cancelled")).toBe(true);
              const resets = details.filter((run: { contextSnapshot?: { conversationReset?: unknown } }) => run.contextSnapshot?.conversationReset);
              expect(resets).toHaveLength(2);
              expect(resets.every((run: { sessionIdAfter?: string | null }) => !run.sessionIdAfter)).toBe(true);
              const staleWake = await db.select().from(agentWakeupRequests).where(and(
                eq(agentWakeupRequests.companyId, companyIdForApi),
                eq(agentWakeupRequests.agentId, stopAgentId!),
              )).then(rows => rows.find(wake => {
                const context = wake.payload?._paperclipWakeContext as Record<string, unknown> | undefined;
                const ids = Array.isArray(context?.wakeCommentIds) ? context.wakeCommentIds : [];
                return wake.payload?.commentId === preStopQueuedCommentId || context?.wakeCommentId === preStopQueuedCommentId || ids.includes(preStopQueuedCommentId);
              }) ?? null);
              expect(staleWake).toMatchObject({ status: "cancelled", runId: null });
              return;
            }
            if (scenario.label === "read-only first open and concurrent first sends") {
              if (!browserContext || !page) throw new Error("managed_browser_first_open_context_missing");
              const commentsResponse = await browserContext.request.get(
                `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
              expect(commentsResponse.status()).toBe(200);
              const comments = await commentsResponse.json() as Array<{ authorAgentId?: string | null; body: string }>;
              expect(comments.filter(comment => !comment.authorAgentId && comment.body === "Same first message")).toHaveLength(2);
              expect(comments.filter(comment => comment.authorAgentId && comment.body === "Reply generation 0: Same first message")).toHaveLength(2);
              expect(comments.filter(comment => !comment.authorAgentId && comment.body === "Retry once")).toHaveLength(1);
              expect(comments.filter(comment => comment.authorAgentId && comment.body === "Reply generation 0: Retry once")).toHaveLength(1);
              const resolvedChats = await Promise.all(Array.from({ length: 4 }, async () => {
                const response = await browserContext!.request.post(`${origin}/api/companies/${facts.companyId}/chats/${facts.agentId}`, { headers: { origin }, data: {} });
                expect(response.status()).toBe(200);
                return (await response.json() as { id: string }).id;
              }));
              expect(new Set(resolvedChats)).toEqual(new Set([facts.issueId]));
              expect(await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/issues`).then(response => response.json())).toHaveLength(0);
              const dashboard = await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/dashboard`, { headers: { origin } });
              expect(dashboard.status()).toBe(200);
              expect((await dashboard.json() as { tasks: Record<string, number> }).tasks).toEqual({ open: 0, inProgress: 0, blocked: 0, done: 0 });
              const runsResponse = await browserContext.request.get(`${origin}/api/companies/${facts.companyId}/heartbeat-runs`, { headers: { origin } });
              const runs = await runsResponse.json() as Array<{ id: string }>;
              expect(runs.length).toBeGreaterThanOrEqual(3);
              const details = await Promise.all(runs.map(run => browserContext!.request.get(`${origin}/api/heartbeat-runs/${run.id}`, { headers: { origin } }).then(response => response.json())));
              expect(details.every((run: { status: string }) => run.status === "succeeded")).toBe(true);
              await page.goto(`${origin}${route}`);
              await browserExpect(page.getByText("Reply generation 0: Retry once", { exact: true })).toBeVisible();
              return;
            }
            if (scenario.label === "shared history loads older messages without replacing the latest turn") {
              if (!page || !browserContext) throw new Error("managed_browser_history_context_missing");
              const response = await browserContext.request.get(`${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
              expect(response.status()).toBe(200);
              const comments = await response.json() as Array<{ id: string; authorAgentId?: string | null; body: string }>;
              const messages = comments.filter(comment => comment.authorAgentId && /^History message \d{2}$/.test(comment.body));
              expect(historyProgressResultCommentIds).toHaveLength(65);
              expect(new Set(historyProgressResultCommentIds).size).toBe(65);
              expect(messages.map(comment => comment.body).sort()).toEqual(Array.from({ length: 65 }, (_, index) => `History message ${String(index).padStart(2, "0")}`));
              expect(messages.map(comment => comment.id).sort()).toEqual([...historyProgressResultCommentIds].sort());
              await page.reload();
              await browserExpect(page.getByText("History message 64", { exact: true })).toBeVisible();
              await page.getByText("History message 64", { exact: true }).hover();
              for (let attempt = 0; attempt < 5 && !(await page.getByText("History message 00", { exact: true }).count()); attempt++) {
                await page.mouse.wheel(0, -12000);
                await browserExpect.poll(() => page!.getByText(/History message/).count()).toBeGreaterThan(40);
              }
              await browserExpect(page.getByText("History message 00", { exact: true })).toBeAttached();
              await browserExpect(page.getByText("History message 64", { exact: true })).toBeAttached();
              await browserExpect(page.getByText("History archive ready.", { exact: true })).toBeAttached();
              return;
            }
            if (scenario.repositorySelection) {
              if (!page || !browserContext || !consumedProjectId)
                throw new Error("managed_browser_repository_project_missing");
              expect(githubWireCalls).toBeGreaterThan(0);
              expect(discoveredRepositoryIds).toEqual(["101", "102"]);
              const projectRows = await db.select().from(projects).where(and(
                eq(projects.companyId, facts.companyId), eq(projects.id, consumedProjectId)));
              expect(projectRows).toHaveLength(1);
              expect(projectRows[0]).toMatchObject({ visibility: "private", privacyOwnerUserId: facts.actor.userId });
              const projectResponse = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/projects`, { headers: { origin } });
              expect(projectResponse.status()).toBe(200);
              const projectList = await projectResponse.json() as Array<{ id: string; workspaces: Array<{
                repoUrl: string | null; metadata?: Record<string, unknown> | null;
              }> }>;
              expect(projectList).toHaveLength(1);
              expect(projectList[0]?.id).toBe(consumedProjectId);
              const workspaces = projectList[0]!.workspaces;
              const selectedIds = workspaces.map(workspace => workspace.metadata?.githubRepositoryId)
                .filter((id): id is string => typeof id === "string").sort();
              expect(selectedIds).toEqual(scenario.repositorySelection.ids);
              const expectedUrls = [...new Set([
                ...scenario.repositorySelection.ids.map(id => id === "101"
                  ? "https://github.com/chat-fixture/frontend" : "https://github.com/octocat/Hello-World"),
                ...scenario.repositorySelection.urls.map(url => {
                  const parsed = new URL(url);
                  const path = parsed.pathname.replace(/\/$/, "").replace(/\.git$/, "");
                  return `https://github.com${path}`;
                }),
              ])].sort();
              const actualUrls = workspaces.map(workspace => workspace.repoUrl).filter((url): url is string => !!url).sort();
              expect(actualUrls).toEqual(expectedUrls);
              expect(new Set(actualUrls).size).toBe(workspaces.length);
              const issuesResponse = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin } });
              expect(issuesResponse.status()).toBe(200);
              expect(await issuesResponse.json()).toHaveLength(0);
              await page.goto(`${origin}${route}`);
              const card = page.getByRole("article", { name: "Project created: Selected repositories", exact: true });
              await browserExpect(card).toHaveCount(1);
              for (const url of expectedUrls) {
                const repoPath = new URL(url).pathname.slice(1);
                await browserExpect(card.getByRole("link", { name: repoPath, exact: true })).toHaveAttribute("href", url);
              }
              await card.getByRole("link", { name: "Selected repositories", exact: true }).click();
              await browserExpect(page).toHaveURL(/\/projects\/.*\/issues/);
              await page.getByRole("tab", { name: "Configuration", exact: true }).click();
              const repositoryRegion = page.getByRole("region", { name: "Repositories" });
              const selectedNames = [...new Set([
                ...scenario.repositorySelection.ids.map(id => id === "101" ? "chat-fixture/frontend" : "octocat/Hello-World"),
                ...scenario.repositorySelection.urls.map(url => new URL(url).pathname.slice(1).replace(/\.git$/, "")),
              ])];
              for (const repositoryName of selectedNames) await browserExpect(repositoryRegion).toContainText(repositoryName);
              return;
            }
            if (scenario.featureFlag) {
              if (!page || !browserContext || previousEnableAgentChat === null)
                throw new Error("managed_browser_feature_flag_context_missing");
              const setAgentChat = async (enabled: boolean) => {
                const response = await browserContext!.request.patch(
                  `${origin}/api/instance/settings/experimental`, {
                    headers: { origin }, data: { enableAgentChat: enabled },
                  });
                expect(response.status()).toBe(200);
                expect((await response.json() as { enableAgentChat: boolean }).enableAgentChat).toBe(enabled);
                featureSettingsTouched = true;
              };
              try {
                expect(facts.run?.status).toBe("succeeded");
                const activeComments = await browserContext.request.get(
                  `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
                expect(activeComments.status()).toBe(200);
                const activeRows = await activeComments.json() as Array<{ id: string; authorAgentId?: string | null; body: string }>;
                expect(activeRows.some(comment => comment.authorAgentId === facts.agentId &&
                  comment.body === "Active turn settled after feature disable.")).toBe(true);
                const waiting = await browserContext.request.get(
                  `${origin}/api/issues/${facts.issueId}`, { headers: { origin } });
                expect(waiting.status()).toBe(200);
                expect((await waiting.json() as { conversationState: string }).conversationState).toBe("waiting");
                expect((await browserContext.request.post(`${origin}/api/issues/${facts.issueId}/comments`, {
                  headers: { origin }, data: { body: "/new" },
                })).status()).toBe(404);
                const activeRuns = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/heartbeat-runs`, { headers: { origin } });
                expect(activeRuns.status()).toBe(200);
                const beforeReloadCount = (await activeRuns.json() as unknown[]).length;
                await page.reload();
                await browserExpect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
                const runsAfterReload = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/heartbeat-runs`, { headers: { origin } });
                expect((await runsAfterReload.json() as unknown[]).length).toBe(beforeReloadCount);

                // Second original journey: re-enable for a genuine new turn, then disable while idle.
                await setAgentChat(true);
                await page.reload();
                const composer = page.getByTestId("task-chat-composer-input").last()
                  .locator('[contenteditable="true"],textarea').first();
                await browserExpect(composer).toBeVisible();
                await composer.fill("Visible history");
                const sent = page.waitForResponse(response => response.request().method() === "POST" &&
                  new URL(response.url()).pathname === `/api/issues/${facts.issueId}/comments`);
                await page.getByTestId("task-chat-composer-send").last().click();
                expect((await sent).status()).toBe(201);
                await browserExpect.poll(async () => {
                  const response = await browserContext!.request.get(
                    `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
                  if (!response.ok()) return false;
                  const comments = await response.json() as Array<{ authorAgentId?: string | null }>;
                  return comments.filter(comment => comment.authorAgentId === facts.agentId).length;
                }, { timeout: 60_000 }).toBe(3);
                await browserExpect.poll(async () => {
                  const response = await browserContext!.request.get(
                    `${origin}/api/issues/${facts.issueId}/live-runs`, { headers: { origin } });
                  return response.ok() ? (await response.json() as unknown[]).length : -1;
                }, { timeout: 60_000 }).toBe(0);
                const settledHistory = await browserContext.request.get(
                  `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
                const historyRows = await settledHistory.json() as Array<{ body: string }>;
                expect(historyRows.some(comment => comment.body.includes("Visible history"))).toBe(true);
                const idleRuns = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/heartbeat-runs`, { headers: { origin } });
                const idleRunCount = (await idleRuns.json() as unknown[]).length;
                await setAgentChat(false);
                for (const body of ["blocked message", "/new"]) {
                  const blocked = await browserContext.request.post(
                    `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin }, data: { body } });
                  expect(blocked.status()).toBe(404);
                }
                expect((await browserContext.request.post(`${origin}/api/companies/${facts.companyId}/chats/${facts.agentId}`, {
                  headers: { origin }, data: {},
                })).status()).toBe(404);
                await page.reload();
                await browserExpect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
                const retained = await browserContext.request.get(
                  `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
                const retainedRows = await retained.json() as Array<{ body: string }>;
                expect(retainedRows.some(comment => comment.body.includes("Visible history"))).toBe(true);
                const afterBlockedWrites = await browserContext.request.get(
                  `${origin}/api/companies/${facts.companyId}/heartbeat-runs`, { headers: { origin } });
                expect((await afterBlockedWrites.json() as unknown[]).length).toBe(idleRunCount);
              } finally {
                await setAgentChat(previousEnableAgentChat);
                featureSettingsTouched = false;
              }
              return;
            }
            if (scenario.sourceUi) {
              if (!page || !browserContext) throw new Error("managed_browser_source_ui_missing");
              const retainedText = scenario.sourceUi === "reload"
                ? "Private history before source loss" : "Private cached history before live source denial";
              const commentsPath = `${origin}/api/issues/${facts.issueId}/comments`;
              const chatPath = `${origin}/api/companies/${facts.companyId}/chats/${facts.agentId}`;
              const liveDeliveries: Array<(message: string) => void> = [];
              if (scenario.sourceUi === "live") {
                await page.routeWebSocket("**/api/companies/*/events/ws", socket => {
                  const server = socket.connectToServer();
                  server.onMessage(message => socket.send(message));
                  liveDeliveries.push(message => socket.send(message));
                });
              }
              await page.goto(`${origin}${route}`);
              await browserExpect(page.getByText(retainedText, { exact: true })).toBeVisible();
              if (scenario.sourceUi === "reload") {
                let sourceLost = false, refreshed = 0, creations = 0;
                await page.route(`**/api/companies/${facts.companyId}/chats/${facts.agentId}`, async routeRequest => {
                  if (routeRequest.request().method() === "POST") creations++;
                  if (sourceLost && routeRequest.request().method() === "GET") {
                    refreshed++;
                    return routeRequest.fulfill({ status: 200, contentType: "application/json", body: "null" });
                  }
                  await routeRequest.continue();
                });
                await page.route(`**/api/issues/${facts.issueId}/comments*`, async routeRequest => {
                  sourceLost = true;
                  return routeRequest.fulfill({ status: 403, contentType: "application/json",
                    body: JSON.stringify({ error: "Analytical conversation source access is unavailable",
                      details: { code: "analytical_source_access_lost" } }) });
                });
                await page.reload();
                await browserExpect.poll(() => refreshed).toBeGreaterThan(0);
                await browserExpect(page.getByTestId("task-chat-composer-input")).toBeVisible();
                await browserExpect(page.getByText(retainedText, { exact: true })).toHaveCount(0);
                expect(creations).toBe(0);
              } else {
                await browserExpect.poll(() => liveDeliveries.length).toBeGreaterThan(0);
                let creations = 0;
                const failure = { error: "Analytical conversation source access is unavailable",
                  details: { code: "analytical_source_access_lost", conversationIssueId: facts.issueId } };
                await page.route(`**/api/companies/${facts.companyId}/chats/${facts.agentId}`, routeRequest => {
                  if (routeRequest.request().method() === "POST") creations++;
                  return routeRequest.fulfill({ status: 403, json: failure });
                });
                await page.route(`**/api/issues/${facts.issueId}/comments*`, routeRequest =>
                  routeRequest.fulfill({ status: 403, json: failure }));
                for (const deliver of liveDeliveries) deliver(JSON.stringify({ id: 900001, companyId: facts.companyId,
                  type: "analytical.context.access_lost", createdAt: new Date().toISOString(),
                  payload: { issueId: facts.issueId, runId: null, code: "analytical_source_access_lost" } }));
                await browserExpect(page.getByText(retainedText, { exact: true })).toHaveCount(0);
                await browserExpect(page.getByRole("button", { name: "Start a new conversation" })).toBeVisible();
                expect(creations).toBe(0);
              }
              return;
            }
            if (scenario.attachment) {
              expect(uploadedAttachment).toEqual(expect.objectContaining({ filename: "chat-notes.txt" }));
              expect(providerSawAttachment).toBe(true);
              if (!page || !browserContext || !uploadedAttachment) throw new Error("managed_browser_attachment_missing");
              const comments = await browserContext.request.get(
                `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
              expect(comments.status()).toBe(200);
              const commentRows = await comments.json() as Array<{ authorAgentId?: string | null; body: string }>;
              expect(commentRows.find(comment => !comment.authorAgentId)?.body)
                .toContain(`[chat-notes.txt](${uploadedAttachment.contentPath})`);
              await page.reload();
              await browserExpect(page.getByRole("tab", { name: "Properties", exact: true })).toHaveCount(0);
              const attachments = await browserContext.request.get(
                `${origin}/api/issues/${facts.issueId}/attachments`, { headers: { origin } });
              expect(attachments.status()).toBe(200);
              expect(await attachments.json()).toHaveLength(1);
              return;
            }
            if (scenario.label === "Ask mode denies project mutation" ||
                scenario.label === "Plan mode denies project mutation and revises plan") {
              if (!page || !browserContext) throw new Error("managed_browser_mode_page_missing");
              expect(modeProjectToolAdvertised).toBeDefined();
              expect(modeProjectToolResult.length).toBeGreaterThan(0);
              expect(modeProjectRejectionClass).toBe("sdk-unknown-tool");
              const modeCommentsResponse = await browserContext.request.get(
                `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
              expect(modeCommentsResponse.status()).toBe(200);
              const modeComments = await modeCommentsResponse.json() as Array<{ authorAgentId?: string | null; body: string }>;
              expect(modeComments.find(comment => comment.authorAgentId === facts.agentId)?.body)
                .toContain(`Project mutation ${modeProjectRejectionClass}:`);
              expect(planWriteError).toBeNull();
              const checkNoProjectOrChildIssue = async () => {
                const projectRows = await db.select().from(projects).where(eq(projects.companyId, facts.companyId));
                expect(projectRows).toHaveLength(0);
                const projectResponse = await browserContext!.request.get(
                  `${origin}/api/companies/${facts.companyId}/projects`, { headers: { origin } });
                expect(projectResponse.status()).toBe(200);
                expect(await projectResponse.json()).toHaveLength(0);
                const issueResponse = await browserContext!.request.get(
                  `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin } });
                expect(issueResponse.status()).toBe(200);
                expect(await issueResponse.json()).toHaveLength(0);
                await page!.goto(`${origin}${route}`);
                await browserExpect(page!.getByRole("article", { name: /Project created:/ })).toHaveCount(0);
              };
              await checkNoProjectOrChildIssue();
              if (scenario.mode === "planning") {
                const sendAndWaitForAgentReply = async (text: string, expectedAgentReplies: number) => {
                  const composer = page!.getByTestId("task-chat-composer-input").last()
                    .locator('[contenteditable="true"],textarea').first();
                  await composer.fill(text);
                  const sent = page!.waitForResponse(response => response.request().method() === "POST" &&
                    new URL(response.url()).pathname === `/api/issues/${facts.issueId}/comments`);
                  await page!.getByTestId("task-chat-composer-send").last().click();
                  expect((await sent).status()).toBe(201);
                  await browserExpect.poll(async () => {
                    const response = await browserContext!.request.get(
                      `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
                    if (!response.ok()) return false;
                    const comments = await response.json() as Array<{ authorAgentId?: string | null }>;
                    return comments.filter(comment => comment.authorAgentId === facts.agentId).length;
                  }, { timeout: 60_000 }).toBe(expectedAgentReplies);
                  await browserExpect.poll(async () => {
                    const response = await browserContext!.request.get(
                      `${origin}/api/issues/${facts.issueId}/live-runs`, { headers: { origin } });
                    return response.ok() ? (await response.json() as unknown[]).length : -1;
                  }, { timeout: 60_000 }).toBe(0);
                };
                await sendAndWaitForAgentReply("# Draft plan\nDiscuss the goal.", 2);
                const planResponse = await browserContext.request.get(
                  `${origin}/api/issues/${facts.issueId}/documents/plan`, { headers: { origin } });
                expect(planResponse.status()).toBe(200);
                const firstPlan = await planResponse.json() as { latestRevisionId: string; body: string };
                expect(firstPlan.body).toContain("Draft plan");
                firstPlanRevisionId = firstPlan.latestRevisionId;
                expect(firstPlanRevisionId).toBeTruthy();
                await sendAndWaitForAgentReply("# Revised plan\nDiscuss the revised goal.", 3);
                const revisedResponse = await browserContext.request.get(
                  `${origin}/api/issues/${facts.issueId}/documents/plan`, { headers: { origin } });
                expect(revisedResponse.status()).toBe(200);
                const revised = await revisedResponse.json() as { latestRevisionId: string; body: string };
                expect(revised.latestRevisionId).not.toBe(firstPlan.latestRevisionId);
                expect(revised.body).toContain("Revised plan");
                await browserExpect(page.getByRole("tab", { name: "Plan", exact: true })).toBeVisible();
                await checkNoProjectOrChildIssue();
              }
              return;
            }
            if (scenario.invalid) {
              const projectRows = await db.select().from(projects).where(eq(projects.companyId, facts.companyId));
              expect(projectRows).toHaveLength(0);
              if (!page || !browserContext) throw new Error("managed_browser_page_missing");
              const projectResponse = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/projects`, { headers: { origin } });
              expect(projectResponse.status()).toBe(200);
              expect(await projectResponse.json()).toHaveLength(0);
              await page.goto(`${origin}${route}`);
              await browserExpect(page.getByText(/Expected tool result:/)).toBeVisible();
              await browserExpect(page.getByRole("article", { name: /Project created:/ })).toHaveCount(0);
              const issueResponse = await browserContext.request.get(
                `${origin}/api/companies/${facts.companyId}/issues`, { headers: { origin } });
              expect(issueResponse.status()).toBe(200);
              expect(await issueResponse.json()).toHaveLength(0);
              return;
            }
            expect(consumedProjectId).toEqual(expect.any(String));
            const rows = await db.select().from(projects).where(and(eq(projects.companyId, facts.companyId),
              eq(projects.id, consumedProjectId!)));
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ visibility: "private", privacyOwnerUserId: facts.actor.userId });
            if (!page || !browserContext) throw new Error("managed_browser_page_missing");
            const projectResponse = await browserContext.request.get(
              `${origin}/api/companies/${facts.companyId}/projects`, { headers: { origin } });
            expect(projectResponse.status()).toBe(200);
            const projectList = await projectResponse.json() as Array<{ id: string; workspaces: Array<{
              name: string; repoUrl: string | null;
            }> }>;
            expect(projectList).toHaveLength(1);
            expect(projectList[0]?.id).toBe(consumedProjectId);
            expect(projectList[0]?.workspaces).toHaveLength(2);
            expect(projectList[0]?.workspaces.map(workspace => workspace.repoUrl).sort()).toEqual([
              "https://github.com/octocat/Hello-World", "https://github.com/octocat/Spoon-Knife",
            ]);
            let additionalRepositoryLink = false;
            if (scenario.directApi) {
              const workspaceResponse = await browserContext.request.post(
                `${origin}/api/projects/${consumedProjectId}/workspaces`, {
                  headers: { origin },
                  data: { name: "Additional repository", repoUrl: "https://github.com/octocat/git-consortium" },
                });
              expect(workspaceResponse.status()).toBe(201);
              const workspace = await workspaceResponse.json() as { id: string; name: string; repoUrl: string };
              expect(workspace).toMatchObject({ name: "Additional repository", repoUrl: "https://github.com/octocat/git-consortium" });
              additionalRepositoryLink = true;
            }
            await page.goto(`${origin}${route}`);
            const card = page.getByRole("article", { name: `Project created: ${name}`, exact: true });
            await browserExpect(card).toHaveCount(1, { timeout: 30_000 });
            await browserExpect(card.getByRole("link", { name: "octocat/Hello-World", exact: true }))
              .toHaveAttribute("href", "https://github.com/octocat/Hello-World");
            await browserExpect(card.getByRole("link", { name: "octocat/Spoon-Knife", exact: true }))
              .toHaveAttribute("href", "https://github.com/octocat/Spoon-Knife");
            if (additionalRepositoryLink)
              await browserExpect(card.getByRole("link", { name: "Additional repository", exact: true }))
                .toHaveAttribute("href", "https://github.com/octocat/git-consortium");
            await page.getByTestId("task-chat-composer-input").last()
              .locator('[contenteditable="true"],textarea').first().fill("/new");
            const reset = page.waitForResponse(response => response.request().method() === "POST" &&
              new URL(response.url()).pathname === `/api/issues/${facts.issueId}/comments`);
            await page.getByTestId("task-chat-composer-send").last().click();
            expect((await reset).status()).toBe(201);
            await browserExpect.poll(async () => {
              const chat = await browserContext!.request.get(
                `${origin}/api/companies/${facts.companyId}/chats/${facts.agentId}`, { headers: { origin } });
              return chat.ok() ? (await chat.json() as { conversationSessionGeneration: number })
                .conversationSessionGeneration : null;
            }, { timeout: 60_000 }).toBe(1);
            await browserExpect.poll(async () => {
              const comments = await browserContext!.request.get(
                `${origin}/api/issues/${facts.issueId}/comments`, { headers: { origin } });
              const rows = await comments.json() as Array<{ authorAgentId?: string | null }>;
              return rows.filter(comment => comment.authorAgentId === facts.agentId).length;
            }, { timeout: 60_000 }).toBe(2);
            await browserExpect.poll(async () => {
              const liveRuns = await browserContext!.request.get(
                `${origin}/api/issues/${facts.issueId}/live-runs`, { headers: { origin } });
              return (await liveRuns.json() as unknown[]).length;
            }, { timeout: 60_000 }).toBe(0);
            await page.reload();
            await browserExpect(card).toHaveCount(1);
            await browserExpect(card.getByRole("link", { name, exact: true })).toHaveAttribute("href", /\/projects\//);
            if (additionalRepositoryLink)
              await browserExpect(card.getByRole("link", { name: "Additional repository", exact: true }))
                .toHaveAttribute("href", "https://github.com/octocat/git-consortium");
            await card.getByRole("link", { name, exact: true }).click();
            await browserExpect(page).toHaveURL(/\/projects\/.*\/issues/);
            await page.getByRole("tab", { name: "Configuration", exact: true }).click();
            await browserExpect(page.getByRole("region", { name: "Repositories" }))
              .toContainText("octocat/Hello-World");
            await browserExpect(page.getByRole("region", { name: "Repositories" }))
              .toContainText("octocat/Spoon-Knife");
          } });
        expect(result.success).toBe(true);
        expect(result.reservation?.status).toBe("completed");
      } finally {
        releaseActiveReply();
        try {
          await browserContext?.close();
        } finally {
          try {
            await browser.close();
          } finally {
            if (repositoryWireInstalled) globalThis.fetch = originalFetch;
          }
        }
      }
      }, 300_000);

    if (cohort === "core") {
    it("normalizes and deduplicates repository URLs in the managed Project result and card", async () => {
      const browser = await chromium.launch({ executablePath, headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      let browserContext: BrowserContext | undefined;
      let page: Page | undefined;
      let origin = "";
      let route = "";
      let companyIdForApi = "";
      let consumedProjectId: string | null = null;
      let replayArgumentsHash: string | null = null;
      let managedToolResultError: string | null = null;
      let providerReplyFailure: string | null = null;
      let providerReplyProjectSummary: Record<string, unknown> | null = null;
      let afterRunFailure: string | null = null;
      const name = `Browser repositories ${randomUUID().slice(0, 8)}`;
      const callId = `browser-repositories-${randomUUID()}`;
      const retryCallId = `${callId}-retry`;
      const expectedRepositories = [
        { name: "octocat/Hello-World", url: "https://github.com/octocat/Hello-World" },
        { name: "octocat/Spoon-Knife", url: "https://github.com/octocat/Spoon-Knife" },
      ];
      try {
        const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary!,
          conversationWorkMode: "standard",
          createConversationApp: async ({ heartbeat, resolveSession, resolveSessionFromHeaders }) => {
            const server = createServer();
            await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
            const closeServer = () => new Promise<void>((resolve, reject) => {
              server.closeAllConnections();
              server.close(error => error ? reject(error) : resolve());
            });
            const address = server.address();
            if (!address || typeof address === "string") {
              await closeServer();
              throw new Error("managed_browser_listener_missing");
            }
            origin = `http://127.0.0.1:${address.port}`;
            try {
              const app = await createApp(db, { heartbeat, resolveSession, uiMode: "vite-dev", serverPort: address.port,
                storageService: createStorageService(createLocalDiskStorageProvider(join(root, "storage"))),
                deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1",
                allowedHostnames: ["127.0.0.1"], authReady: true, companyDeletionEnabled: false,
                instanceId: process.env.PAPERCLIP_INSTANCE_ID, localPluginDir: join(root, "plugins"),
                managedPluginAutoInstall: [], decisionServiceOptions: { wakeOriginAgent: async () => undefined } });
              server.on("request", app);
              const liveEvents = setupLiveEventsWebSocketServer(server, db, {
                deploymentMode: "authenticated", resolveSessionFromHeaders,
              });
              return { app, origin, close: async () => {
                const shutdownErrors: unknown[] = [];
                for (const client of liveEvents.clients) client.terminate();
                try { await new Promise<void>(resolve => liveEvents.close(() => resolve())); }
                catch (error) { shutdownErrors.push(error); }
                try { await app.locals.paperclipShutdown?.(); }
                catch (error) { shutdownErrors.push(error); }
                try { await closeServer(); }
                catch (error) { shutdownErrors.push(error); }
                if (shutdownErrors.length) throw new AggregateError(shutdownErrors, "managed_browser_app_shutdown_failed");
              } };
            } catch (error) {
              await closeServer();
              throw error;
            }
          },
          driveConversation: async context => {
            companyIdForApi = context.companyId;
            const currentBrowserContext = await browser.newContext();
            browserContext = currentBrowserContext;
            const [cookieName, ...cookieValue] = context.humanCookie.split("=");
            await currentBrowserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
            const opened = await currentBrowserContext.request.post(`${context.origin}${context.chatPath}`, {
              headers: { origin: context.origin } });
            expect(opened.status()).toBe(200);
            const chat = await opened.json() as { id: string };
            context.onConversationOpened(chat.id);
            const mode = await currentBrowserContext.request.patch(`${context.origin}/api/issues/${chat.id}`, {
              headers: { origin: context.origin }, data: { workMode: "standard" } });
            expect(mode.status()).toBe(200);
            page = await currentBrowserContext.newPage();
            route = context.conversationRoute;
            const entryDiagnostic = attachManagedBrowserEntryDiagnostic(page, context.origin);
            const composer = page.getByTestId("task-chat-composer-input").last()
              .locator('[contenteditable="true"],textarea').first();
            const claim = page.getByRole("button", { name: "Claim this instance", exact: true });
            try {
              await page.goto(`${context.origin}${route}`);
              await browserExpect(composer.or(claim).first()).toBeVisible({ timeout: 30_000 });
            } catch (error) {
              try { await entryDiagnostic.reportFailure("repository_card_entry", composer, claim); } catch { /* Preserve the original error. */ }
              throw error;
            } finally {
              entryDiagnostic.dispose();
            }
            if (await claim.isVisible()) {
              const claimed = page.waitForResponse(response => response.request().method() === "POST" &&
                new URL(response.url()).pathname === "/api/bootstrap/claim");
              await claim.click();
              expect((await claimed).status()).toBe(200);
              await page.goto(`${context.origin}${route}`);
            }
            await browserExpect(composer).toBeVisible({ timeout: 30_000 });
            await composer.fill(context.prompt);
            const sent = page.waitForResponse(response => response.request().method() === "POST" &&
              new URL(response.url()).pathname === `/api/issues/${chat.id}/comments`);
            await page.getByTestId("task-chat-composer-send").last().click();
            const response = await sent;
            expect(response.status()).toBe(201);
            const comment = await response.json() as { id: string };
            return { issueId: chat.id, wakeCommentId: comment.id };
          },
          providerReply: ({ body, callIndex }) => {
            if (callIndex === 1) {
              const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
              const tool = tools.find(value => value.name.endsWith("create_project"));
              if (!tool) {
                providerReplyFailure = "managed_browser_project_tool_missing";
                return undefined;
              }
              const projectInput = { name, repositoryUrls: [
                  "https://github.com/octocat/Hello-World.git", "https://github.com/octocat/Hello-World/",
                  "https://github.com/octocat/Spoon-Knife.git",
                ], idempotencyKey: callId };
              return { stop_reason: "tool_use", content: [{ type: "tool_use", id: callId, name: tool.name, input: projectInput }] };
            }
            if (callIndex === 2) {
              const messages = Array.isArray(body.messages) ? body.messages as Array<{ content: Array<Record<string, unknown>> }> : [];
              const output = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
                .find(block => block.type === "tool_result" && block.tool_use_id === callId);
              if (!output || output.is_error === true) {
                managedToolResultError = "initial_project_result_missing_or_failed";
                return undefined;
              }
              const content = output.content;
              const text = typeof content === "string" ? content : Array.isArray(content)
                ? content.map(part => String(part.text ?? "")).join("") : "";
              try {
                const project = JSON.parse(text) as { id: string; name: string; visibility: string };
                consumedProjectId = project.id;
                expect(project).toMatchObject({ name, visibility: "private" });
              } catch (error) {
                providerReplyFailure = error instanceof Error ? error.message.slice(0, 500) : "initial_project_result_invalid";
                return undefined;
              }
              const tools = Array.isArray(body.tools) ? body.tools as Array<{ name: string }> : [];
              const callApi = tools.find(value => value.name.endsWith("call_api"));
              if (!callApi) {
                providerReplyFailure = "managed_browser_call_api_tool_missing";
                return undefined;
              }
              const apiArguments = { operationId: "POST /api/companies/{companyId}/projects",
                pathParams: { companyId: companyIdForApi }, body: { name,
                  repositoryUrls: ["https://github.com/octocat/Hello-World.git", "https://github.com/octocat/Hello-World/",
                    "https://github.com/octocat/Spoon-Knife.git"], idempotencyKey: callId } };
              replayArgumentsHash = nativeSha256(apiArguments);
              return { stop_reason: "tool_use", content: [{ type: "tool_use", id: retryCallId,
                name: callApi.name, input: apiArguments }] };
            }
            if (callIndex !== 3) {
              providerReplyFailure = `unexpected_provider_call_index_${callIndex}`;
              return undefined;
            }
            const messages = Array.isArray(body.messages) ? body.messages as Array<{ content: Array<Record<string, unknown>> }> : [];
            const outputs = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
              .filter(block => block.type === "tool_result" && [callId, retryCallId].includes(String(block.tool_use_id)));
            if (outputs.length !== 2) {
              managedToolResultError = "tool_result_missing";
              return undefined;
            }
            try {
              if (outputs.some(output => output.is_error === true)) throw new Error("managed_tool_result_error");
              const initialContent = outputs[0]!.content;
              const initialText = typeof initialContent === "string" ? initialContent : Array.isArray(initialContent)
                ? initialContent.map(part => String(part.text ?? "")).join("") : "";
              const retryContent = outputs[1]!.content;
              const retryText = typeof retryContent === "string" ? retryContent : Array.isArray(retryContent)
                ? retryContent.map(part => String(part.text ?? "")).join("") : "";
              const project = JSON.parse(initialText) as { id: string; name: string; visibility: string;
                workspaces: Array<{ name: string; repoUrl: string | null; sourceType?: string; isPrimary: boolean }> };
              const apiEnvelope = JSON.parse(retryText) as { ok: boolean; operationId: string; callId: string;
                result: { ok: boolean; status: number; data: typeof project; apiOperationId: string } };
              expect(apiEnvelope).toMatchObject({ ok: true, operationId: "call_api", callId: retryCallId,
                result: { ok: true, status: 201,
                  apiOperationId: "POST /api/companies/{companyId}/projects", data: { id: project.id } } });
              const replay = apiEnvelope.result;
              expect(replay.data.id).toBe(project.id);
              providerReplyProjectSummary = { name: project.name, visibility: project.visibility,
                workspaces: Array.isArray(project.workspaces) ? project.workspaces.map(workspace => ({
                  name: workspace.name, repoUrl: workspace.repoUrl, sourceType: workspace.sourceType,
                  isPrimary: workspace.isPrimary,
                })) : null };
              expect(project).toMatchObject({ name, visibility: "private" });
              expect(project.workspaces).toHaveLength(3);
                expect(project.workspaces).toEqual(expect.arrayContaining([
                expect.objectContaining({ name, repoUrl: null, isPrimary: true }),
                ...expectedRepositories.map(repository => expect.objectContaining({ name: repository.name,
                  repoUrl: repository.url, isPrimary: false })),
              ]));
              consumedProjectId = project.id;
            } catch (error) {
              providerReplyFailure = error instanceof Error ? error.message.slice(0, 500) : "provider_reply_assertion_failed";
            }
            return undefined;
          },
          afterRunSettledBeforeTeardown: async facts => {
            try {
            if (facts.run?.status !== "succeeded") return;
            expect(consumedProjectId).toEqual(expect.any(String));
            const [project] = await db.select().from(projects).where(and(eq(projects.companyId, facts.companyId),
              eq(projects.id, consumedProjectId!)));
            expect(project).toMatchObject({ visibility: "private", privacyOwnerUserId: facts.actor.userId });
            const workspaceRows = await db.select({ id: projectWorkspaces.id, name: projectWorkspaces.name,
              repoUrl: projectWorkspaces.repoUrl, isPrimary: projectWorkspaces.isPrimary })
              .from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, facts.companyId),
                eq(projectWorkspaces.projectId, consumedProjectId!)));
            expect(workspaceRows).toHaveLength(3);
            expect(workspaceRows).toEqual(expect.arrayContaining([
              expect.objectContaining({ name, repoUrl: null, isPrimary: true }),
              ...expectedRepositories.map(repository => expect.objectContaining({ name: repository.name,
                repoUrl: repository.url, isPrimary: false })),
            ]));
            const receipts = (facts.run?.resultJson as Record<string, unknown>)?.nativeProjectCreateReceipts as Record<string, unknown>;
            const receiptKey = createHash("sha256").update(callId, "utf8").digest("hex");
            const retryReceiptKey = createHash("sha256").update(retryCallId, "utf8").digest("hex");
            const receipt = receipts?.[receiptKey] as { argumentsHash: string; projectId: string; sourceSetHash: string;
              projectSourceSetHash: string;
              workspaceSources: Array<{ kind: string; workspaceId: string }> } | undefined;
            const retryReceipt = receipts?.[retryReceiptKey] as { tool: string; argumentsHash: string; projectId: string;
              resultDigest: string; sourceSetHash: string; projectSourceSetHash: string;
              workspaceSources: Array<{ kind: string; workspaceId: string }> } | undefined;
            const apiReceipts = (facts.run?.resultJson as Record<string, unknown>)?.apiToolReceipts as Record<string, unknown>;
            const apiReceipt = apiReceipts?.[retryReceiptKey] as Record<string, unknown> | undefined;
            const rawApiResult = apiReceipt?.result as Record<string, unknown> | undefined;
            const runnerProfile = facts.run?.runnerProfileJson as Record<string, unknown>;
            const resultCaptures = runnerProfile.nativeToolResultSourceCaptures as Array<Record<string, unknown>>;
            const apiResultCapture = resultCaptures?.find(capture => capture.callId === retryCallId && capture.tool === "call_api");
            const apiResultSource = apiResultCapture?.source as { contentHash?: string } | undefined;
            const { operationId: apiOperationId, ...providerApiResult } = rawApiResult ?? {};
            expect(apiReceipt).toMatchObject({ operationId: "POST /api/companies/{companyId}/projects", state: "completed",
              argumentsHash: replayArgumentsHash });
            expect(apiReceipt).not.toHaveProperty("status");
            expect(apiReceipt).not.toHaveProperty("resultDigest");
            expect(rawApiResult).toMatchObject({ ok: true, status: 201, operationId: "POST /api/companies/{companyId}/projects",
              data: { id: consumedProjectId } });
            expect(apiReceipt?.providerResultDigest).toBe(nativeSha256({ ok: true, operationId: "call_api",
              callId: retryCallId, result: { ...providerApiResult, apiOperationId } }));
            expect(apiResultCapture?.resultDigest).toBe(apiResultSource?.contentHash);
            expect(apiReceipt?.providerResultDigest).toBe(apiResultCapture?.resultDigest);
            expect(retryReceipt?.resultDigest).toBe(nativeSha256(rawApiResult?.data));
            expect(receipt).toMatchObject({ argumentsHash: nativeSha256({ name,
              repositoryUrls: ["https://github.com/octocat/Hello-World.git", "https://github.com/octocat/Hello-World/",
                "https://github.com/octocat/Spoon-Knife.git"], idempotencyKey: callId }), projectId: consumedProjectId });
            expect(receipt?.workspaceSources).toHaveLength(3);
            expect(retryReceipt).toMatchObject({ tool: "call_api", projectId: consumedProjectId,
              argumentsHash: replayArgumentsHash, projectSourceSetHash: receipt?.projectSourceSetHash,
              workspaceSources: receipt?.workspaceSources });
            expect(retryReceipt?.sourceSetHash).not.toBe(receipt?.sourceSetHash);
            expect(receipt?.workspaceSources.map(source => source.workspaceId).sort())
              .toEqual(workspaceRows.map(workspace => workspace.id).sort());
            const snapshot = project?.payloadSourceSnapshot as { inputs?: Array<{ kind: string; workspaceId?: string }> } | null;
            expect(snapshot?.inputs?.filter(source => source.kind === "project_workspace").map(source => source.workspaceId).sort())
              .toEqual(workspaceRows.map(workspace => workspace.id).sort());
            const activities = await db.select({ details: activityLog.details }).from(activityLog).where(and(
              eq(activityLog.companyId, facts.companyId), eq(activityLog.action, "project.created"),
              eq(activityLog.entityType, "project"), eq(activityLog.entityId, consumedProjectId!)));
            expect(activities).toHaveLength(1);
            const activity = activities[0];
            const details = activity?.details as { repositories?: Array<{ id: string; name: string; url: string }> } | null;
            expect(details?.repositories).toEqual(expectedRepositories.map(repository => ({
              id: repository.url, ...repository,
            })));
            if (!page) throw new Error("managed_browser_page_missing");
            await page.goto(`${origin}${route}`);
            const card = page.getByRole("article", { name: `Project created: ${name}`, exact: true });
            await browserExpect(card).toHaveCount(1, { timeout: 30_000 });
            for (const repository of expectedRepositories)
              await browserExpect(card.getByRole("link", { name: repository.name, exact: true }))
                .toHaveAttribute("href", repository.url);
            await page.reload();
            await browserExpect(card).toHaveCount(1);
            for (const repository of expectedRepositories)
              await browserExpect(card.getByRole("link", { name: repository.name, exact: true }))
                .toHaveAttribute("href", repository.url);
            } catch (error) {
              afterRunFailure = error instanceof Error ? error.message.slice(0, 500) : "after_run_assertion_failed";
            }
          } });
        expect(result.success, JSON.stringify({ runStatus: result.run?.status, runError: result.run?.error,
          errorCode: result.run?.errorCode, executionStage: result.run?.executionStage, nativePhase: result.run?.nativePhase,
          providerHookFailure: result.providerHookFailure, providerStubFailure: result.providerStubFailure,
          providerCallCount: result.providerCallCount, providerHookInvoked: result.providerHookInvoked,
          providerToolNames: result.providerToolNames,
          brokerRequestFacts: result.brokerRequestFacts.map(({ status, code, stage, errorName, errorStatus, errorCode, serviceFrames }) =>
            ({ status, code, stage, errorName, errorStatus, errorCode, serviceFrames })),
          managedToolResultError, providerReplyFailure,
          providerReplyProjectSummary, afterRunFailure })).toBe(true);
        expect({ managedToolResultError, providerReplyFailure, afterRunFailure }).toEqual({
          managedToolResultError: null, providerReplyFailure: null, afterRunFailure: null,
        });
        expect(result.reservation?.status).toBe("completed");
      } finally {
        await browserContext?.close();
        await browser.close();
      }
    }, 240_000);
    }
  },
);
}
