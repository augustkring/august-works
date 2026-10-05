import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  foreignKey,
  unique,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  PackageRelease,
  PackageComponent,
  PackageInstallationView,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { aiUseCases } from "./ai_governance.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
const times = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
/** Global first-party distribution metadata; contains no company content or grants. */
export const agentPackages = pgTable(
  "agent_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("package_key").notNull().unique(),
    publisherType: text("publisher_type").notNull().default("august_works"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("active"),
    ...times(),
  },
  (t) => ({
    publisher: check(
      "agent_packages_publisher_check",
      sql`${t.publisherType}='august_works'`,
    ),
    status: check(
      "agent_packages_status_check",
      sql`${t.status} in ('active','revoked')`,
    ),
  }),
);
export const agentPackageVersions = pgTable(
  "agent_package_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("agent_package_id")
      .notNull()
      .references(() => agentPackages.id),
    version: text("version").notNull(),
    state: text("state").notNull().default("testing"),
    release: jsonb("release").$type<PackageRelease>().notNull(),
    contentHash: text("content_hash").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...times(),
  },
  (t) => ({
    version: unique("agent_package_versions_version_uq").on(
      t.packageId,
      t.version,
    ),
    packageVersion: unique("agent_package_versions_package_id_uq").on(
      t.packageId,
      t.id,
    ),
    state: check(
      "agent_package_versions_state_check",
      sql`${t.state} in ('draft','testing','published','deprecated','revoked')`,
    ),
    hash: check(
      "agent_package_versions_hash_check",
      sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);
export const agentPackageComponents = pgTable(
  "agent_package_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("package_version_id")
      .notNull()
      .references(() => agentPackageVersions.id),
    key: text("component_key").notNull(),
    component: jsonb("component").$type<PackageComponent>().notNull(),
  },
  (t) => ({
    key: unique("agent_package_components_key_uq").on(t.versionId, t.key),
  }),
);
export const companyAgentPackageInstallations = pgTable(
  "company_agent_package_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    packageId: uuid("agent_package_id").notNull(),
    installedVersionId: uuid("installed_version_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    aiUseCaseId: uuid("ai_use_case_id"),
    updatePolicy: text("update_policy")
      .$type<PackageInstallationView["updatePolicy"]>()
      .notNull()
      .default("manual"),
    status: text("status")
      .$type<PackageInstallationView["status"]>()
      .notNull()
      .default("configuring"),
    version: integer("version").notNull().default(1),
    installedByUserId: text("installed_by_user_id").notNull(),
    components: jsonb("resolved_components")
      .$type<PackageInstallationView["components"]>()
      .notNull(),
    activationHash: text("activation_hash"),
    readiness: jsonb("readiness").$type<PackageInstallationView["readiness"]>(),
    ...times(),
  },
  (t) => ({
    tenant: unique("company_agent_package_installations_tenant_uq").on(
      t.companyId,
      t.id,
    ),
    packageFk: foreignKey({
      columns: [t.packageId, t.installedVersionId],
      foreignColumns: [agentPackageVersions.packageId, agentPackageVersions.id],
    }),
    agentFk: foreignKey({
      columns: [t.companyId, t.agentId],
      foreignColumns: [agents.companyId, agents.id],
    }),
    useCaseFk: foreignKey({
      columns: [t.companyId, t.aiUseCaseId],
      foreignColumns: [aiUseCases.companyId, aiUseCases.id],
    }),
    oneAgent: uniqueIndex("company_agent_package_installations_agent_uq")
      .on(t.companyId, t.agentId)
      .where(sql`${t.status}<>'uninstalled'`),
    company: index("company_agent_package_installations_company_idx").on(
      t.companyId,
      t.updatedAt,
    ),
    status: check(
      "company_agent_package_installations_status_check",
      sql`${t.status} in ('configuring','readiness_blocked','ready','active','needs_update','degraded','suspended','uninstalled')`,
    ),
    version: check(
      "company_agent_package_installations_version_check",
      sql`${t.version}>0`,
    ),
    policy: check(
      "company_agent_package_installations_policy_check",
      sql`${t.updatePolicy} in ('manual','auto_low_risk')`,
    ),
  }),
);
export const agentPackageStopActions = pgTable(
  "agent_package_stop_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    runId: uuid("run_id").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    ...times(),
  },
  (t) => ({
    installationFk: foreignKey({
      columns: [t.companyId, t.installationId],
      foreignColumns: [
        companyAgentPackageInstallations.companyId,
        companyAgentPackageInstallations.id,
      ],
    }),
    runFk: foreignKey({
      columns: [t.companyId, t.runId],
      foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.id],
    }),
    one: unique("agent_package_stop_actions_run_uq").on(
      t.installationId,
      t.runId,
    ),
    attempts: check(
      "agent_package_stop_actions_attempts_check",
      sql`${t.attempts} between 0 and 5`,
    ),
    status: check(
      "agent_package_stop_actions_status_check",
      sql`${t.status} in ('queued','delivering','delivered')`,
    ),
  }),
);
export const agentPackageUpdateProposals = pgTable(
  "agent_package_update_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    proposal: jsonb("proposal").$type<
      import("@paperclipai/shared").PackageUpdateInput | null
    >(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    createdByUserId: text("created_by_user_id").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    acceptedInstallationVersion: integer("accepted_installation_version"),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    ...times(),
  },
  (t) => ({
    tenant: unique("agent_package_update_proposals_tenant_uq").on(
      t.companyId,
      t.id,
    ),
    installationFk: foreignKey({
      columns: [t.companyId, t.installationId],
      foreignColumns: [
        companyAgentPackageInstallations.companyId,
        companyAgentPackageInstallations.id,
      ],
    }),
    status: check(
      "agent_package_update_proposals_status_check",
      sql`${t.status} in ('pending','accepted','rejected','stale')`,
    ),
  }),
);
