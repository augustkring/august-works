import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}

// Original local-board/project APIs and current creator-bound receipt. Only
// the transport of the single committed POST and first receipt GET is aborted.
// This is software evidence, not hosted identity or live business acceptance.
test("an explicit project draft recovers a lost Native acknowledgement after reload through reads without creating another project or running work", async ({
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
      data: { name: "Disposable Native project-draft qualification" },
    }),
  );
  const base = `/api/companies/${company.id}`;
  const attempts: Array<Record<string, unknown>> = [];
  let savedId: string | undefined, key: string | undefined, reads = 0;
  await page.route(`**${base}/projects?**`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(
      new URL(route.request().url()).searchParams.get("expectedActorId"),
    ).toBe("local-board");
    attempts.push(route.request().postDataJSON());
    expect(attempts).toHaveLength(1);
    key = attempts[0]!.idempotencyKey as string;
    const response = await route.fetch();
    const result = await json(response);
    expect(result.companyId).toBe(company.id);
    expect(result.status).toBe("planned");
    savedId ??= result.id;
    expect(result.id).toBe(savedId);
    await route.abort("failed");
  });
  await page.route(`**${base}/projects/create-receipts/**`, async (route) => {
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).searchParams.get("expectedActorId")).toBe("local-board");
    reads++;
    if (reads === 1) return route.abort("failed");
    await route.continue();
  });
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Home", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("opret et projekt Customer Research");
    await page
      .getByRole("option", { name: "Prepare a Project", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Project name", exact: true }),
    ).toHaveValue("Customer Research");
    expect(attempts).toHaveLength(0);
    await page
      .getByRole("textbox", {
        name: "Goal or description (optional)",
        exact: true,
      })
      .fill("Private browser draft: review our customer research plan.");
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "We have not confirmed this project",
    );
    expect(attempts).toHaveLength(1);
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveCount(0);
    const once = await json(await request.get(`${base}/projects`));
    expect(once).toHaveLength(1);
    expect(once[0].id).toBe(savedId);
    await json(await request.patch(`/api/projects/${savedId}`, { data: { name: "Current Native research project" } }));
    const pending = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-project-receipts"));
    expect(pending).toContain(key!);
    expect(pending).not.toContain("Private browser draft");
    expect(pending).not.toContain("Customer Research");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("create project A separate new draft");
    await page.getByRole("option", { name: "Prepare a Project", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Find your project", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Project saved", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Project saved", exact: true }),
    ).toBeFocused();
    expect(attempts).toHaveLength(1);
    expect(reads).toBe(2);
    await expect(page.getByRole("dialog")).toContainText("Current Native research project");
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-project-receipts"))).toBeNull();
    const retained = await json(await request.get(`${base}/projects`));
    expect(retained).toHaveLength(1);
    expect(retained[0].id).toBe(savedId);
    expect(await json(await request.get(`${base}/issues`))).toEqual([]);
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
      path: info.outputPath("v9-native-project-receipt-mobile.png"),
      fullPage: true,
    });
    await expect(
      page.getByRole("link", { name: "Open project", exact: true }),
    ).toHaveAttribute("href", new RegExp(`/projects/${savedId}$`));
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
