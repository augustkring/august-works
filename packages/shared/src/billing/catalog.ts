export const BILLING_CATALOG_VERSION = "aw-v6-2026-10-04";
export const ENTITLEMENT_KEYS = [
  "platform.access",
  "agents.create",
  "workflows.use",
  "memory.use",
  "portfolio.use",
  "hosted_runtime.provision",
  "hosted_runtime.standard.max_cells",
  "hosted_runtime.performance.max_cells",
  "hosted_runtime.dedicated_gateway.max_cells",
  "hosted_runtime.dedicated_vm.max_cells",
  "storage.included_bytes",
] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];
export type EntitlementValue = boolean | string;
export type EntitlementMap = Record<EntitlementKey, EntitlementValue>;
export const EMPTY_ENTITLEMENTS: EntitlementMap = {
  "platform.access": false,
  "agents.create": false,
  "workflows.use": false,
  "memory.use": false,
  "portfolio.use": false,
  "hosted_runtime.provision": false,
  "hosted_runtime.standard.max_cells": "0",
  "hosted_runtime.performance.max_cells": "0",
  "hosted_runtime.dedicated_gateway.max_cells": "0",
  "hosted_runtime.dedicated_vm.max_cells": "0",
  "storage.included_bytes": "0",
};
// Provider IDs and monetary prices belong to environment-specific mappings, never this catalog.
export const BILLING_PRODUCTS = {
  platform: {
    label: "Platform",
    entitlements: {
      "platform.access": true,
      "agents.create": true,
      "workflows.use": true,
      "memory.use": true,
      "storage.included_bytes": "1073741824",
    },
  },
  portfolio: { label: "Portfolio", entitlements: { "portfolio.use": true } },
  runtime_standard: {
    label: "Managed runtime",
    entitlements: {
      "hosted_runtime.provision": true,
      "hosted_runtime.standard.max_cells": "1",
    },
  },
  runtime_performance: {
    label: "Performance runtime",
    entitlements: {
      "hosted_runtime.provision": true,
      "hosted_runtime.standard.max_cells": "1",
      "hosted_runtime.performance.max_cells": "1",
    },
  },
  runtime_dedicated_gateway: {
    label: "Dedicated agent Gateway",
    entitlements: {
      "hosted_runtime.provision": true,
      "hosted_runtime.dedicated_gateway.max_cells": "1",
    },
  },
  runtime_dedicated_vm: {
    label: "Dedicated VM",
    entitlements: {
      "hosted_runtime.provision": true,
      "hosted_runtime.dedicated_vm.max_cells": "1",
    },
  },
  storage: {
    label: "Additional storage",
    entitlements: { "storage.included_bytes": "10737418240" },
  },
} as const satisfies Record<
  string,
  { label: string; entitlements: Partial<EntitlementMap> }
>;
export type BillingProductKey = keyof typeof BILLING_PRODUCTS;
export type CommercialAccess = "active" | "grace" | "read_only";

export function composeEntitlements(
  productKeys: readonly string[],
): EntitlementMap {
  const result = { ...EMPTY_ENTITLEMENTS };
  for (const productKey of productKeys) {
    const product = BILLING_PRODUCTS[productKey as BillingProductKey];
    if (!product) continue;
    for (const [key, value] of Object.entries(product.entitlements)) {
      const k = key as EntitlementKey;
      if (typeof value === "boolean") result[k] = result[k] === true || value;
      else
        result[k] = (
          BigInt(typeof result[k] === "string" ? result[k] : "0") +
          BigInt(value)
        ).toString();
    }
  }
  return result;
}
export function commercialAccess(
  status: string,
  graceUntil: string | Date | null,
  now: Date,
): CommercialAccess {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" && graceUntil && new Date(graceUntil) > now)
    return "grace";
  return "read_only";
}
