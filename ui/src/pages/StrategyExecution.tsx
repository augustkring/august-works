import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StrategyExecutionLinkDefinition } from "@paperclipai/shared";
import { strategyExecutionApi } from "@/api/strategy-execution";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { StrategyLinkDefinitionForm } from "@/components/StrategyLinkDefinitionForm";
import { StrategySourceReference } from "@/components/StrategySourceReference";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
export function StrategyExecution() {
  const { selectedCompanyId } = useCompany(); const { userId, settled, failed } = useAccountIdentity();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "Strategy and execution" }]); }, [setBreadcrumbs]);
  if (failed) return <p role="alert">Your account could not be verified. Reload this page.</p>;
  if (!settled) return <p role="status">Verifying account…</p>;
  if (!selectedCompanyId) return <p>Select a company to review its strategic relationships.</p>;
  return <StrategyExecutionWorkspace key={`${selectedCompanyId}:${userId ?? "local"}`} companyId={selectedCompanyId} userId={userId} />;
}
export function StrategyExecutionWorkspace({ companyId, userId }: { companyId: string; userId: string | null }) {
  const cache = useQueryClient(); const key = ["strategy-links", companyId, userId];
  const [linkId, setLinkId] = useState(""), [versionId, setVersionId] = useState("");
  const [editing, setEditing] = useState(false), [rationale, setRationale] = useState("");
  const [now, setNow] = useState(Date.now());
  const list = useInfiniteQuery({ queryKey: key, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => strategyExecutionApi.list(companyId, pageParam, userId), getNextPageParam: page => page.nextCursor ?? undefined });
  const detail = useQuery({ queryKey: [...key,"detail",linkId], queryFn: () => strategyExecutionApi.detail(companyId, linkId, userId), enabled: !!linkId });
  const link = detail.data?.link;
  const pin = detail.data && (versionId ? [detail.data.effectiveVersion,...detail.data.versions].find(version => version.id === versionId) : detail.data.effectiveVersion);
  const invalidate = () => { void cache.invalidateQueries({ queryKey: key }); };
  const save = useMutation({ mutationFn: async (definition: StrategyExecutionLinkDefinition) => link ? strategyExecutionApi.revise(companyId, link.id, { expectedRevision: link.revision, definition }, userId) : strategyExecutionApi.create(companyId, { definition }, userId), onSuccess: response => { invalidate(); setEditing(false); if ("link" in response) { setLinkId(response.link.id); setVersionId(response.version.id); } else setVersionId(response.id); } });
  const approve = useMutation({ mutationFn: () => strategyExecutionApi.approve(companyId, link!.id, { expectedRevision: link!.revision, versionId: pin!.id, rationale }, userId), onSuccess: () => { invalidate(); setVersionId(""); setRationale(""); } });
  const retire = useMutation({ mutationFn: () => strategyExecutionApi.retire(companyId, link!.id, { expectedRevision: link!.revision, rationale }, userId), onSuccess: () => { invalidate(); setRationale(""); } });
  const busy = save.isPending || approve.isPending || retire.isPending;
  const error = [list.error,detail.error,save.error,approve.error,retire.error].find(Boolean);
  const rows = list.isError ? [] : list.data?.pages.flatMap(page => page.items) ?? [];
  const items = rows.filter(row => Date.parse(row.expiresAt)>Math.max(now,Date.now()));
  const expired = pin ? Date.parse(pin.expiresAt)<=Math.max(now,Date.now()) : false;
  const expires = [...rows.map(row => row.expiresAt),...(pin ? [pin.expiresAt] : [])].sort();
  const nextExpiry = expires.find(value => Date.parse(value)>Math.max(now,Date.now()));
  useEffect(() => {
    if (!nextExpiry) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.max(0,Date.parse(nextExpiry)-Date.now()),2_147_483_647));
    return () => window.clearTimeout(timer);
  },[nextExpiry,now]);
  const showDetail = detail.data && !detail.isError && !list.isError && link && pin && !expired;
  return <div className="space-y-6">
    <header className="space-y-2"><h1 className="text-xl font-semibold">Strategy and execution</h1><p className="text-muted-foreground">Review how approved strategy, objectives, work and measurements relate. A relationship records an explicit rationale and its source versions.</p></header>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { setLinkId(""); setVersionId(""); setEditing(true); setRationale(""); save.reset(); approve.reset(); retire.reset(); }}>Propose a relationship</Button><Button variant="ghost" disabled={busy} onClick={invalidate}>Refresh relationships</Button></div>
    {error && <p role="alert">{error.message} Refresh current sources and purpose before retrying.</p>}
    {list.isPending && <p role="status">Loading authorized relationships…</p>}
    <div className="space-y-3">{items.map(row => <article key={row.id} className="rounded-md border border-border p-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{row.definition.relationship.replaceAll("_", " ")}</span><Badge variant="outline">{row.status.replaceAll("_", " ")}</Badge></div><div className="grid gap-4 sm:grid-cols-2"><StrategySourceReference companyId={companyId} userId={userId} reference={row.definition.from} /><StrategySourceReference companyId={companyId} userId={userId} reference={row.definition.to} /></div><p className="break-words">{row.definition.rationale}</p>{row.reviewReason && <p className="text-sm text-muted-foreground">{row.reviewReason}</p>}<Button variant="outline" size="sm" disabled={busy} onClick={() => { setLinkId(row.id); setVersionId(""); setEditing(false); setRationale(""); }}>Inspect relationship</Button></article>)}</div>
    {list.hasNextPage && <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more relationships</Button>}
    {!list.isPending && !list.isError && !items.length && <p>No authorized relationships are visible on this page. Propose a link after recording an approved strategy purpose in <Link to="/ai-governance" className="underline">AI Governance</Link>.</p>}
    <p className="text-sm text-muted-foreground">This bounded view does not establish that work is orphaned or objectives are unserved. Relationships require current native authority and do not apply work changes.</p>
    {detail.isFetching && linkId && <p role="status">Checking current sources and approvals…</p>}
    {expired && <p role="status">This retained version expired. Refresh current relationships before using its sources.</p>}
    {showDetail && <section aria-label="Inspect strategic relationship" className="space-y-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Relationship review</h2><Badge variant="outline">{link.status.replaceAll("_", " ")}</Badge><Badge variant="outline">{pin.id === link.approvedVersionId ? "Approved version" : "Retained version"}</Badge></div>
      <label className="block space-y-2">Inspect version<select aria-label="Strategy definition version" className="w-full rounded-md border border-input bg-background p-2" value={pin.id} onChange={event => { setVersionId(event.target.value); setEditing(false); setRationale(""); }}>{[detail.data!.effectiveVersion,...detail.data!.versions.filter(version => version.id !== detail.data!.effectiveVersion.id)].map(version => <option key={version.id} value={version.id}>Revision {version.revision}{version.id === link.approvedVersionId ? " · human approved" : " · retained"}</option>)}</select></label>
      {detail.data!.hasMoreVersions && <p className="text-sm text-muted-foreground">Older retained versions are outside this bounded history view.</p>}
      <div className="grid gap-4 sm:grid-cols-2"><StrategySourceReference companyId={companyId} userId={userId} reference={pin.definition.from} /><StrategySourceReference companyId={companyId} userId={userId} reference={pin.definition.to} /></div>
      <p className="break-words">{pin.definition.rationale}</p>
      {pin.definition.contribution && <p className="break-words">{pin.definition.contribution.kind === "hypothesis" ? `Hypothesis: ${pin.definition.contribution.statement}` : `Relative priority: ${pin.definition.contribution.weight}. ${pin.definition.contribution.rationale}`}</p>}
      <p className="text-sm text-muted-foreground">Human review due {new Date(pin.nextReviewAt).toLocaleString()}. Retained until {new Date(pin.expiresAt).toLocaleString()}. Contribution is not a causal effect.</p>
      {detail.data!.reviewReason && <p role="status">{detail.data!.reviewReason} Propose current version pins before approving.</p>}
      <details><summary className="cursor-pointer">Inspect immutable source references</summary><pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm">{JSON.stringify({ from: pin.definition.from, to: pin.definition.to, contentHash: pin.contentHash },null,2)}</pre></details>
      {link.status !== "retired" && <><Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>Propose a revision</Button><label className="block space-y-2">Human review rationale<Textarea aria-label="Human strategy review rationale" value={rationale} onChange={event => setRationale(event.target.value)} minLength={10} maxLength={2000} /></label><div className="flex flex-wrap gap-2"><Button disabled={busy || rationale.trim().length<10 || pin.id === link.approvedVersionId || detail.isFetching} onClick={() => approve.mutate()}>Approve selected version</Button><Button variant="destructive" disabled={busy || rationale.trim().length<10 || detail.isFetching} onClick={() => retire.mutate()}>Retire relationship</Button></div><p className="text-sm text-muted-foreground">Approval checks the current strategy, purpose and execution ownership. Retirement withdraws the relationship and leaves native work under its existing owner.</p></>}
    </section>}
    {editing && !expired && !list.isError && !detail.isError && <StrategyLinkDefinitionForm key={`${link?.id ?? "new"}:${pin?.id ?? "new"}`} companyId={companyId} userId={userId} initial={link ? pin?.definition : undefined} busy={busy} onSave={definition => save.mutate(definition)} onCancel={() => setEditing(false)} />}
  </div>;
}
