import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect as browserExpect, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, projects } from "@paperclipai/db";
import { createApp } from "../../app.js";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable, runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";

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
      let page: Page | undefined;
      let origin = "";
      let route = "";
      let consumedProjectId: string | null = null;
      const name = `Browser private Project ${randomUUID().slice(0, 8)}`;
      const callId = `browser-project-${randomUUID()}`;
      try {
        const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary!,
          conversationWorkMode: "standard",
          createConversationApp: async ({ heartbeat, resolveSession }) => {
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
              return { app, origin, close: async () => {
                try { await app.locals.paperclipShutdown?.(); }
                finally { await closeServer(); }
              } };
            } catch (error) {
              await closeServer();
              throw error;
            }
          },
          driveConversation: async context => {
            const browserContext = await browser.newContext();
            const [cookieName, ...cookieValue] = context.humanCookie.split("=");
            await browserContext.addCookies([{ name: cookieName!, value: cookieValue.join("="), url: context.origin }]);
            const opened = await browserContext.request.post(`${context.origin}${context.chatPath}`, {
              headers: { origin: context.origin } });
            expect(opened.status()).toBe(200);
            const chat = await opened.json() as { id: string };
            context.onConversationOpened(chat.id);
            const mode = await browserContext.request.patch(`${context.origin}/api/issues/${chat.id}`, {
              headers: { origin: context.origin }, data: { workMode: "standard" } });
            expect(mode.status()).toBe(200);
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
        await browser.close();
      }
    }, 240_000);
  },
);
