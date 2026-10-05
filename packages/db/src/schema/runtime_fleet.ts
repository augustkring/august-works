import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { agentProviderBindings } from "./agent_provider_bindings.js";
import { billingAccounts, billingAccountCompanies } from "./saas_billing.js";

const stamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const runtimeCapacityProfiles = pgTable(
  "runtime_capacity_profiles",
  {
    key: text("key").primaryKey(),
    commercialProductKey: text("commercial_product_key")
      .notNull()
      .default("runtime_standard"),
    cpuMillis: integer("cpu_millis").notNull(),
    memoryBytes: bigint("memory_bytes", { mode: "bigint" }).notNull(),
    diskBytes: bigint("disk_bytes", { mode: "bigint" }).notNull(),
    pidsLimit: integer("pids_limit").notNull(),
    benchmarkEvidence:
      jsonb("benchmark_evidence").$type<Record<string, unknown>>(),
    qualified: boolean("qualified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "runtime_capacity_profiles_product_ck",
      sql`${t.commercialProductKey} in ('runtime_standard','runtime_performance','runtime_dedicated_gateway','runtime_dedicated_vm')`,
    ),
    check(
      "runtime_capacity_profiles_positive_ck",
      sql`${t.cpuMillis} > 0 and ${t.memoryBytes} > 0 and ${t.diskBytes} > 0 and ${t.pidsLimit} > 0`,
    ),
  ],
);
export const runtimeVersionCatalog = pgTable(
  "runtime_version_catalog",
  {
    imageDigest: text("image_digest").primaryKey(),
    providerVersion: text("provider_version").notNull(),
    stateFormat: text("state_format").notNull(),
    hostAgentMinimumVersion: text("host_agent_minimum_version").notNull(),
    conformance: jsonb("conformance")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text("status").notNull().default("candidate"),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "runtime_version_catalog_digest_ck",
      sql`${t.imageDigest} ~ '^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$'`,
    ),
    check(
      "runtime_version_catalog_status_ck",
      sql`${t.status} in ('candidate','canary','approved','halted','retired')`,
    ),
  ],
);
export const runtimeHosts = pgTable(
  "runtime_hosts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("upcloud"),
    providerResourceId: text("provider_resource_id"),
    environment: text("environment").notNull(),
    region: text("region").notNull(),
    privateIp: text("private_ip"),
    dedicatedCompanyId: uuid("dedicated_company_id").references(
      () => companies.id,
    ),
    capacityClass: text("capacity_class").notNull(),
    cpuTotalMillis: integer("cpu_total_millis").notNull(),
    memoryTotalBytes: bigint("memory_total_bytes", {
      mode: "bigint",
    }).notNull(),
    diskTotalBytes: bigint("disk_total_bytes", { mode: "bigint" }).notNull(),
    cpuReservedMillis: integer("cpu_reserved_millis").notNull().default(0),
    memoryReservedBytes: bigint("memory_reserved_bytes", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    diskReservedBytes: bigint("disk_reserved_bytes", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    status: text("status").notNull().default("PROVISIONING"),
    publicKeyPem: text("public_key_pem"),
    credentialVersion: integer("credential_version").notNull().default(1),
    credentialRevokedAt: timestamp("credential_revoked_at", {
      withTimezone: true,
    }),
    hostAgentVersion: text("host_agent_version"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastInventory: jsonb("last_inventory").$type<Record<string, unknown>>(),
    drainRequestedAt: timestamp("drain_requested_at", { withTimezone: true }),
    fencedAt: timestamp("fenced_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("runtime_hosts_provider_uq")
      .on(t.provider, t.providerResourceId)
      .where(sql`${t.providerResourceId} is not null`),
    index("runtime_hosts_placement_idx").on(
      t.status,
      t.region,
      t.capacityClass,
    ),
    index("runtime_hosts_heartbeat_idx").on(t.lastHeartbeatAt),
    check(
      "runtime_hosts_status_ck",
      sql`${t.status} in ('PROVISIONING','BOOTSTRAPPING','READY','DRAINING','DEGRADED','UNREACHABLE','RETIRED','FAILED')`,
    ),
    check(
      "runtime_hosts_capacity_ck",
      sql`${t.cpuReservedMillis} >= 0 and ${t.cpuReservedMillis} <= ${t.cpuTotalMillis} and ${t.memoryReservedBytes} >= 0 and ${t.memoryReservedBytes} <= ${t.memoryTotalBytes} and ${t.diskReservedBytes} >= 0 and ${t.diskReservedBytes} <= ${t.diskTotalBytes}`,
    ),
  ],
);
export const runtimeHostEnrollments = pgTable(
  "runtime_host_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeHostId: uuid("runtime_host_id")
      .notNull()
      .references(() => runtimeHosts.id),
    tokenHash: text("token_hash").notNull(),
    expectedProviderResourceId: text("expected_provider_resource_id"),
    expectedRegion: text("expected_region").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("runtime_host_enrollments_token_uq").on(t.tokenHash)],
);
export const runtimeHostRequestNonces = pgTable(
  "runtime_host_request_nonces",
  {
    runtimeHostId: uuid("runtime_host_id")
      .notNull()
      .references(() => runtimeHosts.id),
    nonce: text("nonce").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("runtime_host_request_nonces_uq").on(t.runtimeHostId, t.nonce),
  ],
);
export const runtimeCells = pgTable(
  "runtime_cells",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    runtimeHostId: uuid("runtime_host_id").references(() => runtimeHosts.id),
    dedicatedAgentId: uuid("dedicated_agent_id").references(() => agents.id),
    providerBindingId: uuid("provider_binding_id").references(
      () => agentProviderBindings.id,
    ),
    runtimeProvider: text("runtime_provider").notNull().default("openclaw"),
    isolationMode: text("isolation_mode").notNull(),
    capacityProfile: text("capacity_profile")
      .notNull()
      .references(() => runtimeCapacityProfiles.key),
    desiredImageDigest: text("desired_image_digest")
      .notNull()
      .references(() => runtimeVersionCatalog.imageDigest),
    activeImageDigest: text("active_image_digest").references(
      () => runtimeVersionCatalog.imageDigest,
    ),
    generation: bigint("generation", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    status: text("status").notNull().default("REQUESTED"),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    modelSecretRef: uuid("model_secret_ref"),
    modelSecretVersion: integer("model_secret_version"),
    gatewaySecretRef: text("gateway_secret_ref"),
    stateStorageRef: text("state_storage_ref"),
    activeSince: timestamp("active_since", { withTimezone: true }),
    meteredThrough: timestamp("metered_through", { withTimezone: true }),
    lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true }),
    lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    suspendedReason: text("suspended_reason"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("runtime_cells_company_id_uq").on(t.companyId, t.id),
    uniqueIndex("runtime_cells_dedicated_agent_uq")
      .on(t.companyId, t.dedicatedAgentId)
      .where(
        sql`${t.deletedAt} is null and ${t.isolationMode} = 'dedicated_agent_gateway'`,
      ),
    index("runtime_cells_company_idx").on(t.companyId, t.status),
    index("runtime_cells_host_idx").on(t.runtimeHostId, t.status),
    index("runtime_cells_billing_idx").on(t.billingAccountId, t.status),
    foreignKey({
      columns: [t.companyId, t.billingAccountId],
      foreignColumns: [
        billingAccountCompanies.companyId,
        billingAccountCompanies.billingAccountId,
      ],
    }),
    check("runtime_cells_generation_ck", sql`${t.generation} > 0`),
    check(
      "runtime_cells_isolation_ck",
      sql`${t.isolationMode} in ('company_cell','dedicated_agent_gateway','dedicated_vm')`,
    ),
    check(
      "runtime_cells_status_ck",
      sql`${t.status} in ('REQUESTED','WAITING_FOR_CAPACITY','PROVISIONING','CONFIGURING','STARTING','HEALTHY','DEGRADED','STOPPING','STOPPED','UPGRADING','BACKING_UP','MIGRATING','RECOVERING','DELETING','DELETED','FAILED')`,
    ),
    check(
      "runtime_cells_deleted_ck",
      sql`(${t.status} = 'DELETED') = (${t.deletedAt} is not null)`,
    ),
  ],
);
export const runtimeOperations = pgTable(
  "runtime_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    runtimeCellId: uuid("runtime_cell_id").notNull(),
    operationType: text("operation_type").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    requestedByType: text("requested_by_type").notNull(),
    requestedById: text("requested_by_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    desiredState: jsonb("desired_state")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attemptCount: integer("attempt_count").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    version: integer("version").notNull().default(1),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("runtime_operations_request_uq").on(
      t.companyId,
      t.operationType,
      t.idempotencyKey,
    ),
    uniqueIndex("runtime_operations_active_cell_uq")
      .on(t.runtimeCellId)
      .where(
        sql`${t.status} in ('REQUESTED','RUNNING','WAITING_FOR_CAPACITY','NEEDS_RECONCILIATION')`,
      ),
    foreignKey({
      columns: [t.companyId, t.runtimeCellId],
      foreignColumns: [runtimeCells.companyId, runtimeCells.id],
    }),
    index("runtime_operations_work_idx").on(t.status, t.notBefore),
    check(
      "runtime_operations_status_ck",
      sql`${t.status} in ('REQUESTED','RUNNING','WAITING_FOR_CAPACITY','NEEDS_RECONCILIATION','SUCCEEDED','FAILED','CANCELED')`,
    ),
  ],
);
export const runtimeHostCommands = pgTable(
  "runtime_host_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeHostId: uuid("runtime_host_id")
      .notNull()
      .references(() => runtimeHosts.id),
    companyId: uuid("company_id"),
    runtimeCellId: uuid("runtime_cell_id"),
    operationId: uuid("operation_id").references(() => runtimeOperations.id),
    cellGeneration: bigint("cell_generation", { mode: "bigint" }),
    commandType: text("command_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("PENDING"),
    attempt: integer("attempt").notNull().default(0),
    claimTokenHash: text("claim_token_hash"),
    notBefore: timestamp("not_before", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    safeResult: jsonb("safe_result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("runtime_host_commands_key_uq").on(t.idempotencyKey),
    index("runtime_host_commands_work_idx").on(
      t.runtimeHostId,
      t.status,
      t.notBefore,
    ),
    foreignKey({
      columns: [t.companyId, t.runtimeCellId],
      foreignColumns: [runtimeCells.companyId, runtimeCells.id],
    }),
    check(
      "runtime_host_commands_cell_scope_ck",
      sql`(${t.companyId} is null) = (${t.runtimeCellId} is null)`,
    ),
    check(
      "runtime_host_commands_status_ck",
      sql`${t.status} in ('PENDING','CLAIMED','SUCCEEDED','FAILED','EXPIRED','CANCELED')`,
    ),
  ],
);
export const runtimeOperationAttempts = pgTable(
  "runtime_operation_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => runtimeOperations.id),
    attemptNumber: integer("attempt_number").notNull(),
    runtimeHostId: uuid("runtime_host_id").references(() => runtimeHosts.id),
    commandId: uuid("command_id").references(() => runtimeHostCommands.id),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
  },
  (t) => [
    uniqueIndex("runtime_operation_attempts_number_uq").on(
      t.operationId,
      t.attemptNumber,
    ),
  ],
);
export const runtimeBackups = pgTable(
  "runtime_backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    runtimeCellId: uuid("runtime_cell_id").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    imageDigest: text("image_digest").notNull(),
    stateFormat: text("state_format").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    objectKey: text("object_key").notNull(),
    encryptionKeyRef: text("encryption_key_ref").notNull(),
    ciphertextSha256: text("ciphertext_sha256"),
    byteSize: bigint("byte_size", { mode: "bigint" }),
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    verificationNotBefore: timestamp("verification_not_before", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    verificationErrorCode: text("verification_error_code"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.companyId, t.runtimeCellId],
      foreignColumns: [runtimeCells.companyId, runtimeCells.id],
    }),
    index("runtime_backups_retention_idx").on(t.status, t.retainUntil),
    check(
      "runtime_backups_status_ck",
      sql`${t.status} in ('REQUESTED','UPLOADING','AVAILABLE','VERIFIED','FAILED','DELETED')`,
    ),
  ],
);
export const runtimeUsageSamples = pgTable(
  "runtime_usage_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    runtimeCellId: uuid("runtime_cell_id").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    sampleId: text("sample_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    healthy: boolean("healthy").notNull(),
    cpuMillis: integer("cpu_millis").notNull(),
    memoryBytes: bigint("memory_bytes", { mode: "bigint" }).notNull(),
    diskBytes: bigint("disk_bytes", { mode: "bigint" }).notNull(),
  },
  (t) => [
    uniqueIndex("runtime_usage_samples_source_uq").on(
      t.runtimeCellId,
      t.generation,
      t.sampleId,
    ),
    foreignKey({
      columns: [t.companyId, t.runtimeCellId],
      foreignColumns: [runtimeCells.companyId, runtimeCells.id],
    }),
  ],
);
// Provider writes are durable domain operations. Unknown creates are reconciled by ownership labels, never retried blindly.
export const runtimeHostProviderOperations = pgTable(
  "runtime_host_provider_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeHostId: uuid("runtime_host_id")
      .notNull()
      .references(() => runtimeHosts.id),
    operationType: text("operation_type").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    requestHash: text("request_hash").notNull(),
    notBefore: timestamp("not_before", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    errorCode: text("error_code"),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("runtime_host_provider_operations_once_uq").on(
      t.runtimeHostId,
      t.operationType,
    ),
    index("runtime_host_provider_operations_work_idx").on(
      t.status,
      t.notBefore,
    ),
    check(
      "runtime_host_provider_operations_type_ck",
      sql`${t.operationType} in ('create','fence','delete')`,
    ),
    check(
      "runtime_host_provider_operations_status_ck",
      sql`${t.status} in ('REQUESTED','WRITING','NEEDS_RECONCILIATION','SUCCEEDED','FAILED')`,
    ),
  ],
);

