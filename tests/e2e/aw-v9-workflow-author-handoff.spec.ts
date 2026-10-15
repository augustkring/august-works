import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { agents, authUsers, companyMemberships, createDb, closeRegisteredClients, principalPermissionGrants, workflowRuns, heartbeatRuns } from "../../packages/db/src/index.ts";
import { workflowRoutes } from "../../server/src/routes/workflows.ts";
import { workflowService } from "../../server/src/services/workflows/workflow-service.ts";
import { grantsForHumanRole } from "../../server/src/services/company-member-roles.ts";
import { errorHandler } from "../../server/src/middleware/error-handler.ts";
const require = createRequire(import.meta.url), axePath = require.resolve("axe-core/axe.min.js");
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const express = serverRequire("express"), { eq } = serverRequire("drizzle-orm");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// The built UI uses actual migrated Workflow/author policy reads. Auth/session
// and an inactive Native runtime configuration are explicit structural fixtures.
// No Send is clicked and no model/provider/Human qualification is claimed.
test("saved workflow hands an exact reviewed request to the real Native composer without dispatch on Danish mobile", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(path.basename(path.dirname(path.dirname(path.dirname(configPath))))).toMatch(/^paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8")), pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const flags = await json(await request.get("/api/instance/settings/experimental")), session = await json(await request.get("/api/auth/get-session"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable Native author handoff fixture" } }));
  const userId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Handoff fixture", email: `${createHash("sha256").update(userId).digest("hex")}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId: company.id, principalType: "user", principalId: userId, ...grant })));
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId, companyIds: [company.id] }; next(); });
  app.use("/api", workflowRoutes(db)); app.use(errorHandler);
  const bridge = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => bridge.once("listening", resolve));
  const address = bridge.address(); if (!address || typeof address === "string") throw new Error("Controlled listener unavailable");
  const bridgeBase = `http://127.0.0.1:${address.port}`;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true,
      enableAiWorkflowAuthoring: true, enableAgentChat: true, enableClassicTaskInterface: false,
      experience_projection_v9: true, progressive_shell_v9: true, ambient_commands_v9: true } }));
    const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: { name: "Workflow helper", adapterType: "process",
      adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } } } }));
    await db.update(agents).set({ adapterType: "paperclip_runner" }).where(eq(agents.id, agent.id));
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "agent", principalId: agent.id, status: "active" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({ companyId: company.id, principalType: "agent", principalId: agent.id, permissionKey }))).onConflictDoNothing();
    const workflow = await workflowService(db).create(company.id, { name: "PRIVATE described workflow", description: "PRIVATE desired outcome" }, { principal: { type: "user", userId } });
    let writes = 0;
    const authorReads: unknown[] = [];
    page.on("request", incoming => {
      if (incoming.method() !== "GET" && /\/api\/(?:issues\/[^/]+\/comments|companies\/[^/]+\/(?:chats\/|workflow-authoring|heartbeat))/.test(new URL(incoming.url()).pathname)) writes++;
    });
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session,
      user: { ...session.user, id: userId, emailVerified: true }, session: { ...session.session, userId, localImplicit: false } } }));
    await page.route(`**/api/companies/${company.id}/workflows/${workflow.id}/experience**`, async route => {
      expect(route.request().method()).toBe("GET");
      const url = new URL(route.request().url()); expect(url.searchParams.get("expectedUserId")).toBe(userId);
      const response = await route.fetch({ url: bridgeBase + url.pathname + url.search });
      if (url.pathname.endsWith("/authors")) {
        const body = await response.json();
        authorReads.push({ status: response.status(), error: body.error ?? null, choices: body.choices?.length });
      }
      await route.fulfill({ response });
    });
    await page.goto(`/${company.issuePrefix}/workflows/${workflow.id}?revision=draft`);
    const picker = page.getByRole("region", { name: "Build the flow with an Agent", exact: true });
    await expect(picker.getByRole("combobox", { name: "Choose an Agent", exact: true })).toBeVisible();
    await picker.getByRole("combobox", { name: "Choose an Agent", exact: true }).selectOption(agent.id);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: "Fortsæt i samtalen", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${agent.id}\\?workflowDraft=${workflow.id}&draftRevision=${workflow.draftRevisionId}`));
    const handoff = page.getByRole("region", { name: "Byg flowet med en Agent", exact: true });
    await expect(handoff.getByRole("button", { name: "Forbered anmodning", exact: true }), JSON.stringify(authorReads)).toBeVisible();
    const footer = handoff.locator(".grid.grid-cols-2");
    const rectangles = await footer.evaluate(node => [...node.children].map(child => {
      const rect = child.getBoundingClientRect(); return { x: rect.x, width: rect.width, center: rect.y + rect.height / 2 };
    }));
    expect(rectangles).toHaveLength(2); expect(rectangles[1].x).toBeGreaterThan(rectangles[0].x);
    expect(Math.abs(rectangles[0].center - rectangles[1].center)).toBeLessThan(1);
    const editor = page.getByTestId("task-chat-composer-input").last().locator('[contenteditable="true"],textarea').first();
    await editor.fill("My existing unsent notes");
    expect(writes).toBe(0);
    await handoff.getByRole("button", { name: "Forbered anmodning", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(handoff).toContainText("Anmodningen blev lagt i beskedfeltet");
    await expect(editor).toContainText("My existing unsent notes"); await expect(editor).toContainText("dette gemte workflow-udkast");
    await expect(editor).toBeFocused();
    expect(await editor.innerText()).not.toMatch(/PRIVATE|Workflow helper/);
    await expect(editor.locator("a")).toHaveAttribute("href", `/${company.issuePrefix}/workflows/${workflow.id}?revision=draft&expectedDraftRevisionId=${workflow.draftRevisionId}`);
    expect(writes).toBe(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, company.id))).toEqual([]);
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, company.id))).toEqual([]);
    const unchanged = await workflowService(db).getDetail(company.id, workflow.id, { type: "board", source: "session", userId });
    expect(unchanged!.draftRevisionId).toBe(workflow.draftRevisionId); expect(unchanged!.publishedRevisionId).toBeNull();
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('[aria-label="Byg flowet med en Agent"]')).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("workflow-agent-handoff-da-mobile.png"), fullPage: true });
    // Exact-version handoff must become unavailable after a Native revision change.
    await workflowService(db).updateDraft(company.id, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph: {
      version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }],
      edges: [], variables: [], settings: {},
    } }, { principal: { type: "user", userId } });
    await page.reload(); await expect(handoff).toContainText("Udkastet er ændret");
    await expect(handoff.getByRole("button", { name: "Forbered anmodning", exact: true })).toHaveCount(0); expect(writes).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) => bridge.close(error => error ? reject(error) : resolve()));
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {});
    await request.delete(`/api/companies/${company.id}`).catch(() => {});
    await db.delete(authUsers).where(eq(authUsers.id, userId)); await closeRegisteredClients(databaseUrl);
  }
});
