import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentExecutionManifests, enterpriseIdentityPolicies, heartbeatRuns, issues, jevDecisionSettings, orchestrationPlans, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "./authorization.js";
import { jevSkillSuggestionService } from "./jev-skill-suggestions.js";
import { runJevDecision } from "./jev-decision-provider.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  candidates: vi.fn(),
  selectDecision: vi.fn(),
  credential: vi.fn(),
  currentAuthority: vi.fn(),
  reserve: vi.fn(),
  claimForDispatch: vi.fn(),
  recordOutcome: vi.fn(),
}));
vi.mock("./v7-authorization.js", () => ({ assertV7Authorization: mocks.authorize }));
vi.mock("./skill-resolver.js", () => ({ skillResolverService: () => ({ suggestionCandidates: mocks.candidates }) }));
vi.mock("./ai-connections.js", () => ({ aiConnectionService: () => ({ selectDecision: mocks.selectDecision, credential: mocks.credential }) }));
vi.mock("./orchestration/model-reservations.js", () => ({ modelReservationService: (_db: unknown, options: { currentAuthority: (...args: any[]) => Promise<string> }) => {
  mocks.currentAuthority.mockImplementation(options.currentAuthority);
  return { reserve: mocks.reserve, claimForDispatch: mocks.claimForDispatch, recordOutcome: mocks.recordOutcome };
} }));

