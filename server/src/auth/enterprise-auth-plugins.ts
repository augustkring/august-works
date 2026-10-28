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
import { assertHumanAuthentication, assertPinnedAuthenticationDeadline } from "./authenticator-assurance.js";
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
  const currentSsoBinding = async (userId: string) => {
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
      if (policy.qualification?.sourceRevision !== sourceSha ||
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
        const [current] = await db.execute<{ eligible: boolean; twoFactorEnabled: boolean }>(sql`
          select u.two_factor_enabled as "twoFactorEnabled",
            u.email_verified and not u.phishing_resistant_required
            and not exists(select 1 from account a where a.user_id=u.id and a.provider_id='credential' and a.password is not null)
            and not exists(select 1 from account_deletion_operations d where d.user_id=u.id)
            and exists(select 1 from "session" s where s.id=${session.id} and s.user_id=u.id and s.expires_at>clock_timestamp())
            as eligible from "user" u where u.id=${user.id}`);
        const authority = current?.eligible && !operatorUserIds.includes(user.id) ? await currentSsoBinding(user.id) : null;
        const [challengeRow] = await db.select().from(authVerifications)
          .where(eq(authVerifications.identifier, reauthIdentifier(user.id))).limit(1);
        const challenge = challengeRow ? parseAccountDeletionSsoChallenge(challengeRow.value) : null;
        const version = (await db.select({ version: authUsers.authenticatorVersion }).from(authUsers)
          .where(eq(authUsers.id, user.id)).limit(1))[0]?.version;
        const challengeCurrent = Boolean(authority && challenge && challenge.purpose === "account-deletion" && challenge.state === "ready" &&
          challenge.protocol === authority.policy.configuration.protocol &&
          challenge.userId === user.id && challenge.proofSessionId === session.id &&
          challenge.policyId === authority.policy.id && challenge.policyVersion === authority.policy.version &&
          challenge.policyRevision === authority.revision && challenge.providerId === authority.policy.providerId &&
          challenge.bindingId === authority.binding.id && challenge.issuer === authority.binding.issuer &&
          challenge.subject === authority.binding.subject &&
          Number.isSafeInteger(challenge.authTime) && Number.isFinite(Date.parse(challenge.expiresAt)) &&
          Date.parse(challenge.expiresAt) > Date.now() &&
          (challenge.authenticatorVersion === version || current?.twoFactorEnabled && challenge.nativeFactorAuthenticatorVersion === version));
        const ready = challengeCurrent && (!current?.twoFactorEnabled || challenge?.nativeFactorSessionId === session.id);
        ctx.setHeader("Cache-Control", "no-store");
        return ctx.json({ userId: user.id, providerId: authority?.policy.providerId ?? null, available: Boolean(authority),
          requiresNativeFactor: Boolean(current?.twoFactorEnabled),
          ready, challengeId: challengeCurrent ? challenge?.challengeId : null });
      }),
      accountDeletionSsoStart: createAuthEndpoint("/account-deletion/sso/start", {
        method: "POST", use: [sessionMiddleware], body: z.object({}).strict(),
      }, async ctx => {
        const { user, session } = ctx.context.session;
        if ((ctx.getHeader("X-Blentera-Expected-User") !== null && ctx.getHeader("X-Blentera-Expected-User") !== user.id) ||
          (ctx.getHeader("X-Blentera-Expected-Session") !== null && ctx.getHeader("X-Blentera-Expected-Session") !== session.id))
          throw new APIError("CONFLICT", { code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue" });
        const [current] = await db.execute<{ version: number; eligible: boolean; twoFactorEnabled: boolean }>(sql`
          select u.authenticator_version as version,u.two_factor_enabled as "twoFactorEnabled",
            u.email_verified and not u.phishing_resistant_required
              and not exists(select 1 from account a where a.user_id=u.id and a.provider_id='credential' and a.password is not null)
              and not exists(select 1 from account_deletion_operations d where d.user_id=u.id)
              and s.expires_at>clock_timestamp() as eligible
          from "user" u join "session" s on s.user_id=u.id
          where u.id=${user.id} and s.id=${session.id}
            and (s.authenticator_version is null or s.authenticator_version=u.authenticator_version)
          for share of u,s nowait`);
        if (!current?.eligible || operatorUserIds.includes(user.id))
          throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "A supported recent sign-in method is unavailable" });
        const authority = await currentSsoBinding(user.id);
        if (!authority)
          throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "A current qualified company sign-in is unavailable" });
        const challengeId = randomUUID();
        const createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
        const value = JSON.stringify({
          challengeId, purpose: "account-deletion", protocol: authority.policy.configuration.protocol,
          state: "created", userId: user.id,
          sourceSessionId: session.id, sourceSessionExpiresAt: null,
          authenticatorVersion: current.version, providerId: authority.policy.providerId,
          policyId: authority.policy.id, policyVersion: authority.policy.version, policyRevision: authority.revision,
          companyId: authority.binding.companyId, bindingId: authority.binding.id, issuer: authority.binding.issuer,
          subject: authority.binding.subject, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
          authorizationState: null, idTokenNonce: null, samlRequestId: null, samlAssertionId: null,
          samlIssuer: null, samlSubject: null, samlAuthnInstant: null, samlRecipient: null, samlNotOnOrAfter: null, samlBinding: null,
          authTime: null, callbackSessionId: null, proofSessionId: null,
          nativeFactorSessionId: null, nativeFactorAuthenticatorVersion: null,
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
      accountDeletionSsoFactorComplete: createAuthEndpoint("/account-deletion/sso/factor-complete", {
        method: "POST", use: [sessionMiddleware], body: z.object({}).strict(),
      }, async ctx => {
        const { user, session } = ctx.context.session;
        if (ctx.getHeader("X-Blentera-Expected-User") !== user.id ||
          ctx.getHeader("X-Blentera-Expected-Session") !== session.id)
          throw new APIError("CONFLICT", { code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue" });
        const completed = await db.transaction(async tx => {
          const [owner] = await tx.execute<{ authenticatorVersion: number }>(sql`
            select authenticator_version as "authenticatorVersion" from "user" where id=${user.id}
              and two_factor_enabled and not phishing_resistant_required
              and not exists(select 1 from account a where a.user_id=${user.id} and a.provider_id='credential' and a.password is not null)
              and not exists(select 1 from account_deletion_operations where user_id=${user.id})
            for share nowait`);
          if (!owner || operatorUserIds.includes(user.id))
            throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "A supported recent sign-in method is unavailable" });
          const [row] = await tx.select().from(authVerifications)
            .where(eq(authVerifications.identifier, reauthIdentifier(user.id))).limit(1).for("update");
          const challenge = row ? parseAccountDeletionSsoChallenge(row.value) : null;
          if (!row || !challenge || challenge.userId !== user.id || challenge.state !== "ready" ||
            challenge.nativeFactorSessionId !== session.id || challenge.callbackSessionId === null ||
            challenge.proofSessionId !== session.id || challenge.callbackSessionId === session.id ||
            challenge.nativeFactorAuthenticatorVersion !== owner.authenticatorVersion ||
            !Number.isSafeInteger(challenge.authTime) || !challenge.sourceSessionExpiresAt ||
            !Number.isFinite(Date.parse(challenge.sourceSessionExpiresAt)) ||
            challenge.nativeFactorAuthenticatorVersion !== challenge.authenticatorVersion &&
              challenge.nativeFactorAuthenticatorVersion !== challenge.authenticatorVersion + 1)
            throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
          const authority = await currentSsoBinding(user.id);
          if (!authority || challenge.protocol !== authority.policy.configuration.protocol ||
            authority.policy.id !== challenge.policyId || authority.policy.version !== challenge.policyVersion ||
            authority.policy.providerId !== challenge.providerId || authority.revision !== challenge.policyRevision ||
            authority.binding.id !== challenge.bindingId || authority.binding.issuer !== challenge.issuer ||
            authority.binding.subject !== challenge.subject)
            throw new APIError("CONFLICT", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "Company sign-in policy changed; start again" });
          const sessions = await tx.execute<{ id: string; expiresAt: Date | string }>(sql`
            select s.id,s.expires_at as "expiresAt" from "session" s join "user" u on u.id=s.user_id
            where s.id in (${challenge.sourceSessionId},${session.id}) and s.user_id=${user.id}
              and u.authenticator_version=${challenge.nativeFactorAuthenticatorVersion}
              and ((s.id=${challenge.sourceSessionId} and
                    ${challenge.nativeFactorAuthenticatorVersion === challenge.authenticatorVersion
                      ? sql`(s.authenticator_version is null or s.authenticator_version=${challenge.authenticatorVersion})`
                      : sql`false`})
                or (s.id=${session.id} and
                    (s.authenticator_version is null or s.authenticator_version=${challenge.nativeFactorAuthenticatorVersion})))
              and s.expires_at>clock_timestamp()
              and not exists(select 1 from "session" old where old.id=${challenge.callbackSessionId} and old.user_id=u.id)
              and ${challenge.nativeFactorAuthenticatorVersion === challenge.authenticatorVersion
                ? sql`exists(select 1 from "session" source where source.id=${challenge.sourceSessionId} and source.user_id=u.id
                    and source.expires_at>clock_timestamp())`
                : sql`not exists(select 1 from "session" source where source.id=${challenge.sourceSessionId} and source.user_id=u.id)`}
            for share of s,u nowait`);
          const active = new Set(sessions.map(item => item.id));
          const sameGeneration = challenge.nativeFactorAuthenticatorVersion === challenge.authenticatorVersion;
          if (active.size !== (sameGeneration ? 2 : 1) || !active.has(session.id) ||
            sameGeneration && !active.has(challenge.sourceSessionId))
            throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "Authenticate again to continue" });
          const factorProof = await assertHumanAuthentication(tx, {
            type: "board", source: "session", userId: user.id, sessionId: session.id,
            authenticatedCredentialExpiresAt: session.expiresAt.getTime(),
          }, { requireRecent: true, phishingResistant: false });
          const [fresh] = await tx.execute<{ valid: boolean }>(sql`
            select ${challenge.authTime!}::double precision between
                (extract(epoch from clock_timestamp())-299)*1000 and (extract(epoch from clock_timestamp())+5000)*1000
              and ${new Date(authority.policy.qualification!.expiresAt!).toISOString()}::timestamptz>clock_timestamp()+interval '1 second'
              and ${new Date(challenge.expiresAt).toISOString()}::timestamptz>clock_timestamp()+interval '1 second'
              and ${new Date(row.expiresAt).toISOString()}::timestamptz>clock_timestamp()+interval '1 second'
              and ${new Date(challenge.sourceSessionExpiresAt).toISOString()}::timestamptz>clock_timestamp()+interval '1 second'
              and ${new Date(sessions.find(item => item.id === session.id)!.expiresAt).toISOString()}::timestamptz>clock_timestamp()+interval '1 second'
              as valid`);
          if (!fresh?.valid) throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "Authenticate again to continue" });
          challenge.nativeFactorSessionId = session.id;
          challenge.proofSessionId = session.id;
          await tx.update(authVerifications).set({ value: JSON.stringify(challenge), updatedAt: new Date() })
            .where(and(eq(authVerifications.id, row.id), eq(authVerifications.identifier, reauthIdentifier(user.id))));
          await assertPinnedAuthenticationDeadline(tx, factorProof);
          return challenge.challengeId;
        });
        ctx.setHeader("Cache-Control", "no-store");
        return ctx.json({ userId: user.id, sessionId: session.id, challengeId: completed, ready: true });
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
                const authority = await currentSsoBinding(active.user.id);
                if (!authority || authority.policy.providerId !== policy.providerId ||
                  challenge.protocol !== policy.configuration.protocol ||
                  challenge.policyRevision !== authority.revision || challenge.bindingId !== authority.binding.id)
                  throw new APIError("CONFLICT", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "Company sign-in policy changed; start again" });
                if (challenge.protocol === "oidc") {
                  input.additionalParams = { ...(input.additionalParams ?? {}), prompt: "login", max_age: "0" };
                } else {
                  const started = await db.transaction(async tx => {
                    const [locked] = await tx.select().from(authVerifications)
                      .where(and(eq(authVerifications.id, row!.id), eq(authVerifications.identifier, reauthIdentifier(active.user.id))))
                      .limit(1).for("update");
                    const currentChallenge = locked ? parseAccountDeletionSsoChallenge(locked.value) : null;
                    if (!currentChallenge || currentChallenge.challengeId !== challengeId ||
                      currentChallenge.protocol !== "saml" || currentChallenge.state !== "created" ||
                      currentChallenge.sourceSessionId !== active.session.id ||
                      Date.parse(currentChallenge.expiresAt) <= Date.now())
                      throw new APIError("CONFLICT", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
                    currentChallenge.state = "authorization_started";
                    await tx.update(authVerifications).set({ value: JSON.stringify(currentChallenge), updatedAt: new Date() })
                      .where(eq(authVerifications.id, locked!.id));
                    return currentChallenge;
                  });
                  (ctx.context as typeof ctx.context & { accountDeletionSamlChallenge?: Record<string, string> }).accountDeletionSamlChallenge = {
                    purpose: "account-deletion", challengeId: started.challengeId, userId: active.user.id,
                    sourceSessionId: active.session.id, providerId: policy.providerId,
                    createdAt: started.createdAt, expiresAt: started.expiresAt,
                  };
                }
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
            if (!active)
              throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The provider did not start a fresh sign-in" });
            const [row] = await db.select().from(authVerifications)
              .where(eq(authVerifications.identifier, reauthIdentifier(active.user.id))).limit(1);
            if (!row) throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
            const challenge = parseAccountDeletionSsoChallenge(row.value);
            if (!challenge) {
              throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
            }
            if (challenge.challengeId !== challengeId || challenge.sourceSessionId !== active.session.id ||
              challenge.state !== (challenge.protocol === "saml" ? "authorization_started" : "created"))
              throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The sign-in confirmation expired; start again" });
            if (challenge.protocol === "saml") return;
            if (!state || !nonce || nonce.length < 16 || authorization?.searchParams.get("prompt") !== "login" ||
              authorization.searchParams.get("max_age") !== "0")
              throw new APIError("FORBIDDEN", { code: "ACCOUNT_DELETION_SSO_REAUTH_UNAVAILABLE", message: "The provider did not start a fresh sign-in" });
            challenge.authorizationState = state;
            challenge.idTokenNonce = nonce;
            challenge.state = "authorization_started";
            await db.update(authVerifications).set({ value: JSON.stringify(challenge), updatedAt: new Date() })
              .where(and(eq(authVerifications.id, row.id), eq(authVerifications.identifier, reauthIdentifier(active.user.id))));
          }),
        },
        {
          matcher: (ctx) => ctx.path?.startsWith("/sso/callback/") === true ||
            ctx.path?.startsWith("/sso/saml2/sp/acs/") === true,
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created) return;
            const callbackState = typeof ctx.query?.state === "string" ? ctx.query.state : null;
            const callbackProviderId = (ctx.params as { providerId?: string }).providerId;
            const samlAuthentication = (ctx.context as typeof ctx.context & {
              accountDeletionSamlAuthentication?: {
                purpose: "account-deletion"; challengeId: string; userId: string; sourceSessionId: string;
                providerId: string; requestId: string; assertionId: string; issuer: string; subject: string;
                authnInstant: string; recipient: string; notOnOrAfter: string; binding: "post";
              };
            }).accountDeletionSamlAuthentication;
            const ready = await db.transaction(async tx => {
              const [currentUser] = await tx.select({ authenticatorVersion: authUsers.authenticatorVersion })
                .from(authUsers).where(eq(authUsers.id, created.user.id)).limit(1).for("share");
              if (!currentUser) return "invalid" as const;
              const [row] = await tx.select().from(authVerifications)
                .where(eq(authVerifications.identifier, reauthIdentifier(created.user.id)))
                .limit(1).for("update");
              if (!row) return "none" as const;
              const challenge = parseAccountDeletionSsoChallenge(row.value);
              if (!challenge || challenge.state !== "callback_verified") return "none" as const;
              const authTime = challenge.authTime;
              const matchingSaml = challenge.protocol === "saml" && samlAuthentication &&
                samlAuthentication.purpose === "account-deletion" &&
                samlAuthentication.challengeId === challenge.challengeId && samlAuthentication.userId === challenge.userId &&
                samlAuthentication.sourceSessionId === challenge.sourceSessionId && samlAuthentication.providerId === challenge.providerId &&
                samlAuthentication.requestId === challenge.samlRequestId && samlAuthentication.assertionId === challenge.samlAssertionId &&
                samlAuthentication.issuer === challenge.samlIssuer && samlAuthentication.subject === challenge.samlSubject &&
                samlAuthentication.authnInstant === challenge.samlAuthnInstant && samlAuthentication.recipient === challenge.samlRecipient &&
                samlAuthentication.notOnOrAfter === challenge.samlNotOnOrAfter &&
                samlAuthentication.binding === challenge.samlBinding && samlAuthentication.binding === "post";
              const matchingState = Boolean((challenge.protocol === "oidc"
                ? callbackState && callbackState === challenge.authorizationState
                : matchingSaml) &&
                challenge.userId === created.user.id && challenge.providerId === callbackProviderId &&
                challenge.callbackSessionId === null && challenge.nativeFactorSessionId === null &&
                challenge.proofSessionId === null && challenge.sourceSessionId !== created.session.id &&
                Number.isSafeInteger(authTime));
              if (!matchingState) return "invalid" as const;
              const sessions = await tx.execute<{ id: string }>(sql`
                select s.id from "session" s join "user" u on u.id=s.user_id
                where s.id in (${challenge.sourceSessionId},${created.session.id}) and s.user_id=${created.user.id}
                  and u.authenticator_version=${challenge.authenticatorVersion}
                  and (s.authenticator_version is null or s.authenticator_version=u.authenticator_version)
                  and s.expires_at>clock_timestamp()
                for share of s,u nowait`);
              const validRows = await tx.execute<{ valid: boolean }>(sql`
                select exists(select 1 from ${authVerifications}
                    where ${authVerifications.id}=${row.id}
                      and ${authVerifications.expiresAt}>clock_timestamp())
                  and ${challenge.expiresAt}::timestamptz>clock_timestamp()
                  and to_timestamp(${authTime!}::double precision / 1000.0)
                    between clock_timestamp()-interval '5 minutes' and clock_timestamp()+interval '5 seconds'
                  as valid`);
              if (new Set(sessions.map(session => session.id)).size !== 2 || !validRows[0]?.valid)
                return "invalid" as const;
              challenge.state = "ready";
              challenge.callbackSessionId = created.session.id;
              challenge.proofSessionId = created.session.id;
              await tx.update(authVerifications).set({ value: JSON.stringify(challenge), updatedAt: new Date() })
                .where(and(eq(authVerifications.id, row.id), eq(authVerifications.identifier, reauthIdentifier(created.user.id))));
              return "ready" as const;
            });
            if (ready === "invalid") {
              deleteSessionCookie(ctx);
              ctx.context.setNewSession(null);
              await ctx.context.internalAdapter.deleteSession(created.session.token);
              throw new APIError("UNAUTHORIZED", { code: "ACCOUNT_DELETION_SSO_REAUTH_INVALID", message: "The sign-in confirmation could not be verified" });
            }
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
