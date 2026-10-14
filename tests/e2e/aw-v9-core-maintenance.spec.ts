import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Built UI uses an explicit software projection. The real verified-current-principal,
// current-state and read-only owner checks run in the PostgreSQL suites.
// This does not qualify hosted readiness assessment, repair or human usability.
test("current own work checks cards localize and offer only keyboard-accessible native navigation", async ({ page, request }) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable recovery-card UI fixture" } }));
  const source = { domain: "readiness", companyId: company.id, resourceId: randomUUID(), version: "a".repeat(64), observedAt: new Date().toISOString() };
  const procedures = ["company_skill", "playbook"].map(domain => {
    const current = { ...source, domain, resourceId: randomUUID() };
    return { id: `procedure:${domain}`, kind: "maintenance", title: "server fallback title", whyYou: "server fallback reason",
      consequence: "server fallback consequence", source: current, freshness: "fresh", evidence: ["procedure_revalidation_required"],
      actions: [{ id: "review", label: "fallback action", labelKey: "review", operation: "open",
        href: domain === "company_skill" ? `/skills/studio/${current.resourceId}` : `/playbooks/${current.resourceId}`,
        criticality: "C2", source: current, requiresCurrentAuthorization: true }] };
  });
  let mutations = 0;
  await page.route(`**/api/companies/${company.id}/experience?*`, route => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { companyId: company.id, profile: "admin",
      availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: source.observedAt,
      dependencies: [{ domain: "core-maintenance", state: "fresh", observedAt: source.observedAt, reason: null }],
      needsYou: [{ id: "owned-core-maintenance", kind: "maintenance", title: "server fallback title", whyYou: "server fallback reason",
        consequence: "server fallback consequence", source, freshness: "fresh", evidence: ["own_open_checks"],
        actions: [{ id: "review-own-checks", label: "Review your checks", labelKey: "review", operation: "open", href: "/readiness",
          criticality: "C2", source, requiresCurrentAuthorization: true }] }, ...procedures], inProgress: [], done: [], watch: [] } });
  });
  await page.route("**/readiness/**", route => {
    if (route.request().method() !== "GET") mutations++;
    return route.abort();
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: true, progressive_shell_v9: true, home_v9: true } }));
    await page.goto(`/${company.issuePrefix}/dashboard`);
    const card = page.getByRole("article", { name: "Review your work checks", exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    const review = card.getByRole("link", { name: "Review", exact: true });
    await expect(review).toHaveAttribute("href", `/${company.issuePrefix}/readiness`);
    await review.focus(); await expect(review).toBeFocused();
    await expect(card).not.toContainText("server fallback");
    for (const title of ["Review an assigned Skill", "Review an assigned Playbook"]) {
      const procedure = page.getByRole("article", { name: title, exact: true });
      await expect(procedure).toBeVisible(); await expect(procedure.getByRole("button")).toHaveCount(0);
      await procedure.getByRole("link", { name: "Review", exact: true }).focus();
      await expect(procedure.getByRole("link", { name: "Review", exact: true })).toBeFocused();
      await expect(procedure).not.toContainText("procedure_revalidation_required");
    }
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    const translated = page.getByRole("article", { name: "Gennemgå dine arbejdskontroller", exact: true });
    await expect(translated).toBeVisible();
    await expect(translated).toContainText("De åbne fund stammer fra dine egne kontroller.");
    await expect(page.getByRole("article", { name: "Gennemgå en tildelt Skill", exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Gennemgå en tildelt Playbook", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("assigned-procedure-review-da-mobile.png"), fullPage: true });
    expect(mutations).toBe(0);
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: flags.experience_projection_v9, progressive_shell_v9: flags.progressive_shell_v9, home_v9: flags.home_v9 } });
  }
});
