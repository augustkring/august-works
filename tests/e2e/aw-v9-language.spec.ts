import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Actual built UI, its registered translations and original local-board reads.
// This does not establish hosted identity, human language QA or screen-reader acceptance.
test("a person can select Danish, resume it after reload and return to English without changing Native work", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  await json(await request.patch("/api/instance/settings/experimental", { data: {
    experience_projection_v9: true, progressive_shell_v9: true,
    home_v9: true, ambient_commands_v9: true, customer_feedback_v9: true,
  } }));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable Danish display qualification" } }));
  const base = `/api/companies/${company.id}`;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(base) && request.method() !== "GET") writes.push(request.method());
  });
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
    const selector = page.getByRole("combobox", { name: "Language", exact: true });
    await selector.focus();
    await selector.selectOption("da");
    await expect(page.locator("html")).toHaveAttribute("lang", "da");
    await expect(page.getByRole("heading", { level: 1, name: "Hjem", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Sprog", exact: true })).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("aw.v9.display-locale"))).toBe("da");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "da");
    await expect(page.getByRole("heading", { level: 1, name: "Hjem", exact: true })).toBeFocused();
    await page.goto(`/${company.issuePrefix}/needs-you`);
    await expect(page.getByRole("heading", { level: 1, name: "Kræver dig", exact: true })).toBeFocused();
    await page.goto(`/${company.issuePrefix}/work`);
    await expect(page.getByRole("heading", { level: 1, name: "Arbejde", exact: true })).toBeFocused();
    const utilities = page.locator('[aria-label="Globale funktioner"]');
    await utilities.getByRole("button", { name: "Feedback", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Del feedback", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("combobox", { name: "Kategori", exact: true })).toBeFocused();
    await page.getByRole("dialog").getByRole("button", { name: "Annuller", exact: true }).click();
    await expect(utilities.getByRole("button", { name: "Feedback", exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(): Promise<{ violations: unknown[] }> } }).axe.run()).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("danish-mobile.png"), fullPage: true });
    await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1, name: "Work", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Work", exact: true })).toBeFocused();
    expect(writes).toEqual([]);
    for (const owner of ["issues", "projects", "agents"]) expect(await json(await request.get(`${base}/${owner}`))).toEqual([]);
    const runs = await json(await request.get(`${base}/heartbeat-runs`));
    expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
  } finally {
    await request.delete(`/api/companies/${company.id}`);
    await request.patch("/api/instance/settings/experimental", { data: flags });
  }
});
