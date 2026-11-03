import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect as browserExpect, type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, createDb, projectWorkspaces, projects } from "@paperclipai/db";
import { createApp } from "../../app.js";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable, runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { setupLiveEventsWebSocketServer } from "../../realtime/live-events-ws.js";
import { nativeSha256 } from "./canonical.js";

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
    async reportFailure(entry: "project_card_entry" | "repository_card_entry", composer: Locator, claim: Locator) {
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

    it("sends a real chat message and retains the qualified private Project card after reload", async () => {
      const browser = await chromium.launch({ executablePath, headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      let browserContext: BrowserContext | undefined;
      let page: Page | undefined;
      let origin = "";
      let route = "";
      let consumedProjectId: string | null = null;
      const name = `Browser private Project ${randomUUID().slice(0, 8)}`;
      const callId = `browser-project-${randomUUID()}`;
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
              const tools = body.tools as Array<{ name: string }>;
              const tool = tools.find(value => value.name.endsWith("create_project"));
              if (!tool) throw new Error("managed_browser_project_tool_missing");
              return { stop_reason: "tool_use", content: [{ type: "tool_use", id: callId, name: tool.name,
                input: { name, workspace: { name: "Browser workspace" }, idempotencyKey: callId } }] };
            }
            expect(callIndex).toBe(2);
            const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
            const output = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
              .find(block => block.type === "tool_result" && block.tool_use_id === callId);
            expect(output?.is_error).not.toBe(true);
            const content = output?.content;
            const text = typeof content === "string" ? content : Array.isArray(content)
              ? content.map(part => String(part.text ?? "")).join("") : "";
            const project = JSON.parse(text) as { id: string; name: string; visibility: string };
            expect(project).toMatchObject({ name, visibility: "private" });
            consumedProjectId = project.id;
            return undefined;
          },
          afterRunSettledBeforeTeardown: async facts => {
            expect(facts.run?.status).toBe("succeeded");
            expect(consumedProjectId).toEqual(expect.any(String));
            const rows = await db.select().from(projects).where(and(eq(projects.companyId, facts.companyId),
              eq(projects.id, consumedProjectId!)));
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ visibility: "private", privacyOwnerUserId: facts.actor.userId });
            if (!page) throw new Error("managed_browser_page_missing");
            await page.goto(`${origin}${route}`);
            const card = page.getByRole("article", { name: `Project created: ${name}`, exact: true });
            await browserExpect(card).toHaveCount(1, { timeout: 30_000 });
            await page.reload();
            await browserExpect(card).toHaveCount(1);
            await browserExpect(card.getByRole("link", { name, exact: true })).toHaveAttribute("href", /\/projects\//);
          } });
        expect(result.success).toBe(true);
        expect(result.reservation?.status).toBe("completed");
      } finally {
        await browserContext?.close();
        await browser.close();
      }
    }, 240_000);

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
  },
);
