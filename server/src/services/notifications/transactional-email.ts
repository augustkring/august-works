import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  emailDeliveries,
  emailSuppressions,
  emailWebhookReceipts,
} from "@paperclipai/db";
import type { PublicOriginConfig } from "@paperclipai/shared";
import { publicAppUrl } from "../../aw-deployment.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { open, recipientHash, seal } from "../saas/crypto.js";
import {
  ProviderDeliveryError,
  type TransactionalEmailProvider,
} from "./mailgun-provider.js";

type EmailPurpose =
  | "verification"
  | "password_reset"
  | "invite"
  | "billing"
  | "runtime"
  | "approval"
  | "work_update"
  | "security";
type EmailPayload = {
  recipient: string;
  subject: string;
  actionPath: string;
  message: string;
};
export type EmailDb = Pick<Db, "select" | "insert" | "update" | "delete">;
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function transactionalEmail(
  db: Db,
  config: SaasPlatformConfig,
  origins: PublicOriginConfig,
  provider: TransactionalEmailProvider,
) {
  const key = config.outbox.encryptionKey;
  async function enqueue(
    input: {
      purpose: EmailPurpose;
      recipient: string;
      subject: string;
      actionPath: string;
      message: string;
      dedupeKey: string;
      expiresAt: Date;
      userId?: string;
      companyId?: string;
    },
    writeDb: EmailDb = db,
  ) {
    publicAppUrl(origins, input.actionPath);
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient) ||
      /[\r\n]/.test(input.subject)
    )
      throw new Error("Invalid transactional email");
    const id = randomUUID();
    const row = {
      id,
      companyId: input.companyId,
      userId: input.userId,
      purpose: input.purpose,
      recipientHash: recipientHash(
        input.recipient,
        config.outbox.recipientHashKey,
      ),
      dedupeKey: input.dedupeKey,
      payloadExpiresAt: input.expiresAt,
      payloadKeyId: config.outbox.keyId,
      payloadCiphertext: seal(
        {
          recipient: input.recipient.trim().toLowerCase(),
          subject: input.subject,
          actionPath: input.actionPath,
          message: input.message,
        } satisfies EmailPayload,
        key,
        "email:" + id,
      ),
    };
    const [created] = await writeDb
      .insert(emailDeliveries)
      .values(row)
      .onConflictDoNothing({ target: emailDeliveries.dedupeKey })
      .returning({ id: emailDeliveries.id });
    return created?.id ?? null;
  }
  async function processOne(owner: string, now = new Date()) {
    await db
      .update(emailDeliveries)
      .set({
        status: "expired",
        payloadCiphertext: null,
        errorCode: "action_expired",
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(
        and(
          lte(emailDeliveries.payloadExpiresAt, now),
          isNull(emailDeliveries.sentAt),
          or(
            eq(emailDeliveries.status, "pending"),
            eq(emailDeliveries.status, "failed"),
            and(
              eq(emailDeliveries.status, "sending"),
              lte(emailDeliveries.leaseUntil, now),
            ),
          ),
        ),
      );
    await db
      .update(emailDeliveries)
      .set({
        status: "quarantined",
        payloadCiphertext: null,
        errorCode: "delivery_attempts_exhausted",
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(emailDeliveries.status, "sending"),
          lte(emailDeliveries.leaseUntil, now),
          sql`${emailDeliveries.attempts} >= 5`,
        ),
      );
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(emailDeliveries)
        .where(
          and(
            or(
              eq(emailDeliveries.status, "pending"),
              eq(emailDeliveries.status, "failed"),
              and(
                eq(emailDeliveries.status, "sending"),
                lte(emailDeliveries.leaseUntil, now),
              ),
            ),
            lte(emailDeliveries.notBefore, now),
            gt(emailDeliveries.payloadExpiresAt, now),
            lt(emailDeliveries.attempts, 5),
          ),
        )
        .orderBy(emailDeliveries.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      await tx
        .update(emailDeliveries)
        .set({
          status: "sending",
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + 60000),
          attempts: sql`${emailDeliveries.attempts}+1`,
        })
        .where(eq(emailDeliveries.id, row.id));
      return row;
    });
    if (!claimed) return false;
    const own = and(
      eq(emailDeliveries.id, claimed.id),
      eq(emailDeliveries.leaseOwner, owner),
      eq(emailDeliveries.status, "sending"),
    );
    const [suppressed] = await db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.recipientHash, claimed.recipientHash))
      .limit(1);
    if (suppressed) {
      await db
        .update(emailDeliveries)
        .set({
          status: "suppressed",
          payloadCiphertext: null,
          leaseOwner: null,
          leaseUntil: null,
        })
        .where(own);
      return true;
    }
    try {
      if (!claimed.payloadCiphertext)
        throw new ProviderDeliveryError("mail_payload_missing", false);
      const decryptKey =
        claimed.payloadKeyId === config.outbox.keyId
          ? key
          : config.outbox.previousKeys[claimed.payloadKeyId];
      if (!decryptKey)
        throw new ProviderDeliveryError("mail_payload_key_unavailable", true);
      const payload = open<EmailPayload>(
        claimed.payloadCiphertext,
        decryptKey,
        "email:" + claimed.id,
      );
      const messageId = "<" + claimed.id + "@" + config.mail.domain + ">";
      const existing =
        claimed.status === "sending" ? await provider.find(messageId) : null;
      const link = publicAppUrl(origins, payload.actionPath);
      const delivered = existing
        ? { providerMessageId: existing }
        : await provider.send({
            to: payload.recipient,
            subject: payload.subject,
            messageId,
            text: payload.message + "\n\n" + link,
            html:
              "<p>" +
              escapeHtml(payload.message) +
              '</p><p><a href="' +
              escapeHtml(link) +
              '">' +
              escapeHtml(payload.subject) +
              "</a></p>",
          });
      await db
        .update(emailDeliveries)
        .set({
          status: "accepted",
          providerMessageId: delivered.providerMessageId,
          sentAt: now,
          payloadCiphertext: null,
          leaseOwner: null,
          leaseUntil: null,
          errorCode: null,
        })
        .where(own);
    } catch (error) {
      const code =
        error instanceof ProviderDeliveryError
          ? error.code
          : "mail_provider_unavailable";
      const retryable =
        !(error instanceof ProviderDeliveryError) || error.retryable;
      const exhausted = claimed.attempts + 1 >= 5 || !retryable;
      await db
        .update(emailDeliveries)
        .set({
          status: exhausted ? "quarantined" : "failed",
          errorCode: code,
          notBefore: new Date(
            now.getTime() + Math.min(3600000, 30000 * 2 ** claimed.attempts),
          ),
          leaseOwner: null,
          leaseUntil: null,
          ...(exhausted ? { payloadCiphertext: null } : {}),
        })
        .where(own);
    }
    return true;
  }
  async function recordProviderEvent(
    input: {
      eventId: string;
      messageId: string;
      event: string;
      recipient: string;
      payloadHash: string;
    },
    now = new Date(),
  ) {
    return db.transaction(async (tx) => {
      const [receipt] = await tx
        .insert(emailWebhookReceipts)
        .values({ eventId: input.eventId, payloadHash: input.payloadHash })
        .onConflictDoNothing()
        .returning();
      if (!receipt) return false;
      const hash = recipientHash(
        input.recipient,
        config.outbox.recipientHashKey,
      );
      const logicalId = input.messageId.match(/^<?([a-f0-9-]{36})@/i)?.[1];
      const [row] = await tx
        .select()
        .from(emailDeliveries)
        .where(
          and(
            or(
              eq(emailDeliveries.providerMessageId, input.messageId),
              ...(logicalId ? [eq(emailDeliveries.id, logicalId)] : []),
            ),
            eq(emailDeliveries.recipientHash, hash),
          ),
        )
        .limit(1);
      if (!row) return true;
      if (input.event === "delivered")
        await tx
          .update(emailDeliveries)
          .set({
            status: "delivered",
            deliveredAt: now,
            sentAt: row.sentAt ?? now,
            payloadCiphertext: null,
            providerMessageId: input.messageId,
            leaseOwner: null,
            leaseUntil: null,
          })
          .where(
            and(
              eq(emailDeliveries.id, row.id),
              or(
                eq(emailDeliveries.status, "accepted"),
                eq(emailDeliveries.status, "sending"),
                eq(emailDeliveries.status, "failed"),
              ),
            ),
          );
      if (["complained", "failed"].includes(input.event)) {
        await tx
          .insert(emailSuppressions)
          .values({ recipientHash: hash, reason: input.event })
          .onConflictDoNothing();
        await tx
          .update(emailDeliveries)
          .set({
            status: input.event === "complained" ? "complained" : "bounced",
            payloadCiphertext: null,
            leaseOwner: null,
            leaseUntil: null,
            sentAt: row.sentAt ?? now,
            providerMessageId: input.messageId,
          })
          .where(eq(emailDeliveries.id, row.id));
      }
      return true;
    });
  }
  return { enqueue, processOne, recordProviderEvent };
}
