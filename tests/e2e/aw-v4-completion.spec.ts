import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIResponse } from "@playwright/test";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

test("reviews an artifact through keyboard controls and exports and erases Memory", async ({ page, request }) => {
  test.setTimeout(120_000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  await json(await request.patch("/api/instance/settings/experimental", { data: {
    enableWorkflowsV1: true, enableWorkflowBuilderV1: true, enableAutomationArtifactsV1: true,
    enableCollectiveMemoryV1: true,
  } }));
  const company = await json(await request.post("/api/companies", { data: { name: `V4 completion ${Date.now()}` } }));
  const base = `/api/companies/${company.id}`;
  try {
    await page.goto(`/${company.issuePrefix}/automation-artifacts`);
    await expect(page.getByRole("heading", { name: "Automation Artifacts", exact: true })).toBeVisible();
    const disclosure = page.getByText("Create candidate", { exact: true }).first();
    await disclosure.focus(); await page.keyboard.press("Enter");
    await expect(page.getByLabel("Artifact definition JSON")).toBeVisible();
    await page.getByRole("button", { name: "Create candidate", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Copy value", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start testing", exact: true }).click();
    await page.getByRole("button", { name: "Run validation and security tests", exact: true }).click();
    await expect(page.getByRole("button", { name: "Activate reviewed version", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Activate reviewed version", exact: true }).click();
    await expect.poll(async () => json(await request.get(`${base}/automation-artifacts`)))
      .toMatchObject([{ name: "Copy value", status: "active" }]);
    await page.screenshot({ path: "test-results/aw-v4-artifact-review.png", fullPage: true });

    const binding = await json(await request.post(`${base}/memory/bindings/company`, { data: {
      key: "v4-test", name: "V4 browser test", providerKey: "local", enabled: true, config: {},
    } }));
    const observedAt = new Date().toISOString();
    const candidate = await json(await request.post(`${base}/memory/candidates`, { data: {
      bindingId: binding.id, memoryType: "fact", scope: { type: "company", id: null }, ownerAgentId: null,
      subject: null, title: "V4 browser privacy record", content: "Deterministic browser fixture content", summary: null,
      sensitivity: "internal", importance: 50, confidenceScore: 0.5, validFrom: null, validUntil: null, observedAt,
      retentionPolicy: "standard", expiresAt: null, createdByOperationId: randomUUID(), metadata: {}, evidence: [{
        sourceClass: "task", sourceProvider: "e2e_fixture", sourceType: "fixture", sourceRef: `fixture://${randomUUID()}`,
        sourceVersion: null, sourceUpdatedAt: null, observedAt, excerptHash: "a".repeat(64),
        citation: { label: "Deterministic browser fixture" }, trustLevel: "medium", relation: "supports",
      }],
    } }));
    const recordId = candidate.record.id;
    await json(await request.post(`${base}/memory/records/${recordId}/accept`, { data: { reason: "Browser acceptance fixture" } }));
    await page.goto(`/${company.issuePrefix}/memory`);
    await expect(page.getByRole("button", { name: "Export shared memory", exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export shared memory", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("memory-export.json");
    const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported.companyId).toBe(company.id);
    expect(exported.records).toMatchObject([{ id: recordId, content: "Deterministic browser fixture content" }]);
    const retention = page.getByText("Retention policy", { exact: true });
    await retention.focus(); await page.keyboard.press("Enter");
    await page.getByLabel("Maximum age in days").fill("90");
    await page.getByRole("button", { name: "Apply retention policy", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Retention policy saved." })).toBeVisible();
    expect(await json(await request.get(`${base}/memory/retention-policy`))).toMatchObject({ maxAgeDays: 90 });
    const maintenance = page.getByText("Memory maintenance", { exact: true });
    await maintenance.focus(); await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: "Operation", exact: true }).selectOption("index_refresh");
    await page.getByLabel("V4 browser privacy record", { exact: true }).check();
    await page.getByRole("button", { name: "Queue maintenance", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Maintenance queued." })).toBeVisible();
    const jobs = await json(await request.get(`${base}/memory/jobs`));
    expect(jobs).toEqual(expect.arrayContaining([expect.objectContaining({ operationType: "index_refresh" })]));
    await expect.poll(async () => json(await request.get(`${base}/memory/jobs`)), { timeout: 45_000 })
      .toEqual(expect.arrayContaining([expect.objectContaining({ operationType: "index_refresh", status: "succeeded", result: expect.objectContaining({ nativeIndexCurrent: true }) })]));
    await page.goto(`/${company.issuePrefix}/memory/${recordId}`);
    await page.getByRole("button", { name: "Forget permanently", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Forget memory permanently" })).toBeVisible();
    await page.getByRole("button", { name: "Delete content permanently", exact: true }).click();
    await expect.poll(async () => (await request.get(`${base}/memory/records/${recordId}`)).status()).toBe(404);
    await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/memory$`));
    const ledger = await json(await request.get(`${base}/memory/deletion-ledger`));
    expect(JSON.stringify(ledger)).not.toContain("Deterministic browser fixture content");
    await page.screenshot({ path: "test-results/aw-v4-memory-privacy.png", fullPage: true });
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: {
      enableWorkflowsV1: flags.enableWorkflowsV1, enableWorkflowBuilderV1: flags.enableWorkflowBuilderV1,
      enableAutomationArtifactsV1: flags.enableAutomationArtifactsV1, enableCollectiveMemoryV1: flags.enableCollectiveMemoryV1,
    } });
  }
});

test("reviews run evidence and qualifies, shadows and retires a generated optimizer candidate", async ({ page, request }) => {
  test.setTimeout(120_000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const enabled = { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, enableAutomationArtifactsV1: true,
    enableWorkflowOptimizerSuggestions: true, enableWorkflowOptimizerShadow: true, enableWorkflowOptimizerPromotion: true };
  await json(await request.patch("/api/instance/settings/experimental", { data: enabled }));
  const company = await json(await request.post("/api/companies", { data: { name: `V4 optimizer browser ${Date.now()}` } }));
  const base = `/api/companies/${company.id}`;
  try {
    const workflow = await json(await request.post(`${base}/workflows`, { data: { name: "Reviewed copy workflow" } }));
    const graph = { version: 1, nodes: [
      { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
      { id: "copy", type: "core.transform", name: "Copy value", position: { x: 320, y: 0 }, config: { mapping: { value: "{{input.value}}" } } },
    ], edges: [{ id: "entry", source: "start", target: "copy" }], variables: [], settings: {} };
    const draft = await json(await request.patch(`${base}/workflows/${workflow.id}/draft`, { data: { expectedRevisionId: workflow.draftRevisionId, graph } }));
    await json(await request.post(`${base}/workflows/${workflow.id}/publish`, { data: { expectedDraftRevisionId: draft.draftRevisionId, expectedPublishedRevisionId: null, approvalId: null } }));
    for (let value = 1; value <= 3; value++) {
      const run = await json(await request.post(`${base}/workflows/${workflow.id}/run`, { headers: { "Idempotency-Key": randomUUID() }, data: { input: { value } } }));
      if (value === 1) {
        await page.goto(`/${company.issuePrefix}/workflows/${workflow.id}/runs/${run.run.id}`);
        await page.getByLabel("Review reason", { exact: true }).fill("Verified the browser fixture against its copy contract");
        const confirm = page.getByRole("button", { name: "Confirm result review", exact: true });
        await confirm.focus(); await page.keyboard.press("Enter");
        await expect(page.getByText("Reviewed without corrections", { exact: true })).toBeVisible();
      } else await json(await request.post(`${base}/workflow-runs/${run.run.id}/review`, { data: { humanCorrection: false, correctedOutputs: {}, reason: "Verified the copy fixture" } }));
    }
    await page.goto(`/${company.issuePrefix}/workflows/${workflow.id}`);
    const qualify = page.getByText("Qualify a replacement", { exact: true }).first();
    await qualify.focus(); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Generate from reviewed runs", exact: true }).click();
    await expect(page.getByLabel("Candidate contract JSON")).toHaveValue(/preserve-0/);
    await page.getByRole("button", { name: "Compile and run replay", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Qualification passed." })).toBeVisible();
    await page.getByRole("button", { name: "Start shadow", exact: true }).click();
    for (let value = 4; value <= 6; value++) {
      const run = await json(await request.post(`${base}/workflows/${workflow.id}/run`, { headers: { "Idempotency-Key": randomUUID() }, data: { input: { value } } }));
      expect(run.steps.find((step: { nodeId: string }) => step.nodeId === "copy").outputJson).toEqual({ value });
    }
    await page.reload();
    await expect(page.getByText(/shadow: 3 passed, 0 failed/)).toBeVisible();
    const evaluations = await json(await request.get(`${base}/workflows/${workflow.id}/optimizer-evaluations`));
    expect(evaluations).toMatchObject([{ status: "shadow", replayEvaluation: { status: "passed" }, shadowEvaluation: { status: "passed" } }]);
    // Anonymous local-board access does not impersonate an identified approver.
    expect((await request.post(`${base}/workflows/${workflow.id}/optimizer-evaluations/${evaluations[0].id}/request-approval`, { data: {} })).status()).toBe(403);
    await page.screenshot({ path: "test-results/aw-v4-optimizer-shadow.png", fullPage: true });
    await page.getByRole("button", { name: "Retire and use original transform", exact: true }).click();
    await expect.poll(async () => json(await request.get(`${base}/workflows/${workflow.id}/optimizer-evaluations`))).toMatchObject([{ status: "retired" }]);
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(enabled).map((key) => [key, flags[key]])) });
  }
});

test("edits an explicit failure policy through the keyboard outline and publishes its branch contract", async ({ page, request }) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true } }));
  const company = await json(await request.post("/api/companies", { data: { name: `V4 policy browser ${Date.now()}` } }));
  const base = `/api/companies/${company.id}`;
  try {
    const workflow = await json(await request.post(`${base}/workflows`, { data: { name: "Explicit recovery workflow" } }));
    await json(await request.patch(`${base}/workflows/${workflow.id}/draft`, { data: { expectedRevisionId: workflow.draftRevisionId, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "broken", type: "core.transform", name: "Broken", position: { x: 320, y: 0 }, config: { mapping: { value: "{{input.missing}}" } }, failurePolicy: "follow_failure_branch" },
        { id: "success", type: "core.transform", name: "Success", position: { x: 640, y: 0 }, config: { mapping: { value: "success" } } },
        { id: "failure", type: "core.transform", name: "Recovery", position: { x: 640, y: 180 }, config: { mapping: { value: "recovered" } } },
      ], edges: [{ id: "entry", source: "start", target: "broken" }, { id: "success", source: "broken", target: "success", sourceHandle: "success" },
        { id: "failure", source: "broken", target: "failure", sourceHandle: "failure" }], variables: [], settings: {},
    } } }));
    await page.goto(`/${company.issuePrefix}/workflows/${workflow.id}`);
    const broken = page.getByRole("button", { name: /2\. Broken/ });
    await broken.focus(); await page.keyboard.press("Enter");
    const executionPolicy = page.getByText("Execution policy", { exact: true });
    await executionPolicy.focus(); await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: "On step failure", exact: true }).selectOption("wait_for_human");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(async () => (await json(await request.get(`${base}/workflows/${workflow.id}`))).draftRevision.graph.nodes.find((node: { id: string }) => node.id === "broken").failurePolicy).toBe("wait_for_human");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect.poll(async () => (await json(await request.get(`${base}/workflows/${workflow.id}`))).publishedRevision?.graph.nodes.find((node: { id: string }) => node.id === "broken").failurePolicy).toBe("wait_for_human");
    await page.screenshot({ path: "test-results/aw-v4-failure-policy.png", fullPage: true });
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: flags.enableWorkflowsV1, enableWorkflowBuilderV1: flags.enableWorkflowBuilderV1 } });
  }
});
