import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { experienceCardSchema, parseExperienceToolCardRequest, v8FeatureEnabled, v9FeatureEnabled, type ExperienceToolCardRequest, type ExperienceCard, type V8FeatureKey } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { badRequest, conflict, forbidden, notFound } from "../../errors.js";
import { experienceService } from "./service.js";
import { instanceSettingsService } from "../instance-settings.js";
import { businessMetricService } from "../business-metrics/service.js";
import { processFindingService } from "../process-findings.js";
import { businessScenarioService } from "../business-scenarios/service.js";
import { businessExperimentRecordingService } from "../business-experiments/recording.js";
import { businessForecastService } from "../business-forecasting/service.js";
import { managementReviewService } from "../management-reviews/service.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";

const families = {
  metric: { component: "MetricInsightCard", feature: "business_metrics_v8", count: 1 },
  process: { component: "ProcessFindingCard", feature: "process_intelligence_v8", count: 3 },
  scenario: { component: "ScenarioComparisonCard", feature: "scenario_planning_v8", count: 2 },
  experiment: { component: "ExperimentResultCard", feature: "business_experiments_v8", count: 2 },
  forecast: { component: "ResultCard", feature: "business_forecasting_v8", count: 2 },
  review: { component: "ResultCard", feature: "management_reviews_v8", count: 1 },
} as const;

/** A model supplies references only. The Original owner supplies every title,
 * value, state, version and link after current Source authorization. No writer. */
