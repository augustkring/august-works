import { insightManagementControlsSchema, insightManagementSummarySchema, type InsightManagementReviewPage } from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";
export async function readInsightManagementReviewSummaries(companyId: string, userId: string | null, signal: AbortSignal): Promise<InsightManagementReviewPage> {
  insightManagementSummarySchema.shape.companyId.parse(companyId);
  const base = `/companies/${companyId}/management-reviews`;
  const current = async (path: string) => { signal.throwIfAborted(); const bound = userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
    detachInflightGet(bound); return api.get<unknown>(bound, { signal, cache: "no-store" }); };
  try {
    const controls = insightManagementControlsSchema.parse(await current(`${base}/controls`));
    if (new Set(controls.items.map(item => item.id)).size !== controls.items.length) throw new Error();
    const published = controls.items.filter(item => item.status === "published");
    const items = await Promise.all(published.slice(0, 3).map(async item => {
      const summary = insightManagementSummarySchema.parse(await current(`${base}/${item.id}/summary`));
      if (summary.companyId !== companyId || summary.id !== item.id || summary.status !== "published" || summary.publishedAt === null || summary.expiresAt !== item.expiresAt || summary.createdAt !== item.createdAt ||
        summary.packet.definitionHash !== summary.definitionHash || summary.packet.contentHash !== summary.contentHash || new Set(summary.sourceKeys).size !== summary.sourceKeys.length) throw new Error();
      const declared = new Set(summary.sourceKeys);
      if (new Set(summary.packet.claims.map(value => value.key)).size !== summary.packet.claims.length || new Set(summary.packet.agenda.map(value => value.key)).size !== summary.packet.agenda.length ||
        [...summary.packet.claims, ...summary.packet.agenda].some(value => value.sourceKeys.some(key => !declared.has(key)) || new Set(value.sourceKeys).size !== value.sourceKeys.length) ||
        summary.packet.agenda.some(value => (value.hypothesis === null) !== (value.hypothesisAuthority === "none"))) throw new Error();
      signal.throwIfAborted(); return summary;
    }));
    signal.throwIfAborted(); return { items, hasMoreReviews: controls.nextCursor !== null || published.length > 3, boundedPage: true };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error && typeof error === "object" && "status" in error) throw error;
    throw new Error("insight_management_review_unavailable");
  }
}
