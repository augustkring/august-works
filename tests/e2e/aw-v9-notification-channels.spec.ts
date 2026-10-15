import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }
// Built account UI with explicit private read/command fixtures. Native queue,
// authorization and DB guards are tested separately; no real chat is contacted.
test("linked notification settings retain the same uncertain command and work at 320px in both themes", async ({ page, request }) => {
  test.setTimeout(120000);
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable notification settings" } }));
  await json(await request.post(`/api/companies/${company.id}/agents`, { data: { name: "Idle settings host", role: "engineer", adapterType: "process",
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } } } }));
  const userId = "notification-browser-owner", requestIds: string[] = [], commands: unknown[] = [];
  const session = { session: { id: "notification-browser-session", userId, localImplicit: false },
    user: { id: userId, name: "Notification browser owner", email: "owner@example.test", image: null }, sentryDsn: null };
  let rolloutEnabled = true;
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const target = { identityLinkId: "10000000-0000-4000-8000-000000000002", conversationId: "10000000-0000-4000-8000-000000000003",
    provider: "slack", label: "Slack · Your linked workspace", targetHash: "b".repeat(64) };
  const view = { companyId: company.id, userId, category: "work_update", version: 0, channel: "default", deliveryLocale: "en",
    availability: "default", target: null as typeof target | null, baselineHash: "a".repeat(64), targets: [target], targetsLimited: false };
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: session }));
  await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: { ...flags, saas_deployment_profile_v6: true,
    transactional_email_v6: true, notification_policy_v9: true, notification_channels_v9: rolloutEnabled } }));
  await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { profile: "saas", notifications: true, deletion: false } }));
  await page.route("**/api/saas/account/sessions?**", route => route.fulfill({ json: [] }));
  await page.route("**/api/saas/account/notification-preferences?**", route => route.fulfill({ json: [{ category: "work_update", emailEnabled: true,
    policy: { version: 1, cadence: "immediate", timezone: "UTC", quietHours: null, digestMinute: 540 } }] }));
  await page.route(`**/api/companies/${company.id}/notifications/channel-preferences/work_update?**`, async route => {
    expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(userId);
    if (route.request().method() === "GET") return route.fulfill({ json: rolloutEnabled ? view : { ...view, targets: [], target: null, availability: view.channel === "default" ? "default" : "unavailable" } });
    const command = route.request().postDataJSON(); requestIds.push(command.requestId); commands.push(command);
    if (requestIds.length === 1) return route.abort("failed");
    if (!rolloutEnabled) expect(command.choice).toEqual({ channel: "default" });
    Object.assign(view, { version: view.version + 1, channel: command.choice.channel,
      availability: command.choice.channel === "default" ? "default" : "available", target: command.choice.channel === "default" ? null : target,
      baselineHash: (rolloutEnabled ? "c" : "d").repeat(64), deliveryLocale: command.deliveryLocale });
    return route.fulfill({ json: { companyId: company.id, userId, category: "work_update", requestId: command.requestId,
      version: view.version, channel: view.channel, preferenceApplied: true, authorityGranted: false, messageSent: false, executionStarted: false } });
  });
  await page.addInitScript(() => localStorage.setItem("aw.v9.display-locale", "en"));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/${company.issuePrefix}/company/settings/security`);
  const settings = page.getByRole("region", { name: "Work updates · linked chat delivery" });
  await expect(settings).toBeVisible();
  await settings.getByLabel("Where future updates arrive").selectOption(`${target.identityLinkId}:${target.conversationId}`);
  await settings.getByLabel("Language of linked-chat notices").selectOption("da");
  await settings.getByRole("button", { name: "Save delivery preference", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("This save is unconfirmed");
  await expect(settings.getByLabel("Where future updates arrive")).toBeDisabled();
  await settings.getByRole("button", { name: "Retry the same save", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("Preference version 1 was saved");
  expect(requestIds).toHaveLength(2); expect(requestIds[1]).toBe(requestIds[0]); expect(commands[1]).toEqual(commands[0]);
  await page.addScriptTag({ path: axePath });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    // Wait for actual finite theme transitions before measuring their end-state contrast.
    await page.evaluate(async () => {
      getComputedStyle(document.body).color;
      await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getTiming().iterations))
        .map(animation => animation.finished.catch(() => {})));
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const violations = await page.evaluate(async () => (await (window as any).axe.run("main", {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    })).violations.map((item: any) => ({ id: item.id, targets: item.nodes.map((node: any) => ({ target: node.target, summary: node.failureSummary })) })));
    expect(violations, theme).toEqual([]);
  }
  await page.reload(); await expect(settings).toBeVisible();
  await expect(settings.getByLabel("Where future updates arrive")).toHaveValue(`${target.identityLinkId}:${target.conversationId}`);
  expect(requestIds).toHaveLength(2);
  rolloutEnabled = false;
  await page.reload(); await expect(settings).toBeVisible();
  await expect(settings.getByLabel("Where future updates arrive")).toHaveValue("unavailable");
  await expect(settings.getByRole("status").filter({ hasText: "The saved private destination is unavailable." })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Save delivery preference", exact: true })).toBeDisabled();
  await settings.getByLabel("Where future updates arrive").selectOption("default");
  await settings.getByRole("button", { name: "Save delivery preference", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("Preference version 2 was saved");
  expect(requestIds).toHaveLength(3);
  await page.reload(); await expect(settings).toBeHidden();
  expect(requestIds).toHaveLength(3);
  expect(await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`))).toEqual([]);
});
