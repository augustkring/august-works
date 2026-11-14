import { describe, expect, it, vi } from "vitest";
import { V6_FEATURE_KEYS, v6FeatureFlagsSchema } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import type { PublicOriginConfig } from "@paperclipai/shared";
import type { transactionalEmail } from "../notifications/transactional-email.js";
import { saasAuthDelivery } from "./auth-delivery.js";

type EnqueueInput = Parameters<ReturnType<typeof transactionalEmail>["enqueue"]>[0];

describe("SaaS auth mail locale", () => {
  async function send(input: {
    locale?: unknown;
    requestLocale?: string;
    callbackURL?: string;
    actionUrl?: string;
    purpose?: "verification" | "password_reset";
  }) {
    const enqueue = vi.fn(async (_input: EnqueueInput) => undefined);
    const values = vi.fn(async () => undefined);
    const db = { insert: () => ({ values }) } as unknown as Db;
    const email = { enqueue } as unknown as ReturnType<typeof transactionalEmail>;
    const origins = {
      primaryAppOrigin: "https://app.example.test",
      allowedAppOrigins: ["https://app.example.test"],
      legacyOrigins: [],
    } as PublicOriginConfig;
    const flags = v6FeatureFlagsSchema.parse(
      Object.fromEntries(V6_FEATURE_KEYS.map((key) => [key, true])),
    );
    const delivery = saasAuthDelivery(db, email, origins, flags)!;
    const purpose = input.purpose ?? "verification";
    const url = new URL(input.actionUrl ?? (purpose === "verification"
      ? "https://app.example.test/api/auth/verify-email"
      : "https://app.example.test/api/auth/reset-password/reset-token"));
    if (!url.searchParams.has("token")) url.searchParams.set("token", "opaque-token");
    if (input.callbackURL) url.searchParams.set("callbackURL", input.callbackURL);
    const request = new Request("https://app.example.test/api/auth/sign-up/email", {
      headers: input.requestLocale ? { "X-Blentera-Locale": input.requestLocale } : {},
    });
    let error: unknown;
    try {
      const callback = purpose === "verification"
        ? delivery.sendVerification
        : delivery.sendPasswordReset;
      await callback(
        { user: { id: "user-1", email: "user@example.test", locale: input.locale }, url: url.href, token: "opaque-token" },
        request,
      );
    } catch (caught) {
      error = caught;
    }
    const payload = enqueue.mock.calls[0]?.[0];
    return {
      payload,
      action: payload ? new URL(payload.actionPath, origins.primaryAppOrigin) : undefined,
      error,
      enqueueCount: enqueue.mock.calls.length,
    };
  }

  it("uses the initiating Danish locale and preserves the legacy return context", async () => {
    const result = await send({
      requestLocale: "da",
      callbackURL: "https://app.example.test/saas/welcome?legacy=1",
    });
    expect(result.payload?.subject).toContain("Bekræft din");
    expect(result.payload?.message).toContain("Bekræft din e-mail");
    const callback = new URL(result.action!.searchParams.get("callbackURL")!);
    expect(callback.pathname).toBe("/saas/welcome");
    expect(callback.searchParams.get("legacy")).toBe("1");
    expect(callback.searchParams.get("locale")).toBe("da");
  });

  it("falls back to English for an invalid request locale", async () => {
    const result = await send({ requestLocale: "fr" });
    expect(result.payload?.subject).toContain("Verify your");
    expect(new URL(result.action!.searchParams.get("callbackURL")!).searchParams.get("locale")).toBe("en");
  });

  it("prefers an explicit account locale over the initiating request", async () => {
    const result = await send({ locale: "en", requestLocale: "da" });
    expect(result.payload?.subject).toContain("Verify your");
    expect(new URL(result.action!.searchParams.get("callbackURL")!).searchParams.get("locale")).toBe("en");
  });

  it("preserves reset callback query context", async () => {
    const result = await send({
      purpose: "password_reset",
      requestLocale: "da",
      callbackURL: "https://app.example.test/saas/reset-password?source=mail",
    });
    expect(result.action?.pathname).toBe("/api/auth/reset-password/reset-token");
    const callback = new URL(result.action!.searchParams.get("callbackURL")!);
    expect(callback.pathname).toBe("/saas/reset-password");
    expect(callback.searchParams.get("source")).toBe("mail");
    expect(callback.searchParams.get("locale")).toBe("da");
  });

  it.each([
    "https://evil.example.test/saas/welcome?legacy=1",
    "https://app.example.test/other?legacy=1",
  ])("ignores unsafe or non-native callback context: %s", async (callbackURL) => {
    const result = await send({ callbackURL, requestLocale: "da" });
    const callback = new URL(result.action!.searchParams.get("callbackURL")!);
    expect(callback.origin).toBe("https://app.example.test");
    expect(callback.pathname).toBe("/saas/welcome");
    expect(callback.searchParams.get("legacy")).toBeNull();
    expect(callback.searchParams.get("locale")).toBe("da");
  });

  it.each([
    "https://evil.example.test/api/auth/verify-email?token=token",
    "https://app.example.test/api/auth/unexpected?token=token",
  ])("rejects invalid action origin or path without enqueue: %s", async (actionUrl) => {
    const result = await send({ actionUrl });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.enqueueCount).toBe(0);
  });
});
