// @vitest-environment jsdom
import { MemoryRouter } from "react-router-dom";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, type AgentAuthoringDraftView, type AgentDraftPublicationReceipt,
  agentModelMigrationMonitorReceiptSchema, type AgentModelMigrationMonitorReview } from "@paperclipai/shared";
import { AgentModelMigrationMonitor } from "./AgentModelMigrationMonitor";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "author", ready: true }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: context.principal, settled: true, localImplicit: false }) }));
const draft: AgentAuthoringDraftView = { id: "10000000-0000-4000-8000-000000000002", companyId: context.company, createdByUserId: "author",
  agentId: "10000000-0000-4000-8000-000000000003", version: 2, status: "draft", step: "monitor", baselineHash: "a".repeat(64), preparation: null,
  content: agentAuthoringContentSchema.parse({ name: "Reviewed specialist", capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }], ownerUserId: "author", scenarios: ["Write an internal welcome"] }),
  createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" };
const migration: AgentDraftPublicationReceipt = { companyId: context.company, draftId: draft.id, requestId: "10000000-0000-4000-8000-000000000004",
  agentId: draft.agentId!, revisionId: "10000000-0000-4000-8000-000000000009", publishedVersion: 2, publishedAt: "2026-10-28T10:00:00.000Z",
  activatedAtPublication: true, publishedContent: draft.content!, modelMigration: { required: true, action: "migration", stage: "single_agent" },
  authorityGranted: false, executionStarted: false };
const review: AgentModelMigrationMonitorReview = { companyId: context.company, draftId: draft.id, agentId: draft.agentId!, migrationRevisionId: migration.revisionId,
  publishedVersion: 2, publishedAt: migration.publishedAt, targetProfileHash: "b".repeat(64), targetConfigurationHash: "c".repeat(64), targetLifecycleHash: "d".repeat(64),
  canRecord: true, blockers: [], recommendation: "healthy", tests: [{ testId: "10000000-0000-4000-8000-000000000005", runId: "10000000-0000-4000-8000-000000000006",
    scenarioIndex: 0, testCreatedAt: "2026-10-28T10:01:00.000Z", runStartedAt: "2026-10-28T10:01:00.000Z",
    verificationId: "10000000-0000-4000-8000-000000000007", verificationCreatedAt: "2026-10-28T10:02:00.000Z",
    execution: "succeeded", verificationResult: "pass", testQualified: true, outputHash: "e".repeat(64), resultHash: "f".repeat(64) }], reviewHash: "a".repeat(64) };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); context.ready = true;
  sessionStorage.clear(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
it("records a migration monitor only against the exact post-publication review hash", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true,
    agent_packages_v7: true, hire_agent_v9: true } as never);
  vi.spyOn(agentAuthoringApi, "currentModelMigrationMonitorReview").mockResolvedValue(review);
  vi.spyOn(agentAuthoringApi, "modelMigrationMonitorReceipt").mockResolvedValue(null);
  const record = vi.spyOn(agentAuthoringApi, "recordModelMigrationMonitor").mockImplementation(async (_company, _principal, _draft, revisionId, command) => ({
    ...review, requestId: command.requestId, reviewedByUserId: context.principal, recordedAt: "2026-10-28T10:03:00.000Z", decision: "healthy",
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<StrictMode><MemoryRouter><QueryClientProvider client={client}>
    <AgentModelMigrationMonitor company={context.company} principal={context.principal} draft={draft} enabled={context.ready} canUseAuthority={() => context.ready} />
  </QueryClientProvider></MemoryRouter></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain("All 1 saved scenarios have current"));
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === "Record Human monitoring review");
  expect(button).toBeDefined(); expect(button!.disabled).toBe(false); await act(async () => button!.click());
  await vi.waitFor(() => expect(record).toHaveBeenCalled());
  await vi.waitFor(() => expect(client.getMutationCache().getAll().some(value => value.state.status === "success")).toBe(true));
  await vi.waitFor(() => expect(container.textContent).toContain("post-publication model review for version 2 was recorded"));
  expect(record).toHaveBeenCalledWith(context.company, context.principal, draft.id, migration.revisionId,
    { requestId: expect.any(String), expectedReviewHash: review.reviewHash, confirmMonitoring: true });
});

