import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";

async function json(response: APIResponse) {
  expect(response.ok(), String(response.status())).toBe(true);
  return response.json();
}

// Actual cookie authentication, native company/receipt routes and database.
// Abort only the committed response and initial recovery GET. No provider,
// hosted verification, physical process crash or real task composer is claimed.
test("Help retains its originating view and reload recovers requests before and after durable acceptance", async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const config = process.env.PAPERCLIP_E2E_SERVER_CONFIG;
  if (!config || !baseURL) throw new Error("An isolated authenticated server is required");
  await json(await page.request.post("/api/auth/sign-up/email", { data: {
    name: "V10 browser reviewer", email: `v10-support-${Date.now()}@test.invalid`,
    password: "V10-support-fixture-password-12345",
  } }));
  const invitation = execFileSync("pnpm", ["--filter", "@paperclipai/db", "exec", "tsx",
    path.resolve("packages/db/scripts/create-auth-bootstrap-invite.ts"), "--config", config, "--base-url", baseURL],
  { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const token = new URL(invitation).pathname.split("/").at(-1);
  await json(await page.request.post(`/api/invites/${token}/accept`, { data: { requestType: "human" } }));
  await json(await page.request.patch("/api/instance/settings/experimental", { data: {
    experience_projection_v9: true, progressive_shell_v9: true, home_v9: true,
  } }));
  const company = await json(await page.request.post("/api/companies", { data: { name: "Disposable V10 support browser company" } }));
  const support = `/api/companies/${company.id}/support`;
  await page.goto(`/${company.issuePrefix}/work`);
  const heading = await page.getByRole("heading", { level: 1, name: "Work", exact: true }).elementHandle();
  expect(heading).not.toBeNull();
  const unsent = "Private unsent support draft retained only in this account's memory.";
  for (const dismissal of ["close", "escape", "return"] as const) {
    await page.locator("a[data-support-help-entry]").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await heading!.evaluate(node => node.isConnected)).toBe(true);
    const description = page.getByLabel("What do you need help with?", { exact: true });
    if (dismissal !== "close") await expect(description).toHaveValue(unsent);
    await description.fill(unsent);
    if (dismissal === "escape") await page.keyboard.press("Escape");
    else await page.getByRole(dismissal === "close" ? "button" : "link", { name: "Back to work", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await heading!.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.locator("a[data-support-help-entry]")).toBeFocused();
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe("none");
  }
  await page.locator("a[data-support-help-entry]").click();
  await expect(page.getByLabel("What do you need help with?", { exact: true })).toHaveValue(unsent);
  expect(await page.evaluate(text => JSON.stringify(history.state).includes(text), unsent)).toBe(false);
  expect(await page.evaluate(text => [...Object.values(sessionStorage), ...Object.values(localStorage)].some(value => value.includes(text)), unsent)).toBe(false);

  let posts = 0, committed: { id: string; reference: string } | undefined, permitRecovery = false;
  let phase: "after_acceptance" | "before_acceptance" | "retry" = "after_acceptance";
  let beforeKey: string | undefined, acceptedKey: string | undefined, retriedId: string | undefined;
  await page.route(`**${support}/cases`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    if (phase === "before_acceptance") {
      beforeKey = route.request().postDataJSON().idempotencyKey;
      expect(posts).toBe(2);
      return route.abort("failed");
    }
    if (phase === "retry") {
      expect(posts).toBe(3);
      expect(route.request().postDataJSON().idempotencyKey).toBe(beforeKey);
      const response = await route.fetch();
      retriedId = (await json(response)).id;
      return route.fulfill({ response });
    }
    expect(posts).toBe(1);
    acceptedKey = route.request().postDataJSON().idempotencyKey;
    committed = await json(await route.fetch());
    await route.abort("failed");
  });
  await page.route(`**${support}/cases/requests/**`, route => permitRecovery ? route.continue() : route.abort("failed"));
  const privateText = "Private browser support text must not enter history or browser storage.";
  await page.getByLabel("What do you need help with?", { exact: true }).fill(privateText);
  await page.getByRole("button", { name: "Send to support", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "The result is not confirmed" })).toBeVisible();
  expect(committed?.id).toBeTruthy();
  expect(await page.evaluate(text => JSON.stringify(history.state).includes(text), privateText)).toBe(false);
  expect(await page.evaluate(text => [...Object.values(sessionStorage), ...Object.values(localStorage)].some(value => value.includes(text)), privateText)).toBe(false);
  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("a[data-support-help-entry]").click();
  await expect(page.getByLabel("What do you need help with?", { exact: true })).toHaveValue(privateText);
  await expect(page.getByRole("button", { name: "Retry the same request", exact: true })).toBeEnabled();
  expect(posts).toBe(1);
  expect(await page.evaluate(() => history.state?.usr?.supportRequest?.key)).toBe(acceptedKey);
  permitRecovery = true;
  await page.reload();
  await expect(page.getByText("Your previous submission has a saved receipt. Open the case to continue.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(committed!.reference) }).click();
  await expect(page.locator("article")).toContainText(privateText);
  const current = await json(await page.request.get(`${support}/cases/${committed!.id}`, {
    params: { expectedUserId: (await json(await page.request.get("/api/auth/get-session"))).user.id },
  }));
  expect(current.timeline).toHaveLength(1);
  expect(posts).toBe(1);
  expect(await page.evaluate(() => !!history.state?.usr?.supportRequest)).toBe(false);

  // The complementary case: this POST never reaches the server. Reload must
  // preserve only its key, perform GETs, and wait for an explicit same-key retry.
  await page.getByRole("button", { name: "Back to support cases", exact: true }).click();
  const beforeText = "A separate request interrupted before native acceptance.";
  phase = "before_acceptance";
  await page.getByLabel("What do you need help with?", { exact: true }).fill(beforeText);
  await page.getByRole("button", { name: "Send to support", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "The result is not confirmed" })).toBeVisible();
  expect(beforeKey).toBeTruthy();
  expect(await page.evaluate(text => JSON.stringify(history.state).includes(text), beforeText)).toBe(false);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "The previous result is not confirmed." })).toBeVisible();
  expect(posts).toBe(2);
  await page.getByLabel("What do you need help with?", { exact: true }).fill(beforeText);
  phase = "retry";
  await page.getByRole("button", { name: "Retry the same request", exact: true }).click();
  await expect(page.locator("article")).toContainText(beforeText);
  const account = await json(await page.request.get("/api/auth/get-session"));
  const cases = await json(await page.request.get(`${support}/cases`, { params: { expectedUserId: account.user.id } }));
  expect(cases.entries).toHaveLength(2);
  expect(cases.entries.map((entry: { id: string }) => entry.id)).toEqual(expect.arrayContaining([committed!.id, retriedId]));
  expect(posts).toBe(3);
  expect(await page.evaluate(() => !!history.state?.usr?.supportRequest)).toBe(false);
});
