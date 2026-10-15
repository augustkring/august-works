import { expect, test, type APIResponse } from "@playwright/test";
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Built UI qualification with explicit personal-session/observation fixtures.
// Real authentication, ownership and erasure are tested on migrated PostgreSQL
// in experience-observations.integration.test.ts. No customer data is collected.
for (const locale of ["en", "da"] as const) test(`optional local observations: explicit opt-in, lost reply and withdrawal (${locale})`, async ({ page, request }) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable local observation UI fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const flags = await json(await request.get("/api/instance/settings/experimental"));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: { ...flags, experience_analytics_v9: true } }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { profile: "saas", signup: false, emailVerification: false,
      onboarding: false, billing: false, checkout: false, runtime: false, usage: false, support: false, deletion: false, notifications: false } }));
    await page.route("**/api/saas/account/sessions?*", route => route.fulfill({ json: [] }));
    const samples: Array<Record<string, unknown>> = [];
    await page.route("**/api/companies/*/experience/observations?*", route => {
      const input = route.request().postDataJSON();
      expect(Object.keys(input).sort()).toEqual(["durationBucket", "kind", "preferenceVersion", "requestId", "step", "surface", "variant"]);
      samples.push(input);
      return route.fulfill({ json: { requestId: input.requestId, status: "recorded" } });
    });
    const state = { enabled: false, version: 0, lastRequestId: null as string | null };
    const writes: Array<{ enabled: boolean; requestId: string; expectedVersion: number | null }> = [];
    await page.route("**/api/companies/*/experience/observations/preference?*", async route => {
      expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() === "GET") return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
        companyId: company.id, contractId: "aw.local-experience-observations.v1", ...state,
        collectionAvailable: true, retentionDays: 35, dailyLimit: 128,
      } });
      const input = route.request().postDataJSON();
      expect(Object.keys(input).sort()).toEqual(["enabled", "expectedVersion", "requestId"]);
      writes.push(input); state.enabled = input.enabled; state.version++; state.lastRequestId = input.requestId;
      if (input.enabled) return route.fulfill({ status: 503, json: { error: "Synthetic lost acknowledgement" } });
      return route.fulfill({ json: { companyId: company.id, requestId: input.requestId, enabled: false, version: state.version, observationsErased: true } });
    });
    await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
    await page.goto(`/${company.issuePrefix}/company/settings/security`);
    const section = page.getByRole("region", { name: locale === "en" ? "Optional local experience observations" : "Frivillige lokale brugsobservationer" });
    await expect(section).toBeVisible();
    const enable = section.getByRole("button", { name: locale === "en" ? "Allow local observations" : "Tillad lokale observationer", exact: true });
    await expect(enable).toBeEnabled(); expect(writes).toEqual([]);
    await enable.click();
    await expect(section.getByRole("alert")).toContainText(locale === "en" ? "could not be confirmed" : "kunne ikke bekræftes");
    await section.getByRole("button", { name: locale === "en" ? "Check current choice" : "Kontrollér aktuelt valg", exact: true }).click();
    await expect(section).toContainText(locale === "en" ? "Local observations are on" : "Lokale observationer er slået til");
    expect(writes).toHaveLength(1);
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect.poll(() => samples.some(sample => sample.surface === "home")).toBe(true);
    expect(samples.every(sample => sample.preferenceVersion === 1)).toBe(true);
    await page.goto(`/${company.issuePrefix}/company/settings/security`);
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: locale === "en" ? "Turn off and delete observations" : "Slå fra og slet observationer", exact: true }).click();
    await expect(section).toContainText(locale === "en" ? "deleted from the active database" : "slettet fra den aktive database");
    await expect(enable).toBeEnabled(); expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ enabled: false, expectedVersion: null });
    expect(writes[1]!.requestId).not.toBe(writes[0]!.requestId);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await json(await request.get(`/api/companies/${company.id}/issues`))).toEqual([]);
    expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
