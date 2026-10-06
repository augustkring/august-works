import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  unique,
  uniqueIndex,
  foreignKey,
  check,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { authUsers } from "./auth.js";
import type {
  EnterpriseIdentityConfiguration,
  EnterpriseOperatingEnvelope,
} from "@paperclipai/shared";

// Company policy is native authority. Provider/SCIM tables below are Better Auth
// authentication metadata, not a parallel store of company access rights.
export const enterpriseIdentityPolicies = pgTable(
  "enterprise_identity_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    providerId: text("provider_id").notNull().unique(),
    scimConnectionId: text("scim_connection_id").unique(),
    issuer: text("issuer").notNull(),
    configuration: jsonb("configuration")
      .$type<EnterpriseIdentityConfiguration>()
      .notNull(),
    operatingEnvelope: jsonb("operating_envelope")
      .$type<EnterpriseOperatingEnvelope>()
      .notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    scimTokenHash: text("scim_token_hash"),
    scimCredentialId: text("scim_credential_id"),
    scimExpiresAt: timestamp("scim_expires_at", { withTimezone: true }),
    qualification: jsonb("qualification").$type<{
      uri: string;
      sha256: string;
      sourceRevision: string;
      qualifiedByUserId: string;
      expiresAt: string;
      signingKey: {
        secretId: string;
        version: number;
        valueSha256: string;
      } | null;
    } | null>(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    company: unique("enterprise_identity_company_uq").on(t.companyId),
    tenant: unique("enterprise_identity_tenant_uq").on(
      t.companyId,
      t.providerId,
    ),
    state: check(
      "enterprise_identity_state_check",
      sql`${t.status} in ('draft','qualified','suspended','retired')`,
    ),
    version: check("enterprise_identity_version_check", sql`${t.version}>0`),
    hash: check(
      "enterprise_scim_token_hash_check",
      sql`${t.scimTokenHash} is null or ${t.scimTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);
export const enterpriseSubjectBindings = pgTable(
  "enterprise_subject_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    managedMembership: boolean("managed_membership").notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scope: foreignKey({
      columns: [t.companyId, t.providerId],
      foreignColumns: [
        enterpriseIdentityPolicies.companyId,
        enterpriseIdentityPolicies.providerId,
      ],
    }),
    subject: unique("enterprise_subject_binding_subject_uq").on(
      t.companyId,
      t.issuer,
      t.subject,
    ),
    user: uniqueIndex("enterprise_subject_binding_active_user_uq")
      .on(t.companyId, t.providerId, t.userId)
      .where(sql`${t.status}='active'`),
    state: check(
      "enterprise_subject_binding_state_check",
      sql`${t.status} in ('active','revoked')`,
    ),
  }),
);

// Mirrors @better-auth/sso and @better-auth/scim 1.7.2 public schema descriptors.
// A parity test must fail when the pinned framework schema changes.
export const ssoProvider = pgTable(
  "enterprise_auth_sso_provider",
  {
    id: text("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    issuer: text("issuer").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    providerId: text("provider_id").notNull().unique(),
    organizationId: text("organization_id"),
    domain: text("domain").notNull(),
  },
  (t) => ({}),
);
export const scimConnectionBinding = pgTable(
  "enterprise_auth_scim_connection_binding",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => enterpriseIdentityPolicies.scimConnectionId),
    connectionKey: text("connection_key").notNull().unique(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    decommissionedAt: timestamp("decommissioned_at", { withTimezone: true }),
    decommissionStatus: text("decommission_status").notNull().default("active"),
    decommissionCursorUserId: text("decommission_cursor_user_id"),
    decommissionReconciledUserCount: integer(
      "decommission_reconciled_user_count",
    )
      .notNull()
      .default(0),
    decommissionBatchCount: integer("decommission_batch_count")
      .notNull()
      .default(0),
    decommissionRevision: integer("decommission_revision").notNull().default(0),
    decommissionCompletedAt: timestamp("decommission_completed_at", {
      withTimezone: true,
    }),
    decommissionLeaseId: text("decommission_lease_id"),
    decommissionLeaseExpiresAt: timestamp("decommission_lease_expires_at", {
      withTimezone: true,
    }),
  },
  (t) => ({
    connectionIdIdx: index(
      "enterprise_auth_scim_connection_binding_connection_idx",
    ).on(t.connectionId),
  }),
);
export const scimIdentityTombstone = pgTable(
  "enterprise_auth_scim_identity_tombstone",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => enterpriseIdentityPolicies.scimConnectionId),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    externalId: text("external_id").notNull(),
    externalIdKey: text("external_id_key").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    profile: text("profile").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    connectionIdIdx: index(
      "enterprise_auth_scim_identity_tombstone_connection_idx",
    ).on(t.connectionId),
  }),
);
export const scimSubject = pgTable(
  "enterprise_auth_scim_subject",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    profileSourceId: text("profile_source_id"),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({}),
);
export const scimUser = pgTable(
  "enterprise_auth_scim_user",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => enterpriseIdentityPolicies.scimConnectionId),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    connectionUserKey: text("connection_user_key").notNull().unique(),
    userName: text("user_name").notNull(),
    userNameKey: text("user_name_key").notNull().unique(),
    primaryEmail: text("primary_email").notNull(),
    workEmailValueIndex: text("work_email_value_index").notNull(),
    emailValueIndex: text("email_value_index").notNull(),
    displayName: text("display_name").notNull(),
    formattedName: text("formatted_name").notNull(),
    givenName: text("given_name"),
    familyName: text("family_name"),
    serializedEmails: text("serialized_emails").notNull(),
    serializedAttributes: text("serialized_attributes"),
    externalId: text("external_id"),
    externalIdKey: text("external_id_key").unique(),
    active: boolean("active").notNull(),
    orderKey: text("order_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    connectionIdIdx: index("enterprise_auth_scim_user_connection_idx").on(
      t.connectionId,
    ),
    scopedId: unique("enterprise_auth_scim_user_scope_id_uq").on(
      t.connectionId,
      t.id,
    ),
  }),
);
export const scimProjectionGrant = pgTable(
  "enterprise_auth_scim_projection_grant",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => enterpriseIdentityPolicies.scimConnectionId),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    scimUserId: text("scim_user_id")
      .notNull()
      .references(() => scimUser.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceValue: text("source_value"),
    role: text("role").notNull(),
    grantKey: text("grant_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    connectionIdIdx: index(
      "enterprise_auth_scim_projection_grant_connection_idx",
    ).on(t.connectionId),
    scopedUser: foreignKey({
      columns: [t.connectionId, t.scimUserId],
      foreignColumns: [scimUser.connectionId, scimUser.id],
    }).onDelete("cascade"),
  }),
);
export const scimGroup = pgTable(
  "enterprise_auth_scim_group",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => enterpriseIdentityPolicies.scimConnectionId),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    revision: integer("revision").notNull().default(0),
    displayName: text("display_name").notNull(),
    displayNameKey: text("display_name_key").notNull().unique(),
    externalId: text("external_id"),
    externalIdKey: text("external_id_key").unique(),
    orderKey: text("order_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    connectionIdIdx: index("enterprise_auth_scim_group_connection_idx").on(
      t.connectionId,
    ),
    scopedId: unique("enterprise_auth_scim_group_scope_id_uq").on(
      t.connectionId,
      t.id,
    ),
  }),
);
export const scimGroupMember = pgTable(
  "enterprise_auth_scim_group_member",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => enterpriseIdentityPolicies.scimConnectionId),
    groupId: text("group_id")
      .notNull()
      .references(() => scimGroup.id, { onDelete: "cascade" }),
    scimUserId: text("scim_user_id")
      .notNull()
      .references(() => scimUser.id, { onDelete: "cascade" }),
    membershipKey: text("membership_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    connectionIdIdx: index(
      "enterprise_auth_scim_group_member_connection_idx",
    ).on(t.connectionId),
    scopedGroup: foreignKey({
      columns: [t.connectionId, t.groupId],
      foreignColumns: [scimGroup.connectionId, scimGroup.id],
    }).onDelete("cascade"),
    scopedUser: foreignKey({
      columns: [t.connectionId, t.scimUserId],
      foreignColumns: [scimUser.connectionId, scimUser.id],
    }).onDelete("cascade"),
  }),
);
