import { expect, test, type APIResponse } from "@playwright/test";
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}

// Actual built browser/React Query session boundary with explicit private
// projection fixtures. This does not qualify hosted authentication or native
// source authority; those remain independent original-owner checks.
test("Home hides private results during session revalidation and requires a new source read", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const flags = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  await json(
    await request.patch("/api/instance/settings/experimental", {
      data: {
        experience_projection_v9: true,
        progressive_shell_v9: true,
        home_v9: true,
        ambient_commands_v9: true,
      },
    }),
  );
  const company = await json(
    await request.post("/api/companies", {
      data: { name: "Disposable current-account browser fixture" },
    }),
  );
  const session = await json(await request.get("/api/auth/get-session"));
  const taskId = "10000000-0000-4000-8000-000000000002";
  const source = {
    companyId: company.id,
    domain: "task",
    resourceId: taskId,
    version: "1",
    observedAt: "2026-10-10T10:00:00.000Z",
  };
  const model = {
    companyId: company.id,
    profile: "member",
    generatedAt: source.observedAt,
    dependencies: [
      {
        domain: "tasks",
        state: "fresh",
        observedAt: source.observedAt,
        reason: null,
      },
    ],
    needsYou: [],
    done: [],
    watch: [],
    inProgress: [
      {
        id: taskId,
        kind: "progress",
        title: "PRIVATE-BROWSER-TASK",
        whyYou: null,
        consequence: null,
        source,
        freshness: "fresh",
        evidence: ["in_progress"],
        actions: [
          {
            id: "open",
            label: "View task",
            labelKey: "view_task",
            operation: "open",
            href: `/issues/${taskId}`,
            criticality: "C1",
            source,
            requiresCurrentAuthorization: true,
          },
        ],
      },
    ],
  };
  let holdSession = false,
    holdRead = false,
    reads = 0;
  let releaseSession: (() => void) | undefined;
  const pendingReads: Array<() => void> = [];
  await page.route("**/api/auth/get-session", async (route) => {
    if (holdSession)
      await new Promise<void>((resolve) => {
        releaseSession = resolve;
      });
    await route.fulfill({ json: session });
  });
  await page.route(
    `**/api/companies/${company.id}/experience?**`,
    async (route) => {
      expect(route.request().method()).toBe("GET");
      expect(
        new URL(route.request().url()).searchParams.get("expectedUserId"),
      ).toBe("local-board");
      reads++;
      if (holdRead)
        await new Promise<void>((resolve) => {
          pendingReads.push(resolve);
        });
      await route.fulfill({
        headers: { "Cache-Control": "private, no-store" },
        json: model,
      });
    },
  );
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "PRIVATE-BROWSER-TASK", exact: true }),
    ).toBeVisible();
    // Home uses the original app-wide 30-second session cache. Focus can only
    // start an auth recheck once that source is stale; advance browser Date,
    // preserving real timers, transport and every privacy/fresh-read assertion.
    await page.clock.setFixedTime(new Date(Date.now() + 31_000));
    holdSession = true;
    holdRead = true;
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
    );
    await expect.poll(() => releaseSession !== undefined).toBe(true);
    await expect(main).not.toContainText("PRIVATE-BROWSER-TASK");
    await expect(
      main.getByRole("link", { name: "View task", exact: true }),
    ).toHaveCount(0);
    const readsDuringSession = reads;
    holdSession = false;
    releaseSession!();
    await expect.poll(() => reads).toBeGreaterThan(readsDuringSession);
    await expect(main).not.toContainText("PRIVATE-BROWSER-TASK");
    holdRead = false;
    pendingReads.splice(0).forEach((resolve) => resolve());
    await expect(
      main.getByRole("heading", { name: "PRIVATE-BROWSER-TASK", exact: true }),
    ).toBeVisible();
    await expect(
      main.getByRole("link", { name: "View task", exact: true }),
    ).toBeVisible();
  } finally {
    holdSession = false;
    releaseSession?.();
    holdRead = false;
    pendingReads.splice(0).forEach((resolve) => resolve());
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: {
          experience_projection_v9: flags.experience_projection_v9,
          progressive_shell_v9: flags.progressive_shell_v9,
          home_v9: flags.home_v9,
          ambient_commands_v9: flags.ambient_commands_v9,
        },
      }),
    );
  }
});
