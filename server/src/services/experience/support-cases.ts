import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  accountDeletionOperations, authRateLimits, authUsers, companies, companyDeletionOperations, companyMemberships,
  supportCases, supportCaseEvents, supportCaseDeletionMarkers, type Db,
} from "@paperclipai/db";
import {
  createSupportCaseSchema, replySupportCaseSchema, closeSupportCaseSchema, deriveSupportCaseSubject,
  supportCaseReadQuerySchema, supportCaseDetailSchema, supportCaseListSchema, supportCaseDataPolicySchema, supportCaseIntakePolicySchema,
  SUPPORT_CASE_LIMITS, type SupportCaseDataPolicy,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, tooManyRequests, unprocessable } from "../../errors.js";
import { pinCurrentBoardActor, type AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";

type Case = typeof supportCases.$inferSelect;
type Event = typeof supportCaseEvents.$inferSelect;
type Query = ReturnType<typeof supportCaseReadQuerySchema.parse>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const delivery = (event?: Event) => event?.deliveryState === "sending" ? "pending" as const : event?.deliveryState ?? "unknown" as const;
const reference = (id: string) => "BLS-" + id.replaceAll("-", "").toUpperCase();

/** Local customer receipts. Neither a case nor this service grants privileged
 * support access. External dispatch stays pending until its gateway owns proof. */
export function customerSupportCaseService(db: Db, options: { dataPolicy: Readonly<SupportCaseDataPolicy> | null }) {
  const configuredPolicy = options.dataPolicy ? Object.freeze(supportCaseDataPolicySchema.parse(options.dataPolicy)) : null;
  function human(actor: AuthorizationActor, expectedUserId: string) {
    if (actor.type !== "board" || !actor.userId ||
      !(actor.source === "session" && actor.sessionId || actor.source === "board_key" && actor.keyId && actor.authenticatedKeyHash))
      throw forbidden("A current authenticated account is required");
    if (actor.userId !== expectedUserId) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
  }
  async function within<T>(actor: AuthorizationActor, companyId: string, expectedUserId: string, write: boolean,
    work: (tx: Db, userId: string, administrator: boolean, publications: ActivityPublication[]) => Promise<T>) {
    human(actor, expectedUserId);
    const result = await db.transaction(async raw => {
      const tx = raw as unknown as Db;
      await tx.execute(sql`set local statement_timeout='5s'`);
      const pinned = await pinCurrentBoardActor(tx, actor);
      if (!pinned) throw forbidden("The account credential is no longer available");
      const current = { ...pinned.actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
      const query = tx.select().from(companies).where(eq(companies.id, companyId));
      const [company] = await query.for(write ? "update" : "share");
      if (!company || company.status === "archived" || company.contentErasureTransactionId || company.pauseReason === "company_deleted")
        throw notFound("Company is unavailable");
      const [deleting] = await tx.select({ id: companyDeletionOperations.id }).from(companyDeletionOperations)
        .where(eq(companyDeletionOperations.companyId, companyId)).limit(1);
      const [erasingAccount] = await tx.select({ id: accountDeletionOperations.id }).from(accountDeletionOperations)
        .where(eq(accountDeletionOperations.userId, actor.userId!)).limit(1);
      if (deleting || erasingAccount) throw forbidden("Support access is no longer available");
      const [membership] = await tx.select().from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.userId!), eq(companyMemberships.status, "active"),
      )).for("share", { noWait: true });
      if (!membership) throw forbidden("Active company membership is required");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      const publications: ActivityPublication[] = [];
      const value = await work(tx, actor.userId!, ["owner", "admin"].includes(membership.membershipRole ?? ""), publications);
      if (pinned.credentialExpiresAt !== null && pinned.credentialExpiresAt <= Date.now())
        throw forbidden("The account credential has expired");
      return { value, publications };
    }).catch(error => {
      for (let depth = 0, cause: unknown = error; cause && typeof cause === "object" && depth < 8; depth++, cause = (cause as { cause?: unknown }).cause) {
        if (["55P03", "57014"].includes(String((cause as { code?: unknown }).code)))
          throw conflict("Support is busy; retry the same request", { code: "SUPPORT_BUSY" });
      }
      throw error;
    });
    for (const publication of result.publications) publishActivity(publication);
    return result.value;
  }
  function visible(companyId: string, userId: string, administrator: boolean): SQL {
    return sql`${supportCases.companyId}=${companyId}::uuid
      and ${supportCases.expiresAt}>clock_timestamp()
      and not exists(select 1 from account_deletion_operations d where d.user_id=${supportCases.openedByUserId})
      and (${administrator} or ${supportCases.openedByUserId}=${userId})`;
  }
  async function currentCase(tx: Db, companyId: string, userId: string, administrator: boolean, id: string, write = false) {
    const [row] = await tx.select().from(supportCases).where(and(eq(supportCases.id, id), visible(companyId, userId, administrator)))
      .for(write ? "update" : "share", { noWait: true });
    if (!row) throw notFound("Support case not found");
    return row;
  }
  async function summary(tx: Db, row: Case) {
    const [last] = await tx.select().from(supportCaseEvents).where(and(eq(supportCaseEvents.companyId, row.companyId),
      eq(supportCaseEvents.caseId, row.id), sql`${supportCaseEvents.kind} in ('request','customer_reply')
      and not exists(select 1 from account_deletion_operations d where d.user_id=${supportCaseEvents.authorUserId})`))
      .orderBy(desc(supportCaseEvents.createdAt), desc(supportCaseEvents.id)).limit(1);
    return { id: row.id, companyId: row.companyId, reference: reference(row.id), openedByUserId: row.openedByUserId,
      category: row.category, subject: row.subject, impact: row.impact, status: row.customerStatus,
      requestedResponse: row.requestedResponse, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null, closedAt: row.closedAt?.toISOString() ?? null, delivery: delivery(last) };
  }
  async function detail(tx: Db, row: Case, userId: string, administrator: boolean, query?: Query) {
    const cursor = query?.beforeId ? sql`(${supportCaseEvents.createdAt},${supportCaseEvents.id})<(${query.beforeCreatedAt}::timestamptz,${query.beforeId}::uuid)` : sql`true`;
    const events = await tx.select().from(supportCaseEvents).where(and(eq(supportCaseEvents.companyId, row.companyId),
      eq(supportCaseEvents.caseId, row.id), cursor,
      sql`not exists(select 1 from account_deletion_operations d where d.user_id=${supportCaseEvents.authorUserId})`))
      .orderBy(desc(supportCaseEvents.createdAt), desc(supportCaseEvents.id)).limit(SUPPORT_CASE_LIMITS.timelinePage + 1);
    // A new statement after content acquisition rechecks erasure and expiry.
    // No row/ID from a pre-wait snapshot becomes a reusable permission proof.
    await currentCase(tx, row.companyId, userId, administrator, row.id);
    const page = events.slice(0, SUPPORT_CASE_LIMITS.timelinePage), last = page.at(-1);
    return supportCaseDetailSchema.parse({ ...await summary(tx, row), description: row.description,
      safeContext: row.safeContext, followUpOfId: row.followUpOfId,
      timeline: page.reverse().map(e => ({ id: e.id, kind: e.kind, body: e.body, status: e.customerStatus,
        author: ["request", "customer_reply"].includes(e.kind) ? "customer" : "support", safeContext: e.safeContext,
        delivery: delivery(e), createdAt: e.createdAt.toISOString() })),
      nextCursor: events.length > SUPPORT_CASE_LIMITS.timelinePage && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null });
  }
  async function budget(companyId: string, userId: string) {
    const now = Date.now(), cutoff = now - 600000, key = "support-case:" + digest(userId) + ":" + digest(companyId);
    const [row] = await db.insert(authRateLimits).values({ id: key, key, count: 1, lastRequest: now })
      .onConflictDoUpdate({ target: authRateLimits.key, set: {
        count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
        lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${now} else ${authRateLimits.lastRequest} end`,
      } }).returning();
    if (row!.count > 20) throw tooManyRequests("Support request limit reached; try again later");
  }
  function policy() {
    if (!configuredPolicy) throw unprocessable("Support intake is unavailable; contact support directly", { code: "SUPPORT_INTAKE_UNAVAILABLE" });
    return configuredPolicy;
  }
  async function existing(tx: Db, companyId: string, userId: string, key: string) {
    const [event] = await tx.select().from(supportCaseEvents).where(and(eq(supportCaseEvents.companyId, companyId),
      eq(supportCaseEvents.authorUserId, userId), eq(supportCaseEvents.requestKey, key))).limit(1);
    return event;
  }
  async function requestIdentity(tx: Db, companyId: string, userId: string, key: string) {
    // RFC 9562 UUIDv8 from a closed native request namespace. Stable event IDs
    // let the existing content-free erasure marker fence replay after deletion;
    // the command key alone never grants access or admits a provider effect.
    const hex = digest(["support-case-event.v1", companyId.toLowerCase(), userId, key.toLowerCase()]);
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const [erased] = await tx.select({ id: supportCaseDeletionMarkers.subjectId }).from(supportCaseDeletionMarkers)
      .where(eq(supportCaseDeletionMarkers.subjectId, id)).limit(1);
    if (erased) throw notFound("This support request has been erased", { code: "SUPPORT_REQUEST_ERASED" });
    return id;
  }
  async function record(tx: Db, publications: ActivityPublication[], row: Case, userId: string, action: string) {
    await logActivity(tx, { companyId: row.companyId, actorType: "user", actorId: userId,
      action, entityType: "support_case", entityId: row.id, details: null }, publications);
  }
  async function now(tx: Db) {
    const [clock] = await tx.execute<{ at: Date }>(sql`select clock_timestamp() as at`);
    if (!clock) throw conflict("Support time is unavailable");
    return new Date(clock.at);
  }
  return {
    async intakePolicy(actor: AuthorizationActor, companyId: string, expectedUserId: string) {
      return within(actor, companyId, expectedUserId, false, async () => supportCaseIntakePolicySchema.parse(configuredPolicy
        ? { available: true, recipientName: configuredPolicy.recipientName, privacyNoticeUrl: configuredPolicy.privacyNoticeUrl,
            retentionDays: configuredPolicy.retentionDays, retentionTrigger: configuredPolicy.retentionTrigger }
        : { available: false }));
    },
    async list(actor: AuthorizationActor, companyId: string, raw: unknown) {
      const query = supportCaseReadQuerySchema.parse(raw);
      return within(actor, companyId, query.expectedUserId, false, async (tx, userId, administrator) => {
        const cursor = query.beforeId ? sql`(${supportCases.createdAt},${supportCases.id})<(${query.beforeCreatedAt}::timestamptz,${query.beforeId}::uuid)` : sql`true`;
        const rows = await tx.select().from(supportCases).where(and(visible(companyId, userId, administrator), cursor))
          .orderBy(desc(supportCases.createdAt), desc(supportCases.id)).limit(SUPPORT_CASE_LIMITS.timelinePage + 1)
          .for("share", { noWait: true });
        const page = rows.slice(0, SUPPORT_CASE_LIMITS.timelinePage), entries = [];
        for (const row of page) { await currentCase(tx, companyId, userId, administrator, row.id); entries.push(await summary(tx, row)); }
        const last = page.at(-1);
        return supportCaseListSchema.parse({ companyId, entries,
          nextCursor: rows.length > SUPPORT_CASE_LIMITS.timelinePage && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null });
      });
    },
    async get(actor: AuthorizationActor, companyId: string, id: string, raw: unknown) {
      const query = supportCaseReadQuerySchema.parse(raw);
      return within(actor, companyId, query.expectedUserId, false, async (tx, userId, administrator) =>
        detail(tx, await currentCase(tx, companyId, userId, administrator, id), userId, administrator, query));
    },
    async getRequest(actor: AuthorizationActor, companyId: string, key: string, expectedUserId: string) {
      return within(actor, companyId, expectedUserId, false, async (tx, userId, administrator) => {
        const event = await existing(tx, companyId, userId, key);
        if (!event) throw notFound("Support request not found");
        return detail(tx, await currentCase(tx, companyId, userId, administrator, event.caseId), userId, administrator);
      });
    },
    async create(actor: AuthorizationActor, companyId: string, raw: unknown) {
      const input = createSupportCaseSchema.parse(raw);
      human(actor, input.expectedUserId);
      await budget(companyId, input.expectedUserId);
      return within(actor, companyId, input.expectedUserId, true, async (tx, userId, administrator, publications) => {
        const hash = digest(["create", companyId, userId, input]), prior = await existing(tx, companyId, userId, input.idempotencyKey);
        if (prior) {
          if (prior.requestHash !== hash) throw conflict("This request key was already used for different content");
          return detail(tx, await currentCase(tx, companyId, userId, administrator, prior.caseId), userId, administrator);
        }
        const eventId = await requestIdentity(tx, companyId, userId, input.idempotencyKey);
        const dataPolicy = policy(), at = await now(tx);
        const [row] = await tx.insert(supportCases).values({ companyId, openedByUserId: userId, category: input.category,
          subject: input.subject ?? deriveSupportCaseSubject(input.description), description: input.description,
          impact: input.impact, safeContext: input.safeContext ?? null, dataPolicy,
          createdAt: at, updatedAt: at, lastMessageAt: at, expiresAt: new Date(at.getTime() + dataPolicy.retentionDays * 86400000) }).returning();
        await tx.insert(supportCaseEvents).values({ id: eventId, companyId, caseId: row!.id, authorUserId: userId,
          kind: "request", body: input.description, customerStatus: "RECEIVED", safeContext: input.safeContext ?? null,
          requestKey: input.idempotencyKey, requestHash: hash, createdAt: at });
        await record(tx, publications, row!, userId, "support.case_created");
        return detail(tx, row!, userId, administrator);
      });
    },
    async reply(actor: AuthorizationActor, companyId: string, id: string, raw: unknown) {
      const input = replySupportCaseSchema.parse(raw);
      human(actor, input.expectedUserId);
      await budget(companyId, input.expectedUserId);
      return within(actor, companyId, input.expectedUserId, true, async (tx, userId, administrator, publications) => {
        const hash = digest(["reply", companyId, userId, id, input]), prior = await existing(tx, companyId, userId, input.idempotencyKey);
        if (prior) {
          if (prior.requestHash !== hash) throw conflict("This request key was already used for different content");
          return detail(tx, await currentCase(tx, companyId, userId, administrator, prior.caseId), userId, administrator);
        }
        const eventId = await requestIdentity(tx, companyId, userId, input.idempotencyKey);
        const original = await currentCase(tx, companyId, userId, administrator, id, true), dataPolicy = policy();
        if (!isDeepStrictEqual(original.dataPolicy, dataPolicy))
          throw conflict("Support processing changed; contact support directly before adding information", { code: "SUPPORT_POLICY_CHANGED" });
        const at = await now(tx), expiresAt = new Date(at.getTime() + dataPolicy.retentionDays * 86400000);
        let row: Case;
        if (original.customerStatus === "CLOSED") {
          const [followUp] = await tx.insert(supportCases).values({ companyId, openedByUserId: userId,
            category: original.category, subject: deriveSupportCaseSubject(input.body), description: input.body,
            safeContext: input.safeContext ?? null, followUpOfId: original.id, dataPolicy,
            createdAt: at, updatedAt: at, lastMessageAt: at, expiresAt }).returning();
          row = followUp!;
        } else {
          const reopening = ["RESOLVED", "WAITING_FOR_YOU"].includes(original.customerStatus);
          const [updated] = await tx.update(supportCases).set({
            customerStatus: reopening ? "INVESTIGATING" : original.customerStatus,
            requestedResponse: null, resolvedAt: reopening ? null : original.resolvedAt,
            lastMessageAt: at, expiresAt, updatedAt: at, version: original.version + 1,
          }).where(eq(supportCases.id, original.id)).returning();
          row = updated!;
        }
        await tx.insert(supportCaseEvents).values({ id: eventId, companyId, caseId: row.id, authorUserId: userId,
          kind: row.id === original.id ? "customer_reply" : "request", body: input.body, customerStatus: row.customerStatus,
          safeContext: input.safeContext ?? null, requestKey: input.idempotencyKey, requestHash: hash, createdAt: at });
        await record(tx, publications, row, userId, row.id === original.id ? "support.customer_replied" : "support.follow_up_created");
        return detail(tx, row, userId, administrator);
      });
    },
    async close(actor: AuthorizationActor, companyId: string, id: string, raw: unknown) {
      const input = closeSupportCaseSchema.parse(raw);
      human(actor, input.expectedUserId);
      await budget(companyId, input.expectedUserId);
      return within(actor, companyId, input.expectedUserId, true, async (tx, userId, administrator, publications) => {
        const hash = digest(["close", companyId, userId, id, input]), prior = await existing(tx, companyId, userId, input.idempotencyKey);
        if (prior) {
          if (prior.requestHash !== hash) throw conflict("This request key was already used for different content");
          return detail(tx, await currentCase(tx, companyId, userId, administrator, prior.caseId), userId, administrator);
        }
        const eventId = await requestIdentity(tx, companyId, userId, input.idempotencyKey);
        const original = await currentCase(tx, companyId, userId, administrator, id, true);
        if (original.customerStatus === "CLOSED") return detail(tx, original, userId, administrator);
        // Closing adds no customer-supplied content and changes no recipient.
        // Keep the original case policy even when new intake is unavailable.
        const dataPolicy = original.dataPolicy;
        const at = await now(tx), expiresAt = new Date(at.getTime() + dataPolicy.retentionDays * 86400000);
        const [account] = await tx.select({ locale: authUsers.locale }).from(authUsers).where(eq(authUsers.id, userId)).limit(1);
        const body = account?.locale === "da"
          ? "Jeg har bedt om at få denne supportsag afsluttet."
          : "I asked to close this support case.";
        const [row] = await tx.update(supportCases).set({
          customerStatus: "CLOSED", requestedResponse: null, closedAt: original.closedAt ?? at,
          lastMessageAt: at, expiresAt, updatedAt: at, version: original.version + 1,
        }).where(eq(supportCases.id, original.id)).returning();
        await tx.insert(supportCaseEvents).values({ id: eventId, companyId, caseId: original.id, authorUserId: userId,
          kind: "customer_reply", body, customerStatus: "CLOSED", requestKey: input.idempotencyKey,
          requestHash: hash, createdAt: at });
        await record(tx, publications, row!, userId, "support.customer_closed_case");
        return detail(tx, row!, userId, administrator);
      });
    },
  };
}

/** Native maintenance drains only expired local content. Holds and attempted
 * external delivery remain with their erasure owner, never a success receipt. */
export async function eraseExpiredSupportCases(db: Db) {
  const eligible = sql`${supportCases.expiresAt}<=clock_timestamp()
    and not (${supportCases.legalHold} and (${supportCases.holdReleaseAt} is null or ${supportCases.holdReleaseAt}>clock_timestamp()))
    and ${supportCases.providerCaseRef} is null and not exists(select 1 from support_case_events e
      where e.company_id=${supportCases.companyId} and e.case_id=${supportCases.id} and (e.delivery_attempt_id is not null
        or e.delivery_provider_key is not null or e.delivery_started_at is not null or e.provider_message_ref is not null
        or e.delivery_state in ('sending','delivered','unknown')))`;
  const [candidate] = await db.select({ companyId: supportCases.companyId }).from(supportCases).where(eligible)
    .orderBy(supportCases.expiresAt, supportCases.id).limit(1);
  if (!candidate) return { erasedCases: 0 };
  const publications: ActivityPublication[] = [];
  const erasedCases = await db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`set local statement_timeout='5s'`);
    const [company] = await tx.select({ id: companies.id }).from(companies)
      .where(eq(companies.id, candidate.companyId)).for("update", { noWait: true });
    if (!company) return 0;
    const rows = await tx.select({ id: supportCases.id }).from(supportCases)
      .where(and(eq(supportCases.companyId, company.id), eligible)).orderBy(supportCases.id).limit(20)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      await tx.delete(supportCases).where(and(eq(supportCases.companyId, company.id), eq(supportCases.id, row.id)));
      await logActivity(tx, { companyId: company.id, actorType: "system", actorId: "support-retention",
        action: "support.case_erased", entityType: "support_case", entityId: row.id, details: null }, publications);
    }
    return rows.length;
  });
  for (const publication of publications) publishActivity(publication);
  return { erasedCases };
}
