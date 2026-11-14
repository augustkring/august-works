import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { V5_FEATURE_KEYS, workflowRunExperienceSchema } from "../../packages/shared/src/index.ts";
import { json } from "./agent-chat.shared";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
test.use({ trace: "retain-on-failure" });
// Built customer shell with a deliberately scoped Native-response fixture.
// Native request/run binding, current permissions and gateway effects are
// qualified separately by migrated-PG tests. No provider action is sent here.
for (const locale of ["en", "da"] as const) test(`a customer reviews a pending workflow action in ${locale} without Advanced or replay after a lost reply`, async ({ page, request }) => {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  const session = await json(await request.get("/api/auth/get-session"));
  const currentUserId = session.user.id as string;
  expect(session.session.localImplicit).toBe(false);
  const company = await json(await request.post("/api/companies", { data: { name: `Disposable decision journey ${locale}` } }));
  const runId = randomUUID(), workflowId = randomUUID(), requestId = randomUUID(), approvalId = randomUUID();
  let decisions = 0, checkpointDecisions = 0, checkpointStatus = "pending", failed = false;
  try {
    const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
      name: "Paused decision fixture", adapterType: "process", adapterConfig: { command: "/usr/bin/true" },
      runtimeConfig: { heartbeat: { enabled: false } }, budgetMonthlyCents: 0,
    } }));
    await json(await request.post(`/api/agents/${agent.id}/pause`, { data: {} }));
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true,
      enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true,
    } }));
    const view = workflowRunExperienceSchema.parse({ companyId: company.id, workflowId, id: runId, revisionId: randomUUID(),
      revisionNumber: 1, revisionState: "published", status: "waiting", purpose: "live", updatedAt: new Date().toISOString(),
      canRequestStop: false, stopReceipt: null, trace: { state: "available", attempts: [{ id: randomUUID(), name: "Review exact connected action",
        operation: "Connected action", attempt: 1, status: "waiting", execution: "tool", approvalCheckpoint: false,
        payloadUnavailable: false, branchChoice: { state: "not_applicable" }, waitingFor: ["tool_action"], toolReviewNodeId: "selected-tool" }] } });
    if (view.trace.state !== "available") throw new Error("Trace fixture is unavailable");
    view.trace.attempts.push({ id: randomUUID(), name: "Review exact checkpoint", operation: "Human approval", attempt: 1,
      status: "waiting", execution: "not_recorded", approvalCheckpoint: true, payloadUnavailable: false,
      branchChoice: { state: "not_applicable" }, waitingFor: ["human_interaction"], approvalReview: { id: approvalId, nodeId: "human-checkpoint" } });
    await page.route(`**/api/companies/${company.id}/workflow-runs/${runId}/experience?**`, route => route.fulfill({ json: view }));
    await page.route(`**/api/approvals/${approvalId}**`, async route => {
      const req = route.request(), url = new URL(req.url());
      expect(url.searchParams.get("expectedUserId")).toBe(currentUserId);
      if (req.method() === "POST") { expect(url.pathname.endsWith("/approve")).toBe(true); expect(req.postDataJSON()).toEqual({ expectedReviewHash: "a".repeat(64) }); checkpointDecisions++; checkpointStatus = "approved"; }
      else expect(req.method()).toBe("GET");
      return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { id: approvalId, companyId: company.id,
        type: "workflow_step_approval", status: checkpointStatus, reviewHash: "a".repeat(64), requestedByAgentId: null, requestedByUserId: currentUserId, decisionNote: null,
        decidedByUserId: checkpointStatus === "approved" ? currentUserId : null, decidedAt: null, createdAt: view.updatedAt, updatedAt: view.updatedAt,
        payload: { workflowNodeId: "human-checkpoint", workflowId, workflowRunId: runId, workflowRevisionId: view.revisionId, summary: "PRIVATE exact checkpoint",
          consequence: "Continue this reviewed revision only", privateKey: "SECRET excluded checkpoint payload" } } });
    });
    await page.route(`**/api/companies/${company.id}/workflow-runs/${runId}/tool-reviews**`, async route => {
      const req = route.request(), url = new URL(req.url());
      expect(url.searchParams.get("expectedUserId")).toBe(currentUserId);
      if (req.method() === "POST") {
        expect(url.pathname.endsWith(`/${requestId}/approve`)).toBe(true);
        expect(req.postDataJSON()).toEqual({}); decisions++;
        return route.abort("failed");
      }
      expect(req.method()).toBe("GET");
      return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { canReview: true,
        reviews: [{ id: requestId, nodeId: "selected-tool", toolName: "PRIVATE selected operation", status: "pending", risk: "write",
          preview: "PRIVATE exact consequence", argumentsSummary: null, approvalId: null, expiresAt: null }] } });
    });
    await page.addInitScript(({ locale, theme }) => {
      localStorage.setItem("aw.v9.display-locale", locale); localStorage.setItem("paperclip.theme", theme);
    }, { locale, theme: locale === "da" ? "dark" : "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${company.issuePrefix}/workflows/${workflowId}/runs/${runId}`);
    const checkpoint = page.getByRole("region", { name: locale === "en" ? "Workflow approval review" : "Gennemgang af workflowgodkendelse", exact: true });
    await expect(checkpoint).toContainText("PRIVATE exact checkpoint"); await expect(checkpoint).not.toContainText("SECRET");
    await checkpoint.getByRole("button", { name: locale === "en" ? "Approve step" : "Godkend trin", exact: true }).click();
    await expect(checkpoint).toContainText(locale === "en" ? "Approved; execution is not yet confirmed" : "Godkendt; udførelsen er endnu ikke bekræftet");
    expect(checkpointDecisions).toBe(1);
    const review = page.getByRole("region", { name: locale === "en" ? "Connected action review" : "Gennemgang af tilsluttet handling", exact: true });
    const approve = review.getByRole("button", { name: locale === "en" ? "Approve action" : "Godkend handling", exact: true });
    const reject = review.getByRole("button", { name: locale === "en" ? "Reject action" : "Afvis handling", exact: true });
    await expect(review).toContainText("PRIVATE selected operation");
    expect(new URL(page.url()).pathname.endsWith("/advanced")).toBe(false);
    await approve.focus(); await approve.press("Enter");
    await expect(review.getByRole("alert")).toContainText(locale === "en" ? "Your decision is unconfirmed" : "Din beslutning er ikke bekræftet");
    await expect(approve).toBeDisabled(); await expect(reject).toBeDisabled(); expect(decisions).toBe(1);
    await page.reload();
    await expect(review).toBeVisible(); await expect(approve).toBeDisabled(); await expect(reject).toBeDisabled();
    await review.getByRole("button", { name: locale === "en" ? "Check current status" : "Kontrollér aktuel status", exact: true }).click();
    await expect(approve).toBeDisabled(); expect(decisions).toBe(1); expect(checkpointDecisions).toBe(1);
    const local = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith("aw.v9.workflow-tool-decision:")));
    expect(local).toHaveLength(1); expect(local[0][1]).not.toContain("PRIVATE");
    expect(Object.keys(JSON.parse(local[0][1])).sort()).toEqual(["decision", "expiresAt", "id"]);
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } catch (error) { failed = true; throw error; }
  finally {
    try { await json(await request.patch("/api/instance/settings/experimental", { data: original })); await json(await request.delete(`/api/companies/${company.id}`)); }
    catch (error) { if (!failed) throw error; }
  }
});
