import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createProcessFindingSchema, processFindingTransitionAllowed, type CreateProcessFinding,
  type ProcessAnalysisRunView, type ProcessFindingState } from "@paperclipai/shared";
import { processAnalysisApi } from "@/api/process-analysis";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";

const labels: Record<CreateProcessFinding["findingType"], string> = {
  missing_process_data: "Missing qualified data", rework: "Observed reopening",
  avoidable_wait: "Investigate avoidable wait", bottleneck: "Investigate a bottleneck", unusual_variant: "Investigate a selected variant",
};
function options(run: ProcessAnalysisRunView) {
  const items: { label: string; input: Pick<CreateProcessFinding, "findingType" | "objectType" | "variantHash"> }[] = [];
  if (run.result.errorCode === "DATA_NOT_READY") items.push({ label: labels.missing_process_data, input: { findingType: "missing_process_data", objectType: null, variantHash: null } });
  if (run.result.status !== "succeeded") return items;
  for (const summary of run.result.objectSummaries) {
    const perspective = summary.objectType === "issue" ? "Tasks" : "Projects";
    const add = (findingType: CreateProcessFinding["findingType"], variantHash: string | null = null, suffix = "") =>
      items.push({ label: `${perspective} · ${labels[findingType]}${suffix}`, input: { findingType, objectType: summary.objectType, variantHash } });
    if (summary.reopenCount !== null && summary.reopenCount > 0) add("rework");
    if (summary.knownBlockedSeconds !== null && summary.knownBlockedSeconds > 0) { add("avoidable_wait"); add("bottleneck"); }
    if (summary.variants.length > 1) summary.variants.forEach((variant, index) => add("unusual_variant", variant.hash, ` ${index + 1} (${variant.objectCount} objects)`));
  }
  return items;
}
const actions: { status: ProcessFindingState; label: string }[] = [
  { status: "ACKNOWLEDGED", label: "Acknowledge finding" }, { status: "INVESTIGATING", label: "Investigate finding" },
  { status: "RESOLVED", label: "Resolve finding" }, { status: "SUPPRESSED_WITH_REASON", label: "Suppress with reason" },
];
export function ProcessFindings({ run, userId }: { run: ProcessAnalysisRunView; userId: string | null }) {
  const cache = useQueryClient(), account = userId ?? undefined;
  const parentKey = ["process-definitions", run.companyId, userId];
  const key = [...parentKey, "findings", run.definitionId, run.id];
  const [selection, setSelection] = useState(0), [severity, setSeverity] = useState<CreateProcessFinding["severity"]>("medium");
  const [interpretation, setInterpretation] = useState(""), [findingId, setFindingId] = useState(""), [reason, setReason] = useState("");
  const choices = options(run);
  const list = useInfiniteQuery({ queryKey: key, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => processAnalysisApi.listFindings(run.companyId, run.definitionId, run.id, pageParam, account),
    getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 30_000 });
  const detail = useQuery({ queryKey: [...key, "detail", findingId], enabled: !!findingId, refetchInterval: 30_000,
    queryFn: () => processAnalysisApi.findingDetail(run.companyId, run.definitionId, run.id, findingId, account) });
  const input = createProcessFindingSchema.safeParse({ ...choices[selection]?.input, severity, interpretation });
  const refresh = () => { void cache.invalidateQueries({ queryKey: parentKey }); };
  const create = useMutation({ mutationFn: () => {
    if (!input.success) throw Error("Choose qualified process facts and record a human interpretation");
    return processAnalysisApi.createFinding(run.companyId, run.definitionId, run.id, input.data, account);
  }, onSuccess: finding => { setFindingId(finding.id); setInterpretation(""); refresh(); } });
  const finding = detail.data?.finding;
  const transition = useMutation({ mutationFn: (status: ProcessFindingState) => processAnalysisApi.transitionFinding(run.companyId, run.definitionId, run.id,
    finding!.id, { expectedVersion: finding!.version, status, reason }, account), onSuccess: () => { setReason(""); refresh(); } });
  const busy = list.isFetching || (!!findingId && detail.isFetching) || create.isPending || transition.isPending;
  const error = list.error ?? detail.error ?? create.error ?? transition.error;
  const current = !list.isError && !list.isFetching && !detail.isError && !detail.isFetching && finding && Date.parse(finding.expiresAt) > Date.now();
  return <section aria-label="Process findings" className="space-y-5">
    <h2 className="font-semibold">Process findings</h2>
    <p className="text-sm text-muted-foreground">Record a human interpretation of qualified process facts. Severity expresses review priority; it is not a probability. Investigation and resolution do not change native work.</p>
    {error && <p role="alert">{error.message} Refresh current source access before using this finding.</p>}
    {list.isFetching && <p role="status">Checking current process-finding evidence…</p>}
    {!list.isError && !list.isFetching && !detail.isError && <div className="space-y-3">
      {list.data?.pages.flatMap(page => page.items).filter(row => Date.parse(row.expiresAt) > Date.now()).map(row => <Card key={row.id}>
        <CardHeader><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium break-words">{row.summary}</h3><StatusBadge
          status={row.status === "RESOLVED" ? "approved" : row.status === "INVESTIGATING" ? "in_review" : "draft"}
          className={row.status === "RESOLVED" || row.status === "INVESTIGATING" ? undefined : "text-foreground"} label={row.status.toLowerCase().replaceAll("_", " ")} /></div></CardHeader>
        <CardContent className="space-y-3"><p className="break-words">{row.interpretation}</p><p className="text-sm text-muted-foreground">{row.severity} human review priority</p>
          <Button variant="outline" disabled={busy} onClick={() => { setFindingId(row.id); setReason(""); transition.reset(); }}>Inspect finding</Button></CardContent>
      </Card>)}
      {list.hasNextPage && <Button variant="outline" disabled={list.isFetchingNextPage || busy} onClick={() => void list.fetchNextPage()}>Load more findings</Button>}
    </div>}
    {current && <section aria-label="Inspect process finding" className="space-y-4">
      <h3 className="font-medium">Finding review</h3><p className="break-words">{finding.interpretation}</p>
      <details><summary className="cursor-pointer">Inspect finding facts and limitations</summary><pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm">{JSON.stringify({ facts: finding.facts, definitionHash: finding.definitionHash, eventSetHash: finding.eventSetHash, contentHash: finding.contentHash }, null, 2)}</pre></details>
      <ol className="space-y-3">{detail.data!.transitions.map(receipt => <li key={receipt.version}><p className="font-medium">{receipt.toStatus.toLowerCase().replaceAll("_", " ")}</p><p className="break-words">{receipt.reason}</p><p className="text-sm text-muted-foreground">{new Date(receipt.recordedAt).toLocaleString()}</p></li>)}</ol>
      {actions.some(action => processFindingTransitionAllowed(finding.status, action.status)) && <><label className="block space-y-2">Human review reason<Textarea aria-label="Finding review reason" value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={2000} /></label>
        <div className="flex flex-wrap gap-2">{actions.filter(action => processFindingTransitionAllowed(finding.status, action.status)).map(action => <Button key={action.status} variant="outline" disabled={busy || reason.trim().length < 10} onClick={() => transition.mutate(action.status)}>{action.label}</Button>)}</div></>}
    </section>}
    {!!choices.length && !list.isError && !detail.isError && <form aria-label="Record process finding" className="space-y-4" onSubmit={event => { event.preventDefault(); if (input.success && !busy) create.mutate(); }}>
      <h3 className="font-medium">Record a finding for investigation</h3>
      <label className="block space-y-2">Observed process facts<select aria-label="Finding observed facts" className="w-full rounded-md border border-input bg-background p-2" value={selection} onChange={event => setSelection(Number(event.target.value))}>{choices.map((choice, index) => <option key={index} value={index}>{choice.label}</option>)}</select></label>
      <label className="block space-y-2">Human review priority<select aria-label="Finding review priority" className="w-full rounded-md border border-input bg-background p-2" value={severity} onChange={event => setSeverity(event.target.value as CreateProcessFinding["severity"])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label className="block space-y-2">Human interpretation<Textarea aria-label="Finding human interpretation" value={interpretation} onChange={event => setInterpretation(event.target.value)} minLength={10} maxLength={2000} required /></label>
      <p className="text-sm text-muted-foreground">Blocked time does not prove avoidability or a bottleneck. A variant is not a proven anomaly. The interpretation is frozen with its observed evidence.</p>
      <Button type="submit" disabled={busy || !input.success}>Record finding</Button>
    </form>}
  </section>;
}
