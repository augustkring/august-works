import { expect, test, type APIResponse } from "@playwright/test";
import { createRequire } from "node:module";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
// Built UI + actual native draft/test/publication. No material/runtime or human acceptance claim.
test("reviewed internal publication recovers a lost native receipt without publishing twice", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120000);
  const original = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  const session = await json(await request.get("/api/auth/get-session"));
  const expectedUserId = encodeURIComponent(session.user.id);
  await json(
    await request.patch("/api/instance/settings/experimental", {
      data: {
        enableWorkflowsV1: true,
        enableWorkflowBuilderV1: true,
        experience_projection_v9: true,
        progressive_shell_v9: true,
      },
    }),
  );
  const company = await json(
    await request.post("/api/companies", {
      data: { name: "V9 disposable native publication company" },
    }),
  );
  const base = `/api/companies/${company.id}`;
  const created = await json(
    await request.post(`${base}/workflows`, {
      data: { name: "Reviewed native internal flow" },
    }),
  );
  const detail = await json(
    await request.patch(`${base}/workflows/${created.id}/draft`, {
      data: {
        expectedRevisionId: created.draftRevisionId,
        graph: {
          version: 1,
          nodes: [
            {
              id: "start",
              type: "core.manual_trigger",
              name: "Start internal flow",
              config: {},
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
          variables: [],
          settings: { totalDeadlineSeconds: 60 },
        },
      },
    }),
  );
  try {
    const testReceipt = await json(
      await request.post(
        `${base}/workflows/${detail.id}/experience/test?expectedUserId=${expectedUserId}`,
        {
          data: {
            requestId: crypto.randomUUID(),
            expectedWorkflowId: detail.id,
            expectedDraftRevisionId: detail.draftRevisionId,
            expectedUpdatedAt: detail.updatedAt,
            expectedRunStatus: "succeeded",
            acknowledgeInternalTest: true,
          },
        },
      ),
    );
    await expect
      .poll(
        async () =>
          (
            await json(
              await request.get(`${base}/workflow-runs/${testReceipt.runId}`),
            )
          ).run.status,
      )
      .toBe("succeeded");
    const commands: Record<string, unknown>[] = [];
    let nativeReceipt: Record<string, unknown> | undefined;
    await page.route(
      `**/workflows/${detail.id}/experience/publication?*`,
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        commands.push(route.request().postDataJSON());
        const response = await route.fetch();
        nativeReceipt = await response.json();
        await route.abort("failed");
      },
    );
    await page.goto(`/${company.issuePrefix}/workflows/${detail.id}`);
    await page
      .getByRole("button", { name: "Publish reviewed version", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Publish reviewed version",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await page.setViewportSize({ width: 390, height: 844 });
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
      path: info.outputPath("v9-native-publication-mobile.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Publish reviewed version", exact: true })
      .click();
    await expect.poll(() => commands.length).toBe(1);
    await expect
      .poll(() => nativeReceipt?.requestId)
      .toBe(commands[0].requestId);
    await page.reload();
    await expect(
      page.getByText("The original native publication was recorded.", {
        exact: false,
      }),
    ).toBeVisible();
    const replay = await json(
      await request.post(
        `${base}/workflows/${detail.id}/experience/publication?expectedUserId=${expectedUserId}`,
        { data: commands[0] },
      ),
    );
    expect(replay).toEqual(nativeReceipt);
    const published = await json(
      await request.get(`${base}/workflows/${detail.id}`),
    );
    expect(published.publishedRevisionId).toBe(detail.draftRevisionId);
    expect(published.draftRevisionId).not.toBe(detail.draftRevisionId);
    const testRun = await json(
      await request.get(`${base}/workflow-runs/${testReceipt.runId}`),
    );
    expect(testRun.run.source).toBe("test");
    const events = await json(
      await request.get(
        `${base}/activity?entityType=workflow&entityId=${detail.id}`,
      ),
    );
    expect(
      events.filter(
        (event: { action: string }) =>
          event.action === "workflow.customer_publication_recorded",
      ),
    ).toHaveLength(1);
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { progressive_shell_v9: false },
      }),
    );
    await page.reload();
    expect(
      (await json(await request.get(`${base}/workflows/${detail.id}`)))
        .publishedRevisionId,
    ).toBe(detail.draftRevisionId);
  } finally {
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: original,
      }),
    );
  }
});
