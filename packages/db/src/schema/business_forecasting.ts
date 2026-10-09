import {sql} from "drizzle-orm";
import {check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,unique,uuid,type PgTableExtraConfigValue} from "drizzle-orm/pg-core";
import type {BusinessForecastDefinition,NativeBusinessForecastResult,BusinessForecastSeriesPoint} from "@paperclipai/shared";
import {companies} from "./companies.js";
import {analyticalLineageManifests} from "./analytical_lineage.js";

export const forecastSpecs=pgTable("forecast_specs",{
  id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id,{onDelete:"cascade"}),
  key:text("spec_key").notNull(),revision:integer("revision").notNull().default(1),status:text("status").$type<"draft"|"published"|"retired">().notNull().default("draft"),
  publishedVersionId:uuid("published_version_id"),createdBy:text("created_by").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},(t):PgTableExtraConfigValue[]=>[
  unique("forecast_specs_tenant_uq").on(t.companyId,t.id),unique("forecast_specs_key_uq").on(t.companyId,t.key),
  foreignKey({name:"forecast_specs_published_fk",columns:[t.companyId,t.id,t.publishedVersionId],foreignColumns:[forecastSpecVersions.companyId,forecastSpecVersions.specId,forecastSpecVersions.id]}).onDelete("cascade"),
  check("forecast_specs_state_check",sql`${t.revision}>0 and ${t.status} in ('draft','published','retired') and (${t.status}<>'published' or ${t.publishedVersionId} is not null)`),
]);
export const forecastSpecVersions=pgTable("forecast_spec_versions",{
  id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull(),specId:uuid("spec_id").notNull(),revision:integer("revision").notNull(),
  definition:jsonb("definition_json").$type<BusinessForecastDefinition>().notNull(),contentHash:text("content_hash").notNull(),lineageManifestId:uuid("lineage_manifest_id").notNull(),createdBy:text("created_by").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
},t=>({
  tenantUq:unique("forecast_spec_versions_tenant_uq").on(t.companyId,t.specId,t.id),revisionUq:unique("forecast_spec_versions_revision_uq").on(t.companyId,t.specId,t.revision),
  specFk:foreignKey({name:"forecast_spec_versions_spec_fk",columns:[t.companyId,t.specId],foreignColumns:[forecastSpecs.companyId,forecastSpecs.id]}).onDelete("cascade"),
  lineageFk:foreignKey({name:"forecast_spec_versions_lineage_fk",columns:[t.companyId,t.lineageManifestId],foreignColumns:[analyticalLineageManifests.companyId,analyticalLineageManifests.id]}).onDelete("cascade"),
  definitionCheck:check("forecast_spec_versions_content_check",sql`${t.revision}>0 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and jsonb_typeof(${t.definition})='object' and ${t.expiresAt}>${t.createdAt}`),
}));
function artifactColumns() {return {
  id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull(),specId:uuid("spec_id").notNull(),versionId:uuid("version_id").notNull(),
  lineageManifestId:uuid("lineage_manifest_id").notNull(),definitionHash:text("definition_hash").notNull(),inputHash:text("input_hash").notNull(),contentHash:text("content_hash").notNull(),
  series:jsonb("series_json").$type<BusinessForecastSeriesPoint[]>().notNull(),result:jsonb("result_json").$type<NativeBusinessForecastResult>().notNull(),
  cutoff:timestamp("cutoff",{withTimezone:true}).notNull(),createdBy:text("created_by").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
};}
export const forecastBacktests=pgTable("forecast_backtests",artifactColumns(),t=>({
  tenantUq:unique("forecast_backtests_tenant_uq").on(t.companyId,t.specId,t.versionId,t.id),
  versionFk:foreignKey({name:"forecast_backtests_version_fk",columns:[t.companyId,t.specId,t.versionId],foreignColumns:[forecastSpecVersions.companyId,forecastSpecVersions.specId,forecastSpecVersions.id]}).onDelete("cascade"),
  lineageFk:foreignKey({name:"forecast_backtests_lineage_fk",columns:[t.companyId,t.lineageManifestId],foreignColumns:[analyticalLineageManifests.companyId,analyticalLineageManifests.id]}).onDelete("cascade"),
  contentCheck:check("forecast_backtests_content_check",sql`${t.definitionHash} ~ '^[0-9a-f]{64}$' and ${t.inputHash} ~ '^[0-9a-f]{64}$' and ${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.expiresAt}>${t.createdAt} and ${t.cutoff}<=${t.createdAt} and jsonb_typeof(${t.series})='array' and jsonb_typeof(${t.result})='object'`),
  specTimeIdx:index("forecast_backtests_spec_time_idx").on(t.companyId,t.specId,t.createdAt,t.id),
}));
export const forecastPublications=pgTable("forecast_publications",{
  companyId:uuid("company_id").notNull(),specId:uuid("spec_id").notNull(),versionId:uuid("version_id").notNull(),backtestId:uuid("backtest_id").notNull(),
  publishedBy:text("published_by").notNull(),rationale:text("rationale").notNull(),publishedAt:timestamp("published_at",{withTimezone:true}).notNull(),
},t=>({
  versionUq:unique("forecast_publications_version_uq").on(t.companyId,t.specId,t.versionId),
  backtestFk:foreignKey({name:"forecast_publications_backtest_fk",columns:[t.companyId,t.specId,t.versionId,t.backtestId],foreignColumns:[forecastBacktests.companyId,forecastBacktests.specId,forecastBacktests.versionId,forecastBacktests.id]}).onDelete("cascade"),
  rationaleCheck:check("forecast_publications_rationale_check",sql`length(btrim(${t.rationale})) between 10 and 2000`),
}));
export const forecastRuns=pgTable("forecast_runs",artifactColumns(),t=>({
  tenantUq:unique("forecast_runs_tenant_uq").on(t.companyId,t.id),
  versionFk:foreignKey({name:"forecast_runs_version_fk",columns:[t.companyId,t.specId,t.versionId],foreignColumns:[forecastSpecVersions.companyId,forecastSpecVersions.specId,forecastSpecVersions.id]}).onDelete("cascade"),
  lineageFk:foreignKey({name:"forecast_runs_lineage_fk",columns:[t.companyId,t.lineageManifestId],foreignColumns:[analyticalLineageManifests.companyId,analyticalLineageManifests.id]}).onDelete("cascade"),
  contentCheck:check("forecast_runs_content_check",sql`${t.definitionHash} ~ '^[0-9a-f]{64}$' and ${t.inputHash} ~ '^[0-9a-f]{64}$' and ${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.expiresAt}>${t.createdAt} and ${t.cutoff}<=${t.createdAt} and jsonb_typeof(${t.series})='array' and jsonb_typeof(${t.result})='object'`),
  specTimeIdx:index("forecast_runs_spec_time_idx").on(t.companyId,t.specId,t.createdAt,t.id),
}));
