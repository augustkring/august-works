import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentAuthoringDraftViewSchema } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Real built routes/layout with explicit account/draft software fixtures.
// Native verified membership and draft authority are tested in the DB suites;
// these responses neither impersonate a hosted user nor qualify a live agent.
for (const kind of ["custom", "hire"] as const) {
  test(`${kind} agent authoring hides an unsaved draft until the current account and a fresh owner read resolve`, async ({ page, request }, info) => {
    const company = await json(await request.post("/api/companies", { data: { name: `Disposable ${kind} account browser fixture` } }));
    try {
      const session = await json(await request.get("/api/auth/get-session"));
      const originalFlags = await json(await request.get("/api/instance/settings/experimental"));
      const flags = { ...originalFlags, ...Object.fromEntries(V5_FEATURE_KEYS.map((key) => [key, true])),
        enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true,
        billing_v6: true, agent_packages_v7: true, hire_agent_v9: true,
        experience_projection_v9: true, progressive_shell_v9: true };
      const id = "10000000-0000-4000-8000-000000000001";
      const packageId = "10000000-0000-4000-8000-000000000002";
      const draft = agentAuthoringDraftViewSchema.parse({ id, companyId: company.id, agentId: null,
        createdByUserId: session.user.id, kind, version: 1, status: "draft",
        step: kind === "custom" ? "identity" : "hire_access", baselineHash: null,
        ...(kind === "hire" ? { package: { key: "research", versionId: packageId, version: "1.0.0", contentHash: "a".repeat(64) } } : {}),
        content: agentAuthoringContentSchema.parse({ name: "PRIVATE saved draft", outcome: "Prepare a research draft", ownerUserId: session.user.id }),
        createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z" });
      let holdSession = false, holdRead = false, reads = 0, writes = 0;
      const sessions: Array<() => void> = [], ownerReads: Array<() => void> = [];
      await page.route("**/api/auth/get-session", async (route) => {
        if (holdSession) await new Promise<void>((resolve) => sessions.push(resolve));
        await route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } });
      });
      await page.route("**/api/instance/settings/experimental", (route) => route.fulfill({ json: flags }));
      await page.route(`**/api/companies/${company.id}/agent-configuration-drafts/**`, async (route) => {
        expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
        if (route.request().method() !== "GET") { writes++; return route.fulfill({ status: 409, json: { error: "No fixture write is qualified" } }); }
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/options")) return route.fulfill({ json: { owners: [{ id: session.user.id, name: "Accountable author" }], knowledge: [], runtimes: [] } });
        if (path.endsWith("/hire-capability")) return route.fulfill({ json: { key: "research", versionId: packageId, version: "1.0.0",
          name: "Research draft", category: "Research", outcome: "Prepare a research draft", requiredKnowledge: [], requiredConnections: [], limits: [], actionClasses: ["internal_draft"], available: true } });
        expect(path.endsWith(`/${id}`)).toBe(true); reads++;
        if (holdRead) await new Promise<void>((resolve) => ownerReads.push(resolve));
        return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: draft });
      });
      await page.goto(`/${company.issuePrefix}/dashboard`);
      await expect(page.getByRole("main")).toBeVisible();
      await page.goto(`/${company.issuePrefix}/agents/${kind === "custom" ? `custom/${id}/identity` : `hire/drafts/${id}/hire_access`}`);
      const name = page.getByRole("textbox", { name: "Agent name", exact: true });
      await expect(name).toHaveValue("PRIVATE saved draft");
      const heading = page.getByRole("heading", { level: 1, name: kind === "custom" ? "Identity" : "Owner & knowledge", exact: true });
      await expect(heading).toBeFocused();
      await name.fill("PRIVATE unsaved account draft");
      const priorReads = reads; holdSession = true; holdRead = true;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
      await expect.poll(() => sessions.length).toBeGreaterThan(0);
      await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
      await expect(page.getByRole("main")).not.toContainText("PRIVATE");
      expect(reads).toBe(priorReads); expect(writes).toBe(0);
      holdSession = false; for (const release of sessions.splice(0)) release();
      await expect.poll(() => ownerReads.length).toBeGreaterThan(0);
      await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
      holdRead = false; for (const release of ownerReads.splice(0)) release();
      await expect(name).toHaveValue("PRIVATE unsaved account draft");
      await expect(heading).toBeFocused();
      expect(reads).toBeGreaterThan(priorReads); expect(writes).toBe(0);
      const readsBeforeLanguageChange = reads;
      await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
      await expect(page.locator("html")).toHaveAttribute("lang", "da");
      await expect(page.getByRole("heading", { level: 1, name: kind === "custom" ? "Identitet" : "Ejer og viden", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: kind === "custom" ? "Agentnavn" : "Agentens navn", exact: true })).toHaveValue("PRIVATE unsaved account draft");
      await expect(page.getByRole("button", { name: "Gem og afslut", exact: true })).toBeEnabled();
      expect(reads).toBe(readsBeforeLanguageChange); expect(writes).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addScriptTag({ path: axePath });
      expect(await page.evaluate(async () => (await (window as unknown as {
        axe: { run(scope: string): Promise<{ violations: unknown[] }> };
      }).axe.run("main")).violations)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(name).toHaveValue("PRIVATE unsaved account draft");
      expect(reads).toBe(readsBeforeLanguageChange); expect(writes).toBe(0);
      const base = `/api/companies/${company.id}`;
      expect(await json(await request.get(`${base}/agents`))).toEqual([]);
      expect(await json(await request.get(`${base}/issues`))).toEqual([]);
      const runs = await json(await request.get(`${base}/heartbeat-runs`));
      expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
      await page.screenshot({ path: info.outputPath(`v9-${kind}-account-draft-mobile.png`), fullPage: true });
    } finally {
      await json(await request.delete(`/api/companies/${company.id}`));
    }
  });
}
