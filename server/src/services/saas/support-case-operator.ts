import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { authUsers, companies, supportCases, supportCaseEvents, supportCaseDeletionMarkers, type Db } from "@paperclipai/db";
import { supportCaseDataPolicySchema, supportCaseStatusSchema, type SupportCaseStatus } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { assertConfiguredOperatorAuthentication, assertPinnedAuthenticationDeadline, isAuthenticationStateBusy } from "../../auth/authenticator-assurance.js";
import type { AuthorizationActor } from "../authorization.js";
import { z } from "zod";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const deterministicUuid = (hex: string) => { const b = Buffer.from(hex.slice(0,32), "hex"); b[6] = (b[6]! & 0x0f) | 0x80; b[8] = (b[8]! & 0x3f) | 0x80; const h = b.toString("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
const supportText = z.string().trim().min(1).max(10000).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value), "Enter valid text without zero characters");
const commandSchema = z.strictObject({
  caseId: z.uuid().toLowerCase(), companyId: z.uuid().toLowerCase(), expectedVersion: z.number().int().nonnegative(),
  requestKey: z.uuid().toLowerCase(), body: supportText, status: supportCaseStatusSchema.optional(),
});
export const supportCaseOperatorBodySchema = commandSchema.omit({ caseId: true });
export const supportCaseOperatorReceiptSchema = z.strictObject({ caseId: z.uuid(), eventId: z.uuid(), version: z.number().int().nonnegative(), status: supportCaseStatusSchema });

