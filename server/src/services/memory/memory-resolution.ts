import { createHash } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import { memoryEvidence, memoryRecords } from "@paperclipai/db";
import type {
  MemoryCandidateInputParsed,
  MemoryResolutionMetadata,
  MemoryType,
} from "@paperclipai/shared";

const RESOLUTION_VERSION = "v1" as const;
const MAX_RESOLUTION_CANDIDATES = 64;

const SINGLE_VALUED_MEMORY_TYPES = new Set<MemoryType>([
  "fact",
  "decision_reference",
  "preference",
  "relationship",
  "constraint",
]);

type MemoryRecord = typeof memoryRecords.$inferSelect;
type MemoryEvidence = typeof memoryEvidence.$inferSelect;
type CandidateEvidence = MemoryCandidateInputParsed["evidence"][number];

export interface MemoryCandidateResolution {
  metadata: MemoryResolutionMetadata;
  target: MemoryRecord | null;
  novelEvidence: MemoryCandidateInputParsed["evidence"];
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function candidateEvidenceKey(item: CandidateEvidence): string {
  return JSON.stringify([
    item.sourceClass,
    item.sourceProvider,
    item.sourceType,
    item.sourceRef,
    item.sourceVersion ?? null,
    item.excerptHash,
    item.relation,
  ]);
}

function storedEvidenceKey(item: MemoryEvidence): string {
  return JSON.stringify([
    item.sourceClass,
    item.sourceProvider,
    item.sourceType,
    item.sourceRef,
    item.sourceVersion ?? null,
    item.excerptHash,
    item.supportsOrContradicts,
  ]);
}

function recordPriority(left: MemoryRecord, right: MemoryRecord): number {
  const leftAccepted = left.reviewState === "accepted" ? 1 : 0;
  const rightAccepted = right.reviewState === "accepted" ? 1 : 0;
  if (leftAccepted !== rightAccepted) return rightAccepted - leftAccepted;
  const observedDelta = right.observedAt.getTime() - left.observedAt.getTime();
  if (observedDelta !== 0) return observedDelta;
  return right.updatedAt.getTime() - left.updatedAt.getTime();
}

function resolutionMetadata(input: {
  kind: MemoryResolutionMetadata["kind"];
  reasonCode: string;
  targetRecordId?: string | null;
  relatedRecordIds?: string[];
  novelEvidenceCount?: number;
  now: Date;
}): MemoryResolutionMetadata {
  return {
    version: RESOLUTION_VERSION,
    kind: input.kind,
    reasonCode: input.reasonCode,
    targetRecordId: input.targetRecordId ?? null,
    relatedRecordIds: input.relatedRecordIds ?? [],
    novelEvidenceCount: input.novelEvidenceCount ?? 0,
    resolvedAt: input.now.toISOString(),
  };
}

function claimLockMaterial(
  companyId: string,
  input: MemoryCandidateInputParsed,
): string {
  const title = normalizeText(input.title);
  const singleValuedClaim =
    title.length > 0 && SINGLE_VALUED_MEMORY_TYPES.has(input.memoryType);
  const identity = [
    companyId,
    input.bindingId,
    input.memoryType,
    input.scope.type,
    input.scope.id ?? "",
    input.subject?.type ?? "",
    input.subject?.id ?? "",
    singleValuedClaim ? `title:${title}` : `content:${normalizeText(input.content)}`,
  ];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export async function lockMemoryResolution(
  db: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
): Promise<void> {
  if (input.scope.type === "agent") return;
  const lockKey = `memory-resolution:${claimLockMaterial(companyId, input)}`;
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}

async function currentComparableRecords(
  db: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
  now: Date,
): Promise<MemoryRecord[]> {
  if (input.scope.type === "agent") return [];

  return db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.companyId, companyId),
        eq(memoryRecords.bindingId, input.bindingId),
        eq(memoryRecords.memoryType, input.memoryType),
        eq(memoryRecords.scopeType, input.scope.type),
        ...(input.scope.id === null
          ? [isNull(memoryRecords.scopeId)]
          : [eq(memoryRecords.scopeId, input.scope.id)]),
        ...(input.subject === null
          ? [
              isNull(memoryRecords.subjectType),
              isNull(memoryRecords.subjectId),
            ]
          : [
              eq(memoryRecords.subjectType, input.subject.type),
              eq(memoryRecords.subjectId, input.subject.id),
            ]),
        inArray(memoryRecords.reviewState, ["pending", "accepted"]),
        eq(memoryRecords.retentionState, "active"),
        isNull(memoryRecords.revokedAt),
        isNull(memoryRecords.supersededByRecordId),
        isNull(memoryRecords.deletedAt),
        or(isNull(memoryRecords.validFrom), lte(memoryRecords.validFrom, now)),
        or(isNull(memoryRecords.validUntil), gt(memoryRecords.validUntil, now)),
        or(isNull(memoryRecords.expiresAt), gt(memoryRecords.expiresAt, now)),
      ),
    )
    .orderBy(desc(memoryRecords.observedAt), desc(memoryRecords.updatedAt))
    .limit(MAX_RESOLUTION_CANDIDATES);
}

async function novelEvidenceFor(
  db: Db,
  companyId: string,
  recordId: string,
  evidence: MemoryCandidateInputParsed["evidence"],
): Promise<MemoryCandidateInputParsed["evidence"]> {
  if (evidence.length === 0) return [];
  const existing = await db
    .select()
    .from(memoryEvidence)
    .where(
      and(
        eq(memoryEvidence.companyId, companyId),
        eq(memoryEvidence.memoryRecordId, recordId),
      ),
    );
  const existingKeys = new Set(existing.map(storedEvidenceKey));
  return evidence.filter((item) => !existingKeys.has(candidateEvidenceKey(item)));
}

