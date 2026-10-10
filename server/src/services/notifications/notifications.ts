import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  authUsers,
  companies,
  companyMemberships,
  saasNotifications,
  saasNotificationPreferences,
  type Db,
} from "@paperclipai/db";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../../errors.js";
import type { transactionalEmail, EmailDb } from "./transactional-email.js";
import { notificationPreferenceUpdateSchema, notificationPolicySchema, v9FeatureEnabled } from "@paperclipai/shared";
import { routeNotification } from "./interruption-policy.js";
import { instanceSettingsService } from "../instance-settings.js";
export const NOTIFICATION_CATEGORIES = [
  "security",
  "billing",
  "runtime",
  "approval",
  "work_update",
] as const;
export type NotifyCompany = (
  companyId: string,
  category: (typeof NOTIFICATION_CATEGORIES)[number],
  title: string,
  pathSuffix: string,
  dedupeKey: string,
  writer: EmailDb,
) => Promise<void>;
export function notificationService(
  db: Db,
  email: ReturnType<typeof transactionalEmail>,
) {
  async function membership(
    companyId: string,
    userId: string,
    reader: Pick<Db, "select"> = db,
  ) {
    const [row] = await reader
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!row) throw forbidden("Active company membership required");
  }
  const notifyCompany: NotifyCompany = async (
    companyId,
    category,
    title,
    pathSuffix,
    dedupeKey,
    writer,
  ) => {
    if (
      !NOTIFICATION_CATEGORIES.includes(category) ||
      title.length > 240 ||
      !/^(?:company\/settings\/(?:billing|runtime|support|security)|approvals|issues)$/.test(
        pathSuffix,
      )
    )
      throw new Error("Invalid notification contract");
    const [company] = await writer
      .select({ issuePrefix: companies.issuePrefix, status: companies.status })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!company || company.status === "archived") return;
    const recipients = await writer
      .select({
        userId: authUsers.id,
        email: authUsers.email,
        emailVerified: authUsers.emailVerified,
      })
      .from(companyMemberships)
      .innerJoin(
        authUsers,
        and(
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, authUsers.id),
        ),
      )
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.status, "active"),
          ...(["approval", "work_update"].includes(category)
            ? []
            : [sql`${companyMemberships.membershipRole} in ('owner','admin')`]),
        ),
      );
    for (const recipient of recipients) {
      const key = companyId + ":" + category + ":" + dedupeKey,
        relativePath = "/" + company.issuePrefix + "/" + pathSuffix;
      const [created] = await writer
        .insert(saasNotifications)
        .values({
          companyId,
          userId: recipient.userId,
          category,
          title,
          relativePath,
          dedupeKey: key,
        })
        .onConflictDoNothing()
        .returning({ id: saasNotifications.id });
      if (!created) continue;
      const [preference] = await writer
        .select()
        .from(saasNotificationPreferences)
        .where(
          and(
            eq(saasNotificationPreferences.userId, recipient.userId),
            eq(saasNotificationPreferences.category, category),
          ),
        )
        .limit(1);
      const delivery=routeNotification({category,emailEnabled:preference?.emailEnabled!==false,policy:preference?.deliveryPolicy,now:new Date()});
      if (recipient.emailVerified && delivery.channel==="email")
        await email.enqueue(
          {
            companyId,
            userId: recipient.userId,
            purpose: category,
            recipient: recipient.email,
            subject: delivery.groupKey ? "Your August Works updates" : title,
            message:
              "There is an account update in August Works. Sign in to review it.",
            actionPath: relativePath,
            dedupeKey: delivery.groupKey ? `notification:${companyId}:${recipient.userId}:${category}:${delivery.groupKey}` : "notification:" + created.id,
            notBefore:delivery.notBefore,
            expiresAt: new Date(delivery.notBefore.getTime() + 86400000),
          },
          writer,
        );
    }
  };
  async function processWorkUpdate(now = new Date()) {
    return db.transaction(async (tx) => {
      // The native activity log is the durable event source. A separate receipt
      // commits with the notifications and encrypted outbox, including no-recipient events.
      const [event] = await tx
        .select()
        .from(activityLog)
        .where(
          and(
            inArray(activityLog.action, [
              "approval.created",
              "approval.resubmitted",
              "approval.approved",
              "approval.rejected",
              "approval.revision_requested",
              "issue.updated",
            ]),
            gte(activityLog.createdAt, new Date(now.getTime() - 7 * 86400000)),
            sql`not exists (select 1 from activity_log n where n.entity_type='saas_notification_event' and n.entity_id=${activityLog.id}::text)`,
          ),
        )
        .orderBy(activityLog.createdAt, activityLog.id)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!event) return false;
      const approval = event.action.startsWith("approval.");
      const terminalWork = ["done", "blocked"].includes(
        String(event.details?.status ?? ""),
      );
      if (approval || terminalWork)
        await notifyCompany(
          event.companyId,
          approval ? "approval" : "work_update",
          approval
            ? ["approval.created", "approval.resubmitted"].includes(
                event.action,
              )
              ? "An approval needs review"
              : "An approval has an update"
            : "A task has an update",
          approval ? "approvals" : "issues",
          "activity:" + event.id,
          tx,
        );
      await tx
        .insert(activityLog)
        .values({
          companyId: event.companyId,
          actorType: "system",
          actorId: "notification-scheduler",
          action: "notifications.native_event_processed",
          entityType: "saas_notification_event",
          entityId: event.id,
          details: {
            sourceAction: event.action,
            notified: approval || terminalWork,
          },
        });
      return true;
    });
  }
  async function list(companyId: string, userId: string) {
    await membership(companyId, userId);
    return db
      .select()
      .from(saasNotifications)
      .where(
        and(
          eq(saasNotifications.companyId, companyId),
          eq(saasNotifications.userId, userId),
        ),
      )
      .orderBy(desc(saasNotifications.createdAt))
      .limit(100);
  }
  async function listPage(
    companyId: string,
    userId: string,
    cursor: string | null = null,
    unread = false,
  ) {
    await membership(companyId, userId);
    let boundary: { createdAt: string; id: string } | null = null;
    if (cursor) {
      const schema = z
        .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
        .strict();
      try {
        boundary = schema.parse(
          JSON.parse(
            Buffer.from(
              z
                .string()
                .max(256)
                .regex(/^[A-Za-z0-9_-]+$/)
                .parse(cursor),
              "base64url",
            ).toString("utf8"),
          ),
        );
      } catch {
        throw badRequest("Invalid notification page cursor");
      }
    }
    const rows = await db
      .select()
      .from(saasNotifications)
      .where(
        and(
          eq(saasNotifications.companyId, companyId),
          eq(saasNotifications.userId, userId),
          unread ? isNull(saasNotifications.readAt) : undefined,
          boundary
            ? sql`(${saasNotifications.createdAt},${saasNotifications.id}) < (${boundary.createdAt}::timestamptz,${boundary.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(saasNotifications.createdAt), desc(saasNotifications.id))
      .limit(51);
    const items = rows.slice(0, 50),
      last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > 50 && last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.createdAt.toISOString(),
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  }
  async function markRead(companyId: string, userId: string, id: string) {
    return db.transaction(async (tx) => {
      await membership(companyId, userId, tx);
      const [row] = await tx
        .update(saasNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(saasNotifications.id, id),
            eq(saasNotifications.companyId, companyId),
            eq(saasNotifications.userId, userId),
          ),
        )
        .returning();
      if (!row) throw notFound();
      return row;
    });
  }
  async function preferences(userId: string) {
    const rows = await db
      .select()
      .from(saasNotificationPreferences)
      .where(eq(saasNotificationPreferences.userId, userId));
    return NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      emailEnabled:
        category === "security" ||
        rows.find((row) => row.category === category)?.emailEnabled !== false,
      ...(rows.find(row=>row.category===category)?.deliveryPolicy ? {policy:notificationPolicySchema.parse(rows.find(row=>row.category===category)!.deliveryPolicy)} : {}),
    }));
  }
  async function updatePreference(
    companyId: string,
    userId: string,
    raw: unknown,
  ) {
    const input = notificationPreferenceUpdateSchema.parse(raw);
    if (input.category === "security" && !input.emailEnabled)
      throw forbidden("Security notifications are required");
    if(input.category==="security"&&input.policy&&(input.policy.cadence!=="immediate"||input.policy.quietHours))throw forbidden("Account safety delivery cannot be delayed or disabled");
    return db.transaction(async (tx) => {
      await membership(companyId, userId, tx);
      if(input.policy&&!v9FeatureEnabled(await instanceSettingsService(tx as unknown as Db).getExperimental(),"notification_policy_v9"))throw notFound("Notification policy changes are not enabled");
      await tx
        .insert(saasNotificationPreferences)
        .values({ userId, category:input.category,emailEnabled:input.emailEnabled,...(input.policy ? {deliveryPolicy:input.policy} : {}) })
        .onConflictDoUpdate({
          target: [
            saasNotificationPreferences.userId,
            saasNotificationPreferences.category,
          ],
          set: { emailEnabled: input.emailEnabled,...(input.policy ? {deliveryPolicy:input.policy} : {}) },
        });
      await tx.insert(activityLog).values({
        companyId,
        actorType: "user",
        actorId: userId,
        action: "notifications.preference_updated",
        entityType: "user",
        entityId: userId,
        details: input,
      });
      return input;
    });
  }
  return {
    notifyCompany,
    processWorkUpdate,
    list,
    listPage,
    markRead,
    preferences,
    updatePreference,
  };
}
