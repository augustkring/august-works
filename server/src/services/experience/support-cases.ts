import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  accountDeletionOperations, authRateLimits, authUsers, companies, companyDeletionOperations, companyMemberships,
  agents, heartbeatRuns, issues, supportCases, supportCaseEvents, supportCaseDeletionMarkers, supportCaseIssueLinks, type Db,
} from "@paperclipai/db";
import {
  createSupportCaseSchema, replySupportCaseSchema, closeSupportCaseSchema, deriveSupportCaseSubject,
  nativeSupportCaseRequestSchema,
  supportCaseReadQuerySchema, supportCaseDetailSchema, supportCaseListSchema, supportCaseDataPolicySchema, supportCaseIntakePolicySchema,
  linkSupportCaseIssueSchema, supportCaseIssueLinkSchema,
  SUPPORT_CASE_LIMITS, type SupportCaseDataPolicy, type SupportCaseDetail,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, tooManyRequests, unprocessable } from "../../errors.js";
import { pinCurrentBoardActor, type AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { withCurrentTaskSourceRead } from "../task-source-read-scope.js";
import { z } from "zod";

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
  async function readableIssueLink(tx: Db, actor: AuthorizationActor, userId: string, administrator: boolean, companyId: string, caseId: string) {
    const issue = await withCurrentTaskSourceRead(tx, companyId, actor, async (sourceTx) => {
      const [row] = await sourceTx.select({ issueId: supportCaseIssueLinks.issueId }).from(supportCaseIssueLinks)
        .where(and(eq(supportCaseIssueLinks.companyId, companyId), eq(supportCaseIssueLinks.caseId, caseId)))
        .limit(1).for("share", { noWait: true });
      if (!row) return null;
      const [candidate] = await sourceTx.select({ id: issues.id, identifier: issues.identifier }).from(issues).where(and(
        eq(issues.companyId, companyId), eq(issues.id, row.issueId),
      )).limit(1).for("share", { noWait: true });
      if (!candidate) return null;
      try {
        await assertV5Authorization(sourceTx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: candidate.id });
        return { id: candidate.id, identifier: candidate.identifier };
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && [403, 404].includes(Number(error.status))) return null;
        throw error;
      }
    });
    await currentCase(tx, companyId, userId, administrator, caseId);
    return issue;
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
  async function detail(tx: Db, row: Case, userId: string, administrator: boolean, actor: AuthorizationActor, query?: Query) {
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
      relatedIssue: await readableIssueLink(tx, actor, userId, administrator, row.companyId, row.id),
      timeline: page.reverse().map(e => ({ id: e.id, kind: e.kind, body: e.body, status: e.customerStatus,
        author: ["request", "customer_reply"].includes(e.kind) ? "customer" : "support", safeContext: e.safeContext,
        delivery: delivery(e), createdAt: e.createdAt.toISOString() })),
      nextCursor: events.length > SUPPORT_CASE_LIMITS.timelinePage && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null });
  }
  async function budget(companyId: string, userId: string) {
    const now = sql`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`;
    const cutoff = sql`${now} - 600000`, key = "support-case:" + digest(userId) + ":" + digest(companyId);
    const [row] = await db.insert(authRateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now })
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
  function observedPolicy(revision: string) {
    const current = policy();
    // This is an optimistic disclosure revision, never access or delivery proof.
    // Hash the parsed full policy so reusing a configured version cannot silently
    // change recipient, region or retention under an already displayed form.
    if (revision !== digest(current))
      throw conflict("Support processing changed; review the current disclosure before sending", { code: "SUPPORT_POLICY_CHANGED" });
    return current;
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
    /** Export construction remains inside this original authorization owner and
     * physical transaction. The projection is data, never an escaped grant. */
    async withExport<T>(actor: AuthorizationActor, companyId: string, expectedUserId: string,
      work: (tx: Db, archive: {
        schema: "blentera.support-cases.v1"; companyId: string; exportedAt: string;
        caseCount: number; eventCount: number; contentSha256: string; exclusions: string[];
        cases: SupportCaseDetail[];
      }) => Promise<T>) {
      return within(actor, companyId, expectedUserId, true, async (tx, userId, administrator, publications) => {
        // ponytail: the existing bundle is in memory; reject beyond these
        // ceilings rather than truncate. Use the native durable streaming
        // export owner when larger support archives are needed.
        const rows = await tx.select().from(supportCases).where(visible(companyId, userId, administrator))
          .orderBy(supportCases.createdAt, supportCases.id).limit(1001).for("share", { noWait: true });
        if (rows.length > 1000) throw unprocessable("Support archive exceeds the 1000-case export limit");
        const cases: SupportCaseDetail[] = [];
        let eventCount = 0, bytes = 0;
        for (const row of rows) {
          const first = await detail(tx, row, userId, administrator, actor);
          const timeline = [...first.timeline];
          let cursor = first.nextCursor;
          while (cursor) {
            const page = await detail(tx, row, userId, administrator, actor, {
              expectedUserId, beforeCreatedAt: cursor.createdAt, beforeId: cursor.id,
            });
            timeline.unshift(...page.timeline);
            cursor = page.nextCursor;
            if (eventCount + timeline.length > 10000) throw unprocessable("Support archive exceeds the 10000-event export limit");
          }
          eventCount += timeline.length;
          if (eventCount > 10000) throw unprocessable("Support archive exceeds the 10000-event export limit");
          const exported = { ...first, timeline, nextCursor: null };
          bytes += Buffer.byteLength(JSON.stringify(exported), "utf8");
          if (bytes > 16 * 1024 * 1024) throw unprocessable("Support archive exceeds the 16 MiB export limit");
          cases.push(exported);
        }
        const archive = { schema: "blentera.support-cases.v1" as const, companyId,
          exportedAt: (await now(tx)).toISOString(), caseCount: cases.length, eventCount,
          contentSha256: digest(cases), cases,
          exclusions: ["Internal support notes", "Provider identifiers and delivery attempts", "Credentials and privileged support grants", "Legal holds and internal processing policy", "Erased or expired content"] };
        const result = await work(tx, archive);
        // Export may wait on other native domains. Recheck at the actual return,
        // after all bundle construction, while original rows remain pinned.
        for (const row of rows) await currentCase(tx, companyId, userId, administrator, row.id);
        await logActivity(tx, { companyId, actorType: "user", actorId: userId,
          action: "support.cases_exported", entityType: "company", entityId: companyId, details: null }, publications);
        return result;
      });
    },
    async intakePolicy(actor: AuthorizationActor, companyId: string, expectedUserId: string) {
      return within(actor, companyId, expectedUserId, false, async () => supportCaseIntakePolicySchema.parse(configuredPolicy
        ? { available: true, revision: digest(configuredPolicy), recipientName: configuredPolicy.recipientName, privacyNoticeUrl: configuredPolicy.privacyNoticeUrl,
            retentionDays: configuredPolicy.retentionDays, retentionTrigger: configuredPolicy.retentionTrigger }
        : { available: false }));
    },
    async intakePolicyFromNative(actor: AuthorizationActor, companyId: string) {
      if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId ||
        !actor.agentId || !actor.runId || !actor.onBehalfOfUserId || actor.keyId || actor.keyScope ||
        (actor.authenticatedCredentialExpiresAt != null && actor.authenticatedCredentialExpiresAt <= Date.now()))
        throw forbidden("A current Native Agent run is required to read Support intake status");
      return withCurrentTaskSourceRead(db, companyId, actor, async (tx) => {
        const [run] = await tx.select({ id: heartbeatRuns.id, status: heartbeatRuns.status,
          responsibleUserId: heartbeatRuns.responsibleUserId, runtimeModeResolvedAt: heartbeatRuns.runtimeModeResolvedAt })
          .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId!),
            eq(heartbeatRuns.agentId, actor.agentId!), eq(heartbeatRuns.responsibleUserId, actor.onBehalfOfUserId!),
            eq(heartbeatRuns.status, "running"), eq(heartbeatRuns.runtimeMode, "native"))).limit(1).for("share");
        if (!run || run.runtimeModeResolvedAt !== null) throw forbidden("The accountable Native run is no longer current");
        const [membership] = await tx.select({ principalId: companyMemberships.principalId }).from(companyMemberships)
          .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, actor.onBehalfOfUserId!), eq(companyMemberships.status, "active")))
          .limit(1).for("share", { noWait: true });
        if (!membership) throw forbidden("Current Human company membership is required");
        await assertV5Authorization(tx, actor, companyId, "company_scope:read");
        return supportCaseIntakePolicySchema.parse(configuredPolicy
          ? { available: true, revision: digest(configuredPolicy), recipientName: configuredPolicy.recipientName,
              privacyNoticeUrl: configuredPolicy.privacyNoticeUrl, retentionDays: configuredPolicy.retentionDays,
              retentionTrigger: configuredPolicy.retentionTrigger }
          : { available: false });
      }, false, true);
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
        detail(tx, await currentCase(tx, companyId, userId, administrator, id), userId, administrator, actor, query));
    },
    async linkIssue(actor: AuthorizationActor, companyId: string, caseId: string, raw: unknown) {
      const input = linkSupportCaseIssueSchema.parse(raw);
      return within(actor, companyId, input.expectedUserId, true, async (tx, userId, administrator, publications) => {
        const source = await currentCase(tx, companyId, userId, administrator, caseId, true);
        const [issue] = await withCurrentTaskSourceRead(tx, companyId, actor, async (sourceTx) => {
          const issueId = z.uuid().safeParse(input.issueRef);
          const [candidate] = await sourceTx.select({ id: issues.id, identifier: issues.identifier }).from(issues).where(and(
            eq(issues.companyId, companyId), issueId.success ? eq(issues.id, issueId.data) : eq(issues.identifier, input.issueRef),
          )).limit(1).for("share", { noWait: true });
          if (!candidate) throw notFound("Issue not found");
          await assertV5Authorization(sourceTx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: candidate.id });
          return [candidate];
        });
        if (!issue) throw notFound("Issue not found");
        const [linked] = await tx.insert(supportCaseIssueLinks).values({ companyId, caseId: source.id, issueId: issue.id, linkedByUserId: userId })
          .onConflictDoNothing().returning({ id: supportCaseIssueLinks.id });
        if (!linked) {
          const [existingLink] = await tx.select({ issueId: supportCaseIssueLinks.issueId }).from(supportCaseIssueLinks)
            .where(and(eq(supportCaseIssueLinks.companyId, companyId), eq(supportCaseIssueLinks.caseId, caseId))).limit(1).for("share", { noWait: true });
          if (existingLink?.issueId !== issue.id) throw conflict("This support case is already linked to another Issue");
        } else await record(tx, publications, source, userId, "support.case_issue_linked");
        await currentCase(tx, companyId, userId, administrator, caseId);
        return supportCaseIssueLinkSchema.parse({ companyId, caseId, issue: await readableIssueLink(tx, actor, userId, administrator, companyId, caseId) });
      });
    },
    async getRequest(actor: AuthorizationActor, companyId: string, key: string, expectedUserId: string) {
      return within(actor, companyId, expectedUserId, false, async (tx, userId, administrator) => {
        const event = await existing(tx, companyId, userId, key);
        if (!event) throw notFound("Support request not found");
        return detail(tx, await currentCase(tx, companyId, userId, administrator, event.caseId), userId, administrator, actor);
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
          return detail(tx, await currentCase(tx, companyId, userId, administrator, prior.caseId), userId, administrator, actor);
        }
        const eventId = await requestIdentity(tx, companyId, userId, input.idempotencyKey);
        const dataPolicy = observedPolicy(input.expectedPolicyRevision), at = await now(tx);
        const [row] = await tx.insert(supportCases).values({ companyId, openedByUserId: userId, category: input.category,
          subject: input.subject ?? deriveSupportCaseSubject(input.description), description: input.description,
          impact: input.impact, safeContext: input.safeContext ?? null, dataPolicy,
          createdAt: at, updatedAt: at, lastMessageAt: at, expiresAt: new Date(at.getTime() + dataPolicy.retentionDays * 86400000) }).returning();
        await tx.insert(supportCaseEvents).values({ id: eventId, companyId, caseId: row!.id, authorUserId: userId,
          kind: "request", body: input.description, customerStatus: "RECEIVED", safeContext: input.safeContext ?? null,
          requestKey: input.idempotencyKey, requestHash: hash, createdAt: at });
        await record(tx, publications, row!, userId, "support.case_created");
        return detail(tx, row!, userId, administrator, actor);
      });
    },
    /** A narrow Native request path. It attributes the durable case to the
     * run's current Human while keeping the Agent as the activity actor. It
     * creates only a local case receipt; delivery remains separately governed. */
    async createFromNative(actor: AuthorizationActor, companyId: string, raw: unknown) {
      const input = nativeSupportCaseRequestSchema.parse(raw);
      if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId ||
        !actor.agentId || !actor.runId || !actor.onBehalfOfUserId || actor.keyId || actor.keyScope ||
        (actor.authenticatedCredentialExpiresAt != null && actor.authenticatedCredentialExpiresAt <= Date.now()))
        throw forbidden("A current Native Agent run is required to request Support");
      const userId = actor.onBehalfOfUserId;
      await budget(companyId, userId);
      const result = await withCurrentTaskSourceRead(db, companyId, actor, async (tx) => {
        await tx.execute(sql`set local statement_timeout='5s'`);
        const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("share");
        if (!company || company.status === "archived" || company.contentErasureTransactionId || company.pauseReason === "company_deleted")
          throw notFound("Company is unavailable");
        const [deleting] = await tx.select({ id: companyDeletionOperations.id }).from(companyDeletionOperations)
          .where(eq(companyDeletionOperations.companyId, companyId)).limit(1);
        const [erasing] = await tx.select({ id: accountDeletionOperations.id }).from(accountDeletionOperations)
          .where(eq(accountDeletionOperations.userId, userId)).limit(1);
        if (deleting || erasing) throw forbidden("Support access is no longer available");
        const [run] = await tx.select().from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId!), eq(heartbeatRuns.agentId, actor.agentId!),
          eq(heartbeatRuns.responsibleUserId, userId), eq(heartbeatRuns.status, "running"), eq(heartbeatRuns.runtimeMode, "native"),
        )).limit(1).for("share");
        if (!run || run.runtimeModeResolvedAt !== null) throw forbidden("The accountable Native run is no longer current");
        const [agent] = await tx.select({ id: agents.id, status: agents.status }).from(agents).where(and(
          eq(agents.companyId, companyId), eq(agents.id, actor.agentId!),
        )).limit(1).for("share");
        if (!agent || ["paused", "terminated", "pending_approval", "error"].includes(agent.status))
          throw forbidden("The current Co-worker is unavailable");
        const [human] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, userId)).limit(1).for("share");
        const [membership] = await tx.select().from(companyMemberships).where(and(
          eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"),
        )).limit(1).for("share", { noWait: true });
        if (!human || !membership) throw forbidden("Current Human company membership is required");
        await assertV5Authorization(tx, actor, companyId, "company_scope:read");
        if (!run.nativeIssueId) throw forbidden("A current Task is required to request Support");
        const [currentIssue] = await tx.select({ id: issues.id }).from(issues).where(and(
          eq(issues.companyId, companyId), eq(issues.id, run.nativeIssueId), eq(issues.assigneeAgentId, actor.agentId!),
        )).limit(1).for("share");
        if (!currentIssue) throw forbidden("The current Task is unavailable");
        await assertV5Authorization(tx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: currentIssue.id });
        const hash = digest(["create", companyId, userId, input]);
        const prior = await existing(tx, companyId, userId, input.idempotencyKey);
        if (prior) {
          if (prior.requestHash !== hash) throw conflict("This request key was already used for different content");
          return detail(tx, await currentCase(tx, companyId, userId, ["owner", "admin"].includes(membership.membershipRole ?? ""), prior.caseId), userId,
            ["owner", "admin"].includes(membership.membershipRole ?? ""), actor);
        }
        const eventId = await requestIdentity(tx, companyId, userId, input.idempotencyKey);
        const dataPolicy = observedPolicy(input.expectedPolicyRevision), at = await now(tx);
        const [row] = await tx.insert(supportCases).values({ companyId, openedByUserId: userId, category: input.category,
          subject: input.subject ?? deriveSupportCaseSubject(input.description), description: input.description,
          impact: input.impact, safeContext: input.safeContext ?? null, dataPolicy,
          createdAt: at, updatedAt: at, lastMessageAt: at, expiresAt: new Date(at.getTime() + dataPolicy.retentionDays * 86400000) }).returning();
        await tx.insert(supportCaseEvents).values({ id: eventId, companyId, caseId: row!.id, authorUserId: userId,
          kind: "request", body: input.description, customerStatus: "RECEIVED", safeContext: input.safeContext ?? null,
          requestKey: input.idempotencyKey, requestHash: hash, createdAt: at });
        await logActivity(tx, { companyId, actorType: "agent", actorId: actor.agentId!, agentId: actor.agentId!, runId: actor.runId!,
          action: "support.case_requested", entityType: "support_case", entityId: row!.id,
          details: { supportCaseId: row!.id, representedUserId: userId, requestKey: input.idempotencyKey } });
        const administrator = ["owner", "admin"].includes(membership.membershipRole ?? "");
        return detail(tx, row!, userId, administrator, actor);
      }, true, true);
      return result;
    },
    async reply(actor: AuthorizationActor, companyId: string, id: string, raw: unknown) {
      const input = replySupportCaseSchema.parse(raw);
      human(actor, input.expectedUserId);
      await budget(companyId, input.expectedUserId);
      return within(actor, companyId, input.expectedUserId, true, async (tx, userId, administrator, publications) => {
        const hash = digest(["reply", companyId, userId, id, input]), prior = await existing(tx, companyId, userId, input.idempotencyKey);
        if (prior) {
          if (prior.requestHash !== hash) throw conflict("This request key was already used for different content");
          return detail(tx, await currentCase(tx, companyId, userId, administrator, prior.caseId), userId, administrator, actor);
        }
        const eventId = await requestIdentity(tx, companyId, userId, input.idempotencyKey);
        const original = await currentCase(tx, companyId, userId, administrator, id, true), dataPolicy = observedPolicy(input.expectedPolicyRevision);
        if (!isDeepStrictEqual(original.dataPolicy, dataPolicy))
          throw conflict("Support processing changed; contact support directly before adding information", { code: "SUPPORT_CASE_POLICY_CHANGED" });
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
        return detail(tx, row, userId, administrator, actor);
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
          return detail(tx, await currentCase(tx, companyId, userId, administrator, prior.caseId), userId, administrator, actor);
        }
        const eventId = await requestIdentity(tx, companyId, userId, input.idempotencyKey);
        const original = await currentCase(tx, companyId, userId, administrator, id, true);
        if (original.customerStatus === "CLOSED") return detail(tx, original, userId, administrator, actor);
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
        return detail(tx, row!, userId, administrator, actor);
      });
    },
  };
}

