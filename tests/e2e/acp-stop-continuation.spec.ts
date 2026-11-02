import { assertUnqualifiedRuntime } from "./fixtures/assert-unqualified-runtime.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, type APIResponse } from "@playwright/test";

async function json(response: APIResponse) {
  const body = await response.text();
  expect(response.ok(), `${response.url()}: ${response.status()} ${body}`).toBe(true);
  return JSON.parse(body);
}

for (const { unfinishedWrite, stopResponse } of [{ unfinishedWrite: false, stopResponse: false }, { unfinishedWrite: true, stopResponse: false }, { unfinishedWrite: false, stopResponse: true }]) {
  test(`unqualified ACP profile: ${unfinishedWrite ? "no unfinished write can start" : stopResponse ? "no response can start for composer Stop" : "no session can start for Interrupt"}`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-stop-browser-"));
    const company = await json(await request.post("/api/companies", { data: { name: `ACP Stop ${Date.now()}` } }));
    const originalSettings = await json(await request.get("/api/instance/settings/experimental"));
    try {
      await json(await request.patch("/api/instance/settings/experimental", { data: { enableClassicTaskInterface: false } }));
      const owner = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
        name: "ACP Stop fixture", role: "engineer", adapterType: "claude_local",
        adapterConfig: { engine: "acp", cwd: root, stateDir: path.join(root, "state"),
          agentCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("scripts/mcp-fixtures/servers/acp-stop-agent.mjs"))}`,
          env: { PAPERCLIP_STOP_FIXTURE_ROOT: root, PAPERCLIP_STOP_FIXTURE_FINISH_TASK: "1", ...(unfinishedWrite ? { PAPERCLIP_STOP_FIXTURE_TOOL: "write" } : {}) },
        }, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
      } }));
      const issue = await json(await request.post(`/api/companies/${company.id}/issues`, { data: {
        title: "ACP Stop continuation", status: "backlog", assigneeAgentId: owner.id,
      } }));
      await json(await request.patch(`/api/issues/${issue.id}`, { data: { status: "todo" } }));
      await page.goto(`/${company.issuePrefix}/issues/${issue.identifier}`);
      const unavailable = await assertUnqualifiedRuntime({ request, page, companyId: company.id, agentId: owner.id });
      const editor = page.getByRole("textbox", { name: "editable markdown" });
      await editor.fill("List my recent Drive files.");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await assertUnqualifiedRuntime({ request, page, companyId: company.id, agentId: owner.id,
        excludedRunIds: [unavailable.id] });
      const comments = await json(await request.get(`/api/issues/${issue.id}/comments`));
      expect(comments.filter((comment: { body: string }) => comment.body === "List my recent Drive files.")).toHaveLength(1);
      for (const filename of ["requests", "prompts", "writes", "completed"]) {
        await expect(readFile(path.join(root, filename), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(await json(await request.get(`/api/issues/${issue.id}/live-runs`))).toEqual([]);
      expect((await json(await request.get(`/api/issues/${issue.id}/tree-control/state`))).activePauseHold).toBeNull();
      await page.reload();
      await expect(page.getByTestId("task-chat-system-notice").filter({ hasText: "Task paused — runtime unavailable" }).last()).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);

    } finally {
      await request.patch(`/api/companies/${company.id}`, { data: { status: "archived" } });
      await request.patch("/api/instance/settings/experimental", { data: { enableClassicTaskInterface: originalSettings.enableClassicTaskInterface } });
      await rm(root, { recursive: true, force: true });
    }
  });
}
