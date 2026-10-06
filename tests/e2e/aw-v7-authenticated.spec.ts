import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

async function signUp(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create one", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("V7 browser reviewer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("V7-fixture-password-12345");
  await page.getByRole("button", { name: "Create Account", exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

// Real browser, authentication, company scopes, database and domain routes.
// A paused local presence supplies no inference or physical runtime evidence.
test("V7 discovery answers, readiness and governance remain human reviewed and company scoped", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const stamp = Date.now();
  await signUp(page, `v7-owner-${stamp}@test.invalid`);
  const config = process.env.PAPERCLIP_E2E_SERVER_CONFIG;
  if (!config || !baseURL) throw new Error("An isolated authenticated server is required");
  const invitation = execFileSync("pnpm", ["--filter", "@paperclipai/db", "exec", "tsx", path.resolve("packages/db/scripts/create-auth-bootstrap-invite.ts"), "--config", config, "--base-url", baseURL], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const bootstrapToken = new URL(invitation).pathname.split("/").at(-1);
  await json(await page.request.post(`/api/invites/${bootstrapToken}/accept`, { data: { requestType: "human" } }));
  const flags = await json(await page.request.get("/api/instance/settings/experimental"));
  const enabled = { enableFoundationV1: true, enableContextEngineV1: true, readiness_engine_v7: true, foundation_bootstrap_v7: true, ai_use_cases_v7: true, governance_evidence_v7: true };
  const guestContext = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    await json(await page.request.patch("/api/instance/settings/experimental", { data: enabled }));
    const company = await json(await page.request.post("/api/companies", { data: { name: `V7 browser company ${stamp}` } }));
    const other = await json(await page.request.post("/api/companies", { data: { name: `V7 separate company ${stamp}` } }));
    const api = `/api/companies/${company.id}`;
    const route = `/${company.issuePrefix}`;
    const agent = await json(await page.request.post(`${api}/agents`, { data: { name: "Paused discovery researcher", adapterType: "process", adapterConfig: { command: "node", args: ["-e", "process.exit(0)"] }, runtimeConfig: { heartbeat: { enabled: false, wakeOnAssignment: false } } } }));
    await json(await page.request.patch(`/api/agents/${agent.id}`, { data: { status: "paused" } }));

    await page.goto(`${route}/foundation/discovery`);
    await page.getByLabel("Discovery agent", { exact: true }).selectOption(agent.id);
    await page.getByLabel("What should the first agent help you achieve?", { exact: true }).fill("Draft reviewed company knowledge from human answers");
    const started = page.waitForResponse((r) => r.url().endsWith(`${api}/foundation/bootstrap`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Start discovery", exact: true }).click();
    const run = await json(await started);
    expect(run.dispatchPending).toBe(true);
    expect(run.status).toBe("awaiting_candidates");
    await expect(page.getByRole("link", { name: "Open the discovery task", exact: true })).toBeVisible();
    const mission = page.getByLabel("What outcome does your company deliver for its customers? (optional)", { exact: true });
    await mission.fill("We prepare reviewed research reports for local businesses.");
    const answered = page.waitForResponse((r) => r.url().endsWith(`/foundation/bootstrap/${run.id}/answer`) && r.request().method() === "POST");
    await mission.locator("..").getByRole("button", { name: "Save answer", exact: true }).click();
    expect((await json(await answered)).answers["company.mission"]).toBe("We prepare reviewed research reports for local businesses.");
    await expect(mission).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create Foundation drafts", exact: true })).toHaveCount(0);
    expect((await page.request.get(`/api/companies/${other.id}/foundation/bootstrap/${run.id}`)).status()).toBe(404);
    const task = await json(await page.request.get(`/api/issues/${run.taskId}`));
    expect(task.originKind).toBe("v7_foundation_bootstrap");
    expect(task.status).toBe("todo");
    expect(task.completedAt).toBeNull();

    await page.getByRole("link", { name: "Readiness", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${route}/readiness`);
    await page.getByLabel("Agent", { exact: true }).selectOption(agent.id);
    await page.getByLabel("Action", { exact: true }).selectOption("external_communication");
    await page.getByLabel("What should the agent do?", { exact: true }).fill("Send a customer message after reviewed company facts are available");
    const assessed = page.waitForResponse((r) => r.url().includes(`${api}/readiness/assess`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Check readiness", exact: true }).click();
    const assessment = await json(await assessed);
    expect(assessment.status).toBe("blocked");
    await expect(page.getByRole("region", { name: "Readiness assessment", exact: true })).toContainText("blocked");
    await expect(page.getByRole("region", { name: "Knowledge requiring review", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "AI Governance", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${route}/ai-governance`);
    const createdProfile = page.waitForResponse((r) => r.url().includes(`${api}/human-oversight-profiles`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Create a mandatory human decision profile", exact: true }).click();
    await json(await createdProfile);
    const profiles = await json(await page.request.get(`${api}/human-oversight-profiles`));
    expect(profiles).toHaveLength(1);
    await page.getByRole("combobox", { name: "Human oversight profile", exact: true }).selectOption(profiles[0].id);
    for (const [label, value] of [
      ["Use-case key", "reviewed-research"],
      ["Name", "Reviewed internal research"],
      ["Description", "Prepare internal research drafts for a human reviewer"],
      ["Allowed intended purpose", "Draft internal research from approved business sources"],
      ["Foreseeable misuse (one per line)", "Unreviewed drafts could be mistaken for approved business facts"],
      ["Who makes the system available?", "August Works"],
      ["Whose name or trademark is used?", "Browser fixture company"],
      ["Who defines intended purpose?", "The company owner"],
      ["Who integrates or customizes it?", "The company administrator"],
      ["Retention purpose", "Retain reviewed business drafts and their audit evidence"],
    ]) await page.getByLabel(label, { exact: true }).fill(value);
    const registered = page.waitForResponse((r) => r.url().includes(`${api}/ai-use-cases`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Register draft", exact: true }).click();
    const useCase = await json(await registered);
    expect(useCase.status).toBe("draft");
    await page.getByRole("combobox", { name: "Use case", exact: true }).selectOption(useCase.id);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export current evidence pack", exact: true }).click();
    const download = await downloadPromise;
    const pack = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(JSON.stringify(pack)).toContain(useCase.id);
    expect(JSON.stringify(pack)).toContain("Reviewed internal research");
    expect((await page.request.get(`/api/companies/${other.id}/ai-use-cases/${useCase.id}/evidence-pack`)).status()).toBe(404);

    const guest = await guestContext.newPage();
    await signUp(guest, `v7-outsider-${stamp}@test.invalid`);
    expect([403, 404]).toContain((await guest.request.get(`${api}/foundation/bootstrap/${run.id}`)).status());
    expect([403, 404]).toContain((await guest.request.get(`${api}/ai-use-cases/${useCase.id}/evidence-pack`)).status());
    const invalidRollback = await page.request.patch("/api/instance/settings/experimental", { data: { readiness_engine_v7: false } });
    expect(invalidRollback.status()).toBe(400);
    expect((await invalidRollback.json()).code).toBe("V7_FEATURE_DEPENDENCY_INVALID");
    await json(await page.request.patch("/api/instance/settings/experimental", { data: { foundation_bootstrap_v7: false, readiness_engine_v7: false } }));
    expect((await page.request.get(`${api}/foundation/bootstrap/${run.id}`)).status()).toBe(404);
    await page.goto(`${route}/readiness`);
    await expect(page.getByRole("button", { name: "Check readiness", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.screenshot({ path: "test-results/v7-authenticated/v7-safe-rollback.png", fullPage: true });
  } finally {
    await page.request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(enabled).map((key) => [key, flags[key]])) });
    await guestContext.close();
  }
});