function effectiveFrom(record: MemoryRecord): Date {
  return record.validFrom ?? record.observedAt;
}

function sameOptionalInstant(
  stored: Date | null,
  proposed: string | null,
): boolean {
  if (stored === null || proposed === null) return stored === null && proposed === null;
  return stored.getTime() === new Date(proposed).getTime();
}

export async function resolveMemoryCandidate(
  db: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
  options: { now?: Date } = {},
): Promise<MemoryCandidateResolution> {
  const now = options.now ?? new Date();

  if (input.scope.type === "agent") {
    return {
      metadata: resolutionMetadata({
        kind: "new",
        reasonCode: "private_memory_resolution_deferred",
        now,
      }),
      target: null,
      novelEvidence: [],
    };
  }

  const records = await currentComparableRecords(db, companyId, input, now);
  if (records.length === 0) {
    return {
      metadata: resolutionMetadata({
        kind: "new",
        reasonCode: "no_comparable_active_record",
        now,
      }),
      target: null,
      novelEvidence: [],
    };
  }

  const normalizedContent = normalizeText(input.content);
  const exactMatches = records
    .filter(
      (record) =>
        normalizeText(record.content) === normalizedContent &&
        record.sensitivityLabel === input.sensitivity &&
        sameOptionalInstant(record.validFrom, input.validFrom) &&
        sameOptionalInstant(record.validUntil, input.validUntil),
    )
    .sort(recordPriority);

  const containsContradictingEvidence = input.evidence.some(
    (item) => item.relation === "contradicts",
  );

  if (exactMatches.length > 0 && containsContradictingEvidence) {
    const acceptedTarget =
      exactMatches.find((record) => record.reviewState === "accepted") ?? null;
    if (acceptedTarget) {
      return {
        metadata: resolutionMetadata({
          kind: "contradiction",
          reasonCode: "contradicting_evidence_against_equivalent_claim",
          targetRecordId: acceptedTarget.id,
          relatedRecordIds: exactMatches.map((record) => record.id),
          now,
        }),
        target: acceptedTarget,
        novelEvidence: [],
      };
    }

    // An equivalent pending candidate already represents the claim under
    // review. Keep one candidate and attach only novel contradicting evidence
    // instead of creating an unlinked duplicate or superseding pending state.
    const pendingTarget = exactMatches[0]!;
    const novelEvidence = await novelEvidenceFor(
      db,
      companyId,
      pendingTarget.id,
      input.evidence,
    );
    return {
      metadata: resolutionMetadata({
        kind: "contradiction",
        reasonCode: "contradicting_evidence_against_pending_equivalent_claim",
        targetRecordId: pendingTarget.id,
        relatedRecordIds: exactMatches.map((record) => record.id),
        novelEvidenceCount: novelEvidence.length,
        now,
      }),
      target: pendingTarget,
      novelEvidence,
    };
  }

  if (exactMatches.length > 0 && !containsContradictingEvidence) {
    const target = exactMatches[0]!;
    const novelEvidence = await novelEvidenceFor(
      db,
      companyId,
      target.id,
      input.evidence,
    );
    const relatedRecordIds = exactMatches.map((record) => record.id);

    if (novelEvidence.length === 0) {
      return {
        metadata: resolutionMetadata({
          kind: "duplicate",
          reasonCode: "equivalent_claim_no_novel_evidence",
          targetRecordId: target.id,
          relatedRecordIds,
          now,
        }),
        target,
        novelEvidence: [],
      };
    }

    return {
      metadata: resolutionMetadata({
        kind: "corroboration",
        reasonCode: "equivalent_claim_novel_evidence",
        targetRecordId: target.id,
        relatedRecordIds,
        novelEvidenceCount: novelEvidence.length,
        now,
      }),
      target,
      novelEvidence,
    };
  }

  const normalizedTitle = normalizeText(input.title);
  if (
    normalizedTitle.length === 0 ||
    !SINGLE_VALUED_MEMORY_TYPES.has(input.memoryType)
  ) {
    return {
      metadata: resolutionMetadata({
        kind: "new",
        reasonCode: "no_deterministic_claim_identity",
        relatedRecordIds: records.map((record) => record.id),
        now,
      }),
      target: null,
      novelEvidence: [],
    };
  }

  const claimMatches = records
    .filter(
      (record) =>
        record.reviewState === "accepted" &&
        normalizeText(record.title) === normalizedTitle,
    )
    .sort(recordPriority);

  if (claimMatches.length === 0) {
    return {
      metadata: resolutionMetadata({
        kind: "new",
        reasonCode: "no_accepted_claim_identity_match",
        now,
      }),
      target: null,
      novelEvidence: [],
    };
  }

  const target = claimMatches[0]!;
  const relatedRecordIds = claimMatches.map((record) => record.id);

  if (
    !containsContradictingEvidence &&
    input.validFrom !== null &&
    new Date(input.validFrom).getTime() > effectiveFrom(target).getTime()
  ) {
    return {
      metadata: resolutionMetadata({
        kind: "update",
        reasonCode: "newer_explicit_effective_date",
        targetRecordId: target.id,
        relatedRecordIds,
        now,
      }),
      target,
      novelEvidence: [],
    };
  }

  return {
    metadata: resolutionMetadata({
      kind: "contradiction",
      reasonCode: containsContradictingEvidence
        ? "contradicting_evidence_against_current_claim"
        : "overlapping_single_value_claim",
      targetRecordId: target.id,
      relatedRecordIds,
      now,
    }),
    target,
    novelEvidence: [],
  };
}