/** Customer-facing correspondence authored by a verified configured operator. This owner never opens tenant content or grants support access. */
export function supportCaseOperatorService(db: Db, operatorUserIds: readonly string[]) {
  return { async respond(actor: AuthorizationActor, raw: unknown): Promise<{ caseId: string; eventId: string; version: number; status: SupportCaseStatus }> {
    const input = commandSchema.parse(raw);
    if (actor.type !== "board" || actor.source !== "session" || !actor.userId || !actor.sessionId)
      throw forbidden("Authenticate again to continue");
    const publications: ActivityPublication[] = [];
    try {
      const result = await db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db;
      await tx.execute(sql`set local statement_timeout='5s'`);
      const operatorId = actor.userId;
      if (!operatorId) throw forbidden("Authenticate again to continue");
      const proof = await assertConfiguredOperatorAuthentication(tx, actor, operatorUserIds, { requireRecent: true });
      const [caseHint] = await tx.select({ openedByUserId: supportCases.openedByUserId }).from(supportCases)
        .where(and(eq(supportCases.id, input.caseId), eq(supportCases.companyId, input.companyId))).limit(1);
      if (!caseHint) throw notFound();
      if (caseHint.openedByUserId !== operatorId) {
        const [opener] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, caseHint.openedByUserId)).for("share", { noWait: true }).limit(1);
        if (!opener) throw notFound();
      }
      const [company] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.id, input.companyId), sql`${companies.status}<>'archived'`, sql`(${companies.pauseReason} is null or ${companies.pauseReason}<>'company_deleted')`, isNull(companies.contentErasureTransactionId), sql`not exists(select 1 from company_deletion_operations d where d.company_id=${companies.id})`)).for("share", { noWait: true }).limit(1);
      if (!company) throw notFound();
      const [row] = await tx.select({ version: supportCases.version, customerStatus: supportCases.customerStatus,
        requestedResponse: supportCases.requestedResponse, dataPolicy: supportCases.dataPolicy,
        resolvedAt: supportCases.resolvedAt, closedAt: supportCases.closedAt }).from(supportCases)
        .where(and(eq(supportCases.id, input.caseId), eq(supportCases.companyId, input.companyId),
          eq(supportCases.openedByUserId, caseHint.openedByUserId), sql`${supportCases.expiresAt}>clock_timestamp()`,
          sql`not exists(select 1 from account_deletion_operations d where d.user_id=${supportCases.openedByUserId})`))
        .for("update", { noWait: true }).limit(1);
      if (!row) throw notFound();
      const requestHash = sha({ companyId: input.companyId, caseId: input.caseId, operatorId, expectedVersion: input.expectedVersion, body: input.body, status: input.status ?? null });
      const eventId = deterministicUuid(sha({ purpose: "support-operator-event", companyId: input.companyId, operatorId, requestKey: input.requestKey }));
      const [marker] = await tx.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.subjectId, eventId)).limit(1);
      if (marker) throw forbidden("This support command has been erased");
      const [prior] = await tx.select().from(supportCaseEvents).where(and(eq(supportCaseEvents.companyId, input.companyId), eq(supportCaseEvents.authorUserId, operatorId), eq(supportCaseEvents.requestKey, input.requestKey))).limit(1);
      if (prior) {
        if (prior.requestHash !== requestHash) throw conflict("Idempotency key reused with different content");
        await assertPinnedAuthenticationDeadline(tx, proof);
        return { caseId: input.caseId, eventId: prior.id, version: input.expectedVersion + 1, status: prior.customerStatus };
      } else {
        if (row.version !== input.expectedVersion) throw conflict("Support case changed; reload before responding", { code: "STALE_SUPPORT_CASE" });
        const oldStatus = row.customerStatus;
        const nextStatus = input.status ?? oldStatus;
        if (oldStatus === "CLOSED") throw conflict("Closed support cases cannot be changed; create a customer follow-up");
        const kind = nextStatus === "RESOLVED" && nextStatus !== oldStatus ? "resolution" : input.status && nextStatus !== oldStatus ? "status_change" : "support_message";
        const policy = supportCaseDataPolicySchema.parse(row.dataPolicy);
        const [at] = await tx.execute<{ at: Date }>(sql`select clock_timestamp() at`);
        const timestamp = new Date(at!.at);
        await tx.insert(supportCaseEvents).values({ id: eventId, companyId: input.companyId, caseId: input.caseId, authorUserId: operatorId,
          kind, body: input.body, customerStatus: nextStatus, safeContext: null, requestKey: input.requestKey, requestHash,
          deliveryState: "not_required", deliveryAttemptId: null, deliveryProviderKey: null, deliveryStartedAt: null,
          deliveryLeaseUntil: null, deliveredAt: null, providerMessageRef: null }).returning();
        const requestedResponse = nextStatus === "WAITING_FOR_YOU"
          ? input.status === "WAITING_FOR_YOU" ? input.body : row.requestedResponse ?? input.body
          : null;
        const [updated] = await tx.update(supportCases).set({ customerStatus: nextStatus, requestedResponse, version: row.version + 1,
          lastMessageAt: timestamp, expiresAt: new Date(timestamp.getTime() + policy.retentionDays * 86400000),
          resolvedAt: nextStatus === "RESOLVED" ? row.resolvedAt ?? timestamp : nextStatus === "CLOSED" ? row.resolvedAt : null,
          closedAt: nextStatus === "CLOSED" ? row.closedAt ?? timestamp : row.closedAt, updatedAt: timestamp })
          .where(and(eq(supportCases.id, input.caseId), eq(supportCases.version, input.expectedVersion))).returning({ version: supportCases.version, status: supportCases.customerStatus });
        if (!updated) throw conflict("Support case changed; reload before responding", { code: "STALE_SUPPORT_CASE" });
        await logActivity(tx, { companyId: input.companyId, actorType: "user", actorId: operatorId, action: "support.case_operator_response", entityType: "support_case", entityId: input.caseId, details: { eventId, version: updated.version, status: nextStatus } }, publications);
        const result = { caseId: input.caseId, eventId, version: updated.version, status: updated.status! };
        await assertPinnedAuthenticationDeadline(tx, proof);
        return result;
      }
    });
      for (const publication of publications) publishActivity(publication);
      return result;
    } catch (error) {
      if (isAuthenticationStateBusy(error) || (error && typeof error === "object" && "code" in error && error.code === "40P01")) throw conflict("Support case is changing; try again", { code: "support_case_busy" });
      throw error;
    }
  } };
}
