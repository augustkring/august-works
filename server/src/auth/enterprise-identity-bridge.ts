import { randomUUID, createHash } from "node:crypto";
import { APIError, type BetterAuthPlugin } from "better-auth";
import type { DBTransactionAdapter } from "@better-auth/core/db/adapter";
import type { DBFieldAttribute } from "@better-auth/core/db";
import type { SSOOptions } from "@better-auth/sso";
import type { SCIMOptions } from "@better-auth/scim";
import type { EnterpriseIdentityConfiguration } from "@paperclipai/shared";

type NativePolicy = {
  id: string;
  companyId: string;
  providerId: string;
  scimConnectionId: string | null;
  issuer: string;
  status: string;
  configuration: EnterpriseIdentityConfiguration;
  qualification: {
    sourceRevision: string;
    expiresAt: string;
    signingKey: {
      secretId: string;
      version: number;
      valueSha256: string;
    } | null;
  } | null;
  scimTokenHash: string | null;
  scimCredentialId: string | null;
  scimExpiresAt: Date | null;
};
type NativeBinding = {
  id: string;
  companyId: string;
  providerId: string;
  issuer: string;
  subject: string;
  userId: string;
  status: string;
  managedMembership: boolean;
};
type NativeMembership = {
  id: string;
  companyId: string;
  principalId: string;
  principalType: string;
  status: string;
  membershipRole: string | null;
};
const where = (fields: Record<string, string>) =>
  Object.entries(fields).map(([field, value]) => ({ field, value }));
export interface EnterpriseIdentityBridgeOptions {
  sourceSha: string;
  enabled(): Promise<boolean>;
  signingKeyCurrent(policy: NativePolicy): Promise<boolean>;
}

/** Used only inside the framework's supplied native transaction. No email-match
 * linking, implicit JIT, direct IdP group grants or global deprovisioning. */
