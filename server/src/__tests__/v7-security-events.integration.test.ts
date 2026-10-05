import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  createDb,
  activityLog,
  securityEventDeliveries,
  companySecrets,
  type Db,
} from "@paperclipai/db";
import {
  securityEventExportService,
  signSecurityEvent,
} from "../services/enterprise/security-events.js";
import { secretService } from "../services/secrets.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Companies } from "./helpers/v5-fixtures.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "native security event export",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: Db,
      f: Awaited<ReturnType<typeof seedV5Companies>>,
      keyId: string;
    const signingValue = "company-test-signing-key-" + "x".repeat(40);
    beforeAll(async () => {
      vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "a".repeat(64));
      database = await startEmbeddedPostgresTestDatabase("aw-v7-security-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
      f = await seedV5Companies(db);
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        ai_use_cases_v7: true,
        governance_evidence_v7: true,
        security_event_export_v7: true,
      });
      keyId = (
        await secretService(db).create(
          f.home,
          {
            name: "Native event signing fixture",
            provider: "local_encrypted",
            value: signingValue,
          },
          { userId: f.userId },
        )
      ).id;
    }, 30000);
    afterAll(async () => {
      await db?.$client.end();
      await database?.cleanup();
      vi.unstubAllEnvs();
    }, 60000);
    const config = (expectedVersion: number, enabled = true) => ({
      expectedVersion,
      endpoint: "https://siem.test.invalid/ingest",
      signingSecretId: keyId,
      signingSecretVersion: 1,
      actions: ["secret.rotated"],
      enabled,
      reason: "Approved local protocol fixture",
    });
    it("queues atomically by company, omits secrets and signs the canonical event with stable dedup identity", async () => {
      const sent = vi.fn(async () => 204),
        service = securityEventExportService(db, { deliver: sent });
      await service.configure(f.actor, f.home, config(0));
      const id = randomUUID();
      await db.insert(activityLog).values([
        {
          id,
          companyId: f.home,
          actorType: "user",
          actorId: f.userId,
          action: "secret.rotated",
          entityType: "secret",
          entityId: keyId,
          details: { value: "must-never-export", apiKey: signingValue },
        },
        {
          companyId: f.guest,
          actorType: "user",
          actorId: f.userId,
          action: "secret.rotated",
          entityType: "secret",
          entityId: keyId,
        },
      ]);
      expect(await db.select().from(securityEventDeliveries)).toHaveLength(1);
      expect(await service.tick()).toEqual({ checked: 1, delivered: 1 });
      const [endpoint, headers, body] = sent.mock.calls[0] as unknown as [
        string,
        Record<string, string>,
        string,
      ];
      expect(endpoint).toBe(config(0).endpoint);
      expect(JSON.parse(body)).toMatchObject({
        companyId: f.home,
        eventId: id,
        action: "secret.rotated",
        schemaVersion: "aw.security-event.v1",
      });
      expect(body).not.toContain("must-never-export");
      expect(body).not.toContain(signingValue);
      expect(body).not.toContain(keyId);
      expect(headers["X-August-Event-Id"]).toBe(id);
      expect(headers["X-August-Signature"]).toBe(
        signSecurityEvent(
          signingValue,
          headers["X-August-Timestamp"]!,
          id,
          body,
        ),
      );
      expect(await service.tick()).toEqual({ checked: 0, delivered: 0 });
      expect(sent).toHaveBeenCalledTimes(1);
      const [row] = await db
        .select()
        .from(securityEventDeliveries)
        .where(eq(securityEventDeliveries.eventId, id));
      expect(row?.attempts).toBe(1);
      expect(row?.status).toBe("delivered");
      await expect(
        db
          .update(securityEventDeliveries)
          .set({ status: "pending" })
          .where(eq(securityEventDeliveries.eventId, id)),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    });
    it("rolls back its delivery with the source transaction and bounds cumulative retries", async () => {
      const sent = vi.fn(async () => 503),
        service = securityEventExportService(db, { deliver: sent }),
        id = randomUUID();
      await expect(
        db.transaction(async (tx) => {
          await tx
            .insert(activityLog)
            .values({
              companyId: f.home,
              actorType: "user",
              actorId: f.userId,
              action: "secret.rotated",
              entityType: "secret",
              entityId: keyId,
            });
          throw Error("rollback fixture");
        }),
      ).rejects.toThrow("rollback fixture");
      expect(
        await db
          .select()
          .from(securityEventDeliveries)
          .where(eq(securityEventDeliveries.status, "pending")),
      ).toHaveLength(0);
      await db
        .insert(activityLog)
        .values({
          id,
          companyId: f.home,
          actorType: "user",
          actorId: f.userId,
          action: "secret.rotated",
          entityType: "secret",
          entityId: keyId,
        });
      for (let i = 0; i < 5; i++) {
        await db
          .update(securityEventDeliveries)
          .set({ nextAttemptAt: new Date(0) })
          .where(eq(securityEventDeliveries.eventId, id));
        expect((await service.tick()).checked).toBe(1);
      }
      const [row] = await db
        .select()
        .from(securityEventDeliveries)
        .where(eq(securityEventDeliveries.eventId, id));
      expect(row?.attempts).toBe(5);
      expect(row?.status).toBe("failed");
      expect(sent).toHaveBeenCalledTimes(5);
      expect((await service.tick()).checked).toBe(0);
    });
    it("cancels old configuration deliveries, checks CAS and blocks rotated key reuse", async () => {
      const sent = vi.fn(async () => 204),
        service = securityEventExportService(db, { deliver: sent });
      await db
        .insert(activityLog)
        .values({
          companyId: f.home,
          actorType: "user",
          actorId: f.userId,
          action: "secret.rotated",
          entityType: "secret",
          entityId: keyId,
        });
      await service.configure(f.actor, f.home, config(1, false));
      expect((await service.tick()).checked).toBe(0);
      await expect(
        service.configure(f.actor, f.home, config(1)),
      ).rejects.toMatchObject({ status: 409 });
      await service.configure(f.actor, f.home, config(2));
      await db
        .insert(activityLog)
        .values({
          companyId: f.home,
          actorType: "user",
          actorId: f.userId,
          action: "secret.rotated",
          entityType: "secret",
          entityId: keyId,
        });
      await db
        .update(companySecrets)
        .set({ status: "revoked" })
        .where(eq(companySecrets.id, keyId));
      expect(await service.tick()).toEqual({ checked: 1, delivered: 0 });
      expect(sent).not.toHaveBeenCalled();
      await service.configure(f.actor, f.home, config(3, false));
    });
  },
);
