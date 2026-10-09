import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ManagementReviewSource, ManagementSourceOptionsQuery, StrategyExecutionReference } from "@paperclipai/shared";
import { managementReviewsApi } from "@/api/management-reviews";
import { DecisionEvidencePicker } from "./DecisionEvidencePicker";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
const labels: Record<StrategyExecutionReference["type"], string> = { foundation_section: "Approved Foundation section", goal: "Goal", project: "Project", milestone: "Milestone", issue: "Task", decision: "Decision", metric: "Published metric", metric_target: "Approved metric commitment", metric_observation: "Current metric observation" };
type Props = { companyId: string; userId: string | null; name: string; value: ManagementReviewSource | null; onChange: (value: ManagementReviewSource | null) => void; onValidity: (valid: boolean) => void; onAuthorityLost: () => void; allowedKinds?: ManagementReviewSource["kind"][]; allowedCanonicalTypes?: StrategyExecutionReference["type"][] };
function NativeRootPicker({ kind, ...props }: Props & { kind: "canonical" | "learning_cycle" | "decision_outcome" | "governance_obligation" }) {
  const initial = props.value?.kind === "canonical" ? props.value.reference : null;
  const [type, setType] = useState<StrategyExecutionReference["type"]>(initial?.type ?? "goal"), [search, setSearch] = useState(""), [parentId, setParentId] = useState(initial?.type === "milestone" ? initial.projectId : initial?.type === "metric_observation" ? initial.metricId : props.value?.kind === "decision_outcome" ? props.value.decisionId : "");
  const sourceKind: ManagementSourceOptionsQuery["kind"] = kind === "canonical" ? type : kind;
  const parentKind = sourceKind === "milestone" ? "project" : sourceKind === "metric_observation" ? "metric" : sourceKind === "decision_outcome" ? "decision" : null;
  const key = ["management-definition-sources", props.companyId, props.userId, "options"];
  const parents = useQuery({ queryKey: [...key, parentKind, "", ""], queryFn: () => managementReviewsApi.sourceOptions(props.companyId, { kind: parentKind! }, props.userId), enabled: !!parentKind, retry: false, refetchInterval: 30000 });
  const ready = (!parentKind || !!parentId) && (sourceKind !== "foundation_section" || !!search.trim());
  const options = useQuery({ queryKey: [...key, sourceKind, search, parentId], queryFn: () => managementReviewsApi.sourceOptions(props.companyId, { kind: sourceKind, q: search || undefined, parentId: parentId || undefined }, props.userId), enabled: ready, retry: false, refetchInterval: 30000 });
  const active = [...(parentKind ? [parents] : []), ...(ready ? [options] : [])], unavailable = active.some(query => query.isFetching || query.isPending || query.isError), error = active.find(query => query.isError)?.error;
  const choices = !unavailable && ready ? options.data?.items ?? [] : [], parentChoices = !unavailable ? parents.data?.items ?? [] : [];
  const encode = (source: ManagementReviewSource) => JSON.stringify(kind === "canonical" && source.kind === "canonical" ? source.reference : source), current = props.value ? encode(props.value) : "";
  const valid = !unavailable && !!props.value && choices.some(option => encode(option.source) === current);
  useEffect(() => { props.onValidity(valid); }, [valid, props.onValidity]);
  useEffect(() => { if (error) props.onAuthorityLost(); }, [error, props.onAuthorityLost]);
  const name = kind === "canonical" ? `${props.name} canonical` : props.name;
  return <fieldset className="min-w-0 space-y-3"><legend>{kind === "canonical" ? "Canonical source" : kind === "learning_cycle" ? "Verified-task Learning cycle" : kind === "governance_obligation" ? "Native human governance declaration" : "Native outcome review"}</legend>
    {kind === "canonical" && <label className="block space-y-2">Source kind<select className={selectStyle} aria-label={`${name} source kind`} value={type} onChange={event => { setType(event.target.value as typeof type); setSearch(""); setParentId(""); props.onChange(null); }}>{Object.entries(labels).filter(([value]) => !props.allowedCanonicalTypes || props.allowedCanonicalTypes.includes(value as StrategyExecutionReference["type"])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    {!parentKind && kind === "canonical" && <label className="block space-y-2">Find source<Input aria-label={`${name} find source`} maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder={type === "foundation_section" ? "Search an approved heading or passage" : "Search by name"} /></label>}
    {parentKind && <label className="block space-y-2">{labels[parentKind]}<select className={selectStyle} aria-label={sourceKind === "milestone" ? `${name} milestone project` : sourceKind === "metric_observation" ? `${name} observation metric` : `${name} decision`} value={parentId} onChange={event => { setParentId(event.target.value); props.onChange(null); }}><option value="">Choose an authorized {parentKind}</option>{parentChoices.map(option => option.source.kind === "canonical" && option.source.reference.type !== "foundation_section" ? <option key={option.source.reference.id} value={option.source.reference.id}>{option.title}</option> : null)}</select></label>}
    <label className="block space-y-2">Native source<select className={selectStyle} aria-label={kind === "canonical" ? `${name} native source` : `${name} retained source`} value={current} onChange={event => props.onChange(choices.find(option => encode(option.source) === event.target.value)?.source ?? null)}><option value="">Choose an exact native source</option>{choices.map(option => <option key={encode(option.source)} value={encode(option.source)}>{option.title}</option>)}</select></label>
    {unavailable && <p role="status">Rechecking native source authority…</p>}{error && <p role="alert">Current native source authority is unavailable.</p>}
    <Button type="button" variant="ghost" size="sm" onClick={() => active.forEach(query => void query.refetch())}>Refresh sources</Button><p className="text-sm text-muted-foreground">Showing bounded authorized choices; an empty list is not a completeness finding. Analytical findings cannot substitute for verified Task roots.</p>
  </fieldset>;
}
export function ManagementReviewSourcePicker(props: Props) {
  const [kind, setKind] = useState<ManagementReviewSource["kind"]>(props.value?.kind ?? props.allowedKinds?.[0] ?? "canonical");
  return <fieldset className="min-w-0 space-y-3"><legend className="font-medium">{props.name}</legend><label className="block space-y-2">Source domain<select className={selectStyle} aria-label={`${props.name} domain`} value={kind} onChange={event => { setKind(event.target.value as typeof kind); props.onChange(null); props.onValidity(false); }}>{(props.allowedKinds ?? ["canonical","analytical","decision_outcome","learning_cycle","governance_obligation"]).map(value=><option key={value} value={value}>{{canonical:"Canonical strategy and operational state",analytical:"Governed analytical evidence",decision_outcome:"Decision outcome review",learning_cycle:"Verified-task Learning",governance_obligation:"Governance obligation and review risk"}[value]}</option>)}</select></label>
    {kind === "analytical" ? <DecisionEvidencePicker companyId={props.companyId} userId={props.userId} legend={`${props.name} analytical`} value={props.value?.kind === kind ? props.value.reference : null} onChange={reference => props.onChange(reference ? { kind, reference } : null)} onValidity={props.onValidity} onAuthorityLost={props.onAuthorityLost} /> : <NativeRootPicker key={kind} {...props} kind={kind} />}
  </fieldset>;
}