export function enterpriseIdentityBridge(
  options: EnterpriseIdentityBridgeOptions,
) {
  async function qualified(
    database: Pick<DBTransactionAdapter, "findOne">,
    providerId: string,
  ) {
    if (!(await options.enabled()))
      throw new APIError("FORBIDDEN", {
        message: "Enterprise identity is disabled",
      });
    const policy = await database.findOne<NativePolicy>({
      model: "awEnterprisePolicy",
      where: where({ providerId }),
    });
    if (
      !policy ||
      policy.status !== "qualified" ||
      policy.qualification?.sourceRevision !== options.sourceSha ||
      !Number.isFinite(new Date(policy.qualification.expiresAt).getTime()) ||
      new Date(policy.qualification.expiresAt).getTime() <= Date.now() ||
      !(await options.signingKeyCurrent(policy))
    )
      throw new APIError("FORBIDDEN", {
        message: "Current identity qualification is required",
      });
    return policy;
  }
  const resolveUser: NonNullable<SSOOptions["resolveUser"]> = async (
    input,
    context,
  ) => {
    const policy = await qualified(context.database, input.providerId);
    if (
      input.accountKey.issuer !== policy.issuer ||
      input.protocol !== policy.configuration.protocol
    )
      return {
        action: "reject",
        code: "ENTERPRISE_IDENTITY_NAMESPACE_CHANGED",
      };
    const binding = await context.database.findOne<NativeBinding>({
      model: "awEnterpriseBinding",
      where: where({
        companyId: policy.companyId,
        providerId: policy.providerId,
        issuer: input.accountKey.issuer,
        subject: input.accountKey.accountId,
        status: "active",
      }),
    });
    if (!binding)
      return {
        action: "reject",
        code: "ENTERPRISE_EXPLICIT_SUBJECT_BINDING_REQUIRED",
      };
    const membership = await context.database.findOne<NativeMembership>({
      model: "awCompanyMembership",
      where: where({
        companyId: policy.companyId,
        principalType: "user",
        principalId: binding.userId,
        status: "active",
      }),
    });
    if (!membership)
      return { action: "reject", code: "ENTERPRISE_MEMBERSHIP_INACTIVE" };
    const user = await context.database.findOne<{ emailVerified: boolean }>({
      model: "user",
      where: where({ id: binding.userId }),
    });
    if (!user?.emailVerified)
      return {
        action: "reject",
        code: "ENTERPRISE_NATIVE_USER_VERIFICATION_REQUIRED",
      };
    return { action: "link", userId: binding.userId, profile: "preserve" };
  };
  const authentication: NonNullable<SCIMOptions["authentication"]> = {
    verifyBearerToken: async (input, context) => {
      if (
        !(await options.enabled()) ||
        input.token.length < 32 ||
        input.token.length > 256
      )
        return null;
      const digest = createHash("sha256").update(input.token).digest("hex");
      const policy = await context.database.findOne<NativePolicy>({
        model: "awEnterprisePolicy",
        where: where({ scimTokenHash: digest, status: "qualified" }),
      });
      if (
        !policy?.scimConnectionId ||
        !policy.scimCredentialId ||
        !policy.scimExpiresAt ||
        !Number.isFinite(new Date(policy.scimExpiresAt).getTime()) ||
        new Date(policy.scimExpiresAt).getTime() <= Date.now() ||
        policy.qualification?.sourceRevision !== options.sourceSha ||
        !Number.isFinite(new Date(policy.qualification.expiresAt).getTime()) ||
        new Date(policy.qualification.expiresAt).getTime() <= Date.now() ||
        !(await options.signingKeyCurrent(policy))
      )
        return null;
      return {
        connection: {
          id: policy.scimConnectionId,
          provisioningDomainId: policy.companyId,
        },
        credentialId: policy.scimCredentialId,
        expiresAt: new Date(policy.scimExpiresAt),
        scopes: [
          "scim.users.read",
          "scim.users.write",
          "scim.groups.read",
          "scim.groups.write",
        ],
      };
    },
  };
  const identity: NonNullable<SCIMOptions["identity"]> = {
    // Native membership projection owns company deprovisioning. A linked
    // identity can still have valid memberships outside the SCIM domain.
    // The pinned SCIM patch defers global session revocation to this callback.
    reconcileUser: async () => {},
    resolveUser: async (input, context) => {
      const policy = await context.database.findOne<NativePolicy>({
        model: "awEnterprisePolicy",
        where: where({
          companyId: input.provisioningDomainId,
          scimConnectionId: input.connectionId,
        }),
      });
      if (!policy || !input.resource.externalId)
        throw new APIError("FORBIDDEN", {
          message: "An explicit stable enterprise subject binding is required",
        });
      await qualified(context.database, policy.providerId);
      const binding = await context.database.findOne<NativeBinding>({
        model: "awEnterpriseBinding",
        where: where({
          companyId: policy.companyId,
          providerId: policy.providerId,
          issuer: policy.issuer,
          subject: input.resource.externalId,
          status: "active",
        }),
      });
      if (!binding || !binding.managedMembership)
        throw new APIError("FORBIDDEN", {
          message: "Company-approved SCIM lifecycle mapping is required",
        });
      return { action: "link", userId: binding.userId, profile: "preserve" };
    },
  };
  const projection: NonNullable<SCIMOptions["projection"]> = {
    reconcileUser: async (input, context) => {
      const policy = await context.database.findOne<NativePolicy>({
        model: "awEnterprisePolicy",
        where: where({ companyId: input.provisioningDomainId }),
      });
      if (!policy)
        throw new APIError("FORBIDDEN", {
          message: "Native enterprise company policy is missing",
        });
      await qualified(context.database, policy.providerId);
      if (
        input.sources.some(
          (source) =>
            source.connectionId !== policy.scimConnectionId ||
            source.provisioningDomainId !== policy.companyId,
        )
      )
        throw new APIError("FORBIDDEN", {
          message: "Foreign SCIM authority cannot change this company",
        });
      const binding = await context.database.findOne<NativeBinding>({
        model: "awEnterpriseBinding",
        where: where({
          companyId: policy.companyId,
          providerId: policy.providerId,
          issuer: policy.issuer,
          userId: input.userId,
          status: "active",
        }),
      });
      if (!binding?.managedMembership)
        throw new APIError("FORBIDDEN", {
          message: "Explicit native lifecycle authority is required",
        });
      const membership = await context.database.findOne<NativeMembership>({
        model: "awCompanyMembership",
        where: where({
          companyId: policy.companyId,
          principalType: "user",
          principalId: input.userId,
        }),
      });
      if (!membership || membership.membershipRole === "owner")
        throw new APIError("FORBIDDEN", {
          message: "SCIM cannot create membership or manage company owners",
        });
      const status = input.active ? "active" : "suspended";
      if (membership.status === status) return;
      await context.database.update({
        model: "awCompanyMembership",
        where: where({ id: membership.id, companyId: policy.companyId }),
        update: { status, updatedAt: new Date() },
      });
      // Disable company-scoped grants, not the global identity or other companies.
      if (!input.active)
        await context.database.deleteMany({
          model: "awPermissionGrant",
          where: where({
            companyId: policy.companyId,
            principalType: "user",
            principalId: input.userId,
          }),
        });
      await context.database.create({
        model: "awActivity",
        forceAllowId: true,
        data: {
          id: randomUUID(),
          companyId: policy.companyId,
          actorType: "system",
          actorId: "enterprise-scim",
          action: "enterprise.membership_lifecycle_changed",
          entityType: "company_membership",
          entityId: membership.id,
          details: { status, policyId: policy.id },
          createdAt: new Date(),
        },
      });
    },
  };
  return { resolveUser, authentication, identity, projection, qualified };
}
const fields = (
  types: Record<string, DBFieldAttribute["type"]>,
): Record<string, DBFieldAttribute> =>
  Object.fromEntries(
    Object.entries(types).map(([key, type]) => [
      key,
      { type, required: false },
    ]),
  );
/** Exposes existing canonical tables to Better Auth's transaction adapter. */
export const enterpriseAuthoritySchemaPlugin: BetterAuthPlugin = {
  id: "aw-enterprise-authority",
  schema: {
    awEnterprisePolicy: {
      fields: fields({
        companyId: "string",
        providerId: "string",
        scimConnectionId: "string",
        issuer: "string",
        status: "string",
        configuration: "json",
        qualification: "json",
        scimTokenHash: "string",
        scimCredentialId: "string",
        scimExpiresAt: "date",
      }),
    },
    awEnterpriseBinding: {
      fields: fields({
        companyId: "string",
        providerId: "string",
        issuer: "string",
        subject: "string",
        userId: "string",
        status: "string",
        managedMembership: "boolean",
      }),
    },
    awCompanyMembership: {
      fields: fields({
        companyId: "string",
        principalId: "string",
        principalType: "string",
        status: "string",
        membershipRole: "string",
        updatedAt: "date",
      }),
    },
    awPermissionGrant: {
      fields: fields({
        companyId: "string",
        principalId: "string",
        principalType: "string",
      }),
    },
    awActivity: {
      fields: fields({
        companyId: "string",
        actorType: "string",
        actorId: "string",
        action: "string",
        entityType: "string",
        entityId: "string",
        details: "json",
        createdAt: "date",
      }),
    },
  },
};
