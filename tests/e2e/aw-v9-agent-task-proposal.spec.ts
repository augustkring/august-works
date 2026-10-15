import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { createDb, closeRegisteredClients, agents, heartbeatRuns } from "../../packages/db/src/index.ts";
import { V5_FEATURE_KEYS } from "../../packages/shared/src/index.ts";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// The historical Native run is explicitly seeded software metadata in the
// disposable local_trusted host. No provider execution or genuine Human study
// is asserted. The UI, proposal API, Human verdict and Task receipt are real.
test("Human reviews one separate Native backlog proposal before creating it", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable reviewed task host" } }));
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const port = Number(pid.split("\n")[3]);
  expect(Number.isInteger(port) && port > 0 && port < 65536).toBe(true);
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  const db = createDb(databaseUrl);
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true, enableContextEngineV1: true,
      enableWorkflowsV1: true, readiness_engine_v7: true, orchestration_v7: true,
      experience_projection_v9: true, progressive_shell_v9: true, enableConferenceRoomChat: true,
    } }));
    const source = await json(await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Review the internal draft", status: "todo" } }));
    const agentId = randomUUID(), runId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId: company.id, name: "Historical software proposer",
      adapterType: "paperclip_runner", status: "paused", pauseReason: "manual", budgetMonthlyCents: 0 });
    await db.insert(heartbeatRuns).values({ id: runId, companyId: company.id, agentId, status: "succeeded", finishedAt: new Date(),
      runtimeMode: "native", nativeIssueId: source.id, invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId: source.id } });
    const proposal = await json(await request.post(`/api/issues/${source.id}/interactions`, { data: {
      kind: "suggest_tasks", resolverPolicy: "human_only", continuationPolicy: "none", sourceRunId: runId,
      title: "Review one internal backlog task", summary: "Create one separate, unassigned internal task?",
      payload: { version: 1, tasks: [{ clientKey: "proposed-task", title: "Compare approved internal facts",
        description: "Only the original internal scope", status: "backlog", placement: "company_backlog" }] },
    } }));
    const before = await json(await request.get(`/api/companies/${company.id}/issues`));
    expect(before.filter((task: { originRunId: string }) => task.originRunId === runId)).toHaveLength(0);
    await page.goto(`/${company.issuePrefix}/issues/${source.identifier}`);
    const main = page.getByRole("main");
    await expect(main.getByText("Compare approved internal facts", { exact: true })).toBeVisible();
    await expect(main.getByText("Separate task linked from the original Task; no assignee or automatic start.", { exact: true })).toBeVisible();
    const accept = main.getByRole("button", { name: /^(Create task|Opret opgave)$/ }).first();
    await expect(accept).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByText("Separat opgave med sporbarhed til den oprindelige opgave; ingen tildeling eller automatisk start.", { exact: true })).toBeVisible();
    await expect(main.getByText("Gennemgå opgaveforslag", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath });
    const accessibility = await page.evaluate(async () => (window as any).axe.run(document.querySelector("main"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }));
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("reviewed-backlog-proposal-mobile-da.png"), fullPage: true });
    await accept.focus();
    await expect(accept).toBeFocused();
    await accept.press("Enter");
    await expect.poll(async () => (await json(await request.get(`/api/issues/${source.id}/interactions`))).find((card: { id: string }) => card.id === proposal.id)?.status).toBe("accepted");
    const resolved = (await json(await request.get(`/api/issues/${source.id}/interactions`))).find((card: { id: string }) => card.id === proposal.id);
    const task = await json(await request.get(`/api/issues/${resolved.result.createdTasks[0].issueId}`));
    expect(task).toMatchObject({ companyId: company.id, parentId: null, status: "backlog", assigneeAgentId: null,
      assigneeUserId: null, originRunId: runId, originId: `paperclip-suggested-task:${proposal.id}` });
    expect((await request.post(`/api/issues/${source.id}/interactions/${proposal.id}/accept`, { data: {} })).status()).toBe(409);
    expect((await json(await request.get(`/api/companies/${company.id}/issues`))).filter((task: { originRunId: string }) => task.originRunId === runId)).toHaveLength(1);
  } finally {
    await page.goto("about:blank");
    await request.patch("/api/instance/settings/experimental", { data: flags });
    await request.delete(`/api/companies/${company.id}`);
    await closeRegisteredClients(databaseUrl);
  }
});
