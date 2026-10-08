import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { portfolioPlanningProfileSchema, type CrossProjectPlanningProfile, type PortfolioPlanningProfile, type PortfolioPlanningPreview as Preview } from "@paperclipai/shared";
import { crossProjectPlanningApi } from "@/api/cross-project-planning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProjectPlanningResult } from "./ProjectPlanningResult";

type Declaration = { alignment: string; value: string; risk: string; cost: string; rationale: string; mandatory: boolean; protected: boolean; preference: "eligible" | "stop" | "investigate" };
const empty = (): Declaration => ({ alignment: "", value: "", risk: "", cost: "", rationale: "", mandatory: false, protected: false, preference: "eligible" });
const numberOrUnknown = (value: string) => value.trim() ? Number(value) : null;
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
const reasons: Record<string, string> = {
  feasible_under_declared_selected_scope_constraints: "Fits the declared goals, capacity and budget limits.",
  native_hard_budget_bound: "Estimated billed runtime cost exceeds the configured budget.",
  unknown_native_cost_or_budget_period_coverage: "Actual costs or costs for part of this planning period are unknown.",
  unknown_declared_dimension_or_cost: "A required company dimension or cost estimate is unknown.",
  no_current_native_active_goal: "No currently planned or active Goal is linked.",
  below_explicit_company_dimension_minimum: "Falls below the company's declared minimum dimension.",
  selected_project_count_limit: "Exceeds the declared active project limit within this selection.",
  native_capacity_or_deadline_infeasible: "The declared capacity or dates cannot fit this initiative.",
  native_schedule_inconclusive: "A feasible schedule could not be established.",
  native_project_lifecycle_requires_investigation: "The project is paused or its current status requires investigation.",
  unselected_native_predecessor: "An unfinished prerequisite belongs to an initiative outside the proposed selection.",
  native_project_dependency_cycle: "The selected initiatives cannot be ordered independently; inspect their dependencies.",
  protected_or_mandatory_commitment: "A protected or mandatory commitment requires investigation before any pause or stop proposal.",
  human_investigation_requested: "The Human declaration requests investigation first.",
  explicit_human_stop_preference: "The Human declaration explicitly proposes stopping this initiative.",
};

/** Transient advisory preview sharing the original complete Task declarations.
 * Source/account changes remount this component in the native parent workspace. */
