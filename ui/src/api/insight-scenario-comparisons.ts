import { insightScenarioPageSchema, insightScenarioDetailSchema, insightScenarioRunsSchema, type InsightScenarioComparisonPage } from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";

/** Reads retained Original conditional results; never executes a scenario,
 * republishes assumptions or creates a commitment while visiting Insights. */
export async function readInsightScenarioComparisons(companyId: string, userId: string | null, signal: AbortSignal): Promise<InsightScenarioComparisonPage> {
  insightScenarioDetailSchema.shape.scenario.shape.companyId.parse(companyId);
  const base = `/companies/${companyId}/business-scenarios`;
  const current = async (path: string) => {
    signal.throwIfAborted();
    const bound = userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
    detachInflightGet(bound); return api.get<unknown>(bound, { signal, cache: "no-store" });
  };
  try {
    const listed = insightScenarioPageSchema.parse(await current(base));
    if (listed.items.some(item => item.scenario.companyId !== companyId || item.version.companyId !== companyId || item.version.scenarioId !== item.scenario.id) ||
      new Set(listed.items.map(item => item.scenario.id)).size !== listed.items.length) throw new Error();
    const published = listed.items.filter(item => item.scenario.status === "published" && item.scenario.publishedVersionId);
    const items = await Promise.all(published.slice(0, 3).map(async item => {
      const id = item.scenario.id, detail = insightScenarioDetailSchema.parse(await current(`${base}/${id}`));
      if (detail.scenario.id !== id || detail.scenario.companyId !== companyId || detail.scenario.status !== "published" ||
        detail.scenario.publishedVersionId !== item.scenario.publishedVersionId ||
        detail.versions.some(value => value.companyId !== companyId || value.scenarioId !== id) || new Set(detail.versions.map(value => value.id)).size !== detail.versions.length) throw new Error();
      // Native list displays the latest draft version. A proposed revision must
      // not substitute for the exact current published model in this card.
      const pin = detail.versions.find(value => value.id === item.scenario.publishedVersionId);
      if (!pin) throw new Error();
      const history = insightScenarioRunsSchema.parse(await current(`${base}/${id}/runs`));
      if (history.items.some(run => run.companyId !== companyId || run.scenarioId !== id) || new Set(history.items.map(value => value.id)).size !== history.items.length) throw new Error();
      const run = history.items.find(value => value.versionId === pin.id) ?? null;
      if (run) {
        if (run.result.definitionHash !== pin.contentHash || run.result.inputHash !== pin.inputHash) throw new Error();
        if (new Set(run.result.cases.map(value => value.key)).size !== run.result.cases.length ||
          run.result.cases.some(value => {
            const declared = pin.definition.cases.find(item => item.key === value.key);
            return !declared || value.kind !== declared.kind || value.name !== declared.name ||
              new Set(value.outputs.map(output => output.key)).size !== value.outputs.length ||
              value.outputs.some(output => {
                const declaredOutput = pin.definition.outputs.find(item => item.key === output.key);
                return !declaredOutput || JSON.stringify(output.unit) !== JSON.stringify(declaredOutput.unit);
              }) || value.outputs.length !== pin.definition.outputs.length;
          }) || run.result.status === "calculated" && run.result.cases.length !== pin.definition.cases.length) throw new Error();
      }
      signal.throwIfAborted();
      return { scenarioId: id, definition: pin.definition, expiresAt: pin.expiresAt, currentQualification: pin.currentQualification, run,
        hasMoreRuns: history.nextCursor !== null || history.items.length > (run ? 1 : 0) };
    }));
    signal.throwIfAborted(); return { items, boundedPage: true, hasMoreScenarios: listed.nextCursor !== null || published.length > 3 };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error && typeof error === "object" && "status" in error) throw error;
    throw new Error("insight_scenario_comparison_unavailable");
  }
}
