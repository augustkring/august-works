import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  authRateLimits,
  authUsers,
  companies,
  companyMemberships,
  customerFeedback,
  customerFeedbackAccess,
  customerFeedbackEvents,
  issues,
  saasNotifications,
  type Db,
} from "@paperclipai/db";
import {
  createCustomerFeedbackSchema,
  customerFeedbackSchema,
  feedbackFollowUpSchema,
  feedbackInternalDetailSchema,
  customerFeedbackRequestReceiptSchema,
  feedbackTriageSchema,
  FEEDBACK_CUSTOMER_STATUS,
  FEEDBACK_CONTEXT_FEATURE_IDS,
  v9FeatureEnabled,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, tooManyRequests } from "../errors.js";
import { instanceSettingsService } from "./instance-settings.js";
import { assertV5Authorization, v5HumanActorId } from "./v5-authorization.js";
import type { AuthorizationActor } from "./authorization.js";
import { serverVersion } from "../version.js";
import { readBuildCommit } from "../build-commit.js";
import { assertConfiguredOperatorAuthentication } from "../auth/authenticator-assurance.js";
import { awOutputFeedbackIsLocal } from "./customer-feedback-privacy.js";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const routeTemplates = {
  home: "/dashboard",
  needs_you: "/needs-you",
  work: "/work",
  agents: "/agents",
  apps: "/apps",
  company: "/company/settings",
  onboarding: "/saas/activation/:screen",
  workflow: "/workflows",
  support: "/company/settings/support",
  other: null,
};
type FeedbackRow = typeof customerFeedback.$inferSelect;
export function customerFeedbackService(
  db: Db,
  options: { operatorUserIds?: readonly string[] } = {},
) {
  async function enabled(reader: Db = db) {
    if (
      !v9FeatureEnabled(
        await instanceSettingsService(reader).getExperimental(),
        "customer_feedback_v9",
      )
    )
      throw notFound("Customer feedback is not enabled");
  }
  async function access(
    reader: Db,
    actor: AuthorizationActor,
    companyId: string,
    lock = false,
  ) {
    const principal = v5HumanActorId(actor);
    await assertV5Authorization(reader, actor, companyId, "company_scope:read");
    let query = reader
      .select()
      .from(companies)
      .where(eq(companies.id, companyId));
    const [company] = await (lock ? query.for("update") : query);
    if (!company || company.status === "archived")
      throw notFound("Company is unavailable");
    if (actor.source !== "local_implicit") {
      const membership = reader
        .select()
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, principal),
            eq(companyMemberships.status, "active"),
          ),
        );
      const [current] = await (lock ? membership.for("share") : membership);
      if (!current) throw forbidden("Active company membership required");
    }
    return principal;
  }
  async function budget(companyId: string, principal: string) {
    const key =
      "customer-feedback:" + digest(principal) + ":" + digest(companyId);
    const now = sql`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`,
      cutoff = sql`${now} - 600000`;
    const [row] = await db
      .insert(authRateLimits)
      .values({ id: randomUUID(), key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
          lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${now} else ${authRateLimits.lastRequest} end`,
        },
      })
      .returning();
    if (row!.count > 20)
      throw tooManyRequests("Feedback request limit reached. Try again later.");
  }
  async function receipt(reader: Db, row: FeedbackRow, includeMessages = true) {
    const messages = includeMessages
      ? await reader
          .select({
            id: customerFeedbackEvents.id,
            kind: customerFeedbackEvents.kind,
            body: customerFeedbackEvents.body,
            createdAt: customerFeedbackEvents.createdAt,
          })
          .from(customerFeedbackEvents)
          .where(
            and(
              eq(customerFeedbackEvents.companyId, row.companyId),
              eq(customerFeedbackEvents.feedbackId, row.id),
              eq(customerFeedbackEvents.customerVisible, true),
            ),
          )
          .orderBy(
            desc(customerFeedbackEvents.createdAt),
            desc(customerFeedbackEvents.id),
          )
          .limit(100)
      : [];
    return customerFeedbackSchema.parse({
      id: row.id,
      feedbackId: "AWF-" + row.id.replaceAll("-", "").toUpperCase(),
      companyId: row.companyId,
      category: row.category,
      body: row.body,
      goal: row.goal,
      blocksWork: row.blocksWork,
      omitName: row.omitName,
      status: row.status,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      messages: messages
        .reverse()
        .map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    });
  }
  async function owned(
    reader: Db,
    companyId: string,
    principal: string,
    id: string,
    lock = false,
  ) {
    const query = reader
      .select({ feedback: customerFeedback })
      .from(customerFeedback)
      .innerJoin(
        customerFeedbackAccess,
        eq(customerFeedbackAccess.feedbackId, customerFeedback.id),
      )
      .where(
        and(
          eq(customerFeedback.companyId, companyId),
          eq(customerFeedbackAccess.companyId, companyId),
          eq(customerFeedback.id, id),
          eq(customerFeedbackAccess.userId, principal),
        ),
      )
      .limit(1);
    const [row] = await (lock ? query.for("update", { of: customerFeedback }) : query);
    if (!row) throw notFound("Feedback not found");
    return row.feedback;
  }
  async function audit(
    reader: Db,
    companyId: string,
    principal: string,
    action: string,
    privateId: string,
  ) {
    // Purpose-separated audit: no feedback text, submitted ID, context or diagnostics in company live events.
    await reader.insert(activityLog).values({
      companyId,
      actorType: "user",
      actorId: principal,
      action,
      entityType: "customer_feedback_access",
      entityId: privateId,
      details: null,
    });
  }
  async function operator(reader: Db, actor: AuthorizationActor, requireRecent = false) {
    await assertConfiguredOperatorAuthentication(reader, actor, options.operatorUserIds ?? [], { requireRecent });
    return v5HumanActorId(actor);
  }
  async function notify(reader: Db, row: FeedbackRow) {
    const recipients = await reader
      .select({
        userId: customerFeedbackAccess.userId,
        prefix: companies.issuePrefix,
      })
      .from(customerFeedbackAccess)
      .innerJoin(companies, eq(companies.id, customerFeedbackAccess.companyId))
      .innerJoin(
        companyMemberships,
        and(
          eq(companyMemberships.companyId, row.companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, customerFeedbackAccess.userId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .where(
        and(
          eq(customerFeedbackAccess.companyId, row.companyId),
          eq(customerFeedbackAccess.feedbackId, row.id),
        ),
      )
      .limit(1);
    for (const recipient of recipients)
      await reader
        .insert(saasNotifications)
        .values({
          companyId: row.companyId,
          userId: recipient.userId,
          category: "work_update",
          title: "Your feedback has an update",
          relativePath: `/${recipient.prefix}/my-feedback?feedbackId=${row.id}`,
          dedupeKey: `feedback:${row.id}:${row.version}`,
        })
        .onConflictDoNothing();
  }
  type RetentionOwner = Pick<FeedbackRow, "id" | "createdAt" | "closedAt" | "status" | "version">;
  async function withRetentionOwner<T>(actor: AuthorizationActor, companyId: string, id: string | null,
    operation: (reader: Db, principal: string, row: RetentionOwner | null) => Promise<T>, requireRecent = false): Promise<T> {
      if (actor.source === "local_implicit") throw forbidden("A verified operator session is required for retention controls");
      return db.transaction(async tx => {
        await tx.execute(sql`set local statement_timeout='5s'`);
        await tx.execute(sql`set local lock_timeout='1s'`);
        const reader = tx as unknown as Db, principal = await operator(reader, actor, requireRecent);
        await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, principal)).for("share");
        const [company] = await tx.select({ id: companies.id, status: companies.status }).from(companies)
          .where(eq(companies.id, companyId)).for("update");
        if (!company) throw notFound("Company is unavailable");
        const [row] = id === null ? [] : await tx.select({ id: customerFeedback.id, createdAt: customerFeedback.createdAt,
          closedAt: customerFeedback.closedAt, status: customerFeedback.status, version: customerFeedback.version }).from(customerFeedback)
          .where(and(eq(customerFeedback.companyId, companyId), eq(customerFeedback.id, id))).for("update");
        const result = await operation(reader, principal, row ?? null);
        await operator(reader, actor, requireRecent);
        return result;
      });
  }
  return {
    /** Charge each admitted byte-processing attempt against the original
     * feedback budget in its reservation transaction. Canonical receipt
     * replays return before this call and never run the scanner again. */
    async chargeImageAttempt(reader: Db, companyId: string, principal: string) {
      const key = "customer-feedback:" + digest(principal) + ":" + digest(companyId);
      const now = sql`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`, cutoff = sql`${now} - 600000`;
      const [row] = await reader.insert(authRateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now })
        .onConflictDoUpdate({ target: authRateLimits.key, set: {
          count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
          lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${now} else ${authRateLimits.lastRequest} end`,
        } }).returning();
      if (row!.count > 20) throw tooManyRequests("Feedback request limit reached. Try again later.");
    },
    async withInternalRetention<T>(actor: AuthorizationActor, companyId: string, id: string,
      operation: (reader: Db, principal: string, row: RetentionOwner) => Promise<T>, requireRecent = false): Promise<T> {
      return withRetentionOwner(actor, companyId, id, (reader, principal, row) => {
        if (!row) throw notFound("Feedback not found");
        return operation(reader, principal, row);
      }, requireRecent);
    },
    /** Same original verified operator admission and company lock. Only minimal
     * erasure receipts may be read/replayed after their feedback parent is gone. */
    withInternalRetentionReceipt: withRetentionOwner,
    /** Short native transactions only: scanning and Storage calls happen
     * outside these locks, then return here to recheck original authority. */
    async withOwnedImage<T>(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      operation: (reader: Db, owner: { id: string; principal: string }) => Promise<T>,
      mutation = false,
    ): Promise<T> {
      return db.transaction(async tx => {
        await tx.execute(sql`set local statement_timeout='5s'`);
        await tx.execute(sql`set local lock_timeout='1s'`);
        const reader = tx as unknown as Db;
        const principal = await access(reader, actor, companyId, true);
        if (mutation) {
          await tx.execute(sql`select singleton_key from instance_settings where singleton_key='default' for share`);
          await enabled(reader);
          await awOutputFeedbackIsLocal(reader);
        }
        await owned(reader, companyId, principal, id, true);
        const result = await operation(reader, { id, principal });
        await access(reader, actor, companyId);
        return result;
      });
    },
    async internalList(
      actor: AuthorizationActor,
      companyId: string,
      beforeId?: string,
    ) {
      return db.transaction(async tx => {
        const reader = tx as unknown as Db;
        await operator(reader, actor);
        const [company] = await reader
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, companyId));
        if (!company) throw notFound("Company not found");
        const [boundary] = beforeId
          ? await reader
              .select()
              .from(customerFeedback)
              .where(
                and(
                  eq(customerFeedback.companyId, companyId),
                  eq(customerFeedback.id, beforeId),
                ),
              )
              .limit(1)
          : [];
        if (beforeId && !boundary) throw notFound("Feedback not found");
        const rows = await reader
          .select()
          .from(customerFeedback)
          .where(
            and(
              eq(customerFeedback.companyId, companyId),
              boundary
                ? sql`(${customerFeedback.createdAt},${customerFeedback.id}) < (select created_at, id from customer_feedback where company_id = ${companyId}::uuid and id = ${boundary.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(customerFeedback.createdAt), desc(customerFeedback.id))
          .limit(25);
        await audit(
          reader,
          companyId,
          v5HumanActorId(actor),
          "customer_feedback.internal_read",
          randomUUID(),
        );
        await operator(reader, actor);
        return rows.map((row) => ({
          id: row.id,
          feedbackId: "AWF-" + row.id.replaceAll("-", "").toUpperCase(),
          category: row.category,
          body: row.body,
          goal: row.goal,
          internalState: row.internalState,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
        }));
      });
    },
    async internalGet(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      beforeEventId?: string,
    ) {
      return db.transaction(async tx => {
        const reader = tx as unknown as Db;
        await operator(reader, actor);
        const [row] = await reader
          .select()
          .from(customerFeedback)
          .where(
            and(
              eq(customerFeedback.companyId, companyId),
              eq(customerFeedback.id, id),
            ),
          );
        if (!row) throw notFound("Feedback not found");
        const [boundary] = beforeEventId
          ? await reader
              .select()
              .from(customerFeedbackEvents)
              .where(
                and(
                  eq(customerFeedbackEvents.companyId, companyId),
                  eq(customerFeedbackEvents.feedbackId, id),
                  eq(customerFeedbackEvents.id, beforeEventId),
                ),
              )
              .limit(1)
          : [];
        if (beforeEventId && !boundary)
          throw notFound("Feedback event not found");
        const events = await reader
          .select({
            id: customerFeedbackEvents.id,
            kind: customerFeedbackEvents.kind,
            body: customerFeedbackEvents.body,
            internalNote: customerFeedbackEvents.internalNote,
            linkType: customerFeedbackEvents.linkType,
            linkId: customerFeedbackEvents.linkId,
            createdAt: customerFeedbackEvents.createdAt,
          })
          .from(customerFeedbackEvents)
          .where(
            and(
              eq(customerFeedbackEvents.companyId, companyId),
              eq(customerFeedbackEvents.feedbackId, id),
              boundary
                ? sql`(${customerFeedbackEvents.createdAt},${customerFeedbackEvents.id}) < (select created_at, id from customer_feedback_events where company_id = ${companyId}::uuid and feedback_id = ${id}::uuid and id = ${boundary.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(
            desc(customerFeedbackEvents.createdAt),
            desc(customerFeedbackEvents.id),
          )
          .limit(101);
        await audit(
          reader,
          companyId,
          v5HumanActorId(actor),
          "customer_feedback.internal_read",
          randomUUID(),
        );
        const page = events.slice(0, 100);
        const result = feedbackInternalDetailSchema.parse({
          ...(await receipt(reader, row)),
          internalState: row.internalState,
          ...(!row.omitName && row.submittedByUserId
            ? { submittedByUserId: row.submittedByUserId }
            : {}),
          context: row.context,
          diagnostics: row.diagnostics,
          events: page.reverse().map((event) => ({
            ...event,
            createdAt: event.createdAt.toISOString(),
          })),
          nextEventCursor: events.length > 100 ? events[99]!.id : null,
        });
        await operator(reader, actor);
        return result;
      });
    },
    async create(actor: AuthorizationActor, companyId: string, raw: unknown) {
      await enabled();
      const input = createCustomerFeedbackSchema.parse(raw);
      const principal = await access(db, actor, companyId);
      await budget(companyId, principal);
      return db.transaction(async (tx) => {
        const reader = tx as unknown as Db;
        await access(reader, actor, companyId, true);
        await awOutputFeedbackIsLocal(reader);
        // Hold the effective admission through commit. A rollback after the
        // preliminary read must not admit a new submission or guessed context.
        await tx.execute(sql`select singleton_key from instance_settings where singleton_key='default' for share`);
        await enabled(reader);
        const hash = digest(input);
        const [old] = await tx
          .select()
          .from(customerFeedbackAccess)
          .where(
            and(
              eq(customerFeedbackAccess.companyId, companyId),
              eq(customerFeedbackAccess.userId, principal),
              eq(customerFeedbackAccess.requestKey, input.idempotencyKey),
            ),
          );
        if (old) {
          if (old.requestHash !== hash)
            throw conflict(
              "This request key was already used for different feedback",
            );
          return receipt(
            reader,
            await owned(reader, companyId, principal, old.feedbackId),
          );
        }
        const flags = await instanceSettingsService(reader).getExperimental();
        const [row] = await tx
          .insert(customerFeedback)
          .values({
            companyId,
            category: input.category,
            body: input.body,
            goal: input.goal,
            blocksWork: input.blocksWork,
            omitName: input.omitName,
            submittedByUserId: input.omitName ? null : principal,
            context: {
              ...input.context,
              routeTemplate: input.context.screenContractId === "SUPPORT-ACCESS" ? "/company/support-access" : routeTemplates[input.context.surfaceKey],
              relevantFeatureFlagIds: FEEDBACK_CONTEXT_FEATURE_IDS.filter((id) => v9FeatureEnabled(flags, id)),
              releaseBuildId:
                readBuildCommit() ?? `unverified:${serverVersion}`,
            },
            diagnostics: input.includeDiagnostics
              ? (input.diagnostics ?? {
                  safeErrorCodes: [],
                  correlationIds: [],
                })
              : null,
          })
          .returning();
        const [link] = await tx
          .insert(customerFeedbackAccess)
          .values({
            companyId,
            feedbackId: row!.id,
            userId: principal,
            requestKey: input.idempotencyKey,
            requestHash: hash,
          })
          .returning();
        await audit(
          reader,
          companyId,
          principal,
          "customer_feedback.received",
          link!.id,
        );
        return receipt(reader, row!);
      });
    },
    async list(
      actor: AuthorizationActor,
      companyId: string,
      beforeId?: string,
    ) {
      const principal = await access(db, actor, companyId);
      const boundary = beforeId
        ? await owned(db, companyId, principal, beforeId)
        : null;
      const rows = await db
        .select({ feedback: customerFeedback })
        .from(customerFeedback)
        .innerJoin(
          customerFeedbackAccess,
          eq(customerFeedbackAccess.feedbackId, customerFeedback.id),
        )
        .where(
          and(
            eq(customerFeedback.companyId, companyId),
            eq(customerFeedbackAccess.companyId, companyId),
            eq(customerFeedbackAccess.userId, principal),
            boundary
              ? sql`(${customerFeedback.createdAt},${customerFeedback.id}) < (select created_at, id from customer_feedback where company_id = ${companyId}::uuid and id = ${boundary.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(customerFeedback.createdAt), desc(customerFeedback.id))
        .limit(25);
      const results = await Promise.all(
        rows.map((row) => receipt(db, row.feedback, false)),
      );
      await access(db, actor, companyId);
      return results;
    },
    /** Read the Original actor-owned request slot. Absence can precede a late
     * commit and never authorizes changing the pending key or repeating work. */
    async requestReceipt(actor: AuthorizationActor, companyId: string, rawKey: string) {
      const requestKey = customerFeedbackRequestReceiptSchema.shape.requestKey.parse(rawKey).toLowerCase();
      return db.transaction(async tx => {
        await tx.execute(sql`set local statement_timeout='5s'`);
        await tx.execute(sql`set local lock_timeout='1s'`);
        const reader = tx as unknown as Db, principal = await access(reader, actor, companyId, true);
        const [link] = await tx.select({ feedbackId: customerFeedbackAccess.feedbackId }).from(customerFeedbackAccess)
          .where(and(eq(customerFeedbackAccess.companyId, companyId), eq(customerFeedbackAccess.userId, principal),
            eq(customerFeedbackAccess.requestKey, requestKey)));
        let value: Awaited<ReturnType<typeof receipt>> | null = null;
        if (link) {
          // Lock the case before its child access slot, matching erasure's
          // parent-first order; re-resolve the exact slot after that lock.
          const row = await owned(reader, companyId, principal, link.feedbackId, true);
          const [retained] = await tx.select({ feedbackId: customerFeedbackAccess.feedbackId }).from(customerFeedbackAccess)
            .where(and(eq(customerFeedbackAccess.companyId, companyId), eq(customerFeedbackAccess.userId, principal),
              eq(customerFeedbackAccess.requestKey, requestKey), eq(customerFeedbackAccess.feedbackId, row.id))).for("share");
          if (!retained) throw notFound("Feedback request is unavailable");
          value = await receipt(reader, row);
        }
        await access(reader, actor, companyId, true);
        return customerFeedbackRequestReceiptSchema.parse({ requestKey, receipt: value });
      });
    },
    async get(actor: AuthorizationActor, companyId: string, id: string) {
      const principal = await access(db, actor, companyId);
      const result = await receipt(
        db,
        await owned(db, companyId, principal, id),
      );
      await access(db, actor, companyId);
      return result;
    },
    async followUp(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: unknown,
    ) {
      const input = feedbackFollowUpSchema.parse(raw),
        principal = await access(db, actor, companyId);
      await budget(companyId, principal);
      return db.transaction(async (tx) => {
        const reader = tx as unknown as Db;
        await access(reader, actor, companyId, true);
        const row = await owned(reader, companyId, principal, id),
          hash = digest(input);
        const [prior] = await tx
          .select()
          .from(customerFeedbackEvents)
          .where(
            and(
              eq(customerFeedbackEvents.feedbackId, id),
              eq(customerFeedbackEvents.requestKey, input.idempotencyKey),
            ),
          );
        if (prior) {
          if (prior.requestHash !== hash || prior.kind !== "customer_follow_up")
            throw conflict("Request key already used");
          return receipt(reader, row);
        }
        if (row.version !== input.expectedVersion)
          throw conflict("Feedback changed; refresh before responding");
        if (row.status !== "NEEDS_INFO")
          throw conflict("Feedback is not awaiting a response");
        await tx.insert(customerFeedbackEvents).values({
          companyId,
          feedbackId: id,
          kind: "customer_follow_up",
          body: input.body,
          customerVisible: true,
          requestKey: input.idempotencyKey,
          requestHash: hash,
        });
        const [updated] = await tx
          .update(customerFeedback)
          .set({
            status: "REVIEWING",
            internalState: "UNDER_REVIEW",
            version: row.version + 1,
          })
          .where(
            and(
              eq(customerFeedback.id, id),
              eq(customerFeedback.version, row.version),
            ),
          )
          .returning();
        if (!updated) throw conflict("Feedback changed");
        await audit(
          reader,
          companyId,
          principal,
          "customer_feedback.follow_up",
          randomUUID(),
        );
        return receipt(reader, updated);
      });
    },
    async triage(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: unknown,
    ) {
      const input = feedbackTriageSchema.parse(raw);
      return db.transaction(async (tx) => {
        const reader = tx as unknown as Db,
          principal = await operator(reader, actor, true);
        const [company] = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("update");
        if (!company || company.status === "archived") throw notFound();
        const [row] = await tx
          .select()
          .from(customerFeedback)
          .where(
            and(
              eq(customerFeedback.id, id),
              eq(customerFeedback.companyId, companyId),
            ),
          )
          .for("update");
        if (!row) throw notFound("Feedback not found");
        if (input.link) {
          if (input.link.type === "duplicate" && input.link.id === id)
            throw conflict("Feedback cannot duplicate itself");
          const target =
            input.link.type === "issue" ? issues : customerFeedback;
          const [linked] = await tx
            .select({ id: target.id })
            .from(target)
            .where(
              and(
                eq(target.companyId, companyId),
                eq(target.id, input.link.id),
              ),
            );
          if (!linked) throw notFound("Linked work is unavailable");
        }
        const hash = digest(input),
          [prior] = await tx
            .select()
            .from(customerFeedbackEvents)
            .where(
              and(
                eq(customerFeedbackEvents.feedbackId, id),
                eq(customerFeedbackEvents.requestKey, input.idempotencyKey),
              ),
            );
        if (prior) {
          if (prior.requestHash !== hash || prior.kind !== "product_message")
            throw conflict("Request key already used");
          const result = await receipt(reader, row);
          await operator(reader, actor, true);
          return result;
        }
        if (row.version !== input.expectedVersion)
          throw conflict("Feedback changed; refresh before triage");
        await tx.insert(customerFeedbackEvents).values({
          companyId,
          feedbackId: id,
          kind: "product_message",
          body: input.customerMessage,
          internalNote: input.internalNote || null,
          linkType: input.link?.type ?? null,
          linkId: input.link?.id ?? null,
          customerVisible: !!input.customerMessage,
          requestKey: input.idempotencyKey,
          requestHash: hash,
        });
        const [updated] = await tx
          .update(customerFeedback)
          .set({
            status: FEEDBACK_CUSTOMER_STATUS[input.internalState],
            closedAt: ["CLOSED", "RESOLVED"].includes(FEEDBACK_CUSTOMER_STATUS[input.internalState])
              ? row.closedAt ?? sql`clock_timestamp()` : null,
            internalState: input.internalState,
            version: row.version + 1,
          })
          .where(
            and(
              eq(customerFeedback.id, id),
              eq(customerFeedback.version, row.version),
            ),
          )
          .returning();
        if (!updated) throw conflict("Feedback changed");
        await audit(
          reader,
          companyId,
          principal,
          "customer_feedback.triaged",
          randomUUID(),
        );
        if (input.customerMessage) await notify(reader, updated);
        const result = await receipt(reader, updated);
        await operator(reader, actor, true);
        return result;
      });
    },
  };
}
