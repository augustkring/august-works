import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ciSmokeLabScenarios, type SmokeLabScenario, type SmokeRunStepPath } from "./smoke-lab.catalog";

type SmokeRunStepStatus = "pass" | "fail" | "skipped";

const SCREENSHOT_DIR = "test-results/smoke-lab";

type Json = Record<string, unknown>;
type Seed = { companyId: string; prefix: string };
type Scout = { id: string; name: string };
type SmokeRun = { id: string; status: string };
type SmokeRunStepResult = {
  step: { id: string; status: SmokeRunStepStatus };
  summary: Record<string, unknown>;
};
type ToolConnection = {
  id: string;
  name: string;
  transport: "mcp_remote" | "local_stdio";
  applicationId: string;
  enabled: boolean;
  status?: string;
  config?: Record<string, unknown> | null;
};
type ToolCatalogEntry = {
  id: string;
  toolName: string;
  name: string;
  schemaHash?: string | null;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  annotations?: Record<string, unknown> | null;
  riskLevel?: string | null;
  status?: string | null;
  isReadOnly?: boolean;
  isWrite?: boolean;
  isDestructive?: boolean;
};
type FixtureInstall = {
  connections: ToolConnection[];
  catalog: ToolCatalogEntry[];
};
type ToolAccessSummary = {
  tools: Array<{
    toolName: string;
    decision: "allowed" | "ask_first" | "off";
    reasonCode?: string | null;
    matchedPolicyIds?: string[];
  }>;
};
async function json<T = Json>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  const body = await response.text();
  expect(response.ok(), `${response.url()} failed ${response.status()}: ${body}`).toBe(true);
  return JSON.parse(body) as T;
}

async function expectError(response: Awaited<ReturnType<APIRequestContext["get"]>>, status: number) {
  const body = await response.text();
  expect(response.status(), `${response.url()} expected ${status}, got ${response.status()}: ${body}`).toBe(status);
  return body;
}

async function newCompany(request: APIRequestContext, label: string): Promise<Seed> {
  const body = await json<{ id: string; issuePrefix?: string; prefix?: string; urlKey?: string }>(
    await request.post("/api/companies", { data: { name: `Smoke Lab ${label} ${Date.now()}` } }),
  );
  return { companyId: body.id, prefix: body.issuePrefix ?? body.prefix ?? body.urlKey ?? "E2E" };
}

async function createScout(request: APIRequestContext, companyId: string): Promise<Scout> {
  const body = await json<{ id: string; name: string }>(
    await request.post(`/api/companies/${companyId}/agents`, {
      data: {
        name: `Smoke Scout ${Date.now()}`,
        role: "qa",
        title: "Smoke Lab scout",
        capabilities: "Runs deterministic Smoke Lab fixture calls.",
        adapterType: "process",
        adapterConfig: { command: "node", args: ["-e", "setTimeout(() => {}, 1000)"] },
      },
    }),
  );
  return { id: body.id, name: body.name };
}

async function enableSmokeLab(request: APIRequestContext) {
  await json(await request.patch("/api/instance/settings/experimental", { data: { enableSmokeLab: true } }));
}

async function createSmokeRun(request: APIRequestContext, companyId: string, scenarioCount: number) {
  const result = await json<{ run: SmokeRun }>(
    await request.post(`/api/companies/${companyId}/smoke-lab/runs`, {
      data: {
        trigger: "ci",
        summary: {
          catalog: "tests/e2e/smoke-lab.catalog.ts",
          scenarioCount,
        },
      },
    }),
  );
  return result.run;
}

async function updateSmokeRun(
  request: APIRequestContext,
  companyId: string,
  runId: string,
  status: "passed" | "failed",
  summary: Json,
) {
  await json(await request.patch(`/api/companies/${companyId}/smoke-lab/runs/${runId}`, {
    data: { status, summary },
  }));
}

async function recordStep(
  request: APIRequestContext,
  companyId: string,
  runId: string,
  input: {
    path: SmokeRunStepPath;
    scenarioStep: string;
    status: SmokeRunStepStatus;
    detail?: string | null;
    screenshotPath?: string | null;
    durationMs?: number | null;
  },
): Promise<SmokeRunStepResult> {
  return await json<SmokeRunStepResult>(
    await request.post(`/api/companies/${companyId}/smoke-lab/runs/${runId}/steps`, {
      data: {
        path: input.path,
        scenarioStep: input.scenarioStep,
        status: input.status,
        detail: input.detail ?? null,
        screenshotArtifactRef: input.screenshotPath
          ? { kind: "playwright_screenshot", path: input.screenshotPath }
          : null,
        durationMs: input.durationMs ?? null,
      },
    }),
  );
}

