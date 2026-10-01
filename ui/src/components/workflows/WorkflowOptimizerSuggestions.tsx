import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Clock3,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import type {
  OptimizerCandidateSuggestion,
  OptimizerSuggestionResponse,
} from "@paperclipai/shared";

import { workflowsApi } from "@/api/workflows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function measuredPercentage(value: number | null): string {
  return value === null ? "Not measured" : percentage(value);
}

function duration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} s`;
}

function cents(value: number | null): string {
  if (value === null) return "Not measured";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}¢`;
}

function replacementLabel(candidate: OptimizerCandidateSuggestion): string {
  switch (candidate.candidateType) {
    case "expression":
      return "Deterministic expression";
    case "transform":
      return "Deterministic transform";
    case "tool_chain":
      return "Deterministic tool chain";
    case "subworkflow":
      return "Reusable subworkflow";
    case "typescript":
      return "Sandboxed TypeScript artifact";
    case "python":
      return "Sandboxed Python artifact";
  }
}

function riskLabel(risk: OptimizerCandidateSuggestion["sideEffectRisk"]): string {
  switch (risk) {
    case "low":
      return "Low risk";
    case "medium":
      return "Review required";
    case "high":
      return "High risk";
  }
}

function stateMessage(result: OptimizerSuggestionResponse): {
  title: string;
  body: string;
} | null {
  switch (result.state) {
    case "disabled":
      return {
        title: "Optimizer suggestions are off",
        body: "No workflow behavior changes while this experimental capability is disabled.",
      };
    case "no_published_revision":
      return {
        title: "Publish a revision first",
        body: "Optimizer evidence is collected only from completed runs of the current published revision.",
      };
    case "insufficient_runs":
      return {
        title: "More evidence is needed",
        body: `Observed ${result.terminalRunCount} completed run${result.terminalRunCount === 1 ? "" : "s"}. At least ${result.minimumObservationCount} distinct runs are required before a pattern can become a suggestion.`,
      };
    case "correction_evidence_incomplete":
      return {
        title: "Correction evidence is incomplete",
        body: `There are ${result.terminalRunCount} completed runs, but only ${result.correctionEvidenceCount} have authoritative human-correction evidence. August Works will not infer a zero correction rate.`,
      };
    case "no_candidate":
      return {
        title: "No stable deterministic span yet",
        body: "The observed runs do not currently satisfy the structural, success, correction, or shape-stability gates.",
      };
    case "ready":
      return null;
  }
}

function Suggestion({
  suggestion,
}: {
  suggestion: OptimizerCandidateSuggestion;
}) {
  const riskTone =
    suggestion.sideEffectRisk === "low"
      ? "border-emerald-500/25 bg-emerald-500/5"
      : suggestion.sideEffectRisk === "medium"
        ? "border-amber-500/25 bg-amber-500/5"
        : "border-destructive/25 bg-destructive/5";

  return (
    <section
      aria-label={`Optimizer suggestion: ${replacementLabel(suggestion)}`}
      className={cn("rounded-lg border p-3", riskTone)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Optimization available</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Replace observed step {suggestion.stepOrdinals.join(" → ")} with a {replacementLabel(suggestion).toLowerCase()} candidate.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {riskLabel(suggestion.sideEffectRisk)}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <div>
          <dt className="text-muted-foreground">Observed</dt>
          <dd className="mt-0.5 font-medium">{suggestion.observationCount} runs</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Success</dt>
          <dd className="mt-0.5 font-medium">{percentage(suggestion.successRate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Potential latency</dt>
          <dd className="mt-0.5 font-medium">
            up to {duration(suggestion.estimatedLatencySavingsMs)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Potential cost</dt>
          <dd className="mt-0.5 font-medium">
            up to {cents(suggestion.estimatedCostSavings)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-border/70 pt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Affected span
        </p>
        <p className="mt-1 break-words text-xs leading-5">
          {suggestion.operationTypes.join(" → ")}
        </p>
      </div>

      <details className="mt-3 border-t border-border/70 pt-3">
        <summary className="cursor-pointer rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Review evidence
        </summary>
        <div className="mt-3 space-y-2 text-[11px] leading-4 text-muted-foreground">
          <p>
            Input shape stability: {percentage(suggestion.inputShapeStability)} · output shape stability: {percentage(suggestion.outputShapeStability)}.
          </p>
          <p>
            Human correction rate: {measuredPercentage(suggestion.humanCorrectionRate)} ({suggestion.humanCorrectionEvidenceCount}/{suggestion.observationCount} runs measured). Average observed runtime: {duration(suggestion.averageDurationMs)}. Average observed cost: {cents(suggestion.averageCost)}.
          </p>
          <p>
            Shadow evidence: not available yet. Unsupported cases and fallback guards are established by the compiler/replay gates before any promotion.
          </p>
          <p>
            Current workflow remains authoritative. This suggestion has not changed the draft or published workflow.
          </p>
        </div>
      </details>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled
          title="Historical replay is introduced in PR 46."
        >
          Run replay
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled
          title="Shadow execution is introduced in PR 47."
        >
          Start shadow
        </Button>
        <Button
          size="sm"
          disabled
          title="Promotion remains disabled until replay, shadow, fallback, and risk policy gates are implemented."
        >
          Promote
        </Button>
      </div>
    </section>
  );
}

export function WorkflowOptimizerSuggestions({
  companyId,
  workflowId,
}: {
  companyId: string;
  workflowId: string;
}) {
  const query = useQuery({
    queryKey: queryKeys.workflows.optimizerSuggestions(companyId, workflowId),
    queryFn: () => workflowsApi.optimizerSuggestions(companyId, workflowId),
    staleTime: 15_000,
  });

  if (query.isLoading) {
    return (
      <section aria-label="Optimizer suggestions" aria-busy="true" className="space-y-3">
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded-lg border border-border bg-muted/30" />
      </section>
    );
  }

  if (query.error || !query.data) {
    return (
      <section aria-label="Optimizer suggestions" className="space-y-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold">Optimizer</p>
        </div>
        <div role="alert" className="border-l-2 border-destructive pl-3 text-xs leading-5">
          <p className="font-medium">Suggestions could not be loaded</p>
          <p className="text-muted-foreground">Your workflow and run history were not changed.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? "Retrying…" : "Retry"}
          </Button>
        </div>
      </section>
    );
  }

  const message = stateMessage(query.data);

  return (
    <section aria-label="Optimizer suggestions" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold">Optimizer</p>
        </div>
        <Badge variant="outline">Suggestion only</Badge>
      </div>

      {message ? (
        <div className="border-l-2 border-border pl-3">
          <p className="text-xs font-medium">{message.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {message.body}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Activity className="h-3 w-3" />
              Historical traces
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              No production mutation
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3 w-3" />
              Published revision only
            </span>
          </div>
          {query.data.suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion.signatureHash}
              suggestion={suggestion}
            />
          ))}
        </div>
      )}
    </section>
  );
}
