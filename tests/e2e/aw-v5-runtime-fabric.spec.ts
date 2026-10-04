import { readFile } from "node:fs/promises";
import { expect, test, type APIResponse } from "@playwright/test";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

const enabled = {
  project_roadmap_v5: true, project_forecast_v5: true, project_plan_vs_actual_v5: true,
  playbooks_v5: true, skill_lifecycle_v5: true,
};

test("calendar edits remain proposals until reviewed and frozen baselines retain the original plan", async ({ page, request }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: `V5 browser plan ${Date.now()}` } }));
  const base = `/api/companies/${company.id}`;
  const project = await json(await request.post(`${base}/projects`, { data: { name: "Reviewed launch" } }));
  const route = `/${company.issuePrefix}/projects/${project.id}/roadmap`, endpoint = `${base}/projects/${project.id}/roadmap`;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { project_roadmap_v5: false } }));
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("This feature is disabled or a required feature is disabled.")).toBeVisible();
    await json(await request.patch("/api/instance/settings/experimental", { data: enabled }));
    const issue = await json(await request.post(`${base}/issues`, { data: { projectId: project.id, title: "Ship reviewed release", status: "todo" } }));
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 4);
    const initial = await json(await request.get(endpoint));
    const proposal = await json(await request.post(`${endpoint}/proposals`, { data: {
      expectedProjectUpdatedAt: initial.projectUpdatedAt, reason: "Commit the initial release plan after independent human review",
      changes: [{ issueId: issue.id, expectedUpdatedAt: issue.updatedAt, patch: { plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString() } }],
    } }));
    await json(await request.post(`${endpoint}/proposals/${proposal.id}/review`, { data: { accept: true, rationale: "Operator reviewed the initial schedule" } }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Reviewed launch Roadmap", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^plan: Ship reviewed release;/ })).toBeVisible();
    await page.getByText("Health observations and source tasks", { exact: true }).click();
    await expect(page.getByText("Open blockers: 0", { exact: true })).toBeVisible();
    await expect(page.getByText("Project budget utilization", { exact: true })).toBeVisible();
    for (const scale of ["day", "week", "month", "quarter"]) {
      await page.getByRole("combobox", { name: "Calendar scale", exact: true }).selectOption(scale);
      await expect(page.getByRole("button", { name: /^plan: Ship reviewed release;/ })).toBeVisible();
    }
    await page.getByLabel("Named baseline", { exact: true }).fill("Reviewed initial commitment");
    await page.getByRole("button", { name: "Freeze current plan", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Named baseline frozen" })).toBeVisible();
    const frozen = (await json(await request.get(endpoint))).baselines[0];
    await page.getByRole("combobox", { name: "Compare baseline", exact: true }).selectOption(frozen.id);
    const planned = page.getByRole("button", { name: /^plan: Ship reviewed release;/ });
    await planned.focus(); await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("status").filter({ hasText: "Plan proposal created" })).toBeVisible();
    const pending = await json(await request.get(endpoint));
    expect(pending.tasks.find((row: { id: string }) => row.id === issue.id).plannedEndAt).toBe(end.toISOString());
    expect(pending.proposals.some((row: { status: string }) => row.status === "pending")).toBe(true);
    await page.getByLabel("Human review rationale", { exact: true }).fill("Reviewed the one day move and accepted the new commitment");
    await page.getByRole("button", { name: "Approve committed change", exact: true }).click();
    const shifted = new Date(end); shifted.setUTCDate(shifted.getUTCDate() + 1);
    await expect.poll(async () => (await json(await request.get(endpoint))).tasks.find((row: { id: string }) => row.id === issue.id).plannedEndAt).toBe(shifted.toISOString());
    const after = await json(await request.get(endpoint));
    expect(after.baselines.find((row: { id: string }) => row.id === frozen.id).snapshot).toEqual(frozen.snapshot);
    expect(after.tasks[0].completedAt).toBeNull();
    expect(after.tasks[0].forecastEndAt).toBeNull();
    const accessible = page.getByText("Accessible task table and plan versus actual", { exact: true });
    await accessible.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Unknown", exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export accessible plan", exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported.sourceCompanyId).toBe(company.id);
    expect(exported.projectId).toBe(project.id);
    expect(exported.tasks).toHaveLength(1);
    await page.screenshot({ path: "test-results/aw-v5-reviewed-roadmap.png", fullPage: true });
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(enabled).map((key) => [key, flags[key]])) }).catch(() => {});
  }
});

