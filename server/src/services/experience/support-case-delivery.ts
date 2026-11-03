import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  accountDeletionOperations,
  companies,
  companyDeletionOperations,
  companyMemberships,
  authUsers,
  supportCases,
  supportCaseEvents,
  type Db,
} from "@paperclipai/db";
import {
  supportCaseDataPolicySchema,
  supportCaseSafeContextSchema,
  type SupportCaseDataPolicy,
} from "@paperclipai/shared";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

const DELIVERY_LEASE_MS = 30_000;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 10_000;
const gatewayKeySchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.-]*$/);
const providerReferenceSchema = z.string().min(1).max(500)
  .regex(/^[^\u0000-\u001f\u007f\uD800-\uDFFF]+$/u);
export const supportCaseGatewayAcknowledgementSchema = z.strictObject({
  eventId: z.uuid(),
  attemptId: z.uuid(),
  providerMessageRef: providerReferenceSchema,
});

/** Exact, minimized customer content selected by the native delivery owner. */
export type SupportCaseGatewayMessage = {
  companyId: string;
  caseId: string;
  eventId: string;
  attemptId: string;
  category: string;
  subject: string;
  kind: "request" | "customer_reply";
  body: string;
  customerStatus: string;
  safeContext: ReturnType<typeof supportCaseSafeContextSchema.parse> | null;
  createdAt: string;
};

export type SupportCaseGatewayAcknowledgement = z.infer<typeof supportCaseGatewayAcknowledgementSchema>;

/** Provider adapter boundary. Implementations receive only the approved customer
 * message and opaque references; credentials and policy are held by the adapter. */
export type SupportCaseGateway = {
  providerKey: string;
  send(message: SupportCaseGatewayMessage, signal: AbortSignal): Promise<unknown>;
};

type Claim = {
  authorUserId: string;
  openedByUserId: string;
  message: SupportCaseGatewayMessage;
  providerKey: string;
};

/** Native, explicitly injected support delivery. It has no provider default,
 * route, background activation, or retry path. A configured gateway is called
 * only after the exact event/attempt identity has committed as `sending`. */
