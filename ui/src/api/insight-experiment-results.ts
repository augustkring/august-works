import { insightExperimentPageSchema, insightExperimentDetailSchema, insightExperimentSummarySchema, type InsightExperimentResultPage } from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";

export async function readInsightExperimentResults(companyId: string, userId: string | null, signal: AbortSignal): Promise<InsightExperimentResultPage> {
  insightExperimentDetailSchema.shape.experiment.shape.companyId.parse(companyId);
  const base = `/companies/${companyId}/experiments`;
  const current = async (path: string) => {
    signal.throwIfAborted(); const bound = userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
    detachInflightGet(bound); return api.get<unknown>(bound, { signal, cache: "no-store" });
  };
  try {
    const listed = insightExperimentPageSchema.parse(await current(base));
    if (listed.items.some(item => item.experiment.companyId !== companyId || item.version.companyId !== companyId || item.version.experimentId !== item.experiment.id || item.version.id !== item.experiment.currentVersionId) ||
      new Set(listed.items.map(item => item.experiment.id)).size !== listed.items.length) throw new Error();
    const candidates = listed.items.filter(item => ["completed", "analyzing", "decided", "inconclusive", "invalid", "cancelled"].includes(item.experiment.state));
    const items = await Promise.all(candidates.slice(0, 3).map(async item => {
      const id = item.experiment.id, detail = insightExperimentDetailSchema.parse(await current(`${base}/${id}`));
      if (detail.experiment.id !== id || detail.experiment.companyId !== companyId || detail.experiment.currentVersionId !== item.experiment.currentVersionId ||
        detail.experiment.revision !== item.experiment.revision || detail.experiment.state !== item.experiment.state ||
        detail.versions.some(value => value.companyId !== companyId || value.experimentId !== id) || new Set(detail.versions.map(value => value.id)).size !== detail.versions.length) throw new Error();
      const pin = detail.versions.find(value => value.id === item.experiment.currentVersionId);
      if (!pin || pin.contentHash !== item.version.contentHash) throw new Error();
      // This Original projection performs full Source/receipt requalification
      // but never transfers participant/unit assignment or exposure registers.
      const summary = insightExperimentSummarySchema.parse(await current(`${base}/${id}/versions/${pin.id}/analysis-summary`));
      if (summary.companyId !== companyId || summary.experimentId !== id || summary.versionId !== pin.id || summary.definitionHash !== pin.contentHash || summary.expiresAt !== pin.expiresAt) throw new Error();
      const analysis = summary.analysis;
      if (analysis) {
        if (analysis.companyId !== companyId || analysis.experimentId !== id || analysis.versionId !== pin.id || analysis.definitionHash !== pin.contentHash || analysis.result.definitionHash !== pin.contentHash) throw new Error();
        const declared = [ { ...pin.definition.primaryMetric, role: "primary" }, ...pin.definition.guardrailMetrics.map(value => ({ ...value, role: "guardrail" })), ...pin.definition.secondaryMetrics.map(value => ({ ...value, role: "exploratory" })) ];
        if (new Set(analysis.result.metrics.map(value => value.key)).size !== analysis.result.metrics.length ||
          analysis.result.metrics.some(value => !declared.some(pin => pin.key === value.key && pin.role === value.role)) ||
          analysis.result.numericallyQualified && analysis.result.metrics.length !== declared.length) throw new Error();
        const counts = analysis.result.diagnostics;
        // The Original kernel can reject integrity before counting arms. Those
        // partial diagnostics are not a qualified zero/population summary.
        if (analysis.result.numericallyQualified && (counts.control + counts.treatment !== counts.assigned || counts.exposed > counts.assigned ||
          analysis.result.metrics.some(value => value.control.units !== counts.control || value.treatment.units !== counts.treatment))) throw new Error();
      }
      if (summary.interpretation && (!analysis || summary.interpretation.analysisId !== analysis.id)) throw new Error();
      signal.throwIfAborted();
      return { experimentId: id, state: detail.experiment.state, definition: pin.definition, expiresAt: pin.expiresAt,
        currentQualification: pin.currentQualification, summary };
    }));
    signal.throwIfAborted(); return { items, hasMoreExperiments: listed.nextCursor !== null || candidates.length > 3, boundedPage: true };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error && typeof error === "object" && "status" in error) throw error;
    throw new Error("insight_experiment_results_unavailable");
  }
}
