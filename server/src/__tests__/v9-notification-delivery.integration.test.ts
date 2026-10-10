import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { authUsers, companies, companyMemberships, createDb, emailDeliveries, saasNotificationPreferences } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { transactionalEmail } from "../services/notifications/transactional-email.js";
import { ProviderDeliveryError, type TransactionalEmailProvider } from "../services/notifications/mailgun-provider.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { notificationService } from "../services/notifications/notifications.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const config = { environment: "staging", mail: { domain: "mail.example.test" },
  outbox: { encryptionKey: "a".repeat(64), keyId: "initial", previousKeys: {}, recipientHashKey: "b".repeat(64) } } as SaasPlatformConfig;
const origins = { primaryAppOrigin: "https://app.example.test", allowedAppOrigins: ["https://app.example.test"], legacyOrigins: [] };

suite("V9 notification delivery through the original encrypted outbox", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-notification-delivery-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ notification_policy_v9: true });
  }, 60_000);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  const row = async (id: string) => (await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, id)))[0]!;
  async function fixture(provider?: TransactionalEmailProvider, purpose: "work_update" | "security" = "work_update") {
    const userId = randomUUID(), recipient = `${userId}@example.test`;
    await db.insert(authUsers).values({ id: userId, email: recipient, name: "Owner", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    const run = await saasOnboardingService(db).create(userId, { name: "Notification boundary", idempotencyKey: randomUUID() });
    const mail = provider ?? { send: vi.fn().mockResolvedValue({ providerMessageId: randomUUID() }), find: vi.fn().mockResolvedValue(null) };
    const email = transactionalEmail(db, config, origins, mail);
    const notifications = notificationService(db, email);
    const id = (await email.enqueue({ companyId: run.companyId, userId, purpose, recipient,
      subject: "A task has an update", message: "Sign in to review it", actionPath: `/${run.companyId}/issues`, dedupeKey: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000) }))!;
    return { userId, recipient, companyId: run.companyId, mail, email, notifications, id };
  }

  it("never resends an unknown acceptance, and accepts a late exact receipt after quarantine", async () => {
    const f = await fixture({ send: vi.fn().mockRejectedValue(new Error("acceptance unknown")), find: vi.fn().mockResolvedValue(null) });
    const now = new Date();
    await f.email.processOne("original", now);
    expect(await row(f.id)).toMatchObject({ status: "failed", errorCode: "delivery_acceptance_unknown", attempts: 1 });
    for (let n = 1; n < 5; n++) await f.email.processOne(`lookup-${n}`, new Date(now.getTime() + n * 3600000));
    expect(f.mail.send).toHaveBeenCalledTimes(1);
    expect(f.mail.find).toHaveBeenCalledTimes(4);
    expect(await row(f.id)).toMatchObject({ status: "quarantined", errorCode: "delivery_acceptance_unknown", payloadCiphertext: null });
    await f.email.recordProviderEvent({ eventId: randomUUID(), messageId: `<${f.id}@mail.example.test>`, event: "delivered", recipient: f.recipient, payloadHash: "1".repeat(64) });
    expect(await row(f.id)).toMatchObject({ status: "delivered", payloadCiphertext: null });
    expect(f.mail.send).toHaveBeenCalledTimes(1);
  });

  it("reconciles a positive lookup with the original ID and no second send", async () => {
    const f = await fixture({ send: vi.fn().mockRejectedValue(new Error("acknowledgement lost")), find: vi.fn().mockResolvedValue("provider-owned") });
    await f.email.processOne("original");
    await f.email.processOne("receipt", new Date(Date.now() + 60000));
    expect(f.mail.find).toHaveBeenCalledWith(`<${f.id}@mail.example.test>`);
    expect(f.mail.send).toHaveBeenCalledTimes(1);
    expect(await row(f.id)).toMatchObject({ status: "accepted", providerMessageId: "provider-owned", payloadCiphertext: null });
  });

  it("does not renew a send after a crashed final lease and records a late delivered fact", async () => {
    const f = await fixture();
    await db.update(emailDeliveries).set({ status: "sending", attempts: 5, leaseOwner: "stopped-worker", leaseUntil: new Date(Date.now() - 1000) }).where(eq(emailDeliveries.id, f.id));
    await f.email.processOne("replacement");
    expect(await row(f.id)).toMatchObject({ status: "quarantined", payloadCiphertext: null });
    expect(f.mail.send).not.toHaveBeenCalled();
    await f.email.recordProviderEvent({ eventId: randomUUID(), messageId: `<${f.id}@mail.example.test>`, event: "delivered", recipient: f.recipient, payloadHash: "2".repeat(64) });
    expect(await row(f.id)).toMatchObject({ status: "delivered", errorCode: null, payloadCiphertext: null });
    expect(f.mail.send).not.toHaveBeenCalled();
  });

  it("retries only an explicitly unaccepted request under the original logical ID", async () => {
    const send = vi.fn().mockRejectedValueOnce(new ProviderDeliveryError("rate_limited", true, "not_accepted")).mockResolvedValue({ providerMessageId: randomUUID() });
    const f = await fixture({ send, find: vi.fn() });
    await f.email.processOne("refused");
    expect(await row(f.id)).toMatchObject({ status: "failed", errorCode: "rate_limited" });
    await f.email.processOne("retry", new Date(Date.now() + 60000));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].messageId).toBe(send.mock.calls[1]![0].messageId);
    expect(f.mail.find).not.toHaveBeenCalled();
    expect(await row(f.id)).toMatchObject({ status: "accepted" });
  });

  it.each(["membership", "email", "verification", "preference", "archive"])("withdraws pending notices after current %s changes", async (change) => {
    const f = await fixture();
    if (change === "membership") await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId)));
    if (change === "email") await db.update(authUsers).set({ email: `${randomUUID()}@example.test` }).where(eq(authUsers.id, f.userId));
    if (change === "verification") await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    if (change === "preference") await f.notifications.updatePreference(f.companyId, f.userId, { category: "work_update", emailEnabled: false });
    if (change === "archive") await db.update(companies).set({ status: "archived" }).where(eq(companies.id, f.companyId));
    await f.email.processOne("current-source");
    expect(f.mail.send).not.toHaveBeenCalled();
    expect(await row(f.id)).toMatchObject({ status: "suppressed", payloadCiphertext: null, errorCode: "notification_access_withdrawn" });
  });

  it("keeps account safety immediate while its current recipient authority still applies", async () => {
    const f = await fixture(undefined, "security");
    const policy = { version: 1 as const, cadence: "in_app_only" as const, timezone: "UTC", quietHours: null, digestMinute: 0 };
    // Historical policy cannot delay account safety even if newer UI would
    // refuse writing it. Current membership remains required for company mail.
    await db.insert(saasNotificationPreferences).values({ userId: f.userId, category: "security", emailEnabled: true, deliveryPolicy: policy });
    await f.email.processOne("mandatory");
    expect(f.mail.send).toHaveBeenCalledTimes(1);
    expect(await row(f.id)).toMatchObject({ status: "accepted" });
    const other = await fixture(undefined, "security");
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, other.companyId), eq(companyMemberships.principalId, other.userId)));
    await other.email.processOne("current-role");
    expect(other.mail.send).not.toHaveBeenCalled();
    expect(await row(other.id)).toMatchObject({ status: "suppressed", payloadCiphertext: null });
  });

  it("postpones a due digest for new quiet hours without renewing its key or consuming attempts", async () => {
    const f = await fixture();
    const now = new Date(), minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    const policy = { version: 1 as const, cadence: "digest" as const, timezone: "UTC", quietHours: { startMinute: minute, endMinute: (minute + 60) % 1440 }, digestMinute: minute };
    await f.notifications.updatePreference(f.companyId, f.userId, { category: "work_update", emailEnabled: true, policy });
    const original = await row(f.id);
    await f.email.processOne("quiet", now);
    const deferred = await row(f.id);
    expect(deferred).toMatchObject({ status: "pending", attempts: 0, dedupeKey: original.dedupeKey });
    expect(deferred.notBefore.getTime()).toBeGreaterThan(now.getTime());
    expect(f.mail.send).not.toHaveBeenCalled();
    await f.notifications.updatePreference(f.companyId, f.userId, { category: "work_update", emailEnabled: true, policy: { ...policy, quietHours: null } });
    await f.email.processOne("due", deferred.notBefore);
    expect(f.mail.send).toHaveBeenCalledTimes(1);
    expect(await row(f.id)).toMatchObject({ status: "accepted", dedupeKey: original.dedupeKey });
  });
});
