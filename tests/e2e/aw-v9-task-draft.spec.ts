import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";

registerEnglishAccountLocaleIsolation(test);

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}

// Actual Native POST and current Native receipt; abort only transport after the
// create committed. A missing receipt never causes another POST.
test("an explicit task draft reconciles a lost Native acknowledgement with reads and one created task", async ({
  page,
  request,
}, info) => {
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
      data: { name: "Disposable Native task-draft qualification" },
    }),
  );
  const base = `/api/companies/${company.id}`;
  const attempts: Array<Record<string, unknown>> = [];
  let savedId: string | undefined,
    key: string | undefined,
    reads = 0;
  await page.route(`**${base}/issues?**`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("expectedActorId")).toBe("local-board");
    expect(params.get("awExperienceDraft")).toBe("task");
    attempts.push(route.request().postDataJSON());
    expect(attempts).toHaveLength(1);
    key = attempts[0]!.idempotencyKey as string;
    const response = await route.fetch(),
      result = await json(response);
    expect(result).toMatchObject({
      companyId: company.id,
      status: "backlog",
      priority: "medium",
      assigneeAgentId: null,
      assigneeUserId: null,
    });
    savedId = result.id;
    await route.abort("failed");
  });
  await page.route(`**${base}/issues/create-receipts/**`, async (route) => {
    expect(route.request().method()).toBe("GET");
    expect(
      new URL(route.request().url()).searchParams.get("expectedActorId"),
    ).toBe("local-board");
    reads++;
    if (reads === 1) return route.abort("failed");
    await route.continue();
  });
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(
      page.getByRole("button", {
        name: `Open ${company.name} organization switcher`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Home", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await page
      .getByRole("combobox")
      .fill("opret en opgave Review Customer Research");
    await page
      .getByRole("option", { name: "Prepare a Task", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Task title", exact: true }),
    ).toHaveValue("Review Customer Research");
    expect(attempts).toHaveLength(0);
    await page
      .getByRole("textbox", { name: "What should happen?", exact: true })
      .fill("Private browser draft: review the customer research plan.");
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "We have not confirmed this task",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toEqual({
      idempotencyKey: key,
      title: "Review Customer Research",
      description: "Private browser draft: review the customer research plan.",
      status: "backlog",
      priority: "medium",
      assigneeAgentId: null,
      assigneeUserId: null,
      allowDuplicate: true,
    });
    const once = await json(await request.get(`${base}/issues`));
    expect(once).toHaveLength(1);
    expect(once[0].id).toBe(savedId);
    await json(
      await request.patch(`/api/issues/${savedId}`, {
        data: { title: "Current Native research task" },
      }),
    );
    // Reload discards all React fields. Only the original nonce/scope survives
    // in this tab; choosing another draft resumes its receipt without a POST.
    const retained = await page.evaluate(() =>
      sessionStorage.getItem("aw.v9.pending-task-receipts"),
    );
    expect(retained).toContain(key!);
    expect(retained).not.toContain("Private browser draft");
    expect(retained).not.toContain("Review Customer Research");
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Home", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("create task A separate new draft");
    await page
      .getByRole("option", { name: "Prepare a Task", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Find your task", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Task confirmed", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Task confirmed", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("dialog")).toContainText(
      "Current Native research task",
    );
    expect(attempts).toHaveLength(1);
    expect(reads).toBe(2);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("aw.v9.pending-task-receipts"),
      ),
    ).toBeNull();
    expect(await json(await request.get(`${base}/issues`))).toHaveLength(1);
    expect(await json(await request.get(`${base}/agents`))).toEqual([]);
    const runs = await json(await request.get(`${base}/heartbeat-runs`));
    expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(
      await page.evaluate(
        async () =>
          (
            await (
              window as unknown as {
                axe: { run(scope: string): Promise<{ violations: unknown[] }> };
              }
            ).axe.run('[role="dialog"]')
          ).violations,
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("v9-native-task-receipt-mobile.png"),
      fullPage: true,
    });
    await expect(
      page.getByRole("link", { name: "Open task", exact: true }),
    ).toHaveAttribute("href", new RegExp(`/issues/${savedId}$`));
  } finally {
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
