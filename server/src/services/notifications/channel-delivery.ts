import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { companies, notificationChannelDeliveries, notificationChannelPreferences,
  saasNotifications, saasNotificationPreferences, type Db } from "@paperclipai/db";
import { PRODUCT_IDENTITY, notificationChannelCategorySchema, notificationPolicySchema, v9FeatureEnabled, type PublicOriginConfig } from "@paperclipai/shared";
import { publicAppUrl } from "../../aw-deployment.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockNotificationPreference } from "./notifications.js";
import { notificationChannelPolicy } from "./channel-policy.js";
import { routeNotification } from "./interruption-policy.js";

const DAY = 86_400_000;
export interface NativeNotificationChannelPlan {
  notificationId: string;
  companyId: string;
  userId: string;
  preferenceId: string;
  preferenceVersion: number;
  targetHash: string;
  endpointId: string;
  principalId: string;
  threadId: string;
  text: string;
  providerActionId: string;
  groupKey: string | null;
  notBefore: Date;
  expiresAt: Date;
}
export type NotificationEffectAdmission =
  | { kind: "admit"; userId: string }
  | { kind: "defer"; notBefore: Date; userId: string }
  | { kind: "deny" };
export interface NotificationEffectSource {
  id: string;
  notificationId: string | null;
  companyId: string;
  endpointId: string;
  principalId: string | null;
  providerActionId: string;
  payload: Record<string, unknown>;
}
export interface NativeNotificationChannelGateway {
  pending(limit?: number): Promise<string[]>;
  stage(tx: Db, notificationId: string, now: Date): Promise<NativeNotificationChannelPlan | null>;
  record(tx: Db, plan: NativeNotificationChannelPlan, actionId: string): Promise<void>;
  admit(tx: Db, action: NotificationEffectSource, now: Date): Promise<NotificationEffectAdmission>;
}

/** A source adapter between the Original account-notification owner and the
 * existing Native provider-effect queue. No Task or replacement outbox exists. */
