import { describe, expect, it, vi } from "vitest";
import { paddleProvider } from "../services/billing/paddle-provider.js";

describe("V6 Paddle cancellation contract", () => {
  it("preserves period-end cancellation and sends immediate cancellation for paused offboarding", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ data: {} }));
    const provider = paddleProvider(
      { environment: "sandbox", apiKey: "fixture" },
      fetcher,
    );
    await provider.cancelSubscription("sub_active");
    await provider.cancelSubscription("sub_paused", "immediately");
    expect(
      fetcher.mock.calls.map(([url, options]) => ({
        url,
        body: JSON.parse(String(options!.body)),
      })),
    ).toEqual([
      {
        url: "https://sandbox-api.paddle.com/subscriptions/sub_active/cancel",
        body: { effective_from: "next_billing_period" },
      },
      {
        url: "https://sandbox-api.paddle.com/subscriptions/sub_paused/cancel",
        body: { effective_from: "immediately" },
      },
    ]);
  });
});
