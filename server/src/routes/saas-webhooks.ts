import express, { Router } from "express";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors.js";
import type { SaasPlatform } from "../services/saas/platform.js";
import { verifyPaddleSignature } from "../services/billing/paddle-provider.js";
import { verifyMailgunSignature } from "../services/notifications/mailgun-provider.js";
import { sha256 } from "../services/saas/crypto.js";

const mailgunWebhookSchema = z.object({
  signature: z.object({
    timestamp: z.string(),
    token: z.string(),
    signature: z.string(),
  }),
  "event-data": z.object({
    id: z.string().min(1).max(150),
    event: z.string(),
    severity: z.string().optional(),
    recipient: z.string().email(),
    message: z.object({
      headers: z.object({ "message-id": z.string().min(1).max(300) }),
    }),
  }),
});
/** Provider-authenticated ingress is outside browser/session mutation guards. */
export function saasWebhookRoutes(platform: SaasPlatform) {
  const router = Router();
  router.use(
    ["/api/webhooks/paddle", "/api/webhooks/mailgun"],
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  router.post("/api/webhooks/paddle", async (req, res) => {
    if (!(await platform.enabled("billing_v6"))) throw notFound();
    if (
      !Buffer.isBuffer(req.body) ||
      !verifyPaddleSignature(
        platform.config.billing.webhookSecret,
        req.body,
        req.get("paddle-signature"),
      )
    )
      throw forbidden("Invalid provider signature");
    try {
      JSON.parse(req.body.toString("utf8"));
    } catch {
      throw badRequest("Invalid provider event");
    }
    await platform.billing.receive(req.body);
    res.status(200).json({ received: true });
  });
  router.post("/api/webhooks/mailgun", async (req, res) => {
    if (!(await platform.enabled("transactional_email_v6"))) throw notFound();
    if (!Buffer.isBuffer(req.body)) throw badRequest("JSON event required");
    let value: unknown;
    try {
      value = JSON.parse(req.body.toString("utf8"));
    } catch {
      throw badRequest("Invalid provider event");
    }
    const input = mailgunWebhookSchema.parse(value);
    if (
      !verifyMailgunSignature(platform.config.mail.signingKey, input.signature)
    )
      throw forbidden("Invalid provider signature");
    const event = input["event-data"];
    await platform.email.recordProviderEvent({
      eventId: event.id,
      messageId: event.message.headers["message-id"],
      event:
        event.event === "failed" && event.severity !== "permanent"
          ? "temporary_failure"
          : event.event,
      recipient: event.recipient,
      payloadHash: sha256(req.body),
    });
    res.status(200).json({ received: true });
  });
  return router;
}
