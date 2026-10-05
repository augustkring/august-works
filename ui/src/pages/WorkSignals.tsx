import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkSignalView } from "@paperclipai/shared";
import { workSignalsApi } from "@/api/work-signals";
import { issuesApi } from "@/api/issues";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function WorkSignals() {
  const { selectedCompanyId: companyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs(), cache = useQueryClient();
  const [rationale, setRationale] = useState(""), [targetIssueId, setTargetIssueId] = useState("");
  useEffect(() => { setBreadcrumbs([{ label: "Work Signals" }]); }, [setBreadcrumbs]);
  useEffect(() => { setRationale(""); setTargetIssueId(""); }, [companyId]);
  const tasks = useQuery({ queryKey: ["work-signal-targets", companyId], queryFn: () => issuesApi.list(companyId!), enabled: !!companyId });
  const signals = useQuery({ queryKey: ["work-signals", companyId], queryFn: () => workSignalsApi.list(companyId!), enabled: !!companyId });
  const decision = useMutation({ mutationFn: ({ row, action, requestedCompany }: { row: WorkSignalView; action: "apply" | "ignore" | "review"; requestedCompany: string }) => workSignalsApi.decide(requestedCompany, row.id, action, { expectedVersion: row.version, rationale, ...(action === "apply" && targetIssueId ? { targetIssueId } : {}) }), onSuccess: (row) => cache.invalidateQueries({ queryKey: ["work-signals", row.companyId] }) });
  return <div className="space-y-6"><h1 className="text-xl font-semibold">Work Signals</h1><p className="text-muted-foreground">Review coordination claims from your linked Slack identity. A candidate does not change a deadline, owner or completion. Reopen the original Task if a fresh source read is needed.</p>
    {!companyId ? <p>Select a company.</p> : <><label className="block space-y-2">Reason for your decision<Input value={rationale} onChange={e => setRationale(e.target.value)} minLength={20} maxLength={2000} /></label><label className="block space-y-2">Task for a date proposal<select className="w-full rounded-md border border-input bg-background p-2" value={targetIssueId} onChange={e => setTargetIssueId(e.target.value)}><option value="">Choose an existing project Task</option>{tasks.data?.filter(t => t.projectId && !["done", "cancelled"].includes(t.status)).map(t => <option key={t.id} value={t.id}>{t.identifier} · {t.title}</option>)}</select></label>
      {signals.isLoading ? <p>Loading candidates…</p> : null}{signals.isError ? <p role="alert">Candidates could not be loaded. <Button variant="ghost" onClick={() => void signals.refetch()}>Try again</Button></p> : null}
      {signals.data?.length === 0 ? <p>No candidates from your current source identity.</p> : null}
      {signals.data?.map(row => <section key={row.id} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap gap-2"><h2 className="font-medium">{row.signalType.replaceAll("_", " ")}</h2><Badge variant="outline">{row.status.replaceAll("_", " ")}</Badge><Badge variant="outline">{row.confidence}</Badge><Badge variant="outline">{row.sensitivity}</Badge></div>{row.facts?.date ? <p>Reported date: {row.facts.date}</p> : null}<Link className="text-primary underline" to={`/issues/${row.issueId}`}>Open source Task</Link>{row.proposalId ? <p className="text-muted-foreground">A Roadmap draft awaits separate planning review.</p> : null}
        {row.status === "review_requested" && !row.interactionId ? <p className="text-muted-foreground">{row.followupAttempts >= 3 ? "Review request could not be delivered. Open the source Task to review it directly." : "Review request queued."}</p> : null}{["candidate", "review_requested"].includes(row.status) ? <div className="flex flex-wrap gap-2">{(["review", "ignore", ...(row.status === "candidate" && row.signalType === "deadline_change" && row.confidence === "explicit" && row.sensitivity === "internal" ? ["apply"] : [])] as Array<"review" | "ignore" | "apply">).map(action => <Button key={action} variant={action === "ignore" ? "outline" : "default"} disabled={rationale.trim().length < 20 || decision.isPending} onClick={() => decision.mutate({ row, action, requestedCompany: companyId })}>{action === "apply" ? "Propose date in Roadmap" : action === "review" ? "Request source review" : "Ignore"}</Button>)}</div> : null}</section>)}
      {decision.isError ? <p role="alert">{decision.error instanceof Error ? decision.error.message : "Decision could not be saved."}</p> : null}</>}
  </div>;
}
