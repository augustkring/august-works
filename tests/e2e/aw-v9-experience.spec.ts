import { expect, test, type APIResponse } from "@playwright/test";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}

// This exercises the built UI and native local-board APIs on the disposable
// instance. It does not qualify hosted authentication or V9 human usability.
test("V9 Home, feedback recovery and rollback preserve native state", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const original = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  const enabled = {
    experience_projection_v9: true,
    progressive_shell_v9: true,
    home_v9: true,
    customer_feedback_v9: true,
    ambient_commands_v9: true,
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await json(
    await request.patch("/api/instance/settings/experimental", {
      data: enabled,
    }),
  );
  const company = await json(
    await request.post("/api/companies", {
      data: { name: "V9 disposable browser company" },
    }),
  );
  const base = `/api/companies/${company.id}`;
  const body =
    "Browser feedback: preserve my entered explanation after a network interruption.";
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Nothing needs your attention right now.", {
        exact: true,
      }),
    ).toBeVisible();
    const projection = await json(
      await request.get(`${base}/experience?expectedUserId=local-board`),
    );
    expect(projection.companyId).toBe(company.id);
    expect(projection.needsYou).toEqual([]);
    await page.goto(`/${company.issuePrefix}/needs-you`);
    await expect(
      page.getByRole("heading", { name: "Needs You", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Nothing needs your action in the current queue.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Open full queue", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/${company.issuePrefix}/decisions$`),
    );
    await page.goto(`/${company.issuePrefix}/work`);
    await expect(
      page.getByRole("heading", { name: "Work", exact: true }),
    ).toBeVisible();
    const workOwners = page.getByRole("navigation", {
      name: "Company work",
      exact: true,
    });
    for (const [label, path] of [
      ["Projects", "projects"],
      ["Tasks", "issues"],
      ["Routines", "routines"],
    ]) {
      await expect(
        workOwners.getByRole("link", { name: label, exact: true }),
      ).toHaveAttribute("href", `/${company.issuePrefix}/${path}`);
    }
    await expect(
      page.getByText(
        "No current tasks appear in this view. Open Tasks or Projects to review other work.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    const homeEndpoint = `**/api/companies/${company.id}/experience?*`;
    await page.route(homeEndpoint, (route) =>
      route.fulfill({ status: 503, json: { error: "Temporary test outage" } }),
    );
    await page.reload();
    await expect(
      page.getByRole("alert").filter({ hasText: "Home could not be loaded" }),
    ).toBeVisible();
    await expect(
      page.getByText("Nothing needs your attention right now.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.unroute(homeEndpoint);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    const trigger = page
      .locator('[aria-label="Global utilities"]')
      .getByRole("button", { name: "Feedback", exact: true });
    const ask = page
      .locator('[aria-label="Global utilities"]')
      .getByRole("button", { name: "Ask August", exact: true });
    await ask.click();
    let commands = page.getByRole("dialog");
    await expect(
      commands.getByRole("combobox", { name: "Search or enter a command" }),
    ).toBeFocused();
    await commands
      .getByRole("combobox")
      .fill("create workflow Send outreach every Monday");
    await expect(
      commands.getByText(/no model request or action has been sent/),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ask).toBeFocused();
    await page.keyboard.press("Control+k");
    commands = page.getByRole("dialog");
    await commands
      .getByRole("combobox")
      .fill("create task Browser typed draft");
    await commands
      .getByRole("option", { name: "Prepare a Task", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("textbox").first(),
    ).toHaveValue("Browser typed draft");
    expect((await json(await request.get(`${base}/issues`))).length).toBe(0);
    await page.keyboard.press("Escape");
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox")).toBeFocused();
    for (const address of [
      "support@blentera.com",
      "privacy@blentera.com",
      "security@blentera.com",
    ])
      await expect(dialog.locator(`a[href="mailto:${address}"]`)).toHaveCount(
        1,
      );
    await dialog.getByRole("textbox").first().fill(body);
    await expect(
      dialog.getByRole("checkbox", { name: /diagnostic/i }),
    ).not.toBeChecked();
    const payloads: unknown[] = [];
    let failOnce = true;
    await page.route(
      `**/api/companies/${company.id}/customer-feedback?*`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        payloads.push(route.request().postDataJSON());
        if (failOnce) {
          failOnce = false;
          return route.abort("failed");
        }
        return route.continue();
      },
    );
    await dialog
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("textbox").first()).toHaveValue(body);
    await dialog
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    await expect(
      dialog.getByText("Thanks — feedback received", { exact: true }),
    ).toBeVisible();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[0]).toMatchObject({
      includeDiagnostics: false,
      context: { surfaceKey: "home" },
    });
    expect(payloads[0]).not.toHaveProperty("diagnostics");
    const history = await json(
      await request.get(`${base}/customer-feedback?expectedUserId=local-board`),
    );
    expect(history).toHaveLength(1);
    expect(history[0].body).toBe(body);
    await dialog
      .getByRole("status")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNavigation = page.getByRole("navigation", {
      name: "Mobile navigation",
      exact: true,
    });
    for (const name of ["Home", "Needs You", "Work", "Agents", "Apps"])
      await expect(
        mobileNavigation.getByRole("link", { name, exact: true }),
      ).toBeVisible();
    await page.screenshot({
      path: "test-results/aw-v9-home-compact.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .locator("#mobile-sidebar")
      .getByRole("link", { name: "Advanced", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Advanced", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Skills", exact: true }),
    ).toBeVisible();
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: Object.fromEntries(
          Object.keys(enabled).map((key) => [key, false]),
        ),
      }),
    );
    expect(
      (
        await request.get(`${base}/experience?expectedUserId=local-board`)
      ).status(),
    ).toBe(404);
    await page.goto(`/${company.issuePrefix}/work`);
    await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues$`));
    await page.goto(`/${company.issuePrefix}/my-feedback`);
    await expect(
      page.getByRole("heading", { name: "My feedback", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: new RegExp(history[0].feedbackId) })
      .click();
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await request.patch("/api/instance/settings/experimental", {
      data: Object.fromEntries(
        Object.keys(enabled).map((key) => [key, original[key]]),
      ),
    });
  }
});
