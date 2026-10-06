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
