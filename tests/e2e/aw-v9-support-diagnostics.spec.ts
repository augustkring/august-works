import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
// Actual native test/executor and browser download. No support delivery,
// business verification, privileged session or human acceptance is claimed.
test("support report previews and downloads only current native workflow metadata", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120000);
  const original = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  try {
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
        data: { name: "Disposable support diagnostic company" },
      }),
    );
    const base = `/api/companies/${company.id}`;
    const created = await json(
      await request.post(`${base}/workflows`, {
        data: { name: "Private name excluded from diagnostics" },
      }),
    );
    const draft = await json(
      await request.patch(`${base}/workflows/${created.id}/draft`, {
        data: {
          expectedRevisionId: created.draftRevisionId,
          graph: {
            version: 1,
            nodes: [
              {
                id: "start",
                type: "core.manual_trigger",
                name: "Private step excluded from diagnostics",
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
    const admitted = await json(
      await request.post(
        `${base}/workflows/${draft.id}/experience/test?expectedUserId=local-board`,
        {
          data: {
            requestId: crypto.randomUUID(),
            expectedWorkflowId: draft.id,
            expectedDraftRevisionId: draft.draftRevisionId,
            expectedUpdatedAt: draft.updatedAt,
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
              await request.get(`${base}/workflow-runs/${admitted.runId}`),
            )
          ).run.status,
      )
      .toBe("succeeded");
    await page.goto(
      `/${company.issuePrefix}/workflows/${draft.id}/runs/${admitted.runId}`,
    );
    const open = page.getByRole("button", {
      name: "Prepare a support report",
      exact: true,
    });
    await expect(open).toBeVisible();
    await open.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const preview = JSON.parse(
      await dialog
        .getByRole("textbox", { name: "Report to download", exact: true })
        .inputValue(),
    );
    expect(preview).toMatchObject({
      companyId: company.id,
      workflowId: draft.id,
      runId: admitted.runId,
      revisionId: draft.draftRevisionId,
      purpose: "test",
      runStatus: "succeeded",
      verification: "recorded_execution_only",
    });
    expect(JSON.stringify(preview)).not.toContain("Private");
    expect(JSON.stringify(preview)).not.toContain("local-board");
    await expect(dialog).toContainText(
      "Nothing is sent to support automatically",
    );
    await expect(
      dialog.locator('a[href="mailto:support@blentera.com"]'),
    ).toHaveCount(1);
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
      path: info.outputPath("v9-support-diagnostic-preview-mobile.png"),
      fullPage: true,
    });
    const downloadPromise = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download report", exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      "august-works-support-diagnostic.json",
    );
    const file = await download.path();
    expect(file).not.toBeNull();
    expect(JSON.parse(await readFile(file!, "utf8"))).toEqual(preview);
    await expect(dialog.getByRole("status")).toContainText(
      "Download requested",
    );
    await dialog
      .getByRole("button", { name: "Cancel", exact: true })
      .last()
      .click();
    await expect(open).toBeFocused();
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { progressive_shell_v9: false },
      }),
    );
    await page.reload();
    await expect(open).toHaveCount(0);
    const run = await json(
      await request.get(`${base}/workflow-runs/${admitted.runId}`),
    );
    expect(run.run.source).toBe("test");
    expect(run.run.status).toBe("succeeded");
  } finally {
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: original,
      }),
    );
  }
});