export function notificationChannelDelivery(db: Db, origins: PublicOriginConfig): NativeNotificationChannelGateway {
  const policy = notificationChannelPolicy(db);
  async function active(reader: Db) {
    return v9FeatureEnabled(await instanceSettingsService(reader).getExperimental(), "notification_channels_v9");
  }
  async function suppress(tx: Db, notice: typeof saasNotifications.$inferSelect, preferenceId: string) {
    await tx.insert(notificationChannelDeliveries).values({ notificationId: notice.id, companyId: notice.companyId,
      userId: notice.userId, preferenceId, disposition: "suppressed" }).onConflictDoNothing();
  }
  async function resolve(tx: Db, id: string, now: Date, savedGroup?: string | null,
    savedExpires?: Date): Promise<{ notice: typeof saasNotifications.$inferSelect; plan: NativeNotificationChannelPlan | null; preferenceId: string } | null> {
    const [notice] = await tx.select().from(saasNotifications).where(eq(saasNotifications.id, id)).limit(1);
    if (!notice) return null;
    const category = notificationChannelCategorySchema.safeParse(notice.category);
    if (!category.success) return null; // Mandatory security stays with its owner.
    await lockNotificationPreference(tx, notice.userId, notice.category);
    const binding = await policy.preference(tx, notice.companyId, notice.userId, category.data);
    if (!binding || binding.channel === "default") return null;
    const refused = { notice, preferenceId: binding.id, plan: null };
    if (!await active(tx) || notice.readAt || notice.createdAt < binding.updatedAt) return refused;
    try { await policy.member(tx, notice.companyId, notice.userId, category.data, true); }
    catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 403) return refused;
      throw error; // An unresolved read is not proof that the recipient is gone.
    }
    const destination = await policy.currentTarget(tx, notice.companyId, notice.userId, binding);
    if (!destination || !destination.conversation.externalThreadId) return refused;
    const [preference] = await tx.select().from(saasNotificationPreferences).where(and(
      eq(saasNotificationPreferences.userId, notice.userId), eq(saasNotificationPreferences.category, category.data))).limit(1);
    const parsed = preference?.deliveryPolicy ? notificationPolicySchema.safeParse(preference.deliveryPolicy) : null;
    if (parsed && !parsed.success) return refused;
    // The Original staged digest owns its day/key. A later quiet-hour change
    // can postpone it; it does not create another digest or another effect.
    const schedule = routeNotification({ category: category.data, emailEnabled: true,
      policy: parsed?.success ? savedGroup !== undefined && parsed.data.cadence === "digest" ? { ...parsed.data, cadence: "immediate" } : parsed.data : null, now });
    if (schedule.channel !== "email") return refused;
    const [company] = await tx.select({ issuePrefix: companies.issuePrefix }).from(companies)
      .where(eq(companies.id, notice.companyId)).limit(1);
    const allowed = company ? ["company/settings/billing", "company/settings/runtime", "company/settings/support",
      "company/settings/security", "approvals", "issues"].map(suffix => `/${company.issuePrefix}/${suffix}`) : [];
    if (!allowed.includes(notice.relativePath)) return refused;
    const groupKey = savedGroup !== undefined ? savedGroup : schedule.groupKey;
    const expiresAt = savedExpires ?? new Date(Math.min(schedule.notBefore.getTime() + DAY, notice.createdAt.getTime() + 3 * DAY));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt.getTime() > notice.createdAt.getTime() + 3 * DAY) return refused;
    const plan: NativeNotificationChannelPlan = {
      notificationId: notice.id, companyId: notice.companyId, userId: notice.userId,
      preferenceId: binding.id, preferenceVersion: binding.version, targetHash: destination.target.targetHash,
      endpointId: destination.link.endpointId, principalId: destination.link.principalId,
      threadId: destination.conversation.externalThreadId,
      text: `${binding.deliveryLocale === "da" ? `Der er en kontoopdatering i ${PRODUCT_IDENTITY.productName}. Log ind for at gennemgå den.` : `There is an account update in ${PRODUCT_IDENTITY.productName}. Sign in to review it.`}\n\n${publicAppUrl(origins, notice.relativePath)}`,
      providerActionId: `account-notification:${nativeSha256({ companyId: notice.companyId, userId: notice.userId,
        category: notice.category, preferenceId: binding.id, version: binding.version, source: groupKey ?? notice.id })}`,
      groupKey, notBefore: schedule.notBefore, expiresAt,
    };
    return { notice, preferenceId: binding.id, plan };
  }
  return {
    async pending(limit = 25) {
      if (!await active(db)) return [];
      return (await db.select({ id: saasNotifications.id }).from(saasNotifications)
        .innerJoin(notificationChannelPreferences, and(eq(notificationChannelPreferences.companyId, saasNotifications.companyId),
          eq(notificationChannelPreferences.userId, saasNotifications.userId), eq(notificationChannelPreferences.category, saasNotifications.category)))
        .leftJoin(notificationChannelDeliveries, eq(notificationChannelDeliveries.notificationId, saasNotifications.id))
        .where(and(isNull(notificationChannelDeliveries.notificationId), isNull(saasNotifications.readAt),
          inArray(notificationChannelPreferences.channel, ["slack", "microsoft-teams"]),
          gte(saasNotifications.createdAt, new Date(Date.now() - DAY)),
          sql`${saasNotifications.createdAt} >= ${notificationChannelPreferences.updatedAt}`))
        .orderBy(asc(saasNotifications.createdAt), asc(saasNotifications.id)).limit(Math.min(Math.max(1, limit), 100)))
        .map(row => row.id);
    },
    async stage(tx, id, now) {
      const [known] = await tx.select().from(notificationChannelDeliveries).where(eq(notificationChannelDeliveries.notificationId, id)).limit(1);
      if (known) return null;
      const result = await resolve(tx, id, now);
      if (!result) return null;
      if (!result.plan) { await suppress(tx, result.notice, result.preferenceId); return null; }
      return result.plan;
    },
    async record(tx, plan, actionId) {
      await tx.insert(notificationChannelDeliveries).values({ notificationId: plan.notificationId, companyId: plan.companyId,
        userId: plan.userId, preferenceId: plan.preferenceId, actionId, disposition: "staged" }).onConflictDoNothing();
    },
    async admit(tx, action, now) {
      if (!action.notificationId || !Number.isSafeInteger(action.payload.notificationPreferenceVersion) ||
        typeof action.payload.notificationTargetHash !== "string" || typeof action.payload.notificationExpiresAt !== "string" ||
        typeof action.payload.notificationNotBefore !== "string" ||
        !(action.payload.notificationGroupKey === null || typeof action.payload.notificationGroupKey === "string")) return { kind: "deny" };
      const result = await resolve(tx, action.notificationId, now, action.payload.notificationGroupKey as string | null,
        new Date(action.payload.notificationExpiresAt));
      const plan = result?.plan;
      if (!plan || plan.companyId !== action.companyId || plan.endpointId !== action.endpointId ||
        plan.principalId !== action.principalId || plan.preferenceVersion !== action.payload.notificationPreferenceVersion ||
        plan.targetHash !== action.payload.notificationTargetHash || plan.threadId !== action.payload.threadId ||
        plan.text !== action.payload.text || plan.providerActionId !== action.providerActionId || action.payload.settleDelivery !== false)
        return { kind: "deny" };
      const originalNotBefore = new Date(action.payload.notificationNotBefore);
      if (!Number.isFinite(originalNotBefore.getTime()) || originalNotBefore >= plan.expiresAt) return { kind: "deny" };
      const due = new Date(Math.max(originalNotBefore.getTime(), plan.notBefore.getTime()));
      if (due >= plan.expiresAt) return { kind: "deny" };
      return due > now ? { kind: "defer", notBefore: due, userId: plan.userId } : { kind: "admit", userId: plan.userId };
    },
  };
}
