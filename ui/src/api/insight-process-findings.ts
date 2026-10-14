import { insightProcessDefinitionsSchema, insightProcessDetailSchema, insightProcessRunsSchema, insightProcessFindingsSchema, type InsightProcessFindingPage } from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";

/** Read retained Original definitions/runs/findings. Never run an analysis or
 * create/transition a finding while visiting the customer Insights surface. */
export async function readInsightProcessFindings(companyId: string, userId: string | null, signal: AbortSignal): Promise<InsightProcessFindingPage> {
  insightProcessDetailSchema.shape.root.shape.companyId.parse(companyId);
  const base = `/companies/${companyId}/process-definitions`;
  const current = async (path: string) => {
    signal.throwIfAborted();
    const bound = userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
    detachInflightGet(bound);
    return api.get<unknown>(bound, { signal, cache: "no-store" });
  };
  try {
    const listed = insightProcessDefinitionsSchema.parse(await current(base));
    if (listed.items.some(item => item.companyId !== companyId) || new Set(listed.items.map(item => item.id)).size !== listed.items.length) throw new Error();
    const published = listed.items.filter(item => item.status === "published" && item.publishedVersionId);
    const items = await Promise.all(published.slice(0, 3).map(async item => {
      const detail = insightProcessDetailSchema.parse(await current(`${base}/${item.id}`));
      const pin = detail.effectiveVersion;
      if (detail.root.id !== item.id || detail.root.companyId !== companyId || detail.root.status !== "published" ||
        detail.root.publishedVersionId !== item.publishedVersionId || pin.id !== item.publishedVersionId || pin.companyId !== companyId || pin.definitionId !== item.id) throw new Error();
      const history = insightProcessRunsSchema.parse(await current(`${base}/${item.id}/runs`));
      if (history.items.some(run => run.companyId !== companyId || run.definitionId !== item.id) || new Set(history.items.map(run => run.id)).size !== history.items.length) throw new Error();
      // Original UUID ordering is not a latest-result ranking. Retained runs
      // for previous published definitions remain accessible in their owner UI.
      const run = history.items.find(run => run.versionId === pin.id) ?? null;
      if (run && run.definitionHash !== pin.contentHash) throw new Error();
      const found = run ? insightProcessFindingsSchema.parse(await current(`${base}/${item.id}/runs/${run.id}/findings`)) : { items: [], nextCursor: null };
      if (found.items.some(finding => finding.companyId !== companyId || finding.definitionId !== item.id || finding.analysisRunId !== run!.id ||
        finding.definitionHash !== pin.contentHash || finding.eventSetHash !== run!.eventSetHash || Date.parse(finding.expiresAt) > Date.parse(run!.expiresAt)) ||
        new Set(found.items.map(finding => finding.id)).size !== found.items.length) throw new Error();
      signal.throwIfAborted();
      return { definitionId: item.id, name: pin.definition.name, businessQuestion: pin.definition.businessQuestion, expiresAt: pin.expiresAt,
        run, findings: found.items.slice(0, 3), hasMoreEvidence: history.nextCursor !== null || history.items.length > (run ? 1 : 0) || found.nextCursor !== null || found.items.length > 3 };
    }));
    signal.throwIfAborted();
    return { items, hasMoreDefinitions: listed.nextCursor !== null || published.length > 3, boundedPage: true };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error && typeof error === "object" && "status" in error) throw error;
    throw new Error("insight_process_findings_unavailable");
  }
}