async function screenshot(page: Page, scenario: SmokeLabScenario, step: string) {
  const path = `${SCREENSHOT_DIR}/${scenario.path.toLowerCase()}-${step}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function navigateForEvidence(page: Page, seed: Seed, connectionId: string, scenario: SmokeLabScenario) {
  if (scenario.uiEntryPath === "advanced") {
    await page.goto(`/${seed.prefix}/apps/advanced`);
    await expect(page.getByRole("heading", { name: "Advanced setup" })).toBeVisible({ timeout: 20_000 });
    return;
  }
  if (scenario.uiEntryPath === "review") {
    await page.goto(`/${seed.prefix}/apps/${connectionId}/review`);
    await expect(page.getByText(/Nothing is waiting for your OK|new actions? (need|to) review/i).first()).toBeVisible({ timeout: 20_000 });
    return;
  }
  if (scenario.uiEntryPath === "activity") {
    await page.goto(`/${seed.prefix}/activity?action=tool_`);
    await expect(page.locator("#main-content").getByRole("heading", { name: "Audit" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("combobox").filter({ hasText: "Apps & tools" })).toBeVisible();
    return;
  }
  if (scenario.uiEntryPath === "attention") {
    await page.goto(`/${seed.prefix}/apps/connections`);
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible({ timeout: 20_000 });
    return;
  }
  await page.goto(`/${seed.prefix}/apps/${connectionId}`);
  await expect(page.getByRole("heading", { name: /Smoke Lab/i }).first()).toBeVisible({ timeout: 30_000 });
}

async function runRecordedStep(
  page: Page,
  request: APIRequestContext,
  seed: Seed,
  runId: string,
  scenario: SmokeLabScenario,
  step: string,
  action: () => Promise<string | null | undefined>,
  captureSuccessScreenshot = false,
) {
  const start = Date.now();
  try {
    const screenshotHint = await action();
    const screenshotPath = captureSuccessScreenshot ? await screenshot(page, scenario, step) : null;
    await recordStep(request, seed.companyId, runId, {
      path: scenario.path,
      scenarioStep: step,
      status: "pass",
      detail: screenshotHint ?? null,
      screenshotPath,
      durationMs: Date.now() - start,
    });
  } catch (error) {
    const screenshotPath = await screenshot(page, scenario, `${step}-failed`).catch(() => null);
    await recordStep(request, seed.companyId, runId, {
      path: scenario.path,
      scenarioStep: step,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      screenshotPath,
      durationMs: Date.now() - start,
    }).catch(() => undefined);
    throw error;
  }
}

async function startSmokeLabServices(request: APIRequestContext, companyId: string) {
  await json(await request.post(`/api/companies/${companyId}/smoke-lab/services/start`));
}

async function installFixtures(request: APIRequestContext, companyId: string): Promise<FixtureInstall> {
  return await json<FixtureInstall>(await request.post(`/api/companies/${companyId}/smoke-lab/install-fixtures`));
}

function connectionForScenario(fixtures: FixtureInstall, scenario: SmokeLabScenario): ToolConnection {
  const preferStdio = scenario.transport === "local_stdio" || scenario.transport === "plugin";
  const transport = preferStdio ? "local_stdio" : "mcp_remote";
  const connection = fixtures.connections.find((candidate) => candidate.transport === transport);
  if (!connection) throw new Error(`Missing ${transport} fixture connection for ${scenario.path}`);
  return connection;
}

async function catalog(request: APIRequestContext, connectionId: string) {
  return await json<{ catalog: ToolCatalogEntry[] }>(await request.get(`/api/tool-connections/${connectionId}/catalog`));
}

async function catalogContract(entries: ToolCatalogEntry[]) {
  return entries
    .map((entry) => ({
      toolName: entry.toolName,
      schemaHash: entry.schemaHash ?? null,
      inputSchema: entry.inputSchema ?? null,
      outputSchema: entry.outputSchema ?? null,
      annotations: entry.annotations ?? null,
      status: entry.status ?? null,
      riskLevel: entry.riskLevel ?? null,
      isReadOnly: entry.isReadOnly ?? null,
      isWrite: entry.isWrite ?? null,
      isDestructive: entry.isDestructive ?? null,
    }))
    .sort((left, right) => left.toolName.localeCompare(right.toolName));
}

async function accessProjection(
  request: APIRequestContext,
  connectionId: string,
  scout: Scout,
  toolName: string,
) {
  const result = await json<{ access: ToolAccessSummary }>(
    await request.get(`/api/tool-connections/${connectionId}/test-agents/${scout.id}/access`),
  );
  const tool = result.access.tools.find((entry) => entry.toolName === toolName);
  expect(tool, `access projection includes ${toolName}`).toBeTruthy();
  return tool!;
}

async function policy(
  request: APIRequestContext,
  companyId: string,
  body: {
    name: string;
    policyType: "allow" | "block" | "require_approval";
    priority: number;
    selectors: Record<string, unknown>;
  },
) {
  return await json<{ id: string }>(await request.post(`/api/companies/${companyId}/tools/policies`, { data: body }));
}

async function gatewayAuditEvents(
  request: APIRequestContext,
  companyId: string,
  options: { connectionId: string; agentId: string; search: string },
) {
  return await json<{ events: Array<Json> }>(
    await request.get(
      `/api/tool-gateway/audit?companyId=${companyId}&app=${options.connectionId}&agent=${options.agentId}&search=${encodeURIComponent(options.search)}&limit=50`,
    ),
  );
}

async function connectionActivity(request: APIRequestContext, connectionId: string) {
  return await json<{
    events: Array<Json>;
    lifecycleEvents: Array<{ type: string; details?: Record<string, unknown> | null }>;
  }>(await request.get(`/api/tool-connections/${connectionId}/activity?limit=100`));
}

async function invokeAndWaitForTerminalRun(request: APIRequestContext, scout: Scout) {
  const invoked = await json<{ id: string }>(await request.post(`/api/agents/${scout.id}/heartbeat/invoke`));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const run = await json<{
      id: string;
      status: string;
      errorCode?: string | null;
      resultJson?: { configurationIncomplete?: { reason?: string } } | null;
    }>(await request.get(`/api/heartbeat-runs/${invoked.id}`));
    if (["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the Smoke Scout run to reach a terminal state");
}

export const defineSmokeLabSuite = (label: string, scenarios: SmokeLabScenario[]) => test.describe.serial(`Smoke Lab scenario catalog mirror (${label})`, () => {
  // The lifecycle test walks all CI-safe scenarios and records nine steps per
  // scenario. Each scenario keeps one representative success screenshot, while
  // every failed step still captures its own evidence. On a loaded CI runner
  // the whole walk can take several minutes, so this ceiling keeps enough
  // headroom for runner variance without slowing a healthy run.
  test.setTimeout(360_000);

  test(`records the ${label} CI-safe Smoke Lab lifecycle into the results API @smoke-lab`, async ({ page, request }) => {
    const seed = await newCompany(request, "catalog");
    const scout = await createScout(request, seed.companyId);
    await enableSmokeLab(request);
    const smokeRun = await createSmokeRun(request, seed.companyId, scenarios.length);
    const failed: string[] = [];
    const isPartialRun = scenarios.length < ciSmokeLabScenarios.length;
    const unavailableInvocations: Array<Json> = [];
    const mutationEvidence: Array<Json> = [];

    try {
      await startSmokeLabServices(request, seed.companyId);

      for (const scenario of scenarios) {
        const fixtures = await installFixtures(request, seed.companyId);
        const connection = connectionForScenario(fixtures, scenario);

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "connect", async () => {
          await navigateForEvidence(page, seed, connection.id, scenario);
          return scenario.lifecycle.connect;
        }, true);

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "discover-catalog", async () => {
          const discovered = await catalog(request, connection.id);
          expect(discovered.catalog.map((entry) => entry.toolName)).toContain(scenario.lifecycle.allowedRead.name);
          return `${scenario.lifecycle.discoverCatalog}: ${discovered.catalog.length} entries`;
        });

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "access-projection", async () => {
          const read = await accessProjection(request, connection.id, scout, scenario.lifecycle.allowedRead.name);
          expect(read.decision).toBe("allowed");
          await page.goto(`/${seed.prefix}/apps/${connection.id}`);
          return `Access projection allows ${scenario.lifecycle.allowedRead.name}; no invocation was made.`;
        });

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "ask-first-access-projection", async () => {
          await policy(request, seed.companyId, {
            name: `${scenario.path} require approval ${Date.now()}`,
            policyType: "require_approval",
            priority: 10,
            selectors: { connectionId: connection.id, toolNames: [scenario.lifecycle.askFirstWrite.name] },
          });
          const projected = await accessProjection(request, connection.id, scout, scenario.lifecycle.askFirstWrite.name);
          expect(projected.decision).toBe("ask_first");
          await page.goto(`/${seed.prefix}/apps/${connection.id}/review`);
          return `Access projection requires approval for ${scenario.lifecycle.askFirstWrite.name}; no action request was created.`;
        });

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "blocked-access-projection", async () => {
          await policy(request, seed.companyId, {
            name: `${scenario.path} block ${Date.now()}`,
            policyType: "block",
            priority: 1,
            selectors: { connectionId: connection.id, toolNames: [scenario.lifecycle.deniedCall.name] },
          });
          const denied = await accessProjection(request, connection.id, scout, scenario.lifecycle.deniedCall.name);
          expect(denied.decision).toBe("off");
          await page.goto(`/${seed.prefix}/apps/${connection.id}/review`);
          return `Access projection blocks ${scenario.lifecycle.deniedCall.name}; no invocation was made.`;
        });

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "unavailable-invocation-no-effect", async () => {
          const response = await request.post(`/api/tool-connections/${connection.id}/test-calls`, {
            data: { agentId: scout.id, toolName: scenario.lifecycle.allowedRead.name, parameters: scenario.lifecycle.allowedRead.parameters },
          });
          const body = JSON.parse(await expectError(response, 409)) as Json;
          const configurationIncomplete = body.configurationIncomplete as Json | undefined;
          expect(body.reasonCode).toBe("tool_model_effect_unqualified");
          expect(body.code).toBe("configuration_incomplete");
          expect(configurationIncomplete?.reason).toBe("tool_model_effect_unqualified");
          expect(body.actionRequestId).toBeUndefined();
          const audit = await gatewayAuditEvents(request, seed.companyId, {
            connectionId: connection.id,
            agentId: scout.id,
            search: scenario.lifecycle.allowedRead.name,
          });
          expect(audit.events, "an unqualified invocation creates no gateway tool-call event").toEqual([]);
          unavailableInvocations.push({
            path: scenario.path,
            toolName: scenario.lifecycle.allowedRead.name,
            httpStatus: response.status(),
            reasonCode: body.reasonCode,
            actionRequestCreated: false,
            matchingGatewayEvents: audit.events.length,
          });
          await page.goto(`/${seed.prefix}/apps/${connection.id}`);
          return `Invocation remained unavailable (${response.status()}, tool_model_effect_unqualified); no action request or gateway tool-call event was created.`;
        });

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "quarantine-config-unchanged-catalog", async () => {
          if (connection.transport !== "mcp_remote") {
            const before = await catalog(request, connection.id);
            const beforeContract = await catalogContract(before.catalog);
            await page.goto(`/${seed.prefix}/activity?action=tool_`);
            expect(await catalogContract((await catalog(request, connection.id)).catalog)).toEqual(beforeContract);
            return `Quarantine refresh is not applicable to ${connection.transport}; catalog contract remained unchanged.`;
          }
          const baselineConfig = await json<ToolConnection>(await request.patch(`/api/tool-connections/${connection.id}`, {
            data: { config: { ...(connection.config ?? {}), quarantineNewEntries: false } },
          }));
          expect(baselineConfig.config?.quarantineNewEntries).toBe(false);
          await request.post(`/api/tool-connections/${connection.id}/catalog/refresh`);
          const before = await catalog(request, connection.id);
          const beforeContract = await catalogContract(before.catalog);
          const updated = await json<ToolConnection>(await request.patch(`/api/tool-connections/${connection.id}`, {
            data: { config: { ...(baselineConfig.config ?? {}), quarantineNewEntries: true } },
          }));
          expect(updated.config?.quarantineNewEntries).toBe(true);
          const refresh = await json<{ quarantinedCount: number }>(
            await request.post(`/api/tool-connections/${connection.id}/catalog/refresh`),
          );
          expect(refresh.quarantinedCount).toBe(0);
          const after = await catalog(request, connection.id);
          expect(await catalogContract(after.catalog)).toEqual(beforeContract);
          mutationEvidence.push({
            path: scenario.path,
            configQuarantineEnabled: true,
            catalogRefreshQuarantinedCount: refresh.quarantinedCount,
            catalogContractUnchanged: true,
          });
          await page.goto(`/${seed.prefix}/apps/connections`);
          return `Quarantine config was enabled; refresh found no changed entries and the catalog schema contract remained unchanged.`;
        });

        const revokeStep = scenario.transport === "gateway_session"
          ? "gateway-session-unavailable-no-token"
          : "connection-revoke";
        await runRecordedStep(page, request, seed, smokeRun.id, scenario, revokeStep, async () => {
          if (scenario.transport === "gateway_session") {
            const run = await invokeAndWaitForTerminalRun(request, scout);
            expect(run.status).toBe("failed");
            expect(run.errorCode).toBe("configuration_incomplete");
            expect(run.resultJson?.configurationIncomplete?.reason).toBe("paid_transport_unqualified");
            const response = await request.post("/api/tool-gateway/sessions", {
              data: { companyId: seed.companyId, agentId: scout.id, runId: run.id, ttlMs: 60_000 },
            });
            const body = JSON.parse(await expectError(response, 403)) as Json;
            expect(body.reasonCode).toBe("run_inactive");
            expect(body.sessionId).toBeUndefined();
            expect(body.token).toBeUndefined();
            mutationEvidence.push({
              path: scenario.path,
              gatewaySessionAvailable: false,
              terminalRunError: run.errorCode,
              terminalRunReason: run.resultJson?.configurationIncomplete?.reason,
              sessionCreationReason: body.reasonCode,
              tokenIssued: false,
            });
            await page.goto(`/${seed.prefix}/activity?action=tool_`);
            return "Gateway session creation is unavailable without an active run: the invoked run ended as paid_transport_unqualified and no session token was issued.";
          }
          const disabled = await json<ToolConnection>(await request.patch(`/api/tool-connections/${connection.id}`, {
            data: { enabled: false },
          }));
          expect(disabled.enabled).toBe(false);
          const paused = await connectionActivity(request, connection.id);
          expect(paused.lifecycleEvents.some((event) => event.type === "app_paused" && event.details?.lifecycle === "paused")).toBe(true);
          await page.goto(`/${seed.prefix}/apps/${connection.id}`);
          const resumed = await json<ToolConnection>(await request.patch(`/api/tool-connections/${connection.id}`, {
            data: { enabled: true },
          }));
          expect(resumed.enabled).toBe(true);
          const activity = await connectionActivity(request, connection.id);
          expect(activity.lifecycleEvents.some((event) => event.type === "app_resumed" && event.details?.lifecycle === "resumed")).toBe(true);
          mutationEvidence.push({
            path: scenario.path,
            lifecycleActions: ["tool_connection.updated:paused", "tool_connection.updated:resumed"],
          });
          return scenario.lifecycle.revoke;
        });

        await runRecordedStep(page, request, seed, smokeRun.id, scenario, "audit-evidence", async () => {
          const audit = await gatewayAuditEvents(request, seed.companyId, {
            connectionId: connection.id,
            agentId: scout.id,
            search: scenario.lifecycle.allowedRead.name,
          });
          expect(audit.events).toEqual([]);
          await page.goto(`/${seed.prefix}/activity?action=tool_`);
          return `No gateway tool-call audit exists for the unqualified invocation; lifecycle mutation evidence was checked separately.`;
        });
      }
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await updateSmokeRun(request, seed.companyId, smokeRun.id, failed.length > 0 ? "failed" : "passed", {
        catalog: "tests/e2e/smoke-lab.catalog.ts",
        scenarioCount: scenarios.length,
        catalogScenarioCount: ciSmokeLabScenarios.length,
        partial: isPartialRun,
        capabilityStatus: {
          genericMcpInvocation: "unqualified",
          accessProjection: "supported",
          quarantineConfigurationAndUnchangedRefresh: "supported_for_remote_http",
          gatewaySessionCreation: "unavailable_without_active_run",
        },
        supportedTests: [
          "catalog_discovery",
          "access_projection_allow_ask_first_block",
          "quarantine_config_with_unchanged_remote_catalog",
          "connection_pause_resume_and_activity_for_non_gateway_paths",
          "gateway_session_unavailable_without_active_run_no_token_issued",
          "screenshot_and_result_api_persistence",
        ],
        unqualifiedCapabilities: ["generic_mcp_model_invocation", "gateway_session_creation_without_active_run"],
        unavailableInvocations,
        mutationEvidence,
        failed,
      }).catch(() => undefined);
    }

    const completed = await json<{
      run: SmokeRun;
      steps: Array<{ path: string; scenarioStep: string; status: string; screenshotArtifactRef: Json | null }>;
    }>(
      await request.get(`/api/companies/${seed.companyId}/smoke-lab/runs/${smokeRun.id}`),
    );
    expect(completed.run.status).toBe("passed");
    for (const scenario of scenarios) {
      const steps = completed.steps.filter((step) => step.path === scenario.path);
      expect(steps.length, `${scenario.path} should record lifecycle steps`).toBeGreaterThanOrEqual(9);
      expect(steps.every((step) => step.status === "pass")).toBe(true);
      const screenshotSteps = steps.filter((step) => step.screenshotArtifactRef?.kind === "playwright_screenshot");
      expect(screenshotSteps.map((step) => step.scenarioStep)).toEqual(["connect"]);
    }
  });
});
