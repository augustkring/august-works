import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

// Actual built components with explicit software fixtures. No visual baseline,
// Native execution, manual AT, human or complete launch acceptance is inferred.
test("V9 card stories render in light and dark mobile layouts with read-only actions and no axe violations", async ({
  page,
  request,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const response = await request.get("/index.json");
  expect(response.ok()).toBe(true);
  const index = await response.json();
  const stories = (
    Object.values(index.entries) as Array<{
      type: string;
      title: string;
      name: string;
      id: string;
    }>
  ).filter(
    (entry) =>
      entry.type === "story" &&
      entry.title === "August Works/V9/Experience cards",
  );
  expect(stories).toHaveLength(12);
  await page.setViewportSize({ width: 390, height: 844 });
  // The component exercise is offline; no fixture authorizes transmission.
  await page.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  for (const theme of ["light", "dark"] as const) {
    for (const story of stories) {
      const errors: string[] = [];
      const onError = (error: Error) => errors.push(error.message);
      page.on("pageerror", onError);
      try {
        await page.goto(
          `/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=theme:${theme}`,
        );
        const main = page.getByRole("main");
        await expect(main).toBeVisible();
        const denied = story.name === "Denied Current Read";
        await expect(main.getByRole("article")).toHaveCount(
          denied ? 0 : story.name === "Registered Kinds" ? 18 : 1,
        );
        await expect(
          main.getByRole("button", {
            name: /approve|reject|publish|retry work|stop work/i,
          }),
        ).toHaveCount(0);
        await expect(page.locator("html")).toHaveClass(
          theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
        );
        await page.addScriptTag({ path: axePath });
        const violations = await page.evaluate(async () => {
          const axe = (window as unknown as {
            axe: { run(scope: string): Promise<{ violations: unknown[] }> };
          }).axe;
          // Storybook's accessibility afterEach hook uses the same axe instance.
          // Serialize our full mobile check with it; keep both checks enabled.
          const deadline = performance.now() + 15000;
          while (true) {
            try { return (await axe.run("main")).violations; }
            catch (error) {
              if (!(error instanceof Error) || !error.message.startsWith("Axe is already running.") || performance.now() >= deadline)
                throw error;
              await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            }
          }
        });
        expect(violations, `${story.id} ${theme}`).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          `${story.id} mobile reflow`,
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${story.id}-${theme}-mobile.png`),
          fullPage: true,
        });
        expect(errors).toEqual([]);
      } finally {
        page.off("pageerror", onError);
      }
    }
  }
});
