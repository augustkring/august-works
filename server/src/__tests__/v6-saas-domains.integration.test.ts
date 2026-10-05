import { saasInvitationService } from "../services/saas/invitations.js";
import { notificationService } from "../services/notifications/notifications.js";
import {
  agentIdentities,
  approvals,
  agents,
  agentWakeupRequests,
  companyOnboardingRuns,
  heartbeatRuns,
  issues,
  foundationDocuments,
  invites,
  saasNotifications,
  activityLog,
  usageAggregates,
} from "@paperclipai/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  authUsers,
  billingAccounts,
  billingCatalogMappings,
  billingCheckoutIntents,
  billingSubscriptions,
  billingWebhookEvents,
  companyMemberships,
  emailDeliveries,
  environments,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasSupportService } from "../services/saas/support.js";
import { billingService } from "../services/billing/billing.js";
import {
  BillingProviderError,
  type BillingProvider,
  type PaddleSubscription,
} from "../services/billing/paddle-provider.js";
import { entitlementService } from "../services/billing/entitlements.js";
import { usageService } from "../services/billing/usage.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { transactionalEmail } from "../services/notifications/transactional-email.js";
import {
  ProviderDeliveryError,
  type TransactionalEmailProvider,
} from "../services/notifications/mailgun-provider.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const NOW = new Date("2026-10-04T12:00:00Z");
const KEY = "a".repeat(64);
suite("V6 durable SaaS domains against migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const userId = "v6-founder";
  let companyId: string, accountId: string;
  let baselineEnvironments: number;
  const provider: BillingProvider = {
    getSubscription: vi.fn(),
    createCustomer: vi.fn(),
    createCheckout: vi.fn(),
    getTransaction: vi.fn(),
    portal: vi.fn(),
    cancelSubscription: vi.fn(),
    listSubscriptions: vi.fn(),
    findCustomer: vi.fn(),
    findCheckout: vi.fn(),
  };
  const billingConfig = {
    environment: "sandbox" as const,
    payloadKey: KEY,
    payloadKeyId: "initial",
    previousKeys: {},
    graceDays: 7,
  };
  const subscription = (
    updated = "2026-10-04T10:00:00Z",
    status: PaddleSubscription["status"] = "active",
  ): PaddleSubscription => ({
    id: "sub_test",
    customer_id: "ctm_test",
    status,
    updated_at: updated,
    current_billing_period: {
      starts_at: "2026-10-01T00:00:00Z",
      ends_at: "2026-11-01T00:00:00Z",
    },
    scheduled_change: null,
    items: [
      { price: { id: "pri_platform" }, quantity: 1 },
      { price: { id: "pri_runtime" }, quantity: 2 },
    ],
  });
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v6-domains-");
    db = createDb(database.connectionString);
    await db.insert(authUsers).values({
      id: userId,
      email: "founder@example.test",
      name: "Founder",
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    baselineEnvironments = (await db.select().from(environments)).length;
    const run = await saasOnboardingService(db).create(userId, {
      name: "V6 company",
      idempotencyKey: "create-company-fixture-001",
    });
    companyId = run.companyId;
    accountId = run.billingAccountId;
    await db
      .update(billingAccounts)
      .set({ providerCustomerId: "ctm_test" })
      .where(eq(billingAccounts.id, accountId));
    await db.insert(billingCatalogMappings).values([
      {
        environment: "sandbox",
        productKey: "platform",
        priceKey: "platform-monthly",
        providerPriceId: "pri_platform",
        providerProductId: "pro_platform",
        effectiveFrom: new Date("2026-01-01"),
      },
      {
        environment: "sandbox",
        productKey: "runtime_standard",
        priceKey: "runtime-monthly",
        providerPriceId: "pri_runtime",
        providerProductId: "pro_runtime",
        effectiveFrom: new Date("2026-01-01"),
      },
    ]);
  }, 60000);
  afterAll(async () => {
    await database?.cleanup();
  }, 30000);
  it("replays company creation atomically, grants one owner and creates no local execution environment", async () => {
    const service = saasOnboardingService(db);
    const requests = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.create(userId, {
          name: "V6 company",
          idempotencyKey: "create-company-fixture-001",
        }),
      ),
    );
    expect(new Set(requests.map((r) => r.companyId))).toEqual(
      new Set([companyId]),
    );
    expect(
      await db
        .select()
        .from(companyMemberships)
        .where(eq(companyMemberships.companyId, companyId)),
    ).toHaveLength(1);
    expect(await db.select().from(environments)).toHaveLength(
      baselineEnvironments,
    );
    await expect(
      service.create(userId, {
        name: "Different",
        idempotencyKey: "create-company-fixture-001",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await db.insert(authUsers).values({
      id: "unverified",
      email: "unverified@example.test",
      name: "Unverified",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expect(
      service.create("unverified", {
        name: "Denied",
        idempotencyKey: "unverified-request-001",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("normalizes concurrent duplicates and ignores older subscription versions", async () => {
    const service = billingService(db, billingConfig, provider);
    const outcomes = await Promise.all([
      service.normalize(subscription(), NOW),
      service.normalize(subscription(), NOW),
    ]);
    expect(outcomes.sort()).toEqual(["applied", "duplicate"]);
    expect(
      await service.normalize(
        subscription("2026-10-03T10:00:00Z", "canceled"),
        NOW,
      ),
    ).toBe("ignored_stale");
    const state = await entitlementService(db).resolve(companyId, NOW);
    expect(state.entitlements["platform.access"]).toBe(true);
    expect(state.entitlements["hosted_runtime.standard.max_cells"]).toBe("2");
    expect(await db.select().from(billingSubscriptions)).toHaveLength(1);
    await expect(
      service.normalize(
        { ...subscription("2026-10-04T11:00:00Z"), customer_id: "ctm_unknown" },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "paddle_customer_unmapped" });
  });
  it("allows existing work during grace while blocking new runtime, then becomes read only", async () => {
    await billingService(db, billingConfig, provider).normalize(
      subscription("2026-10-04T11:00:00Z", "past_due"),
      NOW,
    );
    const service = entitlementService(db);
    const grace = await service.resolve(companyId, NOW);
    expect(grace.access).toBe("grace");
    expect(grace.entitlements["platform.access"]).toBe(true);
    expect(grace.entitlements["hosted_runtime.provision"]).toBe(false);
    const expired = await service.resolve(
      companyId,
      new Date(NOW.getTime() + 8 * 86400000),
    );
    expect(expired.access).toBe("read_only");
    expect(expired.entitlements["platform.access"]).toBe(false);
  });
  it("encrypts webhook payloads, rejects duplicate evidence collisions and processes canonical provider state", async () => {
    vi.mocked(provider.getSubscription).mockResolvedValue(
      subscription("2026-10-04T12:00:00Z"),
    );
    const service = billingService(db, billingConfig, provider);
    const event = {
      event_id: "evt_fixture",
      event_type: "subscription.updated",
      occurred_at: NOW.toISOString(),
      data: { id: "sub_test", private_payer_value: "must-not-be-plaintext" },
    };
    const raw = Buffer.from(JSON.stringify(event));
    expect(await service.receive(raw)).toBeTruthy();
    expect(await service.receive(raw)).toBeNull();
    const [row] = await db.select().from(billingWebhookEvents);
    expect(row!.payloadCiphertext).not.toContain("must-not-be-plaintext");
    await expect(
      service.receive(
        Buffer.from(
          JSON.stringify({ ...event, event_type: "subscription.canceled" }),
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await service.processOne("worker", new Date())).toBe(true);
    const [processed] = await db.select().from(billingWebhookEvents);
    expect(processed!.status).toBe("processed");
    expect(processed!.payloadCiphertext).toBeNull();
  });
  it("persists one checkout and never retries an ambiguous chargeable provider call", async () => {
    vi.mocked(provider.createCheckout).mockRejectedValue(
      new BillingProviderError("paddle_unavailable", true),
    );
    vi.mocked(provider.findCheckout).mockResolvedValue({
      transactionId: "txn_recovered",
      url: "https://checkout.example.test/fixture",
    });
    const service = billingService(db, billingConfig, provider);
    const input = {
      productKey: "platform",
      priceKey: "platform-monthly",
      idempotencyKey: "checkout-fixture-001",
    };
    const a = await service.checkout(companyId, userId, input, NOW);
    const b = await service.checkout(companyId, userId, input, NOW);
    expect(a.id).toBe(b.id);
    await expect(
      service.checkout(
        companyId,
        userId,
        { ...input, idempotencyKey: "checkout-fixture-002" },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await service.processCheckout(NOW);
    await service.processCheckout(NOW);
    expect(provider.createCheckout).toHaveBeenCalledTimes(1);
    const [uncertain] = await db.select().from(billingCheckoutIntents);
    expect(uncertain!.status).toBe("needs_reconciliation");
    await service.reconcileCheckouts(NOW);
    const [recovered] = await db.select().from(billingCheckoutIntents);
    expect(recovered!.providerTransactionId).toBe("txn_recovered");
    expect(recovered!.status).toBe("ready");
    expect(provider.createCheckout).toHaveBeenCalledTimes(1);
  });
  it("deduplicates large integer usage and preserves exact totals across bucket boundaries", async () => {
    const service = usageService(db);
    const start = new Date("2026-10-01T23:59:59.997Z"),
      end = new Date("2026-10-02T00:00:00.004Z");
    const quantity = 900719925474099312345n;
    const input = {
      companyId,
      meterKey: "storage.byte_millisecond" as const,
      resourceType: "artifact",
      resourceId: randomUUID(),
      quantity,
      periodStart: start,
      periodEnd: end,
      sourceEventId: "storage-sample-001",
    };
    expect(await service.record(input)).toBeTruthy();
    expect(await service.record(input)).toBeNull();
    await expect(
      service.record({ ...input, quantity: quantity + 1n }),
    ).rejects.toMatchObject({ status: 409 });
    const first = await service.rebuild(
      companyId,
      new Date("2026-10-01"),
      new Date("2026-10-02"),
    );
    const second = await service.rebuild(
      companyId,
      new Date("2026-10-02"),
      new Date("2026-10-03"),
    );
    expect(
      BigInt(first["storage.byte_millisecond"]!) +
        BigInt(second["storage.byte_millisecond"]!),
    ).toBe(quantity);
    expect(
      await service.rebuild(
        companyId,
        new Date("2026-10-01"),
        new Date("2026-10-02"),
      ),
    ).toEqual(first);
    // A late source event dirties persisted UTC buckets, even when a previous daily rebuild succeeded.
    await service.record({
      ...input,
      sourceEventId: "late-storage-sample",
      quantity: 7n,
    });
    expect(await service.rebuildDirtyDays(new Date(Date.now() + 1000))).toBe(2);
    const rows = await db
      .select()
      .from(usageAggregates)
      .where(eq(usageAggregates.companyId, companyId));
    expect(rows.reduce((total, row) => total + BigInt(row.quantity), 0n)).toBe(
      quantity + 7n,
    );
    expect(await service.rebuildDirtyDays(new Date(Date.now() + 2000))).toBe(0);
  });
  it("requires independent owner-approved support scope, expires and revokes access, and replays audited overrides", async () => {
    const service = saasSupportService(db, {
      operatorUserIds: ["operator"],
    } as SaasPlatformConfig);
    const input = {
      companyId,
      operatorUserId: "operator",
      reason: "Investigate runtime health",
      scopes: ["status:read", "billing:override"],
      expiresInMinutes: 10,
    };
    await expect(
      service.approve(companyId, "operator", input, NOW),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.approve(companyId, "outsider", input, NOW),
    ).rejects.toMatchObject({ status: 403 });
    const session = await service.approve(companyId, userId, input, NOW);
    await expect(
      service.authorize(session.id, "operator", "runtime:manage", NOW),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.authorize(session.id, userId, "status:read", NOW),
    ).rejects.toMatchObject({ status: 403 });
    const override = {
      companyId,
      key: "platform.access",
      value: true,
      reason: "Temporary onboarding assistance",
      expiresAt: new Date(NOW.getTime() + 86400000).toISOString(),
      idempotencyKey: "override-fixture-key-001",
    };
    const records = await Promise.all([
      service.override(session.id, "operator", override, NOW),
      service.override(session.id, "operator", override, NOW),
    ]);
    expect(records[0]!.id).toBe(records[1]!.id);
    await expect(
      service.override(
        session.id,
        "operator",
        { ...override, value: false },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.authorize(
        session.id,
        "operator",
        "status:read",
        new Date(NOW.getTime() + 600001),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await service.revoke(companyId, userId, session.id, NOW);
    await expect(
      service.authorize(session.id, "operator", "status:read", NOW),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("keeps one expiring encrypted email, handles lost acknowledgement by logical message ID and suppresses complaints", async () => {
    const mailProvider: TransactionalEmailProvider = {
      send: vi.fn().mockRejectedValue(new Error("provider acceptance unknown")),
      find: vi.fn().mockResolvedValue(null),
    };
    const config = {
      environment: "staging",
      mail: { domain: "mail.example.test" },
      outbox: {
        encryptionKey: KEY,
        keyId: "initial",
        previousKeys: {},
        recipientHashKey: "b".repeat(64),
      },
    } as SaasPlatformConfig;
    const email = transactionalEmail(
      db,
      config,
      {
        primaryAppOrigin: "https://app.example.test",
        allowedAppOrigins: ["https://app.example.test"],
        legacyOrigins: [],
      },
      mailProvider,
    );
    const input = {
      purpose: "verification" as const,
      recipient: "founder@example.test",
      subject: "Verify",
      message: "<script>private token</script>",
      actionPath: "/verify?token=secret-fixture",
      dedupeKey: "verify-001",
      expiresAt: new Date(Date.now() + 60000),
    };
    const id = await email.enqueue(input);
    expect(id).toBeTruthy();
    expect(await email.enqueue(input)).toBeNull();
    const [before] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, id!));
    expect(JSON.stringify(before)).not.toContain("secret-fixture");
    expect(JSON.stringify(before)).not.toContain("founder@example.test");
    await email.processOne("email-worker");
    const [failed] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, id!));
    expect(failed!.status).toBe("failed");
    const message = vi.mocked(mailProvider.send).mock.calls[0]![0];
    expect(message.html).not.toContain("<script>");
    expect(message.text).toContain("https://app.example.test/verify");
    const delivered = {
      eventId: "mail-delivered",
      messageId: `<${id}@mail.example.test>`,
      event: "delivered",
      recipient: input.recipient,
      payloadHash: "1".repeat(64),
    };
    await email.recordProviderEvent(delivered);
    expect(await email.recordProviderEvent(delivered)).toBe(false);
    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, id!));
    expect(after!.status).toBe("delivered");
    expect(after!.payloadCiphertext).toBeNull();
    await email.recordProviderEvent({
      ...delivered,
      eventId: "mail-complained",
      event: "complained",
    });
    const suppressedId = await email.enqueue({
      ...input,
      dedupeKey: "verify-002",
    });
    await email.processOne("worker-2", new Date(Date.now() + 1000));
    const [suppressed] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, suppressedId!));
    expect(suppressed!.status).toBe("suppressed");
    expect(mailProvider.send).toHaveBeenCalledTimes(1);
  });
  it("creates an owner mission through Foundation governance with onboarding CAS", async () => {
    const service = saasOnboardingService(db),
      run = await service.get(companyId);
    const next = await service.update(companyId, userId, {
      expectedVersion: run.version,
      stage: "plan",
      answers: { mission: "Help our customers plan safely." },
    });
    expect(next.answers.missionFoundationId).toBeTruthy();
    const [mission] = await db
      .select()
      .from(foundationDocuments)
      .where(eq(foundationDocuments.companyId, companyId));
    expect(mission).toMatchObject({
      foundationKey: "mission",
      status: "draft",
      ownerUserId: userId,
    });
    await expect(
      service.update(companyId, userId, {
        expectedVersion: run.version,
        stage: "plan",
        answers: { mission: "Stale update" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("binds one encrypted invitation to its verified recipient and keeps notifications company/user scoped", async () => {
    const config = {
      environment: "staging",
      mail: { domain: "mail.example.test" },
      outbox: {
        encryptionKey: KEY,
        keyId: "initial",
        previousKeys: {},
        recipientHashKey: "b".repeat(64),
      },
    } as SaasPlatformConfig;
    const email = transactionalEmail(
      db,
      config,
      {
        primaryAppOrigin: "https://app.example.test",
        allowedAppOrigins: ["https://app.example.test"],
        legacyOrigins: [],
      },
      { send: vi.fn(), find: vi.fn() },
    );
    const invitation = saasInvitationService(db, config, email),
      input = {
        email: "recipient@example.test",
        role: "member" as const,
        idempotencyKey: "invite-test-key-00001",
      };
    const rows = await Promise.all([
      invitation.issue(companyId, userId, input),
      invitation.issue(companyId, userId, input),
    ]);
    expect(rows[0]!.id).toBe(rows[1]!.id);
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, rows[0]!.id));
    expect(JSON.stringify(invite)).not.toContain(input.email);
    const queued = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.dedupeKey, "company-invite:" + invite!.id));
    expect(queued).toHaveLength(1);
    expect(JSON.stringify(queued)).not.toContain("pcp_invite_");
    await db.insert(authUsers).values({
      id: "recipient",
      name: "Recipient",
      email: input.email,
      emailVerified: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expect(
      invitation.assertRecipient(invite!, userId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      invitation.assertRecipient(invite!, "recipient"),
    ).rejects.toMatchObject({ status: 403 });
    await db
      .update(authUsers)
      .set({ emailVerified: true })
      .where(eq(authUsers.id, "recipient"));
    await invitation.assertRecipient(invite!, "recipient");
    await expect(
      invitation.issue(companyId, userId, {
        ...input,
        email: "changed@example.test",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const notifications = notificationService(db, email);
    await notifications.updatePreference(companyId, userId, {
      category: "runtime",
      emailEnabled: false,
    });
    await expect(
      notifications.updatePreference(companyId, userId, {
        category: "security",
        emailEnabled: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const notify = () =>
      db.transaction((tx) =>
        notifications.notifyCompany(
          companyId,
          "runtime",
          "Runtime needs attention",
          "company/settings/runtime",
          "incident-001",
          tx,
        ),
      );
    await Promise.all([notify(), notify()]);
    const notes = await notifications.list(companyId, userId);
    expect(notes).toHaveLength(1);
    expect(
      await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.dedupeKey, "notification:" + notes[0]!.id)),
    ).toHaveLength(0);
    await expect(
      notifications.list(companyId, "recipient"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      notifications.markRead(companyId, "recipient", notes[0]!.id),
    ).rejects.toMatchObject({ status: 403 });
    await notifications.markRead(companyId, userId, notes[0]!.id);
    expect(
      (await notifications.list(companyId, userId))[0]!.readAt,
    ).toBeTruthy();
  });

  it("delivers native work updates once, respects optional email and pages unread rows across equal timestamps", async () => {
    const run = await saasOnboardingService(db).create(userId, {
      name: "Notification paging",
      idempotencyKey: "notification-paging-001",
    });
    const email = transactionalEmail(
      db,
      {
        environment: "staging",
        mail: { domain: "mail.example.test" },
        outbox: {
          encryptionKey: KEY,
          keyId: "initial",
          previousKeys: {},
          recipientHashKey: "b".repeat(64),
        },
      } as SaasPlatformConfig,
      {
        primaryAppOrigin: "https://app.example.test",
        allowedAppOrigins: ["https://app.example.test"],
        legacyOrigins: [],
      },
      { send: vi.fn(), find: vi.fn() },
    );
    const notifications = notificationService(db, email);
    await notifications.updatePreference(run.companyId, userId, {
      category: "approval",
      emailEnabled: false,
    });
    const [event] = await db
      .insert(activityLog)
      .values({
        companyId: run.companyId,
        actorType: "system",
        actorId: "fixture",
        action: "approval.created",
        entityType: "approval",
        entityId: randomUUID(),
        details: { privateContent: "must not appear in notifications" },
      })
      .returning();
    await Promise.all([
      notifications.processWorkUpdate(),
      notifications.processWorkUpdate(),
    ]);
    const notes = await notifications.list(run.companyId, userId);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.category).toBe("approval");
    expect(JSON.stringify(notes)).not.toContain("privateContent");
    expect(
      await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.dedupeKey, "notification:" + notes[0]!.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityType, "saas_notification_event"),
            eq(activityLog.entityId, event!.id),
          ),
        ),
    ).toHaveLength(1);
    await db.insert(saasNotifications).values(
      Array.from({ length: 60 }, (_, i) => ({
        companyId: run.companyId,
        userId,
        category: "work_update",
        title: "A task has an update",
        relativePath: "/" + run.companyId + "/issues",
        dedupeKey: "page-fixture:" + i,
        createdAt: NOW,
      })),
    );
    const first = await notifications.listPage(
        run.companyId,
        userId,
        null,
        true,
      ),
      second = await notifications.listPage(
        run.companyId,
        userId,
        first.nextCursor,
        true,
      );
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(11);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((note) => note.id)).size,
    ).toBe(61);
    await notifications.markRead(run.companyId, userId, first.items[0]!.id);
    expect(
      (
        await notifications.listPage(run.companyId, userId, null, true)
      ).items.some((note) => note.id === first.items[0]!.id),
    ).toBe(false);
    await expect(
      notifications.listPage(run.companyId, userId, "invalid"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      notifications.listPage(
        run.companyId,
        "recipient",
        first.nextCursor,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("creates one first agent after concurrent retries and preserves native hire approval", async () => {
    const service = saasOnboardingService(db),
      run = await service.get(companyId);
    await db
      .update(companyOnboardingRuns)
      .set({ currentStage: "agent" })
      .where(eq(companyOnboardingRuns.id, run.id));
    await expect(
      service.update(companyId, userId, {
        expectedVersion: run.version,
        stage: "agent",
        answers: {
          createdFirstAgentId: randomUUID(),
          createdFirstAgentName: "Forged",
        },
      }),
    ).rejects.toMatchObject({ status: 422 });
    const input = {
      expectedVersion: run.version,
      name: "Governed first agent",
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.firstAgent(companyId, userId, input),
      ),
    );
    expect(new Set(results.map((r) => r.agentId)).size).toBe(1);
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, results[0]!.agentId));
    expect(agent).toMatchObject({
      status: "pending_approval",
      adapterType: "openclaw_gateway",
      budgetMonthlyCents: 0,
      runtimeConfig: { heartbeat: { enabled: false } },
    });
    const [approval] = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, results[0]!.approvalId as string));
    expect(approval).toMatchObject({
      status: "pending",
      type: "hire_agent",
      payload: { agentId: agent!.id },
    });
    expect(await service.firstAgent(companyId, userId, input)).toEqual(
      results[0],
    );
    await expect(
      service.firstAgent(companyId, userId, { ...input, name: "Different" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.firstAgent(companyId, "unrelated-user", input),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.companyId, companyId)),
    ).toHaveLength(0);
  });
  it("serializes starter-task retries without waking an agent and requires actual successful execution", async () => {
    const service = saasOnboardingService(db),
      run = await service.get(companyId);
    const [identity] = await db
      .insert(agentIdentities)
      .values({ name: "Starter persona", homeCompanyId: companyId })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        companyId,
        agentIdentityId: identity!.id,
        name: "Starter agent",
        adapterType: "openclaw_gateway",
        status: "paused",
        pauseReason: "budget",
      })
      .returning();
    await db
      .update(companyOnboardingRuns)
      .set({
        currentStage: "first_task",
        answers: { ...run.answers, agentId: agent!.id },
      })
      .where(eq(companyOnboardingRuns.id, run.id));
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.starterTask(companyId, userId, run.version),
      ),
    );
    expect(new Set(results.map((result) => result.issueId)).size).toBe(1);
    const issueId = results[0]!.issueId;
    const [task] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(task).toMatchObject({
      companyId,
      status: "backlog",
      assigneeAgentId: agent!.id,
    });
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.companyId, companyId)),
    ).toHaveLength(0);
    expect(
      (await db.select().from(agents).where(eq(agents.id, agent!.id)))[0]!
        .pauseReason,
    ).toBe("budget");
    const current = await service.get(companyId),
      finish = {
        expectedVersion: current.version,
        stage: "complete",
        answers: {},
      };
    await expect(
      service.update(companyId, userId, finish),
    ).rejects.toMatchObject({ status: 422 });
    await db.insert(heartbeatRuns).values({
      companyId,
      agentId: agent!.id,
      status: "succeeded",
      contextSnapshot: { issueId: randomUUID() },
    });
    await expect(
      service.update(companyId, userId, finish),
    ).rejects.toMatchObject({ status: 422 });
    await db.insert(heartbeatRuns).values({
      companyId,
      agentId: agent!.id,
      status: "succeeded",
      contextSnapshot: { issueId },
    });
    expect((await service.update(companyId, userId, finish)).status).toBe(
      "completed",
    );
  });
});
