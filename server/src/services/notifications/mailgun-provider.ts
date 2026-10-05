import { createHmac } from "node:crypto";
import { z } from "zod";
import { equalDigest } from "../saas/crypto.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";

export type TransactionalMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
};
export interface TransactionalEmailProvider {
  send(message: TransactionalMessage): Promise<{ providerMessageId: string }>;
  find(messageId: string): Promise<string | null>;
}
export class ProviderDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
  }
}
export function verifyMailgunSignature(
  signingKey: string,
  input: { timestamp: string; token: string; signature: string },
  now = Date.now(),
): boolean {
  const timestamp = Number(input.timestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now / 1000 - timestamp) > 300 ||
    !/^[A-Za-z0-9]{20,128}$/.test(input.token)
  )
    return false;
  const expected = createHmac("sha256", signingKey)
    .update(input.timestamp + input.token)
    .digest("hex");
  return equalDigest(expected, input.signature);
}
export function mailgunProvider(
  config: SaasPlatformConfig,
  fetcher: typeof fetch = fetch,
): TransactionalEmailProvider {
  const { mail, environment } = config;
  const root =
    "https://api.eu.mailgun.net/v3/" + encodeURIComponent(mail.domain);
  const headers = {
    Authorization:
      "Basic " + Buffer.from("api:" + mail.apiKey).toString("base64"),
  };
  async function responseJson(
    response: Response,
  ): Promise<Record<string, unknown>> {
    if (!response.ok)
      throw new ProviderDeliveryError(
        "mailgun_http_" + response.status,
        response.status === 429 || response.status >= 500,
      );
    const body = await response.json();
    if (!body || typeof body !== "object")
      throw new ProviderDeliveryError("mailgun_invalid_response", false);
    return body as Record<string, unknown>;
  }
  return {
    async send(message) {
      if (
        environment === "staging" &&
        !mail.stagingRecipients.includes(message.to.toLowerCase())
      )
        throw new ProviderDeliveryError("staging_recipient_blocked", false);
      const form = new FormData();
      for (const [key, value] of Object.entries({
        from: mail.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        "h:Message-Id": message.messageId,
        "o:tracking": "no",
        "o:tracking-clicks": "no",
        "o:tracking-opens": "no",
      }))
        form.set(key, value);
      const result = await responseJson(
        await fetcher(root + "/messages", {
          method: "POST",
          headers,
          body: form,
          signal: AbortSignal.timeout(15000),
        }),
      );
      if (typeof result.id !== "string")
        throw new ProviderDeliveryError("mailgun_missing_message_id", true);
      return { providerMessageId: result.id };
    },
    async find(messageId) {
      const url = new URL(root + "/events");
      url.searchParams.set("message-id", messageId);
      url.searchParams.set("limit", "10");
      const result = await responseJson(
        await fetcher(url, { headers, signal: AbortSignal.timeout(15000) }),
      );
      const parsed = z
        .object({
          items: z.array(
            z.object({
              event: z.string(),
              message: z
                .object({
                  headers: z.object({ "message-id": z.string().optional() }),
                })
                .optional(),
            }),
          ),
        })
        .safeParse(result);
      if (!parsed.success)
        throw new ProviderDeliveryError("mailgun_invalid_events", true);
      const accepted = parsed.data.items.find((item) =>
        ["accepted", "delivered"].includes(item.event),
      );
      return accepted?.message?.headers["message-id"] ?? null;
    },
  };
}
