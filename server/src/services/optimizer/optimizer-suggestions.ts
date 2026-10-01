import { and, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import {
  workflowOptimizerSuggestions,
  workflowRuns,
  workflows,
} from "@paperclipai/db";
import type {
  OptimizerCandidateSuggestion,
  OptimizerSuggestionResponse,
  OptimizerTrace,
  WorkflowOptimizerSuggestion,
} from "@paperclipai/shared";

import { detectOptimizerCandidates } from "./optimizer-pattern-detector.js";
import { optimizerTraceService } from "./optimizer-trace.js";
import {
  persistActivity,
  publishActivity,
  type ActivityPublication,
} from "../activity-log.js";

const MIN_OBSERVATION_COUNT = 3;
const MAX_SOURCE_RUNS = 50;
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"] as const;

type TraceNormalizer = {
  normalizeWorkflowRun: (
    companyId: string,
    runId: string,
  ) => Promise<OptimizerTrace>;
};

export interface OptimizerSuggestionServiceOptions {
  traceNormalizer?: TraceNormalizer;
  detector?: typeof detectOptimizerCandidates;
}

function response(input: Omit<OptimizerSuggestionResponse, "minimumObservationCount">): OptimizerSuggestionResponse {
  return {
    ...input,
    minimumObservationCount: MIN_OBSERVATION_COUNT,
  };
}

type BoundOptimizerSuggestion = OptimizerCandidateSuggestion & {
  workflowId: string;
  workflowRevisionId: string;
};

function isBoundOptimizerSuggestion(
  suggestion: OptimizerCandidateSuggestion,
): suggestion is BoundOptimizerSuggestion {
  return (
    typeof suggestion.workflowId === "string" &&
    suggestion.workflowId.length > 0 &&
    typeof suggestion.workflowRevisionId === "string" &&
    suggestion.workflowRevisionId.length > 0
  );
}

function publicSuggestion(
  row: typeof workflowOptimizerSuggestions.$inferSelect,
): WorkflowOptimizerSuggestion {
  return {
    id: row.id,
    companyId: row.companyId,
    workflowId: row.workflowId,
    workflowRevisionId: row.workflowRevisionId,
    signatureHash: row.signatureHash,
    status: row.status,
    candidateType: row.candidateType,
    stepOrdinals: row.stepOrdinals,
    operationTypes: row.operationTypes,
    capabilityRefs: row.capabilityRefs,
    sideEffectRisk: row.sideEffectRisk,
    observationCount: row.observationCount,
    successRate: row.successRate,
    humanCorrectionRate: row.humanCorrectionRate,
    humanCorrectionEvidenceCount: row.humanCorrectionEvidenceCount,
    humanCorrectionEvidenceCoverage: row.humanCorrectionEvidenceCoverage,
    inputShapeStability: row.inputShapeStability,
    outputShapeStability: row.outputShapeStability,
    averageDurationMs: row.averageDurationMs,
    averageCost: row.averageCost,
    estimatedLatencySavingsMs: row.estimatedLatencySavingsMs,
    estimatedCostSavings: row.estimatedCostSavings,
    observedRunIds: row.observedRunIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function suggestionMetrics(suggestion: BoundOptimizerSuggestion) {
  return {
    candidateType: suggestion.candidateType,
    stepOrdinals: suggestion.stepOrdinals,
    operationTypes: suggestion.operationTypes,
    capabilityRefs: suggestion.capabilityRefs,
    sideEffectRisk: suggestion.sideEffectRisk,
    observationCount: suggestion.observationCount,
    successRate: suggestion.successRate,
    humanCorrectionRate: suggestion.humanCorrectionRate,
    humanCorrectionEvidenceCount: suggestion.humanCorrectionEvidenceCount,
    humanCorrectionEvidenceCoverage:
      suggestion.humanCorrectionEvidenceCoverage,
    inputShapeStability: suggestion.inputShapeStability,
    outputShapeStability: suggestion.outputShapeStability,
    averageDurationMs: suggestion.averageDurationMs,
    averageCost: suggestion.averageCost,
    estimatedLatencySavingsMs: suggestion.estimatedLatencySavingsMs,
    estimatedCostSavings: suggestion.estimatedCostSavings,
    observedRunIds: suggestion.observedRunIds,
  };
}

async function materializeDetectedSuggestions(
  db: Db,
  suggestions: readonly BoundOptimizerSuggestion[],
): Promise<WorkflowOptimizerSuggestion[]> {
  if (suggestions.length === 0) return [];

  const publications: ActivityPublication[] = [];
  const rows = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    const materialized: Array<
      typeof workflowOptimizerSuggestions.$inferSelect
    > = [];

    for (const suggestion of suggestions) {
      let row = await txDb
        .select()
        .from(workflowOptimizerSuggestions)
        .where(
          and(
            eq(workflowOptimizerSuggestions.companyId, suggestion.companyId),
            eq(
              workflowOptimizerSuggestions.workflowRevisionId,
              suggestion.workflowRevisionId,
            ),
            eq(
              workflowOptimizerSuggestions.signatureHash,
              suggestion.signatureHash,
            ),
          ),
        )
        .then((items) => items[0] ?? null);

      if (!row) {
        const now = new Date();
        row = await txDb
          .insert(workflowOptimizerSuggestions)
          .values({
            companyId: suggestion.companyId,
            workflowId: suggestion.workflowId,
            workflowRevisionId: suggestion.workflowRevisionId,
            signatureHash: suggestion.signatureHash,
            status: "detected",
            ...suggestionMetrics(suggestion),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              workflowOptimizerSuggestions.companyId,
              workflowOptimizerSuggestions.workflowRevisionId,
              workflowOptimizerSuggestions.signatureHash,
            ],
          })
          .returning()
          .then((items) => items[0] ?? null);

        if (row) {
          const persisted = await persistActivity(txDb, {
            companyId: suggestion.companyId,
            actorType: "system",
            actorId: "workflow-optimizer",
            action: "optimizer.candidate_detected",
            entityType: "workflow_optimizer_suggestion",
            entityId: row.id,
            details: {
              workflowId: suggestion.workflowId,
              workflowRevisionId: suggestion.workflowRevisionId,
              signatureHash: suggestion.signatureHash,
              candidateType: suggestion.candidateType,
              sideEffectRisk: suggestion.sideEffectRisk,
              observationCount: suggestion.observationCount,
              humanCorrectionEvidenceCoverage:
                suggestion.humanCorrectionEvidenceCoverage,
            },
          });
          publications.push(persisted.publication);
        } else {
          row = await txDb
            .select()
            .from(workflowOptimizerSuggestions)
            .where(
              and(
                eq(
                  workflowOptimizerSuggestions.companyId,
                  suggestion.companyId,
                ),
                eq(
                  workflowOptimizerSuggestions.workflowRevisionId,
                  suggestion.workflowRevisionId,
                ),
                eq(
                  workflowOptimizerSuggestions.signatureHash,
                  suggestion.signatureHash,
                ),
              ),
            )
            .then((items) => items[0] ?? null);
        }
      }

      if (!row) {
        throw new Error("Optimizer suggestion could not be materialized");
      }

      const metricsChanged =
        JSON.stringify(suggestion.stepOrdinals) !==
          JSON.stringify(row.stepOrdinals) ||
        suggestion.observationCount !== row.observationCount ||
        suggestion.successRate !== row.successRate ||
        suggestion.humanCorrectionRate !== row.humanCorrectionRate ||
        suggestion.humanCorrectionEvidenceCount !==
          row.humanCorrectionEvidenceCount ||
        suggestion.humanCorrectionEvidenceCoverage !==
          row.humanCorrectionEvidenceCoverage ||
        suggestion.inputShapeStability !== row.inputShapeStability ||
        suggestion.outputShapeStability !== row.outputShapeStability ||
        suggestion.averageDurationMs !== row.averageDurationMs ||
        suggestion.averageCost !== row.averageCost ||
        suggestion.estimatedLatencySavingsMs !==
          row.estimatedLatencySavingsMs ||
        suggestion.estimatedCostSavings !== row.estimatedCostSavings ||
        JSON.stringify(suggestion.observedRunIds) !==
          JSON.stringify(row.observedRunIds);

      if (row.status === "detected" && metricsChanged) {
        row =
          (await txDb
            .update(workflowOptimizerSuggestions)
            .set({
              ...suggestionMetrics(suggestion),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workflowOptimizerSuggestions.id, row.id),
                eq(
                  workflowOptimizerSuggestions.companyId,
                  suggestion.companyId,
                ),
                eq(workflowOptimizerSuggestions.status, "detected"),
              ),
            )
            .returning()
            .then((items) => items[0] ?? null)) ?? row;
      }

      materialized.push(row);
    }

    return materialized;
  });

  for (const publication of publications) publishActivity(publication);
  return rows.map(publicSuggestion);
}

