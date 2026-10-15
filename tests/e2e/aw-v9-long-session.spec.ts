import { expect, test } from "@playwright/test";
import { json } from "./agent-chat.shared";
import { writeFile } from "node:fs/promises";

test.use({ trace: "retain-on-failure" });

// Bounded synthetic soak of the actual built shell and Native read owners.
// Heap samples are observations, never a fabricated production memory budget.
for (const mode of ["classic", "current"] as const) {
test(`${mode} long-thread navigation preserves its history in one browser document`, async ({ page, request, baseURL }, info) => {
  const classic = mode === "classic";
  test.setTimeout(240000);
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable V9 resource soak" } }));
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const issue = await json(await request.post(`/api/companies/${company.id}/issues`, { data: {
    title: "Synthetic long-session thread", status: "backlog", assigneeAgentId: null,
  } }));
  const origin = new URL(baseURL!).origin;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const samples: Array<Record<string, number | string>> = [];
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  let primaryFailed = false;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableClassicTaskInterface: classic } }));
    const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
      name: "Paused synthetic soak fixture", adapterType: "process", adapterConfig: { command: "/usr/bin/true" },
      runtimeConfig: { heartbeat: { enabled: false } }, budgetMonthlyCents: 0,
    } }));
    const paused = await json(await request.post(`/api/agents/${agent.id}/pause`, { data: {} }));
    expect(paused.status).toBe("paused");
    for (let batch = 0; batch < 50; batch++) {
      await Promise.all(Array.from({ length: 10 }, async (_, offset) => {
        const index = batch * 10 + offset;
        await json(await request.post(`/api/issues/${issue.id}/comments`, { data: {
          body: `Synthetic resource observation ${index}\n\n- Fixed fixture content\n- No agent or provider execution`,
          reopen: false, resume: false, interrupt: false,
        } }));
      }));
    }
    await page.goto(`/${company.issuePrefix}/issues/${issue.identifier}`);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const rows = classic ? page.getByTestId("issue-chat-thread-virtual-row") : page.locator('[data-thread-anchor][id^="comment-"]');
    const fixture = classic ? page.getByTestId("issue-chat-thread-virtualizer") : rows.first();
    async function loadHistory() {
      const older = page.getByRole("button", { name: "Load earlier comments", exact: true });
      const loadedCount = async () => classic
        ? await fixture.count() ? Number(await fixture.getAttribute("data-virtual-count")) : await page.getByTestId("issue-chat-message-row").count()
        : await rows.count();
      await expect.poll(loadedCount).toBeGreaterThan(0);
      for (let batch = 0; batch < 20 && await loadedCount() < 500; batch++) {
        await expect(older).toBeEnabled();
        const previous = await loadedCount();
        const response = page.waitForResponse(response => response.request().method() === "GET" &&
          [`/api/issues/${issue.id}/comments`, `/api/issues/${issue.identifier}/comments`].includes(new URL(response.url()).pathname), { timeout: 10000 });
        await older.click();
        expect((await response).ok()).toBe(true);
        await expect.poll(loadedCount).toBeGreaterThan(previous);
      }
      await expect(fixture).toBeVisible();
    }
    await loadHistory();
    for (let cycle = 0; cycle < 26; cycle++) {
      console.info(`V9 soak cycle ${cycle}: current history`);
      await page.emulateMedia({ reducedMotion: cycle % 2 ? "reduce" : "no-preference" });
      await expect(fixture).toBeVisible();
      const target = classic ? Number(await fixture.getAttribute("data-virtual-count")) : 500;
      expect(target).toBeGreaterThanOrEqual(450);
      await expect(rows.first()).toBeVisible();
      const rendered = await rows.count();
      expect(rendered).toBeGreaterThan(0);
      if (classic) expect(rendered).toBeLessThan(target);
      else expect(rendered).toBe(target);
      await page.getByRole("main").evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: "instant" }));
      await expect(rows.first()).toBeAttached();
      // Real client navigation and browser Back retain the same shell/document.
      // A page.goto/reload loop would hide a lifetime retention problem.
      await page.locator(`a[href="/${company.issuePrefix}/dashboard"]`).first().click();
      await expect(fixture).toHaveCount(0);
      await page.goBack({ timeout: 10000 });
      await loadHistory();
      await expect(fixture).toBeVisible();
      await expect(rows.first()).toBeVisible();
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      console.info(`V9 soak cycle ${cycle}: navigation completed`);
      if (cycle >= 2) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([client.send("HeapProfiler.collectGarbage"), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Forced-GC observation exceeded its 10-second measurement deadline")), 10000);
          })]);
        } finally { clearTimeout(timer); }
        console.info(`V9 soak cycle ${cycle}: GC completed`);
        const { metrics } = await client.send("Performance.getMetrics");
        const values = Object.fromEntries(metrics.map((entry: { name: string; value: number }) => [entry.name, entry.value]));
        const counters = await client.send("Memory.getDOMCounters");
        for (const name of ["JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents"]) expect(Number.isFinite(values[name])).toBe(true);
        samples.push({ cycle: cycle - 2, motion: cycle % 2 ? "reduce" : "normal", heapUsedBytes: values.JSHeapUsedSize,
          heapTotalBytes: values.JSHeapTotalSize, nodes: counters.nodes, documents: counters.documents,
          listeners: counters.jsEventListeners, renderedRows: await rows.count(), sourceRows: target });
      }
    }
    expect(errors).toEqual([]);
    const artifact = info.outputPath("long-session-resource-observations.json");
    await writeFile(artifact, JSON.stringify({
      qualification: "bounded-synthetic-software-soak", interface: mode, warmupCycles: 2, measuredCycles: 24,
      browser: page.context().browser()?.version(), viewport: page.viewportSize(), forcedGcPerSample: true,
      sourceDataset: "500 synthetic comments through Native APIs on one unassigned backlog task; explicitly selected interface", samples,
      limits: "One Chromium document, synthetic data, forced-GC perturbation, no production resource or latency acceptance threshold; no hourly/mobile/hosted qualification.",
    }, null, 2) + "\n", { mode: 0o600 });
    await info.attach("long-session-resource-observations.json", { contentType: "application/json", path: artifact });
  } catch (error) { primaryFailed = true; throw error; }
  finally {
    let cleanupFailure: unknown;
    try { await client.detach(); } catch (error) { cleanupFailure = error; }
    try { await json(await request.patch("/api/instance/settings/experimental", { data: { enableClassicTaskInterface: flags.enableClassicTaskInterface } })); await json(await request.delete(`/api/companies/${company.id}`)); }
    catch (error) { cleanupFailure ??= error; }
    if (cleanupFailure && !primaryFailed) throw cleanupFailure;
    if (cleanupFailure) console.info("V9 soak cleanup failed after the primary failure");
  }
});

}
