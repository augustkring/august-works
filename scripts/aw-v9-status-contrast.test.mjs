import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

test("the actual status-chip stylesheet passes text contrast for every default hue in both themes", async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE } : {}),
    args: ["--no-sandbox"],
  });
  try {
    const css = await readFile(new URL("../ui/src/index.css", import.meta.url), "utf8");
    const names = [...new Set([...css.matchAll(/(--status-(?:agent|task)-[a-z_]+):/g)].map(match => match[1]))];
    assert.ok(names.length >= 11);
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    // CSS probe, not a built-component or operator-custom-palette acceptance.
    // StatusBadge.test.tsx separately binds actual components to these hues.
    await page.setContent(`<main aria-label="Status contrast probe">${["background", "card", "popover"].map(surface =>
      `<section style="background:var(--${surface});padding:16px"><h1>${surface}</h1>${names.map(name =>
        `<span class="status-chip" style="--sc:var(${name});font-size:12px;font-weight:400;display:inline-block;padding:8px;margin:4px">${name}</span>`).join("")}</section>`).join("")}</main>`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ path: createRequire(new URL("../packages/paperclip-runner/package.json", import.meta.url)).resolve("axe-core/axe.min.js") });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(mode => document.documentElement.classList.toggle("dark", mode === "dark"), theme);
      const violations = await page.evaluate(async () => (await window.axe.run("main", {
        runOnly: { type: "rule", values: ["color-contrast"] },
      })).violations);
      assert.deepEqual(violations, [], `${theme} default status contrast`);
    }
  } finally { await browser.close(); }
});
