import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { READINESS_ACTIONS, type ReadinessAction } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { readinessApi } from "@/api/readiness";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function Readiness() {
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [agentId, setAgentId] = useState("");
  const [actionClass, setActionClass] = useState<ReadinessAction>("internal_draft");
  const [query, setQuery] = useState("");
  useEffect(() => { setBreadcrumbs([{ label: "Readiness" }]); }, [setBreadcrumbs]);
  useEffect(() => { setAgentId(""); setQuery(""); }, [companyId]);
  const agents = useQuery({ queryKey: ["readiness-agents", companyId], queryFn: () => agentsApi.list(companyId!), enabled: Boolean(companyId) });
  const assessment = useMutation({ mutationFn: () => readinessApi.assess(companyId!, { agentId, actionClass, query, subjectType: "agent" }) });
  // Results remain attached to the company that requested them after a company switch.
  const result = assessment.data?.companyId === companyId ? assessment.data : null;
  return <div className="space-y-6">
    <div className="space-y-2"><h1 className="text-xl font-semibold">Readiness</h1><p className="text-muted-foreground">Check whether an agent has the information needed for a specific action. Access permissions and approvals still apply.</p></div>
    {!companyId ? <p>Select a company to assess readiness.</p> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); assessment.mutate(); }}>
      <div className="space-y-2"><label htmlFor="readiness-agent">Agent</label><select id="readiness-agent" className="w-full rounded-md border border-input bg-background p-2" value={agentId} onChange={(event) => setAgentId(event.target.value)} required><option value="">Select an agent</option>{agents.data?.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>{agents.isError ? <p role="alert">Agents could not be loaded. <Button type="button" variant="ghost" onClick={() => void agents.refetch()}>Try again</Button></p> : null}</div>
      <div className="space-y-2"><label htmlFor="readiness-action">Action</label><select id="readiness-action" className="w-full rounded-md border border-input bg-background p-2" value={actionClass} onChange={(event) => setActionClass(event.target.value as ReadinessAction)}>{READINESS_ACTIONS.map((action) => <option key={action} value={action}>{action.replaceAll("_", " ")}</option>)}</select></div>
      <div className="space-y-2"><label htmlFor="readiness-query">What should the agent do?</label><Input id="readiness-query" value={query} onChange={(event) => setQuery(event.target.value)} required maxLength={500} /></div>
      <Button type="submit" disabled={!agentId || !query.trim() || assessment.isPending}>{assessment.isPending ? "Checking…" : "Check readiness"}</Button>
    </form>}
    {assessment.isError ? <p role="alert">{assessment.error instanceof Error ? assessment.error.message : "The assessment failed. Try again."}</p> : null}
    {result ? <section className="space-y-4" aria-label="Readiness assessment"><Badge variant="outline">{result.status.replaceAll("_", " ")}</Badge><p className="text-muted-foreground">Assessed {new Date(result.assessedAt).toLocaleString()}. Valid until {new Date(result.expiresAt).toLocaleString()}. Recheck before a consequential action.</p>{result.assessment.requirements.map((requirement) => <section key={`${requirement.requirementKey}:${requirement.criterionKey}`} className="space-y-2"><h2 className="font-medium">{requirement.domain.replaceAll("_", " ")} · {requirement.mandatory ? "Required" : "Advisory"}</h2><table className="w-full text-sm"><thead><tr className="text-left"><th scope="col">Dimension</th><th scope="col">State</th><th scope="col">Finding</th></tr></thead><tbody>{requirement.dimensions.map((dimension) => <tr key={dimension.dimension}><th scope="row" className="py-2 text-left font-normal">{dimension.dimension.replaceAll("_", " ")}</th><td>{dimension.state.replaceAll("_", " ")}</td><td>{dimension.reason}</td></tr>)}</tbody></table></section>)}</section> : null}
  </div>;
}
