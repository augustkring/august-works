import { randomUUID, createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog,
  companySecrets,
  companySecretVersions,
  securityEventExportConfigurations as configurations,
  securityEventDeliveries as deliveries,
  type Db,
} from "@paperclipai/db";
import {
  SECURITY_EVENT_ACTIONS,
  securityEventExportConfigurationSchema,
  v7FeatureEnabled,
  type SecurityEventEnvelope,
  type SecurityEventExportConfigurationView,
} from "@paperclipai/shared";
import { enterpriseOwner } from "./authority.js";
import { assertV7Enabled } from "../v7-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { instanceSettingsService } from "../instance-settings.js";
import { secretService } from "../secrets.js";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { conflict, forbidden } from "../../errors.js";
type Configuration = typeof configurations.$inferSelect;
export function securityEventEnvelope(
  row: typeof activityLog.$inferSelect,
): SecurityEventEnvelope {
  if (!(SECURITY_EVENT_ACTIONS as readonly string[]).includes(row.action))
    throw Error("Unsupported security event action");
  return {
    schemaVersion: "aw.security-event.v1",
    eventId: row.id,
    companyId: row.companyId,
    action: row.action as SecurityEventEnvelope["action"],
    occurredAt: row.createdAt.toISOString(),
  };
}
export function signSecurityEvent(
  key: string,
  timestamp: string,
  eventId: string,
  body: string,
) {
  return `v1=${createHmac("sha256", key).update(`${timestamp}.${eventId}.${body}`).digest("hex")}`;
}
function view(row: Configuration): SecurityEventExportConfigurationView {
  return {
    id: row.id,
    companyId: row.companyId,
    version: row.version,
    endpoint: row.endpoint,
    signingSecretId: row.signingSecretId,
    signingSecretVersion: row.signingSecretVersion,
    actions: row.actions,
    enabled: row.enabled,
    droppedEvents: row.droppedEvents,
  };
}
export interface SecurityEventTransport {
  deliver(
    endpoint: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<number>;
}
const nativeTransport: SecurityEventTransport = {
  async deliver(endpoint, headers, body) {
    const response = await guardedRemoteHttpFetch(
      endpoint,
      {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(15000),
      },
      {
        allowPrivateNetwork: false,
        connectTimeoutMs: 5000,
        responseTimeoutMs: 10000,
        error: () => forbidden("Security-event endpoint is unavailable"),
      },
    );
    // Never retain remote response bodies or echo them into the audit log.
    await response.body?.cancel();
    return response.status;
  },
};
export function securityEventExportService(
  db: Db,
  transport: SecurityEventTransport = nativeTransport,
) {
  async function signingKey(
    tx: Db,
    c: Pick<
      Configuration,
      "companyId" | "signingSecretId" | "signingSecretVersion"
    >,
  ) {
    const [key] = await tx
      .select({
        hash: companySecretVersions.valueSha256,
        deletedAt: companySecrets.deletedAt,
        revokedAt: companySecretVersions.revokedAt,
      })
      .from(companySecrets)
      .innerJoin(
        companySecretVersions,
        and(
          eq(companySecretVersions.secretId, companySecrets.id),
          eq(companySecretVersions.version, c.signingSecretVersion),
        ),
      )
      .where(
        and(
          eq(companySecrets.id, c.signingSecretId),
          eq(companySecrets.companyId, c.companyId),
          eq(companySecrets.scope, "company"),
          eq(companySecrets.provider, "local_encrypted"),
          eq(companySecrets.status, "active"),
          eq(companySecrets.latestVersion, c.signingSecretVersion),
          eq(companySecretVersions.status, "current"),
        ),
      )
      .for("share");
    if (!key || key.deletedAt || key.revokedAt)
      throw conflict("Current company signing secret version required");
    return key.hash;
  }
  return {
    get: (actor: AuthorizationActor, companyId: string) =>
      db.transaction(async (tx) => {
        await enterpriseOwner(tx as unknown as Db, actor, companyId);
        const [c] = await tx
          .select()
          .from(configurations)
          .where(eq(configurations.companyId, companyId));
        if (!c) return null;
        const [counts] = await tx
          .select({
            pending: sql<number>`count(*) filter(where status in ('pending','sending'))::int`,
            delivered: sql<number>`count(*) filter(where status='delivered')::int`,
            failed: sql<number>`count(*) filter(where status='failed')::int`,
            cancelled: sql<number>`count(*) filter(where status='cancelled')::int`,
            lastDeliveredAt: sql<string | null>`max(delivered_at)::text`,
          })
          .from(deliveries)
          .where(eq(deliveries.companyId, companyId));
        return { ...view(c), delivery: counts! };
      }),
    configure: (actor: AuthorizationActor, companyId: string, raw: unknown) =>
      withV7ActivityTransaction(db, async (tx, p) => {
        const input = securityEventExportConfigurationSchema.parse(raw);
        await tx.execute(
          sql`select id from instance_settings where singleton_key='default' for share`,
        );
        // Disabling an existing export stays possible when rollout is off.
        if (input.enabled)
          await assertV7Enabled(tx, "security_event_export_v7");
        const userId = await enterpriseOwner(tx, actor, companyId);
        await tx.execute(
          sql`select id from companies where id=${companyId}::uuid for update`,
        );
        const [old] = await tx
          .select()
          .from(configurations)
          .where(eq(configurations.companyId, companyId))
          .for("update");
        if ((old?.version ?? 0) !== input.expectedVersion)
          throw conflict("Security export configuration changed");
        const keyHash =
          !input.enabled &&
          old &&
          old.signingSecretId === input.signingSecretId &&
          old.signingSecretVersion === input.signingSecretVersion
            ? old.signingSecretHash
            : await signingKey(tx, {
                companyId,
                signingSecretId: input.signingSecretId,
                signingSecretVersion: input.signingSecretVersion,
              });
        if (input.enabled) {
          const value = await secretService(tx).resolveSecretValue(
            companyId,
            input.signingSecretId,
            input.signingSecretVersion,
            {
              accessContext: {
                consumerType: "system",
                consumerId: "security-event-qualification",
                actorType: "system",
                actorId: "security-event-qualification",
              },
            },
          );
          if (Buffer.byteLength(value) < 32 || Buffer.byteLength(value) > 4096)
            throw conflict(
              "A dedicated signing secret between 32 and 4096 bytes is required",
            );
        }
        const data = {
          companyId,
          version: (old?.version ?? 0) + 1,
          endpoint: input.endpoint,
          signingSecretId: input.signingSecretId,
          signingSecretVersion: input.signingSecretVersion,
          signingSecretHash: keyHash,
          actions: input.actions,
          enabled: input.enabled,
          approvedByUserId: userId,
          updatedAt: new Date(),
        };
        const [row] = old
          ? await tx
              .update(configurations)
              .set(data)
              .where(eq(configurations.id, old.id))
              .returning()
          : await tx.insert(configurations).values(data).returning();
        if (old)
          await tx
            .update(deliveries)
            .set({
              status: "cancelled",
              leaseId: null,
              leaseExpiresAt: null,
              lastFailureCode: "CONFIGURATION_CHANGED",
            })
            .where(
              and(
                eq(deliveries.companyId, companyId),
                eq(deliveries.configurationId, old.id),
                sql`${deliveries.status} in ('pending','sending')`,
              ),
            );
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.security_export_configured",
            entityType: "security_event_export_configuration",
            entityId: row!.id,
            details: {
              version: row!.version,
              enabled: row!.enabled,
              reason: input.reason,
            },
          },
          p,
        );
        return view(row!);
      }),
    tick: async (limit = 10) => {
      const bound = Math.max(1, Math.min(20, Math.floor(limit)));
      // Retention cleanup is independent of feature rollout.
      await db.execute(
        sql`delete from security_event_deliveries where id in (select id from security_event_deliveries where expires_at<=now() order by expires_at limit 100)`,
      );
      if (
        !v7FeatureEnabled(
          await instanceSettingsService(db).getExperimental(),
          "security_event_export_v7",
        )
      )
        return { checked: 0, delivered: 0 };
      let checked = 0,
        delivered = 0;
      for (let i = 0; i < bound; i++) {
        const claimed = await db.transaction(async (tx) => {
          const rows = await tx.execute<{ id: string }>(
            sql`select id from security_event_deliveries where expires_at>now() and attempts<5 and ((status='pending' and next_attempt_at<=now()) or (status='sending' and lease_expires_at<=now())) order by next_attempt_at,id for update skip locked limit 1`,
          );
          if (!rows[0]) return null;
          const [row] = await tx
            .update(deliveries)
            .set({
              status: "sending",
              attempts: sql`${deliveries.attempts}+1`,
              leaseId: randomUUID(),
              leaseExpiresAt: sql`now()+interval '90 seconds'`,
            })
            .where(eq(deliveries.id, rows[0].id))
            .returning();
          return row!;
        });
        if (!claimed) break;
        checked++;
        // Hold native authority locks through the bounded send. Concurrent revocation
        // either precedes delivery or waits for its completion; no stale endpoint redirect.
        await db.transaction(async (tx) => {
          const nativeDb = tx as unknown as Db;
          await tx.execute(
            sql`select id from instance_settings where singleton_key='default' for share`,
          );
          const [c] = await tx
            .select()
            .from(configurations)
            .where(
              and(
                eq(configurations.companyId, claimed.companyId),
                eq(configurations.id, claimed.configurationId),
              ),
            )
            .for("share");
          const [d] = await tx
            .select()
            .from(deliveries)
            .where(
              and(
                eq(deliveries.id, claimed.id),
                eq(deliveries.leaseId, claimed.leaseId!),
                eq(deliveries.status, "sending"),
              ),
            )
            .for("update");
          if (!d) return;
          let failure = "AUTHORITY_CHANGED",
            success = false;
          try {
            if (
              !c?.enabled ||
              c.version !== d.configurationVersion ||
              d.expiresAt <= new Date() ||
              d.leaseExpiresAt! <= new Date()
            )
              throw Error("Authority changed");
            await assertV7Enabled(nativeDb, "security_event_export_v7");
            await enterpriseOwner(
              nativeDb,
              {
                type: "board",
                source: "session",
                userId: c.approvedByUserId,
                companyIds: [c.companyId],
                ignoreInstanceAdmin: true,
              },
              c.companyId,
            );
            if ((await signingKey(nativeDb, c)) !== c.signingSecretHash)
              throw Error("Signing key changed");
            const [event] = await tx
              .select()
              .from(activityLog)
              .where(
                and(
                  eq(activityLog.companyId, c.companyId),
                  eq(activityLog.id, d.eventId),
                ),
              );
            if (!event || !c.actions.includes(event.action))
              throw Error("Event withdrawn");
            const key = await secretService(nativeDb).resolveSecretValue(
              c.companyId,
              c.signingSecretId,
              c.signingSecretVersion,
              {
                accessContext: {
                  consumerType: "system",
                  consumerId: "security-event-export",
                  actorType: "system",
                  actorId: "security-event-export",
                },
              },
            );
            if (Buffer.byteLength(key) < 32 || Buffer.byteLength(key) > 4096)
              throw Error("Signing key shape");
            const body = JSON.stringify(securityEventEnvelope(event)),
              timestamp = String(Math.floor(Date.now() / 1000));
            failure = "DELIVERY_REJECTED";
            const status = await transport.deliver(
              c.endpoint,
              {
                "Content-Type": "application/json",
                "X-August-Event-Id": event.id,
                "X-August-Timestamp": timestamp,
                "X-August-Signature": signSecurityEvent(
                  key,
                  timestamp,
                  event.id,
                  body,
                ),
              },
              body,
            );
            success = status >= 200 && status < 300;
          } catch {
            /* Persist bounded error codes only, never response or secret text. */
          }
          await tx
            .update(deliveries)
            .set({
              status: success
                ? "delivered"
                : failure === "AUTHORITY_CHANGED"
                  ? "cancelled"
                  : d.attempts >= 5
                    ? "failed"
                    : "pending",
              deliveredAt: success ? new Date() : null,
              leaseId: null,
              leaseExpiresAt: null,
              nextAttemptAt: new Date(
                Date.now() + Math.min(60000, 1000 * 2 ** d.attempts),
              ),
              lastFailureCode: success ? null : failure,
            })
            .where(
              and(eq(deliveries.id, d.id), eq(deliveries.leaseId, d.leaseId!)),
            );
          if (success) delivered++;
        });
      }
      // Fifth lease lost to a crash cannot create a sixth attempt.
      await db.execute(
        sql`update security_event_deliveries set status='failed', lease_id=null, lease_expires_at=null, last_failure_code='ATTEMPT_LIMIT' where id in (select id from security_event_deliveries where status='sending' and attempts=5 and lease_expires_at<=now() limit 100)`,
      );
      return { checked, delivered };
    },
  };
}
