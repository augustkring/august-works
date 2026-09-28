import type {
  ContextAuthorityDecision,
  ContextBudget,
  ContextBudgetResult,
  ContextEvidenceBucket,
  EvidenceItem,
  EvidenceSourceClass,
} from "@paperclipai/shared";

const SOURCE_BUCKET: Record<EvidenceSourceClass, ContextEvidenceBucket> = {
  foundation: "foundation",
  system_of_record: "connected_evidence",
  accepted_memory: "shared_memory",
  private_memory: "private_memory",
  task: "task_context",
  artifact: "artifacts",
  conversation: "connected_evidence",
  external_untrusted: "connected_evidence",
};

export function evidenceBucket(evidence: EvidenceItem): ContextEvidenceBucket {
  return SOURCE_BUCKET[evidence.sourceClass];
}

export function estimateEvidenceTokens(evidence: EvidenceItem): number {
  const text = [
    evidence.title ?? "",
    evidence.excerpt,
    evidence.citation.label,
    evidence.sourceProvider,
    evidence.sourceType,
  ].join("\n");
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

function emptyBucketCounts(): Record<ContextEvidenceBucket, number> {
  return {
    foundation: 0,
    connected_evidence: 0,
    shared_memory: 0,
    private_memory: 0,
    task_context: 0,
    artifacts: 0,
  };
}

export function fitEvidenceToBudget(
  orderedEvidence: ContextAuthorityDecision[],
  budget: ContextBudget,
): ContextBudgetResult {
  const selected: ContextAuthorityDecision[] = [];
  const excluded: ContextBudgetResult["excluded"] = [];
  const bucketItemCounts = emptyBucketCounts();
  let selectedEstimatedTokens = 0;

  for (const decision of orderedEvidence) {
    const item = decision.evidence;
    const bucket = evidenceBucket(item);
    const estimatedTokens = estimateEvidenceTokens(item);

    if (bucketItemCounts[bucket] >= budget.buckets[bucket].maxItems) {
      excluded.push({
        evidenceId: item.id,
        bucket,
        estimatedTokens,
        reason: "bucket_item_limit",
      });
      continue;
    }
    if (selected.length >= budget.maxItems) {
      excluded.push({
        evidenceId: item.id,
        bucket,
        estimatedTokens,
        reason: "total_item_limit",
      });
      continue;
    }
    if (selectedEstimatedTokens + estimatedTokens > budget.maxEstimatedTokens) {
      excluded.push({
        evidenceId: item.id,
        bucket,
        estimatedTokens,
        reason: "total_token_limit",
      });
      continue;
    }

    selected.push(decision);
    bucketItemCounts[bucket] += 1;
    selectedEstimatedTokens += estimatedTokens;
  }

  return {
    selected,
    excluded,
    selectedEstimatedTokens,
    selectedItemCount: selected.length,
    bucketItemCounts,
  };
}
