import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { BusinessEventAttributes } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";

export const businessEvents = pgTable("business_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  activity: text("activity").notNull(),
  lifecycle: text("lifecycle"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  sourceClass: text("source_class").notNull(),
  sourceProvider: text("source_provider").notNull(),
  sourceRef: uuid("source_ref").notNull(),
  sourceVersion: text("source_version").notNull(),
  sourceHash: text("source_hash").notNull(),
  revision: integer("revision").notNull(),
  attributes: jsonb("attributes_json").$type<BusinessEventAttributes>().notNull(),
  purpose: text("purpose").notNull(),
  sensitivity: text("sensitivity").notNull(),
  trustLevel: text("trust_level").notNull(),
  supersedesEventId: uuid("supersedes_event_id"),
  tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  // Historical ungoverned rows remain nullable and are denied by admission;
  // the retention owner removes them rather than inventing retrospective approval.
  governanceObligationRefs: jsonb("governance_obligation_refs_json").$type<string[]>(),
  retentionDays: integer("retention_days"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => ({
  companyIdUq: unique("business_events_company_id_uq").on(t.companyId, t.id),
  revisionUq: unique("business_events_source_revision_uq").on(t.companyId, t.sourceProvider, t.sourceRef, t.revision),
  supersedesFk: foreignKey({ name: "business_events_company_supersedes_fk", columns: [t.companyId, t.supersedesEventId], foreignColumns: [t.companyId, t.id] }),
  sourceCheck: check("business_events_native_source_check", sql`${t.sourceClass} = 'aw_native' and ${t.sourceProvider} = 'activity_log'`),
  hashCheck: check("business_events_source_hash_check", sql`${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
  revisionCheck: check("business_events_revision_check", sql`(${t.revision} = 1 and ${t.supersedesEventId} is null) or (${t.revision} > 1 and ${t.supersedesEventId} is not null)`),
  policyCheck: check("business_events_policy_check", sql`${t.purpose} = 'process_intelligence' and ${t.sensitivity} = 'internal' and ${t.trustLevel} = 'observed'`),
  attributesCheck: check("business_events_attributes_check", sql`jsonb_typeof(${t.attributes}) = 'object' and ${t.attributes} - ARRAY['status','previousStatus','priority']::text[] = '{}'::jsonb`),
  companyTimeIdx: index("business_events_company_time_idx").on(t.companyId, t.occurredAt, t.id),
  expiryIdx: index("business_events_expiry_idx").on(t.expiresAt, t.companyId),
  admissionCheck: check("business_events_admission_check", sql`(
    (${t.governanceObligationRefs} is null and ${t.retentionDays} is null and ${t.expiresAt} is null)
    or (${t.governanceObligationRefs} is not null and jsonb_typeof(${t.governanceObligationRefs})='array'
      and jsonb_array_length(${t.governanceObligationRefs}) between 1 and 32
      and ${t.retentionDays} is not null and ${t.retentionDays} between 1 and 3650
      and ${t.expiresAt} is not null and ${t.expiresAt}>${t.observedAt})
  )`),
}));

export const businessEventObjects = pgTable("business_event_objects", {
  companyId: uuid("company_id").notNull(),
  eventId: uuid("event_id").notNull(),
  objectType: text("object_type").$type<"issue" | "project">().notNull(),
  objectId: uuid("object_id").notNull(),
  qualifier: text("qualifier").$type<"primary" | "related">().notNull(),
}, (t) => ({
  eventFk: foreignKey({ name: "business_event_objects_company_event_fk", columns: [t.companyId, t.eventId], foreignColumns: [businessEvents.companyId, businessEvents.id] }).onDelete("cascade"),
  objectUq: unique("business_event_objects_relationship_uq").on(t.companyId, t.eventId, t.objectType, t.objectId, t.qualifier),
  typeCheck: check("business_event_objects_type_check", sql`${t.objectType} in ('issue','project') and ${t.qualifier} in ('primary','related')`),
  objectIdx: index("business_event_objects_company_object_idx").on(t.companyId, t.objectType, t.objectId),
}));

// Minimal suppression identity must outlive projection deletion. Replays and
// restores must apply this register before reopening projection writers.
export const businessEventSuppressions = pgTable("business_event_suppressions", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceRef: uuid("source_ref").notNull(),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sourceUq: unique("business_event_suppressions_source_uq").on(t.companyId, t.sourceRef),
}));

export const businessEventBackfillRuns = pgTable("business_event_backfill_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  lineageManifestId: uuid("lineage_manifest_id").notNull(),
  projectorVersion: text("projector_version").notNull(),
  windowFrom: timestamp("window_from", { withTimezone: true }).notNull(),
  windowUntil: timestamp("window_until", { withTimezone: true }).notNull(),
  startCursor: jsonb("start_cursor_json").$type<{ at: string; id: string } | null>(),
  lastSourceCursor: jsonb("last_source_cursor_json").$type<{ at: string; id: string } | null>(),
  batchLimit: integer("batch_limit").notNull(),
  projected: integer("projected").notNull(),
  unchanged: integer("unchanged").notNull(),
  status: text("status").$type<"batch_limit_reached" | "window_scan_exhausted">().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  manifestFk: foreignKey({ name: "business_event_backfill_runs_manifest_fk", columns: [t.companyId, t.lineageManifestId],
    foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  companyTimeIdx: index("business_event_backfill_runs_company_time_idx").on(t.companyId, t.recordedAt),
  windowCheck: check("business_event_backfill_runs_window_check", sql`${t.windowUntil} >= ${t.windowFrom}`),
  boundsCheck: check("business_event_backfill_runs_bounds_check", sql`${t.batchLimit} between 1 and 200 and ${t.projected} >= 0 and ${t.unchanged} >= 0 and ${t.projected} + ${t.unchanged} <= ${t.batchLimit}`),
  statusCheck: check("business_event_backfill_runs_status_check", sql`${t.status} in ('batch_limit_reached','window_scan_exhausted')`),
}));
