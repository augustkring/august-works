import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { agentRetirementViewSchema, type AgentRetirementView } from "../../packages/shared/src/agent-retirement.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Built customer UI with explicit software account/retirement transport.
// Native authority, cleanup, replay and fencing are qualified by migrated
// PostgreSQL tests. This fixture grants no hosted identity or provider proof.
test("reviewed retirement survives an unknown reply and hides private state when current access is withdrawn", async ({ page, request }, info) => {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable retirement UI fixture" } }));
  const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
    name: "Original paused retirement agent", role: "engineer", adapterType: "process",
  } }));
  await json(await request.post(`/api/agents/${agent.id}/pause`, { data: {} }));
  const principal = "software-retirement-owner", commands: Array<Record<string, unknown>> = [];
  let available = true, value: AgentRetirementView = agentRetirementViewSchema.parse({ companyId: company.id, agentId: agent.id, name: agent.name,
    observedAt: "2026-10-11T00:00:00Z", sourceToken: "a".repeat(64), state: "ready", alreadyStopped: false,
    canRetire: true, blockers: [], retiredAt: null, policyVersion: "aw.agent-retirement.v1",
    affectedAccess: { apiKeys: 1, permissions: 2, agentPermissionSettings: 1, connectedApps: 0, credentialBindings: 1, runtimeBindings: 0, toolTokens: 0, toolProfiles: 0 } });
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
    session: { id: "software-retirement-session", userId: principal, localImplicit: false },
    user: { id: principal, email: "retirement@example.test", name: "Software account fixture", image: null }, sentryDsn: null,
  } }));
  await page.route(`**/api/companies/${company.id}/agents/${agent.id}/retirement?**`, async route => {
    expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(principal);
    if (!available) return route.fulfill({ status: 403, headers: { "Cache-Control": "private, no-store" }, json: { error: "Current access unavailable" } });
    if (route.request().method() === "GET") return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: value });
    const input = route.request().postDataJSON(); commands.push(input); expect(commands).toHaveLength(1);
    expect(Object.keys(input).sort()).toEqual(["accessPolicy", "confirmRetirement", "expectedSourceToken", "pendingWorkPolicy", "requestId", "retentionPolicy"]);
    expect(input).toMatchObject({ expectedSourceToken: value.sourceToken, confirmRetirement: true,
      pendingWorkPolicy: "require_settled", accessPolicy: "detach_agent_only", retentionPolicy: "existing_company_policy" });
    value = agentRetirementViewSchema.parse({ ...value, state: "retired", alreadyStopped: true, canRetire: false, retiredAt: value.observedAt });
    return route.abort("failed");
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_projection_v9: true, progressive_shell_v9: true } }));
    await page.goto(`/${company.issuePrefix}/agents/${agent.id}/retire`);
    const heading = page.getByRole("heading", { level: 1, name: `Retire ${agent.name}`, exact: true });
    const retire = page.getByRole("button", { name: "Permanently retire agent", exact: true });
    await expect(heading).toBeVisible(); await expect(heading).toBeFocused(); await expect(retire).toBeDisabled();
    const confirm = page.getByRole("checkbox"); await confirm.focus(); await confirm.press("Space"); await expect(retire).toBeEnabled();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByRole("heading", { level: 1, name: `Pensionér ${agent.name}`, exact: true })).toBeVisible(); expect(commands).toHaveLength(0);
    await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
    await retire.focus(); await retire.press("Enter"); await expect(page.getByRole("main").getByRole("alert")).toBeVisible(); expect(commands).toHaveLength(1);
    await page.reload();
    await expect(page.getByText("Retirement is confirmed.", { exact: false })).toBeVisible(); await expect(confirm).toHaveCount(0); await expect(retire).toHaveCount(0);
    expect(commands).toHaveLength(1);
    const back = page.getByRole("link", { name: "Back to agent", exact: true });
    await expect(back).toHaveAttribute("href", new RegExp(`/agents/${agent.id}/monitor$`)); await back.focus(); await expect(back).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-agent-retirement-mobile.png"), fullPage: true });
    available = false; await page.reload(); await expect(heading).toHaveCount(0); await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByText("Retirement is confirmed.", { exact: false })).toHaveCount(0); expect(commands).toHaveLength(1);
    const native = await json(await request.get(`/api/agents/${agent.id}`)); expect(native.status).toBe("paused");
    const runs = await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`)); expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
  } finally {
    await json(await request.patch("/api/instance/settings/experimental", { data: original }));
    await json(await request.delete(`/api/companies/${company.id}`));
  }
});
