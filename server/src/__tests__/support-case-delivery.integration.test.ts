import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  accountDeletionOperations, authUsers, companies, companyMemberships, supportCases, supportCaseEvents,
  createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
} from "@paperclipai/db";
import type { SupportCaseDataPolicy } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
import {
  supportCaseDeliveryService,
  type SupportCaseGateway,
  type SupportCaseGatewayMessage,
} from "../services/experience/support-case-delivery.js";

const embedded = await getEmbeddedPostgresTestSupport();
const policy: SupportCaseDataPolicy = {
  schemaVersion: 1, policyVersion: "test.support.delivery.v1", recipientName: "Fixture support recipient",
  privacyNoticeUrl: "https://example.test/privacy", processingRegion: "test region",
  retentionTrigger: "after_last_customer_or_support_message", retentionDays: 30,
  backupMaxDays: 7, restoreLagDays: 2, deletionMarkerDays: 10, legalHoldPolicyId: "test.support.hold.v1",
};

(embedded.supported ? describe.sequential : describe.skip)("native support case delivery owner", () => {
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase("support-case-delivery-");
    db = createDb(fixture.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await fixture?.cleanup(); }, 30000);

  async function createPendingCase(input: { dataPolicy?: SupportCaseDataPolicy; expired?: boolean } = {}) {
    const companyId = randomUUID(), userId = randomUUID(), now = new Date();
    const createdAt = input.expired ? new Date(now.getTime() - 3 * 86400000) : now;
    await db.insert(companies).values({ id: companyId, name: "Delivery test company", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Delivery test user", email: `${userId}@delivery.example.test`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "member" });
    const [caseRow] = await db.insert(supportCases).values({ companyId, openedByUserId: userId,
      subject: "Cannot open my work", description: "Please help with this customer request", category: "not_working",
      dataPolicy: input.dataPolicy ?? policy, createdAt, updatedAt: now, lastMessageAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 20 * 86400000) }).returning();
    const eventId = randomUUID(), requestKey = randomUUID();
    const [event] = await db.insert(supportCaseEvents).values({ id: eventId, companyId, caseId: caseRow!.id,
      authorUserId: userId, kind: "request", body: caseRow!.description, customerStatus: "RECEIVED",
      requestKey, requestHash: createHash("sha256").update(`${companyId}:${eventId}`).digest("hex") }).returning();
    if (input.expired)
      await db.execute(sql`update support_cases set expires_at=clock_timestamp()-interval '1 day' where id=${caseRow!.id}::uuid`);
    return { companyId, userId, caseRow: caseRow!, event: event! };
  }

  function service(send: SupportCaseGateway["send"], options: {
    dataPolicy?: SupportCaseDataPolicy; timeoutMs?: number; leaseMs?: number; database?: typeof db;
  } = {}) {
    return supportCaseDeliveryService(options.database ?? db, {
      gateway: { providerKey: "test-support-gateway", send },
      dataPolicy: options.dataPolicy ?? policy,
      ...(options.timeoutMs === undefined ? {} : { transportTimeoutMs: options.timeoutMs }),
      ...(options.leaseMs === undefined ? {} : { deliveryLeaseMs: options.leaseMs }),
    });
  }

  function databaseAfterClaim(beforeEffect: () => Promise<void>) {
    let transactions = 0;
    return new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof db.transaction>) => {
          transactions++;
          const run = () => Reflect.get(target, property, target).apply(target, args);
          if (transactions === 2) return beforeEffect().then(run);
          return run();
        };
      },
    }) as typeof db;
  }

  function acknowledgement(message: SupportCaseGatewayMessage, change: Partial<{ eventId: string; attemptId: string; providerMessageRef: string }> = {}) {
    return { eventId: message.eventId, attemptId: message.attemptId,
      providerMessageRef: "fixture-message-1", ...change };
  }

  async function eventFor(id: string) {
    const [event] = await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.id, id));
    return event!;
  }

  it("commits one exact attempt before transport and records only its matching provider receipt", async () => {
    const seed = await createPendingCase();
    let beginSend!: () => void, releaseSend!: () => void;
    const began = new Promise<void>(resolve => { beginSend = resolve; });
    const release = new Promise<void>(resolve => { releaseSend = resolve; });
    const calls: SupportCaseGatewayMessage[] = [];
    const send: SupportCaseGateway["send"] = async message => {
      calls.push(message); beginSend();
      const [committed] = await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.id, message.eventId));
      expect(committed).toMatchObject({ deliveryState: "sending", deliveryAttemptId: message.attemptId,
        deliveryProviderKey: "test-support-gateway", deliveredAt: null, providerMessageRef: null });
      await release;
      return acknowledgement(message);
    };
    const first = service(send).deliverNext();
    await Promise.race([began, first.then(async result => { const event = await eventFor(seed.event.id);
      throw new Error(`Delivery ended before transport: ${JSON.stringify(result)} state=${JSON.stringify(event)}`); })]);
    expect(await service(send).deliverNext()).toEqual({ status: "idle" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ companyId: seed.companyId, caseId: seed.caseRow.id, eventId: seed.event.id,
      category: "not_working", subject: "Cannot open my work", kind: "request", body: seed.caseRow.description,
      customerStatus: "RECEIVED", safeContext: null });
    expect(Object.keys(calls[0]!).sort()).toEqual(["companyId", "caseId", "eventId", "attemptId", "category", "subject",
      "kind", "body", "customerStatus", "safeContext", "createdAt"].sort());
    expect(JSON.stringify(calls[0])).not.toContain("dataPolicy");
    releaseSend();
    expect(await first).toEqual({ status: "delivered", eventId: seed.event.id });
    expect(await eventFor(seed.event.id)).toMatchObject({ deliveryState: "delivered", deliveryAttemptId: calls[0]!.attemptId,
      deliveryProviderKey: "test-support-gateway", providerMessageRef: "fixture-message-1" });
  });

  it("marks thrown, timed out, and mismatched acknowledgements unknown without retry", async () => {
    const thrown = await createPendingCase();
    expect(await service(async () => { throw new Error("private provider diagnostic"); }).deliverNext())
      .toEqual({ status: "unknown", eventId: thrown.event.id });
    expect((await eventFor(thrown.event.id)).deliveryState).toBe("unknown");

    const timedOut = await createPendingCase();
    let lateResolve!: (value: unknown) => void, aborted = false;
    const late = new Promise<unknown>(resolve => { lateResolve = resolve; });
    const timeoutService = service((_message, signal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return late;
    }, { timeoutMs: 20 });
    expect(await timeoutService.deliverNext()).toEqual({ status: "unknown", eventId: timedOut.event.id });
    expect(aborted).toBe(true);
    const timedOutEvent = await eventFor(timedOut.event.id);
    expect(timedOutEvent.deliveryState).toBe("unknown");
    lateResolve(acknowledgement({ eventId: timedOut.event.id, attemptId: timedOutEvent.deliveryAttemptId!,
      companyId: timedOut.companyId, caseId: timedOut.caseRow.id, category: "not_working", subject: "x",
      kind: "request", body: "x", customerStatus: "RECEIVED", safeContext: null, createdAt: new Date().toISOString() }));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await eventFor(timedOut.event.id)).deliveryState).toBe("unknown");

    const mismatched = await createPendingCase();
    expect(await service(async message => acknowledgement(message, { eventId: randomUUID() })).deliverNext())
      .toEqual({ status: "unknown", eventId: mismatched.event.id });
    expect(await eventFor(mismatched.event.id)).toMatchObject({ deliveryState: "unknown", deliveredAt: null, providerMessageRef: null });
    expect(await service(async () => { throw new Error("must never retry"); }).deliverNext()).toEqual({ status: "idle" });
  });

  it("refuses mismatched policy, revoked membership, account deletion, and expired cases", async () => {
    const stalePolicy = await createPendingCase();
    const changedPolicy = { ...policy, policyVersion: "test.support.delivery.changed" };
    const send = vi.fn(async (message: SupportCaseGatewayMessage) => acknowledgement(message));
    expect(await service(send, { dataPolicy: changedPolicy }).deliverNext()).toEqual({ status: "idle" });
    expect(send).not.toHaveBeenCalled();
    expect((await eventFor(stalePolicy.event.id)).deliveryState).toBe("pending");
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(
      eq(companyMemberships.companyId, stalePolicy.companyId), eq(companyMemberships.principalId, stalePolicy.userId)));

    const revoked = await createPendingCase();
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(
      eq(companyMemberships.companyId, revoked.companyId), eq(companyMemberships.principalId, revoked.userId)));
    expect(await service(send).deliverNext()).toEqual({ status: "idle" });
    expect((await eventFor(revoked.event.id)).deliveryState).toBe("pending");

    const deleting = await createPendingCase();
    await db.insert(accountDeletionOperations).values({ userId: deleting.userId,
      idempotencyKey: createHash("sha256").update(deleting.userId).digest("hex") });
    expect(await service(send).deliverNext()).toEqual({ status: "idle" });
    expect((await eventFor(deleting.event.id)).deliveryState).toBe("pending");

    const expired = await createPendingCase({ expired: true });
    expect(await service(send).deliverNext()).toEqual({ status: "idle" });
    expect((await eventFor(expired.event.id)).deliveryState).toBe("pending");
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves a late database-clock acknowledgement unknown and rejects missing complete policy", async () => {
    const seed = await createPendingCase();
    const lateService = service(async message => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return acknowledgement(message);
    }, { timeoutMs: 1000, leaseMs: 20 });
    expect(await lateService.deliverNext()).toEqual({ status: "unknown", eventId: seed.event.id });
    expect(await eventFor(seed.event.id)).toMatchObject({ deliveryState: "unknown", deliveredAt: null, providerMessageRef: null });
    expect(() => supportCaseDeliveryService(db, { gateway: { providerKey: "test", send: async () => ({}) },
      dataPolicy: {} as SupportCaseDataPolicy })).toThrow();
  });

  it("rechecks membership and deletion after the committed claim and before transport", async () => {
    const revoked = await createPendingCase();
    const send = vi.fn(async (message: SupportCaseGatewayMessage) => acknowledgement(message));
    const revokedDb = databaseAfterClaim(async () => {
      const claimed = await eventFor(revoked.event.id);
      expect(claimed.deliveryState).toBe("sending");
      await db.transaction(async tx => {
        await tx.execute(sql`select id from companies where id=${revoked.companyId}::uuid for update`);
        await tx.update(companyMemberships).set({ status: "inactive" }).where(and(
          eq(companyMemberships.companyId, revoked.companyId), eq(companyMemberships.principalId, revoked.userId)));
      });
    });
    expect(await service(send, { database: revokedDb }).deliverNext())
      .toEqual({ status: "unknown", eventId: revoked.event.id });
    expect(send).not.toHaveBeenCalled();
    expect((await eventFor(revoked.event.id)).deliveryState).toBe("unknown");

    const deleting = await createPendingCase();
    const deletionSend = vi.fn(async (message: SupportCaseGatewayMessage) => acknowledgement(message));
    const deletingDb = databaseAfterClaim(async () => {
      const claimed = await eventFor(deleting.event.id);
      expect(claimed.deliveryState).toBe("sending");
      await db.transaction(async tx => {
        await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, deleting.userId)).for("update");
        await tx.insert(accountDeletionOperations).values({ userId: deleting.userId,
          idempotencyKey: createHash("sha256").update(`post-claim:${deleting.userId}`).digest("hex") });
      });
    });
    expect(await service(deletionSend, { database: deletingDb }).deliverNext())
      .toEqual({ status: "unknown", eventId: deleting.event.id });
    expect(deletionSend).not.toHaveBeenCalled();
    expect((await eventFor(deleting.event.id)).deliveryState).toBe("unknown");
  });

  it("keeps the effect fence locked through send and processes a case in customer-event order", async () => {
    const seed = await createPendingCase();
    const ownerId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: ownerId, name: "Current case owner", email: `${ownerId}@delivery.example.test`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: seed.companyId, principalType: "user", principalId: ownerId,
      status: "active", membershipRole: "owner" });
    const replyId = randomUUID();
    await db.insert(supportCaseEvents).values({ id: replyId, companyId: seed.companyId, caseId: seed.caseRow.id,
      authorUserId: ownerId, kind: "customer_reply", body: "An owner replied after the initial request.",
      customerStatus: "RECEIVED", requestKey: randomUUID(), requestHash: createHash("sha256").update(replyId).digest("hex"),
      createdAt: new Date(seed.event.createdAt.getTime() + 1000) });

    let beginSend!: () => void, releaseSend!: () => void;
    const began = new Promise<void>(resolve => { beginSend = resolve; });
    const release = new Promise<void>(resolve => { releaseSend = resolve; });
    const sent: SupportCaseGatewayMessage[] = [];
    const orderedSend: SupportCaseGateway["send"] = async message => {
      sent.push(message); beginSend();
      if (message.eventId === seed.event.id) await release;
      return acknowledgement(message);
    };
    const first = service(orderedSend).deliverNext();
    await began;
    expect(sent.map(row => row.eventId)).toEqual([seed.event.id]);
    let revoked = false;
    const revoke = db.update(companyMemberships).set({ status: "inactive" }).where(and(
      eq(companyMemberships.companyId, seed.companyId), eq(companyMemberships.principalId, seed.userId)))
      .then(() => { revoked = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(revoked).toBe(false);
    releaseSend();
    expect(await first).toEqual({ status: "delivered", eventId: seed.event.id });
    await revoke;
    expect(await service(orderedSend).deliverNext()).toEqual({ status: "delivered", eventId: replyId });
    expect(sent.map(row => row.eventId)).toEqual([seed.event.id, replyId]);

    const blocked = await createPendingCase();
    const blockedReplyId = randomUUID();
    await db.insert(supportCaseEvents).values({ id: blockedReplyId, companyId: blocked.companyId, caseId: blocked.caseRow.id,
      authorUserId: blocked.userId, kind: "customer_reply", body: "Later reply", customerStatus: "RECEIVED",
      requestKey: randomUUID(), requestHash: createHash("sha256").update(blockedReplyId).digest("hex"),
      createdAt: new Date(blocked.event.createdAt.getTime() + 1000) });
    const blockedCalls: string[] = [];
    const unknownSend = service(async message => {
      blockedCalls.push(message.eventId);
      return acknowledgement(message, { attemptId: randomUUID() });
    });
    expect(await unknownSend.deliverNext()).toEqual({ status: "unknown", eventId: blocked.event.id });
    expect(await unknownSend.deliverNext()).toEqual({ status: "idle" });
    expect(blockedCalls).toEqual([blocked.event.id]);
    expect((await eventFor(blockedReplyId)).deliveryState).toBe("pending");
  });
});
