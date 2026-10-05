import type { CognitiveMemoryProvider, CognitiveRecallRequest, CognitiveScope, GovernedMemoryProjection } from "@paperclipai/shared";
import { forbidden, unprocessable } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
function assertScope(scope: CognitiveScope, records: Array<{ companyId: string }>) {
  if (records.some((record) => record.companyId !== scope.companyId)) throw forbidden("Cognitive provider input crosses a company boundary");
}
export function assertCognitiveRecallUniverse(input: CognitiveRecallRequest, hits: Awaited<ReturnType<CognitiveMemoryProvider["recall"]>>) {
  const allowed = new Map(input.allowedRecords.map((record) => [record.id, record]));
  if (hits.length > input.topK || new Set(hits.map((hit) => hit.id)).size !== hits.length || hits.some((hit) => {
    const source = allowed.get(hit.id);
    return !source || hit.companyId !== input.scope.companyId || hit.version !== source.version || !Number.isFinite(hit.score);
  })) throw forbidden("Cognitive provider returned evidence outside the currently authorized universe", { code: "cognitive_universe_violation" });
}
export function localCognitiveProvider(providerKey: "local_baseline" | "noop" = "local_baseline"): CognitiveMemoryProvider {
  const receipt = (scope: CognitiveScope, records: unknown) => nativeSha256({ schema: "stateless-provider-receipt.v1", providerKey, scope, records });
  return {
    providerKey,
    async upsertGovernedRecords(scope, records, signal) { signal?.throwIfAborted(); assertScope(scope, records); return { receipt: receipt(scope, records.map(({ id, version }) => ({ id, version }))), count: records.length }; },
    async deleteGovernedRecords(scope, records, signal) { signal?.throwIfAborted(); return { receipt: receipt(scope, records), count: records.length }; },
    async recall(input) {
      input.signal?.throwIfAborted(); assertScope(input.scope, input.allowedRecords);
      if (providerKey === "noop") return [];
      const tokens = [...new Set(input.query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 32);
      return input.allowedRecords.map((record) => ({ id: record.id, companyId: record.companyId, version: record.version,
        score: tokens.filter((token) => record.content.normalize("NFKC").toLowerCase().includes(token)).length }))
        .filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, input.topK);
    },
    async synthesize(input) {
      const hits = await this.recall(input), sources = hits.map((hit) => input.allowedRecords.find((record) => record.id === hit.id)!);
      return { content: sources.map((record) => `[${record.id}] ${record.content}`).join("\n\n").slice(0, 64000), evidenceIds: sources.map((record) => record.id) };
    },
    async health() { return { status: "healthy" }; },
    async conformance() { return { schema: "aw.cognitive-conformance.v1", providerKey, providerVersion: "1", storage: "stateless", governedOnly: true, scopedRecall: true, deletionReceipts: true, synthesis: providerKey !== "noop" }; },
  };
}
export function cognitiveProviderForKey(key: string) {
  if (key !== "local_baseline" && key !== "noop") throw unprocessable("This cognitive provider has not been qualified for use");
  return localCognitiveProvider(key);
}
export function cognitiveProjection(record: { id: string; companyId: string; updatedAt: Date; summary: string | null; content: string; sensitivityLabel: GovernedMemoryProjection["sensitivity"]; validFrom: Date | null; validUntil: Date | null; expiresAt: Date | null }): GovernedMemoryProjection {
  const deadlines = [record.validUntil, record.expiresAt].filter((date): date is Date => date !== null);
  return { id: record.id, companyId: record.companyId, version: record.updatedAt.toISOString(), content: (record.summary ?? record.content).slice(0, 16000),
    sensitivity: record.sensitivityLabel, validFrom: record.validFrom?.toISOString() ?? null, validUntil: deadlines.length ? new Date(Math.min(...deadlines.map((date) => date.getTime()))).toISOString() : null,
    sourceRefs: [`memory://record/${record.id}`] };
}
