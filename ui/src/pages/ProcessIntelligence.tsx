import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runProcessAnalysisSchema, type ProcessAnalysisDefinition } from "@paperclipai/shared";
import { processAnalysisApi } from "@/api/process-analysis";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { ProcessDefinitionForm, processFamilyLabel } from "@/components/ProcessDefinitionForm";
import { ProcessAnalysisResult } from "@/components/ProcessAnalysisResult";
import { ProcessFindings } from "@/components/ProcessFindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Link } from "@/lib/router";

export function ProcessIntelligence() {
  const { selectedCompanyId } = useCompany(); const { userId, settled, failed } = useAccountIdentity(); const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "Process intelligence" }]); }, [setBreadcrumbs]);
  if (failed) return <p role="alert">Your account could not be verified. Reload this page.</p>;
  if (!settled) return <p role="status">Verifying account…</p>;
  if (!selectedCompanyId) return <p>Select a company to inspect its recorded processes.</p>;
  return <ProcessIntelligenceWorkspace key={`${selectedCompanyId}:${userId ?? "local"}`} companyId={selectedCompanyId} userId={userId} />;
}
export function ProcessIntelligenceWorkspace({ companyId, userId }: { companyId: string; userId: string | null }) {
  const cache = useQueryClient(), key = ["process-definitions", companyId, userId]; const account = userId ?? undefined;
  const [definitionId, setDefinitionId] = useState(""), [versionId, setVersionId] = useState(""), [runId, setRunId] = useState("");
  const [editing, setEditing] = useState(false), [rationale, setRationale] = useState(""), [now, setNow] = useState(Date.now());
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [until, setUntil] = useState(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const list = useInfiniteQuery({ queryKey: key, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => processAnalysisApi.list(companyId, pageParam, account), getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 30_000 });
  const detail = useQuery({ queryKey: [...key, "detail", definitionId], queryFn: () => processAnalysisApi.detail(companyId, definitionId, account), enabled: !!definitionId, refetchInterval: 30_000 });
  const history = useInfiniteQuery({ queryKey: [...key, "runs", definitionId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => processAnalysisApi.listRuns(companyId, definitionId, pageParam, account), enabled: !!definitionId, getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 30_000 });
  const selectedRun = useQuery({ queryKey: [...key, "run", definitionId, runId], queryFn: () => processAnalysisApi.getRun(companyId, definitionId, runId, account), enabled: !!definitionId && !!runId, refetchInterval: 30_000 });
  const root = detail.data?.root;
  const pins = detail.data ? [detail.data.effectiveVersion, ...detail.data.versions.filter(pin => pin.id !== detail.data!.effectiveVersion.id)] : [];
  const pin = pins.find(value => value.id === (versionId || detail.data?.effectiveVersion.id));
  const refresh = () => { void cache.invalidateQueries({ queryKey: key }); };
  const save = useMutation({ mutationFn: async (definition: ProcessAnalysisDefinition) => root
    ? processAnalysisApi.revise(companyId, root.id, { expectedRevision: root.revision, definition }, account)
    : processAnalysisApi.create(companyId, { key: `flow_${crypto.randomUUID()}`, definition }, account),
    onSuccess: response => { refresh(); setEditing(false); if ("root" in response) { setDefinitionId(response.root.id); setVersionId(response.version.id); } else setVersionId(response.id); } });
  const publish = useMutation({ mutationFn: () => processAnalysisApi.publish(companyId, root!.id, { expectedRevision: root!.revision, versionId: pin!.id, rationale }, account), onSuccess: () => { refresh(); setVersionId(""); setRationale(""); } });
  const retire = useMutation({ mutationFn: () => processAnalysisApi.retire(companyId, root!.id, { expectedRevision: root!.revision, rationale }, account), onSuccess: () => { refresh(); setRationale(""); } });
  const runInput = runProcessAnalysisSchema.safeParse({ versionId: root?.publishedVersionId, from: `${from}T00:00:00Z`, until: `${until}T23:59:59.999999Z` });
  const analyze = useMutation({ mutationFn: () => {
    if (!runInput.success) throw Error("Choose a valid bounded observed period");
    return processAnalysisApi.run(companyId, root!.id, runInput.data, account);
  }, onSuccess: run => { setRunId(run.id); refresh(); } });
  const mutating = save.isPending || publish.isPending || retire.isPending || analyze.isPending;
  const busy = mutating || list.isFetching || (!!definitionId && detail.isFetching);
  const error = [list.error, detail.error, history.error, selectedRun.error, save.error, publish.error, retire.error, analyze.error].find(Boolean);
  const rows = list.data?.pages.flatMap(page => page.items) ?? [], runs = history.data?.pages.flatMap(page => page.items) ?? [];
  const isRetained = (expiry: string) => Date.parse(expiry) > Math.max(now, Date.now());
  const items = list.isError || list.isFetching ? [] : rows.filter(row => isRetained(row.expiresAt));
  const showDetail = !list.isError && !detail.isError && !list.isFetching && !detail.isFetching && root && pin && isRetained(pin.expiresAt);
  const run = !selectedRun.isError && !selectedRun.isFetching && !history.isError && !history.isFetching ? selectedRun.data : undefined;
  const runPin = run && pins.find(value => value.id === run.versionId);
  const expiries = [...rows.map(row => row.expiresAt), ...pins.map(value => value.expiresAt), ...runs.map(value => value.expiresAt), ...(run ? [run.expiresAt] : [])].sort();
  const nextExpiry = expiries.find(value => isRetained(value));
  useEffect(() => {
    if (!nextExpiry) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.max(0, Date.parse(nextExpiry) - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [nextExpiry, now]);
  function choose(id: string) { setDefinitionId(id); setVersionId(""); setRunId(""); setEditing(false); setRationale(""); save.reset(); publish.reset(); retire.reset(); analyze.reset(); }
  return <div className="space-y-6">
    <header className="space-y-2"><h1 className="text-xl font-semibold">Process intelligence</h1><p className="text-muted-foreground">Inspect recorded Task and Project paths after checking their source coverage, timestamps and object links.</p></header>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || list.isError} onClick={() => { choose(""); setEditing(true); }}>Propose a process</Button><Button variant="ghost" disabled={mutating} onClick={refresh}>Refresh current evidence</Button></div>
    {error && <p role="alert">{error.message} Refresh current source access and purpose before retrying.</p>}
    {list.isFetching && <p role="status">Checking current process definitions…</p>}
    <div className="space-y-3">{items.map(row => <Card key={row.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold break-words">{row.definition.name}</h2><StatusBadge className={row.status === "draft" || row.status === "retired" ? "text-foreground" : undefined} status={row.status === "published" ? "approved" : row.status === "needs_review" ? "in_review" : "draft"} label={row.status.replaceAll("_", " ")} /></div><p className="break-words text-sm text-muted-foreground">{row.definition.businessQuestion}</p></CardHeader><CardContent className="space-y-3"><p className="text-sm">{row.definition.analysisFamilies.map(family => processFamilyLabel[family]).join(" · ")}</p>{row.reviewReason && <p className="text-sm text-muted-foreground">{row.reviewReason}</p>}<Button size="sm" variant="outline" disabled={busy} onClick={() => choose(row.id)}>Inspect process</Button></CardContent></Card>)}</div>
    {list.hasNextPage && <Button variant="outline" disabled={list.isFetchingNextPage || mutating} onClick={() => void list.fetchNextPage()}>Load more definitions</Button>}
    {!list.isFetching && !list.isError && !items.length && <p>No current authorized definitions are visible on this page. Record a process purpose in <Link to="/ai-governance" className="underline">AI Governance</Link> before proposing a definition.</p>}
    {definitionId && detail.isFetching && <p role="status">Checking the published definition and retained evidence…</p>}
    {pin && !isRetained(pin.expiresAt) && <p role="status">The retained definition expired. Refresh current definitions.</p>}
    {showDetail && <section aria-label="Inspect process definition" className="space-y-5">
      <h2 className="font-semibold">Definition review</h2>
      <label className="block space-y-2">Inspect version<select aria-label="Process definition version" className="w-full rounded-md border border-input bg-background p-2" value={pin.id} onChange={event => { setVersionId(event.target.value); setEditing(false); setRationale(""); }}>{pins.map(value => <option key={value.id} value={value.id}>Revision {value.revision}{root.publishedVersionId === value.id ? " · human published" : " · proposed or retained"}</option>)}</select></label>
      <p className="break-words">{pin.definition.businessQuestion}</p><p className="text-sm text-muted-foreground">Human review due {new Date(pin.nextReviewAt).toLocaleString()}. Retained until {new Date(pin.expiresAt).toLocaleString()}.</p>
      {detail.data!.reviewReason && <p role="status">{detail.data!.reviewReason}</p>}
      {detail.data!.hasMoreVersions && <p className="text-sm text-muted-foreground">Older versions are outside this bounded definition history.</p>}
      <details><summary className="cursor-pointer">Inspect immutable definition</summary><pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm">{JSON.stringify({ definition: pin.definition, contentHash: pin.contentHash }, null, 2)}</pre></details>
      {root.status !== "retired" && <><Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>Propose a revision</Button><label className="block space-y-2">Human publication rationale<Textarea aria-label="Human process review rationale" value={rationale} onChange={event => setRationale(event.target.value)} minLength={10} maxLength={2000} /></label><div className="flex flex-wrap gap-2"><Button disabled={busy || rationale.trim().length < 10 || root.publishedVersionId === pin.id || pin.id !== detail.data!.latestVersion.id} onClick={() => publish.mutate()}>Publish selected version</Button><Button variant="destructive" disabled={busy || rationale.trim().length < 10} onClick={() => retire.mutate()}>Retire definition</Button></div><p className="text-sm text-muted-foreground">Publication checks current purpose and owner. Analyses remain advisory and do not change native work.</p></>}
      {root.status === "published" && root.publishedVersionId === pin.id && <form aria-label="Run published process" className="space-y-4" onSubmit={event => { event.preventDefault(); if (runInput.success && !busy) analyze.mutate(); }}><h3 className="font-medium">Analyze the published definition</h3><div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2">Start date (UTC)<Input type="date" value={from} onChange={event => setFrom(event.target.value)} required /></label><label className="block space-y-2">End date (UTC)<Input type="date" value={until} onChange={event => setUntil(event.target.value)} required /></label></div><p className="text-sm text-muted-foreground">The full UTC days are included. Current retained native activity coverage must satisfy each analysis requirement. Open periods and unknown properties keep a run inconclusive.</p><Button type="submit" disabled={busy || !runInput.success}>Analyze observed period</Button></form>}
      {history.isFetching && <p role="status">Checking current access to retained runs…</p>}
      {!history.isError && !history.isFetching && <div className="space-y-3"><label className="block space-y-2">Retained run<select aria-label="Retained process run" className="w-full rounded-md border border-input bg-background p-2" value={runId} onChange={event => setRunId(event.target.value)}><option value="">Choose currently authorized evidence</option>{runs.filter(value => isRetained(value.expiresAt)).map(value => <option key={value.id} value={value.id}>{new Date(value.createdAt).toLocaleString()} · {value.result.status} · {value.from.slice(0, 10)} – {value.until.slice(0, 10)}</option>)}</select></label>{history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>Load more retained runs</Button>}<p className="text-sm text-muted-foreground">This is a bounded page of evidence currently admitted by its native source owner.</p></div>}
      {selectedRun.isFetching && runId && <p role="status">Checking current source and lineage access…</p>}
      {run && !isRetained(run.expiresAt) && <p role="status">This run's retention expired. Refresh current evidence.</p>}
      {run && runPin && isRetained(run.expiresAt) && isRetained(runPin.expiresAt) && <><ProcessAnalysisResult run={run} definition={runPin.definition} /><ProcessFindings key={run.id} run={run} userId={userId} /></>}
      {run && !runPin && <p role="status">This run's definition is outside the bounded version history. Inspect a retained version before interpreting its statistics.</p>}
    </section>}
    {editing && !list.isError && !list.isFetching && !detail.isError && (!root || (pin && isRetained(pin.expiresAt))) && <ProcessDefinitionForm key={`${root?.id ?? "new"}:${pin?.id ?? "new"}`} companyId={companyId} userId={userId} initial={root ? pin?.definition : undefined} busy={busy} onSave={definition => save.mutate(definition)} onCancel={() => setEditing(false)} />}
  </div>;
}
