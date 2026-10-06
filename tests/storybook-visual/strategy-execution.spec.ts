import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
const require = createRequire(import.meta.url);
// Reuse Storybook's pinned native accessibility dependency.
const addon = require.resolve("@storybook/addon-a11y/package.json", { paths: [fileURLToPath(new URL("../../ui",import.meta.url))] });
const axeScript = require.resolve("axe-core/axe.min.js", { paths: [dirname(addon)] });
async function accessibility(page: Page) {
  await page.addScriptTag({ path: axeScript });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: HTMLElement, options: object) => Promise<{ violations: { id: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document.getElementById("storybook-root")!, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa"] } });
    return result.violations;
  });
  expect(violations).toEqual([]);
}
for (const theme of ["light","dark"]) for (const width of [390,1200]) for (const state of ["active","needs-review","proposed"]) {
  test(`strategy ${state} in ${theme} at ${width}px preserves pins and explicit human review`, async ({ page }, info) => {
    await page.route("**/api/**",route => route.abort());
    await page.setViewportSize({ width,height: 1000 });
    await page.goto(`/iframe.html?id=business-intelligence-strategy-execution--${state}&viewMode=story&globals=theme:${theme}`);
    await expect(page.getByRole("heading", { name: "Strategy and execution", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Inspect relationship",exact: true }).click();
    const panel = page.getByRole("region", { name: "Inspect strategic relationship" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Contribution is not a causal effect");
    await expect(panel).toContainText("Human review due");
    if (state === "needs-review") await expect(panel).toContainText("Propose current version pins");
    await expect(panel.getByRole("button", { name: "Approve selected version" })).toBeDisabled();
    const summary = panel.locator("summary"); await summary.focus(); await page.keyboard.press("Space");
    await expect(panel.locator("pre")).toContainText('"approvedRevisionId"');
    await expect(panel.locator("pre")).toContainText('"contentHash"');
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await accessibility(page);
    await page.screenshot({ path: info.outputPath(`strategy-${state}-${theme}-${width}.png`),fullPage: true,animations: "disabled" });
  });
}
for (const theme of ["light","dark"]) for (const width of [390,1200]) {
  test(`strategy source proposal in ${theme} at ${width}px selects approved native references`, async ({ page },info) => {
    await page.route("**/api/**",route => route.abort());
    await page.setViewportSize({ width,height: 1100 });
    await page.goto(`/iframe.html?id=business-intelligence-strategy-execution--operator&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("button", { name: "Propose a relationship",exact: true }).click();
    const form = page.getByRole("form", { name: "Strategy link proposal" });
    await expect(form.getByRole("button", { name: "Save proposal" })).toBeDisabled();
    await form.getByLabel("From source kind", { exact: true }).selectOption("foundation_section");
    await form.getByLabel("From find source", { exact: true }).fill("strategy");
    await form.getByLabel("From native source", { exact: true }).selectOption({ label: "Company strategy / Strategy / Customer focus · approved revision 1" });
    await form.getByLabel("To native source", { exact: true }).selectOption({ label: "Improve delivery outcomes" });
    await form.getByLabel("Business rationale", { exact: true }).fill("An explicitly reviewed native strategic relationship");
    await form.getByLabel("Approved strategy purpose", { exact: true }).selectOption({ label: "Advisory strategy purpose" });
    await expect(form.getByRole("button", { name: "Save proposal" })).toBeEnabled();
    await expect(form).toContainText("human approval remains a separate action");
    await expect(form).toContainText("not a probability, percentage of business outcome or causal effect");
    await form.getByLabel("Contribution interpretation", { exact: true }).selectOption("relative_priority");
    await expect(form.getByRole("button", { name: "Save proposal" })).toBeDisabled();
    await form.getByLabel("Priority rationale", { exact: true }).fill("Explicit human prioritization under current operating constraints");
    await expect(form.getByRole("button", { name: "Save proposal" })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await accessibility(page);
    await page.screenshot({ path: info.outputPath(`strategy-proposal-${theme}-${width}.png`),fullPage: true,animations: "disabled" });
    await form.getByRole("button", { name: "Cancel",exact: true }).click();
    await expect(form).toHaveCount(0);
  });
}
