import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NATIVE_PROCESS_ACTIVITIES, NATIVE_PROCESS_ANALYSIS_FAMILIES, processAnalysisDefinitionSchema, type ProcessAnalysisDefinition, type ProcessConformanceExpectation } from "@paperclipai/shared";
import { ProcessConformanceEditor } from "./ProcessConformanceEditor";
import { aiGovernanceApi } from "@/api/ai-governance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Link } from "@/lib/router";

export const processFamilyLabel: Record<ProcessAnalysisDefinition["analysisFamilies"][number], string> = {
  event_volume: "Observed activity volume", directly_follows: "Directly follows", variants: "Observed path variants",
  cycle_time: "Time to first completion", blocked_time: "Observed blocked time", rework: "Observed reopening", conformance: "Explicit process conformance",
};
export const processActivityLabel: Record<typeof NATIVE_PROCESS_ACTIVITIES[number], string> = {
  "issue.created": "Task created", "issue.updated": "Task updated", "issue.checked_out": "Task checked out", "issue.released": "Task released",
  "project.created": "Project created", "project.updated": "Project updated",
};
function toggle<T>(items: T[], value: T, checked: boolean) { return checked ? [...items, value] : items.filter(item => item !== value); }

export function ProcessDefinitionForm({ companyId, userId, initial, busy, onSave, onCancel }: {
  companyId: string; userId: string | null; initial?: ProcessAnalysisDefinition; busy: boolean;
  onSave: (definition: ProcessAnalysisDefinition) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? ""), [question, setQuestion] = useState(initial?.businessQuestion ?? "");
  const [owner, setOwner] = useState(initial?.ownerUserId ?? userId ?? "local-board");
  const [policyId, setPolicyId] = useState(initial?.governanceObligationRefs[0] ?? "");
  const [objects, setObjects] = useState<ProcessAnalysisDefinition["objectTypes"]>(initial?.objectTypes ?? ["issue"]);
  const [activities, setActivities] = useState<ProcessAnalysisDefinition["requiredActivities"]>(initial?.requiredActivities ?? ["issue.created", "issue.updated"]);
  const [families, setFamilies] = useState<ProcessAnalysisDefinition["analysisFamilies"]>(initial?.analysisFamilies ?? ["event_volume", "directly_follows", "variants"]);
  const [models,setModels]=useState<Record<"issue"|"project",ProcessConformanceExpectation>>(()=>Object.fromEntries((["issue","project"] as const).map(objectType=>[objectType,
    initial?.conformance?.expectations.find(value=>value.objectType===objectType) ?? {objectType,initialStates:[],terminalStates:[],requiredStates:[],allowedTransitions:[]}])) as Record<"issue"|"project",ProcessConformanceExpectation>);
  const [hours, setHours] = useState(String((initial?.minimumCoverageSeconds ?? 3600) / 3600));
  const [arrival, setArrival] = useState(initial?.requiresArrivalEvidence ?? false);
  const [review, setReview] = useState(String(initial?.reviewFrequencyDays ?? 30)), [retention, setRetention] = useState(String(initial?.retentionDays ?? 30));
  const policies = useQuery({ queryKey: ["governance-obligations", companyId, userId], queryFn: () => aiGovernanceApi.obligations(companyId, userId ?? undefined) });
  const valid = processAnalysisDefinitionSchema.safeParse({
    name, businessQuestion: question, ownerUserId: owner, reviewFrequencyDays: Number(review), retentionDays: Number(retention), scope: "company", sensitivity: "internal", purpose: "process_intelligence",
    governanceObligationRefs: [policyId, ...(initial?.governanceObligationRefs.slice(1) ?? [])],
    requiredSourceProviders: initial?.requiredSourceProviders ?? ["activity_log"], objectTypes: objects, requiredActivities: activities,
    minimumCoverageSeconds: Number(hours) * 3600, analysisFamilies: families, requiresArrivalEvidence: arrival, maxLateArrivalRate: initial?.maxLateArrivalRate ?? 0,
    conformance:families.includes("conformance") ? {kind:"explicit_definition",expectations:objects.map(type=>models[type])} : null,
  });
  return <form aria-label="Process definition proposal" className="space-y-5" onSubmit={event => { event.preventDefault(); if (valid.success && !policies.isError) onSave(valid.data); }}>
    <fieldset disabled={busy} className="space-y-5">
      <legend className="font-semibold">{initial ? "Propose a process revision" : "Propose a process definition"}</legend>
      <p className="text-sm text-muted-foreground">Saving creates an immutable proposal. Publication requires a separate human review.</p>
      <label className="block space-y-2">Definition name<Input value={name} onChange={event => setName(event.target.value)} minLength={3} maxLength={160} required /></label>
      <label className="block space-y-2">Business question<Textarea value={question} onChange={event => setQuestion(event.target.value)} minLength={10} maxLength={2000} required /></label>
      <fieldset className="space-y-3"><legend className="font-medium">Object perspectives</legend>{(["issue", "project"] as const).map(value => <label key={value} className="flex items-center gap-3"><Checkbox aria-label={`Analyze ${value === "issue" ? "Tasks" : "Projects"}`} checked={objects.includes(value)} onCheckedChange={checked => setObjects(toggle(objects, value, checked === true))} /><span>{value === "issue" ? "Tasks" : "Projects"}</span></label>)}</fieldset>
      <fieldset className="space-y-3"><legend className="font-medium">Required observed activities</legend>{NATIVE_PROCESS_ACTIVITIES.map(value => <label key={value} className="flex items-center gap-3"><Checkbox aria-label={`Require ${processActivityLabel[value]}`} checked={activities.includes(value)} onCheckedChange={checked => setActivities(toggle(activities, value, checked === true))} /><span>{processActivityLabel[value]}</span></label>)}</fieldset>
      <fieldset className="space-y-3"><legend className="font-medium">Analysis families</legend>{NATIVE_PROCESS_ANALYSIS_FAMILIES.map(value => <label key={value} className="flex items-center gap-3"><Checkbox aria-label={processFamilyLabel[value]} checked={families.includes(value)} onCheckedChange={checked => setFamilies(toggle(families, value, checked === true))} /><span>{processFamilyLabel[value]}</span></label>)}</fieldset>
      {families.includes("conformance") && objects.map(type=><ProcessConformanceEditor key={type} model={models[type]} onChange={model=>setModels({...models,[type]:model})} />)}
      {families.includes("conformance") && !valid.success && <p role="status" className="text-sm text-muted-foreground">Each perspective needs a model with an expected start, a terminal state and reachable required visits. Metadata and repeated status observations do not count as transitions.</p>}
      <p className="text-sm text-muted-foreground">Ordered paths require unambiguous timestamps. Duration and reopening require recorded primary creation and completion facts. A related Project cannot inherit a Task's lifecycle.</p>
      <label className="block space-y-2">Minimum observed period (hours)<Input type="number" min={1 / 3600} max={3650 * 24} step="any" value={hours} onChange={event => setHours(event.target.value)} required /></label>
      <div className="flex items-center gap-3"><ToggleSwitch aria-label="Require arrival evidence" checked={arrival} onCheckedChange={setArrival} /><span>Require arrival evidence</span></div>
      {arrival && <p role="status" className="text-sm text-muted-foreground">The native activity source has no qualified transport-arrival evidence. This requirement will keep a run inconclusive.</p>}
      <p className="text-sm text-muted-foreground">Coverage uses current retained native Task and Project activities. Required sources: {(initial?.requiredSourceProviders ?? ["activity_log"]).join(", ")}. External sources require separate qualification.</p>
      <label className="block space-y-2">Accountable owner<select aria-label="Process accountable owner" className="w-full rounded-md border border-input bg-background p-2" value={owner} onChange={event => setOwner(event.target.value)}>{initial?.ownerUserId && initial.ownerUserId !== (userId ?? "local-board") && <option value={initial.ownerUserId}>Existing accountable owner</option>}<option value={userId ?? "local-board"}>Current operator</option></select></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2">Review every (days)<Input type="number" min={1} max={3650} value={review} onChange={event => setReview(event.target.value)} required /></label><label className="block space-y-2">Retain for (days)<Input type="number" min={1} max={3650} value={retention} onChange={event => setRetention(event.target.value)} required /></label></div>
      <label className="block space-y-2">Approved process purpose<select aria-label="Approved process purpose" className="w-full rounded-md border border-input bg-background p-2" value={policyId} onChange={event => setPolicyId(event.target.value)} required><option value="">Choose a current company purpose approval</option>{!policies.isError && policies.data?.filter(row => row.obligation.framework === "company_policy" && row.obligation.analyticalPurpose?.status === "approved" && row.obligation.analyticalPurpose.purpose === "process_intelligence" && row.obligation.analyticalPurpose.capabilities.includes("process")).map(row => <option key={row.id} value={row.id}>{row.obligation.citation}</option>)}</select></label>
      {policies.error && <p role="alert">{policies.error.message}</p>}
      <p className="text-sm text-muted-foreground">Record purpose approval in <Link to="/ai-governance" className="underline">AI Governance</Link>. These analyses summarize business objects and do not estimate causal effects or rank people.</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !valid.success || policies.isError}>Save process proposal</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button></div>
      {!valid.success && <p className="text-sm text-muted-foreground">Complete the business question, observed activities, perspectives, analyses and approved purpose.</p>}
    </fieldset>
  </form>;
}
