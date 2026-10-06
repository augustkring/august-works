import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, chatEndpoints, chatDeliveries, chatExternalPrincipals, chatIdentityLinks, chatConversations, heartbeatRuns, issues, projects, toolApplications, toolConnections, toolInvocations, workSignalCandidates, projectRoadmapProposals, issueThreadInteractions } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Presences, enableV5ForTest } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workSignalService } from "../services/work-signals/work-signal-service.js";
import { projectControlService } from "../services/project-control.js";
import { registerSlackTaskAuthority, type SlackTaskAuthority } from "../services/connectors/slack-authority.js";
import { executeGovernedSlackTool } from "../services/connectors/slack.js";
vi.mock("../services/connectors/slack.js", () => ({ executeGovernedSlackTool: vi.fn() }));
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 source-bound coordination candidates (local protocol fixtures)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, authority: SlackTaskAuthority;
  let sourceTask: typeof issues.$inferSelect, target: typeof issues.$inferSelect, run: typeof heartbeatRuns.$inferSelect, delivery: typeof chatDeliveries.$inferSelect;
  let messageText: string, restricted: boolean, release: (() => void) | undefined;
  const decision = (version: number, extra = {}) => ({ expectedVersion: version, rationale: "Review the actual source before changing canonical business state", ...extra });
  const worker = () => ({ type: "agent" as const, companyId: f.home, agentId: f.presence.id, runId: run.id });
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-work-signals-"); db = createDb(database.connectionString); await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db); });
  afterAll(async () => { release?.(); await database?.cleanup(); });
  beforeEach(async () => {
    release?.(); vi.clearAllMocks();
    await instanceSettingsService(db).updateExperimental({ enableChatConnectors: true, work_signals_v7: true, proactive_followup_v7: true });
    f = await seedV5Presences(db); messageText = "Deadline 2026-12-04"; restricted = false;
    const [app] = await db.insert(toolApplications).values({ companyId: f.home, name: "Slack fixture", type: "mcp", applicationKey: "slack-bot" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: f.home, applicationId: app!.id, name: "Native Slack fixture", uid: randomUUID(), transport: "chat_sdk", connectionPurpose: "channel", status: "active", enabled: true }).returning();
    const [endpoint] = await db.insert(chatEndpoints).values({ companyId: f.home, connectionId: connection!.id, provider: "slack", publicId: randomUUID(), assignedAgentId: f.presence.id, providerAccountId: "TTEST", status: "active" }).returning();
    const [principal] = await db.insert(chatExternalPrincipals).values({ companyId: f.home, provider: "slack", providerAccountId: "TTEST", externalId: "UOWNER", kind: "user" }).returning();
    await db.insert(chatIdentityLinks).values({ companyId: f.home, endpointId: endpoint!.id, principalId: principal!.id, paperclipUserId: f.userId, status: "linked", confirmedAt: new Date() });
    const [project] = await db.insert(projects).values({ companyId: f.home, name: "Authorized roadmap" }).returning();
    [sourceTask] = await db.insert(issues).values({ companyId: f.home, title: "Slack source conversation", harnessKind: "conversation", status: "in_progress", assigneeAgentId: f.presence.id }).returning() as [typeof sourceTask];
    [target] = await db.insert(issues).values({ companyId: f.home, projectId: project!.id, title: "Existing deliverable", status: "todo", assigneeAgentId: f.presence.id }).returning() as [typeof target];
    [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, nativeIssueId: sourceTask.id, responsibleUserId: f.userId, invocationSource: "on_demand", triggerDetail: "manual", status: "running" }).returning() as [typeof run];
    const [conversation] = await db.insert(chatConversations).values({ companyId: f.home, endpointId: endpoint!.id, issueId: sourceTask.id, externalLabel: "Source channel", externalConversationId: "slack:C1", externalThreadId: "slack:C1:123.456" }).returning();
    [delivery] = await db.insert(chatDeliveries).values({ companyId: f.home, endpointId: endpoint!.id, conversationId: conversation!.id, principalId: principal!.id, providerEventId: "slack:C1:123.456:123.456", deduplicationKey: randomUUID(), eventKind: "mention", state: "processed", normalizedEvent: { resource: { providerResourceId: "C1" }, message: { providerMessageId: "123.456", text: messageText } } }).returning() as [typeof delivery];
    authority = { endpoint: endpoint!, issueId: sourceTask.id, conversation: conversation!, userId: f.userId, slackUserId: "UOWNER", principalId: principal!.id, deliveryId: delivery.id, identityContextId: null, revision: "fixture-only", workMode: "standard", botToken: "fixture-not-a-secret" };
    release = registerSlackTaskAuthority(db, async binding => { if (binding.issueId !== sourceTask.id || binding.runId !== run.id || binding.agentId !== f.presence.id || binding.companyId !== f.home) throw Object.assign(new Error("foreign source"), { status: 403 }); return authority; });
    vi.mocked(executeGovernedSlackTool).mockImplementation(async (_db, binding, name) => {
      const [receipt] = await db.insert(toolInvocations).values({ companyId: binding.companyId, issueId: binding.issueId, runId: binding.runId, agentId: binding.agentId, toolName: `slack-bot.${authority.endpoint.id}:${name}`, status: "succeeded" }).returning();
      const data = name === "slack_channel_info" ? { channel: { id: "C1", private: restricted, direct: false } } : { messages: [{ ts: "123.456", user: "UOWNER", text: messageText }] };
      return { invocationId: receipt!.id, status: "completed", tool: name, result: { content: JSON.stringify(data), data } };
    });
  });
  const extract = () => workSignalService(db).extract(worker(), f.home, sourceTask.id);
  it("produces a human Roadmap draft for an explicitly selected authorized Task, without silently committing a date", async () => {
    const [candidate] = await extract();
    expect(candidate).toMatchObject({ signalType: "deadline_change", status: "candidate", facts: { date: "2026-12-04" } });
    const proposed = await workSignalService(db).decide(f.actor, f.home, candidate!.id, "apply", decision(1, { targetIssueId: target.id }));
    const [proposal] = await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, proposed.proposalId!));
    expect(proposal?.status).toBe("pending"); expect(proposal?.patch.changes[0]?.issueId).toBe(target.id);
    expect((await db.select().from(issues).where(eq(issues.id, target.id)))[0]?.plannedEndAt).toBeNull();
    const reviewed = await projectControlService(db).review(f.actor, f.home, target.projectId!, proposed.proposalId!, true, "Confirm the reported date after reviewing the actual source");
    expect(reviewed.status).toBe("accepted"); expect((await db.select().from(issues).where(eq(issues.id, target.id)))[0]?.plannedEndAt?.toISOString()).toBe("2026-12-04T00:00:00.000Z");
  });
  it("requires live native worker provenance, abstains on ambiguity and deduplicates repeated source extraction", async () => {
    await expect(workSignalService(db).extract(f.actor, f.home, sourceTask.id)).rejects.toMatchObject({ status: 403 });
    await expect(workSignalService(db).extract({ ...worker(), companyId: f.guest }, f.guest, sourceTask.id)).rejects.toMatchObject({ status: 403 });
    messageText = "Maybe Friday"; expect(await extract()).toEqual([]);
    messageText = "Deadline 2026-12-04"; expect(await extract()).toHaveLength(1); expect(await extract()).toEqual([]);
    expect(await db.select().from(workSignalCandidates).where(eq(workSignalCandidates.companyId, f.home))).toHaveLength(1);
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, run.id));
    await expect(extract()).rejects.toMatchObject({ status: 403 });
  });
  it("keeps completion claims unverified and suppresses repeated native follow-ups", async () => {
    messageText = "I finished. Blocked by another deliverable.";
    const [completion, blocker] = await extract(); expect(completion?.signalType).toBe("completion_claim");
    await expect(workSignalService(db).decide(f.actor, f.home, completion!.id, "apply", decision(1, { targetIssueId: target.id }))).rejects.toMatchObject({ status: 409 });
    const reviewed = await workSignalService(db).decide(f.actor, f.home, completion!.id, "review", decision(1));
    expect(reviewed.interactionId).toBeTruthy();
    await expect(workSignalService(db).decide(f.actor, f.home, blocker!.id, "review", decision(1))).rejects.toMatchObject({ status: 409 });
    expect((await db.select().from(issues).where(eq(issues.id, sourceTask.id)))[0]?.status).toBe("in_progress");
    const [interaction] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, reviewed.interactionId!));
    expect(interaction?.continuationPolicy).toBe("none"); expect(interaction?.effectiveResolverPolicy).toBe("human_only"); expect(JSON.stringify(interaction?.payload)).not.toContain("Blocked");
  });
  it("confines restricted sources and checks current target-company and source-participant authority", async () => {
    restricted = true; const [candidate] = await extract(); expect(candidate?.sensitivity).toBe("restricted");
    await expect(workSignalService(db).decide(f.actor, f.home, candidate!.id, "apply", decision(1, { targetIssueId: target.id }))).rejects.toMatchObject({ status: 409 });
    const other = await seedV5Presences(db);
    await expect(workSignalService(db).decide(other.actor, f.home, candidate!.id, "ignore", decision(1))).rejects.toMatchObject({ status: 403 });
    restricted = false; messageText = "Deadline 2026-12-05"; const [publicCandidate] = await extract();
    const [foreign] = await db.insert(issues).values({ companyId: f.guest, title: "Other company", assigneeAgentId: f.guestPresence.id }).returning();
    await expect(workSignalService(db).decide(f.actor, f.home, publicCandidate!.id, "apply", decision(1, { targetIssueId: foreign!.id }))).rejects.toMatchObject({ status: 404 });
  });
  it("rejects a stale source hash, including a message change without an already-delivered edit event", async () => {
    const [candidate] = await extract(); messageText = "Deadline 2026-12-05";
    await expect(workSignalService(db).decide(f.actor, f.home, candidate!.id, "apply", decision(1, { targetIssueId: target.id }))).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, f.home))).toHaveLength(0);
  });
  it("invalidates edited/deleted source facts and pending drafts independently of feature rollback, including restored payloads", async () => {
    const [candidate] = await extract(); const proposed = await workSignalService(db).decide(f.actor, f.home, candidate!.id, "apply", decision(1, { targetIssueId: target.id }));
    await instanceSettingsService(db).updateExperimental({ proactive_followup_v7: false, work_signals_v7: false });
    await db.insert(chatDeliveries).values({ companyId: f.home, endpointId: authority.endpoint.id, providerEventId: randomUUID(), deduplicationKey: randomUUID(), eventKind: "message_updated", normalizedEvent: { message: { providerMessageId: "123.456", targetProviderEventId: delivery.providerEventId, text: "Correction" } } });
    const [erased] = await db.select().from(workSignalCandidates).where(eq(workSignalCandidates.id, candidate!.id)); expect(erased?.facts).toBeNull(); expect(erased?.status).toBe("invalidated");
    const [stale] = await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, proposed.proposalId!)); expect(stale?.status).toBe("stale"); expect(stale?.patch.changes).toEqual([]);
    await expect(db.update(projectRoadmapProposals).set({ status: "accepted" }).where(eq(projectRoadmapProposals.id, proposed.proposalId!))).rejects.toThrow();
    await expect(db.update(workSignalCandidates).set({ facts: { reason: "restored_copy", date: "2026-12-04" } }).where(eq(workSignalCandidates.id, candidate!.id))).rejects.toThrow();
    await db.delete(chatDeliveries).where(eq(chatDeliveries.id, delivery.id));
    expect((await db.select().from(workSignalCandidates).where(eq(workSignalCandidates.id, candidate!.id)))[0]?.sourceDeliveryId).toBeNull();
  });
  it("physically clears candidates on identity revocation", async () => {
    const [candidate] = await extract();
    await db.update(chatIdentityLinks).set({ status: "revoked", revokedAt: new Date() }).where(eq(chatIdentityLinks.endpointId, authority.endpoint.id));
    expect((await db.select().from(workSignalCandidates).where(eq(workSignalCandidates.id, candidate!.id)))[0]?.facts).toBeNull(); expect(await workSignalService(db).list(f.actor, f.home)).toEqual([]);
  });
  it("withdraws a native review when its source is deleted, including with the feature disabled", async () => {
    messageText = "I finished"; const [candidate] = await extract();
    const requested = await workSignalService(db).decide(f.actor, f.home, candidate!.id, "review", decision(1));
    await instanceSettingsService(db).updateExperimental({ proactive_followup_v7: false, work_signals_v7: false });
    await db.insert(chatDeliveries).values({ companyId: f.home, endpointId: authority.endpoint.id, providerEventId: randomUUID(), deduplicationKey: randomUUID(), eventKind: "message_deleted", normalizedEvent: { message: { providerMessageId: "123.456", targetProviderEventId: delivery.providerEventId } } });
    expect((await db.select().from(workSignalCandidates).where(eq(workSignalCandidates.id, candidate!.id)))[0]?.facts).toBeNull();
    expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, requested.interactionId!)))[0]?.status).toBe("withdrawn");
  });
  it("blocks changed channel privacy and off-flag Roadmap acceptance", async () => {
    const [candidate] = await extract(); const proposed = await workSignalService(db).decide(f.actor, f.home, candidate!.id, "apply", decision(1, { targetIssueId: target.id }));
    restricted = true;
    await expect(projectControlService(db).review(f.actor, f.home, target.projectId!, proposed.proposalId!, true, "Confirm after the source changed visibility")).rejects.toMatchObject({ status: 409 });
    restricted = false; await instanceSettingsService(db).updateExperimental({ proactive_followup_v7: false, work_signals_v7: false });
    await expect(projectControlService(db).review(f.actor, f.home, target.projectId!, proposed.proposalId!, true, "Confirm after the experiment was disabled")).rejects.toMatchObject({ status: 404 });
    await expect(db.update(projectRoadmapProposals).set({ status: "accepted" }).where(eq(projectRoadmapProposals.id, proposed.proposalId!))).rejects.toThrow();
  });
  it("clears original-source redaction without depending on Work Signals admission", async () => {
    const [candidate] = await extract();
    await instanceSettingsService(db).updateExperimental({ proactive_followup_v7: false, work_signals_v7: false });
    await db.update(chatDeliveries).set({ normalizedEvent: { message: { providerMessageId: "123.456" }, filtering: { contentRetained: false } } }).where(eq(chatDeliveries.id, delivery.id));
    expect((await db.select().from(workSignalCandidates).where(eq(workSignalCandidates.id, candidate!.id)))[0]?.facts).toBeNull();
  });
  it("recovers a lost native follow-up after a durable claim without creating duplicate cards", async () => {
    messageText = "I finished"; const [candidate] = await extract();
    await db.execute(sql`create function aw_test_work_signal_delivery_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture transient delivery failure'; end $$`);
    await db.execute(sql`create trigger aw_test_work_signal_delivery_failure before insert on issue_thread_interactions for each row execute function aw_test_work_signal_delivery_failure()`);
    const requested = await workSignalService(db).decide(f.actor, f.home, candidate!.id, "review", decision(1));
    expect(requested).toMatchObject({ status: "review_requested", interactionId: null, followupAttempts: 1, followupErrorCode: "native_review_delivery_failed" });
    await db.execute(sql`drop trigger aw_test_work_signal_delivery_failure on issue_thread_interactions`); await db.execute(sql`drop function aw_test_work_signal_delivery_failure()`);
    await Promise.all([workSignalService(db).deliverFollowups(5, f.home), workSignalService(db).deliverFollowups(5, f.home)]);
    const [recovered] = await db.select().from(workSignalCandidates).where(eq(workSignalCandidates.id, candidate!.id));
    expect(recovered?.interactionId).toBeTruthy(); expect(recovered?.followupErrorCode).toBeNull(); expect(recovered?.followupAttempts).toBe(2);
    expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.companyId, f.home))).toHaveLength(1);
    await expect(db.update(workSignalCandidates).set({ followupAttempts: 0 }).where(eq(workSignalCandidates.id, candidate!.id))).rejects.toThrow();
  });
  it("withdraws an ignored review and prevents late native-card recreation", async () => {
    messageText = "I finished"; const [candidate] = await extract();
    const requested = await workSignalService(db).decide(f.actor, f.home, candidate!.id, "review", decision(1));
    await workSignalService(db).decide(f.actor, f.home, candidate!.id, "ignore", decision(requested.version));
    expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, requested.interactionId!)))[0]?.status).toBe("withdrawn");
    await db.update(issueThreadInteractions).set({ status: "pending" }).where(eq(issueThreadInteractions.id, requested.interactionId!));
    expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, requested.interactionId!)))[0]?.status).toBe("withdrawn");
  });
});
