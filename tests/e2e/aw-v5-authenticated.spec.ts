import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
async function signUp(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create one", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("V5 test reviewer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("V5-fixture-password-12345");
  await page.getByRole("button", { name: "Create Account", exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

test("authenticated company boundaries, revoked membership and safe flag rollback remain effective in the browser", async ({ browser, page, baseURL }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  expect((await json(await page.request.get("/api/health"))).deploymentMode).toBe("authenticated");
  const stamp = Date.now();
  await signUp(page, `v5-owner-${stamp}@test.invalid`);
  const config = process.env.PAPERCLIP_E2E_SERVER_CONFIG;
  if (!config || !baseURL) throw new Error("The isolated authenticated server configuration is required");
  const inviteUrl = execFileSync("pnpm", ["--filter", "@paperclipai/db", "exec", "tsx", path.resolve("packages/db/scripts/create-auth-bootstrap-invite.ts"), "--config", config, "--base-url", baseURL], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const bootstrapToken = new URL(inviteUrl).pathname.split("/").at(-1);
  await json(await page.request.post(`/api/invites/${bootstrapToken}/accept`, { data: { requestType: "human" } }));
  const flags = await json(await page.request.get("/api/instance/settings/experimental"));
  const companyA = await json(await page.request.post("/api/companies", { data: { name: `V5 source A ${stamp}` } }));
  const companyB = await json(await page.request.post("/api/companies", { data: { name: `V5 source B ${stamp}` } }));
  const a = `/api/companies/${companyA.id}`, b = `/api/companies/${companyB.id}`;
  const guestContext = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } }), guest = await guestContext.newPage();
  const switched = { playbooks_v5: true, project_roadmap_v5: true, project_forecast_v5: true, project_plan_vs_actual_v5: true };
  try {
    await json(await page.request.patch("/api/instance/settings/experimental", { data: switched }));
    const playbookA = await json(await page.request.post(`${a}/playbooks`, { data: { key: "source-a", title: "Only company A procedure", markdown: "Company A retained instructions" } }));
    const playbookB = await json(await page.request.post(`${b}/playbooks`, { data: { key: "source-b", title: "Only company B procedure", markdown: "Company B retained instructions" } }));
    const project = await json(await page.request.post(`${a}/projects`, { data: { name: "Flag rollback project" } }));
    await page.goto(`/${companyA.issuePrefix}/playbooks`);
    await expect(page.getByRole("link", { name: "Only company A procedure", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Only company B procedure", exact: true })).toHaveCount(0);
    await page.goto(`/${companyB.issuePrefix}/playbooks`);
    await expect(page.getByRole("link", { name: "Only company B procedure", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Only company A procedure", exact: true })).toHaveCount(0);
    expect((await page.request.get(`${b}/playbooks/${playbookA.id}`)).status()).toBe(404);

    await signUp(guest, `v5-member-${stamp}@test.invalid`);
    const invitation = await json(await page.request.post(`${a}/invites`, { data: { allowedJoinTypes: "human", humanRole: "operator" } }));
    const token = new URL(invitation.inviteUrl, baseURL).pathname.split("/").at(-1);
    await json(await guest.request.post(`/api/invites/${token}/accept`, { data: { requestType: "human" } }));
    await guest.goto(`/${companyA.issuePrefix}/playbooks/${playbookA.id}`);
    await expect(guest.getByRole("heading", { name: "Only company A procedure", exact: true })).toBeVisible();
    expect([403, 404]).toContain((await guest.request.get(`${b}/playbooks/${playbookB.id}`)).status());
    const members = await json(await page.request.get(`${a}/members`));
    const member = members.members.find((item: { user: { email: string } | null }) => item.user?.email === `v5-member-${stamp}@test.invalid`);
    expect(member).toBeTruthy();
    await json(await page.request.patch(`${a}/members/${member.id}`, { data: { status: "suspended" } }));
    expect([403, 404]).toContain((await guest.request.get(`${a}/playbooks/${playbookA.id}`)).status());
    await guest.reload();
    await expect(guest.getByText("Company A retained instructions", { exact: true })).toHaveCount(0);

    const route = `/${companyA.issuePrefix}/projects/${project.id}/roadmap`;
    await page.goto(route);
    await expect(page.getByRole("heading", { name: "Flag rollback project Roadmap", exact: true })).toBeVisible();
    await json(await page.request.patch("/api/instance/settings/experimental", { data: { project_forecast_v5: false, project_plan_vs_actual_v5: false } }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Flag rollback project Roadmap", exact: true })).toBeVisible();
    await expect(page.getByText("Forecast", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Accessible task table and plan versus actual", { exact: true })).toHaveCount(0);
    await json(await page.request.patch("/api/instance/settings/experimental", { data: { project_roadmap_v5: false, playbooks_v5: false } }));
    expect((await page.request.get(`${a}/projects/${project.id}/roadmap`)).status()).toBe(404);
    expect((await page.request.get(`${a}/playbooks/${playbookA.id}`)).status()).toBe(404);
    await page.reload();
    await expect(page.getByText("This feature is disabled or a required feature is disabled.")).toBeVisible();
  } finally {
    await guestContext.close();
    await page.request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(switched).map((key) => [key, flags[key]])) });
  }
});
