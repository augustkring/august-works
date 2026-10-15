import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE } : {}),
    args: ["--no-sandbox"],
  });
});
after(async () => { await browser?.close(); });

test("the actual token stylesheet stops loops, delays and transitions after a live preference change", async () => {
  const page = await browser.newPage({ reducedMotion: "no-preference" });
  try {
    // Exercise the actual CSS cascade without a hosted account, server or
    // remote font. Test markup supplies only a deliberately slow animation.
    await page.route("**/*", route => route.abort());
    await page.setContent(`<style>
      @keyframes probe-spin { to { transform: rotate(360deg); } }
      .probe, .probe::before { content: ''; display: block;
        animation: probe-spin 10s 2s infinite;
        transition: transform 5s 2s; scroll-behavior: smooth; }
    </style><div class="probe">Static status remains readable</div>`);
    await page.addStyleTag({ content: await readFile(new URL("../ui/src/index.css", import.meta.url), "utf8") });
    const state = () => page.locator(".probe").evaluate(element => {
      const values = style => ({ duration: style.animationDuration, delay: style.animationDelay,
        iterations: style.animationIterationCount, transition: style.transitionDuration,
        transitionDelay: style.transitionDelay, scroll: style.scrollBehavior });
      return [values(getComputedStyle(element)), values(getComputedStyle(element, "::before"))];
    });
    assert.equal((await state())[0].duration, "10s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const style of await state()) {
      assert.ok(parseFloat(style.duration) <= 0.00001);
      assert.equal(style.delay, "0s");
      assert.equal(style.iterations, "1");
      assert.ok(parseFloat(style.transition) <= 0.00001);
      assert.equal(style.transitionDelay, "0s");
      assert.equal(style.scroll, "auto");
    }
    // Presence owners still receive animationend; no infinite animation is
    // left running to consume resources or prevent removal.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal((await state())[0].duration, "10s");
  } finally { await page.close(); }
});
