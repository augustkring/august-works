import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { analyticalPurpose } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { json } from "./agent-chat.shared";
test.setTimeout(120000);
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
// Actual local-trusted API and shipped operator UI. Explicit deterministic native
// fixtures qualify owner integration; no provider/Human/pilot trial is claimed.
for (const mode of ["joint", "initiative"] as const) test(`a native operator separately reviews real ${mode} planning before canonical changes`, async ({ page, request }, info) => {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { analytical_lineage_v8: true, business_metrics_v8: true, strategy_execution_v8: true, adaptive_planning_v8: true, planning_optimizer_v8: true, enableFoundationV1: true, project_roadmap_v5: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const company = await json(await request.post("/api/companies", { data: { name: "Native joint planning browser fixture" } }));
    const goal = await json(await request.post(`/api/companies/${company.id}/goals`, { data: { title: "Current native portfolio software Goal", level: "company", status: "active" } }));
    const projectRows = [];
    for (const name of ["First native project", "Second native project"]) projectRows.push(await json(await request.post(`/api/companies/${company.id}/projects`, { data: { name, goalIds: [goal.id] } })));
    await json(await request.post(`/api/companies/${company.id}/budgets/policies`, { data: { scopeType: "company", scopeId: company.id, windowKind: "lifetime", amount: 60 } }));
    const first = await json(await request.post(`/api/companies/${company.id}/issues`, { data: { projectId: projectRows[0].id, title: "Prepare native evidence", status: "todo" } }));
    const second = await json(await request.post(`/api/companies/${company.id}/issues`, { data: { projectId: projectRows[1].id, title: "Review dependent evidence", status: "todo", blockedByIssueIds: [first.id] } }));
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["planning"];
    const obligation = await json(await request.post(`/api/companies/${company.id}/governance-obligations`, { data: policy }));
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/${company.issuePrefix}/adaptive-planning`);
    const choices = page.getByRole("region", { name: "Native joint planning project choices", exact: true });
    for (const project of projectRows) await choices.getByRole("checkbox", { name: project.name, exact: true }).check();
    await page.getByRole("button", { name: "Declare shared project constraints", exact: true }).click();
    const form = page.getByRole("form", { name: "Declared project planning assumptions", exact: true });
    for (const [project, task] of [[projectRows[0], first], [projectRows[1], second]]) {
      const title = `${project.name} · ${task.title}`;
      await form.getByRole("spinbutton", { name: `Duration for ${title}`, exact: true }).fill("2");
      await form.getByRole("spinbutton", { name: `Demand for ${title}`, exact: true }).fill("240");
      await form.getByRole("textbox", { name: `Declaration rationale for ${title}`, exact: true }).fill("Human explicitly maintains native joint capacity and duration assumptions");
    }
    await form.getByRole("spinbutton", { name: "Available minutes per day (empty = unknown)", exact: true }).fill("480");
    await form.getByRole("spinbutton", { name: "Already committed minutes per day (empty = unknown)", exact: true }).fill("0");
    await form.getByRole("combobox", { name: "Approved planning purpose", exact: true }).selectOption(obligation.id);
    const endpoint = `/api/companies/${company.id}/adaptive-planning`;
    const inspected = page.waitForResponse(r => r.url().includes(`${endpoint}/preview`) && r.request().method() === "POST");
    await form.getByRole("button", { name: "Inspect constraints and proposed schedule", exact: true }).click();
    const preview = await json(await inspected); expect(preview.result.status).toBe("feasible_best_known");
    const schedule = new Map(preview.result.schedule.map((item: { taskKey: string; startDay: number; endDay: number }) => [item.taskKey, item]));
    expect((schedule.get(first.id) as { endDay: number }).endDay).toBeLessThanOrEqual((schedule.get(second.id) as { startDay: number }).startDay);
    const priorities = page.getByRole("region", { name: "Declared initiative prioritization", exact: true });
    for (const [index, project] of projectRows.entries()) {
      await priorities.getByRole("spinbutton", { name: `Strategic alignment for ${project.name}`, exact: true }).fill(String(10 - index));
      await priorities.getByRole("spinbutton", { name: `Estimated billed runtime cost in cents for ${project.name}`, exact: true }).fill("40");
      await priorities.getByRole("textbox", { name: `Initiative rationale for ${project.name}`, exact: true }).fill("Human explicitly declares initiative priorities and uncertain billed runtime costs");
    }
    await priorities.getByRole("combobox", { name: "Initiative company priority ordering", exact: true }).selectOption("strategic_alignment");
    await priorities.getByRole("spinbutton", { name: "Minimum initiative strategic alignment", exact: true }).fill("5");
    const prioritized = page.waitForResponse(r => r.url().includes(`${endpoint}/initiatives/preview`) && r.request().method() === "POST");
    await priorities.getByRole("button", { name: "Inspect initiative priorities", exact: true }).click();
    const initiativePreview = await json(await prioritized);
    expect(initiativePreview.currentSources.projects.every((project: { activeGoalIds: string[] }) => project.activeGoalIds.includes(goal.id))).toBe(true);
    expect(initiativePreview.currentSources.budgets[0].remainingCents).toBe(60);
    expect(initiativePreview.result.selectedProjectIds).toEqual([projectRows[0].id]);
    expect(initiativePreview.result.candidates.find((candidate: { projectId: string }) => candidate.projectId === projectRows[1].id)).toMatchObject({ disposition: "investigate", reasons: ["native_hard_budget_bound"] });
    const priorityResult = priorities.getByLabel("Advisory initiative priority result", { exact: true });
    await expect(priorityResult).toContainText("First native project · start");
    await expect(priorityResult).toContainText("Second native project · investigate");
    await page.addScriptTag({ path: axePath });
    for (const theme of ["light", "dark"]) for (const width of [390, 1200]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe(theme);
      // Qualify the settled native theme, after its finite CSS color
      // transitions; an intermediate light-to-dark frame is not a theme state.
      await page.evaluate(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await Promise.all(document.getAnimations().filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))).map(animation => animation.finished.catch(() => undefined)));
      });
      const violations = await page.evaluate(async () => {
        const w = window as unknown as { axe: { run: (context: string, options: unknown) => Promise<{ violations: unknown[] }> } };
        return (await w.axe.run('[aria-label="Declared initiative prioritization"]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations;
      });
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await priorityResult.screenshot({ path: info.outputPath(`native-initiative-priority-${theme}-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: "light" });
    for (const project of projectRows) expect((await json(await request.get(`/api/projects/${project.id}`))).status).toBe("backlog");
    for (const task of [first, second]) expect((await json(await request.get(`/api/issues/${task.id}`))).plannedStartAt).toBeNull();
    if (mode === "initiative") {
      await priorities.getByRole("textbox", { name: "Initiative proposal reason", exact: true }).fill("Human proposes these exact initiative priorities and constraints for separate review");
      const proposed = page.waitForResponse(r => r.url().includes(`${endpoint}/initiatives/proposals`) && r.request().method() === "POST");
      await priorities.getByRole("button", { name: "Create initiative proposal", exact: true }).click();
      const proposal = await json(await proposed);
      expect(proposal.status).toBe("proposed"); expect(proposal.appliedProjectRefs).toEqual([]);
      for (const project of projectRows) expect((await json(await request.get(`/api/projects/${project.id}`))).status).toBe("backlog");
      const controls = page.getByRole("region", { name: "Native initiative proposal controls", exact: true });
      // Reopen from metadata after a full page load: current native names and
      // the immutable assumptions must be read through their original owners.
      await page.reload();
      await controls.getByRole("combobox", { name: "Initiative proposal reference", exact: true }).selectOption(proposal.id);
      await expect(controls.getByLabel("Advisory initiative priority result", { exact: true })).toContainText("First native project · start");
      await controls.getByText("Declared initiative assumptions", { exact: true }).click();
      await expect(controls).toContainText("strategic alignment (maximize)");
      await expect(controls).toContainText("Estimated billed runtime cost: 40 cents");
      await page.addScriptTag({ path: axePath });
      for (const theme of ["light", "dark"] as const) for (const width of [390, 1200]) {
        await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: theme });
        await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe(theme);
        await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); await Promise.all(document.getAnimations().filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))).map(animation => animation.finished.catch(() => undefined))); });
        const violations = await page.evaluate(async () => { const w = window as unknown as { axe: { run: (context: string, options: unknown) => Promise<{ violations: unknown[] }> } }; return (await w.axe.run('[aria-label="Native initiative proposal controls"]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations; });
        expect(violations).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await page.screenshot({ path: info.outputPath(`native-initiative-review-${theme}-${width}.png`), fullPage: true });
      }
      const section = controls.getByRole("region", { name: "Separate Human initiative review", exact: true });
      await section.getByRole("textbox", { name: "Initiative review rationale", exact: true }).fill("Human independently reviews these exact initiative costs, Source and capacity assumptions");
      await expect(section.getByRole("button", { name: "Begin separate initiative review", exact: true })).toBeDisabled();
      await section.getByRole("checkbox").check();
      const begun = page.waitForResponse(r => r.url().includes(`${endpoint}/initiatives/proposals/${proposal.id}/review`) && r.request().method() === "POST");
      await section.getByRole("button", { name: "Begin separate initiative review", exact: true }).click();
      expect(await json(await begun)).toMatchObject({ status: "under_review", revision: 2 });
      await controls.getByRole("combobox", { name: "Initiative proposal reference", exact: true }).selectOption(proposal.id);
      await section.getByRole("textbox", { name: "Initiative review rationale", exact: true }).fill("Human explicitly approves these exact project changes after independent Source review");
      const approve = section.getByRole("button", { name: "Approve initiative project changes", exact: true }); await expect(approve).toBeDisabled();
      await section.getByRole("checkbox").check();
      const accepted = page.waitForResponse(r => r.url().includes(`${endpoint}/initiatives/proposals/${proposal.id}/review`) && r.request().method() === "POST");
      await approve.click();
      const result = await json(await accepted); expect(result).toMatchObject({ status: "accepted", revision: 3 }); expect(result.appliedProjectRefs).toMatchObject([{ projectId: projectRows[0].id, disposition: "start", status: "in_progress", paused: false }]);
      expect((await json(await request.get(`/api/projects/${projectRows[0].id}`))).status).toBe("in_progress");
      expect((await json(await request.get(`/api/projects/${projectRows[1].id}`))).status).toBe("backlog");
      for (const task of [first, second]) { const actual = await json(await request.get(`/api/issues/${task.id}`)); expect(actual.status).toBe("todo"); expect(actual.plannedStartAt).toBeNull(); expect(actual.plannedEndAt).toBeNull(); }
      for (const project of projectRows) expect((await json(await request.get(`/api/companies/${company.id}/projects/${project.id}/roadmap`))).proposals).toEqual([]);
      return;
    }
    await page.getByRole("textbox", { name: "Joint planning proposal reason", exact: true }).fill("Human proposes these exact complete joint assumptions for separate native review");
    const proposed = page.waitForResponse(r => r.url().includes(`${endpoint}/proposals`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Create joint planning proposal", exact: true }).click(); const proposal = await json(await proposed);
    for (const task of [first, second]) expect((await json(await request.get(`/api/issues/${task.id}`))).plannedStartAt).toBeNull();
    await page.getByRole("combobox", { name: "Joint proposal reference", exact: true }).selectOption(proposal.id);
    await page.getByRole("textbox", { name: "Joint planning review rationale", exact: true }).fill("Human independently reviews this exact complete Source and proposed joint dates");
    const reviewSection = page.getByRole("region", { name: "Separate Human joint review", exact: true });
    await reviewSection.getByRole("checkbox").check();
    const begun = page.waitForResponse(r => r.url().includes(`${endpoint}/proposals/${proposal.id}/review`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Begin separate joint review", exact: true }).click(); expect(await json(await begun)).toMatchObject({ status: "under_review", revision: 2 });
    await page.getByRole("combobox", { name: "Joint proposal reference", exact: true }).selectOption(proposal.id);
    await page.getByRole("textbox", { name: "Joint planning review rationale", exact: true }).fill("Human explicitly approves the exact joint native commitments after separate review");
    const approve = page.getByRole("button", { name: "Approve joint committed dates", exact: true }); await expect(approve).toBeDisabled(); await reviewSection.getByRole("checkbox").check();
    await page.screenshot({ path: info.outputPath("native-joint-planning-mobile-review.png"), fullPage: true });
    const accepted = page.waitForResponse(r => r.url().includes(`${endpoint}/proposals/${proposal.id}/review`) && r.request().method() === "POST");
    await approve.click(); const result = await json(await accepted); expect(result).toMatchObject({ status: "accepted", revision: 3 }); expect(result.appliedRoadmapRefs).toHaveLength(2);
    for (const ref of result.appliedRoadmapRefs) { const roadmap = await json(await request.get(`/api/companies/${company.id}/projects/${ref.projectId}/roadmap`)); expect(roadmap.proposals.find((item: { id: string }) => item.id === ref.proposalId).status).toBe("accepted"); }
    const firstTask = await json(await request.get(`/api/issues/${first.id}`)), secondTask = await json(await request.get(`/api/issues/${second.id}`));
    expect(Date.parse(firstTask.plannedEndAt)).toBeLessThanOrEqual(Date.parse(secondTask.plannedStartAt));
    expect(firstTask.status).toBe("todo"); expect(secondTask.status).toBe("todo");
  } finally { await json(await request.patch("/api/instance/settings/experimental", { data: original })); }
});
