import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAutomationArtifactSchema, type AutomationArtifactStatus } from "@paperclipai/shared";
import {withV7AccountScope,useV7AccountScope} from "@/context/V7AccountScope";
import {ApiError,isAnalyticalSourceAccessLost} from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { queryKeys } from "@/lib/queryKeys";
import { useLocation } from "react-router-dom";

function AutomationArtifactsContent() {
  const {principalId,automationArtifactsApi,workflowsApi,instanceSettingsApi}=useV7AccountScope();
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const client = useQueryClient();
  const location = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [definition, setDefinition] = useState(JSON.stringify({ name: "Copy value", kind: "transform",
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    riskClass: "C1", sideEffectClass: "pure", sourceCode: '{"value":"{{input.value}}"}',
    dependencyManifest: {}, testSpec: { cases: [{ input: { value: "example" }, output: { value: "example" } }] },
  }, null, 2));
  useEffect(() => { setSelectedId(new URLSearchParams(location.search).get("artifactId")); }, [companyId, location.search]);
  useEffect(() => { setBreadcrumbs([{ label: "Automation Artifacts", href: "/automation-artifacts" }]); }, [setBreadcrumbs]);
  const flags = useQuery({ queryKey: ["artifact-flags",principalId], queryFn: () => instanceSettingsApi.getExperimental() });
  const enabled = !!companyId && flags.data?.enableAutomationArtifactsV1 === true;
  const capabilities = useQuery({ queryKey: [...queryKeys.workflows.capabilities(companyId!),principalId],
    queryFn: () => workflowsApi.capabilities(companyId!), enabled });
  const list = useQuery({ queryKey: ["automation-artifacts", companyId,principalId], queryFn: () => automationArtifactsApi.list(companyId!), enabled,refetchInterval:30000,retry:false });
  const detail = useQuery({ queryKey: ["automation-artifact", companyId,principalId, selectedId],
    queryFn: () => automationArtifactsApi.get(companyId!, selectedId!), enabled: enabled && !!selectedId,refetchInterval:30000,retry:false });
  const mutation = useMutation({
    mutationFn: async (action: "create" | "evaluate" | "archive" | AutomationArtifactStatus) => {
      if (!companyId) throw new Error("Select a company first.");
      if (action === "create") return automationArtifactsApi.create(companyId, createAutomationArtifactSchema.parse(JSON.parse(definition)));
      const current = detail.isError||detail.isFetching?undefined:detail.data;
      if (!current?.latestVersion || current.artifact.companyId !== companyId) throw new Error("Reload the artifact before continuing.");
      if (action === "evaluate") return automationArtifactsApi.evaluate(companyId, current.artifact.id);
      if (action === "archive") return automationArtifactsApi.archive(companyId, current.artifact.id, current.latestVersion.id);
      return automationArtifactsApi.transition(companyId, current.artifact.id, {
        expectedStatus: current.artifact.status, expectedLatestVersionId: current.latestVersion.id, status: action,
      });
    },
    onSuccess: async (result,action) => {
      if (result.artifact.companyId !== companyId || action!=="create"&&result.artifact.id!==selectedId) return;
      setSelectedId(result.artifact.id);
      await Promise.all([client.invalidateQueries({ queryKey: ["automation-artifacts", companyId,principalId] }),
        client.invalidateQueries({ queryKey: ["automation-artifact", companyId,principalId] })]);
    },
  });
  const closed=(error:unknown)=>isAnalyticalSourceAccessLost(error)||error instanceof ApiError&&[403,404,409].includes(error.status);
  const sourceClosed=closed(detail.error)||closed(list.error)||closed(mutation.error);
  useEffect(()=>{if(sourceClosed){setDefinition("");void list.refetch();}},[sourceClosed]);
  useEffect(()=>mutation.reset(),[selectedId]);
  if (!companyId) return <p>Select a company to open Automation Artifacts.</p>;
  if (flags.isLoading || list.isLoading) return <PageSkeleton />;
  if (!enabled) return <p>Automation Artifacts are disabled. Enable them in experimental settings to review candidates.</p>;
  const currentDetail=detail.isError||detail.isFetching||sourceClosed?undefined:detail.data;
  const artifact = currentDetail?.artifact;
  const version = currentDetail?.latestVersion;
  const currentList=list.isError||list.isFetching?undefined:list.data?.filter(item=>!sourceClosed||item.id!==selectedId);
  const error = mutation.error ?? list.error ?? detail.error ?? capabilities.error;
  return <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
    <header><h1 className="text-xl font-semibold">Automation Artifacts</h1>
      <p className="text-sm text-muted-foreground">Review immutable versions, run bounded tests, and activate typed automation for workflows.</p></header>
    {error ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "Reload and try again."}</p> : null}
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-3" aria-label="Artifact catalogue">
        {currentList?.length === 0 ? <p>No artifacts yet. Create a candidate with schemas and test cases.</p> : null}
        {currentList?.map((item) => <Button key={item.id} variant={item.id === selectedId ? "secondary" : "outline"}
          className="w-full justify-between" onClick={() => setSelectedId(item.id)}>
          <span>{item.name}</span><Badge variant="outline">{item.archivedAt ? "archived" : item.status}</Badge>
        </Button>)}
        {capabilities.data?.edit ? <details><summary className="cursor-pointer text-sm font-medium">Create candidate</summary>
          <div className="space-y-3 pt-3"><label className="block text-sm">Artifact definition
            <textarea aria-label="Artifact definition JSON" rows={16} value={definition} disabled={mutation.isPending}
              onChange={(event) => setDefinition(event.target.value)}
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-sm" /></label>
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate("create")}>Create candidate</Button></div>
        </details> : null}
      </section>
      <section className="space-y-4" aria-label="Artifact review">
        {detail.isLoading ? <PageSkeleton /> : artifact && version ? <>
          <h2 className="text-lg font-semibold">{artifact.name}</h2>
          <p className="text-sm">{artifact.description ?? "Review the source, schemas and evidence before activation."}</p>
          <label className="block text-xs">Version hash<Input readOnly value={version.contentHash} className="font-mono" /></label>
          <p className="text-sm">{artifact.kind} · {artifact.riskClass} · {artifact.sideEffectClass} · {artifact.status}</p>
          {[{ label: "Source", value: version.sourceCode }, { label: "Input schema", value: JSON.stringify(version.inputSchema, null, 2) },
            { label: "Output schema", value: JSON.stringify(version.outputSchema, null, 2) },
            { label: "Tests", value: JSON.stringify(version.testSpec, null, 2) },
            { label: "Validation evidence", value: JSON.stringify(version.validationReport, null, 2) },
            { label: "Security evidence", value: JSON.stringify(version.securityReport, null, 2) }].map((item) =>
              <details key={item.label}><summary className="cursor-pointer text-sm font-medium">{item.label}</summary>
                <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{item.value}</pre></details>)}
          {!artifact.archivedAt ? <div className="flex flex-wrap gap-2">
            {capabilities.data?.edit ? <Button disabled={mutation.isPending} variant="outline" onClick={() => mutation.mutate("evaluate")}>Run validation and security tests</Button> : null}
            {capabilities.data?.publish ? <>
              {artifact.status === "candidate" ? <Button disabled={mutation.isPending} onClick={() => mutation.mutate("testing")}>Start testing</Button> : null}
              {artifact.status === "testing" && version.validationReport?.status === "passed" && version.securityReport?.status === "passed" ?
                <Button disabled={mutation.isPending} onClick={() => mutation.mutate("active")}>Activate reviewed version</Button> : null}
              {artifact.status !== "revoked" ? <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate("revoked")}>Revoke version</Button> : null}
              <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate("archive")}>Archive artifact</Button>
            </> : null}
          </div> : null}
        </> : <p className="text-sm text-muted-foreground">Select an artifact to inspect its source and evaluation evidence.</p>}
      </section>
    </div>
  </div>;
}

export const AutomationArtifacts=withV7AccountScope(AutomationArtifactsContent);
