import { secretService } from "../secrets.js";
import {
  randomUUID,
  randomBytes,
  createHash,
  X509Certificate,
  createPrivateKey,
} from "node:crypto";
import { and, eq, sql, isNull } from "drizzle-orm";
import {
  authUsers,
  companyMemberships,
  companySecrets,
  companySecretVersions,
  scimConnectionBinding,
  scimUser,
  scimGroup,
  scimIdentityTombstone,
  enterpriseIdentityPolicies,
  enterpriseSubjectBindings,
  ssoProvider,
  type Db,
} from "@paperclipai/db";
import {
  enterpriseIdentityPolicySchema,
  enterpriseSubjectBindingSchema,
  type EnterpriseIdentityPolicyView,
} from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import {
  assertV7Authorization,
  assertV7Enabled,
  v7HumanActorId,
} from "../v7-authorization.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
type Policy = typeof enterpriseIdentityPolicies.$inferSelect;
export interface EnterprisePublisherOptions {
  operatorUserIds: readonly string[];
  sourceSha: string;
  protectedEvidenceOrigin: string;
  appOrigin: string;
}
export const enterprisePolicyHash = (
  row: Pick<
    Policy,
    | "configuration"
    | "operatingEnvelope"
    | "providerId"
    | "companyId"
    | "issuer"
    | "scimConnectionId"
    | "version"
  >,
) =>
  nativeSha256({
    configuration: row.configuration,
    operatingEnvelope: row.operatingEnvelope,
    providerId: row.providerId,
    companyId: row.companyId,
    issuer: row.issuer,
    scimConnectionId: row.scimConnectionId,
    version: row.version,
  });
