import { describe, expect, it, vi } from "vitest";
import { mailgunProvider } from "../services/notifications/mailgun-provider.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

const config = {
  environment: "production",
  mail: { domain: "mail.example.test", apiKey: "fixture-only", from: "updates@example.test" },
} as SaasPlatformConfig;
const message = { to: "owner@example.test", subject: "Update", text: "Sign in", html: "<p>Sign in</p>", messageId: "<owned@mail.example.test>" };

describe("Mailgun notification acknowledgement boundaries", () => {
  it("requires an accepted event for the exact original logical message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [
      { event: "accepted", message: { headers: { "message-id": "another@mail.example.test" } } },
      { event: "delivered", message: { headers: { "message-id": "owned@mail.example.test" } } },
    ] }));
    expect(await mailgunProvider(config, fetcher).find(message.messageId)).toBe("owned@mail.example.test");
    fetcher.mockResolvedValue(Response.json({ items: [{ event: "accepted", message: { headers: { "message-id": "another@mail.example.test" } } }] }));
    expect(await mailgunProvider(config, fetcher).find(message.messageId)).toBeNull();
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  });

  it("distinguishes explicit refusal from uncertain server acceptance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
    const provider = mailgunProvider(config, fetcher);
    await expect(provider.send(message)).rejects.toMatchObject({ retryable: true, acceptance: "not_accepted" });
    fetcher.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(provider.send(message)).rejects.toMatchObject({ acceptance: "unknown" });
    fetcher.mockResolvedValue(Response.json({ message: "Queued" }));
    await expect(provider.send(message)).rejects.toMatchObject({ acceptance: "unknown", code: "mailgun_missing_message_id" });
  });
});
