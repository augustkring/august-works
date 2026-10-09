import { expect, test } from "@playwright/test";
const states = ["observed", "undefined-denominator", "zero-count", "expired"];
for (const theme of ["light", "dark"]) for (const width of [390, 1200]) for (const state of states) {
  test(`${state} in ${theme} at ${width}px preserves analytical meaning and source inspection`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/iframe.html?id=business-intelligence-metric-observation--${state}&viewMode=story&globals=theme:${theme}`);
    const panel = page.getByRole("region", { name: "Metric observation" });
    await expect(panel).toBeVisible();
    if (state === "undefined-denominator") { await expect(panel).toContainText("Unknown"); await expect(panel).toContainText("A ratio cannot be calculated"); }
    if (state === "zero-count") { await expect(panel).toContainText("0 objects"); await expect(panel).not.toContainText("Unknown"); }
    if (state === "expired") await expect(panel).toContainText("Observe the population again");
    await expect(panel).toContainText("does not reconstruct past task");
    const summary = panel.locator("summary");
    await summary.focus(); await expect(summary).toBeFocused(); await page.keyboard.press("Space");
    await expect(panel.getByText("22222222-2222-4222-8222-222222222222", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${state}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
}
for (const theme of ["light", "dark"]) for (const width of [390, 1200]) for (const state of ["met", "open-period", "unknown", "expired"]) {
  test(`commitment ${state} in ${theme} at ${width}px keeps provisional results explicit`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/iframe.html?id=business-intelligence-commitment-comparison--${state}&viewMode=story&globals=theme:${theme}`);
    const panel = page.getByRole("region", { name: "Commitment comparison" });
    await expect(panel).toBeVisible();
    if (state === "unknown") { await expect(panel).toContainText("Unknown"); await expect(panel).toContainText("ratio is unknown"); }
    if (state === "open-period") { await expect(panel).toContainText("Period in progress"); await expect(panel).toContainText("does not predict the final result"); await expect(panel).not.toContainText("Commitment met"); }
    if (state === "expired") await expect(panel).toContainText("Expired comparison");
    await expect(panel).toContainText("does not establish that a Goal or Project caused");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`commitment-${state}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
}
for (const theme of ["light", "dark"]) for (const width of [390, 1200]) {
  test(`commitment operator in ${theme} at ${width}px exposes explicit native scope and draft approval`, async ({ page }, info) => {
    await page.route("**/api/**", route => route.abort());
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`/iframe.html?id=business-intelligence-commitment-comparison--operator&viewMode=story&globals=theme:${theme}`);
    const panel = page.getByRole("region", { name: "Metric commitments" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Create a commitment for this metric" }).click();
    await panel.getByLabel("Accountability scope").selectOption("goal");
    await panel.getByLabel("Goal", { exact: true }).selectOption({ label: "Improve delivery outcomes" });
    await expect(panel).toContainText("Saving creates a draft");
    await expect(panel.getByRole("button", { name: "Save commitment draft" })).toBeDisabled();
    await expect(panel).toContainText("0.8 for 80%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`commitment-operator-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel.getByRole("heading", { name: "New commitment draft" })).toHaveCount(0);
  });
}
