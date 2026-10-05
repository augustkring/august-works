import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  bigint,
  index,
  uniqueIndex,
  check,
  foreignKey,
  customType,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

const stamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
// postgres.js has already decoded JSONB. Drizzle's standard JSONB mapper parses returned
// strings a second time, turning decimal-string overrides into imprecise JS numbers.
const entitlementScalar = customType<{
  data: boolean | string;
  driverData: boolean | string;
}>({
  dataType: () => "jsonb",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => value,
});
export const billingAccounts = pgTable(
  "billing_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    provider: text("provider").notNull().default("paddle"),
    providerCustomerId: text("provider_customer_id"),
    payerUserId: text("payer_user_id").notNull(),
    currency: text("currency").notNull().default("EUR"),
    countryCode: text("country_code"),
    version: integer("version").notNull().default(1),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("billing_accounts_provider_customer_uq")
      .on(t.provider, t.providerCustomerId)
      .where(sql`${t.providerCustomerId} is not null`),
    index("billing_accounts_payer_idx").on(t.payerUserId),
    check(
      "billing_accounts_status_ck",
      sql`${t.status} in ('active','suspended','closing','closed')`,
    ),
    check("billing_accounts_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "billing_accounts_provider_ck",
      sql`${t.provider} in ('paddle','manual_contract')`,
    ),
  ],
);
export const billingAccountCompanies = pgTable(
  "billing_account_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    status: text("status").notNull().default("active"),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("billing_account_companies_active_uq")
      .on(t.companyId)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex("billing_account_companies_pair_uq").on(
      t.companyId,
      t.billingAccountId,
    ),
    check(
      "billing_account_companies_status_ck",
      sql`${t.status} in ('active','inactive')`,
    ),
  ],
);
export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    provider: text("provider").notNull().default("paddle"),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    status: text("status").notNull(),
    productKeys: jsonb("product_keys").$type<string[]>().notNull().default([]),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    scheduledChange: jsonb("scheduled_change").$type<Record<string, unknown>>(),
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    graceUntil: timestamp("grace_until", { withTimezone: true }),
    providerUpdatedAt: timestamp("provider_updated_at", {
      withTimezone: true,
    }).notNull(),
    sourceHash: text("source_hash").notNull(),
    version: integer("version").notNull().default(1),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("billing_subscriptions_provider_uq").on(
      t.provider,
      t.providerSubscriptionId,
    ),
    index("billing_subscriptions_account_idx").on(t.billingAccountId, t.status),
    check(
      "billing_subscriptions_status_ck",
      sql`${t.status} in ('trialing','active','past_due','paused','canceled')`,
    ),
  ],
);
export const billingWebhookEvents = pgTable(
  "billing_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("paddle"),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    payloadCiphertext: text("payload_ciphertext"),
    payloadKeyId: text("payload_key_id").notNull().default("initial"),
    status: text("status").notNull().default("received"),
    attemptCount: integer("attempt_count").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("billing_webhook_events_provider_uq").on(
      t.provider,
      t.providerEventId,
    ),
    index("billing_webhook_events_work_idx").on(t.status, t.notBefore),
    check(
      "billing_webhook_events_status_ck",
      sql`${t.status} in ('received','processing','processed','failed','ignored','ignored_stale','quarantined')`,
    ),
  ],
);
export const billingCatalogMappings = pgTable(
  "billing_catalog_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("paddle"),
    environment: text("environment").notNull(),
    productKey: text("product_key").notNull(),
    priceKey: text("price_key").notNull(),
    providerProductId: text("provider_product_id").notNull(),
    providerPriceId: text("provider_price_id").notNull(),
    active: boolean("active").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("billing_catalog_mappings_active_uq")
      .on(t.provider, t.environment, t.priceKey)
      .where(sql`${t.active} = true`),
    uniqueIndex("billing_catalog_mappings_price_uq").on(
      t.provider,
      t.environment,
      t.providerPriceId,
    ),
    check(
      "billing_catalog_mappings_environment_ck",
      sql`${t.environment} in ('sandbox','production')`,
    ),
  ],
);
export const billingCheckoutIntents = pgTable(
  "billing_checkout_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    createdByUserId: text("created_by_user_id").notNull(),
    productKey: text("product_key").notNull(),
    priceKey: text("price_key").notNull(),
    status: text("status").notNull().default("requested"),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    checkoutUrl: text("checkout_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastErrorCode: text("last_error_code"),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("billing_checkout_intents_key_uq").on(
      t.billingAccountId,
      t.idempotencyKey,
    ),
    uniqueIndex("billing_checkout_intents_pending_uq")
      .on(t.billingAccountId)
      .where(
        sql`${t.status} in ('requested','creating','ready','needs_reconciliation')`,
      ),
    foreignKey({
      columns: [t.companyId, t.billingAccountId],
      foreignColumns: [
        billingAccountCompanies.companyId,
        billingAccountCompanies.billingAccountId,
      ],
    }),
    check(
      "billing_checkout_intents_status_ck",
      sql`${t.status} in ('requested','creating','ready','completed','expired','failed','needs_reconciliation')`,
    ),
  ],
);
export const billingEntitlementOverrides = pgTable(
  "billing_entitlement_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    billingAccountId: uuid("billing_account_id").references(
      () => billingAccounts.id,
    ),
    entitlementKey: text("entitlement_key").notNull(),
    value: entitlementScalar("value").notNull(),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "billing_entitlement_overrides_scope_ck",
      sql`(${t.companyId} is null) <> (${t.billingAccountId} is null)`,
    ),
    check(
      "billing_entitlement_overrides_expiry_ck",
      sql`${t.expiresAt} > ${t.startsAt}`,
    ),
    check("billing_entitlement_overrides_value_ck",sql`jsonb_typeof(${t.value})='boolean' or (jsonb_typeof(${t.value})='string' and (${t.value} #>> '{}') ~ '^[0-9]{1,40}$')`),
  ],
);
export const entitlementSnapshots = pgTable(
  "entitlement_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    catalogVersion: text("catalog_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    entitlements: jsonb("entitlements")
      .$type<Record<string, boolean | string>>()
      .notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("entitlement_snapshots_company_uq").on(t.companyId)],
);
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    meterKey: text("meter_key").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    quantity: numeric("quantity", { precision: 40, scale: 0 }).notNull(),
    unit: text("unit").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    sourceEventId: text("source_event_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("usage_events_source_uq").on(
      t.companyId,
      t.meterKey,
      t.resourceType,
      t.resourceId,
      t.sourceEventId,
    ),
    index("usage_events_period_idx").on(
      t.billingAccountId,
      t.companyId,
      t.periodStart,
    ),
    check(
      "usage_events_quantity_ck",
      sql`${t.quantity} >= 0 and ${t.periodEnd} >= ${t.periodStart}`,
    ),
    check(
      "usage_events_meter_ck",
      sql`${t.meterKey} in ('runtime.shared_millisecond','runtime.dedicated_gateway_millisecond','runtime.dedicated_vm_millisecond','storage.byte_millisecond','backup.byte_millisecond')`,
    ),
    foreignKey({
      columns: [t.companyId, t.billingAccountId],
      foreignColumns: [
        billingAccountCompanies.companyId,
        billingAccountCompanies.billingAccountId,
      ],
    }),
  ],
);
export const usageAggregates = pgTable(
  "usage_aggregates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    meterKey: text("meter_key").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    bucketEnd: timestamp("bucket_end", { withTimezone: true }).notNull(),
    quantity: numeric("quantity", { precision: 40, scale: 0 }).notNull(),
    unit: text("unit").notNull(),
    sourceWatermark: timestamp("source_watermark", {
      withTimezone: true,
    }).notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("usage_aggregates_bucket_uq").on(
      t.companyId,
      t.meterKey,
      t.bucketStart,
      t.bucketEnd,
    ),
    check("usage_aggregates_quantity_ck", sql`${t.quantity} >= 0`),
  ],
);

/** Application uploads only. Safety backups, run logs and host-state volumes are separate domains. */
export const applicationStorageObjects = pgTable(
  "application_storage_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    objectKey: text("object_key").notNull(),
    byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
    status: text("status").notNull().default("reserved"),
    storedAt: timestamp("stored_at", { withTimezone: true }),
    meteredThrough: timestamp("metered_through", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("application_storage_objects_key_uq").on(
      t.companyId,
      t.objectKey,
    ),
    index("application_storage_objects_account_idx").on(
      t.billingAccountId,
      t.status,
    ),
    index("application_storage_objects_observation_idx").on(t.lastObservedAt),
    foreignKey({
      columns: [t.companyId, t.billingAccountId],
      foreignColumns: [
        billingAccountCompanies.companyId,
        billingAccountCompanies.billingAccountId,
      ],
    }),
    check(
      "application_storage_objects_scope_ck",
      sql`left(${t.objectKey},37) = ${t.companyId}::text || '/'`,
    ),
    check("application_storage_objects_size_ck", sql`${t.byteSize} > 0`),
    check(
      "application_storage_objects_status_ck",
      sql`${t.status} in ('reserved','present','deleting','deleted')`,
    ),
  ],
);
