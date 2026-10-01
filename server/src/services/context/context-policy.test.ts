import { describe, expect, it } from "vitest";
import type {
  ContextAuthorityPolicy,
  ContextBudget,
  EvidenceItem,
} from "@paperclipai/shared";
import {
  filterEligibleEvidence,
  orderEvidenceByAuthority,
  resolveEvidenceAuthority,
} from "./context-authority.js";
import {
  evidenceBucket,
  estimateEvidenceTokens,
  fitEvidenceToBudget,
} from "./context-budget.js";

const companyId = "22222222-2222-4222-8222-222222222222";

function evidence(
  id: string,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem {
  return {
    id,
    companyId,
    sourceClass: "foundation",
    sourceProvider: "august_works",
    sourceType: "foundation_section",
    sourceRef: `foundation://${id}`,
    title: id,
    excerpt: `Evidence ${id}`,
    sourceVersion: "revision-1",
    sourceUpdatedAt: "2026-09-28T08:00:00.000Z",
    observedAt: "2026-09-28T09:00:00.000Z",
    validFrom: null,
    validUntil: null,
    authorityDomain: "strategy",
    trustLevel: "high",
    sensitivity: "internal",
    citation: { label: id },
    metadata: {},
    ...overrides,
  };
}

const policy: ContextAuthorityPolicy = {
  rules: [
    {
      authorityDomain: "strategy",
      preferredSources: [
        { sourceClass: "foundation" },
        { sourceClass: "accepted_memory" },
      ],
    },
    {
      authorityDomain: "task_state",
      preferredSources: [{ sourceClass: "task" }],
    },
  ],
};

const budget: ContextBudget = {
  maxItems: 4,
  maxEstimatedTokens: 10_000,
  buckets: {
    foundation: { maxItems: 1 },
    connected_evidence: { maxItems: 2 },
    shared_memory: { maxItems: 1 },
    private_memory: { maxItems: 1 },
    task_context: { maxItems: 2 },
    artifacts: { maxItems: 1 },
  },
};

describe("Context authority and eligibility", () => {
  it("resolves authority per domain instead of one global source ordering", () => {
    const decisions = resolveEvidenceAuthority(
      [
        evidence("memory-strategy", {
          sourceClass: "accepted_memory",
          sourceProvider: "memory",
        }),
        evidence("foundation-strategy"),
        evidence("task-state", {
          sourceClass: "task",
          sourceProvider: "august_works",
          sourceType: "issue",
          authorityDomain: "task_state",
        }),
        evidence("crm-state", {
          sourceClass: "system_of_record",
          sourceProvider: "crm",
          authorityDomain: "opportunity_stage",
        }),
      ],
      policy,
    );

    expect(decisions.find((item) => item.evidence.id === "foundation-strategy")).toMatchObject({
      authorityRank: 0,
      primaryForDomain: true,
      reason: "preferred_authority",
    });
    expect(decisions.find((item) => item.evidence.id === "memory-strategy")).toMatchObject({
      authorityRank: 1,
      primaryForDomain: false,
      reason: "lower_authority",
    });
    expect(decisions.find((item) => item.evidence.id === "task-state")).toMatchObject({
      authorityRank: 0,
      primaryForDomain: true,
    });
    expect(decisions.find((item) => item.evidence.id === "crm-state")).toMatchObject({
      authorityRank: null,
      primaryForDomain: false,
      reason: "unconfigured_domain",
    });
  });

  it("promotes the next configured source only when the preferred authority is unavailable", () => {
    const [decision] = resolveEvidenceAuthority(
      [
        evidence("memory-only", {
          sourceClass: "accepted_memory",
          sourceProvider: "memory",
        }),
      ],
      policy,
    );
    expect(decision).toMatchObject({
      authorityRank: 1,
      primaryForDomain: true,
      reason: "authority_fallback",
    });
  });

  it("filters temporal invalidity and sensitivity before later selection", () => {
    const result = filterEligibleEvidence(
      [
        evidence("eligible"),
        evidence("future", { validFrom: "2026-10-01T00:00:00.000Z" }),
        evidence("expired", { validUntil: "2026-09-27T00:00:00.000Z" }),
        evidence("too-sensitive", { sensitivity: "restricted" }),
      ],
      {
        asOf: new Date("2026-09-28T09:00:00.000Z"),
        sensitivityCeiling: "confidential",
      },
    );

    expect(result.eligible.map((item) => item.id)).toEqual(["eligible"]);
    expect(result.excluded).toEqual([
      { evidenceId: "future", reason: "not_yet_valid" },
      { evidenceId: "expired", reason: "expired" },
      { evidenceId: "too-sensitive", reason: "sensitivity_ceiling" },
    ]);
  });

  it("keeps stable ordering inside the same authority tier", () => {
    const ordered = orderEvidenceByAuthority(
      resolveEvidenceAuthority(
        [evidence("first"), evidence("second")],
        policy,
      ),
    );
    expect(ordered.map((item) => item.evidence.id)).toEqual(["first", "second"]);
  });

  it("does not let untrusted evidence metadata rewrite authority policy", () => {
    const trusted = evidence("trusted-foundation");
    const hostile = evidence("hostile-external", {
      sourceClass: "external_untrusted",
      sourceProvider: "external",
      trustLevel: "untrusted",
      metadata: {
        authorityPolicy: {
          rules: [
            {
              authorityDomain: "strategy",
              preferredSources: [{ sourceClass: "external_untrusted" }],
            },
          ],
        },
        preferredSources: [{ sourceClass: "external_untrusted" }],
      },
    });

    const decisions = resolveEvidenceAuthority([hostile, trusted], policy);
    const hostileDecision = decisions.find(
      (decision) => decision.evidence.id === hostile.id,
    );
    const trustedDecision = decisions.find(
      (decision) => decision.evidence.id === trusted.id,
    );

    expect(hostileDecision).toMatchObject({
      authorityRank: null,
      primaryForDomain: false,
      reason: "non_authoritative_source",
    });
    expect(trustedDecision).toMatchObject({
      authorityRank: 0,
      primaryForDomain: true,
      reason: "preferred_authority",
    });
  });
});

describe("Context budgeting", () => {
  it("maps source classes to the V4 context buckets", () => {
    expect(evidenceBucket(evidence("foundation"))).toBe("foundation");
    expect(evidenceBucket(evidence("memory", { sourceClass: "accepted_memory" }))).toBe("shared_memory");
    expect(evidenceBucket(evidence("external", { sourceClass: "external_untrusted" }))).toBe("connected_evidence");
  });

  it("applies bucket and total limits without truncating evidence silently", () => {
    const decisions = orderEvidenceByAuthority(
      resolveEvidenceAuthority(
        [
          evidence("foundation-1"),
          evidence("foundation-2"),
          evidence("memory-1", { sourceClass: "accepted_memory", sourceProvider: "memory" }),
          evidence("task-1", {
            sourceClass: "task",
            sourceProvider: "august_works",
            sourceType: "issue",
            authorityDomain: "task_state",
          }),
        ],
        policy,
      ),
    );

    const result = fitEvidenceToBudget(decisions, budget);
    expect(result.selected.map((item) => item.evidence.id)).toEqual([
      "foundation-1",
      "task-1",
      "memory-1",
    ]);
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: "foundation-2",
          reason: "bucket_item_limit",
        }),
      ]),
    );
  });

  it("skips an item that does not fit the remaining token budget and can still select a later smaller item", () => {
    const large = evidence("large", { excerpt: "x".repeat(400) });
    const small = evidence("small", {
      sourceClass: "task",
      sourceType: "issue",
      authorityDomain: "task_state",
      excerpt: "ok",
    });
    const decisions = resolveEvidenceAuthority([large, small], policy);
    const smallTokens = estimateEvidenceTokens(small);

    const result = fitEvidenceToBudget(decisions, {
      ...budget,
      maxEstimatedTokens: smallTokens + 2,
      buckets: {
        ...budget.buckets,
        foundation: { maxItems: 2 },
      },
    });

    expect(result.selected.map((item) => item.evidence.id)).toEqual(["small"]);
    expect(result.excluded[0]).toMatchObject({
      evidenceId: "large",
      reason: "total_token_limit",
    });
  });
});
