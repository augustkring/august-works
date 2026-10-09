import { useEffect, useState } from "react";
import { useInfiniteQuery, useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v7FeatureEnabled, v8FeatureEnabled, type BusinessScenarioDefinition } from "@paperclipai/shared";
import { businessScenariosApi } from "@/api/business-scenarios";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { BusinessScenarioDefinitionForm } from "@/components/BusinessScenarioDefinitionForm";
import { BusinessScenarioResult, scenarioUnitLabel } from "@/components/BusinessScenarioResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Link } from "@/lib/router";
import { formatNumber } from "@/lib/utils";
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
export function BusinessScenarios() {
  const { selectedCompanyId } = useCompany(), { userId, settled, failed } = useAccountIdentity(), { setBreadcrumbs } = useBreadcrumbs();
  const verifying = useIsFetching({ queryKey: queryKeys.auth.session }) > 0;
  const flags = useQuery({ queryKey: [...queryKeys.instance.experimentalSettings, "business-scenarios", userId], queryFn: () => instanceSettingsApi.getExperimental(), enabled: !!selectedCompanyId && settled && !failed && !verifying, refetchOnWindowFocus: false, retry: false });
  useEffect(() => { setBreadcrumbs([{ label: "Business scenarios" }]); }, [setBreadcrumbs]);
  if (failed) return <p role="alert">Your account could not be verified. Reload this page.</p>;
  if (!settled || verifying) return <p role="status">Verifying current account…</p>;
  if (!selectedCompanyId) return <p>Select a company to review conditional scenarios.</p>;
  if (flags.isFetching) return <p role="status">Rechecking scenario availability…</p>;
  if (flags.isError) return <p role="alert">Scenario availability could not be verified.</p>;
  if (!flags.data || !v8FeatureEnabled(flags.data, "scenario_planning_v8") || !v7FeatureEnabled(flags.data, "governance_evidence_v7")) return <p>Governed scenario planning is not enabled.</p>;
  return <BusinessScenarioWorkspace key={`${selectedCompanyId}:${userId ?? "local"}`} companyId={selectedCompanyId} userId={userId} />;
}
export function BusinessScenarioWorkspace({ companyId, userId }: { companyId: string; userId: string | null }) {
  const cache = useQueryClient(), key = ["business-scenarios", companyId, userId], account = userId ?? undefined;
  const [id, setId] = useState(""), [versionId, setVersionId] = useState(""), [runId, setRunId] = useState(""), [editing, setEditing] = useState(false);
  const [rationale, setRationale] = useState(""), [seed, setSeed] = useState(""), [now, setNow] = useState(Date.now());
  const reviewing = editing || !!rationale || !!seed, interval = reviewing ? false : 30000;
  const list = useInfiniteQuery({ queryKey: key, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => businessScenariosApi.list(companyId, pageParam, account), getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: interval, refetchOnWindowFocus: !reviewing, retry: false });
  const detail = useQuery({ queryKey: [...key, "detail", id], queryFn: () => businessScenariosApi.detail(companyId, id, account), enabled: !!id, refetchInterval: interval, refetchOnWindowFocus: !reviewing, retry: false });
  const runs = useInfiniteQuery({ queryKey: [...key, "runs", id], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => businessScenariosApi.runs(companyId, id, pageParam, account), getNextPageParam: page => page.nextCursor ?? undefined, enabled: !!id, refetchInterval: interval, refetchOnWindowFocus: !reviewing, retry: false });
  const selectedRun = useQuery({ queryKey: [...key, "run", id, runId], queryFn: () => businessScenariosApi.result(companyId, id, runId, account), enabled: !!id && !!runId, refetchInterval: interval, refetchOnWindowFocus: !reviewing, retry: false });
  const retained = (expiry: string) => Date.parse(expiry) > Math.max(now, Date.now());
  const root = !list.isFetching && !list.isError && !detail.isFetching && !detail.isError && detail.data?.scenario.companyId === companyId ? detail.data.scenario : undefined;
  const pins = root ? detail.data?.versions.filter(item => item.companyId === companyId && item.scenarioId === root.id && retained(item.expiresAt)) ?? [] : [];
  const pin = pins.find(item => item.id === (versionId || pins[0]?.id));
  const run = root && !runs.isFetching && !runs.isError && !selectedRun.isFetching && !selectedRun.isError && selectedRun.data?.companyId === companyId && selectedRun.data.scenarioId === id && selectedRun.data.versionId === pin?.id && retained(selectedRun.data.expiresAt) ? selectedRun.data : undefined;
  const refresh = () => { setEditing(false); setRationale(""); setSeed(""); void cache.invalidateQueries({ queryKey: key }); };
  const revoke = () => { setEditing(false); setRationale(""); setSeed(""); setRunId(""); void cache.resetQueries({ queryKey: key }); void cache.resetQueries({ queryKey: ["scenario-source", companyId, userId] }); void cache.resetQueries({ queryKey: ["scenario-definition-sources", companyId, userId] }); };
  const save = useMutation({ mutationFn: (input: { key: string; definition: BusinessScenarioDefinition }) => root ? businessScenariosApi.revise(companyId, root.id, { expectedRevision: root.revision, definition: input.definition }, account) : businessScenariosApi.create(companyId, input, account), onSuccess: value => { setId(value.scenario.id); setVersionId(value.version.id); setRunId(""); refresh(); }, onError: revoke });
  const publish = useMutation({ mutationFn: () => businessScenariosApi.publish(companyId, root!.id, { expectedRevision: root!.revision, versionId: pin!.id, rationale }, account), onSuccess: refresh, onError: revoke });
  const execute = useMutation({ mutationFn: () => businessScenariosApi.run(companyId, root!.id, { expectedRevision: root!.revision, versionId: pin!.id, seed: pin!.definition.calculationType === "bounded_monte_carlo" ? Number(seed) : null }, account), onSuccess: value => { setRunId(value.id); refresh(); }, onError: revoke });
  const retire = useMutation({ mutationFn: () => businessScenariosApi.retire(companyId, root!.id, { expectedRevision: root!.revision, rationale }, account), onSuccess: refresh, onError: revoke });
  const busy = save.isPending || publish.isPending || execute.isPending || retire.isPending;
  const error = [list.error, detail.error, runs.error, selectedRun.error, save.error, publish.error, execute.error, retire.error].find(Boolean);
  const reasonValid = rationale.trim().length >= 10 && rationale.trim().length <= 2000;
  const canPublish = !!root && !!pin && root.status !== "retired" && root.revision === pin.revision && pin.currentQualification === "current";
  const canRun = !!root && !!pin && root.status === "published" && root.publishedVersionId === pin.id && pin.currentQualification === "current";
  const seedValid = pin?.definition.calculationType !== "bounded_monte_carlo" || /^\d{1,10}$/.test(seed) && Number.isInteger(Number(seed)) && Number(seed) <= 0xffffffff;
  const rows = !list.isFetching && !list.isError ? list.data?.pages.flatMap(page => page.items).filter(item => item.scenario.companyId === companyId && item.version.companyId === companyId && retained(item.version.expiresAt)) ?? [] : [];
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); window.addEventListener("memory-access-changed", revoke); return () => { window.clearInterval(timer); window.removeEventListener("memory-access-changed", revoke); }; }, [cache, companyId, userId]);
  return <div className="min-w-0 space-y-6"><header className="space-y-2"><h1 className="text-xl font-semibold">Business scenarios</h1><p className="text-muted-foreground">Compare what an explicit conditional model implies across human assumptions and interventions. Results support a separate human decision.</p></header>
    {error && <div role="alert" className="space-y-2"><p>{error.message}</p><Button variant="outline" onClick={revoke}>Recheck scenario authority</Button></div>}
    {list.isFetching && <p role="status">Rechecking current scenario authority…</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || list.isFetching} onClick={() => { setId(""); setVersionId(""); setRunId(""); setRationale(""); setSeed(""); setEditing(true); }}>Define a scenario</Button><Button variant="ghost" disabled={busy} onClick={refresh}>Refresh scenarios</Button></div>
    <label className="block space-y-2">Scenario<select aria-label="Scenario" className={selectStyle} value={id} disabled={busy || editing} onChange={event => { setId(event.target.value); setVersionId(""); setRunId(""); setRationale(""); setSeed(""); }}><option value="">Choose a conditional model</option>{rows.map(item => <option key={item.scenario.id} value={item.scenario.id}>{item.version.definition.name} · {item.scenario.status}</option>)}</select></label>
    {list.hasNextPage && <Button variant="outline" disabled={list.isFetching || busy} onClick={() => void list.fetchNextPage()}>Load more scenarios</Button>}
    {id && detail.isFetching && <p role="status">Rechecking retained scenario definition…</p>}
    {root && pin && <Card className="min-w-0"><CardHeader><h2 className="font-semibold">{pin.definition.name} · {root.status}</h2><p>{pin.definition.objective}</p></CardHeader><CardContent className="min-w-0 space-y-4"><p>{pin.definition.decisionUse}</p>
      <label className="block space-y-2">Scenario version<select aria-label="Scenario version" className={selectStyle} value={pin.id} disabled={busy || editing} onChange={event => { setVersionId(event.target.value); setRunId(""); setRationale(""); setSeed(""); }}>{pins.map(item => <option key={item.id} value={item.id}>Version {item.revision}{root.publishedVersionId === item.id ? " · human-published" : " · proposal"} · {item.currentQualification.replaceAll("_", " ")}</option>)}</select></label>
      <p className="text-sm">{pin.definition.calculationType.replaceAll("_", " ")} · {pin.definition.cases.length} cases · {pin.definition.assumptions.length} explicit assumptions · retained until {new Date(pin.expiresAt).toLocaleString()}</p>
      {pin.currentQualification === "needs_revalidation" && <p role="status">Current source definitions, corrections or forecast qualification changed. Propose a new version with reviewed native pins before publication or running.</p>}
      {!editing && root.status !== "retired" && <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>Propose a scenario revision</Button>}
      <details><summary className="cursor-pointer">Inspect assumptions, exact source pins and model limits</summary><div className="space-y-3 pt-3 text-sm"><p>Showing at most five retained definition versions. Numerical bounds do not prove complete organizational feasibility.</p>{pin.definition.assumptions.map(item => <div key={item.key}><p className="font-medium">{item.name} · owner {item.ownerUserId}</p><p>{formatNumber(item.nominal)} {scenarioUnitLabel(item.unit)} · declared range {formatNumber(item.range.minimum)} to {formatNumber(item.range.maximum)} · {item.controllable ? "controllable" : "external"}</p><p>{item.confidence.replaceAll("_", " ")} · {item.uncertaintyRationale}</p>{item.evidence.map((evidence, index) => <p key={index}>{evidence.kind === "human_statement" ? evidence.rationale : `Supporting native input: ${evidence.inputKey}`}</p>)}</div>)}{pin.inputs.map(input => <p key={input.key} className="break-all">{input.key} · {input.kind.replaceAll("_", " ")} · {scenarioUnitLabel(input.unit)} · captured {formatNumber(input.value)} · source {input.sourceId}</p>)}{pin.definition.nonModeledEffects.map(text => <p key={text}>{text}</p>)}<p className="break-all">Definition {pin.contentHash} · inputs {pin.inputHash}</p></div></details>
      {!runs.isFetching && !runs.isError && <label className="block space-y-2">Retained scenario run<select aria-label="Retained scenario run" className={selectStyle} value={runId} disabled={busy || editing} onChange={event => setRunId(event.target.value)}><option value="">Choose conditional result evidence</option>{runs.data?.pages.flatMap(page => page.items).filter(item => item.companyId === companyId && item.versionId === pin.id && retained(item.expiresAt)).map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.result.status} · {item.currentQualification.replaceAll("_", " ")}</option>)}</select></label>}
      {runs.isFetching && <p role="status">Rechecking retained scenario runs…</p>}{runs.hasNextPage && <Button variant="outline" disabled={runs.isFetching || busy} onClick={() => void runs.fetchNextPage()}>Load more scenario runs</Button>}
      {!editing && root.status !== "retired" && <section aria-label="Human scenario publication and run" className="space-y-3"><label className="block space-y-2">Human review rationale<Textarea aria-label="Human scenario review rationale" value={rationale} onChange={event => setRationale(event.target.value)} minLength={10} maxLength={2000} /></label><div className="flex flex-wrap gap-2"><Button disabled={busy || !reasonValid || !canPublish} onClick={() => publish.mutate()}>Publish this scenario version</Button><Button variant="outline" disabled={busy || !reasonValid} onClick={() => retire.mutate()}>Retire scenario</Button></div>
        {pin.definition.calculationType === "bounded_monte_carlo" && <label className="block space-y-2">Reproducible run seed<Input aria-label="Reproducible run seed" type="number" min={0} max={0xffffffff} step={1} value={seed} onChange={event => setSeed(event.target.value)} /></label>}
        <Button variant="outline" disabled={busy || !canRun || !seedValid} onClick={() => execute.mutate()}>Run this conditional scenario</Button><p className="text-sm text-muted-foreground">Publication records human approval of the model, not evidence that its assumptions are true. Running calculates conditional results without changing a target, budget, roadmap or native Decision.</p></section>}
    </CardContent></Card>}
    {editing && (!id || root && pin) && <BusinessScenarioDefinitionForm key={id ? pin?.id : "new"} companyId={companyId} userId={userId} initial={id ? pin?.definition : undefined} scenarioKey={root?.key} busy={busy} onSave={input => save.mutate(input)} onCancel={() => setEditing(false)} />}
    {root && selectedRun.isFetching && <p role="status">Rechecking selected scenario result authority…</p>}{run && <BusinessScenarioResult artifact={run} />}
    {!list.isFetching && !list.isError && !rows.length && !editing && <p>No authorized scenarios were returned on this bounded page. Review an approved scenario purpose in <Link to="/ai-governance">AI Governance</Link> before proposing a conditional model.</p>}
  </div>;
}
