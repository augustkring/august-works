import { X509Certificate } from "node:crypto";
import { sso } from "@better-auth/sso";
import { scim } from "@better-auth/scim";
import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import {
  enterpriseIdentityPolicies,
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
export function enterpriseAuthPlugins(
  db: Db,
  sourceSha: string,
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
  const bridge = enterpriseIdentityBridge({
    sourceSha,
    enabled,
    signingKeyCurrent,
  });
  const gate: BetterAuthPlugin = {
    id: "aw-enterprise-feature-gate",
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
