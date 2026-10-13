import { expect, test, type APIResponse } from "@playwright/test";
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
for (const locale of ["en", "da"] as const) test(`a late Home projection preserves the Feedback keyboard gesture in ${locale}`, async ({ page, request }) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable initial focus fixture" } }));
  let release!: () => void, observed = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  // Explicit software projection; this checks browser focus timing, not a
  // real work result, human usability or provider qualification.
  await page.route(`**/api/companies/${company.id}/experience?*`, async route => {
    expect(route.request().method()).toBe("GET"); observed = true; await held;
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { companyId: company.id, profile: "admin",
      availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: new Date().toISOString(),
      dependencies: [], needsYou: [], inProgress: [], done: [], watch: [] } });
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: true, progressive_shell_v9: true, home_v9: true, customer_feedback_v9: true } }));
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect.poll(() => observed).toBe(true);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption(locale);
    const trigger = page.getByRole("region", { name: locale === "en" ? "Global utilities" : "Globale funktioner", exact: true })
      .getByRole("button", { name: "Feedback", exact: true });
    await expect(trigger).toBeEnabled(); await trigger.focus(); await expect(trigger).toBeFocused();
    release();
    await expect(page.getByRole("heading", { name: locale === "en" ? "Home" : "Hjem", exact: true })).toBeVisible();
    await expect(trigger).toBeFocused(); await trigger.press("Enter");
    await expect(page.getByRole("dialog").getByRole("combobox", { name: locale === "en" ? "Category" : "Kategori", exact: true })).toBeFocused();
  } finally {
    release();
    await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: flags.experience_projection_v9, progressive_shell_v9: flags.progressive_shell_v9,
      home_v9: flags.home_v9, customer_feedback_v9: flags.customer_feedback_v9 } });
  }
});
