import { createHmac } from "node:crypto";
import { z } from "zod";
import { equalDigest } from "../saas/crypto.js";

export const paddleEventSchema = z.object({
  event_id: z.string().min(1).max(150),
  event_type: z.string().min(1).max(100),
  occurred_at: z.iso.datetime(),
  data: z.record(z.string(), z.unknown()),
});
export const subscriptionSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  status: z.enum(["trialing", "active", "past_due", "paused", "canceled"]),
  updated_at: z.iso.datetime(),
  current_billing_period: z
    .object({ starts_at: z.iso.datetime(), ends_at: z.iso.datetime() })
    .nullable(),
  scheduled_change: z
    .object({ action: z.string(), effective_at: z.iso.datetime() })
    .nullable(),
  items: z
    .array(
      z.object({
        price: z.object({ id: z.string() }),
        quantity: z.number().int().min(1).max(1000),
      }),
    )
    .max(50),
});
export type PaddleSubscription = z.infer<typeof subscriptionSchema>;
export class BillingProviderError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
  ) {
    super(code);
  }
}
export function verifyPaddleSignature(
  secret: string,
  raw: Buffer,
  header: string | undefined,
  now = Date.now(),
): boolean {
  if (!header || raw.length > 1024 * 1024) return false;
  const parts = header.split(";").map((s) => s.trim().split("="));
  const timestamps = parts.filter(([k]) => k === "ts");
  if (timestamps.length !== 1) return false;
  const timestamp = timestamps[0]![1];
  if (
    !timestamp ||
    !/^[0-9]+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp + ":")
    .update(raw)
    .digest("hex");
  return parts.some(
    ([k, v]) => k === "h1" && typeof v === "string" && equalDigest(expected, v),
  );
}
export interface BillingProvider {
  getSubscription(id: string): Promise<PaddleSubscription>;
  createCustomer(input: {
    email: string;
    name: string;
    accountId: string;
  }): Promise<string>;
  createCheckout(input: {
    customerId: string;
    priceId: string;
    intentId: string;
    accountId: string;
  }): Promise<{ transactionId: string; url: string }>;
  getTransaction(
    id: string,
  ): Promise<{
    id: string;
    status: string;
    customerId: string;
    subscriptionId: string | null;
  }>;
  portal(customerId: string): Promise<string>;
  cancelSubscription(id: string): Promise<void>;
  listSubscriptions(customerId: string): Promise<PaddleSubscription[]>;
  findCustomer(email: string, accountId: string): Promise<string | null>;
  findCheckout(
    customerId: string,
    intentId: string,
  ): Promise<{ transactionId: string; url: string } | null>;
}
export function paddleProvider(
  config: { environment: "sandbox" | "production"; apiKey: string },
  fetcher: typeof fetch = fetch,
): BillingProvider {
  const root =
    config.environment === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";
  async function call(
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(root + path, {
        method,
        headers: {
          Authorization: "Bearer " + config.apiKey,
          "Content-Type": "application/json",
          "Paddle-Version": "1",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new BillingProviderError("paddle_unavailable", true);
    }
    if (!response.ok)
      throw new BillingProviderError(
        "paddle_http_" + response.status,
        response.status === 429 || response.status >= 500,
      );
    const result = z.object({ data: z.unknown() }).parse(await response.json());
    return result.data;
  }
  async function list(path: string): Promise<unknown[]> {
    const rows: unknown[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < 20; page++) {
      let response: Response;
      try {
        response = await fetcher(root + next, {
          headers: {
            Authorization: "Bearer " + config.apiKey,
            "Paddle-Version": "1",
          },
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new BillingProviderError("paddle_unavailable", true);
      }
      if (!response.ok)
        throw new BillingProviderError(
          "paddle_http_" + response.status,
          response.status === 429 || response.status >= 500,
        );
      const result = z
        .object({
          data: z.array(z.unknown()),
          meta: z.object({
            pagination: z.object({
              has_more: z.boolean(),
              next: z.string().nullish(),
            }),
          }),
        })
        .parse(await response.json());
      rows.push(...result.data);
      if (result.meta.pagination.has_more) {
        if (!result.meta.pagination.next)
          throw new BillingProviderError("paddle_incomplete_pagination", true);
        const url = new URL(result.meta.pagination.next, root);
        if (url.origin !== root || url.pathname !== path.split("?")[0])
          throw new BillingProviderError("paddle_invalid_pagination", false);
        next = url.pathname + url.search;
      } else next = null;
    }
    if (next) throw new BillingProviderError("paddle_pagination_limit", true);
    return rows;
  }
  return {
    async getSubscription(id) {
      return subscriptionSchema.parse(
        await call("/subscriptions/" + encodeURIComponent(id)),
      );
    },
    async createCustomer(input) {
      return z
        .object({ id: z.string() })
        .parse(
          await call("/customers", {
            email: input.email,
            name: input.name,
            custom_data: { aw_billing_account_id: input.accountId },
          }),
        ).id;
    },
    async createCheckout(input) {
      const result = z
        .object({
          id: z.string(),
          checkout: z.object({ url: z.string().url() }).nullable(),
        })
        .parse(
          await call("/transactions", {
            customer_id: input.customerId,
            items: [{ price_id: input.priceId, quantity: 1 }],
            collection_mode: "automatic",
            custom_data: {
              aw_checkout_intent_id: input.intentId,
              aw_billing_account_id: input.accountId,
            },
          }),
        );
      if (!result.checkout)
        throw new BillingProviderError("paddle_checkout_not_ready", true);
      const url = new URL(result.checkout.url);
      if (url.protocol !== "https:")
        throw new BillingProviderError("paddle_invalid_checkout_url", false);
      return { transactionId: result.id, url: url.href };
    },
    async getTransaction(id) {
      const v = z
        .object({
          id: z.string(),
          status: z.string(),
          customer_id: z.string(),
          subscription_id: z.string().nullable(),
        })
        .parse(await call("/transactions/" + encodeURIComponent(id)));
      return {
        id: v.id,
        status: v.status,
        customerId: v.customer_id,
        subscriptionId: v.subscription_id,
      };
    },
    async portal(customerId) {
      const data = z
        .object({
          urls: z.object({ general: z.object({ overview: z.string().url() }) }),
        })
        .parse(
          await call(
            "/customers/" + encodeURIComponent(customerId) + "/portal-sessions",
            {},
          ),
        );
      const url = new URL(data.urls.general.overview);
      if (url.protocol !== "https:")
        throw new BillingProviderError("paddle_invalid_portal_url", false);
      return url.href;
    },
    async cancelSubscription(id) {
      await call("/subscriptions/" + encodeURIComponent(id) + "/cancel", {
        effective_from: "next_billing_period",
      });
    },
    async listSubscriptions(customerId) {
      return z
        .array(subscriptionSchema)
        .parse(
          await list(
            "/subscriptions?customer_id=" +
              encodeURIComponent(customerId) +
              "&per_page=200",
          ),
        );
    },
    async findCustomer(email, accountId) {
      const customers = z
        .array(
          z.object({
            id: z.string(),
            custom_data: z.record(z.string(), z.unknown()).nullable(),
          }),
        )
        .parse(
          await list(
            "/customers?email=" + encodeURIComponent(email) + "&per_page=200",
          ),
        );
      const matching = customers.filter(
        (c) => c.custom_data?.aw_billing_account_id === accountId,
      );
      if (matching.length > 1)
        throw new BillingProviderError("paddle_customer_ambiguous", false);
      return matching[0]?.id ?? null;
    },
    async findCheckout(customerId, intentId) {
      const transactions = z
        .array(
          z.object({
            id: z.string(),
            custom_data: z.record(z.string(), z.unknown()).nullable(),
            checkout: z.object({ url: z.string().url() }).nullable(),
          }),
        )
        .parse(
          await list(
            "/transactions?customer_id=" +
              encodeURIComponent(customerId) +
              "&per_page=200",
          ),
        );
      const matching = transactions.filter(
        (t) => t.custom_data?.aw_checkout_intent_id === intentId,
      );
      if (matching.length > 1)
        throw new BillingProviderError("paddle_checkout_ambiguous", false);
      const row = matching[0];
      if (!row) return null;
      if (!row.checkout || new URL(row.checkout.url).protocol !== "https:")
        throw new BillingProviderError("paddle_checkout_not_ready", true);
      return { transactionId: row.id, url: row.checkout.url };
    },
  };
}
