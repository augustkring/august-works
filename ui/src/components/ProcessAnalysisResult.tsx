import type { ProcessAnalysisDefinition, ProcessAnalysisRunView } from "@paperclipai/shared";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { processActivityLabel } from "./ProcessDefinitionForm";

function activityLabel(value: string) {
  const [activity, status] = value.split(":");
  const name = processActivityLabel[activity as keyof typeof processActivityLabel] ?? activity;
  return status ? `${name} / ${status.replaceAll("_", " ")}` : name;
}
const seconds = (value: number | null) => value === null ? "Not established" : `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} s`;
export function ProcessAnalysisResult({ run, definition }: { run: ProcessAnalysisRunView; definition:ProcessAnalysisDefinition }) {
  const { result } = run;
  return <section aria-label="Observed process result" className="space-y-5">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Observed process result</h2><StatusBadge status={result.status === "succeeded" ? "succeeded" : "warning"} label={result.status === "succeeded" ? "Calculated" : "Inconclusive"} /></div>
    <p className="text-sm text-muted-foreground">Observed window {new Date(run.from).toLocaleString()} – {new Date(run.until).toLocaleString()}. Calculated {new Date(run.createdAt).toLocaleString()}. Current access checked {new Date(run.authorizationCheckedAt).toLocaleString()}.</p>
    <p className="text-sm text-muted-foreground">This result describes recorded business-object paths. It does not estimate causal effects or score people.</p>
    {result.errorCode && <p role="status">{result.errorCode === "DATA_NOT_READY" ? "Required data properties are unestablished. No process statistics are published for this run." : "The result exceeds the bounded path or variant display. Narrow the observed period."}</p>}
    <details open={result.status !== "succeeded"}><summary className="cursor-pointer font-medium">Data readiness dimensions</summary><p className="my-3 text-sm text-muted-foreground">{result.readiness.authorizedEventCount} authorized events. Coverage: {result.readiness.coverage.replaceAll("_", " ")}. Assessment time {new Date(result.readiness.assessedAt).toLocaleString()}.</p><dl className="space-y-4">{result.readiness.dimensions.map(dimension => <div key={dimension.dimension} className="space-y-1"><dt className="font-medium">{dimension.dimension.replaceAll("_", " ")} · {dimension.state.replaceAll("_", " ")}{dimension.required ? " · required" : ""}</dt><dd className="text-sm text-muted-foreground">{dimension.reason}</dd></div>)}</dl></details>
    {result.status === "succeeded" && result.objectSummaries.map(summary => <Card key={summary.objectType}>
      <CardHeader><h3 className="font-semibold">{summary.objectType === "issue" ? "Task perspective" : "Project perspective"}</h3><p className="text-sm text-muted-foreground">{summary.objectCount} objects · {summary.eventCount} recorded events</p></CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2">{definition.analysisFamilies.includes("cycle_time") && <><div><dt>Median time to first completion</dt><dd className="font-semibold">{seconds(summary.medianCycleSeconds)}</dd></div><div><dt>P90 time to first completion</dt><dd className="font-semibold">{seconds(summary.p90CycleSeconds)}</dd></div></>}{definition.analysisFamilies.includes("blocked_time") && <div><dt>Observed blocked time</dt><dd className="font-semibold">{seconds(summary.knownBlockedSeconds)}</dd></div>}{definition.analysisFamilies.includes("rework") && <div><dt>Observed reopening</dt><dd className="font-semibold">{summary.reopenCount ?? "Not established"}</dd></div>}</dl>
        {summary.closedCompletionCount !== null && <p className="text-sm text-muted-foreground">{summary.closedCompletionCount} recorded first completions · {summary.cancelledCount} objects with observed cancellation · {summary.censoredCount} uncompleted or censored paths.</p>}
        {summary.conformance && <section aria-label="Explicit process conformance" className="space-y-3">
          <h4 className="font-medium">Explicit process conformance</h4>
          <p>{summary.conformance.evaluatedObjectCount} evaluated objects · {summary.conformance.conformingObjectCount} conforming · {summary.conformance.deviatingObjectCount} with observed deviations</p>
          <p className="text-sm text-muted-foreground">Comparison covers complete recorded primary state paths within this window. Deviations describe differences from the published expectation and need human investigation.</p>
          <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(summary.conformance.violationCounts).map(([code,count])=><div key={code}><dt>{code.replaceAll("_"," ")}</dt><dd className="font-semibold">{count}</dd></div>)}</dl>
          <details><summary className="cursor-pointer">Inspect comparison model</summary>{definition.conformance?.expectations.filter(model=>model.objectType===summary.objectType).map(model=><div key={model.objectType} className="space-y-2 pt-3 text-sm">
            <p>Expected starts: {model.initialStates.join(", ")}. Expected terminals: {model.terminalStates.join(", ")}. Required visits: {model.requiredStates.join(", ") || "None"}.</p>
            <ul>{model.allowedTransitions.map(edge=><li key={`${edge.from}:${edge.to}`}>{edge.from} → {edge.to}</li>)}</ul>
            <p className="break-all text-muted-foreground">Published version {summary.conformance!.targetVersionId} · Model hash {summary.conformance!.modelHash}</p>
          </div>)}</details>
        </section>}
        {!!summary.directlyFollows.length && <details><summary className="cursor-pointer font-medium">Directly follows ({summary.directlyFollows.length})</summary><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="py-3 text-left text-muted-foreground">Observed adjacent activities within each object path.</caption><thead><tr><th scope="col" className="p-2 text-left">From</th><th scope="col" className="p-2 text-left">To</th><th scope="col" className="p-2 text-right">Count</th></tr></thead><tbody>{summary.directlyFollows.map(edge => <tr key={JSON.stringify([edge.from, edge.to])} className="border-t border-border"><td className="p-2">{activityLabel(edge.from)}</td><td className="p-2">{activityLabel(edge.to)}</td><td className="p-2 text-right">{edge.count}</td></tr>)}</tbody></table></div></details>}
        {!!summary.variants.length && <details><summary className="cursor-pointer font-medium">Observed path variants ({summary.variants.length})</summary><div className="space-y-4 pt-3">{summary.variants.map(variant => <div key={variant.hash}><p className="font-medium">{variant.objectCount} objects</p><ol className="list-decimal space-y-1 pl-6 text-sm">{variant.activities.map((activity, index) => <li key={index}>{activityLabel(activity)}</li>)}</ol></div>)}</div></details>}
      </CardContent>
    </Card>)}
    <details><summary className="cursor-pointer">Inspect pinned evidence</summary><pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm">{JSON.stringify({ definitionHash: run.definitionHash, eventSetHash: run.eventSetHash, lineageManifestId: run.lineageManifestId, engineVersion: result.engineVersion, requirementHash: result.readiness.requirementHash }, null, 2)}</pre></details>
  </section>;
}