it("lets the Human record a hold when a current post-publication scenario is reviewed as failing", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true,
    agent_packages_v7: true, hire_agent_v9: true } as never);
  const held = { ...review, recommendation: "hold" as const, tests: [{ ...review.tests[0]!, testQualified: false, verificationResult: "fail" as const }] };
  vi.spyOn(agentAuthoringApi, "currentModelMigrationMonitorReview").mockResolvedValue(held);
  vi.spyOn(agentAuthoringApi, "modelMigrationMonitorReceipt").mockResolvedValue(null);
  const record = vi.spyOn(agentAuthoringApi, "recordModelMigrationMonitor").mockImplementation(async (_company, _principal, _draft, _revision, command) => ({
    ...held, requestId: command.requestId, reviewedByUserId: context.principal, recordedAt: "2026-10-28T10:03:00.000Z", decision: "hold",
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<StrictMode><MemoryRouter><QueryClientProvider client={client}>
    <AgentModelMigrationMonitor company={context.company} principal={context.principal} draft={draft} enabled={context.ready} canUseAuthority={() => context.ready} />
  </QueryClientProvider></MemoryRouter></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain("Keep the migration on hold"));
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === "Record hold");
  expect(button).toBeDefined(); expect(button!.disabled).toBe(false); await act(async () => button!.click());
  await vi.waitFor(() => expect(record).toHaveBeenCalled());
  await vi.waitFor(() => expect(client.getMutationCache().getAll().some(value => value.state.status === "success")).toBe(true));
  await vi.waitFor(() => expect(container.textContent).toContain("is recorded as on hold"));
  expect(record).toHaveBeenCalledWith(context.company, context.principal, draft.id, migration.revisionId,
    { requestId: expect.any(String), expectedReviewHash: held.reviewHash, confirmMonitoring: true });
});

it("directs a published draft to a fresh current-baseline draft without offering a monitor write", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true,
    agent_packages_v7: true, hire_agent_v9: true } as never);
  const stale = { ...review, canRecord: false, blockers: ["monitor_requires_a_fresh_draft_from_the_current_published_agent"], recommendation: "hold" as const, tests: [] };
  vi.spyOn(agentAuthoringApi, "currentModelMigrationMonitorReview").mockResolvedValue(stale);
  vi.spyOn(agentAuthoringApi, "modelMigrationMonitorReceipt").mockResolvedValue(null);
  const record = vi.spyOn(agentAuthoringApi, "recordModelMigrationMonitor");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<StrictMode><MemoryRouter><QueryClientProvider client={client}>
    <AgentModelMigrationMonitor company={context.company} principal={context.principal} draft={draft} enabled={context.ready} canUseAuthority={() => context.ready} />
  </QueryClientProvider></MemoryRouter></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain("Start a fresh draft from the current published Agent"));
  expect([...container.querySelectorAll("button")].some(button => button.textContent?.includes("Record"))).toBe(false);
  expect(record).not.toHaveBeenCalled();
});

it("allows a new receipt when current reviewed evidence has changed since a recorded hold", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true,
    agent_packages_v7: true, hire_agent_v9: true } as never);
  const heldReceipt = { ...review, reviewHash: "0".repeat(64), recommendation: "hold" as const,
    tests: [{ ...review.tests[0]!, testQualified: false, verificationResult: "fail" as const }],
    requestId: "10000000-0000-4000-8000-000000000008", reviewedByUserId: context.principal,
    recordedAt: "2026-10-28T10:03:00.000Z", decision: "hold" as const };
  expect(agentModelMigrationMonitorReceiptSchema.safeParse(heldReceipt).success).toBe(true);
  vi.spyOn(agentAuthoringApi, "currentModelMigrationMonitorReview").mockResolvedValue(review);
  vi.spyOn(agentAuthoringApi, "modelMigrationMonitorReceipt").mockResolvedValue(heldReceipt);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<StrictMode><MemoryRouter><QueryClientProvider client={client}>
    <AgentModelMigrationMonitor company={context.company} principal={context.principal} draft={draft} enabled={context.ready} canUseAuthority={() => context.ready} />
  </QueryClientProvider></MemoryRouter></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain("All 1 saved scenarios have current"));
  expect(container.textContent).toContain("is recorded as on hold");
  expect([...container.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent === "Record Human monitoring review")).toBe(true);
});
