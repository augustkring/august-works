import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  activityLog, authUsers, companies, companyMemberships, chatConversations,
  chatDeliveries, chatEndpoints, chatExternalPrincipals, chatIdentityLinks,
  notificationChannelPreferences, notificationChannelPreferenceCommands,
  toolConnections, type Db,
} from "@paperclipai/db";
import {
  notificationChannelCategorySchema, notificationChannelUpdateSchema,
  notificationChannelPreferenceViewSchema, notificationChannelPreferenceReceiptSchema,
  v9FeatureEnabled, type NotificationChannelCategory, type NotificationChannelTarget,
  type NotificationChannelPreferenceView,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockNotificationPreference, notificationPreferenceBaseline } from "./notifications.js";

type Preference = typeof notificationChannelPreferences.$inferSelect;
const key = (target: { identityLinkId: string; conversationId: string }) => `${target.identityLinkId}:${target.conversationId}`;

/** Child preferences and command receipts remain under the Original notification
 * owner. Neither a target reference nor this service authorizes provider I/O. */
export function notificationChannelPolicy(db: Db) {
  async function member(reader: Db, companyId: string, userId: string, category: NotificationChannelCategory, delivery = false) {
    const [row] = await reader.select({ role: companyMemberships.membershipRole })
      .from(companyMemberships)
      .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
      .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"),
        eq(authUsers.emailVerified, true), sql`${companies.status} <> 'archived'`)).limit(1);
    if (!row || delivery && ["billing", "runtime"].includes(category) && !["owner", "admin"].includes(row.role ?? ""))
      throw forbidden("Current notification recipient access is required");
  }
  async function enabled(reader: Db) {
    return v9FeatureEnabled(await instanceSettingsService(reader).getExperimental(), "notification_channels_v9");
  }
  async function preference(reader: Db, companyId: string, userId: string, category: NotificationChannelCategory) {
    const [row] = await reader.select().from(notificationChannelPreferences).where(and(
      eq(notificationChannelPreferences.companyId, companyId), eq(notificationChannelPreferences.userId, userId),
      eq(notificationChannelPreferences.category, category))).limit(1);
    return row ?? null;
  }
  async function baseline(reader: Db, companyId: string, userId: string, category: NotificationChannelCategory, row: Preference | null) {
    return nativeSha256({ companyId, userId, category, version: row?.version ?? 0,
      channel: row?.channel ?? "default", deliveryLocale: row?.deliveryLocale ?? "en", identityLinkId: row?.identityLinkId ?? null,
      conversationId: row?.conversationId ?? null, targetHash: row?.targetHash ?? null,
      globalPolicy: await notificationPreferenceBaseline(reader, userId, category) });
  }
  async function targets(reader: Db, companyId: string, userId: string,
    pair?: { identityLinkId: string; conversationId: string }) {
    // A processed Native DM delivery proves the destination/person relationship.
    // Do not infer it from OAuth, an arbitrary provider ID or a group membership.
    const rows = await reader.selectDistinctOn([chatIdentityLinks.id, chatConversations.id], {
      link: { id: chatIdentityLinks.id, endpointId: chatIdentityLinks.endpointId,
        principalId: chatIdentityLinks.principalId, status: chatIdentityLinks.status,
        confirmedAt: chatIdentityLinks.confirmedAt, revokedAt: chatIdentityLinks.revokedAt },
      principal: { id: chatExternalPrincipals.id, provider: chatExternalPrincipals.provider,
        providerAccountId: chatExternalPrincipals.providerAccountId, externalId: chatExternalPrincipals.externalId,
        displayName: chatExternalPrincipals.displayName },
      endpoint: { id: chatEndpoints.id, provider: chatEndpoints.provider, providerAccountId: chatEndpoints.providerAccountId,
        providerAccountLabel: chatEndpoints.providerAccountLabel, botExternalId: chatEndpoints.botExternalId,
        status: chatEndpoints.status, allowDirectMessages: chatEndpoints.allowDirectMessages,
        runtimeGeneration: sql<unknown>`${chatEndpoints.setup}->'runtimeGeneration'` },
      connection: { id: toolConnections.id, name: toolConnections.name, status: toolConnections.status,
        enabled: toolConnections.enabled, healthStatus: toolConnections.healthStatus,
        credentialSecretRefs: toolConnections.credentialSecretRefs },
      conversation: { id: chatConversations.id,
        isDirectMessage: chatConversations.isDirectMessage, externalConversationId: chatConversations.externalConversationId,
        externalThreadId: chatConversations.externalThreadId },
    }).from(chatIdentityLinks)
      .innerJoin(chatExternalPrincipals, and(eq(chatExternalPrincipals.companyId, chatIdentityLinks.companyId), eq(chatExternalPrincipals.id, chatIdentityLinks.principalId)))
      .innerJoin(chatEndpoints, and(eq(chatEndpoints.companyId, chatIdentityLinks.companyId), eq(chatEndpoints.id, chatIdentityLinks.endpointId)))
      .innerJoin(toolConnections, and(eq(toolConnections.companyId, chatEndpoints.companyId), eq(toolConnections.id, chatEndpoints.connectionId)))
      .innerJoin(chatDeliveries, and(eq(chatDeliveries.companyId, chatIdentityLinks.companyId), eq(chatDeliveries.endpointId, chatEndpoints.id), eq(chatDeliveries.principalId, chatIdentityLinks.principalId)))
      .innerJoin(chatConversations, and(eq(chatConversations.companyId, chatIdentityLinks.companyId), eq(chatConversations.endpointId, chatEndpoints.id), eq(chatConversations.id, chatDeliveries.conversationId)))
      .where(and(eq(chatIdentityLinks.companyId, companyId), eq(chatIdentityLinks.paperclipUserId, userId),
        eq(chatIdentityLinks.status, "linked"), isNull(chatIdentityLinks.revokedAt), isNotNull(chatIdentityLinks.confirmedAt),
        eq(chatExternalPrincipals.kind, "user"), eq(chatExternalPrincipals.isBot, false),
        eq(chatExternalPrincipals.provider, chatEndpoints.provider), eq(chatExternalPrincipals.providerAccountId, chatEndpoints.providerAccountId),
        inArray(chatEndpoints.provider, ["slack", "microsoft-teams"]), eq(chatEndpoints.status, "active"), eq(chatEndpoints.allowDirectMessages, true),
        eq(toolConnections.connectionPurpose, "channel"), eq(toolConnections.transport, "chat_sdk"), eq(toolConnections.enabled, true),
        eq(toolConnections.status, "active"), inArray(toolConnections.healthStatus, ["healthy", "ok"]),
        eq(chatDeliveries.state, "processed"), eq(chatConversations.isDirectMessage, true),
        sql`exists (select 1 from company_memberships m where m.company_id = ${companyId}::uuid and m.principal_type = 'user'
          and m.principal_id = ${userId} and m.status = 'active' and m.membership_role is distinct from 'viewer')`,
        ...(pair ? [eq(chatIdentityLinks.id, pair.identityLinkId), eq(chatConversations.id, pair.conversationId)] : [])))
      .orderBy(asc(chatIdentityLinks.id), asc(chatConversations.id), desc(chatDeliveries.receivedAt)).limit(pair ? 1 : 31);
    return rows.filter(row => {
      const generation = Number(row.endpoint.runtimeGeneration ?? 0);
      return Number.isSafeInteger(generation) && generation >= 0;
    }).map(row => ({ ...row, target: {
      identityLinkId: row.link.id, conversationId: row.conversation.id,
      provider: row.endpoint.provider as "slack" | "microsoft-teams",
      label: `${row.endpoint.provider === "slack" ? "Slack" : "Teams"} · ${row.endpoint.providerAccountLabel ?? row.connection.name} · ${row.principal.displayName ?? "Linked account"}`.slice(0, 400),
      targetHash: nativeSha256({ version: 1, companyId, userId, link: {
        id: row.link.id, endpointId: row.link.endpointId, principalId: row.link.principalId,
        status: row.link.status, confirmedAt: row.link.confirmedAt?.toISOString() ?? null, revokedAt: row.link.revokedAt?.toISOString() ?? null,
      }, principal: { id: row.principal.id, provider: row.principal.provider, account: row.principal.providerAccountId, externalId: row.principal.externalId },
      endpoint: { id: row.endpoint.id, provider: row.endpoint.provider, account: row.endpoint.providerAccountId,
        bot: row.endpoint.botExternalId, status: row.endpoint.status, allowDirectMessages: row.endpoint.allowDirectMessages,
        runtimeGeneration: Number(row.endpoint.runtimeGeneration ?? 0) },
      connection: { id: row.connection.id, status: row.connection.status, enabled: row.connection.enabled,
        health: row.connection.healthStatus, credentialRefs: row.connection.credentialSecretRefs },
      conversation: { id: row.conversation.id,
        isDirectMessage: row.conversation.isDirectMessage, externalConversationId: row.conversation.externalConversationId,
        externalThreadId: row.conversation.externalThreadId },
      }),
    } satisfies NotificationChannelTarget }));
  }
  async function currentTarget(reader: Db, companyId: string, userId: string, row: Preference | null) {
    if (!row || row.channel === "default" || !row.identityLinkId || !row.conversationId) return null;
    const [value] = await targets(reader, companyId, userId, { identityLinkId: row.identityLinkId, conversationId: row.conversationId });
    return value && value.target.provider === row.channel && value.target.targetHash === row.targetHash ? value : null;
  }
  async function view(companyId: string, userId: string, rawCategory: unknown): Promise<NotificationChannelPreferenceView> {
    const category = notificationChannelCategorySchema.parse(rawCategory);
    await member(db, companyId, userId, category);
    const row = await preference(db, companyId, userId, category), active = await enabled(db);
    const available = active ? await targets(db, companyId, userId) : [];
    const current = active ? await currentTarget(db, companyId, userId, row) : null;
    const choices = available.slice(0, 30).map(item => item.target);
    if (current && !choices.some(item => key(item) === key(current.target))) {
      if (choices.length === 30) choices.pop();
      choices.push(current.target);
    }
    // Recheck account/company after asynchronous private source reads.
    await member(db, companyId, userId, category);
    return notificationChannelPreferenceViewSchema.parse({ companyId, userId, category, version: row?.version ?? 0,
      channel: row?.channel ?? "default", deliveryLocale: row?.deliveryLocale ?? "en", availability: !row || row.channel === "default" ? "default" : current ? "available" : "unavailable",
      target: current?.target ?? null, baselineHash: await baseline(db, companyId, userId, category, row), targets: choices, targetsLimited: available.length > 30 });
  }
  async function update(companyId: string, userId: string, rawCategory: unknown, raw: unknown) {
    const category = notificationChannelCategorySchema.parse(rawCategory), input = notificationChannelUpdateSchema.parse(raw);
    const requestHash = nativeSha256({ companyId, userId, category, input });
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await lockNotificationPreference(tx, userId, category);
      await member(tx, companyId, userId, category);
      const [known] = await tx.select().from(notificationChannelPreferenceCommands).where(and(
        eq(notificationChannelPreferenceCommands.companyId, companyId), eq(notificationChannelPreferenceCommands.userId, userId),
        eq(notificationChannelPreferenceCommands.requestId, input.requestId))).limit(1);
      if (known) {
        if (known.requestHash !== requestHash || known.category !== category) throw conflict("The saved channel request has different content");
        if (known.expiresAt <= new Date()) throw conflict("The Original channel request receipt is no longer available");
        const value = notificationChannelPreferenceReceiptSchema.parse(known.receipt);
        if (value.companyId !== companyId || value.userId !== userId || value.category !== category || value.requestId !== input.requestId)
          throw conflict("The Original notification preference receipt is unavailable");
        return value;
      }
      if (input.choice.channel !== "default" && !await enabled(tx)) throw notFound("Notification channel changes are not enabled");
      const row = await preference(tx, companyId, userId, category);
      if ((row?.version ?? 0) !== input.expectedVersion || await baseline(tx, companyId, userId, category, row) !== input.expectedBaselineHash)
        throw conflict("Notification policy changed; review its current state");
      let target: Awaited<ReturnType<typeof targets>>[number] | undefined;
      if (input.choice.channel !== "default") {
        [target] = await targets(tx, companyId, userId, input.choice);
        if (!target || target.target.provider !== input.choice.channel || target.target.targetHash !== input.choice.expectedTargetHash)
          throw conflict("The linked notification destination changed; review it again");
      }
      const version = (row?.version ?? 0) + 1;
      const values = { companyId, userId, category, version, channel: input.choice.channel, deliveryLocale: input.deliveryLocale,
        identityLinkId: target?.link.id ?? null, conversationId: target?.conversation.id ?? null,
        targetHash: target?.target.targetHash ?? null, updatedAt: new Date() };
      const [saved] = row
        ? await tx.update(notificationChannelPreferences).set(values).where(and(eq(notificationChannelPreferences.id, row.id), eq(notificationChannelPreferences.version, row.version))).returning()
        : await tx.insert(notificationChannelPreferences).values(values).returning();
      if (!saved) throw conflict("Notification policy changed; review its current state");
      const receipt = notificationChannelPreferenceReceiptSchema.parse({ companyId, userId, category, requestId: input.requestId,
        version, channel: saved.channel, preferenceApplied: true, authorityGranted: false, messageSent: false, executionStarted: false });
      await tx.insert(notificationChannelPreferenceCommands).values({ companyId, userId, category, preferenceId: saved.id,
        requestId: input.requestId, requestHash, receipt });
      await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: userId,
        action: "notifications.channel_preference_updated", entityType: "user", entityId: userId,
        details: { category, channel: saved.channel, version, authorityGranted: false, messageSent: false } });
      return receipt;
    });
  }
  async function receipt(companyId: string, userId: string, rawCategory: unknown, requestId: string) {
    const category = notificationChannelCategorySchema.parse(rawCategory);
    await member(db, companyId, userId, category);
    const [row] = await db.select().from(notificationChannelPreferenceCommands).where(and(
      eq(notificationChannelPreferenceCommands.companyId, companyId), eq(notificationChannelPreferenceCommands.userId, userId),
      eq(notificationChannelPreferenceCommands.category, category), eq(notificationChannelPreferenceCommands.requestId, requestId))).limit(1);
    await member(db, companyId, userId, category);
    if (!row || row.expiresAt <= new Date()) return null;
    const value = notificationChannelPreferenceReceiptSchema.parse(row.receipt);
    if (value.companyId !== companyId || value.userId !== userId || value.category !== category || value.requestId !== requestId)
      throw conflict("The Original notification preference receipt is unavailable");
    return value;
  }
  return { view, update, receipt, targets, currentTarget, preference, member, baseline };
}