// Each schedule owns a durable stop/snapshot/verification/resume cycle, not a generic task queue.
export const runtimeBackupPolicies = pgTable("runtime_backup_policies", {
  runtimeCellId: uuid("runtime_cell_id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  createdByUserId: text("created_by_user_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  allowBriefPause: boolean("allow_brief_pause").notNull().default(false),
  intervalHours: integer("interval_hours").notNull().default(24),
  version: integer("version").notNull().default(1),
  phase: text("phase").notNull().default("idle"),
  cycleId: uuid("cycle_id"),
  cycleGeneration: bigint("cycle_generation", {mode:"bigint"}),
  resumeAfterBackup: boolean("resume_after_backup").notNull().default(false),
  operationId: uuid("operation_id").references(() => runtimeOperations.id),
  nextDueAt: timestamp("next_due_at", {withTimezone:true}).notNull().defaultNow(),
  notBefore: timestamp("not_before", {withTimezone:true}).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", {withTimezone:true}),
  errorCode: text("error_code"),
  ...stamps(),
}, t => [
  foreignKey({columns:[t.companyId,t.runtimeCellId],foreignColumns:[runtimeCells.companyId,runtimeCells.id]}),
  index("runtime_backup_policies_due_idx").on(t.notBefore),
  check("runtime_backup_policies_interval_ck",sql`${t.intervalHours} between 24 and 168`),
  check("runtime_backup_policies_phase_ck",sql`${t.phase} in ('idle','await_stop','await_backup','await_start')`),
]);