/**
 * Read-only suggestion projection for Wave 11.
 *
 * This service deliberately does not create artifacts, mutate workflows, or
 * infer missing human-correction evidence. Suggestion materialization fails
 * closed until every sampled run carries authoritative correction evidence.
 */
export function optimizerSuggestionService(
  db: Db,
  options: OptimizerSuggestionServiceOptions = {},
) {
  const traceNormalizer = options.traceNormalizer ?? optimizerTraceService(db);
  const detector = options.detector ?? detectOptimizerCandidates;

  return {
    forWorkflow: async (
      companyId: string,
      workflowId: string,
    ): Promise<OptimizerSuggestionResponse | null> => {
      const workflow = await db
        .select({
          id: workflows.id,
          publishedRevisionId: workflows.publishedRevisionId,
        })
        .from(workflows)
        .where(
          and(
            eq(workflows.companyId, companyId),
            eq(workflows.id, workflowId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!workflow) return null;

      if (!workflow.publishedRevisionId) {
        return response({
          state: "no_published_revision",
          workflowId,
          workflowRevisionId: null,
          terminalRunCount: 0,
          correctionEvidenceCount: 0,
          suggestions: [],
        });
      }

      const runs = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            eq(workflowRuns.workflowId, workflowId),
            eq(workflowRuns.workflowRevisionId, workflow.publishedRevisionId),
            inArray(workflowRuns.status, [...TERMINAL_STATUSES]),
          ),
        )
        .orderBy(desc(workflowRuns.finishedAt), desc(workflowRuns.createdAt))
        .limit(MAX_SOURCE_RUNS);

      if (runs.length < MIN_OBSERVATION_COUNT) {
        return response({
          state: "insufficient_runs",
          workflowId,
          workflowRevisionId: workflow.publishedRevisionId,
          terminalRunCount: runs.length,
          correctionEvidenceCount: 0,
          suggestions: [],
        });
      }

      const traces = await Promise.all(
        runs.map((run) =>
          traceNormalizer.normalizeWorkflowRun(companyId, run.id),
        ),
      );
      const correctionEvidenceCount = traces.filter(
        (trace) => typeof trace.humanCorrection === "boolean",
      ).length;

      if (correctionEvidenceCount !== traces.length) {
        return response({
          state: "correction_evidence_incomplete",
          workflowId,
          workflowRevisionId: workflow.publishedRevisionId,
          terminalRunCount: traces.length,
          correctionEvidenceCount,
          suggestions: [],
        });
      }

      const detected = detector(traces, {
        minObservationCount: MIN_OBSERVATION_COUNT,
      }).filter(
        (suggestion): suggestion is BoundOptimizerSuggestion =>
          suggestion.companyId === companyId &&
          suggestion.workflowId === workflowId &&
          suggestion.workflowRevisionId === workflow.publishedRevisionId &&
          isBoundOptimizerSuggestion(suggestion),
      );
      const suggestions = await materializeDetectedSuggestions(db, detected);

      return response({
        state: suggestions.length > 0 ? "ready" : "no_candidate",
        workflowId,
        workflowRevisionId: workflow.publishedRevisionId,
        terminalRunCount: traces.length,
        correctionEvidenceCount,
        suggestions,
      });
    },
  };
}
