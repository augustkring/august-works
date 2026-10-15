import { expect, test, type APIResponse } from "@playwright/test";
import { createRequire } from "node:module";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
// Actual native metadata and built UI, not hosted/provider or human acceptance.
test("customer agent monitor follows native state and keeps business verification distinct", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const original = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  const company = await json(
    await request.post("/api/companies", {
      data: { name: "V9 disposable native monitor company" },
    }),
  );
  const agent = await json(
    await request.post(`/api/companies/${company.id}/agents`, {
      data: {
        name: "Native monitored worker",
        role: "engineer",
        adapterType: "process",
      },
    }),
  );
  try {
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { experience_projection_v9: true, progressive_shell_v9: true },
      }),
    );
    const view = await json(
      await request.get(
        `/api/companies/${company.id}/agents/${agent.id}/experience?expectedUserId=local-board`,
      ),
    );
    expect(view.agentId).toBe(agent.id);
    expect(view.recent.runs).toEqual([]);
    await page.goto(`/${company.issuePrefix}/agents/${agent.id}/monitor`);
    const heading = page.getByRole("heading", {
      name: "Monitor Native monitored worker",
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(
      page.getByText("A successful run does not confirm", { exact: false }),
    ).toBeVisible();
    const pause = page.getByRole("button", { name: "Pause agent", exact: true });
    await expect(pause).toBeVisible(); await pause.focus(); await page.keyboard.press("Enter");
    const decision = page.getByRole("alertdialog"); await expect(decision).toBeVisible();
    await expect(decision.getByRole("button", { name: "Pause agent", exact: true })).toBeDisabled();
    await decision.getByRole("radio", { name: "Let work in progress finish. Queued work remains held.", exact: true }).check();
    await decision.getByRole("button", { name: "Pause agent", exact: true }).click();
    await expect(page.getByText("The pause is recorded. Check current work to see whether stopping is complete.", { exact: true })).toBeVisible();
    expect((await json(await request.get(`/api/agents/${agent.id}`))).status).toBe("paused");
    await page.reload();
    await expect(
      page.getByText("Paused — new autonomous work is blocked", {
        exact: true,
      }),
    ).toBeVisible();
    const pausedView = await json(await request.get(
      `/api/companies/${company.id}/agents/${agent.id}/experience?expectedUserId=local-board`,
    ));
    expect(pausedView.pausedWork).toEqual({ status: "none", pendingRuns: 0 });
    await expect(page.getByText("No pending native runs were recorded at this check.", { exact: false })).toBeVisible();
    await expect(page.getByText("does not confirm that a remote process stopped", { exact: false })).toBeVisible();
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
          ).axe.run("main")
        ).violations,
    );
    expect(violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("v9-agent-monitor-mobile.png"),
      fullPage: true,
    });
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { progressive_shell_v9: false },
      }),
    );
    await page.reload();
    await expect(heading).toHaveCount(0);
    const native = await json(await request.get(`/api/agents/${agent.id}`));
    expect(native.status).toBe("paused");
  } finally {
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: original,
      }),
    );
  }
});