function view(row: Policy): EnterpriseIdentityPolicyView {
  return {
    id: row.id,
    companyId: row.companyId,
    providerId: row.providerId,
    version: row.version,
    configurationHash: enterprisePolicyHash(row),
    status: row.status,
    configuration: row.configuration,
    operatingEnvelope: row.operatingEnvelope,
    scimConfigured: Boolean(row.scimTokenHash && row.scimConnectionId),
    scimRequired: Boolean(row.scimConnectionId),
    scimCredentialId: row.scimCredentialId,
    scimCredentialExpiresAt: row.scimExpiresAt?.toISOString() ?? null,
    qualification: row.qualification,
  };
}
export function enterpriseIdentityPolicyService(
  db: Db,
  options: EnterprisePublisherOptions,
) {
  async function owner(tx: Db, actor: AuthorizationActor, companyId: string) {
    const userId = v7HumanActorId(actor);
    await assertV7Authorization(
      tx,
      actor,
      companyId,
      "users:manage_permissions",
    );
    const [member] = await tx
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
          eq(companyMemberships.membershipRole, "owner"),
        ),
      )
      .for("share");
    if (!member)
      throw forbidden("Active company owner policy authority is required");
    return userId;
  }
  async function enabled(tx: Db) {
    await tx.execute(
      sql`select id from instance_settings where singleton_key='default' for share`,
    );
    await assertV7Enabled(tx, "enterprise_identity_v7");
  }
  async function signingKey(
    tx: Db,
    row: Pick<Policy, "companyId" | "configuration">,
  ) {
    if (row.configuration.protocol !== "oidc") return null;
    const c = row.configuration;
    const [key] = await tx
      .select({
        secretId: companySecrets.id,
        version: companySecretVersions.version,
        valueSha256: companySecretVersions.valueSha256,
      })
      .from(companySecrets)
      .innerJoin(
        companySecretVersions,
        and(
          eq(companySecretVersions.secretId, companySecrets.id),
          eq(companySecretVersions.version, c.privateKeySecretVersion),
        ),
      )
      .where(
        and(
          eq(companySecrets.id, c.privateKeySecretId),
          eq(companySecrets.companyId, row.companyId),
          eq(companySecrets.scope, "company"),
          eq(companySecrets.provider, "local_encrypted"),
          eq(companySecrets.status, "active"),
          eq(companySecrets.latestVersion, c.privateKeySecretVersion),
          eq(companySecretVersions.status, "current"),
          isNull(companySecrets.deletedAt),
          isNull(companySecretVersions.revokedAt),
        ),
      )
      .for("share");
    if (!key)
      throw conflict("Current native encrypted signing key version required");
    return key;
  }
  async function current(tx: Db, companyId: string, lock = false) {
    const q = tx
      .select()
      .from(enterpriseIdentityPolicies)
      .where(eq(enterpriseIdentityPolicies.companyId, companyId));
    const [row] = await (lock ? q.for("update") : q);
    if (!row) throw notFound("Enterprise identity policy not found");
    return row;
  }
  return {
    get: async (actor: AuthorizationActor, companyId: string) =>
      db.transaction(async (tx) => {
        const nativeDb = tx as unknown as Db;
        await owner(nativeDb, actor, companyId);
        return view(await current(nativeDb, companyId));
      }),
    configure: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: unknown,
    ) => {
      const input = enterpriseIdentityPolicySchema.parse(raw);
      await assertV7Enabled(db, "enterprise_identity_v7");
      return withV7ActivityTransaction(db, async (tx, p) => {
        await enabled(tx);
        const userId = await owner(tx, actor, companyId);
        await tx.execute(
          sql`select id from companies where id=${companyId}::uuid for update`,
        );
        const [old] = await tx
          .select()
          .from(enterpriseIdentityPolicies)
          .where(eq(enterpriseIdentityPolicies.companyId, companyId))
          .for("update");
        if (
          (old?.version ?? 0) !== input.expectedVersion ||
          old?.status === "retired"
        )
          throw conflict("Enterprise policy version changed");
        if (input.configuration.protocol === "oidc") {
          await signingKey(tx, {
            companyId,
            configuration: input.configuration,
          });
        } else {
          try {
            const certificate = new X509Certificate(
              input.configuration.certificate,
            );
            if (
              new Date(certificate.validTo) <= new Date() ||
              new Date(certificate.validFrom) > new Date()
            )
              throw new Error("Certificate validity interval");
          } catch {
            throw conflict(
              "A current X.509 IdP signing certificate is required",
            );
          }
        }
        if (
          input.operatingEnvelope.awProcessingRegions.some(
            (region) => region !== "dk-cph1" && region !== "europe-1",
          )
        )
          throw conflict(
            "The deployed architecture has not qualified the requested AW processing region",
          );
        if (old?.scimConnectionId && !input.scimRequired) {
          const [connection] = await tx
            .select()
            .from(scimConnectionBinding)
            .where(
              eq(scimConnectionBinding.connectionId, old.scimConnectionId),
            );
          if (connection)
            throw conflict(
              "Suspend SCIM and decommission its existing connection before removing the provisioning namespace",
            );
        }
        const data = {
          companyId,
          providerId: old?.providerId ?? `aw-enterprise-${companyId}`,
          scimConnectionId: input.scimRequired
            ? (old?.scimConnectionId ?? `aw-scim-${companyId}`)
            : null,
          issuer: input.configuration.issuer,
          configuration: input.configuration,
          operatingEnvelope: input.operatingEnvelope,
          version: (old?.version ?? 0) + 1,
          status: "draft",
          qualification: null,
          scimTokenHash: null,
          scimCredentialId: null,
          scimExpiresAt: null,
          updatedAt: new Date(),
        };
        const [row] = old
          ? await tx
              .update(enterpriseIdentityPolicies)
              .set(data)
              .where(eq(enterpriseIdentityPolicies.id, old.id))
              .returning()
          : await tx
              .insert(enterpriseIdentityPolicies)
              .values({ ...data, createdByUserId: userId })
              .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.identity_policy_configured",
            entityType: "enterprise_identity_policy",
            entityId: row!.id,
            details: {
              version: row!.version,
              configurationHash: enterprisePolicyHash(row!),
              reason: input.reason,
            },
          },
          p,
        );
        return view(row!);
      });
    },
    qualify: async (
      actor: AuthorizationActor,
      companyId: string,
      input: {
        expectedVersion: number;
        configurationHash: string;
        uri: string;
        sha256: string;
        expiresAt: string;
      },
    ) => {
      const userId = v7HumanActorId(actor);
      if (!options.operatorUserIds.includes(userId))
        throw forbidden("Configured platform identity qualifier required");
      const uri = new URL(input.uri),
        expiresAt = new Date(input.expiresAt);
      if (
        uri.origin !== new URL(options.protectedEvidenceOrigin).origin ||
        !uri.pathname.startsWith("/qualification/") ||
        uri.username ||
        uri.password ||
        uri.search ||
        uri.hash ||
        uri.protocol !== "https:" ||
        !/^[a-f0-9]{64}$/.test(input.sha256) ||
        !Number.isFinite(expiresAt.getTime()) ||
        expiresAt <= new Date() ||
        expiresAt.getTime() > Date.now() + 30 * 86400000
      )
        throw conflict(
          "Current protected identity qualification evidence is required",
        );
      return withV7ActivityTransaction(db, async (tx, p) => {
        await enabled(tx);
        const [operator] = await tx
          .select()
          .from(authUsers)
          .where(eq(authUsers.id, userId))
          .for("share");
        if (!operator?.emailVerified)
          throw forbidden("Verified native platform qualifier required");
        const row = await current(tx, companyId, true);
        if (
          row.version !== input.expectedVersion ||
          row.status === "retired" ||
          enterprisePolicyHash(row) !== input.configurationHash
        )
          throw conflict("Identity qualification baseline changed");
        const key = await signingKey(tx, row);
        if (key) {
          try {
            const value = await secretService(tx).resolveSecretValue(
              companyId,
              key.secretId,
              key.version,
              {
                accessContext: {
                  consumerType: "system",
                  consumerId: "enterprise-qualification",
                  actorType: "system",
                  actorId: "enterprise-qualification",
                },
              },
            );
            const parsed = createPrivateKey(value);
            if (
              parsed.asymmetricKeyType !== "rsa" ||
              (parsed.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
              createHash("sha256").update(value).digest("hex") !==
                key.valueSha256
            )
              throw Error("Signing key qualification");
          } catch {
            throw conflict(
              "Current RSA signing key of at least 2048 bits is required",
            );
          }
        }
        const c = row.configuration;
        // OIDC secrets remain in the native encrypted secret service, never provider JSON.
        const provider = {
          companyId,
          providerId: row.providerId,
          issuer: row.issuer,
          domain: c.domain,
          oidcConfig:
            c.protocol === "oidc"
              ? JSON.stringify({
                  issuer: c.issuer,
                  clientId: c.clientId,
                  pkce: true,
                  discoveryEndpoint: c.discoveryEndpoint,
                  tokenEndpointAuthentication: "private_key_jwt",
                  privateKeyId: c.privateKeySecretId,
                  privateKeyAlgorithm: "RS256",
                  scopes: ["openid", "email", "profile"],
                  allowIdpInitiated: false,
                })
              : null,
          samlConfig:
            c.protocol === "saml"
              ? JSON.stringify({
                  issuer:
                    options.appOrigin +
                    "/api/auth/sso/saml2/sp/metadata?providerId=" +
                    row.providerId,
                  entryPoint: c.entryPoint,
                  cert: c.certificate,
                  callbackUrl: options.appOrigin,
                  wantAssertionsSigned: true,
                  signatureAlgorithm: "sha256",
                  digestAlgorithm: "sha256",
                  idpMetadata: {
                    entityID: c.issuer,
                    cert: c.certificate,
                    singleSignOnService: [
                      {
                        Binding:
                          "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
                        Location: c.entryPoint,
                      },
                    ],
                  },
                })
              : null,
          userId,
          organizationId: null,
        };
        await tx
          .insert(ssoProvider)
          .values({ id: randomUUID(), ...provider })
          .onConflictDoUpdate({
            target: ssoProvider.providerId,
            set: provider,
          });
        const [updated] = await tx
          .update(enterpriseIdentityPolicies)
          .set({
            status: "qualified",
            qualification: {
              uri: input.uri,
              sha256: input.sha256,
              sourceRevision: options.sourceSha,
              qualifiedByUserId: userId,
              expiresAt: input.expiresAt,
              signingKey: key,
            },
            updatedAt: new Date(),
          })
          .where(eq(enterpriseIdentityPolicies.id, row.id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.identity_qualified",
            entityType: "enterprise_identity_policy",
            entityId: row.id,
            details: {
              version: row.version,
              configurationHash: input.configurationHash,
              evidenceHash: input.sha256,
            },
          },
          p,
        );
        return view(updated!);
      });
    },
    bind: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: unknown,
    ) => {
      const input = enterpriseSubjectBindingSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, p) => {
        await enabled(tx);
        const userId = await owner(tx, actor, companyId),
          policy = await current(tx, companyId, true);
        const [nativeUser] = await tx
          .select()
          .from(authUsers)
          .where(eq(authUsers.id, input.userId))
          .for("share");
        const [member] = await tx
          .select()
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.principalId, input.userId),
            ),
          )
          .for("share");
        if (!nativeUser?.emailVerified || !member || member.status !== "active")
          throw notFound("Verified native company member required");
        if (
          input.manageMembershipLifecycle &&
          (!policy.scimConnectionId || member.membershipRole === "owner")
        )
          throw conflict(
            "SCIM lifecycle requires an explicit non-owner company mapping",
          );
        const [binding] = await tx
          .insert(enterpriseSubjectBindings)
          .values({
            companyId,
            providerId: policy.providerId,
            issuer: policy.issuer,
            subject: input.subject,
            userId: input.userId,
            managedMembership: input.manageMembershipLifecycle,
            createdByUserId: userId,
          })
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.subject_bound",
            entityType: "enterprise_subject_binding",
            entityId: binding!.id,
            details: {
              managedMembership: input.manageMembershipLifecycle,
              reason: input.reason,
            },
          },
          p,
        );
        return binding!;
      });
    },
    listBindings: async (actor: AuthorizationActor, companyId: string) =>
      db.transaction(async (tx) => {
        await owner(tx as unknown as Db, actor, companyId);
        return tx
          .select()
          .from(enterpriseSubjectBindings)
          .where(eq(enterpriseSubjectBindings.companyId, companyId))
          .orderBy(enterpriseSubjectBindings.createdAt)
          .limit(1000);
      }),
    revokeBinding: async (
      actor: AuthorizationActor,
      companyId: string,
      bindingId: string,
    ) =>
      withV7ActivityTransaction(db, async (tx, p) => {
        const userId = await owner(tx, actor, companyId);
        await current(tx, companyId, true);
        const [binding] = await tx
          .update(enterpriseSubjectBindings)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(
            and(
              eq(enterpriseSubjectBindings.companyId, companyId),
              eq(enterpriseSubjectBindings.id, bindingId),
            ),
          )
          .returning();
        if (!binding) throw notFound("Company subject binding not found");
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.subject_revoked",
            entityType: "enterprise_subject_binding",
            entityId: binding.id,
          },
          p,
        );
        return binding;
      }),
    rotateScim: async (
      actor: AuthorizationActor,
      companyId: string,
      expectedVersion: number,
      expectedCredentialId: string | null,
    ) =>
      withV7ActivityTransaction(db, async (tx, p) => {
        const userId = await owner(tx, actor, companyId),
          row = await current(tx, companyId, true);
        await enabled(tx);
        if (
          row.version !== expectedVersion ||
          row.scimCredentialId !== expectedCredentialId ||
          row.status !== "qualified" ||
          !row.scimConnectionId ||
          row.qualification?.sourceRevision !== options.sourceSha ||
          new Date(row.qualification.expiresAt) <= new Date()
        )
          throw conflict("Current qualified SCIM policy required");
        const key = await signingKey(tx, row);
        if (
          key &&
          key.valueSha256 !== row.qualification?.signingKey?.valueSha256
        )
          throw conflict("Signing key qualification changed");
        const token = randomBytes(32).toString("base64url"),
          credentialId = randomUUID(),
          expiresAt = new Date(Date.now() + 90 * 86400000);
        await tx
          .update(enterpriseIdentityPolicies)
          .set({
            scimTokenHash: createHash("sha256").update(token).digest("hex"),
            scimCredentialId: credentialId,
            scimExpiresAt: expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseIdentityPolicies.id, row.id));
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.scim_credential_rotated",
            entityType: "enterprise_identity_policy",
            entityId: row.id,
            details: { credentialId, expiresAt: expiresAt.toISOString() },
          },
          p,
        );
        return { credentialId, token, expiresAt: expiresAt.toISOString() };
      }),
    decommissionScim: async (
      actor: AuthorizationActor,
      companyId: string,
      expectedVersion: number,
    ) =>
      withV7ActivityTransaction(db, async (tx, p) => {
        const userId = await owner(tx, actor, companyId),
          row = await current(tx, companyId, true);
        if (row.version !== expectedVersion || row.status === "retired")
          throw conflict("SCIM policy version changed or retired");
        if (!row.scimConnectionId) return view(row);
        const managed = await tx
          .select({ userId: enterpriseSubjectBindings.userId })
          .from(enterpriseSubjectBindings)
          .where(
            and(
              eq(enterpriseSubjectBindings.companyId, companyId),
              eq(enterpriseSubjectBindings.providerId, row.providerId),
              eq(enterpriseSubjectBindings.managedMembership, true),
            ),
          )
          .for("update");
        const [counts] = await tx.execute<{ count: number }>(
          sql`with suspended as (update company_memberships set status='suspended', updated_at=now() where company_id=${companyId}::uuid and principal_type='user' and membership_role<>'owner' and principal_id in (select user_id from enterprise_subject_bindings where company_id=${companyId}::uuid and provider_id=${row.providerId} and managed_membership) returning principal_id) select count(*)::int as count from suspended`,
        );
        await tx.execute(
          sql`delete from principal_permission_grants g using company_memberships m where g.company_id=${companyId}::uuid and g.principal_type='user' and m.company_id=g.company_id and m.principal_id=g.principal_id and m.principal_type='user' and m.membership_role<>'owner' and g.principal_id in (select user_id from enterprise_subject_bindings where company_id=${companyId}::uuid and provider_id=${row.providerId} and managed_membership)`,
        );
        await tx
          .update(enterpriseSubjectBindings)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(
            and(
              eq(enterpriseSubjectBindings.companyId, companyId),
              eq(enterpriseSubjectBindings.providerId, row.providerId),
              eq(enterpriseSubjectBindings.managedMembership, true),
            ),
          );
        await tx
          .delete(scimGroup)
          .where(eq(scimGroup.connectionId, row.scimConnectionId));
        await tx
          .delete(scimUser)
          .where(eq(scimUser.connectionId, row.scimConnectionId));
        await tx
          .delete(scimIdentityTombstone)
          .where(eq(scimIdentityTombstone.connectionId, row.scimConnectionId));
        await tx
          .delete(scimConnectionBinding)
          .where(eq(scimConnectionBinding.connectionId, row.scimConnectionId));
        const [updated] = await tx
          .update(enterpriseIdentityPolicies)
          .set({
            version: row.version + 1,
            status: "draft",
            scimConnectionId: null,
            qualification: null,
            scimTokenHash: null,
            scimCredentialId: null,
            scimExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseIdentityPolicies.id, row.id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.scim_decommissioned",
            entityType: "enterprise_identity_policy",
            entityId: row.id,
            details: {
              version: updated!.version,
              managedMappings: managed.length,
              suspendedMemberships: counts?.count ?? 0,
              qualificationWithdrawn: true,
            },
          },
          p,
        );
        return view(updated!);
      }),
    suspend: async (
      actor: AuthorizationActor,
      companyId: string,
      expectedVersion: number,
    ) =>
      withV7ActivityTransaction(db, async (tx, p) => {
        const userId = await owner(tx, actor, companyId),
          row = await current(tx, companyId, true);
        if (row.version !== expectedVersion || row.status === "retired")
          throw conflict("Policy version changed or retired");
        const [updated] = await tx
          .update(enterpriseIdentityPolicies)
          .set({
            status: "suspended",
            version: row.version + 1,
            qualification: null,
            scimTokenHash: null,
            scimCredentialId: null,
            scimExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseIdentityPolicies.id, row.id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "enterprise.identity_suspended",
            entityType: "enterprise_identity_policy",
            entityId: row.id,
          },
          p,
        );
        return view(updated!);
      }),
  };
}
