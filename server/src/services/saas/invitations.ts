import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  authUsers,
  companies,
  companyDeletionOperations,
  companyMemberships,
  invites,
  type Db,
} from "@paperclipai/db";
import { inviteSaasUserSchema } from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import {
  grantsForHumanRole,
  normalizeHumanRole,
} from "../company-member-roles.js";
import { accessService } from "../access.js";
import { equalDigest, randomToken, recipientHash, sha256 } from "./crypto.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import type { transactionalEmail } from "../notifications/transactional-email.js";

type Invite = typeof invites.$inferSelect;
export function saasInvitationService(
  db: Db,
  config: SaasPlatformConfig,
  email: ReturnType<typeof transactionalEmail>,
) {
  async function issue(
    companyId: string,
    userId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = inviteSaasUserSchema.parse(raw),
      role = normalizeHumanRole(input.role),
      hash = recipientHash(input.email, config.outbox.recipientHashKey);
    const keyHash = sha256(userId + ":" + input.idempotencyKey),
      requestHash = sha256(JSON.stringify({ recipientHash: hash, role }));
    return db.transaction(async (tx) => {
      const [company] = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .for("update")
        .limit(1);
      const [actor] = await tx
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .limit(1);
      const [membership] = await tx
        .select()
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .for("share")
        .limit(1);
      if (
        !company ||
        company.status === "archived" ||
        !actor?.emailVerified ||
        !membership
      )
        throw forbidden("Active verified company membership required");
      const [deletion] = await tx
        .select({ id: companyDeletionOperations.id })
        .from(companyDeletionOperations)
        .where(eq(companyDeletionOperations.companyId, companyId))
        .limit(1);
      if (deletion) throw forbidden("Company offboarding is in progress");
      const actorRole = normalizeHumanRole(membership.membershipRole),
        rank = { viewer: 1, operator: 2, admin: 3, owner: 4 };
      if (
        actorRole !== "owner" &&
        (rank[role] >= rank[actorRole] ||
          !(await accessService(tx as unknown as Db).canUser(
            companyId,
            userId,
            "users:invite",
          )))
      )
        throw forbidden("You can only invite people below your company role");
      const [existing] = await tx
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.companyId, companyId),
            sql`${invites.defaultsPayload}->'saas'->>'keyHash' = ${keyHash}`,
          ),
        )
        .limit(1);
      if (existing) {
        if (
          (existing.defaultsPayload?.saas as { requestHash?: string })
            ?.requestHash !== requestHash
        )
          throw conflict("Idempotency key has a different invitation");
        return {
          id: existing.id,
          expiresAt: existing.expiresAt,
          status: existing.revokedAt
            ? "revoked"
            : existing.acceptedAt
              ? "accepted"
              : existing.expiresAt <= now
                ? "expired"
                : "pending",
        };
      }
      const recent = await tx
        .select({ id: invites.id })
        .from(invites)
        .where(
          and(
            eq(invites.companyId, companyId),
            gt(invites.createdAt, new Date(now.getTime() - 86400000)),
          ),
        )
        .limit(1000);
      if (recent.length >= 1000)
        throw unprocessable("Company daily invitation limit reached");
      const token = "pcp_invite_" + randomToken(),
        expiresAt = new Date(now.getTime() + 72 * 3600000);
      const [invite] = await tx
        .insert(invites)
        .values({
          companyId,
          inviteType: "company_join",
          allowedJoinTypes: "human",
          tokenHash: sha256(token),
          invitedByUserId: userId,
          expiresAt,
          defaultsPayload: {
            human: { role, grants: grantsForHumanRole(role) },
            saas: { recipientHash: hash, keyHash, requestHash },
          },
        })
        .returning();
      await email.enqueue(
        {
          companyId,
          purpose: "invite",
          recipient: input.email,
          subject: "Join your organization in August Works",
          message:
            "You have been invited to join " +
            company.name +
            ". Sign in with this email address to accept your invitation.",
          actionPath: "/invite/" + token,
          dedupeKey: "company-invite:" + invite!.id,
          expiresAt,
        },
        tx,
      );
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "saas.invite_requested",
          entityType: "invite",
          entityId: invite!.id,
          details: { role, expiresAt: expiresAt.toISOString() },
        });
      return { id: invite!.id, expiresAt, status: "pending" };
    });
  }
  async function assertRecipient(invite: Invite, userId: string) {
    const [user] = await db
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .limit(1);
    const expected = (
      invite.defaultsPayload?.saas as { recipientHash?: string } | undefined
    )?.recipientHash;
    if (
      !user?.emailVerified ||
      !expected ||
      !equalDigest(
        expected,
        recipientHash(user.email, config.outbox.recipientHashKey),
      )
    )
      throw forbidden(
        "Sign in with the verified email address this invitation was sent to",
        { code: "INVITE_RECIPIENT_REQUIRED" },
      );
    if (!invite.companyId) throw notFound();
    const [company] = await db
      .select({ status: companies.status })
      .from(companies)
      .where(eq(companies.id, invite.companyId))
      .limit(1);
    const [deletion] = await db
      .select({ id: companyDeletionOperations.id })
      .from(companyDeletionOperations)
      .where(eq(companyDeletionOperations.companyId, invite.companyId))
      .limit(1);
    if (!company || company.status === "archived" || deletion)
      throw notFound("Invite not found");
  }
  return { issue, assertRecipient };
}
