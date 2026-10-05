import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { agentsApi } from "@/api/agents";
import { foundationBootstrapApi } from "@/api/foundationBootstrap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MarkdownBody } from "@/components/MarkdownBody";
import { Link, useParams } from "@/lib/router";

export function FoundationBootstrap() {
  const { selectedCompanyId: companyId } = useCompany();
  const { bootstrapRunId } = useParams<{ bootstrapRunId?: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [agentId, setAgentId] = useState(""), [query, setQuery] = useState(""), [runId, setRunId] = useState(bootstrapRunId ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => { setBreadcrumbs([{ label: "Foundation", href: "/foundation" }, { label: "Company discovery" }]); }, [setBreadcrumbs]);
  useEffect(() => { setAgentId(""); setRunId(bootstrapRunId ?? ""); setAnswers({}); }, [companyId, bootstrapRunId]);
  const agents = useQuery({ queryKey: ["bootstrap-agents", companyId], queryFn: () => agentsApi.list(companyId!), enabled: Boolean(companyId) });
  const start = useMutation({ mutationFn: () => foundationBootstrapApi.start(companyId!, { agentId, query, idempotencyKey: crypto.randomUUID() }), onSuccess: (run) => { if (run.companyId === companyId) setRunId(run.id); } });
  const run = useQuery({ queryKey: ["foundation-bootstrap", companyId, runId], queryFn: () => foundationBootstrapApi.get(companyId!, runId), enabled: Boolean(companyId && runId),
    refetchInterval: (current) => ["awaiting_candidates", "needs_answers"].includes(current.state.data?.status ?? "") ? 30000 : false, refetchIntervalInBackground: false });
  const answer = useMutation({ mutationFn: ({ key, value }: { key: string; value: string }) => foundationBootstrapApi.answer(companyId!, runId, run.data!.version, key, value), onSuccess: () => void run.refetch() });
  const propose = useMutation({ mutationFn: () => foundationBootstrapApi.proposals(companyId!, runId, run.data!.version), onSuccess: () => void run.refetch() });
  const questions = run.data && ["awaiting_candidates", "needs_answers", "ready_for_review"].includes(run.data.status) ? [...run.data.candidates.flatMap((candidate) => candidate.materialQuestions), ...run.data.initialQuestions].filter((question, index, all) => all.findIndex((item) => item.key === question.key) === index && !run.data!.answers[question.key]) : [];
  return <div className="space-y-6"><div className="space-y-2"><h1 className="text-xl font-semibold">Company discovery</h1><p className="text-muted-foreground">Let an agent prepare company knowledge from authorized sources. Review evidence and uncertainty before creating Foundation drafts.</p></div>
    {!companyId ? <p>Select a company first.</p> : !runId ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); start.mutate(); }}>
      <div className="space-y-2"><label htmlFor="bootstrap-agent">Discovery agent</label><select id="bootstrap-agent" className="w-full rounded-md border border-input bg-background p-2" value={agentId} onChange={(event) => setAgentId(event.target.value)} required><option value="">Select an agent</option>{agents.data?.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></div>
      <div className="space-y-2"><label htmlFor="bootstrap-outcome">What should the first agent help you achieve?</label><Input id="bootstrap-outcome" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} required /></div>
      <div className="flex items-center justify-between"><Link to="/foundation">Back to Foundation</Link><Button type="submit" disabled={!agentId || !query.trim() || start.isPending}>{start.isPending ? "Starting…" : "Start discovery"}</Button></div>
    </form> : run.data ? <div className="space-y-6"><Badge variant="outline">{run.data.status.replaceAll("_", " ")}</Badge><p><Link to={`/issues/${run.data.taskId}`}>Open the discovery task</Link>. Saved answers resume discovery automatically. You can also resume the agent from the task.</p>
      {questions.slice(0, 3).map((question) => <form className="space-y-2" key={question.key} onSubmit={(event) => { event.preventDefault(); answer.mutate({ key: question.key, value: answers[question.key] ?? "" }); }}><label htmlFor={`answer-${question.key}`}>{question.question}{question.required ? " (required)" : " (optional)"}</label><Input id={`answer-${question.key}`} value={answers[question.key] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.key]: event.target.value })} maxLength={4000} required /><Button type="submit" variant="outline" disabled={answer.isPending}>Save answer</Button></form>)}
      {run.data.withheldCandidateCount ? <p role="alert">Some proposals are hidden because their source evidence changed or is no longer accessible. Ask the agent to analyze current evidence again.</p> : null}
      {run.data.candidates.map((candidate) => <section className="space-y-4" key={candidate.id}><h2 className="font-medium">{candidate.title}</h2><MarkdownBody>{candidate.proposedContent}</MarkdownBody><ul className="space-y-2">{candidate.claims.map((claim, index) => <li key={index}>{claim.statement}<p className="text-sm text-muted-foreground">{claim.sourceRefs.map((ref) => { const source = run.data!.sources.find((item) => item.sourceRef === ref); return <span className="block" key={ref}>{ref} · {source?.sourceClass ?? "unknown"} · {source?.authorityDomain ?? "no authority domain"} · {source?.trustLevel ?? "unknown trust"} · {source?.sourceUpdatedAt ? new Date(source.sourceUpdatedAt).toLocaleString() : "date unknown"}</span>; })}</p></li>)}</ul>{[...candidate.uncertainties, ...candidate.conflicts].map((warning, index) => <p className="text-muted-foreground" key={index}>{warning}</p>)}{candidate.foundationDocumentId ? <Link to={`/foundation/${candidate.foundationDocumentId}`}>Review the Foundation draft</Link> : null}</section>)}
      {run.data.status === "ready_for_review" ? <div className="space-y-2"><p>These proposals become drafts for review. Canonical approval remains a separate step.</p><Button onClick={() => propose.mutate()} disabled={propose.isPending}>{propose.isPending ? "Creating drafts…" : "Create Foundation drafts"}</Button></div> : null}
    </div> : <p role="status">Loading discovery…</p>}
    {[agents, start, run, answer, propose].filter((state) => state.isError).map((state, index) => <p role="alert" key={index}>{state.error instanceof Error ? state.error.message : "This operation failed. Try again."}</p>)}
  </div>;
}
