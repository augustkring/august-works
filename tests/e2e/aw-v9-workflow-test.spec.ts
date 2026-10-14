import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
// Actual native draft/queue/executor and built UI; no hidden publication or
// representative customer/business qualification is supplied by this fixture.
test("an unpublished internal test recovers its original receipt after reload and preserves native test purpose", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const original = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  const enabled = {
    enableWorkflowsV1: true,
    enableWorkflowBuilderV1: true,
    experience_projection_v9: true,
    progressive_shell_v9: true,
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: enabled,
      }),
    );
    const company = await json(
      await request.post("/api/companies", {
        data: { name: "Unpublished internal test browser fixture" },
      }),
    );
    const base = `/api/companies/${company.id}`,
      workflows = `${base}/workflows`;
    const draft = await json(
      await request.post(workflows, {
        data: { name: "Test internal routing" },
      }),
    );
    const prepared = await json(
      await request.patch(`${workflows}/${draft.id}/draft`, {
        data: {
          expectedRevisionId: draft.draftRevisionId,
          graph: {
            version: 1,
            variables: [],
            settings: { totalDeadlineSeconds: 60 },
            nodes: [
              {
                id: "start",
                type: "core.manual_trigger",
                name: "Start internal test",
                config: {},
                position: { x: 0, y: 0 },
              },
              {
                id: "route",
                type: "core.condition",
                name: "Choose internal route",
                config: { expression: '{{trigger.amount}} >= 10000' },
                position: { x: 0, y: 1 },
              },
              {
                id: "finish",
                type: "core.merge",
                name: "Finish internal test",
                config: { mode: "all" },
                position: { x: 0, y: 2 },
              },
              {
                id: "alternate",
                type: "core.merge",
                name: "Unselected internal path",
                config: { mode: "all" },
                position: { x: 1, y: 2 },
              },
            ],
            edges: [
              { id: "start-route", source: "start", target: "route" },
              {
                id: "route-finish",
                source: "route",
                target: "finish",
                sourceHandle: "true",
              },
              {
                id: "route-alternate",
                source: "route",
                target: "alternate",
                sourceHandle: "false",
              },
            ],
          },
        },
      }),
    );
    expect(prepared.publishedRevisionId).toBeNull();
    const endpoint = `${workflows}/${draft.id}/experience/test?expectedUserId=local-board`;
    const commands: Record<string, unknown>[] = [];
    let accepted: Record<string, unknown> | undefined;
    await page.route(`**${endpoint}`, async (route) => {
      commands.push(route.request().postDataJSON());
      if (commands.length === 1) {
        accepted = await json(await route.fetch());
        await route.abort("failed");
      } else await route.continue();
    });
    const path = `/${company.issuePrefix}/workflows/${draft.id}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.getByText("Data supplied when this workflow starts.", { exact: true })).toBeVisible();
    await expect(page.getByText("Start data, variables or earlier outputs used by the condition.", { exact: true })).toBeVisible();
    await expect(page.getByText("This step has no approval checkpoint. Workflow admission rules still apply.", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("At most 1 attempt.", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page
      .getByRole("button", { name: "Review internal test", exact: true })
      .click();
    const dialog = page.getByRole("dialog"),
      confirm = dialog.getByRole("button", {
        name: "Start internal test",
        exact: true,
      });
    await expect(dialog).toContainText("An empty list starts with no data");
    await expect(dialog).toContainText(
      "Succeeded, within the configured 60 seconds",
    );
    await expect(confirm).toBeDisabled();
    expect(commands).toHaveLength(0);
    await dialog.getByRole("button", { name: "Add a test value", exact: true }).click();
    const inputPath = dialog.getByRole("textbox", { name: "Field names, from outermost to innermost", exact: true });
    await expect(inputPath).toBeFocused(); await inputPath.fill("amount");
    await dialog.getByRole("combobox", { name: "Value type", exact: true }).selectOption("number");
    await dialog.getByRole("spinbutton", { name: "Test value", exact: true }).fill("10000");
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: {
                run: (scope: string) => Promise<{ violations: unknown[] }>;
              };
            }
          ).axe.run('[role="dialog"]')
        ).violations,
    );
    expect(violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath("unpublished-test-confirmation-mobile.png"),
      fullPage: true,
    });
    await dialog.getByRole("checkbox").check();
    await confirm.click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].syntheticInput).toEqual([{ path: ["amount"], value: 10000 }]);
    await expect.poll(() => accepted?.requestId).toBe(commands[0].requestId);
    await page.reload();
    await expect(
      page.getByText(
        "The original internal test was admitted. Open the test to check its actual status and steps.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(commands).toHaveLength(1);
    const current = await json(await request.get(`${workflows}/${draft.id}`));
    expect(current.publishedRevisionId).toBeNull();
    expect(current.draftRevisionId).toBe(prepared.draftRevisionId);
    const recovered = await json(
      await request.get(
        `${workflows}/${draft.id}/experience?expectedUserId=local-board`,
      ),
    );
    expect(recovered.testReceipt).toEqual(accepted);
    expect(
      await json(await request.post(endpoint, { data: commands[0] })),
    ).toEqual(accepted);
    const history = await json(
      await request.get(`${workflows}/${draft.id}/runs`),
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: accepted!.runId,
      source: "test",
      status: "succeeded",
      workflowRevisionId: prepared.draftRevisionId,
    });
    const activity = await json(await request.get(`${base}/activity`));
    expect(
      activity.filter(
        (event: { action: string; entityId: string }) =>
          event.action === "workflow.customer_test_admitted" &&
          event.entityId === draft.id,
      ),
    ).toHaveLength(1);
    await page
      .getByRole("link", { name: "Inspect internal test", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Internal workflow test",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Recorded branch selects next step: Finish internal test. This does not confirm that the next step ran.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("unpublished-test-result-mobile.png"),
      fullPage: true,
    });
    const observed = await json(
      await request.get(
        `${base}/workflow-runs/${accepted!.runId}/experience?expectedUserId=local-board`,
      ),
    );
    expect(observed).toMatchObject({
      purpose: "test",
      status: "succeeded",
      revisionState: "draft",
      revisionId: prepared.draftRevisionId,
    });
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { progressive_shell_v9: false },
      }),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Execution log", exact: true }),
    ).toBeVisible();
    const retained = await json(
      await request.get(`${base}/workflow-runs/${accepted!.runId}`),
    );
    expect(retained.run).toMatchObject({ source: "test", status: "succeeded" });
    expect(errors).toEqual([]);
  } finally {
    await request.patch("/api/instance/settings/experimental", {
      data: Object.fromEntries(
        Object.keys(enabled).map((key) => [key, original[key]]),
      ),
    });
  }
});