export function supportCaseDeliveryService(
  db: Db,
  options: {
    gateway: SupportCaseGateway;
    dataPolicy: Readonly<SupportCaseDataPolicy>;
    transportTimeoutMs?: number;
    deliveryLeaseMs?: number;
  },
) {
  const gateway = options.gateway;
  const providerKey = gatewayKeySchema.parse(gateway.providerKey);
  const configuredPolicy = Object.freeze(supportCaseDataPolicySchema.parse(options.dataPolicy));
  const transportTimeoutMs = options.transportTimeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
  if (!Number.isInteger(transportTimeoutMs) || transportTimeoutMs < 1 || transportTimeoutMs > 20_000)
    throw new Error("Support gateway timeout must be between 1 and 20000 milliseconds");
  const deliveryLeaseMs = options.deliveryLeaseMs ?? DELIVERY_LEASE_MS;
  if (!Number.isInteger(deliveryLeaseMs) || deliveryLeaseMs < 1 || deliveryLeaseMs > 300_000)
    throw new Error("Support delivery lease must be between 1 and 300000 milliseconds");

  function eligibleEventForAuthor(authorUserId: string | typeof authUsers.id) {
    return sql`exists (
      select 1 from support_case_events e
      join support_cases c on c.company_id=e.company_id and c.id=e.case_id
      join company_memberships m on m.company_id=e.company_id and m.principal_type='user'
        and m.principal_id=e.author_user_id and m.status='active'
      where e.author_user_id=${authorUserId} and e.delivery_state='pending'
        and e.delivery_attempt_id is null and e.delivery_provider_key is null
        and e.delivery_started_at is null and e.delivery_lease_until is null
        and e.delivered_at is null and e.provider_message_ref is null
        and e.kind in ('request','customer_reply')
        and not exists(select 1 from support_case_events prior where prior.company_id=e.company_id and prior.case_id=e.case_id
          and (prior.created_at,prior.id)<(e.created_at,e.id) and prior.kind in ('request','customer_reply')
          and prior.delivery_state not in ('delivered','not_required'))
        and (e.author_user_id=c.opened_by_user_id or m.membership_role in ('owner','admin'))
        and c.data_policy=${JSON.stringify(configuredPolicy)}::jsonb
        and c.expires_at>clock_timestamp()
        and not exists(select 1 from account_deletion_operations a where a.user_id=e.author_user_id)
        and not exists(select 1 from account_deletion_operations a where a.user_id=c.opened_by_user_id)
        and not exists(select 1 from company_deletion_operations d where d.company_id=e.company_id)
        and exists(select 1 from companies co where co.id=e.company_id and co.status<>'archived'
          and co.content_erasure_transaction_id is null and co.pause_reason is distinct from 'company_deleted')
    )`;
  }

  async function claimNext(): Promise<Claim | null> {
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      await tx.execute(sql`set local statement_timeout='3s'`);
      // Native lock order is user -> company -> case -> event. Account deletion
      // locks the user before it removes or scrubs any support content.
      const [principal] = await tx.select({ id: authUsers.id }).from(authUsers)
        .where(eligibleEventForAuthor(authUsers.id))
        .orderBy(authUsers.id).limit(1).for("share", { skipLocked: true });
      if (!principal) return null;

      const eligibleCompany = sql`exists (
        select 1 from support_case_events e
        join support_cases c on c.company_id=e.company_id and c.id=e.case_id
        join company_memberships m on m.company_id=e.company_id and m.principal_type='user'
          and m.principal_id=e.author_user_id and m.status='active'
        where e.company_id=${companies.id} and e.author_user_id=${principal.id}
          and e.delivery_state='pending' and e.delivery_attempt_id is null
          and e.delivery_provider_key is null and e.delivery_started_at is null
          and e.delivery_lease_until is null and e.delivered_at is null and e.provider_message_ref is null
          and e.kind in ('request','customer_reply') and c.data_policy=${JSON.stringify(configuredPolicy)}::jsonb
          and not exists(select 1 from support_case_events prior where prior.company_id=e.company_id and prior.case_id=e.case_id
            and (prior.created_at,prior.id)<(e.created_at,e.id) and prior.kind in ('request','customer_reply')
            and prior.delivery_state not in ('delivered','not_required'))
          and (e.author_user_id=c.opened_by_user_id or m.membership_role in ('owner','admin'))
          and c.expires_at>clock_timestamp()
          and not exists(select 1 from account_deletion_operations a where a.user_id=e.author_user_id)
          and not exists(select 1 from account_deletion_operations a where a.user_id=c.opened_by_user_id)
          and not exists(select 1 from company_deletion_operations d where d.company_id=e.company_id)
      )`;
      const [company] = await tx.select({ id: companies.id }).from(companies)
        .where(and(sql`${companies.status}<>'archived'`, sql`${companies.contentErasureTransactionId} is null`,
          sql`${companies.pauseReason} is distinct from 'company_deleted'`, eligibleCompany))
        .orderBy(companies.id).limit(1).for("update", { skipLocked: true });
      if (!company) return null;

      const [caseRow] = await tx.select().from(supportCases).where(and(
        eq(supportCases.companyId, company.id), eq(supportCases.dataPolicy, configuredPolicy as SupportCaseDataPolicy),
        sql`${supportCases.expiresAt}>clock_timestamp()`,
        sql`not exists(select 1 from account_deletion_operations a where a.user_id=${supportCases.openedByUserId})`,
        sql`exists(select 1 from support_case_events e join company_memberships m
          on m.company_id=e.company_id and m.principal_type='user' and m.principal_id=e.author_user_id and m.status='active'
          where e.company_id=${supportCases.companyId} and e.case_id=${supportCases.id}
            and e.author_user_id=${principal.id} and e.delivery_state='pending'
            and e.delivery_attempt_id is null and e.delivery_provider_key is null and e.delivery_started_at is null
            and e.delivery_lease_until is null and e.delivered_at is null and e.provider_message_ref is null
            and e.kind in ('request','customer_reply')
            and not exists(select 1 from support_case_events prior where prior.company_id=e.company_id and prior.case_id=e.case_id
              and (prior.created_at,prior.id)<(e.created_at,e.id) and prior.kind in ('request','customer_reply')
              and prior.delivery_state not in ('delivered','not_required'))
            and (e.author_user_id=${supportCases.openedByUserId} or m.membership_role in ('owner','admin'))
            and not exists(select 1 from account_deletion_operations a where a.user_id=e.author_user_id))`,
      )).orderBy(supportCases.id).limit(1).for("update", { skipLocked: true });
      if (!caseRow || !isDeepStrictEqual(caseRow.dataPolicy, configuredPolicy)) return null;

      const [event] = await tx.select().from(supportCaseEvents).where(and(
        eq(supportCaseEvents.companyId, company.id), eq(supportCaseEvents.caseId, caseRow.id),
        eq(supportCaseEvents.authorUserId, principal.id), eq(supportCaseEvents.deliveryState, "pending"),
        inArray(supportCaseEvents.kind, ["request", "customer_reply"]),
        sql`${supportCaseEvents.deliveryAttemptId} is null and ${supportCaseEvents.deliveryProviderKey} is null
          and ${supportCaseEvents.deliveryStartedAt} is null and ${supportCaseEvents.deliveryLeaseUntil} is null
          and ${supportCaseEvents.deliveredAt} is null and ${supportCaseEvents.providerMessageRef} is null
          and not exists(select 1 from account_deletion_operations a where a.user_id=${supportCaseEvents.authorUserId})
          and not exists(select 1 from support_case_events prior where prior.company_id=${supportCaseEvents.companyId}
            and prior.case_id=${supportCaseEvents.caseId} and (prior.created_at,prior.id)<(${supportCaseEvents.createdAt},${supportCaseEvents.id})
            and prior.kind in ('request','customer_reply') and prior.delivery_state not in ('delivered','not_required'))
          and exists(select 1 from company_memberships m where m.company_id=${supportCaseEvents.companyId}
            and m.principal_type='user' and m.principal_id=${supportCaseEvents.authorUserId} and m.status='active'
            and (${supportCaseEvents.authorUserId}=${caseRow.openedByUserId} or m.membership_role in ('owner','admin')))`,
      )).orderBy(supportCaseEvents.createdAt, supportCaseEvents.id).limit(1).for("update", { skipLocked: true });
      if (!event) return null;
      if (event.kind !== "request" && event.kind !== "customer_reply") return null;

      const attemptId = randomUUID();
      const [clock] = await tx.execute<{ started_at: Date; lease_until: Date }>(sql`
        select clock_timestamp() as started_at,
          clock_timestamp()+(${deliveryLeaseMs}::int * interval '1 millisecond') as lease_until`);
      if (!clock) return null;
      const [claimed] = await tx.update(supportCaseEvents).set({
        deliveryState: "sending", deliveryAttemptId: attemptId, deliveryProviderKey: providerKey,
        deliveryStartedAt: new Date(clock.started_at), deliveryLeaseUntil: new Date(clock.lease_until),
      }).where(and(eq(supportCaseEvents.id, event.id), eq(supportCaseEvents.deliveryState, "pending"),
        sql`${supportCaseEvents.deliveryAttemptId} is null and ${supportCaseEvents.deliveryProviderKey} is null
          and ${supportCaseEvents.deliveryStartedAt} is null and ${supportCaseEvents.deliveryLeaseUntil} is null
          and ${supportCaseEvents.deliveredAt} is null and ${supportCaseEvents.providerMessageRef} is null`))
        .returning({ id: supportCaseEvents.id });
      if (!claimed) return null;
      return {
        authorUserId: principal.id,
        openedByUserId: caseRow.openedByUserId,
        providerKey,
        message: {
          companyId: company.id, caseId: caseRow.id, eventId: event.id, attemptId,
          category: caseRow.category, subject: caseRow.subject, kind: event.kind,
          body: event.body, customerStatus: event.customerStatus,
          safeContext: event.safeContext === null ? null : supportCaseSafeContextSchema.parse(event.safeContext),
          createdAt: event.createdAt.toISOString(),
        },
      };
    });
  }

  async function markUnknown(tx: Db, eventId: string, attemptId: string, providerKey: string) {
    await tx.update(supportCaseEvents).set({ deliveryState: "unknown", deliveryLeaseUntil: null })
      .where(and(eq(supportCaseEvents.id, eventId), eq(supportCaseEvents.deliveryState, "sending"),
        eq(supportCaseEvents.deliveryAttemptId, attemptId), eq(supportCaseEvents.deliveryProviderKey, providerKey)));
  }

  async function recoverUnknown(claim: Claim) {
    try {
      await db.transaction(async raw => {
        const tx = raw as unknown as Db;
        await tx.execute(sql`set local statement_timeout='3s'`);
        const userIds = [...new Set([claim.authorUserId, claim.openedByUserId])].sort();
        const users = await tx.select({ id: authUsers.id }).from(authUsers)
          .where(inArray(authUsers.id, userIds)).orderBy(authUsers.id).for("share", { skipLocked: true });
        if (users.length !== userIds.length) return;
        const [company] = await tx.select({ id: companies.id }).from(companies)
          .where(eq(companies.id, claim.message.companyId)).limit(1).for("update", { skipLocked: true });
        if (!company) return;
        const [caseRow] = await tx.select({ id: supportCases.id }).from(supportCases)
          .where(and(eq(supportCases.companyId, claim.message.companyId), eq(supportCases.id, claim.message.caseId)))
          .limit(1).for("update", { skipLocked: true });
        if (!caseRow) return;
        const [event] = await tx.select({ id: supportCaseEvents.id }).from(supportCaseEvents)
          .where(and(eq(supportCaseEvents.companyId, claim.message.companyId), eq(supportCaseEvents.caseId, claim.message.caseId),
            eq(supportCaseEvents.id, claim.message.eventId), eq(supportCaseEvents.deliveryState, "sending"),
            eq(supportCaseEvents.deliveryAttemptId, claim.message.attemptId), eq(supportCaseEvents.deliveryProviderKey, claim.providerKey)))
          .limit(1).for("update", { skipLocked: true });
        if (event) await markUnknown(tx, event.id, claim.message.attemptId, claim.providerKey);
      });
    } catch {
      // A later lease sweep resolves any exact attempt this transaction could
      // not safely touch. No retry path is created.
    }
  }

  async function deliverClaim(claim: Claim): Promise<boolean> {
    const userIds = [...new Set([claim.authorUserId, claim.openedByUserId])].sort();
    try {
      return await db.transaction(async raw => {
        const tx = raw as unknown as Db;
        await tx.execute(sql`select set_config('statement_timeout', ${`${transportTimeoutMs + 5000}ms`}, true)`);
        const users = await tx.select({ id: authUsers.id }).from(authUsers).where(inArray(authUsers.id, userIds))
          .orderBy(authUsers.id).for("share", { skipLocked: true });
        if (users.length !== userIds.length) return false;

        const [company] = await tx.select().from(companies).where(eq(companies.id, claim.message.companyId))
          .limit(1).for("update", { skipLocked: true });
        if (!company) return false;
        const [caseRow] = await tx.select().from(supportCases).where(and(
          eq(supportCases.companyId, claim.message.companyId), eq(supportCases.id, claim.message.caseId),
        )).limit(1).for("update", { skipLocked: true });
        if (!caseRow) return false;
        const [membership] = await tx.select().from(companyMemberships).where(and(
          eq(companyMemberships.companyId, company.id), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, claim.authorUserId), eq(companyMemberships.status, "active"),
        )).limit(1).for("share", { skipLocked: true });
        const [event] = await tx.select().from(supportCaseEvents).where(and(
          eq(supportCaseEvents.companyId, claim.message.companyId), eq(supportCaseEvents.caseId, claim.message.caseId),
          eq(supportCaseEvents.id, claim.message.eventId), eq(supportCaseEvents.deliveryState, "sending"),
          eq(supportCaseEvents.deliveryAttemptId, claim.message.attemptId),
          eq(supportCaseEvents.deliveryProviderKey, claim.providerKey),
        )).limit(1).for("update", { skipLocked: true });
        if (!event) return false;
        const [authority] = await tx.execute<{ current: boolean; now: Date }>(sql`
          select clock_timestamp() as now,
            ${company.status !== "archived" && company.contentErasureTransactionId === null && company.pauseReason !== "company_deleted"}
            and ${isDeepStrictEqual(caseRow.dataPolicy, configuredPolicy)}
            and ${caseRow.expiresAt.toISOString()}::timestamptz>clock_timestamp()
            and ${event.deliveryLeaseUntil!.toISOString()}::timestamptz>clock_timestamp()
            and not exists(select 1 from company_deletion_operations d where d.company_id=${company.id})
            and not exists(select 1 from account_deletion_operations a where a.user_id=${claim.authorUserId})
            and not exists(select 1 from account_deletion_operations a where a.user_id=${caseRow.openedByUserId})
            and ${!!membership}
            and (${claim.authorUserId === caseRow.openedByUserId || ["owner", "admin"].includes(membership?.membershipRole ?? "")}) as current`);
        if (!authority?.current || !authority.now) {
          await markUnknown(tx, event.id, claim.message.attemptId, claim.providerKey);
          return false;
        }

        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let rawAck: unknown;
        try {
          const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("Support gateway timed out"));
            }, transportTimeoutMs);
            timer.unref?.();
          });
          rawAck = await Promise.race([gateway.send(claim.message, controller.signal), timeout]);
        } catch {
          controller.abort();
          await markUnknown(tx, event.id, claim.message.attemptId, claim.providerKey);
          return false;
        } finally {
          if (timer) clearTimeout(timer);
        }

        const ack = supportCaseGatewayAcknowledgementSchema.safeParse(rawAck);
        if (!ack.success || ack.data.eventId !== claim.message.eventId || ack.data.attemptId !== claim.message.attemptId) {
          await markUnknown(tx, event.id, claim.message.attemptId, claim.providerKey);
          return false;
        }
        const [clock] = await tx.execute<{ at: Date }>(sql`select clock_timestamp() as at`);
        if (!clock || event.deliveryLeaseUntil!.getTime() <= new Date(clock.at).getTime()) {
          await markUnknown(tx, event.id, claim.message.attemptId, claim.providerKey);
          return false;
        }
        const [delivered] = await tx.update(supportCaseEvents).set({
          deliveryState: "delivered", deliveredAt: new Date(clock.at), providerMessageRef: ack.data.providerMessageRef,
          deliveryLeaseUntil: null,
        }).where(and(eq(supportCaseEvents.id, event.id), eq(supportCaseEvents.deliveryState, "sending"),
          eq(supportCaseEvents.deliveryAttemptId, claim.message.attemptId),
          eq(supportCaseEvents.deliveryProviderKey, claim.providerKey),
          sql`${supportCaseEvents.deliveryLeaseUntil}>clock_timestamp()`)).returning({ id: supportCaseEvents.id });
        return !!delivered;
      });
    } catch {
      // The attempt identity committed before this transaction. If a commit or
      // transport boundary is ambiguous, only that same attempt may be marked
      // unknown; maintenance handles any lock/commit failure here.
      await recoverUnknown(claim);
      return false;
    }
  }

  return {
    async deliverNext(): Promise<{ status: "idle" | "delivered" | "unknown"; eventId?: string }> {
      const claim = await claimNext();
      if (!claim) return { status: "idle" };
      const delivered = await deliverClaim(claim);
      return { status: delivered ? "delivered" : "unknown", eventId: claim.message.eventId };
    },
  };
}
