import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
registerEnglishAccountLocaleIsolation(test);
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Actual Native waiting run, cancellation, journal and exact GET. The browser
// session is controlled; no real Human/host/provider completion is qualified.
test("retained workflow Stop recovers one actual Native request with rollout disabled and no replacement POST", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable retained workflow Stop" } }));
  const session = await json(await request.get("/api/auth/get-session"));
  let posts = 0, reads = 0, saved: { requestId: string } | null = null;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true,
      experience_projection_v9: true, progressive_shell_v9: true } }));
    const workflows = `/api/companies/${company.id}/workflows`, draft = await json(await request.post(workflows, { data: { name: "Wait until explicitly stopped" } }));
    const prepared = await json(await request.patch(`${workflows}/${draft.id}/draft`, { data: { expectedRevisionId: draft.draftRevisionId,
      graph: { version: 1, variables: [], settings: { totalDeadlineSeconds: 600 }, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", config: {}, position: { x: 0, y: 0 } },
        { id: "wait", type: "core.wait", name: "Wait", config: { durationSeconds: 300 }, position: { x: 0, y: 1 } }],
        edges: [{ id: "start-wait", source: "start", target: "wait" }] } } }));
    await json(await request.post(`${workflows}/${draft.id}/publish`, { data: { expectedDraftRevisionId: prepared.draftRevisionId, expectedPublishedRevisionId: null, approvalId: null } }));
    const waiting = await json(await request.post(`${workflows}/${draft.id}/run`, { headers: { "Idempotency-Key": "retained-stop-browser-software-fixture" }, data: { input: {} } }));
    expect(waiting.run.status).toBe("waiting"); const run = waiting.run.id, base = `/api/companies/${company.id}/workflow-runs/${run}/experience`;
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route(`**${base}/retained-stop?**`, async route => {
      expect(route.request().method()).toBe("POST"); posts++; expect(posts).toBe(1); saved = await json(await route.fetch()); await route.abort("failed");
    });
    await page.route(`**${base}/retained-stop-requests/**`, async route => { expect(route.request().method()).toBe("GET"); reads++; await route.continue(); });
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: false, enableWorkflowBuilderV1: false, progressive_shell_v9: false } }));
    await page.goto(`/${company.issuePrefix}/workflows/${draft.id}/runs/${run}/control`);
    await expect(page.getByRole("heading", { level: 1, name: "Stop this workflow run", exact: true })).toBeVisible();
    await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Request Stop", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(() => saved?.requestId).toBeTruthy();
    await expect(page.getByRole("main")).toContainText("This Stop request is unconfirmed");
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-run-stop-receipts"))).toContain(saved!.requestId);
    await page.reload(); await page.getByRole("button", { name: "Check original Stop request", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Stop request recorded", exact: true })).toBeFocused();
    await expect(page.getByRole("main")).toContainText("does not prove that every child task or running process has stopped");
    expect(posts).toBe(1); expect(reads).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-run-stop-receipts"))).toBeNull();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da"); await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { level: 1, name: "Stopanmodning registreret", exact: true })).toBeVisible();
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("retained-workflow-stop-da-mobile.png"), fullPage: true });
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {});
    await request.delete(`/api/companies/${company.id}`).catch(() => {});
  }
});
