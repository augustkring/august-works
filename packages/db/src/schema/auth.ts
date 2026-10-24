import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, bigint, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";

export const authUsers = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  locale: text("locale"),
  keyboardShortcuts: boolean("keyboard_shortcuts").notNull().default(false),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  authenticatorVersion: integer("authenticator_version").notNull().default(0),
  phishingResistantRequired: boolean("phishing_resistant_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  authenticatorVersionCheck: check("user_authenticator_version_check", sql`${table.authenticatorVersion} >= 0`),
  localeCheck: check("user_locale_check", sql`${table.locale} is null or ${table.locale} in ('en', 'da')`),
}));

export const authSessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // Server-owned proof of a completed native ceremony; legacy sessions stay unknown.
  authenticationMethod: text("authentication_method").$type<"password" | "totp" | "backup_code" | "passkey">(),
  authenticatedAt: timestamp("authenticated_at", { withTimezone: true }),
  authenticatorVersion: integer("authenticator_version"),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
}, (table) => ({
  authenticationProofCheck: check("session_authentication_proof_check", sql`
    (${table.authenticationMethod} is null and ${table.authenticatedAt} is null and ${table.authenticatorVersion} is null)
    or (${table.authenticationMethod} is not null and ${table.authenticatorVersion} is not null
      and ${table.authenticationMethod} in ('password','totp','backup_code','passkey')
      and ${table.authenticatedAt} is not null and ${table.authenticatorVersion} >= 0)
  `),
}));

/**
 * Better Auth's `account` model. Every column here has to exist for the
 * Drizzle adapter to accept the table at all: the adapter validates the
 * model's fields against the schema on each write and throws
 * `The field "<name>" does not exist in the "account" Drizzle schema`
 * when one is missing, which surfaces as a 500 on sign-up.
 *
 * `issuer` is the account namespace Better Auth 1.7 added. It is
 * `local:credential` for email/password accounts and
 * `local:oauth:<providerId>` for social accounts that do not declare an
 * issuer of their own, and it pairs with `account_id` as the stable
 * provider-side key — hence the unique index, which mirrors the
 * `(issuer, accountId)` unique index Better Auth declares on the model.
 */
export const authAccounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    issuerAccountIdUq: uniqueIndex("account_issuer_account_id_uq").on(table.issuer, table.accountId),
  }),
);

export const authVerifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  // Server-owned generation of the first factor that issued a native challenge.
  authenticatorVersion: integer("authenticator_version"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
}, (table) => ({
  authenticatorVersionCheck: check("verification_authenticator_version_check", sql`${table.authenticatorVersion} is null or ${table.authenticatorVersion} >= 0`),
}));


// Exact provider models. Better Auth owns cryptographic verification and encryption.
export const authTwoFactors = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(true),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  // Bounded one-use metadata for already verified OTPs; never plaintext codes.
  totpReplayState: jsonb("totp_replay_state").$type<Array<{ fingerprint: string; expiresAtMs: number }>>()
    .notNull().default([]),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
}, (table) => ({
  userUq: uniqueIndex("two_factor_user_uq").on(table.userId),
  secretIdx: index("two_factor_secret_idx").on(table.secret),
  totpReplayStateCheck: check("two_factor_totp_replay_state_check", sql`jsonb_typeof(${table.totpReplayState})='array' and jsonb_array_length(${table.totpReplayState})<=16`),
  failedVerificationCountCheck: check("two_factor_failed_verification_count_check", sql`${table.failedVerificationCount} >= 0`),
}));

export const authPasskeys = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  aaguid: text("aaguid"),
}, (table) => ({
  userIdx: index("passkey_user_idx").on(table.userId),
  credentialUq: uniqueIndex("passkey_credential_uq").on(table.credentialID),
  counterCheck: check("passkey_counter_check", sql`${table.counter} between 0 and 4294967295`),
}));
