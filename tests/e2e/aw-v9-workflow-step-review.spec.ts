import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { authUsers, companyMemberships, createDb, closeRegisteredClients, principalPermissionGrants,
  agents, toolApplications, toolConnections, toolCatalogEntries, workflowRuns } from "../../packages/db/src/index.ts";
import { workflowRoutes } from "../../server/src/routes/workflows.ts";
import { errorHandler } from "../../server/src/middleware/error-handler.ts";
const requireServer = createRequire(new URL("../../server/package.json", import.meta.url));
const express = requireServer("express"), { eq } = requireServer("drizzle-orm");
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// The verified actor/session bridge is a controlled software fixture. Native
// membership, grants, Source/revision, Agent and connection owners are real;
// no real Human, provider transport or hosted runtime is qualified here.
test("current ordered review shows exact private input and missing connection access in Danish mobile, then refuses actual membership withdrawal", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(path.basename(path.dirname(path.dirname(path.dirname(configPath))))).toMatch(/^paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const flags = await json(await request.get("/api/instance/settings/experimental")), session = await json(await request.get("/api/auth/get-session"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable step review fixture" } }));
  const userId = randomUUID(), agentId = randomUUID(), secondAgentId = randomUUID(), applicationId = randomUUID(), connectionId = randomUUID(), entryId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Viewer fixture", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "viewer", status: "active" });
  await db.insert(principalPermissionGrants).values({ companyId: company.id, principalType: "user", principalId: userId, permissionKey: "workflows:read" });
  await db.insert(agents).values({ id: agentId, companyId: company.id, name: "Selected analyst", adapterType: "process", status: "idle" });
  await db.insert(agents).values({ id: secondAgentId, companyId: company.id, name: "Second analyst", adapterType: "process", status: "idle" });
  await db.insert(toolApplications).values({ id: applicationId, companyId: company.id, name: "Contacts fixture", type: "mcp_http" });
  await db.insert(toolConnections).values({ id: connectionId, companyId: company.id, applicationId, name: "Contact system", uid: randomUUID(), transport: "mcp_remote", status: "active", enabled: true,
    config: { privateToken: "PRIVATE credential" }, transportConfig: { url: "https://private-endpoint.invalid" } });
  await db.insert(toolCatalogEntries).values({ id: entryId, companyId: company.id, applicationId, connectionId, name: "contacts.lookup", toolName: "contacts.lookup", title: "Find contacts", versionHash: "version-a", schemaHash: "schema-a", inputSchema: { type: "object" } });
  const app = express(); app.use(express.json()); app.use(async (req, _res, next) => {
    try {
      const memberships = await db.select().from(companyMemberships).where(eq(companyMemberships.principalId, userId));
      req.actor = { type: "board", source: "session", userId,
        companyIds: memberships.filter(item => item.status === "active").map(item => item.companyId),
        memberships: memberships.map(item => ({ companyId: item.companyId, membershipRole: item.membershipRole, status: item.status })) };
      next();
    } catch (error) { next(error); }
  });
  app.use("/api", workflowRoutes(db)); app.use(errorHandler);
  const bridge = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => bridge.once("listening", resolve));
  const address = bridge.address(); if (!address || typeof address === "string") throw new Error("Controlled fixture listener unavailable");
  const bridgeBase = `http://127.0.0.1:${address.port}`;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true } }));
    const base = `/api/companies/${company.id}/workflows`, created = await json(await request.post(base, { data: { name: "Review exact steps" } }));
    const prepared = await json(await request.patch(`${base}/${created.id}/draft`, { data: { expectedRevisionId: created.draftRevisionId,
      graph: { version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "condition", type: "core.condition", name: "Choose by amount", position: { x: 0, y: 1 }, config: { expression: '{{trigger["customer.name"]["amount"]}} >= 10000' } },
        { id: "agent", type: "agent.task", name: "Analyze", position: { x: 1, y: 2 }, config: { agentId, objective: "PRIVATE objective" } },
        { id: "tool", type: "connector.action", name: "Find contacts", position: { x: -1, y: 2 }, config: { connectionId, toolCatalogEntryId: entryId, catalogVersionHash: "version-a", catalogSchemaHash: "schema-a", input: { secret: "PRIVATE tool input" } } },
        { id: "approval", type: "human.approval", name: "Review result", position: { x: 0, y: 3 }, config: { summary: "PRIVATE review facts", consequence: "PRIVATE continue after review" } },
      ], edges: [{ id: "next", source: "start", target: "condition" }, { id: "yes", source: "condition", target: "agent", sourceHandle: "true" },
        { id: "no", source: "condition", target: "tool", sourceHandle: "false" }, { id: "review", source: "agent", target: "approval" }], variables: [], settings: {} } } }));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, user: { ...session.user, id: userId, emailVerified: true }, session: { ...session.session, userId, localImplicit: false } } }));
    await page.route(`**${base}/${created.id}/experience**`, async route => { const url = new URL(route.request().url()); await route.fulfill({ response: await route.fetch({ url: bridgeBase + url.pathname + url.search }) }); });
    const url = `/${company.issuePrefix}/workflows/${created.id}`;
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url);
    await expect(page.getByText("Selected analyst", { exact: true })).toBeVisible();
    await expect(page.getByText("PRIVATE review facts", { exact: true })).toBeVisible();
    await expect(page.getByText('"customer.name"', { exact: true })).toBeVisible();
    await expect(page.getByText("Your current account lacks permission to use connected tools in this company. Review the connection permissions.", { exact: true })).toBeVisible();
    const preview = page.getByRole("link", { name: "Review Contact system permissions", exact: true });
    await expect(preview).toHaveAttribute("href", new RegExp(`/apps/${connectionId}/permissions$`));
    await expect(page.getByRole("button", { name: "Review internal test", exact: true })).toHaveCount(0);
    await expect(page.getByText("PRIVATE objective", { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("PRIVATE tool input");
    await expect(page.getByRole("main")).not.toContainText("PRIVATE credential");
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByText("Din aktuelle konto mangler tilladelse til at bruge tilsluttede værktøjer i denne virksomhed. Gennemgå forbindelsens tilladelser.", { exact: true })).toBeVisible();
    await expect(page.getByText("Er større end eller lig med", { exact: true })).toBeVisible();
    await expect(page.getByText("PRIVATE continue after review", { exact: true })).toBeVisible();
    await page.addScriptTag({ path: axePath }); expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("current-step-input-access-da-mobile.png"), fullPage: true });
    const unchanged = await json(await request.get(`${base}/${created.id}`)); expect(unchanged.draftRevision).toEqual(prepared.draftRevision); expect(unchanged.publishedRevisionId).toBeNull();
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, company.id))).toEqual([]);
    await db.update(companyMemberships).set({ membershipRole: "owner" }).where(eq(companyMemberships.principalId, userId));
    await db.insert(principalPermissionGrants).values({ companyId: company.id, principalType: "user", principalId: userId, permissionKey: "workflows:edit" });
    await page.goto(`/${company.issuePrefix}/workflows/${created.id}/draft/steps/agent`);
    await expect(page.getByRole("heading", { name: "Rediger et kladdetrin", exact: true })).toBeVisible();
    await expect(page.getByText("Dette trin venter på, at opgaven bliver færdig, før flowet fortsætter.", { exact: true })).toBeVisible();
    await page.getByLabel("Hvad skal Agenten gøre?", { exact: true }).fill("PRIVATE revised objective\nBrug kun godkendte oplysninger");
    await page.getByRole("combobox", { name: "Agent til dette trin", exact: true }).selectOption({ label: "Second analyst" });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Gem kladdeændringer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Dine ændringer blev gemt" })).toBeVisible();
    const edited = await json(await request.get(`${base}/${created.id}`));
    const oldAgent = prepared.draftRevision.graph.nodes.find((node: { id: string }) => node.id === "agent");
    expect(edited.draftRevision.graph.nodes.find((node: { id: string }) => node.id === "agent")).toEqual({ ...oldAgent,
      config: { ...oldAgent.config, agentId: secondAgentId, objective: "PRIVATE revised objective\nBrug kun godkendte oplysninger" } });
    await expect(page.getByRole("combobox", { name: "Agent til dette trin", exact: true })).toContainText("Behold Second analyst");
    expect(edited.draftRevision.graph.edges).toEqual(prepared.draftRevision.graph.edges); expect(edited.publishedRevisionId).toBeNull();
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, company.id))).toEqual([]);
    await db.update(companyMemberships).set({ status: "inactive" }).where(eq(companyMemberships.principalId, userId));
    await page.goto(url); await expect(page.getByRole("alert").filter({ hasText: "Dette workflow kunne ikke kontrolleres" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("PRIVATE review facts"); await expect(page.getByRole("main")).not.toContainText("Selected analyst");
    await expect(page.getByRole("main")).not.toContainText("PRIVATE objective");
    await expect(page.getByRole("main")).not.toContainText("PRIVATE revised objective");
  } finally {
    await new Promise<void>((resolve, reject) => bridge.close(err => err ? reject(err) : resolve()));
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {}); await request.delete(`/api/companies/${company.id}`).catch(() => {});
    await db.delete(authUsers).where(eq(authUsers.id, userId)); await closeRegisteredClients(databaseUrl);
  }
});
