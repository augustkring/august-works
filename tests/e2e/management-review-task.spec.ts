import { expect, test } from "@playwright/test";
import { analyticalPurpose } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { json } from "./agent-chat.shared";

test.setTimeout(120000);
// Actual local-trusted API and shipped UI; deterministic business-object fixture,
// not a performed Human/provider/pilot trial or an intervention-effect claim.
test("a current native operator creates a cited follow-up through the existing Task owner", async ({ page, request }, info) => {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableFoundationV1: true, analytical_lineage_v8: true, business_metrics_v8: true, management_reviews_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const company = await json(await request.post("/api/companies", { data: { name: "Native cited review Task browser fixture" } }));
    const goal = await json(await request.post(`/api/companies/${company.id}/goals`, { data: { title: "Investigate delivery assumptions", level: "company", status: "planned" } }));
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["reviews"];
    const obligation = await json(await request.post(`/api/companies/${company.id}/governance-obligations`, { data: policy }));
    const now = Date.now(), endpoint = `/api/companies/${company.id}/management-reviews`;
    const draft = await json(await request.post(endpoint, { data: { name: "Explicit current native review", reviewType: "weekly_leadership", period: { from: new Date(now - 86400000).toISOString(), until: new Date(now).toISOString() }, purpose: "management_intelligence", sensitivity: "internal", retentionDays: 1, governanceObligationRefs: [obligation.id], sources: [{ key: "goal", source: { kind: "canonical", reference: { type: "goal", id: goal.id } } }], agenda: [{ key: "inspect", category: "INVESTIGATE", ownerUserId: "local-board", dueAt: new Date(now + 86400000).toISOString(), sourceKeys: ["goal"], nextAction: "Human independently investigates the stated delivery assumptions", hypothesis: null }] } }));
    await json(await request.post(`${endpoint}/${draft.id}/publish`, { data: { expectedContentHash: draft.contentHash, rationale: "Human explicitly reviews this exact packet and its declared uncertainty", evidenceAndUncertaintyAcknowledged: true } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${company.issuePrefix}/management-reviews?reviewCompanyId=${company.id}&reviewId=${draft.id}`);
    await page.getByRole("button", { name: "Prepare native follow-up Task", exact: true }).click();
    const form = page.getByRole("form", { name: "Cited native Task follow-up", exact: true });
    await form.getByRole("combobox", { name: "Task original agenda item", exact: true }).selectOption("inspect");
    await form.getByRole("textbox", { name: "Review follow-up Task title", exact: true }).fill("Human investigates delivery uncertainty");
    await form.getByRole("textbox", { name: "Review follow-up Task description", exact: true }).fill("Human requests independent evidence before changing a canonical plan");
    const create = form.getByRole("button", { name: "Create reviewed native Task", exact: true });
    await expect(create).toBeDisabled(); await form.getByRole("checkbox").check();
    await page.screenshot({ path: info.outputPath("native-review-task-mobile.png"), fullPage: true });
    const response = page.waitForResponse(r => r.url().includes(`${endpoint}/${draft.id}/tasks`) && r.request().method() === "POST");
    await create.click(); const result = await json(await response);
    const task = await json(await request.get(`/api/issues/${result.issueId}`));
    expect(task).toMatchObject({ companyId: company.id, title: "Human investigates delivery uncertainty", status: "todo", createdByUserId: "local-board", assigneeAgentId: null });
    expect(task.description).toContain("Human requests independent evidence"); expect(task.description).toContain(draft.id);
    const link = page.getByRole("link", { name: "Open native follow-up Task", exact: true });
    await expect(link).toHaveAttribute("href", `/${company.issuePrefix}/issues/${result.issueId}`);
    const review = await json(await request.get(`${endpoint}/${draft.id}`)); expect(review.events).toHaveLength(0);
    await link.click(); await expect(page.getByText("Human investigates delivery uncertainty", { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues/${task.identifier}$`));
  } finally { await json(await request.patch("/api/instance/settings/experimental", { data: original })); }
});