export function PortfolioPlanningPreview({ companyId, userId, profile, projectLabels, taskLabels, now, onAuthorityLost, onProposed }: { companyId: string; userId: string | null; profile: CrossProjectPlanningProfile; projectLabels: Record<string, string>; taskLabels: Record<string, string>; now: number; onAuthorityLost: () => void; onProposed: (id: string) => void }) {
  const [declarations, setDeclarations] = useState<Record<string, Declaration>>(() => Object.fromEntries(profile.projects.map(project => [project.id, empty()])));
  const [maximum, setMaximum] = useState(String(profile.projects.length)), [minimum, setMinimum] = useState(""), [order, setOrder] = useState(""), [requireGoal, setRequireGoal] = useState(true), [mandatoryFirst, setMandatoryFirst] = useState(true);
  const [preview, setPreview] = useState<{ response: Preview; profile: PortfolioPlanningProfile } | null>(null), [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const inspect = useMutation({ gcTime: 0, mutationFn: (input: PortfolioPlanningProfile) => crossProjectPlanningApi.previewInitiatives(companyId, input, userId), onSuccess: (response, input) => setPreview({ response, profile: input }), onError: onAuthorityLost });
  const propose = useMutation({ gcTime: 0, mutationFn: () => crossProjectPlanningApi.proposeInitiatives(companyId, preview!.profile, preview!.response.snapshotHash, reason, userId), onSuccess: result => onProposed(result.id), onError: onAuthorityLost });
  const amend = (id: string, patch: Partial<Declaration>) => { setPreview(null); setReason(""); setError(""); setDeclarations(old => ({ ...old, [id]: { ...old[id], ...patch } })); };
  const policyChange = (change: () => void) => { setPreview(null); setReason(""); setError(""); change(); };
  const current = preview && Date.parse(preview.response.expiresAt) > Math.max(now, Date.now()) ? preview : null;
  return <section aria-label="Declared initiative prioritization" className="min-w-0 space-y-4"><h2 className="font-semibold">Compare initiative priorities</h2><p>Use the complete Task, dependency and capacity assumptions declared above. Enter separate company dimensions and expected billed runtime costs. Empty values remain unknown.</p>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault(); setPreview(null); setReason("");
      const parsed = portfolioPlanningProfileSchema.safeParse({ ...profile,
        initiatives: profile.projects.map(project => { const input = declarations[project.id]; return { projectId: project.id, mandatoryCommitment: input.mandatory, protectedCommitment: input.protected, preference: input.preference, dimensions: { strategic_alignment: numberOrUnknown(input.alignment), declared_value: numberOrUnknown(input.value), declared_risk: numberOrUnknown(input.risk) }, estimatedBilledCostCents: numberOrUnknown(input.cost), rationale: input.rationale }; }),
        initiativePolicy: { mandatoryCommitmentsFirst: mandatoryFirst, orderBy: order ? [{ key: order, direction: order === "declared_risk" ? "minimize" : "maximize" }] : [], minimumDimensions: minimum.trim() ? [{ key: "strategic_alignment", minimum: Number(minimum) }] : [], requireActiveGoal: requireGoal, maxSelectedActiveProjects: Number(maximum) },
      });
      if (!parsed.success) { setError("Check each initiative rationale, declared values and selected project limit."); return; }
      setError(""); inspect.mutate(parsed.data);
    }}><fieldset disabled={inspect.isPending || propose.isPending} className="min-w-0 space-y-4"><legend className="sr-only">Explicit Human initiative assumptions</legend>
      {profile.projects.map(project => { const input = declarations[project.id], label = projectLabels[project.id] ?? project.id; return <fieldset key={project.id} className="min-w-0 space-y-3 rounded-md border border-border p-3"><legend className="max-w-full break-words px-1 font-medium">{label}</legend>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">{([["alignment", "Strategic alignment"], ["value", "Declared business value"], ["risk", "Declared risk"], ["cost", "Estimated billed runtime cost in cents"]] as const).map(([key, title]) => <label key={key} className="block min-w-0 space-y-2">{title}<Input aria-label={`${title} for ${label}`} type="number" min={key === "cost" ? 0 : -1e12} max={key === "cost" ? 1_000_000_000 : 1e12} step={key === "cost" ? 1 : "any"} placeholder="Unknown" value={input[key]} onChange={event => amend(project.id, { [key]: event.target.value })} /></label>)}</div>
        <label className="block space-y-2">Human rationale and uncertainties<Textarea aria-label={`Initiative rationale for ${label}`} required minLength={10} maxLength={2000} value={input.rationale} onChange={event => amend(project.id, { rationale: event.target.value })} /></label>
        <label className="block space-y-2">Explicit initiative preference<select aria-label={`Initiative preference for ${label}`} className={selectStyle} value={input.preference} onChange={event => amend(project.id, { preference: event.target.value as Declaration["preference"] })}><option value="eligible">Consider for start or continuation</option><option value="investigate">Investigate first</option><option value="stop">Propose stopping</option></select></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={input.mandatory} onChange={event => amend(project.id, { mandatory: event.target.checked })} />Mandatory company commitment</label><label className="flex items-start gap-2"><input type="checkbox" checked={input.protected} onChange={event => amend(project.id, { protected: event.target.checked })} />Protected commitment: withhold pause or stop recommendations</label>
      </fieldset>; })}
      <label className="block space-y-2">Company priority ordering<select aria-label="Initiative company priority ordering" className={selectStyle} value={order} onChange={event => policyChange(() => setOrder(event.target.value))}><option value="">No dimension ordering declared</option><option value="strategic_alignment">Higher strategic alignment first</option><option value="declared_value">Higher declared business value first</option><option value="declared_risk">Lower declared risk first</option></select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-2">Minimum strategic alignment<Input aria-label="Minimum initiative strategic alignment" type="number" min={-1e12} max={1e12} step="any" placeholder="No minimum declared" value={minimum} onChange={event => policyChange(() => setMinimum(event.target.value))} /></label><label className="block space-y-2">Maximum active projects within this selection<Input aria-label="Maximum selected active initiatives" type="number" min={1} max={20} required value={maximum} onChange={event => policyChange(() => setMaximum(event.target.value))} /></label></div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={requireGoal} onChange={event => policyChange(() => setRequireGoal(event.target.checked))} />Require a current planned or active native Goal association</label><label className="flex items-start gap-2"><input type="checkbox" checked={mandatoryFirst} onChange={event => policyChange(() => setMandatoryFirst(event.target.checked))} />Consider mandatory commitments first</label>
      <Button type="submit">Inspect initiative priorities</Button>
    </fieldset></form>{error && <p role="alert">{error}</p>}{inspect.isPending && <p role="status">Inspecting current native initiative Sources and constraints…</p>}
    {current && <InitiativePlanningResult response={current.response} profile={current.profile} projectLabels={projectLabels} taskLabels={taskLabels} />}
    {current && current.response.result.candidates.some(candidate => candidate.disposition !== "investigate") && <div className="space-y-3"><label className="block space-y-2">Reason for the initiative proposal<Textarea aria-label="Initiative proposal reason" minLength={20} maxLength={4000} disabled={propose.isPending} value={reason} onChange={event => setReason(event.target.value)} /></label><Button disabled={propose.isPending || reason.trim().length < 20 || reason.trim().length > 4000} onClick={() => propose.mutate()}>Create initiative proposal</Button></div>}
  </section>;
}


