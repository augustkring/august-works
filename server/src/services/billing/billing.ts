import type { NotifyCompany } from "../notifications/notifications.js";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  authUsers,
  billingAccounts,
  billingAccountCompanies,
  billingCatalogMappings,
  billingCheckoutIntents,
  billingSubscriptions,
  billingWebhookEvents,
  type Db,
} from "@paperclipai/db";
import { BILLING_PRODUCTS } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { open, seal, sha256 } from "../saas/crypto.js";
import {
  BillingProviderError,
  paddleEventSchema,
  type BillingProvider,
  type PaddleSubscription,
} from "./paddle-provider.js";

export type BillingConfig = {
  environment: "sandbox" | "production";
  payloadKey: string;
  payloadKeyId: string;
  previousKeys: Record<string, string>;
  graceDays: number;
};
export function billingService(
  db: Db,
  config: BillingConfig,
  provider: BillingProvider,
  notify?: NotifyCompany,
) {
  async function accountForCompany(companyId: string) {
    const [association] = await db
      .select()
      .from(billingAccountCompanies)
      .where(
        and(
          eq(billingAccountCompanies.companyId, companyId),
          eq(billingAccountCompanies.status, "active"),
        ),
      )
      .limit(1);
    if (!association) throw notFound("Billing account not found");
    const [account] = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.id, association.billingAccountId))
      .limit(1);
    if (!account) throw notFound("Billing account not found");
    return account;
  }
  async function normalize(subscription: PaddleSubscription, now = new Date()) {
    const [account] = await db
      .select()
      .from(billingAccounts)
      .where(
        and(
          eq(billingAccounts.provider, "paddle"),
          eq(billingAccounts.providerCustomerId, subscription.customer_id),
        ),
      )
      .limit(1);
    if (!account)
      throw new BillingProviderError("paddle_customer_unmapped", true);
    const mappings = await db
      .select()
      .from(billingCatalogMappings)
      .where(
        and(
          eq(billingCatalogMappings.provider, "paddle"),
          eq(billingCatalogMappings.environment, config.environment),
        ),
      );
    const productKeys: string[] = [];
    for (const item of subscription.items) {
      // Historical mappings remain authoritative for already sold prices.
      const mapping = mappings.find((m) => m.providerPriceId === item.price.id);
      if (!mapping || !(mapping.productKey in BILLING_PRODUCTS))
        throw new BillingProviderError("paddle_price_unmapped", false);
      for (let quantity = 0; quantity < item.quantity; quantity++)
        productKeys.push(mapping.productKey);
    }
    const sourceHash = sha256(JSON.stringify(subscription));
    return db.transaction(async (tx) => {
      // The account lock serializes first insertion as well as subsequent version updates.
      await tx
        .select({ id: billingAccounts.id })
        .from(billingAccounts)
        .where(eq(billingAccounts.id, account.id))
        .for("update");
      const [previous] = await tx
        .select()
        .from(billingSubscriptions)
        .where(
          and(
            eq(billingSubscriptions.provider, "paddle"),
            eq(billingSubscriptions.providerSubscriptionId, subscription.id),
          ),
        )
        .limit(1);
      const updatedAt = new Date(subscription.updated_at);
      if (previous && previous.billingAccountId !== account.id)
        throw new BillingProviderError(
          "paddle_subscription_account_conflict",
          false,
        );
      if (previous && previous.providerUpdatedAt > updatedAt)
        return "ignored_stale" as const;
      if (
        previous &&
        previous.providerUpdatedAt.getTime() === updatedAt.getTime()
      ) {
        if (previous.sourceHash === sourceHash) return "duplicate" as const;
        throw new BillingProviderError("paddle_same_version_conflict", true);
      }
      const pastDueSince =
        subscription.status === "past_due"
          ? previous?.status === "past_due"
            ? (previous.pastDueSince ?? now)
            : now
          : null;
      const values = {
        billingAccountId: account.id,
        provider: "paddle",
        providerSubscriptionId: subscription.id,
        status: subscription.status,
        productKeys,
        currentPeriodStart: subscription.current_billing_period
          ? new Date(subscription.current_billing_period.starts_at)
          : null,
        currentPeriodEnd: subscription.current_billing_period
          ? new Date(subscription.current_billing_period.ends_at)
          : null,
        trialEndsAt:
          subscription.status === "trialing" &&
          subscription.current_billing_period
            ? new Date(subscription.current_billing_period.ends_at)
            : null,
        cancelAtPeriodEnd: subscription.scheduled_change?.action === "cancel",
        scheduledChange: subscription.scheduled_change,
        pastDueSince,
        graceUntil: pastDueSince
          ? new Date(pastDueSince.getTime() + config.graceDays * 86400000)
          : ["active", "trialing"].includes(subscription.status) &&
              subscription.current_billing_period
            ? new Date(
                new Date(
                  subscription.current_billing_period.ends_at,
                ).getTime() +
                  config.graceDays * 86400000,
              )
            : null,
        providerUpdatedAt: updatedAt,
        sourceHash,
        version: (previous?.version ?? 0) + 1,
        updatedAt: now,
      };
      if (previous)
        await tx
          .update(billingSubscriptions)
          .set(values)
          .where(
            and(
              eq(billingSubscriptions.id, previous.id),
              eq(billingSubscriptions.version, previous.version),
            ),
          );
      else await tx.insert(billingSubscriptions).values(values);
      await tx
        .update(billingAccounts)
        .set({ version: sql`${billingAccounts.version}+1`, updatedAt: now })
        .where(eq(billingAccounts.id, account.id));
      if (
        notify &&
        (!previous ||
          previous.status !== subscription.status ||
          previous.cancelAtPeriodEnd !== values.cancelAtPeriodEnd)
      ) {
        const associations = await tx
          .select({ companyId: billingAccountCompanies.companyId })
          .from(billingAccountCompanies)
          .where(
            and(
              eq(billingAccountCompanies.billingAccountId, account.id),
              eq(billingAccountCompanies.status, "active"),
            ),
          );
        for (const association of associations)
          await notify(
            association.companyId,
            "billing",
            "Your subscription has an update",
            "company/settings/billing",
            subscription.id + ":" + sourceHash,
            tx,
          );
      }
      return "applied" as const;
    });
  }
  async function receive(raw: Buffer) {
    const event = paddleEventSchema.parse(JSON.parse(raw.toString("utf8")));
    const id = randomUUID();
    const payloadHash = sha256(raw);
    const [created] = await db
      .insert(billingWebhookEvents)
      .values({
        id,
        providerEventId: event.event_id,
        eventType: event.event_type,
        occurredAt: new Date(event.occurred_at),
        payloadHash,
        payloadKeyId: config.payloadKeyId,
        payloadCiphertext: seal(event, config.payloadKey, "paddle:" + id),
      })
      .onConflictDoNothing()
      .returning({ id: billingWebhookEvents.id });
    if (!created) {
      const [existing] = await db
        .select()
        .from(billingWebhookEvents)
        .where(
          and(
            eq(billingWebhookEvents.provider, "paddle"),
            eq(billingWebhookEvents.providerEventId, event.event_id),
          ),
        )
        .limit(1);
      if (existing?.payloadHash !== payloadHash)
        throw conflict("Provider event identifier collision");
    }
    return created?.id ?? null;
  }
  async function processOne(owner: string, now = new Date()) {
    await db
      .update(billingWebhookEvents)
      .set({
        status: "quarantined",
        payloadCiphertext: null,
        lastErrorCode: "processing_attempts_exhausted",
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(billingWebhookEvents.status, "processing"),
          lte(billingWebhookEvents.leaseUntil, now),
          sql`${billingWebhookEvents.attemptCount} >= 8`,
        ),
      );
    const row = await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(billingWebhookEvents)
        .where(
          and(
            or(
              inArray(billingWebhookEvents.status, ["received", "failed"]),
              and(
                eq(billingWebhookEvents.status, "processing"),
                lte(billingWebhookEvents.leaseUntil, now),
              ),
            ),
            lte(billingWebhookEvents.notBefore, now),
            lt(billingWebhookEvents.attemptCount, 8),
          ),
        )
        .orderBy(billingWebhookEvents.receivedAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!event) return null;
      await tx
        .update(billingWebhookEvents)
        .set({
          status: "processing",
          attemptCount: sql`${billingWebhookEvents.attemptCount}+1`,
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + 60000),
        })
        .where(eq(billingWebhookEvents.id, event.id));
      return event;
    });
    if (!row) return false;
    const own = and(
      eq(billingWebhookEvents.id, row.id),
      eq(billingWebhookEvents.leaseOwner, owner),
      eq(billingWebhookEvents.status, "processing"),
    );
    try {
      if (!row.payloadCiphertext)
        throw new BillingProviderError("paddle_payload_missing", false);
      const decryptKey =
        row.payloadKeyId === config.payloadKeyId
          ? config.payloadKey
          : config.previousKeys[row.payloadKeyId];
      if (!decryptKey)
        throw new BillingProviderError("paddle_payload_key_unavailable", true);
      const event = paddleEventSchema.parse(
        open(row.payloadCiphertext, decryptKey, "paddle:" + row.id),
      );
      let status = "ignored";
      if (
        event.event_type.startsWith("subscription.") &&
        typeof event.data.id === "string"
      ) {
        // Canonical fetch resolves reordered/partial provider payloads; it never occurs on an authorization path.
        const result = await normalize(
          await provider.getSubscription(event.data.id),
          now,
        );
        status = result === "ignored_stale" ? "ignored_stale" : "processed";
      } else if (
        event.event_type.startsWith("transaction.") &&
        typeof event.data.id === "string"
      ) {
        const transaction = await provider.getTransaction(event.data.id);
        const [intent] = await db
          .select()
          .from(billingCheckoutIntents)
          .where(
            eq(billingCheckoutIntents.providerTransactionId, transaction.id),
          )
          .limit(1);
        if (intent && transaction.status === "completed") {
          const account = await accountForCompany(intent.companyId);
          if (transaction.customerId !== account.providerCustomerId)
            throw new BillingProviderError(
              "paddle_checkout_customer_conflict",
              false,
            );
          if (transaction.subscriptionId)
            await normalize(
              await provider.getSubscription(transaction.subscriptionId),
              now,
            );
          await db
            .update(billingCheckoutIntents)
            .set({ status: "completed", updatedAt: now })
            .where(eq(billingCheckoutIntents.id, intent.id));
          status = "processed";
        }
      }
      await db
        .update(billingWebhookEvents)
        .set({
          status,
          processedAt: now,
          payloadCiphertext: null,
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode: null,
        })
        .where(own);
    } catch (error) {
      const permanent =
        error instanceof BillingProviderError && !error.retryable;
      const code =
        error instanceof BillingProviderError
          ? error.code
          : "paddle_processing_unavailable";
      const exhausted = permanent || row.attemptCount + 1 >= 8;
      await db
        .update(billingWebhookEvents)
        .set({
          status: exhausted ? "quarantined" : "failed",
          lastErrorCode: code,
          leaseOwner: null,
          leaseUntil: null,
          notBefore: new Date(
            now.getTime() + Math.min(3600000, 30000 * 2 ** row.attemptCount),
          ),
          ...(exhausted ? { payloadCiphertext: null } : {}),
        })
        .where(own);
    }
    return true;
  }
  async function checkout(
    companyId: string,
    userId: string,
    input: { productKey: string; priceKey: string; idempotencyKey: string },
    now = new Date(),
  ) {
    const account = await accountForCompany(companyId);
    const payloadHash = sha256(
      JSON.stringify({
        companyId,
        productKey: input.productKey,
        priceKey: input.priceKey,
      }),
    );
    const intent = await db.transaction(async (tx) => {
      await tx
        .select({ id: billingAccounts.id })
        .from(billingAccounts)
        .where(eq(billingAccounts.id, account.id))
        .for("update");
      if (account.status !== "active")
        throw conflict("Billing account is unavailable");
      const [existing] = await tx
        .select()
        .from(billingCheckoutIntents)
        .where(
          and(
            eq(billingCheckoutIntents.billingAccountId, account.id),
            eq(billingCheckoutIntents.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw conflict("Idempotency key has a different request");
        return existing;
      }
      await tx
        .update(billingCheckoutIntents)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(billingCheckoutIntents.billingAccountId, account.id),
            eq(billingCheckoutIntents.status, "ready"),
            lte(billingCheckoutIntents.expiresAt, now),
          ),
        );
      const [pending] = await tx
        .select({ id: billingCheckoutIntents.id })
        .from(billingCheckoutIntents)
        .where(
          and(
            eq(billingCheckoutIntents.billingAccountId, account.id),
            inArray(billingCheckoutIntents.status, [
              "requested",
              "creating",
              "ready",
              "needs_reconciliation",
            ]),
          ),
        )
        .limit(1);
      if (pending)
        throw conflict("A checkout is already pending", {
          code: "CHECKOUT_PENDING",
        });
      const [mapping] = await tx
        .select()
        .from(billingCatalogMappings)
        .where(
          and(
            eq(billingCatalogMappings.environment, config.environment),
            eq(billingCatalogMappings.provider, "paddle"),
            eq(billingCatalogMappings.productKey, input.productKey),
            eq(billingCatalogMappings.priceKey, input.priceKey),
            eq(billingCatalogMappings.active, true),
            lte(billingCatalogMappings.effectiveFrom, now),
            or(
              isNull(billingCatalogMappings.effectiveUntil),
              gt(billingCatalogMappings.effectiveUntil, now),
            ),
          ),
        )
        .limit(1);
      if (!mapping || !(input.productKey in BILLING_PRODUCTS))
        throw unprocessable("Product is unavailable in this environment");
      const [created] = await tx
        .insert(billingCheckoutIntents)
        .values({
          companyId,
          billingAccountId: account.id,
          createdByUserId: userId,
          ...input,
          payloadHash,
          status: "requested",
          expiresAt: new Date(now.getTime() + 3600000),
        })
        .returning();
      return created!;
    });
    // The worker owns provider calls. Browser retries always return the same persisted intent.
    return {
      id: intent.id,
      status: intent.status,
      checkoutUrl:
        intent.status === "ready" && intent.expiresAt > now
          ? intent.checkoutUrl
          : null,
      expiresAt: intent.expiresAt,
    };
  }
  async function processCheckout(now = new Date()) {
    const [row] = await db
      .update(billingCheckoutIntents)
      .set({ status: "creating", updatedAt: now })
      .where(
        eq(
          billingCheckoutIntents.id,
          sql`(select id from billing_checkout_intents where status = 'requested' order by created_at for update skip locked limit 1)`,
        ),
      )
      .returning();
    if (!row) return false;
    try {
      if (row.expiresAt <= now) {
        await db
          .update(billingCheckoutIntents)
          .set({ status: "expired", updatedAt: now })
          .where(eq(billingCheckoutIntents.id, row.id));
        return true;
      }
      let account = await accountForCompany(row.companyId);
      if (account.status !== "active")
        throw new BillingProviderError("billing_account_inactive", false);
      const [payer] = await db
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, account.payerUserId))
        .limit(1);
      if (!payer || !payer.emailVerified)
        throw new BillingProviderError("billing_payer_unverified", false);
      if (!account.providerCustomerId) {
        const customerId =
          (await provider.findCustomer(payer.email, account.id)) ??
          (await provider.createCustomer({
            email: payer.email,
            name: account.displayName,
            accountId: account.id,
          }));
        await db
          .update(billingAccounts)
          .set({ providerCustomerId: customerId, updatedAt: now })
          .where(
            and(
              eq(billingAccounts.id, account.id),
              sql`${billingAccounts.providerCustomerId} is null`,
            ),
          );
        account = await accountForCompany(row.companyId);
      }
      if (!account.providerCustomerId)
        throw new BillingProviderError("paddle_customer_unresolved", true);
      const [mapping] = await db
        .select()
        .from(billingCatalogMappings)
        .where(
          and(
            eq(billingCatalogMappings.environment, config.environment),
            eq(billingCatalogMappings.priceKey, row.priceKey),
            eq(billingCatalogMappings.active, true),
            eq(billingCatalogMappings.productKey, row.productKey),
          ),
        )
        .limit(1);
      if (!mapping)
        throw new BillingProviderError("paddle_price_unmapped", false);
      const result = await provider.createCheckout({
        customerId: account.providerCustomerId,
        priceId: mapping.providerPriceId,
        intentId: row.id,
        accountId: account.id,
      });
      await db
        .update(billingCheckoutIntents)
        .set({
          status: "ready",
          providerTransactionId: result.transactionId,
          checkoutUrl: result.url,
          updatedAt: now,
        })
        .where(
          and(
            eq(billingCheckoutIntents.id, row.id),
            eq(billingCheckoutIntents.status, "creating"),
          ),
        );
    } catch (error) {
      // A timeout may have created a chargeable transaction. Never blindly create it again.
      await db
        .update(billingCheckoutIntents)
        .set({
          status: "needs_reconciliation",
          lastErrorCode:
            error instanceof BillingProviderError
              ? error.code
              : "paddle_checkout_unknown",
          updatedAt: now,
        })
        .where(
          and(
            eq(billingCheckoutIntents.id, row.id),
            eq(billingCheckoutIntents.status, "creating"),
          ),
        );
    }
    return true;
  }
  async function reconcileCheckouts(now = new Date()) {
    await db
      .update(billingCheckoutIntents)
      .set({
        status: "needs_reconciliation",
        lastErrorCode: "checkout_worker_interrupted",
      })
      .where(
        and(
          eq(billingCheckoutIntents.status, "creating"),
          lt(
            billingCheckoutIntents.updatedAt,
            new Date(now.getTime() - 120000),
          ),
        ),
      );
    const rows = await db
      .select()
      .from(billingCheckoutIntents)
      .where(eq(billingCheckoutIntents.status, "needs_reconciliation"))
      .limit(50);
    for (const row of rows) {
      let account = await accountForCompany(row.companyId);
      if (!account.providerCustomerId) {
        const [payer] = await db
          .select()
          .from(authUsers)
          .where(eq(authUsers.id, account.payerUserId))
          .limit(1);
        const customerId = payer
          ? await provider.findCustomer(payer.email, account.id)
          : null;
        if (!customerId) continue;
        await db
          .update(billingAccounts)
          .set({ providerCustomerId: customerId, updatedAt: now })
          .where(
            and(
              eq(billingAccounts.id, account.id),
              isNull(billingAccounts.providerCustomerId),
            ),
          );
        account = await accountForCompany(row.companyId);
      }
      if (!account.providerCustomerId) continue;
      const result = await provider.findCheckout(
        account.providerCustomerId,
        row.id,
      );
      if (result)
        await db
          .update(billingCheckoutIntents)
          .set({
            status: "ready",
            providerTransactionId: result.transactionId,
            checkoutUrl: result.url,
            lastErrorCode: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(billingCheckoutIntents.id, row.id),
              eq(billingCheckoutIntents.status, "needs_reconciliation"),
            ),
          );
      // Absence is not proof that a timed-out provider write never happened. Operator reconciliation is required.
    }
  }
  async function reconcileSubscriptions() {
    const accounts = await db
      .select()
      .from(billingAccounts)
      .where(
        and(
          eq(billingAccounts.provider, "paddle"),
          eq(billingAccounts.status, "active"),
          sql`${billingAccounts.providerCustomerId} is not null`,
        ),
      );
    for (const account of accounts)
      for (const subscription of await provider.listSubscriptions(
        account.providerCustomerId!,
      ))
        await normalize(subscription);
  }
  async function portal(companyId: string) {
    const account = await accountForCompany(companyId);
    if (!account.providerCustomerId)
      throw conflict("No provider billing account exists yet");
    return provider.portal(account.providerCustomerId);
  }
  async function catalog(now = new Date()) {
    return db
      .select({
        productKey: billingCatalogMappings.productKey,
        priceKey: billingCatalogMappings.priceKey,
      })
      .from(billingCatalogMappings)
      .where(
        and(
          eq(billingCatalogMappings.provider, "paddle"),
          eq(billingCatalogMappings.environment, config.environment),
          eq(billingCatalogMappings.active, true),
          lte(billingCatalogMappings.effectiveFrom, now),
          or(
            isNull(billingCatalogMappings.effectiveUntil),
            gt(billingCatalogMappings.effectiveUntil, now),
          ),
        ),
      );
  }
  async function checkoutStatus(companyId: string, intentId: string) {
    const [row] = await db
      .select()
      .from(billingCheckoutIntents)
      .where(
        and(
          eq(billingCheckoutIntents.companyId, companyId),
          eq(billingCheckoutIntents.id, intentId),
        ),
      )
      .limit(1);
    if (!row) throw notFound();
    return {
      id: row.id,
      status: row.status,
      checkoutUrl:
        row.status === "ready" && row.expiresAt > new Date()
          ? row.checkoutUrl
          : null,
      expiresAt: row.expiresAt,
    };
  }
  async function offboardCompany(companyId: string) {
    const account = await accountForCompany(companyId);
    const peers = await db
      .select({ companyId: billingAccountCompanies.companyId })
      .from(billingAccountCompanies)
      .where(
        and(
          eq(billingAccountCompanies.billingAccountId, account.id),
          eq(billingAccountCompanies.status, "active"),
        ),
      );
    if (peers.some((peer) => peer.companyId !== companyId))
      return { sharedAccountRetained: true, cancellations: [] as string[] };
    const subscriptions = await db
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.billingAccountId, account.id));
    const canceled: string[] = [];
    for (const subscription of subscriptions) {
      if (["canceled", "paused"].includes(subscription.status)) continue;
      let current = await provider.getSubscription(
        subscription.providerSubscriptionId,
      );
      if (current.customer_id !== account.providerCustomerId)
        throw conflict("Billing provider ownership changed");
      if (
        current.status !== "canceled" &&
        current.scheduled_change?.action !== "cancel"
      ) {
        await provider.cancelSubscription(current.id);
        current = await provider.getSubscription(current.id);
        if (
          current.customer_id !== account.providerCustomerId ||
          (current.status !== "canceled" &&
            current.scheduled_change?.action !== "cancel")
        )
          throw conflict("Cancellation outcome requires reconciliation");
      }
      await normalize(current);
      canceled.push(current.id);
    }
    await db
      .update(billingAccounts)
      .set({
        status: "closed",
        version: sql`${billingAccounts.version}+1`,
        updatedAt: new Date(),
      })
      .where(eq(billingAccounts.id, account.id));
    return { sharedAccountRetained: false, cancellations: canceled };
  }
  return {
    accountForCompany,
    normalize,
    receive,
    processOne,
    checkout,
    checkoutStatus,
    catalog,
    processCheckout,
    reconcileCheckouts,
    reconcileSubscriptions,
    portal,
    offboardCompany,
  };
}
