import {sql} from "drizzle-orm";
import {check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,unique,uuid,type PgTableExtraConfigValue} from "drizzle-orm/pg-core";
import type {CausalClaimDefinition,CausalClaimStatus,NativeCausalResult} from "@paperclipai/shared";
import {companies} from "./companies.js";
import {analyticalLineageManifests} from "./analytical_lineage.js";
import {businessMetricVersions} from "./business_metrics.js";
import {businessExperimentAnalyses,businessExperimentInterpretations} from "./business_experiments.js";

export const causalClaims=pgTable("causal_claims",{
 id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id,{onDelete:"cascade"}),key:text("claim_key").notNull(),revision:integer("revision").notNull().default(1),status:text("status").$type<CausalClaimStatus>().notNull().default("hypothesis"),currentVersionId:uuid("current_version_id"),reviewedVersionId:uuid("reviewed_version_id"),latestRunId:uuid("latest_run_id"),createdBy:text("created_by").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull(),
},(t):PgTableExtraConfigValue[]=>[
 unique("causal_claims_tenant_uq").on(t.companyId,t.id),unique("causal_claims_key_uq").on(t.companyId,t.key),
 foreignKey({name:"causal_claims_current_version_fk",columns:[t.companyId,t.id,t.currentVersionId],foreignColumns:[causalClaimVersions.companyId,causalClaimVersions.claimId,causalClaimVersions.id]}).onDelete("cascade"),
 foreignKey({name:"causal_claims_reviewed_version_fk",columns:[t.companyId,t.id,t.reviewedVersionId],foreignColumns:[causalClaimVersions.companyId,causalClaimVersions.claimId,causalClaimVersions.id]}).onDelete("cascade"),
 foreignKey({name:"causal_claims_latest_run_fk",columns:[t.companyId,t.id,t.latestRunId],foreignColumns:[causalAnalysisRuns.companyId,causalAnalysisRuns.claimId,causalAnalysisRuns.id]}).onDelete("cascade"),
 check("causal_claims_state_check",sql`${t.revision}>0 and ${t.status} in ('hypothesis','association','supported','refuted','inconclusive','expired','revoked') and ${t.updatedAt}>=${t.createdAt}`),
]);
export const causalClaimVersions=pgTable("causal_claim_versions",{
 id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull(),claimId:uuid("claim_id").notNull(),revision:integer("revision").notNull(),definition:jsonb("definition_json").$type<CausalClaimDefinition>().notNull(),contentHash:text("content_hash").notNull(),sourceHash:text("source_hash"),outcomeMetricId:uuid("outcome_metric_id").notNull(),outcomeMetricVersionId:uuid("outcome_metric_version_id").notNull(),experimentId:uuid("experiment_id"),experimentVersionId:uuid("experiment_version_id"),analysisId:uuid("analysis_id"),interpretationId:uuid("interpretation_id"),lineageManifestId:uuid("lineage_manifest_id").notNull(),rationale:text("rationale").notNull(),createdBy:text("created_by").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
},t=>({
 tenantUq:unique("causal_claim_versions_tenant_uq").on(t.companyId,t.claimId,t.id),revisionUq:unique("causal_claim_versions_revision_uq").on(t.companyId,t.claimId,t.revision),
 rootFk:foreignKey({name:"causal_claim_versions_root_fk",columns:[t.companyId,t.claimId],foreignColumns:[causalClaims.companyId,causalClaims.id]}).onDelete("cascade"),
 metricFk:foreignKey({name:"causal_claim_versions_metric_fk",columns:[t.companyId,t.outcomeMetricId,t.outcomeMetricVersionId],foreignColumns:[businessMetricVersions.companyId,businessMetricVersions.metricId,businessMetricVersions.id]}).onDelete("cascade"),
 analysisFk:foreignKey({name:"causal_claim_versions_analysis_fk",columns:[t.companyId,t.experimentId,t.experimentVersionId,t.analysisId],foreignColumns:[businessExperimentAnalyses.companyId,businessExperimentAnalyses.experimentId,businessExperimentAnalyses.versionId,businessExperimentAnalyses.id]}).onDelete("cascade"),
 interpretationFk:foreignKey({name:"causal_claim_versions_interpretation_fk",columns:[t.companyId,t.experimentId,t.experimentVersionId,t.analysisId,t.interpretationId],foreignColumns:[businessExperimentInterpretations.companyId,businessExperimentInterpretations.experimentId,businessExperimentInterpretations.versionId,businessExperimentInterpretations.analysisId,businessExperimentInterpretations.id]}).onDelete("cascade"),
 lineageFk:foreignKey({name:"causal_claim_versions_lineage_fk",columns:[t.companyId,t.lineageManifestId],foreignColumns:[analyticalLineageManifests.companyId,analyticalLineageManifests.id]}).onDelete("cascade"),
 contentCheck:check("causal_claim_versions_content_check",sql`${t.revision}>0 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and jsonb_typeof(${t.definition})='object' and ${t.expiresAt}>${t.createdAt} and length(btrim(${t.rationale})) between 10 and 2000`),
 sourceCheck:check("causal_claim_versions_source_check",sql`(${t.analysisId} is null and ${t.experimentId} is null and ${t.experimentVersionId} is null and ${t.interpretationId} is null and ${t.sourceHash} is null) or (${t.analysisId} is not null and ${t.experimentId} is not null and ${t.experimentVersionId} is not null and ${t.interpretationId} is not null and ${t.sourceHash} is not null and ${t.sourceHash} ~ '^[0-9a-f]{64}$')`),
}));
export const causalClaimReviews=pgTable("causal_claim_reviews",{
 id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull(),claimId:uuid("claim_id").notNull(),versionId:uuid("version_id").notNull(),definitionHash:text("definition_hash").notNull(),sourceHash:text("source_hash"),rationale:text("rationale").notNull(),receiptHash:text("receipt_hash").notNull(),signature:text("signature").notNull(),reviewedBy:text("reviewed_by").notNull(),reviewedAt:timestamp("reviewed_at",{withTimezone:true}).notNull(),
},t=>({
 versionUq:unique("causal_claim_reviews_version_uq").on(t.companyId,t.claimId,t.versionId),tenantUq:unique("causal_claim_reviews_tenant_uq").on(t.companyId,t.claimId,t.versionId,t.id),
 versionFk:foreignKey({name:"causal_claim_reviews_version_fk",columns:[t.companyId,t.claimId,t.versionId],foreignColumns:[causalClaimVersions.companyId,causalClaimVersions.claimId,causalClaimVersions.id]}).onDelete("cascade"),
 contentCheck:check("causal_claim_reviews_content_check",sql`${t.definitionHash} ~ '^[0-9a-f]{64}$' and ${t.receiptHash} ~ '^[0-9a-f]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][0-9a-f]{64}$' and length(btrim(${t.rationale})) between 10 and 2000`),
}));
export const causalAnalysisRuns=pgTable("causal_analysis_runs",{
 id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull(),claimId:uuid("claim_id").notNull(),versionId:uuid("version_id").notNull(),reviewId:uuid("review_id").notNull(),providerKey:text("provider_key").$type<"aw_native_registered_randomization">().notNull(),providerVersion:text("provider_version").notNull(),methodKey:text("method_key").notNull(),analysisPlanHash:text("analysis_plan_hash").notNull(),assumptionsSnapshotHash:text("assumptions_snapshot_hash").notNull(),sourceHash:text("source_hash"),result:jsonb("result_json").$type<NativeCausalResult>().notNull(),receiptHash:text("receipt_hash").notNull(),signature:text("signature").notNull(),createdBy:text("created_by").notNull(),startedAt:timestamp("started_at",{withTimezone:true}).notNull(),completedAt:timestamp("completed_at",{withTimezone:true}).notNull(),
},t=>({
 tenantUq:unique("causal_analysis_runs_tenant_uq").on(t.companyId,t.claimId,t.id),versionUq:unique("causal_analysis_runs_version_uq").on(t.companyId,t.claimId,t.versionId),
 versionFk:foreignKey({name:"causal_analysis_runs_version_fk",columns:[t.companyId,t.claimId,t.versionId],foreignColumns:[causalClaimVersions.companyId,causalClaimVersions.claimId,causalClaimVersions.id]}).onDelete("cascade"),
 reviewFk:foreignKey({name:"causal_analysis_runs_review_fk",columns:[t.companyId,t.claimId,t.versionId,t.reviewId],foreignColumns:[causalClaimReviews.companyId,causalClaimReviews.claimId,causalClaimReviews.versionId,causalClaimReviews.id]}).onDelete("cascade"),
 contentCheck:check("causal_analysis_runs_content_check",sql`${t.providerKey}='aw_native_registered_randomization' and ${t.providerVersion}='1' and ${t.methodKey}='registered_primary_itt' and ${t.analysisPlanHash} ~ '^[0-9a-f]{64}$' and ${t.assumptionsSnapshotHash} ~ '^[0-9a-f]{64}$' and ${t.receiptHash} ~ '^[0-9a-f]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][0-9a-f]{64}$' and jsonb_typeof(${t.result})='object' and ${t.completedAt}>=${t.startedAt}`),
 timeIdx:index("causal_analysis_runs_claim_time_idx").on(t.companyId,t.claimId,t.completedAt,t.id),
}));