export function InitiativePlanningResult({ response, profile, projectLabels, taskLabels, isCurrent = true }: { response: Pick<Preview, "result" | "currentSources" | "capturedAt">; profile: PortfolioPlanningProfile; projectLabels: Record<string, string>; taskLabels: Record<string, string>; isCurrent?: boolean }) {
  const current = { response, profile };
  return <div aria-label="Advisory initiative priority result" className="space-y-4"><p>{isCurrent ? "Inspected initiative recommendations." : "Retained initiative calculation: current Sources require reinspection."}</p><p>Captured {current.response.capturedAt}. These recommendations require a separate Human initiative review before any project change.</p><details className="space-y-3"><summary>Declared initiative assumptions</summary><p>Maximum active projects within the selection: {profile.initiativePolicy.maxSelectedActiveProjects}. {profile.initiativePolicy.requireActiveGoal ? "Current planned or active Goal association required." : "No active Goal constraint declared."}</p><p>{profile.initiativePolicy.mandatoryCommitmentsFirst ? "Mandatory commitments considered first." : "No mandatory-first ordering declared."} Priority ordering: {profile.initiativePolicy.orderBy.length ? profile.initiativePolicy.orderBy.map(item => `${item.key.replaceAll("_", " ")} (${item.direction})`).join("; ") : "None declared"}. Minimum dimensions: {profile.initiativePolicy.minimumDimensions.map(item => `${item.key.replaceAll("_", " ")}: ${item.minimum}`).join("; ") || "None declared"}.</p><ul className="space-y-3">{profile.initiatives.map(item => <li key={item.projectId} className="space-y-2 break-words"><p className="font-medium">{projectLabels[item.projectId] ?? item.projectId}</p><p>{item.rationale}</p><p>{Object.entries(item.dimensions).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value ?? "Unknown"}`).join("; ")}</p><p>Estimated billed runtime cost: {item.estimatedBilledCostCents === null ? "Unknown" : `${item.estimatedBilledCostCents} cents`}. Preference: {item.preference}. Mandatory: {item.mandatoryCommitment ? "Yes" : "No"}. Protected: {item.protectedCommitment ? "Yes" : "No"}.</p></li>)}</ul></details><ul className="space-y-3">{current.response.result.candidates.map(candidate => <li className="break-words rounded-md border border-border p-3" key={candidate.projectId}><p className="font-medium">{projectLabels[candidate.projectId] ?? candidate.projectId} · {candidate.disposition}</p><p>{candidate.reasons.map(reason => reasons[reason] ?? reason.replaceAll("_", " ")).join(" ")}</p></li>)}</ul>{current.response.currentSources.budgets.length ? <ul className="list-disc space-y-2 pl-5">{current.response.currentSources.budgets.map(bound => <li key={bound.policyId}>{bound.projectId ? projectLabels[bound.projectId] : "Company"} · {bound.windowKind.replaceAll("_", " ")} billed runtime remaining: {bound.remainingCents === null ? "Unknown" : `${bound.remainingCents} cents`}</li>)}</ul> : <p>No positive active native hard budget bound is configured for this selection. This grants no permission to spend.</p>}{current.response.result.schedule && <ProjectPlanningResult current={isCurrent} result={current.response.result.schedule} horizonStart={current.profile.horizon.start} taskLabels={taskLabels} />}<ul className="list-disc space-y-2 pl-5">{current.response.result.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul></div>;
}
