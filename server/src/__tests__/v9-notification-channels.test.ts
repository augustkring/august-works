import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents, authUsers, chatActions, chatConversations, chatDeliveries, chatEndpoints,
  chatExternalPrincipals, chatIdentityLinks, companies, companyMemberships, createDb, issues,
  notificationChannelPreferences, notificationChannelPreferenceCommands, notificationChannelDeliveries,
  saasNotifications, saasNotificationPreferences, toolApplications, toolConnections, emailDeliveries,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { notificationChannelPolicy } from "../services/notifications/channel-policy.js";
import { notificationChannelDelivery } from "../services/notifications/channel-delivery.js";
import { purgeExpiredNotificationChannelCommands } from "../services/notifications/channel-retention.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { transactionalEmail } from "../services/notifications/transactional-email.js";
import { notificationService } from "../services/notifications/notifications.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import type { SaasPlatform } from "../services/saas/platform.js";
import express from "express";
import request from "supertest";
import { saasRoutes } from "../routes/saas.js";
import { errorHandler } from "../middleware/error-handler.js";
const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("Original own-account bound notification channels", () => {
  let db: ReturnType<typeof createDb>, fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase("v9-bound-notification-");
    db = createDb(fixture.connectionString);
    await instanceSettingsService(db).updateExperimental({
      saas_deployment_profile_v6: true, transactional_email_v6: true,
      notification_policy_v9: true, notification_channels_v9: true,
    });
  }, 60_000);
  afterAll(async () => { await fixture?.cleanup(); });

  async function seed(provider: "slack" | "microsoft-teams" = "slack") {
    const id = randomUUID(), userId = randomUUID();
    const [company] = await db.insert(companies).values({ name: "Owned channel test", issuePrefix: `N${id.replaceAll("-", "").slice(0, 7)}` }).returning();
    await db.insert(authUsers).values({ id: userId, name: "Verified recipient", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId: company!.id, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const [agent] = await db.insert(agents).values({ companyId: company!.id, name: "Idle source Agent", role: "engineer", adapterType: "process", status: "idle" }).returning();
    const [application] = await db.insert(toolApplications).values({ companyId: company!.id, name: "Owned chat", uid: id, type: "chat", status: "active" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: company!.id, applicationId: application!.id, name: "Owned chat",
      uid: id, connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true, healthStatus: "healthy" }).returning();
    const [endpoint] = await db.insert(chatEndpoints).values({ companyId: company!.id, connectionId: connection!.id, provider,
      publicId: randomUUID(), assignedAgentId: agent!.id, status: "active", providerAccountId: `account-${id}`,
      providerAccountLabel: "Owned workspace", botExternalId: `bot-${id}`, allowDirectMessages: true }).returning();
    const [principal] = await db.insert(chatExternalPrincipals).values({ companyId: company!.id, provider, providerAccountId: endpoint!.providerAccountId!,
      externalId: `recipient-${id}`, displayName: "Verified recipient", kind: "user", isBot: false }).returning();
    const [link] = await db.insert(chatIdentityLinks).values({ companyId: company!.id, endpointId: endpoint!.id, principalId: principal!.id,
      paperclipUserId: userId, status: "linked", confirmedAt: new Date() }).returning();
    // Pre-existing Native conversation context. Notification code must not create
    // or mutate this Task; it only resolves its already-verified private carrier.
    const [issue] = await db.insert(issues).values({ companyId: company!.id, title: "Existing private conversation", assigneeAgentId: agent!.id }).returning();
    const [conversation] = await db.insert(chatConversations).values({ companyId: company!.id, endpointId: endpoint!.id, issueId: issue!.id,
      externalConversationId: `private-${id}`, externalThreadId: `${provider}:private-${id}`, externalLabel: "Private conversation", isDirectMessage: true }).returning();
    await db.insert(chatDeliveries).values({ companyId: company!.id, endpointId: endpoint!.id, conversationId: conversation!.id,
      principalId: principal!.id, providerEventId: randomUUID(), deduplicationKey: randomUUID(), eventKind: "message", state: "processed", normalizedEvent: {} });
    return { company: company!, userId, endpoint: endpoint!, principal: principal!, link: link!, connection: connection!, conversation: conversation!, issue: issue! };
  }
  async function choose(source: Awaited<ReturnType<typeof seed>>) {
    const owner = notificationChannelPolicy(db), current = await owner.view(source.company.id, source.userId, "work_update");
    expect(current.targets).toHaveLength(1);
    const target = current.targets[0]!;
    const command = { requestId: randomUUID(), deliveryLocale: "en", expectedVersion: current.version, expectedBaselineHash: current.baselineHash,
      choice: { channel: target.provider, identityLinkId: target.identityLinkId, conversationId: target.conversationId, expectedTargetHash: target.targetHash } };
    const receipt = await owner.update(source.company.id, source.userId, "work_update", command);
    return { owner, command, receipt, current, target };
  }
  it("binds HTTP reads and commands to the current authenticated recipient and company", async () => {
    const source = await seed(), foreign = await seed();
    const platform = { enabled: async () => true, notifications: notificationService(db, {
      enqueue: async () => { throw new Error("A preference must not enqueue email"); },
    } as unknown as ReturnType<typeof transactionalEmail>) } as unknown as SaasPlatform;
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = req.header("x-fixture-agent") ? { type: "agent", agentId: randomUUID(), companyId: source.company.id } as typeof req.actor : {
      type: "board", source: req.header("x-fixture-local") ? "local_implicit" : "session", userId: source.userId, companyIds: [source.company.id],
    }; next(); });
    app.use("/api", saasRoutes(db, platform)); app.use(errorHandler);
    const path = `/api/companies/${source.company.id}/notifications/channel-preferences/work_update`;
    const own = await request(app).get(path).query({ expectedUserId: source.userId }).expect(200);
    expect(own.headers["cache-control"]).toBe("no-store"); expect(own.body.userId).toBe(source.userId);
    await request(app).get(path).expect(400);
    await request(app).get(path).query({ expectedUserId: foreign.userId }).expect(409);
    await request(app).get(path).query({ expectedUserId: source.userId }).set("x-fixture-local", "1").expect(401);
    await request(app).get(path).query({ expectedUserId: source.userId }).set("x-fixture-agent", "1").expect(401);
    await request(app).get(`/api/companies/${foreign.company.id}/notifications/channel-preferences/work_update`).query({ expectedUserId: source.userId }).expect(403);
    const command = { requestId: randomUUID(), deliveryLocale: "en", expectedVersion: own.body.version,
      expectedBaselineHash: own.body.baselineHash, choice: { channel: "default" } };
    await request(app).post(path).query({ expectedUserId: source.userId }).send({ ...command, userId: foreign.userId }).expect(400);
    const accepted = await request(app).post(path).query({ expectedUserId: source.userId }).send(command).expect(200);
    const recovered = await request(app).get(`${path}/receipts/${command.requestId}`).query({ expectedUserId: source.userId }).expect(200);
    expect(recovered.body).toEqual(accepted.body); expect(accepted.body.messageSent).toBe(false);
  });
  it.each(["slack", "microsoft-teams"] as const)("saves a %s preference once and recovers only its own Original receipt", async provider => {
    const source = await seed(provider), { owner, command, receipt } = await choose(source);
    expect(receipt).toMatchObject({ userId: source.userId, channel: provider, preferenceApplied: true, messageSent: false, authorityGranted: false, executionStarted: false });
    expect(await owner.update(source.company.id, source.userId, "work_update", command)).toEqual(receipt);
    expect(await owner.receipt(source.company.id, source.userId, "work_update", command.requestId)).toEqual(receipt);
    expect(await db.select().from(notificationChannelPreferenceCommands).where(eq(notificationChannelPreferenceCommands.requestId, command.requestId))).toHaveLength(1);
    expect(await db.select().from(issues).where(eq(issues.companyId, source.company.id))).toHaveLength(1);
    expect(await db.select().from(chatActions).where(eq(chatActions.companyId, source.company.id))).toEqual([]);
  });
  it("rejects another user's or company's destination and changed request content", async () => {
    const own = await seed(), foreign = await seed(), { owner, command, receipt } = await choose(own);
    await expect(owner.update(own.company.id, own.userId, "work_update", { ...command, choice: { ...command.choice, conversationId: foreign.conversation.id } })).rejects.toMatchObject({ status: 409 });
    await expect(owner.receipt(own.company.id, foreign.userId, "work_update", receipt.requestId)).rejects.toMatchObject({ status: 403 });
    await expect(db.insert(notificationChannelPreferences).values({ companyId: own.company.id, userId: own.userId, category: "approval", channel: "slack",
      identityLinkId: foreign.link.id, conversationId: foreign.conversation.id, targetHash: "a".repeat(64) })).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });
  it("retains the monotonic preference after destination withdrawal and permits explicit default reset", async () => {
    const source = await seed(), { owner } = await choose(source);
    await db.delete(chatIdentityLinks).where(eq(chatIdentityLinks.id, source.link.id));
    const current = await owner.view(source.company.id, source.userId, "work_update");
    expect(current).toMatchObject({ version: 1, channel: "slack", availability: "unavailable", target: null });
    const receipt = await owner.update(source.company.id, source.userId, "work_update", { requestId: randomUUID(), deliveryLocale: "en", expectedVersion: current.version,
      expectedBaselineHash: current.baselineHash, choice: { channel: "default" } });
    expect(receipt.version).toBe(2);
  });
  it("does not confuse a completed chat Task with recipient or credential withdrawal", async () => {
    const source = await seed(), { owner } = await choose(source);
    await db.update(chatConversations).set({ state: "completed", sessionGeneration: 2 }).where(eq(chatConversations.id, source.conversation.id));
    expect((await owner.view(source.company.id, source.userId, "work_update")).availability).toBe("available");
    await db.update(chatEndpoints).set({ allowDirectMessages: false }).where(eq(chatEndpoints.id, source.endpoint.id));
    expect((await owner.view(source.company.id, source.userId, "work_update")).availability).toBe("unavailable");
  });
  it("requires review after reconfirming the same private identity and hashes the actual confirmation instant", async () => {
    const source = await seed(), { owner, target } = await choose(source);
    await db.update(chatIdentityLinks).set({ confirmedAt: new Date(source.link.confirmedAt!.getTime() + 1000) }).where(eq(chatIdentityLinks.id, source.link.id));
    const current = await owner.view(source.company.id, source.userId, "work_update");
    expect(current.availability).toBe("unavailable"); expect(current.targets[0]!.targetHash).not.toBe(target.targetHash);
  });
  it("rejects forged or rewritten Original receipts at the database boundary", async () => {
    const source = await seed(), { receipt } = await choose(source);
    const [saved] = await db.select().from(notificationChannelPreferences).where(eq(notificationChannelPreferences.companyId, source.company.id));
    for (const changed of [{ userId: "foreign" }, { version: 2 }, { messageSent: true }, { extra: "PRIVATE" }]) {
      const requestId = randomUUID();
      await expect(db.insert(notificationChannelPreferenceCommands).values({ companyId: source.company.id, userId: source.userId,
        category: "work_update", preferenceId: saved!.id, requestId, requestHash: "a".repeat(64), receipt: { ...receipt, requestId, ...changed } as typeof receipt }))
        .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    }
    await expect(db.update(notificationChannelPreferenceCommands).set({ requestHash: "b".repeat(64) })
      .where(eq(notificationChannelPreferenceCommands.requestId, receipt.requestId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });
  it("expires private command metadata even after channel rollout is disabled without deleting the saved preference", async () => {
    const source = await seed(), { owner, receipt } = await choose(source), requestId = randomUUID();
    const [saved] = await db.select().from(notificationChannelPreferences).where(eq(notificationChannelPreferences.companyId, source.company.id));
    const now = new Date(), expired = new Date(now.getTime() - 1000);
    await db.insert(notificationChannelPreferenceCommands).values({ companyId: source.company.id, userId: source.userId,
      category: "work_update", preferenceId: saved!.id, requestId, requestHash: "a".repeat(64), receipt: { ...receipt, requestId },
      createdAt: new Date(now.getTime() - 86_400_000), expiresAt: expired });
    await instanceSettingsService(db).updateExperimental({ notification_channels_v9: false });
    try {
      await purgeExpiredNotificationChannelCommands(db, now);
      expect(await owner.receipt(source.company.id, source.userId, "work_update", requestId)).toBeNull();
      expect(await owner.receipt(source.company.id, source.userId, "work_update", receipt.requestId)).toEqual(receipt);
      expect((await owner.view(source.company.id, source.userId, "work_update")).channel).toBe("slack");
      const current = await owner.view(source.company.id, source.userId, "work_update");
      expect(current).toMatchObject({ channel: "slack", availability: "unavailable", target: null, targets: [] });
      expect(await owner.update(source.company.id, source.userId, "work_update", { requestId: randomUUID(), deliveryLocale: "en",
        expectedVersion: current.version, expectedBaselineHash: current.baselineHash, choice: { channel: "default" } }))
        .toMatchObject({ channel: "default", version: 2, messageSent: false, authorityGranted: false });
    } finally { await instanceSettingsService(db).updateExperimental({ notification_channels_v9: true }); }
  });
  it("suppresses both new and previously queued email after binding while mandatory security retains its owner", async () => {
    const source = await seed(), provider = { send: vi.fn().mockResolvedValue({ providerMessageId: randomUUID() }), find: vi.fn().mockResolvedValue(null) };
    const config = { environment: "staging", mail: { domain: "mail.example.test" }, outbox: {
      encryptionKey: "a".repeat(64), keyId: "initial", previousKeys: {}, recipientHashKey: "b".repeat(64) } } as SaasPlatformConfig;
    const mail = transactionalEmail(db, config, { primaryAppOrigin: "https://app.example.test", allowedAppOrigins: ["https://app.example.test"], legacyOrigins: [] }, provider);
    const notice = notificationService(db, mail), queued = await mail.enqueue({ companyId: source.company.id, userId: source.userId,
      purpose: "work_update", recipient: `${source.userId}@example.test`, subject: "Account update", message: "Sign in to review",
      actionPath: `/${source.company.issuePrefix}/issues`, dedupeKey: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) });
    await choose(source);
    await db.delete(chatIdentityLinks).where(eq(chatIdentityLinks.id, source.link.id));
    await notice.notifyCompany(source.company.id, "work_update", "Account update", "issues", randomUUID(), db);
    expect(await db.select().from(emailDeliveries).where(eq(emailDeliveries.companyId, source.company.id))).toHaveLength(1);
    await mail.processOne("bound-email-preflight");
    expect((await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, queued!)))[0]!.status).toBe("suppressed");
    expect(provider.send).not.toHaveBeenCalled();
    await notice.notifyCompany(source.company.id, "security", "Security update", "company/settings/security", randomUUID(), db);
    await mail.processOne("mandatory-security");
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await db.select().from(emailDeliveries).where(and(eq(emailDeliveries.companyId, source.company.id), eq(emailDeliveries.purpose, "security"))))
      .toEqual([expect.objectContaining({ status: "accepted" })]);
  });
  it("stages a fixed notice through the existing effect owner, keeps a digest due and never treats a preference as delivery", async () => {
    const source = await seed(), { owner } = await choose(source);
    const now = new Date("2026-10-15T07:00:00Z");
    await db.update(notificationChannelPreferences).set({ updatedAt: new Date(now.getTime() - 1000), version: 2 }).where(eq(notificationChannelPreferences.companyId, source.company.id));
    await db.insert(saasNotificationPreferences).values({ userId: source.userId, category: "work_update", emailEnabled: false,
      deliveryPolicy: { version: 1, cadence: "digest", timezone: "UTC", quietHours: null, digestMinute: 9 * 60 } });
    const [notice] = await db.insert(saasNotifications).values({ companyId: source.company.id, userId: source.userId, category: "work_update",
      title: "PRIVATE task title", relativePath: `/${source.company.issuePrefix}/issues`, dedupeKey: randomUUID(), createdAt: now }).returning();
    const gateway = notificationChannelDelivery(db, { primaryAppOrigin: "https://app.example.test", allowedAppOrigins: ["https://app.example.test"], legacyOrigins: [] });
    const plan = await db.transaction(tx => gateway.stage(tx as unknown as typeof db, notice!.id, now));
    expect(plan?.text).not.toContain("PRIVATE"); expect(plan?.notBefore.toISOString()).toBe("2026-10-15T09:00:00.000Z");
    const [action] = await db.insert(chatActions).values({ companyId: source.company.id, endpointId: source.endpoint.id, principalId: source.principal.id,
      notificationId: notice!.id, kind: "provider_effect", providerActionId: plan!.providerActionId,
      payload: { version: 1, effect: "thread_message", authorizationMode: "notification", threadId: plan!.threadId, text: plan!.text, settleDelivery: false,
        runtimeGeneration: 0, credentialFingerprint: "a".repeat(64), notificationPreferenceVersion: plan!.preferenceVersion, notificationTargetHash: plan!.targetHash,
        notificationGroupKey: plan!.groupKey, notificationNotBefore: plan!.notBefore.toISOString(), notificationExpiresAt: plan!.expiresAt.toISOString() } }).returning();
    await db.transaction(tx => gateway.record(tx as unknown as typeof db, plan!, action!.id));
    const [second] = await db.insert(saasNotifications).values({ companyId: source.company.id, userId: source.userId, category: "work_update",
      title: "PRIVATE second digest member", relativePath: notice!.relativePath, dedupeKey: randomUUID(), createdAt: now }).returning();
    const secondPlan = await db.transaction(tx => gateway.stage(tx as unknown as typeof db, second!.id, now));
    expect(secondPlan!.providerActionId).toBe(plan!.providerActionId);
    await db.transaction(tx => gateway.record(tx as unknown as typeof db, secondPlan!, action!.id));
    expect(await db.transaction(tx => gateway.stage(tx as unknown as typeof db, second!.id, now))).toBeNull();
    expect(await db.transaction(tx => gateway.admit(tx as unknown as typeof db, action!, now))).toMatchObject({ kind: "defer", userId: source.userId });
    expect(await db.transaction(tx => gateway.admit(tx as unknown as typeof db, action!, new Date("2026-10-15T09:00:00Z")))).toMatchObject({ kind: "admit", userId: source.userId });
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, source.company.id), eq(companyMemberships.principalId, source.userId)));
    expect(await db.transaction(tx => gateway.admit(tx as unknown as typeof db, action!, new Date("2026-10-15T09:00:00Z")))).toEqual({ kind: "deny" });
    expect(await db.select().from(notificationChannelDeliveries).where(eq(notificationChannelDeliveries.notificationId, notice!.id))).toHaveLength(1);
    expect(await db.select().from(notificationChannelDeliveries).where(eq(notificationChannelDeliveries.notificationId, second!.id)))
      .toEqual([expect.objectContaining({ actionId: action!.id, disposition: "staged" })]);
  });
});
