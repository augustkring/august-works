import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import {
  billingAccounts,
  billingAccountCompanies,
  billingSubscriptions,
  billingEntitlementOverrides,
  entitlementSnapshots,
  type Db,
} from "@paperclipai/db";
import {
  BILLING_CATALOG_VERSION,
  commercialAccess,
  composeEntitlements,
  EMPTY_ENTITLEMENTS,
  FREE_CORE_ENTITLEMENTS,
  FREE_CORE_CATALOG_VERSION,
  v7FeatureEnabled,
  ENTITLEMENT_KEYS,
  type EntitlementKey,
  type EntitlementMap,
} from "@paperclipai/shared";
import { forbidden, notFound } from "../../errors.js";
import { sha256 } from "../saas/crypto.js";
import { instanceSettingsService } from "../instance-settings.js";

export function subscriptionAccess(
  subscription: Pick<
    typeof billingSubscriptions.$inferSelect,
    "status" | "graceUntil" | "currentPeriodEnd" | "cancelAtPeriodEnd"
  >,
  now: Date,
) {
  if (["active", "trialing"].includes(subscription.status)) {
    // An old active receipt is not evidence of an indefinitely renewed subscription.
    if (!subscription.currentPeriodEnd) return "read_only" as const;
    if (subscription.currentPeriodEnd > now) return "active" as const;
    if (subscription.cancelAtPeriodEnd) return "read_only" as const;
    return subscription.graceUntil && subscription.graceUntil > now
      ? ("grace" as const)
      : ("read_only" as const);
  }
  return commercialAccess(subscription.status, subscription.graceUntil, now);
}

/** Local normalized billing is the authority; neither redirect parameters nor provider availability grant access. */
export function entitlementService(db: Db) {
  async function resolve(companyId: string, now = new Date()) {
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
    if (!association) throw notFound("Company billing account not found");
    const [account] = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.id, association.billingAccountId))
      .limit(1);
    if (!account) throw notFound("Billing account not found");
    const subscriptions = await db
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.billingAccountId, account.id));
    const usable = subscriptions.filter(
      (s) => subscriptionAccess(s, now) !== "read_only",
    );
    const freeCore =
      v7FeatureEnabled(
        await instanceSettingsService(db).getExperimental(),
        "free_core_commercial_v7",
      ) && account.status === "active";
    const catalogVersion = freeCore
      ? FREE_CORE_CATALOG_VERSION
      : BILLING_CATALOG_VERSION;
    let access: "active" | "grace" | "read_only" = usable.some(
      (s) => subscriptionAccess(s, now) === "active",
    )
      ? "active"
      : usable.length
        ? "grace"
        : "read_only";
    let entitlements: EntitlementMap =
      account.status === "active"
        ? composeEntitlements(
            usable.flatMap((s) => s.productKeys),
            freeCore ? FREE_CORE_ENTITLEMENTS : EMPTY_ENTITLEMENTS,
          )
        : { ...EMPTY_ENTITLEMENTS };
    const overrides = await db
      .select()
      .from(billingEntitlementOverrides)
      .where(
        and(
          or(
            eq(billingEntitlementOverrides.companyId, companyId),
            eq(billingEntitlementOverrides.billingAccountId, account.id),
          ),
          isNull(billingEntitlementOverrides.revokedAt),
          lte(billingEntitlementOverrides.startsAt, now),
          gt(billingEntitlementOverrides.expiresAt, now),
        ),
      )
      .orderBy(
        billingEntitlementOverrides.createdAt,
        billingEntitlementOverrides.id,
      );
    if (account.status === "active") {
      // Account defaults precede company-specific exceptions; latest record wins within each scope.
      for (const scope of ["account", "company"] as const)
        for (const override of overrides) {
          if ((scope === "company") !== Boolean(override.companyId)) continue;
          const key = override.entitlementKey as EntitlementKey;
          if (!ENTITLEMENT_KEYS.includes(key)) continue;
          const expectedBoolean = typeof EMPTY_ENTITLEMENTS[key] === "boolean";
          if (
            expectedBoolean
              ? typeof override.value !== "boolean"
              : typeof override.value !== "string" ||
                !/^\d+$/.test(override.value)
          )
            continue;
          entitlements[key] = override.value;
        }
      if (entitlements["platform.access"] === true && access === "read_only")
        access = "active";
    } else access = "read_only";
    // Existing work may continue during grace, but new infrastructure cannot be purchased/provisioned.
    if (access !== "active")
      entitlements = { ...entitlements, "hosted_runtime.provision": false };
    const boundaries = [
      ...usable
        .flatMap((s) => [s.graceUntil, s.currentPeriodEnd])
        .filter((d): d is Date => Boolean(d && d > now)),
      ...overrides.map((o) => o.expiresAt),
    ];
    const validUntil = new Date(
      Math.min(now.getTime() + 60000, ...boundaries.map((d) => d.getTime())),
    );
    const sourceHash = sha256(
      JSON.stringify({
        catalog: catalogVersion,
        freeCore,
        accountVersion: account.version,
        status: account.status,
        subscriptions: subscriptions.map((s) => [
          s.id,
          s.version,
          s.sourceHash,
        ]),
        overrides: overrides.map((o) => o.id),
        access,
        entitlements,
      }),
    );
    await db
      .insert(entitlementSnapshots)
      .values({
        companyId,
        billingAccountId: account.id,
        catalogVersion,
        sourceHash,
        entitlements,
        computedAt: now,
        validUntil,
      })
      .onConflictDoUpdate({
        target: entitlementSnapshots.companyId,
        set: {
          catalogVersion,
          sourceHash,
          entitlements,
          computedAt: now,
          validUntil,
        },
      });
    return {
      billingAccountId: account.id,
      access,
      entitlements,
      catalogVersion,
      commercialState:
        account.status !== "active"
          ? ("READ_ONLY" as const)
          : freeCore && usable.length === 0
            ? ("FREE" as const)
            : usable.some((s) => s.status === "active")
              ? ("ACTIVE" as const)
              : usable.some((s) => s.status === "trialing")
                ? ("TRIALING" as const)
                : usable.some((s) => s.status === "past_due")
                  ? ("PAST_DUE" as const)
                  : ("READ_ONLY" as const),
      freeCore: {
        active: freeCore,
        catalogVersion: FREE_CORE_CATALOG_VERSION,
        paymentMethodRequired: false as const,
      },
      validUntil,
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        status: s.status,
        productKeys: s.productKeys,
        currentPeriodEnd: s.currentPeriodEnd,
        graceUntil: s.graceUntil,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      })),
    };
  }
  async function require(companyId: string, key: EntitlementKey) {
    const state = await resolve(companyId);
    if (state.entitlements[key] !== true)
      throw forbidden("Commercial entitlement required", {
        code: "ENTITLEMENT_REQUIRED",
        entitlement: key,
        access: state.access,
      });
    return state;
  }
  return { resolve, require };
}
