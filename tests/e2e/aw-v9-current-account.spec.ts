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

// Native feedback writes and reads; only ACK delivery, session timing and one
// read outage are controlled. The same-account fixture is not hosted login proof.
test("Feedback hides a draft during revalidation and reconciles a late Native receipt through a current read", async ({ page, request }) => {
  test.setTimeout(120_000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  await json(await request.patch("/api/instance/settings/experimental", { data: {
    experience_projection_v9: true, progressive_shell_v9: true, home_v9: true,
    ambient_commands_v9: true, customer_feedback_v9: true,
  } }));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable feedback account-recheck qualification" } }));
  const base = `/api/companies/${company.id}`, session = await json(await request.get("/api/auth/get-session"));
  let holdSession = false, denyRead = true, writes = 0, reads = 0;
  let releaseSession: (() => void) | undefined, releaseAck: (() => void) | undefined;
  let receipt: { id: string; feedbackId: string } | undefined;
  await page.route("**/api/auth/get-session", async route => {
    if (holdSession) await new Promise<void>(resolve => { releaseSession = resolve; });
    await route.fulfill({ json: session });
  });
  await page.route(`**${base}/customer-feedback?**`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();receipt = await json(response);
    await new Promise<void>(resolve => { releaseAck = resolve; });
    await route.fulfill({ response });
  });
  await page.route(`**${base}/customer-feedback/*?**`, async route => {
    if (route.request().method() !== "GET") return route.continue();
    reads++;
    if (denyRead) return route.fulfill({ status: 503, json: { error: "PRIVATE-READ-OUTAGE" } });
    await route.continue();
  });
  async function beginRecheck() {
    holdSession = true;releaseSession = undefined;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => releaseSession !== undefined).toBe(true);
  }
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("share feedback");
    await page.getByRole("option", { name: "Share feedback", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: "Category", exact: true })).toBeFocused();
    await dialog.getByRole("textbox").first().fill("PRIVATE-BROWSER-FEEDBACK-DRAFT");
    expect(writes).toBe(0);
    await page.clock.setFixedTime(new Date(Date.now() + 31_000));
    await beginRecheck();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(dialog).not.toContainText("PRIVATE-BROWSER-FEEDBACK-DRAFT");
    holdSession = false;releaseSession!();
    await expect(dialog.getByRole("textbox").first()).toHaveValue("PRIVATE-BROWSER-FEEDBACK-DRAFT");
    await dialog.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect.poll(() => releaseAck !== undefined).toBe(true);
    await page.clock.setFixedTime(new Date(Date.now() + 62_000));
    await beginRecheck();releaseAck!();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(dialog).not.toContainText(receipt!.feedbackId);
    expect(reads).toBe(0);
    holdSession = false;releaseSession!();
    await expect(dialog.getByRole("alert")).toContainText("could not be confirmed with your current access");
    await expect(dialog).not.toContainText(receipt!.feedbackId);
    await expect(dialog).not.toContainText("PRIVATE-READ-OUTAGE");
    denyRead = false;
    await dialog.getByRole("button", { name: "Check feedback receipt", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText(receipt!.feedbackId);
    await expect(dialog.getByRole("status")).toBeFocused();
    expect(writes).toBe(1);expect(reads).toBe(2);
    const original = await json(await request.get(`${base}/customer-feedback/${receipt!.id}?expectedUserId=local-board`));
    expect(original.body).toBe("PRIVATE-BROWSER-FEEDBACK-DRAFT");
    expect(await json(await request.get(`${base}/customer-feedback?expectedUserId=local-board`))).toHaveLength(1);
  } finally {
    holdSession = false;releaseSession?.();releaseAck?.();
    await json(await request.delete(`/api/companies/${company.id}`));
    await request.patch("/api/instance/settings/experimental", { data: flags });
  }
});
