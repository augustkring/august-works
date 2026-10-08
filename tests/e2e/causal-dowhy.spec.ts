import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { ISSUE_STATUSES } from "../../packages/shared/src/index.ts";
import { analyticalPurpose, metricDefinition } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { experimentDefinition } from "../../server/src/__tests__/helpers/business-experiment-fixture.ts";
import { json } from "./agent-chat.shared";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
test.setTimeout(120000);
// Actual native API and shipped UI, with an explicit tiny software Source frame.
// This records a provider-pinned proposal; no qualified causal trial is claimed.
test("a native operator pins DoWhy to a human model without reviewing or running it", async ({ page, request }, info) => {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { analytical_lineage_v8: true, business_metrics_v8: true, business_experiments_v8: true, causal_claims_v8: true, causal_provider_dowhy_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const company = await json(await request.post("/api/companies", { data: { name: "Native DoWhy proposal software fixture" } }));
    const task = await json(await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Independent unchanged native Task", status: "todo" } }));
    const purpose = analyticalPurpose(); purpose.analyticalPurpose!.capabilities = ["metrics", "experiment", "causal"];
    const policy = await json(await request.post(`/api/companies/${company.id}/governance-obligations`, { data: purpose }));
    const metrics = [];
    for (const status of ["done", "cancelled", "in_progress"]) {
      const definition = { ...metricDefinition(policy.id), calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: [status], projectId: null }, denominator: { entity: "issue", statuses: [...ISSUE_STATUSES], projectId: null } } };
      const metric = await json(await request.post(`/api/companies/${company.id}/business-metrics`, { data: { key: `native_${status}`, definition } }));
      await json(await request.post(`/api/companies/${company.id}/business-metrics/${metric.metric.id}/publish`, { data: { expectedRevision: 1, versionId: metric.version.id } })); metrics.push({ id: metric.metric.id, versionId: metric.version.id });
    }
    const definition = experimentDefinition(policy.id, metrics);
    definition.sampleOrDurationPlan.from = new Date(Date.now() + 2000).toISOString(); definition.sampleOrDurationPlan.until = new Date(Date.parse(definition.sampleOrDurationPlan.from) + 12000).toISOString(); definition.sampleOrDurationPlan.minimumAssignedUnits = 4;
    const experiment = await json(await request.post(`/api/companies/${company.id}/experiments`, { data: { key: "native_proposal_source", definition } })), base = `/api/companies/${company.id}/experiments/${experiment.experiment.id}`;
    for (const [revision, state] of [[1, "in_review"], [2, "ready"]] as const) await json(await request.post(`${base}/transition`, { data: { expectedRevision: revision, versionId: experiment.version.id, state, rationale: "Explicit synthetic native Source fixture, not a collected business trial" } }));
    await json(await request.post(`${base}/start`, { data: { expectedRevision: 3, versionId: experiment.version.id, mode: "recording_only_human_attested_native_process", rationale: "Explicit software recording prerequisite; no intervention delivery claimed" } }));
    const wait = Date.parse(definition.sampleOrDurationPlan.from) - Date.now() + 20; if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    for (let index = 0; index < 4; index++) {
      const unit = await json(await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Synthetic registered Source unit", status: "todo" } }));
      const allocation = await json(await request.post(`${base}/assignments`, { data: { expectedRevision: 4, versionId: experiment.version.id, unitId: unit.id } }));
      await json(await request.post(`${base}/exposures`, { data: { expectedRevision: 4, versionId: experiment.version.id, assignmentId: allocation.id, exposure: { status: "not_applied", rationale: "Software fixture records no delivered intervention or observed business impact" } } }));
    }
    const left = Date.parse(definition.sampleOrDurationPlan.until) - Date.now() + 20; if (left > 0) await new Promise(resolve => setTimeout(resolve, left));
    await json(await request.post(`${base}/stop`, { data: { expectedRevision: 4, versionId: experiment.version.id, state: "completed", rationale: "Explicit fixed software horizon is complete", completion: { reason: "fixed_horizon", concurrentChangeReview: { assessment: "none_identified", rationale: "Explicit synthetic software prerequisite, no collected operational assessment" } } } }));
    const analysis = await json(await request.post(`${base}/analyze`, { data: { expectedRevision: 5, versionId: experiment.version.id } }));
    await json(await request.post(`${base}/interpret`, { data: { expectedRevision: 6, versionId: experiment.version.id, analysisId: analysis.analysis.id, conclusion: analysis.analysis.result.status === "invalid" ? "abstain" : "iterate", rationale: "Tiny software Source frame withholds any supported causal conclusion", limitationsAcknowledged: true, executionAuthority: "advisory_only" } }));
    const endpoint = `/api/companies/${company.id}/causal-claims`, profile = await json(await request.get(`${endpoint}/provider-profile`));
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/${company.issuePrefix}/causal-claims`); await page.getByRole("button", { name: "Record a causal question", exact: true }).click();
    const form = page.getByRole("form", { name: "Human causal model proposal" });
    for (const [label, value] of [["Claim key", "native_dowhy_question"], ["Claim name", "Conditional native review question"], ["Causal question", "Should this registered native proxy inform a separately reviewed human question?"], ["Human hypothesis", "Explicit synthetic software proposal; it does not establish causal benefit"], ["Arrow 1 human rationale", "Human declares the fixed assignment-to-outcome hypothesis for review"], ["Assumption 1 rationale", "Interference remains unknown in this synthetic software Source frame"], ["Assumption 2 rationale", "Measurement remains a declared native proxy requiring human review"], ["Assumption 3 rationale", "Population validity remains unknown outside this software Source frame"]]) await form.getByRole("textbox", { name: label, exact: true }).fill(value);
    await form.getByRole("combobox", { name: "Source experiment", exact: true }).selectOption(experiment.experiment.id); await form.getByRole("button", { name: "Pin exact interpreted analysis", exact: true }).click();
    await form.getByRole("combobox", { name: "Approved causal purpose", exact: true }).selectOption(policy.id); await form.getByRole("combobox", { name: "Analysis provider", exact: true }).selectOption("dowhy"); await expect(form.getByRole("button", { name: "Save human causal model", exact: true })).toBeEnabled();
    await page.addScriptTag({ path: axePath });
    for (const theme of ["light", "dark"] as const) for (const width of [390, 1200]) {
      await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: theme }); await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe(theme);
      await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); await Promise.all(document.getAnimations().filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))).map(animation => animation.finished.catch(() => undefined))); });
      const violations = await page.evaluate(async () => { const w = window as unknown as { axe: { run: (context: string, options: unknown) => Promise<{ violations: unknown[] }> } }; return (await w.axe.run('form[aria-label="Human causal model proposal"]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations; }); expect(violations).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const cancel = await form.getByRole("button", { name: "Cancel model proposal", exact: true }).boundingBox(), save = await form.getByRole("button", { name: "Save human causal model", exact: true }).boundingBox(); expect(cancel).not.toBeNull(); expect(save).not.toBeNull(); expect(Math.abs(cancel!.y - save!.y)).toBeLessThanOrEqual(1); expect(cancel!.x).toBeLessThan(save!.x); await page.screenshot({ path: info.outputPath(`native-dowhy-proposal-${theme}-${width}.png`), fullPage: true });
    }
    const saved = page.waitForResponse(response => response.url().includes(endpoint) && response.request().method() === "POST"); await form.getByRole("button", { name: "Save human causal model", exact: true }).click(); const proposal = await json(await saved);
    expect(proposal.claim).toMatchObject({ status: "hypothesis", revision: 1, reviewedVersionId: null, latestRunId: null }); expect(proposal.version.definition).toMatchObject({ providerProfile: profile, experimentEvidence: { id: analysis.analysis.id }, assumptions: { noInterference: { status: "unknown" } } });
    const detail = await json(await request.get(`${endpoint}/${proposal.claim.id}`)); expect(detail.versions[0].review).toBeNull(); expect(detail.versions[0].run).toBeNull(); expect(await json(await request.get(`/api/issues/${task.id}`))).toMatchObject({ status: "todo", plannedStartAt: null, plannedEndAt: null });
  } finally { await json(await request.patch("/api/instance/settings/experimental", { data: original })); }
});
