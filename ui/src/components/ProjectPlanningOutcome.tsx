import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { adaptivePlanningApi } from "@/api/adaptive-planning";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function ProjectPlanningOutcome({ companyId, projectId, proposalId, userId, taskLabels, now, onAuthorityLost }: {
  companyId: string; projectId: string; proposalId: string; userId: string | null;
  taskLabels: Record<string, string>; now: number; onAuthorityLost: () => void;
}) {
  const [rationale, setRationale] = useState(""), [manifestId, setManifestId] = useState("");
  const detail = useQuery({ queryKey: ["project-adaptive-planning", companyId, projectId, userId, "outcome", proposalId, manifestId],
    queryFn: () => adaptivePlanningApi.outcome(companyId, projectId, proposalId, manifestId, userId), enabled: !!manifestId,
    refetchInterval: 30000, retry: false });
  const record = useMutation({ mutationFn: () => adaptivePlanningApi.recordOutcome(companyId, projectId, proposalId, rationale, userId),
    onSuccess: (receipt) => { setManifestId(receipt.manifestId); setRationale(""); },
    onError: () => { setManifestId(""); setRationale(""); onAuthorityLost(); } });
  const receipt = !detail.isFetching && !detail.isError && detail.data?.manifestId === manifestId ? detail.data.outcome : undefined;
  const current = receipt?.companyId === companyId && receipt.projectId === projectId && receipt.proposalId === proposalId && Date.parse(receipt.expiresAt) > Math.max(now, Date.now()) ? receipt : undefined;
  return <section aria-label="Observed planning outcome" className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">Review observed plan completion</h3>
    <p>Record actual completion after every planned Task is done under the approved dates. Completion differences describe this plan; business impact and causation remain unestablished.</p>
    <label className="block space-y-2">Planning outcome review rationale<Textarea aria-label="Planning outcome review rationale" value={rationale} onChange={event => setRationale(event.target.value)} minLength={10} maxLength={4000} disabled={record.isPending} /></label>
    <Button variant="outline" disabled={record.isPending || rationale.trim().length < 10 || rationale.trim().length > 4000} onClick={() => record.mutate()}>Record observed planning outcome</Button>
    {detail.isFetching && <p role="status">Rechecking native completion facts…</p>}
    {detail.isError && <p role="alert">Current completion evidence is unavailable. Recheck planning authority.</p>}
    {current && <div className="space-y-3"><p>{current.rationale}</p>
      <ul className="list-disc space-y-2 pl-5">{current.tasks.map(task => <li key={task.issueId}>{taskLabels[task.issueId] ?? "Planned Task"}: completed {new Date(task.completedAt).toLocaleString()} · approved end {task.plannedEndAt} · {task.completionDeltaDays.toFixed(2)} days relative to approved end.</li>)}</ul>
      <p>Retained until {new Date(current.expiresAt).toLocaleString()}. Test a hypothesis using independently verified Task outcomes and the normal human review gates.</p>
      <Button variant="outline" asChild><Link to={`/memory/learning?${new URLSearchParams({ planningCompanyId: companyId, planningProjectId: projectId, planningProposalId: proposalId, planningManifestId: manifestId })}`}>Start Learning from this plan outcome</Link></Button>
    </div>}
  </section>;
}
