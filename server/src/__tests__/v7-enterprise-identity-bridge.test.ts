import { describe, it, expect, vi } from "vitest";
import { enterpriseIdentityBridge } from "../auth/enterprise-identity-bridge.js";
import type { DBTransactionAdapter } from "@better-auth/core/db/adapter";
const company = "11111111-1111-4111-8111-111111111111",
  providerId = "aw-enterprise-test";
const policy = {
  id: "policy",
  companyId: company,
  providerId,
  scimConnectionId: "aw-scim-test",
  issuer: "https://idp.test.invalid",
  status: "qualified",
  configuration: { protocol: "oidc" },
  qualification: {
    sourceRevision: "a".repeat(40),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
  scimTokenHash: null,
  scimCredentialId: null,
  scimExpiresAt: null,
};
const binding = {
  id: "binding",
  companyId: company,
  providerId,
  issuer: policy.issuer,
  subject: "signed-subject",
  userId: "native-user",
  status: "active",
  managedMembership: true,
};
const membership = {
  id: "22222222-2222-4222-8222-222222222222",
  companyId: company,
  principalType: "user",
  principalId: binding.userId,
  membershipRole: "viewer",
  status: "active",
};
function setup(
  options: {
    enabled?: boolean;
    binding?: boolean;
    membership?: typeof membership;
    policy?: typeof policy;
  } = {},
) {
  const rows = {
    awEnterprisePolicy: [options.policy ?? policy],
    awEnterpriseBinding: options.binding === false ? [] : [binding],
    awCompanyMembership: [options.membership ?? membership],
    user: [{ id: binding.userId, emailVerified: true }],
  };
  const database = {
    findOne: vi.fn(
      async ({
        model,
        where,
      }: {
        model: keyof typeof rows;
        where: Array<{ field: string; value: unknown }>;
      }) =>
        rows[model]?.find((row) =>
          where.every(
            (w) =>
              (row as unknown as Record<string, unknown>)[w.field] === w.value,
          ),
        ) ?? null,
    ),
    update: vi.fn(async () => membership),
    deleteMany: vi.fn(async () => 0),
    create: vi.fn(async () => ({ id: "audit" })),
  };
  const bridge = enterpriseIdentityBridge({
    sourceSha: "a".repeat(40),
    enabled: async () => options.enabled ?? true,
    signingKeyCurrent: async () => true,
  });
  return {
    database,
    bridge,
    context: { database: database as unknown as DBTransactionAdapter },
  };
}
const input = {
  protocol: "oidc" as const,
  providerId,
  accountKey: { issuer: policy.issuer, accountId: binding.subject },
  providerUser: {
    email: "attacker-chosen-email@test.invalid",
    emailVerified: true,
    name: "Provider name",
  },
  providerReference: {
    providerId,
    source: { type: "persisted" as const, recordId: "provider" },
    authenticationConfigurationFingerprint: "opaque-transient-fence",
  },
  providerClaims: { sub: "untrusted-userinfo-sub" },
  verifiedIdTokenClaims: { iss: policy.issuer, sub: binding.subject },
};
describe("enterprise identity native projection boundaries", () => {
  it("links only an explicit signed issuer/subject mapping and preserves the native profile", async () => {
    const f = setup();
    expect(await f.bridge.resolveUser(input, f.context)).toEqual({
      action: "link",
      userId: binding.userId,
      profile: "preserve",
    });
    expect(f.database.update).not.toHaveBeenCalled();
    expect(f.database.create).not.toHaveBeenCalled();
  });
  it("cannot substitute an email, UserInfo subject or different issuer for the signed identity", async () => {
    const f = setup();
    expect(
      await f.bridge.resolveUser(
        {
          ...input,
          accountKey: {
            issuer: policy.issuer,
            accountId: "untrusted-userinfo-sub",
          },
        },
        f.context,
      ),
    ).toMatchObject({ action: "reject" });
    expect(
      await f.bridge.resolveUser(
        {
          ...input,
          accountKey: {
            issuer: "https://foreign-idp.test.invalid",
            accountId: binding.subject,
          },
        },
        f.context,
      ),
    ).toMatchObject({ action: "reject" });
    const noBinding = setup({ binding: false });
    expect(
      await noBinding.bridge.resolveUser(input, noBinding.context),
    ).toMatchObject({ action: "reject" });
  });
  it("closes expired, invalid, disabled or suspended native authority", async () => {
    for (const expiresAt of [
      "not-a-date",
      new Date(Date.now() - 1).toISOString(),
    ]) {
      const f = setup({
        policy: {
          ...policy,
          qualification: { ...policy.qualification, expiresAt },
        },
      });
      await expect(f.bridge.resolveUser(input, f.context)).rejects.toThrow();
    }
    const off = setup({ enabled: false });
    await expect(off.bridge.resolveUser(input, off.context)).rejects.toThrow();
    const inactive = setup({
      membership: { ...membership, status: "suspended" },
    });
    expect(
      await inactive.bridge.resolveUser(input, inactive.context),
    ).toMatchObject({ action: "reject" });
  });
  it("SCIM deprovisions only the approved company membership and grants, never global identity or another company", async () => {
    const f = setup();
    await f.bridge.projection.reconcileUser(
      {
        provisioningDomainId: company,
        userId: binding.userId,
        active: false,
        sources: [],
        grants: [],
      },
      f.context,
    );
    expect(f.database.update).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "awCompanyMembership",
        where: expect.arrayContaining([{ field: "companyId", value: company }]),
        update: expect.objectContaining({ status: "suspended" }),
      }),
    );
    expect(f.database.deleteMany).toHaveBeenCalledWith({
      model: "awPermissionGrant",
      where: expect.arrayContaining([
        { field: "companyId", value: company },
        { field: "principalId", value: binding.userId },
      ]),
    });
    expect(f.database.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "awActivity",
        data: expect.objectContaining({ actorType: "system" }),
      }),
    );
  });
  it("SCIM groups cannot elevate permissions, and foreign sources or owner lifecycle are denied", async () => {
    const f = setup();
    expect(f.bridge.projection.roles).toBeUndefined();
    await expect(
      f.bridge.projection.reconcileUser(
        {
          provisioningDomainId: company,
          userId: binding.userId,
          active: true,
          sources: [
            {
              id: "foreign",
              connectionId: "foreign",
              provisioningDomainId: company,
              active: true,
            },
          ],
          grants: [
            {
              source: {
                type: "group",
                id: "admin-group",
                displayName: "Administrators",
              },
              role: "owner",
            },
          ],
        },
        f.context,
      ),
    ).rejects.toThrow();
    expect(f.database.update).not.toHaveBeenCalled();
    const owner = setup({
      membership: { ...membership, membershipRole: "owner" },
    });
    await expect(
      owner.bridge.projection.reconcileUser(
        {
          provisioningDomainId: company,
          userId: binding.userId,
          active: false,
          sources: [],
          grants: [],
        },
        owner.context,
      ),
    ).rejects.toThrow();
  });
});