test("Playbook drafts preserve approved bytes and a new Skill remains a candidate", async ({ page, request }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  await json(await request.patch("/api/instance/settings/experimental", { data: enabled }));
  const company = await json(await request.post("/api/companies", { data: { name: `V5 browser procedures ${Date.now()}` } }));
  const base = `/api/companies/${company.id}`;
  try {
    await page.goto(`/${company.issuePrefix}/playbooks`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New Playbook", exact: true }).click();
    await page.getByLabel("Stable key", { exact: true }).fill("release-procedure");
    await page.getByLabel("Title", { exact: true }).fill("Reviewed release procedure");
    await page.getByRole("textbox", { name: "Procedure in Markdown", exact: true }).fill("# Approved procedure\n\nVerify the release before publication.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reviewed release procedure", exact: true })).toBeVisible();
    await page.getByLabel("Review rationale", { exact: true }).fill("The operator checked the complete procedure and approved it");
    await page.getByRole("button", { name: "Approve latest revision", exact: true }).click();
    const playbooks = await json(await request.get(`${base}/playbooks`));
    const id = playbooks.find((row: { key: string }) => row.key === "release-procedure").id;
    await expect.poll(async () => (await json(await request.get(`${base}/playbooks/${id}`))).status).toBe("approved");
    const approved = await json(await request.get(`${base}/playbooks/${id}`));
    await page.getByRole("button", { name: "Edit draft", exact: true }).click();
    await page.getByRole("textbox", { name: "Procedure in Markdown", exact: true }).fill("# Unapproved procedure\n\nChanged instructions awaiting review.");
    await page.getByLabel("Change summary", { exact: true }).fill("Add changes requiring another human review");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(async () => (await json(await request.get(`${base}/playbooks/${id}`))).document.latestRevisionId).not.toBe(approved.approvedRevisionId);
    const canonical = await request.get(`${base}/playbooks/${id}/export`);
    expect(canonical.ok()).toBe(true);
    expect(await canonical.text()).toContain("Verify the release before publication.");
    expect(await canonical.text()).not.toContain("Changed instructions awaiting review.");
    await page.getByText("Owner, classification and review schedule", { exact: true }).click();
    await page.getByLabel("Category", { exact: true }).fill("release-operations");
    await page.getByLabel("Review interval in days", { exact: true }).fill("30");
    await page.getByLabel("Reason for metadata change", { exact: true }).fill("Assign the release procedure to its reviewed operational category");
    await page.getByRole("button", { name: "Save metadata", exact: true }).click();
    await expect.poll(async () => (await json(await request.get(`${base}/playbooks/${id}`))).reviewFrequencyDays).toBe(30);
    const updatedMetadata = await json(await request.get(`${base}/playbooks/${id}`));
    expect(updatedMetadata).toMatchObject({ category: "release-operations", sensitivity: "internal", approvedRevisionId: approved.approvedRevisionId });

    await page.goto(`/${company.issuePrefix}/skills/studio`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "New governed Skill", exact: true }).click();
    await page.getByLabel("Stable local key", { exact: true }).fill("review-release");
    await page.getByLabel("Name", { exact: true }).fill("Review release candidate");
    await page.getByLabel("Procedure (SKILL.md)", { exact: true }).fill("# Release review\n\nCheck evidence and request human approval.");
    await page.getByLabel("Task trigger phrases, comma separated", { exact: true }).fill("release review");
    await page.getByRole("button", { name: "Create draft for evaluation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review release candidate governance", exact: true })).toBeVisible();
    const skillId = page.url().split("/skills/")[1].split("/")[0];
    const lifecycle = await json(await request.get(`${base}/skills/${skillId}/lifecycle`));
    expect(lifecycle.activeVersionId).toBeNull();
    expect(lifecycle.versions[0]).toMatchObject({ state: "candidate", visibility: "private" });
    await page.getByRole("button", { name: /Revision 1 · candidate · private/ }).click();
    await page.getByRole("button", { name: "Submit private candidate", exact: true }).click();
    await expect.poll(async () => (await json(await request.get(`${base}/skills/${skillId}/lifecycle`))).versions[0].visibility).toBe("company");
    expect((await json(await request.get(`${base}/skills/${skillId}/lifecycle`))).activeVersionId).toBeNull();
    await expect(page.getByRole("button", { name: "Promote selected version", exact: true })).toBeDisabled();
    await page.getByLabel("Suite name", { exact: true }).fill("Release controls v1");
    await page.getByRole("textbox", { name: "A task that should trigger this procedure", exact: true }).fill("Review a release before it is published");
    await page.getByRole("textbox", { name: "An unrelated task that must not trigger it", exact: true }).fill("Describe the weather forecast");
    await page.getByRole("button", { name: "Create required suite", exact: true }).click();
    const evalBase = `${base}/skills/${skillId}/evaluations`;
    await expect.poll(async () => (await json(await request.get(evalBase))).suites.length).toBe(1);
    const initialSuite = (await json(await request.get(evalBase))).suites[0];
    const initialCases = (await json(await request.get(`${evalBase}/suites/${initialSuite.id}`))).cases;
    await page.getByRole("combobox", { name: "Case set change", exact: true }).selectOption(initialSuite.id);
    await page.getByLabel("Suite name", { exact: true }).fill("Release controls v2");
    await page.getByLabel("Reason for replacing the required case set", { exact: true }).fill("Replace the obsolete examples with current reviewed release cases");
    await page.getByRole("textbox", { name: "A task that should trigger this procedure", exact: true }).fill("Review the current release with retained evidence");
    await page.getByRole("button", { name: "Replace required suite", exact: true }).click();
    await expect.poll(async () => (await json(await request.get(evalBase))).suites.filter((suite: { requiredForPromotion: boolean }) => suite.requiredForPromotion).map((suite: { name: string }) => suite.name)).toEqual(["Release controls v2"]);
    expect((await json(await request.get(`${evalBase}/suites/${initialSuite.id}`))).cases).toEqual(initialCases);
    expect((await json(await request.get(`${base}/skills/${skillId}/lifecycle`))).activeVersionId).toBeNull();
    await page.screenshot({ path: "test-results/aw-v5-skill-candidate.png", fullPage: true });
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(enabled).map((key) => [key, flags[key]])) }).catch(() => {});
  }
});
