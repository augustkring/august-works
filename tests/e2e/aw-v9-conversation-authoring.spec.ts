import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// The shipped conversation, composer and preview render with explicitly scoped
// authoring metadata. Actual Original tool/revision provenance is exercised in
// the PostgreSQL suites, not asserted from these synthetic browser responses.
test("conversation previews a saved workflow version without publishing or calling its agent", async ({ page, request }) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable saved proposal browser fixture" } }));
  const original = await json(await request.get("/api/instance/settings/experimental"));
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableAgentChat: true, enableClassicTaskInterface: false } }));
    const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: { name: "Proposal author", adapterType: "process",
      adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } } } }));
    const conversation = await json(await request.post(`/api/companies/${company.id}/chats/${agent.id}`, { data: {} }));
    const session = await json(await request.get("/api/auth/get-session"));
    const flags = { ...original, ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableAgentChat: true, enableClassicTaskInterface: false,
      enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true,
      experience_projection_v9: true, progressive_shell_v9: true, ambient_commands_v9: true };
    let reads = 0, writes = 0;
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
    await page.route(`**/api/companies/${company.id}/conversations/${conversation.id}/authoring**`, route => {
      const url = new URL(route.request().url()); expect(url.searchParams.get("expectedUserId")).toBe(session.user.id);
      expect(route.request().method()).toBe("GET"); reads++;
      return route.fulfill({ json: { companyId: company.id, conversationId: conversation.id, agentId: agent.id, generation: 0,
        observedAt: "2026-10-13T00:00:00Z", hasMore: false, modelCalled: false, proposals: [{ kind: "workflow", id: id(1), name: "Saved weekly review proposal",
          authoredRevisionId: id(2), authoredRevisionNumber: 2, currentDraftRevisionId: id(3), currentPublishedRevisionId: null,
          state: "changed", stepCount: 2, triggerCount: 1, href: `/workflows/${id(1)}`,
          preview: { id: id(2), version: 2, coverage: "complete", steps: [
            { number: 1, name: "Begin weekly review", operation: "Manual trigger", effect: "pure", testMode: "safe", approval: "not_verified", retry: "none", next: [{ number: 2, label: null, output: null }] },
            { number: 2, name: "Research account", operation: "Transform", effect: "pure", testMode: "safe", approval: "not_verified", retry: "none", next: [{ number: 3, label: null, output: null }] },
            { number: 3, name: "Ask before outreach", operation: "Approval", effect: "pure", testMode: "safe", approval: "checkpoint", retry: "none", next: [] },
          ] }, comparison: { state: "available", steps: [{ number: 2, change: "changed" }], removedSteps: 0,
            connectionsChanged: false, dataDefinitionChanged: false, settingsChanged: false } }] } });
    });
    await page.route(`**/api/companies/${company.id}/workflows/**`, route => {
      if (route.request().method() !== "GET") writes++;
      return route.fulfill({ status: 409, json: { error: "This preview does not authorize workflow writes" } });
    });
    await page.goto(`/${company.issuePrefix}/chats/${agent.id}`);
    const preview = page.getByRole("region", { name: "Saved conversation proposals", exact: true });
    await expect(preview).toContainText("Saved weekly review proposal");
    await expect(preview).toContainText("Proposed version 2 · 2 steps · 1 triggers");
    await expect(preview).toContainText("changed since this proposed version");
    await expect(preview.getByRole("link", { name: "Review the current workflow", exact: true })).toHaveAttribute("href", `/${company.issuePrefix}/workflows/${id(1)}`);
    await preview.getByText("Inspect this proposed version", { exact: true }).click();
    await expect(preview.getByText("Research account", { exact: false })).toBeVisible();
    await expect(preview).toContainText("No approval decision is confirmed");
    await expect(preview).toContainText("0 added · 1 changed · 0 removed");
    await expect(preview.getByRole("button", { name: /publish|activate/i })).toHaveCount(0);
    const beforeLanguage = reads;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.locator("html")).toHaveAttribute("lang", "da");
    await expect(page.getByRole("region", { name: "Gemte forslag fra samtalen", exact: true })).toContainText("Foreslået version 2");
    expect(reads).toBe(beforeLanguage); expect(writes).toBe(0);
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('[aria-label="Gemte forslag fra samtalen"]')).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const runs = await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`));
    expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
    // Conversation tasks are intentionally omitted from the normal task list.
    expect(await json(await request.get(`/api/companies/${company.id}/issues`))).toEqual([]);
    expect(await json(await request.get(`/api/issues/${conversation.id}`))).toMatchObject({ id: conversation.id, conversationAgentId: agent.id });
  } finally {
    await json(await request.patch("/api/instance/settings/experimental", { data: original }));
    await json(await request.delete(`/api/companies/${company.id}`));
  }
});
