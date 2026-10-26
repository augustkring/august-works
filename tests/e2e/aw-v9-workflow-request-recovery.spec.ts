import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Native C0 admission, executor, journal and exact receipt GET are actual.
// UI session and the pre-admission workflow view are controlled software
// fixtures; this is not hosted/provider or real authenticated Human evidence.
test("a lost workflow Test response recovers the exact Native request after reload and rollout withdrawal without another POST", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable exact workflow request recovery" } }));
  const base = `/api/companies/${company.id}/workflows`, session = await json(await request.get("/api/auth/get-session"));
  let posts = 0, receiptReads = 0, saved: { requestId: string; runId: string } | null = null;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true } }));
    const draft = await json(await request.post(base, { data: { name: "Recover internal test admission" } }));
    await json(await request.patch(`${base}/${draft.id}/draft`, { data: { expectedRevisionId: draft.draftRevisionId,
      graph: { version: 1, variables: [], settings: { totalDeadlineSeconds: 60 },
        nodes: [{ id: "start", type: "core.manual_trigger", name: "Start an internal test", config: {}, position: { x: 0, y: 0 } }], edges: [] } } }));
    const view = await json(await request.get(`${base}/${draft.id}/experience?expectedUserId=local-board`));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    // Hold the reviewed fixture frame while the acknowledgement is lost, so
    // the fresh-page flow exercises exact recovery rather than latest-receipt
    // observation. The Native command still checks its actual current version.
    await page.route(`**${base}/${draft.id}/experience?**`, route => route.fulfill({ headers: { "Cache-Control": "no-store" }, json: view }));
    await page.route(`**${base}/${draft.id}/experience/test?**`, async route => {
      expect(route.request().method()).toBe("POST"); posts++; expect(posts).toBe(1);
      saved = await json(await route.fetch()); await route.abort("failed");
    });
    await page.route(`**${base}/${draft.id}/experience/requests/test/**`, async route => {
      expect(route.request().method()).toBe("GET"); receiptReads++; await route.continue();
    });
    await page.goto(`/${company.issuePrefix}/workflows/${draft.id}`);
    await page.getByRole("button", { name: "Review internal test", exact: true }).click();
    const dialog = page.getByRole("dialog"); await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Start internal test", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog).toContainText("The test result is unknown");
    const stored = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"));
    expect(stored).toContain(saved!.requestId); expect(stored).not.toMatch(/expectedUpdatedAt|acknowledge|prompt|input/);
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: false, enableWorkflowBuilderV1: false, progressive_shell_v9: false } }));
    await page.reload(); await expect(page.getByRole("heading", { level: 2, name: "Unconfirmed workflow requests", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Check saved test request", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workflow request confirmed", exact: true })).toBeFocused();
    await expect(page.getByRole("main")).toContainText("does not describe the workflow’s current state");
    await expect(page.getByRole("link", { name: "Review the recorded run", exact: true })).toHaveAttribute("href", new RegExp(`/runs/${saved!.runId}$`));
    expect(posts).toBe(1); expect(receiptReads).toBeGreaterThan(0);
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).toBeNull();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da"); await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("main")).toContainText("En testanmodning blev accepteret");
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("native-workflow-request-recovery-da-mobile.png"), fullPage: true });
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {});
    await request.delete(`/api/companies/${company.id}`).catch(() => {});
  }
});
