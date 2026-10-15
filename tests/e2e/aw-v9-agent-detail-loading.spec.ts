import { expect, test, type APIResponse } from "@playwright/test";
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Actual Native idle agent and shipped chunks. No provider/model dispatch,
// business verification, production latency or Human qualification is claimed.
test("Native agent detail code loads on its direct route and reload without starting work", async ({ page, request }) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable deferred detail fixture" } }));
  const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
    name: "Idle detail loading fixture", role: "engineer", adapterType: "process", adapterConfig: {},
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
  } }));
  const paths: string[] = [];
  page.on("request", request => paths.push(new URL(request.url()).pathname));
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(page.getByRole("main")).toBeVisible({ timeout: 15000 });
    expect(paths.filter(path => /\/AgentDetail-[^/]+\.js$/.test(path))).toEqual([]);
    await page.goto(`/${company.issuePrefix}/agents/${agent.id}`);
    await expect(page.getByRole("heading", { level: 1, name: agent.name, exact: true })).toBeVisible();
    expect(paths.some(path => /\/AgentDetail-[^/]+\.js$/.test(path))).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: agent.name, exact: true })).toBeVisible();
    const current = await json(await request.get(`/api/agents/${agent.id}`));
    expect(current.status).toBe(agent.status);
    expect(await json(await request.get(`/api/companies/${company.id}/issues`))).toEqual([]);
    const runs = await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`));
    expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
  } finally {
    await page.goto("about:blank");
    // This company belongs to the disposable instance. Physical tenant erasure
    // requires its Native lifecycle and is not asserted by this loading test.
  }
});
