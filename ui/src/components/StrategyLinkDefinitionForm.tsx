import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { strategyExecutionLinkDefinitionSchema, strategyExecutionRelationshipSchema, type StrategyExecutionLinkDefinition, type StrategyExecutionReference } from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { StrategySourcePicker } from "./StrategySourcePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/lib/router";
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
export function StrategyLinkDefinitionForm({ companyId, userId, initial, busy, onSave, onCancel }: { companyId: string; userId: string | null; initial?: StrategyExecutionLinkDefinition; busy: boolean; onSave: (definition: StrategyExecutionLinkDefinition) => void; onCancel: () => void }) {
  const [from, setFrom] = useState<StrategyExecutionReference | null>(initial?.from ?? null), [to, setTo] = useState<StrategyExecutionReference | null>(initial?.to ?? null);
  const [relationship, setRelationship] = useState<StrategyExecutionLinkDefinition["relationship"]>(initial?.relationship ?? "supports");
  const [rationale, setRationale] = useState(initial?.rationale ?? "");
  const [contribution, setContribution] = useState(initial?.contribution?.kind ?? "none");
  const [statement, setStatement] = useState(initial?.contribution?.kind === "hypothesis" ? initial.contribution.statement : "");
  const [weight, setWeight] = useState(initial?.contribution?.kind === "relative_priority" ? String(initial.contribution.weight) : "1");
  const [priorityReason, setPriorityReason] = useState(initial?.contribution?.kind === "relative_priority" ? initial.contribution.rationale : "");
  const [owner, setOwner] = useState(initial?.ownerUserId ?? userId ?? "local-board");
  const [policyId, setPolicyId] = useState(initial?.governanceObligationRefs[0] ?? "");
  const [review, setReview] = useState(String(initial?.reviewFrequencyDays ?? 30)), [retention, setRetention] = useState(String(initial?.retentionDays ?? 30));
  const [sensitivity, setSensitivity] = useState<"internal" | "confidential">(initial?.sensitivity ?? "internal");
  const policies = useQuery({ queryKey: ["governance-obligations", companyId, userId], queryFn: () => aiGovernanceApi.obligations(companyId, userId ?? undefined) });
  const valid = strategyExecutionLinkDefinitionSchema.safeParse({ from, to, relationship, rationale, contribution: contribution === "hypothesis" ? { kind: contribution, statement } : contribution === "relative_priority" ? { kind: contribution, weight: Number(weight), rationale: priorityReason } : null,
    ownerUserId: owner, reviewFrequencyDays: Number(review), retentionDays: Number(retention), sensitivity, purpose: "management_intelligence", governanceObligationRefs: [policyId, ...(initial?.governanceObligationRefs.slice(1) ?? [])] });
  return <form aria-label="Strategy link proposal" className="space-y-5" onSubmit={event => { event.preventDefault(); if (valid.success) onSave(valid.data); }}>
    <fieldset disabled={busy} className="space-y-5">
    <h2 className="font-semibold">{initial ? "Propose a reviewed revision" : "Propose a strategic relationship"}</h2>
    <p className="text-sm text-muted-foreground">Choose existing sources and explain the relationship. Saving creates a proposal; human approval remains a separate action.</p>
    <div className="grid gap-6 md:grid-cols-2"><StrategySourcePicker companyId={companyId} userId={userId} name="From" value={from} onChange={setFrom} fixed={initial?.from} /><StrategySourcePicker companyId={companyId} userId={userId} name="To" value={to} onChange={setTo} fixed={initial?.to} /></div>
    <label className="block space-y-2">Relationship<select aria-label="Strategy relationship" className={selectStyle} value={relationship} disabled={!!initial} onChange={event => setRelationship(event.target.value as typeof relationship)}>{strategyExecutionRelationshipSchema.options.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
    {relationship === "advanced_by" && <p className="text-sm text-muted-foreground">This relationship must match the existing Goal, Project, Milestone and Task ownership. Assign work in its native view first.</p>}
    <label className="block space-y-2">Business rationale<Textarea value={rationale} onChange={event => setRationale(event.target.value)} minLength={10} maxLength={2000} required /></label>
    <label className="block space-y-2">Contribution<select aria-label="Contribution interpretation" className={selectStyle} value={contribution} onChange={event => setContribution(event.target.value as typeof contribution)}><option value="none">No contribution estimate</option><option value="hypothesis">Qualitative hypothesis</option><option value="relative_priority">Relative priority input</option></select></label>
    {contribution === "hypothesis" && <label className="block space-y-2">Contribution hypothesis<Textarea value={statement} onChange={event => setStatement(event.target.value)} minLength={10} maxLength={2000} required /></label>}
    {contribution === "relative_priority" && <div className="space-y-3"><label className="block space-y-2">Relative priority weight<Input type="number" min="0.000001" max={1000} step="any" value={weight} onChange={event => setWeight(event.target.value)} required /></label><label className="block space-y-2">Priority rationale<Textarea value={priorityReason} onChange={event => setPriorityReason(event.target.value)} minLength={10} maxLength={2000} required /></label></div>}
    <p className="text-sm text-muted-foreground">A contribution estimate is a hypothesis or priority input. It is not a probability, percentage of business outcome or causal effect.</p>
    <label className="block space-y-2">Accountable owner<select aria-label="Strategy accountable owner" className={selectStyle} value={owner} onChange={event => setOwner(event.target.value)}>{initial?.ownerUserId && initial.ownerUserId !== (userId ?? "local-board") && <option value={initial.ownerUserId}>Existing accountable owner</option>}<option value={userId ?? "local-board"}>Current operator</option></select></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2">Review every (days)<Input type="number" min={1} max={365} value={review} onChange={event => setReview(event.target.value)} required /></label><label className="block space-y-2">Retain for (days)<Input type="number" min={1} max={3650} value={retention} onChange={event => setRetention(event.target.value)} required /></label></div>
    <label className="block space-y-2">Sensitivity<select aria-label="Strategy sensitivity" className={selectStyle} value={sensitivity} onChange={event => setSensitivity(event.target.value as typeof sensitivity)}><option value="internal">Internal</option><option value="confidential">Confidential</option></select></label>
    <label className="block space-y-2">Approved strategy purpose<select aria-label="Approved strategy purpose" className={selectStyle} value={policyId} onChange={event => setPolicyId(event.target.value)} required><option value="">Choose a current company purpose approval</option>{policies.data?.filter(row => row.obligation.framework === "company_policy" && row.obligation.analyticalPurpose?.status === "approved" && row.obligation.analyticalPurpose.capabilities.includes("strategy")).map(row => <option key={row.id} value={row.id}>{row.obligation.citation}</option>)}</select></label>
    {policies.error && <p role="alert">{policies.error.message}</p>}
    <p className="text-sm text-muted-foreground">Purpose, retention, current source authority and version pins are checked when saving and approving. Record an explicit strategy capability in <Link to="/ai-governance" className="underline">AI Governance</Link>.</p>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !valid.success}>Save proposal</Button><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button></div>
    {!valid.success && <p className="text-sm text-muted-foreground">Complete two distinct native sources, business rationale and approved purpose before saving.</p>}
    </fieldset>
  </form>;
}
