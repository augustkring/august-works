import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, type APIResponse, type Page } from "@playwright/test";
import { assertUnqualifiedRuntime } from "./fixtures/assert-unqualified-runtime.js";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}
async function menu(page: Page, action: string) {
  await page.getByRole("button", { name: "More task actions", exact: true }).click();
  await page.locator('[data-slot="popover-content"]').getByRole("button", { name: action, exact: true }).click();
}

for (const adapterType of ["process", "paperclip_runner"] as const) {
  test(`${adapterType}: unavailable model runtime preserves input and non-paid subtree controls`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const root = await mkdtemp(path.join(os.tmpdir(), "unqualified-composer-"));
    const company = await json(await request.post("/api/companies", { data: { name: `Unavailable ${adapterType} ${Date.now()}` } }));
    const original = await json(await request.get("/api/instance/settings/experimental"));
    try {
      await json(await request.patch("/api/instance/settings/experimental", {
        data: { enableClassicTaskInterface: false, enableNativeRunner: true },
      }));
      async function agent(name: string) {
        return json(await request.post(`/api/companies/${company.id}/agents`, { data: { name, role: "engineer", adapterType,
          adapterConfig: adapterType === "process" ? { command: process.execPath,
            args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "started"))}, 'started'); setInterval(() => {}, 1000);`] }
            : { provider: "codex", model: "gpt-5.1-codex-mini" },
          runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } } } }));
      }
      const owner = await agent("Unavailable parent"), childOwner = await agent("Unavailable child"), otherOwner = await agent("Unrelated task");
      async function task(title: string, extra: Record<string, unknown>) {
        return json(await request.post(`/api/companies/${company.id}/issues`, { data: { title, status: "backlog", ...extra } }));
      }
      const parent = await task("Unavailable parent task", { assigneeAgentId: owner.id });
      const child = await task("Child work", { parentId: parent.id, assigneeAgentId: childOwner.id });
      const completed = await task("Finished child", { parentId: parent.id, status: "done" });
      const other = await task("Unrelated work", { assigneeAgentId: otherOwner.id });
      for (const issue of [parent, child, other]) await json(await request.patch(`/api/issues/${issue.id}`, { data: { status: "todo" } }));
      await page.goto(`/${company.issuePrefix}/issues/${parent.identifier}`);
      const first = await assertUnqualifiedRuntime({ request, page, companyId: company.id, agentId: owner.id });
      const editor = page.getByRole("textbox", { name: "editable markdown" });
      await editor.fill("Please check mobile too.");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await assertUnqualifiedRuntime({ request, page, companyId: company.id, agentId: owner.id, excludedRunIds: [first.id] });
      const comments = await json(await request.get(`/api/issues/${parent.id}/comments`));
      expect(comments.filter((comment: { body: string }) => comment.body === "Please check mobile too.")).toHaveLength(1);
      for (const issue of [parent, child, other]) {
        await expect.poll(async () => (await json(await request.get(`/api/issues/${issue.id}`))).status).toBe("blocked");
        expect(await json(await request.get(`/api/issues/${issue.id}/live-runs`))).toEqual([]);
      }
      await expect(readFile(path.join(root, "started"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      // These are actual Task tree-control actions, not provider Stop proof.
      await menu(page, "Pause subtree");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Subtree is paused.", { exact: true })).toBeVisible();
      expect((await json(await request.get(`/api/issues/${parent.id}/tree-control/state`))).activePauseHold).toBeTruthy();
      expect((await json(await request.get(`/api/issues/${other.id}/tree-control/state`))).activePauseHold).toBeNull();
      await page.reload();
      await expect(page.getByText("Subtree is paused.", { exact: true })).toBeVisible();
      await menu(page, "Resume subtree");
      const resume = page.getByRole("dialog");
      await resume.getByRole("checkbox").uncheck();
      await resume.getByRole("button", { name: "Resume subtree", exact: true }).click();
      await expect(resume).toHaveCount(0);
      expect((await json(await request.get(`/api/issues/${parent.id}/tree-control/state`))).activePauseHold).toBeNull();
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
      await menu(page, "Cancel subtree...");
      let dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Cancel subtree?" })).toBeVisible();
      await expect(dialog.locator('textarea, input[type="checkbox"]')).toHaveCount(0);
      await dialog.getByRole("button", { name: "Keep tasks" }).click();
      expect((await json(await request.get(`/api/issues/${parent.id}`))).status).not.toBe("cancelled");
      await menu(page, "Cancel subtree...");
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Cancel 2 tasks", exact: true }).click();
      for (const issue of [parent, child]) await expect.poll(async () => (await json(await request.get(`/api/issues/${issue.id}`))).status).toBe("cancelled");
      expect((await json(await request.get(`/api/issues/${completed.id}`))).status).toBe("done");
      expect((await json(await request.get(`/api/issues/${other.id}`))).status).toBe("blocked");
      await expect(page.getByRole("button", { name: "Dismiss notification" })).toHaveCount(0);
      await expect(readFile(path.join(root, "started"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await request.patch(`/api/companies/${company.id}`, { data: { status: "archived" } });
      await request.patch("/api/instance/settings/experimental", { data: {
        enableClassicTaskInterface: original.enableClassicTaskInterface, enableNativeRunner: original.enableNativeRunner } });
      await rm(root, { recursive: true, force: true });
    }
  });
}
