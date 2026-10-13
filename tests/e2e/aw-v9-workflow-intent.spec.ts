import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Actual built routing, form, account/cache fences, locale and browser storage.
// Owner responses and verified account are controlled software fixtures. The
// separate migrated PostgreSQL suite exercises actual creation and rollback.
test("described workflow recovers its original request after reload, with Danish mobile and keyboard accessibility", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  await json(await request.patch("/api/instance/settings/experimental", { data: {
    experience_projection_v9: true, progressive_shell_v9: true, home_v9: true,
    enableWorkflowsV1: true, enableWorkflowBuilderV1: true,
  } }));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable workflow-intent browser fixture" } }));
  const session = await json(await request.get("/api/auth/get-session"));
  const base = `/api/companies/${company.id}/experience`, workflowId = "10000000-0000-4000-8000-000000000002";
  let saved: Record<string, unknown> | null = null, posts = 0, reads = 0;
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
  await page.route(`**${base}/workflow-drafts?**`, async route => {
    expect(route.request().method()).toBe("POST");
    expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
    const input = route.request().postDataJSON(); posts++;
    expect(posts).toBe(1); expect(input.outcome).toBe("PRIVATE-MARKER Prepare a summary");
    saved = { companyId: company.id, workflowId, requestId: input.requestId,
      draftRevisionId: "10000000-0000-4000-8000-000000000003", createdAt: "2026-10-13T18:00:00.000Z", executionStarted: false, published: false };
    await route.abort("failed");
  });
  await page.route(`**${base}/workflow-draft-requests/**`, async route => {
    expect(route.request().method()).toBe("GET"); reads++;
    expect(saved).not.toBeNull(); expect(new URL(route.request().url()).pathname).toContain(String(saved!.requestId));
    expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
    if (reads === 1) return route.fulfill({ status: 404, json: { error: "Private original fixture unavailable" } });
    return route.fulfill({ headers: { "Cache-Control": "no-store" }, json: saved });
  });
  try {
    await page.goto(`/${company.issuePrefix}/workflows/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Describe a workflow", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Workflow name", exact: true }).fill("Enquiry review");
    await page.getByRole("textbox", { name: "What should this achieve?", exact: true }).fill("PRIVATE-MARKER Prepare a summary");
    expect(posts).toBe(0);
    await page.getByRole("button", { name: "Save draft", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toContainText("The draft request is unconfirmed.");
    expect(posts).toBe(1); expect(reads).toBe(0);
    const locator = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-draft-receipts"));
    expect(locator).toContain(String(saved!.requestId)); expect(locator).not.toContain("PRIVATE-MARKER");
    await page.reload();
    await expect(page.getByRole("button", { name: "Check original request", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Workflow name", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Check original request", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("does not prove that the draft was not saved");
    expect(posts).toBe(1);
    await page.getByRole("button", { name: "Check original request", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workflow draft saved", exact: true })).toBeFocused();
    expect(posts).toBe(1); expect(reads).toBe(2);
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-draft-receipts"))).toBeNull();
    await expect(page.getByRole("link", { name: "Open workflow draft", exact: true })).toHaveAttribute("href", new RegExp(`/workflows/${workflowId}$`));
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByRole("heading", { level: 1, name: "Arbejdsgangens udkast er gemt", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-workflow-intent-receipt-da-mobile.png"), fullPage: true });
  } finally {
    await request.delete(`/api/companies/${company.id}`);
    await request.patch("/api/instance/settings/experimental", { data: flags });
  }
});