describe("Jev Skill shadow admission", () => {
  beforeEach(() => {
    mocks.authorize.mockReset(); mocks.candidates.mockReset().mockResolvedValue([
      { skillId: "skill-1", versionId: "version-1", key: "review", name: "Review evidence" },
    ]);
    mocks.selectDecision.mockReset(); mocks.credential.mockReset(); mocks.currentAuthority.mockReset();
    mocks.reserve.mockReset().mockResolvedValue({ id: "reservation-1", status: "reserved", expiresAt: new Date(Date.now() + 60_000) });
    mocks.claimForDispatch.mockReset().mockResolvedValue({ id: "reservation-1" }); mocks.recordOutcome.mockReset();
  });

  it("does not dispatch when the opt-in is on but no operator-qualified profile exists", async () => {
    const run = { companyId: "company-1", id: "run-1", agentId: "agent-1", status: "running", responsibleUserId: "human-1",
      nativeIssueId: "task-1", contextSnapshot: {}, activeIdentityContextId: null };
    const task = { companyId: "company-1", id: "task-1", status: "open", projectId: "project-1", parentId: null,
      assigneeAgentId: "agent-1", assigneeUserId: null };
    const settings = { companyId: "company-1", mode: "shadow", allowBackground: true, connectionId: "connection-1", grantId: "grant-1" };
    const manifestBody = { runId: "run-1", agentId: "agent-1", skills: [] };
    const manifest = { companyId: "company-1", runId: "run-1", hash: hashContextPolicySnapshot(manifestBody), manifest: manifestBody };
    const db = { select: () => ({ from: (table: unknown) => ({ where: async () => table === heartbeatRuns ? [run] : table === issues ? [task] : table === agentExecutionManifests ? [manifest] : table === jevDecisionSettings ? [settings] : [] }) }) } as unknown as Db;
    const provider = vi.fn<typeof runJevDecision>();
    const service = jevSkillSuggestionService(db, { sourceSha: "a".repeat(40), profiles: [], provider });
    const actor: AuthorizationActor = { type: "agent", source: "none", companyId: "company-1", agentId: "agent-1", runId: "run-1", onBehalfOfUserId: "human-1" };

    await expect(service.shadow(actor, { companyId: "company-1", agentId: "agent-1", runId: "run-1", issueId: "task-1",
      query: "review evidence", requirements: [], baselineSkillIds: [], manifestHash: manifest.hash }))
      .resolves.toEqual({ dispatched: false, reason: "unqualified_profile" });
    expect(mocks.authorize).toHaveBeenCalledWith(db, actor, "company-1", "issue:read", expect.objectContaining({ issueId: "task-1" }));
    expect(mocks.candidates).toHaveBeenCalledWith(actor, "company-1", [], "task");
    const malformed = jevSkillSuggestionService(db, { sourceSha: "a".repeat(40), profiles: [{ companyId: "company-1", connectionId: "connection-1", grantId: "grant-1" } as never], provider });
    await expect(malformed.shadow(actor, { companyId: "company-1", agentId: "agent-1", runId: "run-1", issueId: "task-1",
      query: "review evidence", requirements: [], baselineSkillIds: [], manifestHash: manifest.hash }))
      .resolves.toEqual({ dispatched: false, reason: "unqualified_profile" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("fails closed when a valid server profile exists but the company processing policy is absent", async () => {
    const companyId = "50000000-0000-4000-8000-000000000001", agentId = "50000000-0000-4000-8000-000000000002";
    const runId = "50000000-0000-4000-8000-000000000003", taskId = "50000000-0000-4000-8000-000000000004";
    const connectionId = "50000000-0000-4000-8000-000000000005", grantId = "50000000-0000-4000-8000-000000000006";
    const now = new Date(), sourceSha = "a".repeat(40), hash = "b".repeat(64);
    const base = { companyId, connectionId, grantId, profileId: "jev-fixture", credentialBindingHash: hash, sourceSha,
      qualificationHash: hash, processor: "openrouter" as const, processorTermsHash: hash, retentionPolicyHash: hash, retentionDays: 0,
      setupCostCapMinor: 5, setupMaxCalls: 3,
      testedAt: new Date(now.getTime() - 1_000).toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), processingRegion: "us" as const,
      tariff: { provider: "openrouter" as const, model: "typesafe/jev-1.13", currency: "USD" as const, inputMinorPerMillion: 1, outputMinorPerMillion: 1,
        fixedMinor: 0, qualificationHash: hash, sourceSha, testedAt: new Date(now.getTime() - 1_000).toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() },
      inputTokensUpperBound: 100, maxOutputTokens: 20 };
    const profile = { ...base, profileHash: nativeSha256(base) };
    const run = { companyId, id: runId, agentId, status: "running", responsibleUserId: "human-1", nativeIssueId: taskId,
      executionControlDeadlineAt: new Date(now.getTime() + 45_000), contextSnapshot: {}, activeIdentityContextId: null };
    const task = { companyId, id: taskId, status: "open", projectId: "project-1", parentId: null, assigneeAgentId: agentId, assigneeUserId: null };
    const settings = { companyId, mode: "shadow", allowBackground: true, connectionId, grantId };
    const manifestBody = { runId, agentId, skills: [] };
    const manifest = { companyId, runId, hash: hashContextPolicySnapshot(manifestBody), manifest: manifestBody };
    const db = { select: () => ({ from: (table: unknown) => ({ where: async () => table === heartbeatRuns ? [run] : table === issues ? [task] : table === agentExecutionManifests ? [manifest] : table === jevDecisionSettings ? [settings] : table === enterpriseIdentityPolicies ? [] : [] }) }) } as unknown as Db;
    const provider = vi.fn<typeof runJevDecision>();
    const service = jevSkillSuggestionService(db, { sourceSha, profiles: [profile], provider });
    const actor: AuthorizationActor = { type: "agent", source: "none", companyId, agentId, runId, onBehalfOfUserId: "human-1" };

    await expect(service.shadow(actor, { companyId, agentId, runId, issueId: taskId, query: "review evidence", requirements: [],
      baselineSkillIds: [], manifestHash: manifest.hash })).resolves.toEqual({ dispatched: false, reason: "processing_region_not_allowed" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("dispatches only with a current qualified profile, rechecks locked authority, and aborts slow work at the original deadline", async () => {
    const companyId = "60000000-0000-4000-8000-000000000001", agentId = "60000000-0000-4000-8000-000000000002";
    const runId = "60000000-0000-4000-8000-000000000003", taskId = "60000000-0000-4000-8000-000000000004";
    const connectionId = "60000000-0000-4000-8000-000000000005", grantId = "60000000-0000-4000-8000-000000000006";
    const now = new Date(), sourceSha = "c".repeat(40), hash = "d".repeat(64), expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const base = { companyId, connectionId, grantId, profileId: "jev-software-fixture", credentialBindingHash: createHash("sha256").update("test-key").digest("hex"), sourceSha,
      qualificationHash: hash, processor: "openrouter" as const, processorTermsHash: hash, retentionPolicyHash: hash, retentionDays: 0,
      setupCostCapMinor: 5, setupMaxCalls: 3,
      testedAt: new Date(now.getTime() - 1_000).toISOString(), expiresAt, processingRegion: "us" as const,
      tariff: { provider: "openrouter" as const, model: "typesafe/jev-1.13", currency: "USD" as const, inputMinorPerMillion: 1, outputMinorPerMillion: 1,
        fixedMinor: 0, qualificationHash: hash, sourceSha, testedAt: new Date(now.getTime() - 1_000).toISOString(), expiresAt },
      inputTokensUpperBound: 100, maxOutputTokens: 20 };
    const profile = { ...base, profileHash: nativeSha256(base) };
    const run = { companyId, id: runId, agentId, status: "running", responsibleUserId: "human-1", nativeIssueId: taskId,
      executionControlDeadlineAt: new Date(now.getTime() + 50_000), contextSnapshot: {}, activeIdentityContextId: null };
    const task = { companyId, id: taskId, status: "open", projectId: "project-1", parentId: null, assigneeAgentId: agentId, assigneeUserId: null };
    const settings = { companyId, mode: "shadow", allowBackground: true, connectionId, grantId };
    const manifestBody = { runId, agentId, skills: [] };
    const manifest = { companyId, runId, hash: hashContextPolicySnapshot(manifestBody), manifest: manifestBody };
    const plan = { companyId, id: "plan-1", issueId: taskId, status: "running", version: 1, startedAt: new Date(now.getTime() - 1_000), budgets: { maxWallClockSeconds: 120 } };
    const work = { plan, worker: { id: "worker-1" }, attempt: { id: "attempt-1" } };
    const selected = { connection: { id: connectionId }, grant: { id: grantId, providerTenant: null } };
    mocks.selectDecision.mockResolvedValue(selected); mocks.credential.mockResolvedValue("test-key");
    let rootSelects = 0, transactionSelects = 0;
    const createDb = (transaction: boolean) => ({ select: () => {
      if (transaction) transactionSelects++; else rootSelects++;
      let from: unknown, joins = 0;
      const query = { from(table: unknown) { from = table; return query; }, innerJoin() { joins++; return query; }, where: async () =>
        from === heartbeatRuns ? [run] : from === issues ? [task] : from === agentExecutionManifests ? [manifest] :
          from === jevDecisionSettings ? [settings] : from === enterpriseIdentityPolicies ? [{ status: "qualified", qualification: { sourceRevision: sourceSha, expiresAt }, operatingEnvelope: { awProcessingRegions: ["us"] } }] :
            from === orchestrationPlans ? joins ? [work] : [plan] : [] };
      return query;
    } });
    const db = createDb(false) as unknown as Db, tx = createDb(true) as unknown as Db;
    const provider = vi.fn<typeof runJevDecision>().mockResolvedValue({ answers: { skill: { type: "choice", choice: "none" } }, receipt: {
      inputTokens: 12, outputTokens: 2, providerRequestId: "request-1", costCents: "0.0001", costStatus: "reported", pricingProvenance: { source: "provider_reported" },
    } });
    const service = jevSkillSuggestionService(db, { sourceSha, profiles: [profile], provider });
    const actor: AuthorizationActor = { type: "agent", source: "none", companyId, agentId, runId, onBehalfOfUserId: "human-1" };
    const request = { companyId, agentId, runId, issueId: taskId, query: "review evidence", requirements: [], baselineSkillIds: [], manifestHash: manifest.hash };
    const reserveThroughCurrentTx = async (_actor: unknown, reservationRequest: { authorityHash: string }) => {
      const rootBefore = rootSelects;
      const authority = await mocks.currentAuthority(tx, actor, { ...reservationRequest, companyId, planId: "plan-1", workerId: "worker-1", workerAttemptId: "attempt-1" });
      expect(authority).toBe(reservationRequest.authorityHash);
      expect(rootSelects).toBe(rootBefore);
      expect(transactionSelects).toBeGreaterThan(0);
      return { id: "reservation-1", status: "reserved", expiresAt: new Date(Date.now() + 60_000) };
    };
    mocks.claimForDispatch.mockImplementation(async () => {
      const authority = await mocks.currentAuthority(tx, actor, { companyId, planId: "plan-1", purpose: "decision_shadow", workerId: "worker-1", workerAttemptId: "attempt-1" });
      expect(authority).toBeDefined();
      return { id: "reservation-1", status: "dispatched" };
    });
    mocks.reserve.mockImplementation(reserveThroughCurrentTx);
    mocks.selectDecision.mockReset().mockResolvedValueOnce(selected).mockRejectedValueOnce(new Error("connection grant was revoked"));
    await expect(service.shadow(actor, request)).rejects.toThrow("connection grant was revoked");
    expect(provider).not.toHaveBeenCalled();
    expect(mocks.claimForDispatch).not.toHaveBeenCalled();
    mocks.selectDecision.mockReset().mockResolvedValue(selected);
    mocks.reserve.mockReset().mockImplementation(reserveThroughCurrentTx);
    await expect(service.shadow(actor, request))
      .resolves.toMatchObject({ dispatched: true, reservationId: "reservation-1" });
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mocks.recordOutcome).toHaveBeenCalledTimes(1));
    expect(mocks.reserve).toHaveBeenCalledWith(actor, expect.objectContaining({ purpose: "decision_shadow", planId: "plan-1", workerId: "worker-1", workerAttemptId: "attempt-1" }));
    expect(mocks.selectDecision.mock.calls.some(([, reader]) => reader === tx)).toBe(true);
    expect(mocks.recordOutcome).toHaveBeenCalledWith(companyId, "reservation-1", expect.objectContaining({ status: "completed", usage: { inputTokens: 12, outputTokens: 2 } }));

    run.executionControlDeadlineAt = new Date(Date.now() + 2_000);
    provider.mockReset().mockImplementation(async ({ signal }) => {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { errorCode: "timeout", receipt: { inputTokens: null, outputTokens: null, providerRequestId: null, costCents: null,
        costStatus: "unpriced", pricingProvenance: { source: "unknown" } } };
    });
    mocks.recordOutcome.mockClear();
    await expect(service.shadow(actor, request)).resolves.toMatchObject({ dispatched: true });
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mocks.recordOutcome).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(provider.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(mocks.recordOutcome).toHaveBeenCalledWith(companyId, "reservation-1", expect.objectContaining({ status: "unknown", usage: null }));
  });
});
