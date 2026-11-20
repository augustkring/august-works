import { expect, type APIRequestContext, type Page } from "@playwright/test";

type UnavailableRun = { id: string; companyId: string; agentId: string; issueId: string | null;
  status: string; errorCode: string | null;
  processPid: number | null; processStartedAt: string | null;
  resultJson: { configurationIncomplete?: { reason?: string; owner?: string; actionUrl?: string } } | null };

type UnavailableNotice = { id: string; companyId: string; issueId: string; authorType: string;
  metadata: { sourceRunId?: string | null } | null;
  presentation: { title?: string | null } | null };

async function describeNoticeState(input: { request: APIRequestContext; companyId: string }, run: UnavailableRun) {
  const read = async (url: string): Promise<unknown> => {
    const response = await input.request.get(url).catch(() => null);
    return response?.ok() ? response.json() : `unavailable (${response?.status() ?? "no response"})`;
  };
  const issue = await read(`/api/issues/${run.issueId}`) as { status?: string } | string;
  const comments = await read(`/api/issues/${run.issueId}/comments`);
  const runs = await read(`/api/companies/${input.companyId}/heartbeat-runs`);
  return JSON.stringify({
    issueStatus: typeof issue === "string" ? issue : issue.status ?? null,
    systemNotices: Array.isArray(comments)
      ? (comments as UnavailableNotice[]).filter(comment => comment.authorType === "system")
        .map(comment => ({ sourceRunId: comment.metadata?.sourceRunId ?? null, title: comment.presentation?.title ?? null }))
      : comments,
    taskRuns: Array.isArray(runs)
      ? (runs as UnavailableRun[]).filter(item => item.issueId === run.issueId || item.id === run.id)
        .map(item => ({ id: item.id, agentId: item.agentId, status: item.status, errorCode: item.errorCode }))
      : runs,
  });
}

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
  expect(run).toMatchObject({ id: listed.id, companyId: input.companyId, agentId: input.agentId,
    status: "failed", errorCode: "configuration_incomplete" });
  if (typeof run.issueId !== "string" || !run.issueId) throw new Error("Expected the unavailable Run's retained Task identity");
  expect(run.resultJson?.configurationIncomplete).toMatchObject({ reason: "paid_transport_unqualified",
    owner: "Managed model gateway owner", actionUrl: `/agents/${input.agentId}/runtime` });
  expect(run.processPid).toBeNull();
  expect(run.processStartedAt).toBeNull();
  // Run settlement can precede its retained comment reaching the thread. An
  // earlier, already-expanded notice must not satisfy this new Run's check.
  const noticeDeadlineAt = Date.now() + 30_000;
  const remainingNoticeMs = () => Math.max(1, noticeDeadlineAt - Date.now());
  let noticeCommentId: string | null = null;
  await expect.poll(async () => {
    const response = await input.request.get(`/api/issues/${run.issueId}/comments`);
    expect(response.ok()).toBe(true);
    const comments: UnavailableNotice[] = await response.json();
    const matching = comments.filter(comment => comment.companyId === input.companyId && comment.issueId === run.issueId &&
      comment.authorType === "system" && comment.metadata?.sourceRunId === run.id &&
      comment.presentation?.title === "Configuration incomplete");
    noticeCommentId = matching.length === 1 ? matching[0]!.id : null;
    return matching.length;
  }, { timeout: remainingNoticeMs() }).toBe(1).catch(async (error: unknown) => {
    // Say whether the Run's release blocked the Task and which Runs and
    // notices exist, so a missing notice can be traced to its release path.
    if (error instanceof Error) error.message += `\nTask state: ${await describeNoticeState(input, run)}`;
    throw error;
  });
  if (!noticeCommentId) throw new Error("Expected the exact unavailable Run's retained notice");
  const notice = input.page.locator(`[id="comment-${noticeCommentId}"]`).getByTestId("task-chat-system-notice")
    .filter({ hasText: "Task paused — runtime unavailable" });
  await expect(notice).toBeVisible({ timeout: remainingNoticeMs() });
  const expand = notice.getByRole("button", { name: /Task paused — runtime unavailable/ });
  if (await expand.getAttribute("aria-expanded", { timeout: remainingNoticeMs() }) !== "true")
    await expand.click({ timeout: remainingNoticeMs() });
  await expect(expand).toHaveAttribute("aria-expanded", "true", { timeout: remainingNoticeMs() });
  await expect(notice.getByRole("link", { name: "Runtime settings", exact: true }))
    .toHaveAttribute("href", new RegExp(`/agents/${input.agentId}/runtime$`), { timeout: Math.min(5_000, remainingNoticeMs()) });
  await expect(input.page.getByText("Answered the pending follow-up once.", { exact: false })).toHaveCount(0);
  await expect(input.page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  return run;
}
