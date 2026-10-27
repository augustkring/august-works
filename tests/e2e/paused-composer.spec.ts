import { test, expect, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";

registerEnglishAccountLocaleIsolation(test);

async function json(response: APIResponse) {
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

for (const classic of [false, true]) {
  test(`paused composer: ${classic ? "classic" : "task chat"} preserves drafts and requires resume`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const company = await json(await request.post("/api/companies", { data: { name: `Paused composer ${Date.now()}` } }));
    const settings = await json(await request.get("/api/instance/settings/experimental"));
    try {
      await json(await request.patch("/api/instance/settings/experimental", { data: { enableClassicTaskInterface: classic } }));
      const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
        name: "Paused composer fixture", role: "engineer", adapterType: "process",
        adapterConfig: { command: "/usr/bin/true" },
        runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
      } }));
      const task = await json(await request.post(`/api/companies/${company.id}/issues`, { data: {
        title: "Review the paused composer", status: "backlog", assigneeAgentId: agent.id,
      } }));
      await page.goto(`/${company.issuePrefix}/issues/${task.identifier}`);
      const editor = (classic ? page.getByTestId("issue-chat-composer") : page).getByRole("textbox", { name: "editable markdown" });
      await editor.fill("Keep this draft until I resume.");
      const moreActions = page.getByRole("button", { name: "More task actions", exact: true });
      await page.evaluate(() => {
        const trace = {
          button: document.querySelector<HTMLButtonElement>('button[aria-label="More task actions"]'),
          events: [] as Array<{ type: string; target: string; reachedTrigger: boolean }>,
          mutations: [] as Array<{ type: string; triggerConnected: boolean; currentTriggerPresent: boolean }>,
        };
        (window as Window & { __pausedMenuTrace?: typeof trace }).__pausedMenuTrace = trace;
        new MutationObserver((records) => {
          if (!records.some((record) => record.type === "childList")) return;
          const current = document.querySelector<HTMLButtonElement>('button[aria-label="More task actions"]');
          if (current !== trace.button || !trace.button?.isConnected) {
            trace.mutations.push({
              type: "task-title-actions-replaced",
              triggerConnected: trace.button?.isConnected ?? false,
              currentTriggerPresent: !!current,
            });
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"] as const) {
          document.addEventListener(type, (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const trigger = target?.closest<HTMLButtonElement>('button[aria-label="More task actions"]') ?? null;
            trace.events.push({ type, target: target?.tagName ?? "unknown", reachedTrigger: trigger === trace.button });
          }, true);
        }
      });
      await moreActions.evaluate((element) => {
        element.addEventListener("pointerdown", () => element.setAttribute("data-e2e-pointerdown", "1"), { once: true });
        element.addEventListener("click", () => element.setAttribute("data-e2e-click", "1"), { once: true });
      });
      await moreActions.click();
      const stateImmediatelyAfterClick = await moreActions.evaluate((element) => ({
        expanded: element.getAttribute("aria-expanded"),
        state: element.getAttribute("data-state"),
        pointerdown: element.getAttribute("data-e2e-pointerdown"),
        click: element.getAttribute("data-e2e-click"),
      }));
      const clickTrace = await page.evaluate(() => {
        const trace = (window as Window & { __pausedMenuTrace?: {
          button: HTMLButtonElement | null;
          events: Array<{ type: string; target: string; reachedTrigger: boolean }>;
          mutations: Array<{ type: string; triggerConnected: boolean; currentTriggerPresent: boolean }>;
        } }).__pausedMenuTrace;
        const current = document.querySelector<HTMLButtonElement>('button[aria-label="More task actions"]');
        return trace ? {
          events: trace.events,
          mutations: trace.mutations,
          originalConnected: trace.button?.isConnected ?? false,
          sameTriggerNode: trace.button === current,
          originalExpanded: trace.button?.getAttribute("aria-expanded") ?? null,
          currentExpanded: current?.getAttribute("aria-expanded") ?? null,
        } : null;
      });
      const pauseAction = page.getByRole("button", { name: "Pause work", exact: true });
      try {
        await expect(pauseAction).toBeVisible({ timeout: 5_000 });
      } catch {
        const [accessResponse, stateResponse, holdsResponse, taskResponse, descendantsResponse] = await Promise.all([
          request.get("/api/cli-auth/me"),
          request.get(`/api/issues/${task.id}/tree-control/state`),
          request.get(`/api/issues/${task.id}/tree-holds?status=active`),
          request.get(`/api/issues/${task.id}`),
          request.get(`/api/companies/${company.id}/issues?descendantOf=${encodeURIComponent(task.id)}&includeBlockedBy=true`),
        ]);
        const [access, state, holds, currentTask, descendants] = await Promise.all([
          accessResponse.json().catch(() => null),
          stateResponse.json().catch(() => null),
          holdsResponse.json().catch(() => null),
          taskResponse.json().catch(() => null),
          descendantsResponse.json().catch(() => null),
        ]);
        const popover = await moreActions.evaluate((element) => ({
          expanded: element.getAttribute("aria-expanded"),
          state: element.getAttribute("data-state"),
        })).catch(() => null);
        throw new Error(`Pause work action was not rendered; status=${JSON.stringify({
          popover,
          stateImmediatelyAfterClick,
          clickTrace,
          pointerdown: await moreActions.getAttribute("data-e2e-pointerdown"),
          click: await moreActions.getAttribute("data-e2e-click"),
          runWorkflowVisible: await page.getByRole("button", { name: "Run workflow", exact: true }).isVisible().catch(() => false),
          accessCompanyIds: Array.isArray(access?.companyIds) ? access.companyIds : null,
          state: stateResponse.status(),
          activePauseHold: state?.activePauseHold ?? null,
          holdsStatus: holdsResponse.status(),
          activeHoldCount: Array.isArray(holds) ? holds.length : null,
          descendantsStatus: descendantsResponse.status(),
          descendantCount: Array.isArray(descendants) ? descendants.length : null,
          taskStatus: taskResponse.status(),
          task: currentTask && { status: currentTask.status, assigneeAgentId: currentTask.assigneeAgentId },
        })}`);
      }
      await pauseAction.click();
      const takeover = page.getByTestId("paused-composer-takeover");
      await expect(takeover).toBeVisible();
      await expect(takeover).toContainText("Your draft is saved.");
      await expect(editor).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
      await page.keyboard.press("Meta+Enter");
      const rejected = await request.post(`/api/issues/${task.id}/comments`, { data: { body: "Cannot send yet", reopen: true } });
      expect(rejected.status()).toBe(409);
      const rejectedUpdate = await request.patch(`/api/issues/${task.id}`, { data: { comment: "Cannot reassign and send", assigneeAgentId: null } });
      expect(rejectedUpdate.status()).toBe(409);
      expect((await json(await request.get(`/api/issues/${task.id}`))).assigneeAgentId).toBe(agent.id);
      expect(await json(await request.get(`/api/issues/${task.id}/comments`))).toHaveLength(0);
      await page.reload();
      await expect(takeover).toBeVisible();
      await expect(takeover).toContainText("Your draft is saved.");
      await takeover.getByRole("button", { name: "Resume task" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Resume work", exact: true }).click();
      await expect(takeover).toHaveCount(0);
      await expect(editor).toHaveText("Keep this draft until I resume.");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect.poll(async () => (await json(await request.get(`/api/issues/${task.id}/comments`))).map((comment: { body: string }) => comment.body)).toEqual(["Keep this draft until I resume."]);

      // Ancestor pause is effective even when this child was created after it.
      await page.getByRole("button", { name: "More task actions", exact: true }).click();
      await page.getByRole("button", { name: "Pause work", exact: true }).click();
      await expect(takeover).toBeVisible();
      const child = await json(await request.post(`/api/companies/${company.id}/issues`, { data: {
        title: "Child held by parent", parentId: task.id, status: "backlog", assigneeAgentId: agent.id,
      } }));
      await page.goto(`/${company.issuePrefix}/issues/${child.identifier}`);
      await expect(takeover).toContainText("Subtree is paused.");
      await expect(editor).toHaveCount(0);
      expect((await request.post(`/api/issues/${child.id}/comments`, { data: { body: "Still paused" } })).status()).toBe(409);
      await takeover.getByRole("link", { name: "Resume subtree" }).click();
      await expect(page).toHaveURL(new RegExp(task.identifier));
      await takeover.getByRole("button", { name: "Resume subtree" }).click();
      await page.getByRole("dialog").getByRole("checkbox").uncheck();
      await page.getByRole("dialog").getByRole("button", { name: "Resume subtree", exact: true }).click();
      await page.goto(`/${company.issuePrefix}/issues/${child.identifier}`);
      await expect(takeover).toHaveCount(0);
      await expect(editor).toBeVisible();
    } finally {
      await request.patch(`/api/companies/${company.id}`, { data: { status: "archived" } });
      await request.patch("/api/instance/settings/experimental", { data: { enableClassicTaskInterface: settings.enableClassicTaskInterface } });
    }
  });
}
