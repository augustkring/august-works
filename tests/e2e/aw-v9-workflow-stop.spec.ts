import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
// Real built UI/native local-board integration. The native published wait graph
// is an explicit software prerequisite, not customer publication qualification.
test("customer stop recovers a lost native admission after reload without repeating effects", async ({
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
  let runId: string | undefined, companyId: string | undefined;
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
        data: { name: "Native stop browser fixture" },
      }),
    );
    companyId = company.id;
    const base = `/api/companies/${company.id}`,
      workflows = `${base}/workflows`;
    const draft = await json(
      await request.post(workflows, { data: { name: "Wait for review" } }),
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
                name: "Start review",
                config: {},
                position: { x: 0, y: 0 },
              },
              {
                id: "delay",
                type: "core.wait",
                name: "Wait for review",
                config: { durationSeconds: 30 },
                position: { x: 0, y: 1 },
              },
            ],
            edges: [{ id: "start-delay", source: "start", target: "delay" }],
          },
        },
      }),
    );
    const published = await json(
      await request.post(`${workflows}/${draft.id}/publish`, {
        data: {
          expectedDraftRevisionId: prepared.draftRevisionId,
          expectedPublishedRevisionId: null,
          approvalId: null,
        },
      }),
    );
    const waiting = await json(
      await request.post(`${workflows}/${draft.id}/run`, {
        headers: { "Idempotency-Key": "v9-native-stop-fixture" },
        data: { input: {} },
      }),
    );
    runId = waiting.run.id;
    expect(waiting.run.status).toBe("waiting");
    const endpoint = `${base}/workflow-runs/${runId}/experience/stop?expectedUserId=local-board`;
    const commands: Record<string, unknown>[] = [];
    let accepted: Record<string, unknown> | undefined;
    await page.route(`**${endpoint}`, async (route) => {
      commands.push(route.request().postDataJSON());
      if (commands.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        accepted = await response.json();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/${company.issuePrefix}/workflows/${draft.id}/runs/${runId}`,
    );
    await expect(
      page.getByRole("heading", { name: "Workflow run", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stop run", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Completed actions remain");
    const confirm = dialog.getByRole("button", {
      name: "Stop run",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    expect(commands).toHaveLength(0);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const result = await (
        window as unknown as {
          axe: { run: (scope: string) => Promise<{ violations: unknown[] }> };
        }
      ).axe.run('[role="dialog"]');
      return result.violations;
    });
    expect(violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath("customer-stop-confirmation-mobile.png"),
      fullPage: true,
    });
    await dialog.getByRole("checkbox").check();
    await confirm.click();
    // Leave the mounted command state behind. The fresh private native read
    // recovers the actual original admission, with no browser-persisted draft.
    await expect.poll(() => commands.length).toBe(1);
    await expect.poll(() => accepted?.requestId).toBe(commands[0].requestId);
    await page.reload();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "The original stop request was accepted" }),
    ).toBeVisible();
    expect(commands).toHaveLength(1);
    const recovered = await json(
      await request.get(
        `${base}/workflow-runs/${runId}/experience?expectedUserId=local-board`,
      ),
    );
    expect(recovered.stopReceipt).toEqual(accepted);
    // Reconciliation reads add no effect; the same native command is also
    // replayable by its current authorized human and retains one admission.
    expect(
      await json(await request.post(endpoint, { data: commands[0] })),
    ).toEqual(accepted);
    await page.screenshot({
      path: info.outputPath("customer-stop-recovered-mobile.png"),
      fullPage: true,
    });
    expect(accepted).toMatchObject({
      companyId: company.id,
      workflowId: draft.id,
      runId,
      revisionId: published.publishedRevisionId,
      requestId: commands[0].requestId,
      disposition: "cancellation_requested",
    });
    const stopped = await json(
      await request.get(`${base}/workflow-runs/${runId}`),
    );
    expect(stopped.run.status).toBe("cancelled");
    expect(
      stopped.steps.find((step: { nodeId: string }) => step.nodeId === "start")
        .status,
    ).toBe("succeeded");
    expect(
      stopped.steps.find((step: { nodeId: string }) => step.nodeId === "delay")
        .status,
    ).toBe("cancelled");
    expect(stopped.waits).toMatchObject([{ status: "cancelled" }]);
    const activity = await json(await request.get(`${base}/activity`));
    expect(
      activity.filter(
        (event: { action: string; entityId: string }) =>
          event.action === "workflow.customer_stop_admitted" &&
          event.entityId === runId,
      ),
    ).toHaveLength(1);
    expect(
      await json(await request.get(`${workflows}/${draft.id}/runs`)),
    ).toHaveLength(1);
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { progressive_shell_v9: false },
      }),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Execution log", exact: true }),
    ).toBeVisible();
    expect(
      (await json(await request.get(`${base}/workflow-runs/${runId}`))).run
        .status,
    ).toBe("cancelled");
    expect(errors).toEqual([]);
  } finally {
    if (companyId && runId)
      await request.post(
        `/api/companies/${companyId}/workflow-runs/${runId}/cancel`,
        { data: { reason: "Disposable native stop fixture cleanup" } },
      );
    await request.patch("/api/instance/settings/experimental", {
      data: Object.fromEntries(
        Object.keys(enabled).map((key) => [key, original[key]]),
      ),
    });
  }
});
