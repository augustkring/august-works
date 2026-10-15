import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { json } from "./agent-chat.shared";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function auditMain(page: import("@playwright/test").Page) {
  await page.addScriptTag({ path: axePath });
  expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
}

for (const mode of ["classic", "current"] as const) test(`${mode} canonical Agents, Skills and Costs preserve Native reads and deep links`, async ({ page, request, baseURL }, info) => {
  test.setTimeout(120000);
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable canonical surface fixture" } }));
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const origin = new URL(baseURL!).origin;
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableStreamlinedUi: mode === "current" } }));
    const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
      name: "Canonical paused fixture with a long readable name", adapterType: "process", adapterConfig: { command: "/usr/bin/true" },
      runtimeConfig: { heartbeat: { enabled: false } }, budgetMonthlyCents: 0,
    } }));
    await json(await request.post(`/api/agents/${agent.id}/pause`, { data: {} }));
    const skill = await json(await request.post(`/api/companies/${company.id}/skills`, { data: {
      name: "Canonical local skill", slug: "canonical-local-skill", description: "A controlled local parity fixture.",
      markdown: "# Canonical local skill\n\nRead the supplied fixture only. No tools or execution.", sharingScope: "company",
    } }));
    await page.goto(`/${company.issuePrefix}/agents/paused`);
    const main = page.getByRole("main");
    await expect(main).toContainText(agent.name);
    if (mode === "classic") {
      await expect(main.getByRole("button", { name: "Org chart view", exact: true })).toHaveAttribute("aria-pressed", "true");
      await main.getByRole("button", { name: "List view", exact: true }).click();
    }
    await expect(main.getByRole("link", { name: new RegExp(agent.name) }).first()).toBeVisible();
    await auditMain(page);
    await page.screenshot({ path: info.outputPath(`${mode}-agents-light.png`), fullPage: true });
    await page.goto(`/${company.issuePrefix}/skills`);
    await expect(main.getByRole("heading", { name: "Installed skills", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: new RegExp(skill.name) }).first()).toBeVisible();
    await expect(main.getByRole("textbox", { name: "Search installed skills", exact: true })).toBeVisible();
    if (mode === "classic") {
      await expect(main.getByRole("link", { name: "Studio", exact: true })).toBeVisible();
      await page.goto(`/${company.issuePrefix}/skills?view=catalog&source=all`);
      await expect(main.getByRole("tab", { name: "Catalog", exact: true })).toHaveAttribute("aria-selected", "true");
      await main.getByRole("tab", { name: "Installed", exact: true }).click();
      await expect(main.getByRole("tab", { name: "Installed", exact: true })).toHaveAttribute("aria-selected", "true");
      expect(new URL(page.url()).searchParams.get("view")).toBeNull();
      expect(new URL(page.url()).searchParams.get("source")).toBe("all");
      await main.getByRole("tab", { name: "Catalog", exact: true }).click();
    } else {
      await page.goto(`/${company.issuePrefix}/skills?tab=catalog&source=all`);
    }
    await expect(main.getByRole("heading", { name: "Discover skills", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("source")).toBe("all");
    await auditMain(page);
    await page.screenshot({ path: info.outputPath(`${mode}-skills-light.png`), fullPage: true });
    await page.goto(`/${company.issuePrefix}/costs?range=30d#usage`);
    await expect(main.getByRole("heading", { name: "Costs", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("range")).toBe("30d");
    expect(new URL(page.url()).hash).toBe("#usage");
    await expect(main.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations);
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${mode}-costs-${theme}-narrow.png`), fullPage: true });
    }
    expect(await json(await request.get(`/api/companies/${company.id}/issues`))).toEqual([]);
    const runs = await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`));
    expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
  } finally {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableStreamlinedUi: flags.enableStreamlinedUi } }));
    await json(await request.delete(`/api/companies/${company.id}`));
  }
});
