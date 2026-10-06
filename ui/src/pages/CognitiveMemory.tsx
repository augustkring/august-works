import { withV7AccountScope, useV7AccountScope } from "@/context/V7AccountScope";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { CognitivePurposeSelector } from "@/components/CognitivePurposeSelector";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
function CognitiveMemoryContent() {
  const { principalId, cognitiveMemoryApi } = useV7AccountScope();
  const { selectedCompanyId: companyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const [purpose, setPurpose] = useState("native_task_execution");
  useEffect(() => setBreadcrumbs([{ label: "Memory", href: "/memory" }, { label: "Cognitive providers" }]), [setBreadcrumbs]);
  const status = useQuery({ queryKey: ["cognitive-status", companyId, principalId], queryFn: () => cognitiveMemoryApi.status(companyId!), enabled: Boolean(companyId) });
  const create = useMutation({ mutationFn: () => cognitiveMemoryApi.create(companyId!, purpose), onSuccess: () => void status.refetch() });
  const reconcile = useMutation({ mutationFn: (id: string) => cognitiveMemoryApi.reconcile(companyId!, id), onSuccess: () => void status.refetch() });
  return <div className="space-y-6"><h1 className="text-xl font-semibold">Cognitive providers</h1><p className="text-muted-foreground">Providers work with governed Memory. The local baseline keeps no separate copy of source content. Hindsight is awaiting operational qualification.</p>
    {!companyId ? <p>Select a company first.</p> : <><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><CognitivePurposeSelector id="cognitive-purpose" value={purpose} onChange={setPurpose} /><div className="flex items-center justify-between"><Link to="/memory">Back to Memory</Link><Button disabled={create.isPending || !purpose.trim()} type="submit">Add local provider</Button></div></form>
      {status.isPending ? <p role="status">Loading providers…</p> : status.data?.bindings.map((binding) => <section key={binding.id} className="space-y-2"><h2 className="font-medium">{binding.purpose}</h2><Badge variant="outline">{binding.status}</Badge><p>{binding.providerKey} · {binding.scopeType}</p><p className="text-sm text-muted-foreground">Last reconciled: {binding.lastReconciledAt ? new Date(binding.lastReconciledAt).toLocaleString() : "Never"}</p><Button variant="outline" onClick={() => reconcile.mutate(binding.id)} disabled={reconcile.isPending}>Reconcile</Button></section>)}
      {reconcile.data ? <p role="status">Reconciliation {reconcile.data.status}; {reconcile.data.count} eligible records.</p> : null}</>}
    {[status, create, reconcile].filter((state) => state.isError).map((state, index) => <p role="alert" key={index}>{state.error instanceof Error ? state.error.message : "Operation failed"}</p>)}
  </div>;
}

export const CognitiveMemory = withV7AccountScope(CognitiveMemoryContent);