/** Native maintenance drains only expired local content. Holds and attempted
 * external delivery remain with their erasure owner, never a success receipt. */
export async function eraseExpiredSupportCases(db: Db) {
  // A delivery lease is evidence that an attempt may have reached its
  // provider. Once its lease expires, preserve that uncertainty as `unknown`;
  // never return it to `pending`, which could cause a duplicate external send.
  // This is a bounded native state transition only. It does not contact a
  // provider or claim that delivery succeeded.
  const expiredAttempts = await db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`set local statement_timeout='2s'`);
    // Match support intake/deletion lock order: company, case, then event.
    // SKIP LOCKED lets a busy company root or case defer to a later sweep.
    const [company] = await tx.select({ id: companies.id }).from(companies)
      .where(sql`exists(select 1 from support_cases c join support_case_events e
        on e.company_id=c.company_id and e.case_id=c.id
        where c.company_id=${companies.id} and e.delivery_state='sending'
          and e.delivery_lease_until<=clock_timestamp())`)
      .orderBy(companies.id).limit(1).for("update", { skipLocked: true });
    if (!company) return 0;
    const cases = await tx.select({ id: supportCases.id }).from(supportCases)
      .where(and(eq(supportCases.companyId, company.id), sql`exists(select 1 from support_case_events e
        where e.company_id=${supportCases.companyId} and e.case_id=${supportCases.id}
          and e.delivery_state='sending' and e.delivery_lease_until<=clock_timestamp())`))
      .orderBy(supportCases.id).limit(100).for("update", { skipLocked: true });
    if (!cases.length) return 0;
    const events = await tx.select({ id: supportCaseEvents.id }).from(supportCaseEvents)
      .where(and(inArray(supportCaseEvents.caseId, cases.map(row => row.id)),
        eq(supportCaseEvents.deliveryState, "sending"), sql`${supportCaseEvents.deliveryLeaseUntil}<=clock_timestamp()`))
      .orderBy(supportCaseEvents.caseId, supportCaseEvents.id).limit(100)
      .for("update", { skipLocked: true });
    if (!events.length) return 0;
    const updated = await tx.update(supportCaseEvents).set({ deliveryState: "unknown", deliveryLeaseUntil: null })
      .where(and(inArray(supportCaseEvents.id, events.map(row => row.id)),
        eq(supportCaseEvents.deliveryState, "sending"), sql`${supportCaseEvents.deliveryLeaseUntil}<=clock_timestamp()`))
      .returning({ id: supportCaseEvents.id });
    return updated.length;
  });
  const eligible = sql`${supportCases.expiresAt}<=clock_timestamp()
    and not (${supportCases.legalHold} and (${supportCases.holdReleaseAt} is null or ${supportCases.holdReleaseAt}>clock_timestamp()))
    and ${supportCases.providerCaseRef} is null and not exists(select 1 from support_case_events e
      where e.company_id=${supportCases.companyId} and e.case_id=${supportCases.id} and (e.delivery_attempt_id is not null
        or e.delivery_provider_key is not null or e.delivery_started_at is not null or e.provider_message_ref is not null
        or e.delivery_state in ('sending','delivered','unknown')))`;
  const [candidate] = await db.select({ companyId: supportCases.companyId }).from(supportCases).where(eligible)
    .orderBy(supportCases.expiresAt, supportCases.id).limit(1);
  if (!candidate) return { erasedCases: 0, expiredAttempts };
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
  return { erasedCases, expiredAttempts };
}