export async function currentInsightToolCard(db: Db, actor: AuthorizationActor, companyId: string, wire: unknown): Promise<ExperienceCard> {
  let request: ExperienceToolCardRequest;
  try { request = parseExperienceToolCardRequest(wire); } catch { throw badRequest("Invalid Native insight reference"); }
  if (request.companyId !== companyId || request.source.domain !== "insight") throw badRequest("Invalid Native insight reference");
  const [family, ...ids] = request.source.resourceId.split(":");
  if (!Object.hasOwn(families, family)) throw badRequest("Unsupported Native insight reference");
  const config = families[family as keyof typeof families];
  if (ids.length !== config.count || ids.some(id => !z.uuid().safeParse(id).success) || request.component !== config.component || request.cardId !== `insight:${request.source.resourceId}`)
    throw badRequest("Invalid Native insight reference");
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`set local statement_timeout='8s'`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const flags = await instanceSettingsService(tx).getExperimental();
    if (!v9FeatureEnabled(flags, "action_cards_v9") || !v9FeatureEnabled(flags, "experience_projection_v9") || !v8FeatureEnabled(flags, config.feature as V8FeatureKey)) throw notFound("Native insight cards are not enabled");
    const initial = await experienceService(tx).context(actor, companyId);
    if (initial.profile === "member") throw forbidden("The current experience does not admit an insight card");
    let title: string, version: string, observedAt: string, expiresAt: string, evidence: string[], href: string;
    if (family === "metric") {
      const owner = businessMetricService(tx), value = await owner.inspectCurrentObservation(companyId, actor, ids[0]);
      const defined = await owner.inspectPublishedDefinition(companyId, actor, value.metricId, value.versionId);
      if (defined.metric.publishedVersionId !== value.versionId) throw conflict("The Native metric definition changed; refresh its current owner");
      title = defined.version.definition.name; version = `${value.definitionHash}:${value.inputHash}`; observedAt = value.asOf;
      expiresAt = value.expiresAt;
      evidence = ["native_metric_observation", value.status, defined.version.definition.timeSemantics, `window:${value.from}|${value.until}`, `as_of:${value.asOf}`,
        value.status === "observed" && value.value !== null ? `recorded_value:${value.value}|${defined.version.definition.unit}` : "value_unavailable"];
      href = "/business-metrics";
    } else if (family === "process") {
      const value = (await processFindingService(tx).detail(companyId, actor, ids[0], ids[1], ids[2])).finding;
      title = value.summary; version = `${value.contentHash}:${value.version}`; observedAt = value.authorizationCheckedAt;
      expiresAt = value.expiresAt;
      evidence = ["native_process_finding", value.status, value.severity, "human_interpretation_not_established_cause"]; href = "/process-intelligence";
    } else if (family === "scenario") {
      const value = await businessScenarioService(tx).result(companyId, actor, ids[0], ids[1]);
      if (value.currentQualification !== "current" || value.result.status !== "calculated") throw conflict("The Native scenario requires current qualification");
      title = "Recorded conditional scenario"; version = value.contentHash; observedAt = value.createdAt;
      expiresAt = value.expiresAt;
      evidence = ["native_conditional_scenario", "assumptions_not_proven", "no_decision_or_commitment"]; href = "/business-scenarios";
    } else if (family === "experiment") {
      const value = await businessExperimentRecordingService(tx).analysisSummary(companyId, actor, ids[0], ids[1]);
      if (value.currentQualification !== "current" || !value.analysis || value.analysis.currentQualification !== "current") throw conflict("The Native experiment requires current qualification");
      title = "Recorded experiment analysis"; version = `${value.analysis.receiptHash}:${value.interpretation?.receiptHash ?? "none"}`; observedAt = value.analysis.analyzedAt;
      expiresAt = value.expiresAt;
      evidence = ["native_experiment_analysis", value.analysis.result.status, "human_attested_exposure", "advisory_not_rollout_authority"]; href = "/business-experiments";
    } else if (family === "forecast") {
      const value = await businessForecastService(tx).artifact(companyId, actor, ids[0], ids[1], "run");
      if (value.currentQualification !== "qualified" || value.result.status !== "qualified") throw conflict("The Native forecast requires current qualification");
      title = "Recorded forecast estimate"; version = value.contentHash; observedAt = value.createdAt;
      expiresAt = value.expiresAt;
      evidence = ["native_forecast_run", `cutoff:${value.cutoff}`, "backtest_not_future_accuracy", "no_decision_or_commitment"]; href = "/business-forecasts";
    } else {
      const value = await managementReviewService(tx).summary(companyId, actor, ids[0]);
      if (value.status !== "published" || value.currentQualification !== "current") throw conflict("The Native review requires current published sources");
      title = value.name; version = value.contentHash; observedAt = value.packet.asOf;
      expiresAt = value.expiresAt;
      evidence = ["native_historical_review", "selected_sources_not_complete_census", "human_agenda_not_decision_or_approval"]; href = "/management-reviews";
    }
    if (request.source.version !== version) throw conflict("The Native insight version changed; refresh its current owner");
    const current = await experienceService(tx).context(actor, companyId);
    if (current.principal !== initial.principal || current.profile === "member") throw forbidden("Current Native insight display authority is required");
    const finalFlags = await instanceSettingsService(tx).getExperimental();
    if (!v9FeatureEnabled(finalFlags, "action_cards_v9") || !v9FeatureEnabled(finalFlags, "experience_projection_v9") || !v8FeatureEnabled(finalFlags, config.feature as V8FeatureKey)) throw notFound("Native insight cards are no longer enabled");
    const source = { ...request.source, version, observedAt };
    const deadline = Math.min(Date.parse(expiresAt), Date.now() + 30_000);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) throw conflict("Native insight retention expired; refresh its current owner");
    return experienceCardSchema.parse({ id: request.cardId, kind: config.component === "ResultCard" ? "result" : "insight", title,
      whyYou: null, consequence: "Native insight evidence is read-only. Review its source and limitations before using it.", source, freshness: "fresh", displayExpiresAt: new Date(deadline).toISOString(), evidence,
      actions: [{ id: "inspect", label: "Review current Native evidence", operation: "open", href, criticality: "C2", source, requiresCurrentAuthorization: true }] });
  });
}
