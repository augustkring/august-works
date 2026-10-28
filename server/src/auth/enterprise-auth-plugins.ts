import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { sso } from "@better-auth/sso";
import { scim } from "@better-auth/scim";
import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, sessionMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  authAccounts,
  authUsers,
  authVerifications,
  companyMemberships,
  enterpriseIdentityPolicies,
  enterpriseSubjectBindings,
  ssoProvider,
  companySecrets,
  companySecretVersions,
  type Db,
} from "@paperclipai/db";
import {
  v7FeatureEnabled,
  type EnterpriseIdentityConfiguration,
} from "@paperclipai/shared";
import { instanceSettingsService } from "../services/instance-settings.js";
import { secretService } from "../services/secrets.js";
import {
  enterpriseIdentityBridge,
  enterpriseAuthoritySchemaPlugin,
} from "./enterprise-identity-bridge.js";
import { parseAccountDeletionSsoChallenge } from "./account-deletion-sso-proof.js";
export function enterpriseAuthPlugins(
  db: Db,
  sourceSha: string,
  operatorUserIds: readonly string[] = [],
): BetterAuthPlugin[] {
  const enabled = async () =>
    v7FeatureEnabled(
      await instanceSettingsService(db).getExperimental(),
      "enterprise_identity_v7",
    );
  const signingKeyCurrent = async (policy: {
    companyId: string;
    configuration: EnterpriseIdentityConfiguration;
    qualification: {
      signingKey: {
        secretId: string;
        version: number;
        valueSha256: string;
      } | null;
    } | null;
  }) => {
    if (policy.configuration.protocol !== "oidc") {
      try {
        const certificate = new X509Certificate(
          policy.configuration.certificate,
        );
        return (
          new Date(certificate.validFrom) <= new Date() &&
          new Date(certificate.validTo) > new Date()
        );
      } catch {
        return false;
      }
    }
    const pin = policy.qualification?.signingKey;
    if (
      !pin ||
      pin.secretId !== policy.configuration.privateKeySecretId ||
      pin.version !== policy.configuration.privateKeySecretVersion
    )
      return false;
    const [key] = await db
      .select({
        deletedAt: companySecrets.deletedAt,
        revokedAt: companySecretVersions.revokedAt,
      })
      .from(companySecrets)
      .innerJoin(
        companySecretVersions,
        and(
          eq(companySecretVersions.secretId, companySecrets.id),
          eq(companySecretVersions.version, pin.version),
        ),
      )
      .where(
        and(
          eq(companySecrets.id, pin.secretId),
          eq(companySecrets.companyId, policy.companyId),
          eq(companySecrets.scope, "company"),
          eq(companySecrets.provider, "local_encrypted"),
          eq(companySecrets.latestVersion, pin.version),
          eq(companySecrets.status, "active"),
          eq(companySecretVersions.status, "current"),
          eq(companySecretVersions.valueSha256, pin.valueSha256),
        ),
      );
    return Boolean(key && !key.deletedAt && !key.revokedAt);
  };
  const reauthIdentifier = (userId: string) => "account-deletion-oidc:" + userId;
  const currentOidcBinding = async (userId: string) => {
    if (!(await enabled())) return null;
    const rows = await db.select({ policy: enterpriseIdentityPolicies, binding: enterpriseSubjectBindings })
      .from(enterpriseSubjectBindings)
      .innerJoin(enterpriseIdentityPolicies, and(
        eq(enterpriseIdentityPolicies.companyId, enterpriseSubjectBindings.companyId),
        eq(enterpriseIdentityPolicies.providerId, enterpriseSubjectBindings.providerId),
      ))
      .innerJoin(ssoProvider, and(eq(ssoProvider.providerId, enterpriseIdentityPolicies.providerId),
        eq(ssoProvider.companyId, enterpriseIdentityPolicies.companyId)))
      .innerJoin(companyMemberships, and(eq(companyMemberships.companyId, enterpriseSubjectBindings.companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active")))
      .where(and(eq(enterpriseSubjectBindings.userId, userId), eq(enterpriseSubjectBindings.status, "active"),
        eq(enterpriseIdentityPolicies.status, "qualified")));
    const candidates = [];
    for (const row of rows) {
      const { policy } = row;
      const expiresAt = policy.qualification?.expiresAt;
      if (policy.configuration.protocol !== "oidc" || policy.qualification?.sourceRevision !== sourceSha ||
        !expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now() ||
        !(await signingKeyCurrent(policy))) continue;
      const revision = createHash("sha256").update(JSON.stringify({
        id: policy.id, version: policy.version, companyId: policy.companyId, providerId: policy.providerId,
        issuer: policy.issuer, configuration: policy.configuration, qualification: policy.qualification,
        updatedAt: policy.updatedAt.toISOString(),
      })).digest("hex");
      candidates.push({ ...row, revision });
    }
    return candidates.length === 1 ? candidates[0]! : null;
  };
  const bridge = enterpriseIdentityBridge({
    sourceSha,
    enabled,
    signingKeyCurrent,
  });
  const gate: BetterAuthPlugin = {
    id: "aw-enterprise-feature-gate",
    endpoints: {
      accountDeletionSsoStatus: createAuthEndpoint("/account-deletion/sso/status", {
        method: "GET", use: [sessionMiddleware],
      }, async ctx => {
        const { user, session } = ctx.context.session;
        const [current] = await db.execute<{ eligible: boolean }>(sql`
          select u.email_verified and not u.two_factor_enabled and not u.phishing_resistant_required
            and not exists(select 1 from account a where a.user_id=u.id and a.provider_id='credential' and a.password is not null)
            and not exists(select 1 from account_deletion_operations d where d.user_id=u.id)
            and exists(select 1 from "session" s where s.id=${session.id} and s.user_id=u.id and s.expires_at>clock_timestamp())
            as eligible from "user" u where u.id=${user.id}`);
        const authority = current?.eligible && !operatorUserIds.includes(user.id) ? await currentOidcBinding(user.id) : null;
        const [challengeRow] = await db.select().from(authVerifications)
          .where(eq(authVerifications.identifier, reauthIdentifier(user.id))).limit(1);
        const challenge = challengeRow ? parseAccountDeletionSsoChallenge(challengeRow.value) : null;
        const ready = Boolean(challenge && challenge.purpose === "account-deletion" && challenge.state === "ready" &&
          challenge.userId === user.id && challenge.proofSessionId === session.id &&
          Date.parse(String(challenge.expiresAt)) > Date.now() && challenge.authenticatorVersion ===
            (await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, user.id)).limit(1))[0]?.version);
        ctx.setHeader("Cache-Control", "no-store");
        return ctx.json({ userId: user.id, providerId: authority?.policy.providerId ?? null, available: Boolean(authority),
          ready, challengeId: ready ? challenge?.challengeId : null });
      }),
      accountDeletionSsoStart: createAuthEndpoint("/account-deletion/sso/start", {
        method: "POST", use: [sessionMiddleware], body: z.object({}).strict(),
      }, async ctx => {
        const { user, session } = ctx.context.session;
        if ((ctx.getHeader("X-Blentera-Expected-User") !== null && ctx.getHeader("X-Blentera-Expected-User") !== user.id) ||
          (ctx.getHeader("X-Blentera-Expected-Session") !== null && ctx.getHeader("X-Blentera-Expected-Session") !== session.id))
          throw new APIError("CONFLICT", { code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue" });
        const [current] = await db.execute<{ version: number; eligible: boolean }>(sql`
          select u.authenticator_version as version,
            u.email_verified and not u.two_factor_enabled and not u.phishing_resistant_required
              and not exists(select 1 from account a where a.user_id=u.id and a.provider_id='credential' and a.password is not null)
              and not exists(select 1 from account_deletion_operations d where d.user_id=u.id)
              and s.expires_at>clock_timestamp() as eligible
          from "user" u join "session" s on s.user_id=u.id
          where u.id=${user.id} and s.id=${session.id}
            and (s.authenticator_version is null or s.authenticator_version=u.authenticator_version)
          for share of u,s nowait`);
        if (!current?.eligible || operatorUserIds.includes(user.id))
          throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "A supported recent sign-in method is unavailable" });
        const authority = await currentOidcBinding(user.id);
        if (!authority)
          throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "A current qualified company sign-in is unavailable" });
        const challengeId = randomUUID();
        const createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
        const value = JSON.stringify({
          challengeId, purpose: "account-deletion", state: "created", userId: user.id,
          sourceSessionId: session.id, authenticatorVersion: current.version, providerId: authority.policy.providerId,
          policyId: authority.policy.id, policyVersion: authority.policy.version, policyRevision: authority.revision,
          companyId: authority.binding.companyId, bindingId: authority.binding.id, issuer: authority.binding.issuer,
          subject: authority.binding.subject, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
          authorizationState: null, idTokenNonce: null, authTime: null, proofSessionId: null,
        });
        await db.transaction(async tx => {
          const [active] = await tx.execute<{ id: string }>(sql`
            select s.id from "session" s join "user" u on u.id=s.user_id
            where s.id=${session.id} and u.id=${user.id} and s.expires_at>clock_timestamp()
              and u.authenticator_version=${current.version}
              and (s.authenticator_version is null or s.authenticator_version=u.authenticator_version)
              and not exists(select 1 from account_deletion_operations where user_id=u.id)
            for update of s nowait for share of u nowait`);
          if (!active) throw new APIError("CONFLICT", { code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue" });
          await tx.delete(authVerifications).where(eq(authVerifications.identifier, reauthIdentifier(user.id)));
          await tx.insert(authVerifications).values({ id: randomUUID(), identifier: reauthIdentifier(user.id), value,
            authenticatorVersion: current.version, expiresAt, createdAt, updatedAt: createdAt });
        });
        const callbackURL = new URL("/company/settings/security", new URL(ctx.context.baseURL).origin);
        callbackURL.searchParams.set("accountDeletionReauth", challengeId);
        ctx.setHeader("Cache-Control", "no-store");
        return ctx.json({ userId: user.id, challengeId, providerId: authority.policy.providerId, callbackURL: callbackURL.toString() });
      }),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            Boolean(
              ctx.path?.startsWith("/sso/") ||
              ctx.path?.startsWith("/scim/") ||
              ctx.path === "/sign-in/sso",
            ),
          handler: createAuthMiddleware(async (ctx) => {
            if (!(await enabled()))
              throw new APIError("NOT_FOUND", {
                message: "Enterprise identity is not enabled",
              });
            if (ctx.path === "/sign-in/sso") {
              const input = ctx.body as {
                providerId?: string;
                domain?: string;
                email?: string;
                issuer?: string;
                callbackURL?: string;
                additionalParams?: Record<string, string>;
              };
              const domain =
                input.domain?.toLowerCase() ??
                input.email?.split("@").at(-1)?.toLowerCase();
              const predicate = input.providerId
                ? eq(enterpriseIdentityPolicies.providerId, input.providerId)
                : input.issuer
                  ? eq(enterpriseIdentityPolicies.issuer, input.issuer)
                  : domain
                    ? eq(ssoProvider.domain, domain)
                    : null;
              if (!predicate)
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Company email or approved identity provider required",
                });
              const rows = await db
                .select({ policy: enterpriseIdentityPolicies })
                .from(enterpriseIdentityPolicies)
                .innerJoin(
                  ssoProvider,
                  and(
                    eq(
                      ssoProvider.providerId,
                      enterpriseIdentityPolicies.providerId,
                    ),
                    eq(
                      ssoProvider.companyId,
                      enterpriseIdentityPolicies.companyId,
                    ),
                  ),
                )
                .where(predicate)
                .limit(2);
              const policy = rows.length === 1 ? rows[0]!.policy : null;
              if (
                !policy ||
                policy.status !== "qualified" ||
                policy.qualification?.sourceRevision !== sourceSha ||
                !Number.isFinite(
                  new Date(policy.qualification.expiresAt).getTime(),
                ) ||
                new Date(policy.qualification.expiresAt) <= new Date() ||
                !(await signingKeyCurrent(policy))
              )
                throw new APIError("FORBIDDEN", {
                  message:
                    "Current unambiguous company identity qualification required",
                });
              let callback: URL | null = null;
              try { callback = input.callbackURL ? new URL(input.callbackURL) : null; } catch { /* rejected below */ }
              const challengeId = callback?.searchParams.get("accountDeletionReauth");
              if (challengeId) {
                const active = await getSessionFromCtx(ctx);
                if (!active || callback!.origin !== new URL(ctx.context.baseURL).origin ||
                  callback!.pathname !== "/company/settings/security" ||
                  callback!.searchParams.getAll("accountDeletionReauth").length !== 1)
                  throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "A current account session is required" });
                const [row] = await db.select().from(authVerifications)
                  .where(eq(authVerifications.identifier, reauthIdentifier(active.user.id))).limit(1);
                const challenge = row ? parseAccountDeletionSsoChallenge(row.value) : null;
                if (!challenge || challenge.challengeId !== challengeId || challenge.userId !== active.user.id ||
                  challenge.sourceSessionId !== active.session.id || challenge.providerId !== policy.providerId ||
                  challenge.purpose !== "account-deletion" || challenge.state !== "created" ||
                  !Number.isFinite(Date.parse(String(challenge.expiresAt))) || Date.parse(String(challenge.expiresAt)) <= Date.now())
                  throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
                const authority = await currentOidcBinding(active.user.id);
                if (!authority || authority.policy.providerId !== policy.providerId ||
                  challenge.policyRevision !== authority.revision || challenge.bindingId !== authority.binding.id)
                  throw new APIError("CONFLICT", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "Company sign-in policy changed; start again" });
                input.additionalParams = { ...(input.additionalParams ?? {}), prompt: "login", max_age: "0" };
              }
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/sso",
          handler: createAuthMiddleware(async (ctx) => {
            const input = ctx.body as { callbackURL?: string };
            let callback: URL | null = null;
            try { callback = input.callbackURL ? new URL(input.callbackURL) : null; } catch { return; }
            const challengeId = callback?.searchParams.get("accountDeletionReauth");
            if (!challengeId) return;
            const active = await getSessionFromCtx(ctx);
            const returned = ctx.context.returned as { url?: unknown } | undefined;
            let authorization: URL | null = null;
            try { authorization = typeof returned?.url === "string" ? new URL(returned.url) : null; } catch { /* fail closed */ }
            const state = authorization?.searchParams.get("state"), nonce = authorization?.searchParams.get("nonce");
            if (!active || !state || !nonce || nonce.length < 16 || authorization?.searchParams.get("prompt") !== "login" ||
              authorization.searchParams.get("max_age") !== "0")
              throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The provider did not start a fresh sign-in" });
            const [row] = await db.select().from(authVerifications)
              .where(eq(authVerifications.identifier, reauthIdentifier(active.user.id))).limit(1);
            if (!row) throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
            const challenge = parseAccountDeletionSsoChallenge(row.value);
            if (!challenge) {
              throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
            }
            if (challenge.challengeId !== challengeId || challenge.sourceSessionId !== active.session.id || challenge.state !== "created")
              throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
            challenge.authorizationState = state;
            challenge.idTokenNonce = nonce;
            challenge.state = "authorization_started";
            await db.update(authVerifications).set({ value: JSON.stringify(challenge), updatedAt: new Date() })
              .where(and(eq(authVerifications.id, row.id), eq(authVerifications.identifier, reauthIdentifier(active.user.id))));
          }),
        },
        {
          matcher: (ctx) => ctx.path?.startsWith("/sso/callback/") === true,
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created) return;
            const [row] = await db.select().from(authVerifications)
              .where(eq(authVerifications.identifier, reauthIdentifier(created.user.id))).limit(1);
            if (!row) return;
            const challenge = parseAccountDeletionSsoChallenge(row.value);
            if (!challenge) return;
            if (challenge.state !== "callback_verified") return;
            const state = typeof ctx.query.state === "string" ? ctx.query.state : null;
            const authTime = typeof challenge.authTime === "number" ? challenge.authTime : NaN;
            if (!state || state !== challenge.authorizationState || challenge.userId !== created.user.id ||
              challenge.providerId !== (ctx.params as { providerId?: string }).providerId ||
              !Number.isFinite(authTime) || Date.now() - authTime > 300_000 || authTime > Date.now() + 5_000) {
              deleteSessionCookie(ctx);
              ctx.context.setNewSession(null);
              await ctx.context.internalAdapter.deleteSession(created.session.token);
              throw new APIError("UNAUTHORIZED", { code: "ACCOUNT_DELETION_SSO_REAUTH_INVALID", message: "The sign-in confirmation could not be verified" });
            }
            challenge.state = "ready";
            challenge.proofSessionId = created.session.id;
            await db.update(authVerifications).set({ value: JSON.stringify(challenge), updatedAt: new Date() })
              .where(and(eq(authVerifications.id, row.id), eq(authVerifications.identifier, reauthIdentifier(created.user.id))));
          }),
        },
      ],
    },
  };
  return [
    enterpriseAuthoritySchemaPlugin,
    gate,
    sso({
      resolveUser: bridge.resolveUser,
      providersLimit: 0,
      disableImplicitSignUp: true,
      defaultOverrideUserInfo: false,
      organizationProvisioning: { disabled: true },
      guardProviderMutation: async () => {
        throw new APIError("FORBIDDEN", {
          message: "Native company policy controls identity configuration",
        });
      },
      saml: {
        enableInResponseToValidation: true,
        allowIdpInitiated: false,
        requireTimestamps: true,
        algorithms: { onDeprecated: "reject" },
        maxResponseSize: 262144,
        maxMetadataSize: 102400,
      },
      schema: {
        ssoProvider: {
          additionalFields: {
            companyId: { type: "string", required: true, input: false },
          },
        },
      },
      resolvePrivateKey: async ({ providerId, issuer, keyId }) => {
        const [policy] = await db
          .select()
          .from(enterpriseIdentityPolicies)
          .where(
            and(
              eq(enterpriseIdentityPolicies.providerId, providerId),
              eq(enterpriseIdentityPolicies.issuer, issuer),
              eq(enterpriseIdentityPolicies.status, "qualified"),
            ),
          );
        if (
          !(await enabled()) ||
          !policy ||
          policy.configuration.protocol !== "oidc" ||
          keyId !== policy.configuration.privateKeySecretId ||
          policy.qualification?.sourceRevision !== sourceSha ||
          !Number.isFinite(
            new Date(policy.qualification.expiresAt).getTime(),
          ) ||
          new Date(policy.qualification.expiresAt) <= new Date() ||
          !(await signingKeyCurrent(policy))
        )
          throw new APIError("FORBIDDEN", {
            message: "Current company signing qualification required",
          });
        return {
          privateKeyPem: await secretService(db).resolveSecretValue(
            policy.companyId,
            policy.configuration.privateKeySecretId,
            policy.configuration.privateKeySecretVersion,
            {
              accessContext: {
                consumerType: "system",
                consumerId: "enterprise-identity",
                actorType: "system",
                actorId: "enterprise-identity",
              },
            },
          ),
          algorithm: "RS256",
        };
      },
    }),
    scim({
      connections: [],
      authentication: bridge.authentication,
      identity: bridge.identity,
      projection: bridge.projection,
    }),
  ];
}
export const ENTERPRISE_DISABLED_AUTH_PATHS = [
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];
