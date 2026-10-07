import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ManagementReviewSource } from "@paperclipai/shared";
import { decisionsApi } from "@/api/decisions";
import { decisionOutcomeReviewsApi } from "@/api/decision-outcome-reviews";
import { learningApi } from "@/api/learning";
import { StrategySourcePicker } from "./StrategySourcePicker";
import { DecisionEvidencePicker } from "./DecisionEvidencePicker";
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
function ReviewRootPicker({ companyId, userId, name, kind, value, onChange, onValidity, onAuthorityLost }: Props & { kind: "learning_cycle" | "decision_outcome" }) {
  const [decisionId, setDecisionId] = useState(value?.kind === "decision_outcome" ? value.decisionId : ""), key = ["management-definition-sources", companyId, userId];
  const decisions = useQuery({ queryKey: [...key, "decisions"], queryFn: () => decisionsApi.list(companyId, { limit: 50 }), enabled: kind === "decision_outcome", retry: false, refetchInterval: 30000 });
  const outcome = useQuery({ queryKey: [...key, "outcome", decisionId], queryFn: () => decisionOutcomeReviewsApi.detail(companyId, decisionId, userId ?? undefined), enabled: kind === "decision_outcome" && !!decisionId, retry: false, refetchInterval: 30000 });
  const cycles = useQuery({ queryKey: [...key, "learning"], queryFn: () => learningApi.list(companyId), enabled: kind === "learning_cycle", retry: false, refetchInterval: 30000 });
  const queries = kind === "learning_cycle" ? [cycles] : [decisions, ...(decisionId ? [outcome] : [])], unavailable = queries.some(query => query.isFetching || query.isPending || query.isError), error = queries.find(query => query.isError)?.error;
  const options: Array<{ source: ManagementReviewSource; label: string }> = [];
  if (!unavailable && kind === "learning_cycle") for (const cycle of cycles.data ?? []) if (cycle.companyId === companyId && !["invalidated", "cancelled"].includes(cycle.status)) options.push({ source: { kind, id: cycle.id, expectedVersion: cycle.version }, label: `${cycle.trigger} · ${cycle.status} · version ${cycle.version}` });
  const review = outcome.data;
  if (!unavailable && kind === "decision_outcome" && review?.companyId === companyId && review.decisionId === decisionId) options.push({ source: { kind, decisionId, reviewId: review.id, revision: review.revision }, label: `${review.status} · revision ${review.revision} · due ${review.reviewDueAt}` });
  const valid = !unavailable && !!value && options.some(option => JSON.stringify(option.source) === JSON.stringify(value));
  useEffect(() => { onValidity(valid); }, [valid, onValidity]);
  useEffect(() => { if (error) onAuthorityLost(); }, [error, onAuthorityLost]);
  return <div className="min-w-0 space-y-3">{kind === "decision_outcome" && <label className="block space-y-2">Decision<select className={selectStyle} aria-label={`${name} decision`} value={decisionId} onChange={event => { setDecisionId(event.target.value); onChange(null); }}><option value="">Choose an authorized decision</option>{!unavailable && decisions.data?.filter(decision => decision.companyId === companyId && decision.status === "decided").map(decision => <option key={decision.id} value={decision.id}>{decision.title}</option>)}</select></label>}
    <label className="block space-y-2">{kind === "learning_cycle" ? "Verified-task Learning cycle" : "Native outcome review"}<select className={selectStyle} aria-label={`${name} retained source`} value={value ? JSON.stringify(value) : ""} onChange={event => onChange(options.find(option => JSON.stringify(option.source) === event.target.value)?.source ?? null)}><option value="">Choose an exact native source</option>{options.map(option => <option key={JSON.stringify(option.source)} value={JSON.stringify(option.source)}>{option.label}</option>)}</select></label>
    {unavailable && <p role="status">Rechecking native source authority…</p>}<p className="text-sm text-muted-foreground">Selected native roots are rechecked before capture. Analytical findings do not qualify as verified tasks.</p>
  </div>;
}
type Props = { companyId: string; userId: string | null; name: string; value: ManagementReviewSource | null; onChange: (value: ManagementReviewSource | null) => void; onValidity: (valid: boolean) => void; onAuthorityLost: () => void };
export function ManagementReviewSourcePicker(props: Props) {
  const [kind, setKind] = useState<ManagementReviewSource["kind"]>(props.value?.kind ?? "canonical");
  return <fieldset className="min-w-0 space-y-3"><legend className="font-medium">{props.name}</legend><label className="block space-y-2">Source domain<select className={selectStyle} aria-label={`${props.name} domain`} value={kind} onChange={event => { setKind(event.target.value as typeof kind); props.onChange(null); props.onValidity(false); }}><option value="canonical">Canonical strategy and operational state</option><option value="analytical">Governed analytical evidence</option><option value="decision_outcome">Decision outcome review</option><option value="learning_cycle">Verified-task Learning</option></select></label>
    {kind === "canonical" ? <StrategySourcePicker companyId={props.companyId} userId={props.userId} name={`${props.name} canonical`} value={props.value?.kind === kind ? props.value.reference : null} onChange={reference => props.onChange(reference ? { kind, reference } : null)} onValidity={props.onValidity} onAuthorityLost={props.onAuthorityLost} /> : kind === "analytical" ? <DecisionEvidencePicker companyId={props.companyId} userId={props.userId} legend={`${props.name} analytical`} value={props.value?.kind === kind ? props.value.reference : null} onChange={reference => props.onChange(reference ? { kind, reference } : null)} onValidity={props.onValidity} onAuthorityLost={props.onAuthorityLost} /> : <ReviewRootPicker key={kind} {...props} kind={kind} />}
  </fieldset>;
}
