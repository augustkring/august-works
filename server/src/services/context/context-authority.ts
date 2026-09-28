import type {
  ContextAuthorityDecision,
  ContextAuthorityPolicy,
  ContextAuthorityReason,
  ContextEligibilityResult,
  EvidenceItem,
  EvidenceSensitivity,
} from "@paperclipai/shared";

const SENSITIVITY_RANK: Record<EvidenceSensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function selectorRank(
  evidence: EvidenceItem,
  rule: ContextAuthorityPolicy["rules"][number],
): number | null {
  const rank = rule.preferredSources.findIndex(
    (selector) =>
      selector.sourceClass === evidence.sourceClass &&
      (selector.sourceProvider === undefined ||
        selector.sourceProvider === evidence.sourceProvider),
  );
  return rank >= 0 ? rank : null;
}

export function evidenceIsTemporallyApplicable(
  evidence: EvidenceItem,
  asOf: Date,
): boolean {
  const asOfMs = asOf.getTime();
  if (evidence.validFrom && new Date(evidence.validFrom).getTime() > asOfMs) {
    return false;
  }
  if (evidence.validUntil && new Date(evidence.validUntil).getTime() <= asOfMs) {
    return false;
  }
  return true;
}

export function evidenceWithinSensitivityCeiling(
  evidence: EvidenceItem,
  ceiling: EvidenceSensitivity,
): boolean {
  return SENSITIVITY_RANK[evidence.sensitivity] <= SENSITIVITY_RANK[ceiling];
}

export function filterEligibleEvidence(
  evidence: EvidenceItem[],
  input: {
    asOf: Date;
    sensitivityCeiling: EvidenceSensitivity;
  },
): ContextEligibilityResult {
  const eligible: EvidenceItem[] = [];
  const excluded: ContextEligibilityResult["excluded"] = [];

  for (const item of evidence) {
    if (item.validFrom && new Date(item.validFrom).getTime() > input.asOf.getTime()) {
      excluded.push({ evidenceId: item.id, reason: "not_yet_valid" });
      continue;
    }
    if (item.validUntil && new Date(item.validUntil).getTime() <= input.asOf.getTime()) {
      excluded.push({ evidenceId: item.id, reason: "expired" });
      continue;
    }
    if (!evidenceWithinSensitivityCeiling(item, input.sensitivityCeiling)) {
      excluded.push({ evidenceId: item.id, reason: "sensitivity_ceiling" });
      continue;
    }
    eligible.push(item);
  }

  return { eligible, excluded };
}

export function resolveEvidenceAuthority(
  evidence: EvidenceItem[],
  policy: ContextAuthorityPolicy,
): ContextAuthorityDecision[] {
  const ruleByDomain = new Map(
    policy.rules.map((rule) => [rule.authorityDomain, rule] as const),
  );

  const availableRankByDomain = new Map<string, number>();
  for (const item of evidence) {
    if (!item.authorityDomain) continue;
    const rule = ruleByDomain.get(item.authorityDomain);
    if (!rule) continue;
    const rank = selectorRank(item, rule);
    if (rank === null) continue;
    const current = availableRankByDomain.get(item.authorityDomain);
    if (current === undefined || rank < current) {
      availableRankByDomain.set(item.authorityDomain, rank);
    }
  }

  return evidence.map((item) => {
    if (!item.authorityDomain) {
      return {
        evidence: item,
        authorityRank: null,
        primaryForDomain: false,
        reason: "unconfigured_domain" as ContextAuthorityReason,
      };
    }

    const rule = ruleByDomain.get(item.authorityDomain);
    if (!rule) {
      return {
        evidence: item,
        authorityRank: null,
        primaryForDomain: false,
        reason: "unconfigured_domain" as ContextAuthorityReason,
      };
    }

    const rank = selectorRank(item, rule);
    if (rank === null) {
      return {
        evidence: item,
        authorityRank: null,
        primaryForDomain: false,
        reason: "non_authoritative_source" as ContextAuthorityReason,
      };
    }

    const availableRank = availableRankByDomain.get(item.authorityDomain);
    const primaryForDomain = availableRank === rank;
    return {
      evidence: item,
      authorityRank: rank,
      primaryForDomain,
      reason: primaryForDomain
        ? rank === 0
          ? "preferred_authority"
          : "authority_fallback"
        : "lower_authority",
    };
  });
}

export function orderEvidenceByAuthority(
  decisions: ContextAuthorityDecision[],
): ContextAuthorityDecision[] {
  return decisions
    .map((decision, index) => ({ decision, index }))
    .sort((left, right) => {
      if (left.decision.primaryForDomain !== right.decision.primaryForDomain) {
        return left.decision.primaryForDomain ? -1 : 1;
      }
      const leftRank = left.decision.authorityRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.decision.authorityRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map(({ decision }) => decision);
}
