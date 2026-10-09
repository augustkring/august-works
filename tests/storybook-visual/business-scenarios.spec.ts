import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), axePath = require.resolve("axe-core/axe.min.js");
const scenarioId = "00000000-0000-4000-8000-000000000501", runId = "00000000-0000-4000-8000-000000000503";
async function accessibility(page: Page) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (context: string, options: unknown) => Promise<{ violations: unknown[] }> } };
    // Storybook's native accessibility addon may already own an axe scan.
    // Wait only for that explicit concurrency condition; real violations and
    // other scanner errors still fail this check immediately.
    const deadline = performance.now() + 5000;
    while (true) {
      try { return (await w.axe.run("#storybook-root", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations; }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes("Axe is already running") || performance.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function story(page: Page, state: string, theme: string, width: number) {
  await page.route("**/api/**", route => route.abort());
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(`/iframe.html?id=business-intelligence-business-scenarios--${state}&viewMode=story&globals=theme:${theme}`);
}
for (const theme of ["light", "dark"]) for (const width of [390, 1200]) {
  for (const state of ["deterministic", "monte-carlo", "stale", "unstable", "data-not-ready", "expired", "artifact-result"]) test(`scenario ${state} ${theme} ${width}px preserves conditional uncertainty`, async ({ page }, info) => {
    await story(page, state, theme, width);
    if (state === "expired") { await expect(page.getByRole("status")).toContainText("scenario evidence has expired"); await expect(page.getByRole("table")).toHaveCount(0); }
    else {
      const panel = page.getByRole("region", { name: "Conditional scenario result" });
      await expect(panel).toContainText("if its assumptions hold");
      await expect(panel).toContainText("separate human Decision");
      if (state === "monte-carlo") { await expect(panel.getByRole("table", { name: /^Conditional empirical quantiles/ })).toHaveCount(3); await expect(panel).toContainText("not calibrated prediction or confidence intervals"); }
      else await expect(panel.getByRole("table", { name: /^Conditional empirical quantiles/ })).toHaveCount(0);
      if (state === "artifact-result") {
        await expect(panel).toContainText("Validated calculation artifact 00000000-0000-4000-8000-000000000509");
        await expect(panel).toContainText("version 00000000-0000-4000-8000-000000000510");
        await expect(panel).toContainText("business calibration has not been inferred");
      }
      if (state === "stale") await expect(panel).toContainText("Retained arithmetic is historical");
      if (state === "unstable") { await expect(panel).toContainText("Sample ranges withheld"); await expect(panel).toContainText("half-sample difference"); }
      if (state === "data-not-ready") await expect(panel.getByRole("table")).toHaveCount(0);
      const provenance = page.getByText("Inspect scenario provenance and reproducibility", { exact: true });
      await provenance.focus(); await page.keyboard.press("Space");
      await expect(panel).toContainText("Definition");
      if (state === "monte-carlo") await expect(panel).toContainText("seed 0");
    }
    if (width === 390 && !["data-not-ready", "expired"].includes(state)) {
      const scrollRegion = page.getByRole("region", { name: "Nominal outputs and declared constraints · Base case", exact: true });
      await scrollRegion.focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => scrollRegion.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    }
    await accessibility(page);
    await page.screenshot({ path: info.outputPath(`scenario-${state}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
  for (const state of ["draft", "published"]) test(`scenario workspace ${state} ${theme} ${width}px separates human publication from execution`, async ({ page }, info) => {
    await story(page, state, theme, width);
    await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption(scenarioId);
    await expect(page.getByRole("heading", { name: /Conditional delivery capacity/ })).toBeVisible();
    const publish = page.getByRole("button", { name: "Publish this scenario version" }), run = page.getByRole("button", { name: "Run this conditional scenario" });
    await expect(publish).toBeDisabled(); await expect(run).toBeDisabled();
    await page.getByRole("textbox", { name: "Human scenario review rationale", exact: true }).fill("A human reviews this exact conditional model before approving publication");
    if (state === "draft") { await expect(publish).toBeEnabled(); await expect(run).toBeDisabled(); }
    else { await expect(publish).toBeDisabled(); await page.getByRole("spinbutton", { name: "Reproducible run seed", exact: true }).fill("0"); await expect(run).toBeEnabled(); await page.getByRole("spinbutton", { name: "Reproducible run seed", exact: true }).fill("4294967296"); await expect(run).toBeDisabled(); }
    await page.getByRole("combobox", { name: "Retained scenario run", exact: true }).selectOption(runId);
    await expect(page.getByRole("region", { name: "Conditional scenario result" })).toBeVisible();
    await accessibility(page); await page.screenshot({ path: info.outputPath(`scenario-workspace-${state}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
  test(`scenario validated artifact ${theme} ${width}px retains exact numeric and unit contracts`, async ({ page }, info) => {
    await story(page, "artifact-draft", theme, width);
    await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption(scenarioId);
    await page.getByRole("button", { name: "Propose a scenario revision" }).click();
    const form = page.getByRole("form", { name: "Scenario definition proposal" });
    await expect(form.getByRole("combobox", { name: "Scenario calculation type", exact: true })).toHaveValue("validated_automation_artifact");
    await expect(form.getByRole("combobox", { name: "Validated calculation artifact", exact: true })).toHaveValue("00000000-0000-4000-8000-000000000509");
    await expect(form.getByRole("button", { name: "Save scenario proposal" })).toBeEnabled();
    await expect(form.getByRole("button", { name: "Add calculation step" })).toHaveCount(0);
    await form.getByRole("textbox", { name: "Assumption 1 reference name", exact: true }).fill("changed_without_schema_review");
    await expect(form.getByRole("button", { name: "Save scenario proposal" })).toBeDisabled();
    await accessibility(page); await page.screenshot({ path: info.outputPath(`scenario-artifact-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
  test(`scenario proposal ${theme} ${width}px requires explicit evidence and conditional limits`, async ({ page }, info) => {
    await story(page, "draft", theme, width); await page.getByRole("button", { name: "Define a scenario" }).click();
    const form = page.getByRole("form", { name: "Scenario definition proposal" }), save = form.getByRole("button", { name: "Save scenario proposal" });
    await expect(save).toBeDisabled();
    for (const [label, value] of [["Scenario key", "capacity_conditions"], ["Scenario name", "Conditional capacity review"], ["Scenario objective", "Compare human conditions before a separate commitment"], ["Decision use", "Advisory preparation for a human capacity decision"], ["Assumption 1 human name", "Conditional capacity coefficient"], ["Assumption 1 human evidence", "Human-declared condition without observed calibration"], ["Assumption 1 uncertainty rationale", "Demand responses and external shocks are not modeled"], ["Output 1 human name", "Nominal conditional capacity"], ["Nominal calculation limits", "Nominal arithmetic only without propagated uncertainty"], ["Non-modeled effects (one per line)", "Demand response and execution fidelity are unmodeled"]]) await form.getByRole("textbox", { name: label, exact: true }).fill(value);
    await form.getByRole("combobox", { name: "Approved scenario purpose", exact: true }).selectOption("00000000-0000-4000-8000-000000000004");
    await expect(save).toBeEnabled();
    await form.getByRole("combobox", { name: "Assumption 1 confidence statement", exact: true }).selectOption("evidence_supported"); await expect(save).toBeDisabled();
    await form.getByRole("combobox", { name: "Assumption 1 confidence statement", exact: true }).selectOption("human_asserted"); await expect(save).toBeEnabled();
    await accessibility(page); await page.screenshot({ path: info.outputPath(`scenario-proposal-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
  test(`scenario native source and unit controls ${theme} ${width}px admit exact pins`, async ({ page }, info) => {
    await story(page, "draft", theme, width); await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption(scenarioId); await page.getByRole("button", { name: "Propose a scenario revision" }).click();
    const form = page.getByRole("form", { name: "Scenario definition proposal" }); await expect(form.getByRole("button", { name: "Save scenario proposal" })).toBeEnabled();
    await expect(form.getByRole("combobox", { name: "Observed window objects", exact: true })).toHaveValue("00000000-0000-4000-8000-000000000020");
    await expect(form).toContainText("Native unit: issues");
    await form.getByRole("button", { name: "Add unit dimension", exact: true }).click();
    await form.getByRole("combobox", { name: "Assumption 1 unit dimension 1", exact: true }).selectOption("currency_DKK");
    await form.getByRole("button", { name: "Add unit dimension", exact: true }).click();
    await form.getByRole("spinbutton", { name: "Assumption 1 unit power 2", exact: true }).fill("-1");
    await expect(form).toContainText("Output unit: DKK");
    await accessibility(page); await page.screenshot({ path: info.outputPath(`scenario-source-units-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
}
test("a human scenario proposal survives the native thirty-second parent refresh", async ({ page }) => {
  await story(page, "draft", "light", 1200); await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption(scenarioId); await page.getByRole("button", { name: "Propose a scenario revision" }).click();
  const field = page.getByRole("textbox", { name: "Scenario objective", exact: true }); await field.fill("A human is still reviewing an unsaved conditional scenario");
  await page.waitForTimeout(31000); await expect(field).toHaveValue("A human is still reviewing an unsaved conditional scenario");
});
