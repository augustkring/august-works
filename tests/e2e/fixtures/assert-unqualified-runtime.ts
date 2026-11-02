import { expect, type APIRequestContext, type Page } from "@playwright/test";

type UnavailableRun = { id: string; status: string; errorCode: string | null;
  processPid: number | null; processStartedAt: string | null;
  resultJson: { configurationIncomplete?: { reason?: string; owner?: string; actionUrl?: string } } | null };

/** Real server admission and built UI; no provider/authority response mocks. */
export async function assertUnqualifiedRuntime(input: { request: APIRequestContext; page: Page;
  companyId: string; agentId: string; excludedRunIds?: string[] }) {
  let attempts: UnavailableRun[] = [];
  await expect.poll(async () => {
    const response = await input.request.get(`/api/companies/${input.companyId}/heartbeat-runs?agentId=${input.agentId}`);
    expect(response.ok()).toBe(true);
    const runs: UnavailableRun[] = await response.json();
    attempts = runs.filter(run => !input.excludedRunIds?.includes(run.id));
    return attempts.length === 1 && attempts[0]?.status === "failed" ? attempts[0].errorCode : null;
  }, { timeout: 30_000 }).toBe("configuration_incomplete");
  const listed = attempts[0];
  if (!listed) throw new Error("Expected the original unavailable runtime attempt");
  // List projections intentionally omit resultJson; use the existing scoped
  // detail owner for the current structured admission reason.
  const detail = await input.request.get(`/api/heartbeat-runs/${listed.id}`);
  expect(detail.ok()).toBe(true);
  const run: UnavailableRun = await detail.json();
  expect(run.resultJson?.configurationIncomplete).toMatchObject({ reason: "paid_transport_unqualified",
    owner: "Managed model gateway owner", actionUrl: `/agents/${input.agentId}/runtime` });
  expect(run.processPid).toBeNull();
  expect(run.processStartedAt).toBeNull();
  const notice = input.page.getByTestId("task-chat-system-notice")
    .filter({ hasText: "Task paused — runtime unavailable" }).last();
  await expect(notice).toBeVisible({ timeout: 30_000 });
  const expand = notice.getByRole("button", { name: /Task paused — runtime unavailable/ });
  if (await expand.getAttribute("aria-expanded") !== "true") await expand.click();
  await expect(notice.getByRole("link", { name: "Runtime settings", exact: true }))
    .toHaveAttribute("href", new RegExp(`/agents/${input.agentId}/runtime$`));
  await expect(input.page.getByText("Answered the pending follow-up once.", { exact: false })).toHaveCount(0);
  await expect(input.page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  return run;
}
