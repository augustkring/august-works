import { z } from "zod";
import { ISSUE_STATUSES, PROJECT_STATUSES } from "./constants.js";

export const NATIVE_PROCESS_STATES = { issue: ISSUE_STATUSES, project: PROJECT_STATUSES } as const;
const state = z.enum([...ISSUE_STATUSES, ...PROJECT_STATUSES]);
const states = z.array(state).max(12);
function reachable(start: string[], edges: { from: string; to: string }[], reverse = false) {
  const visited = new Set(start), pending = [...start];
  for (let i = 0; i < pending.length; i++) for (const edge of edges) {
    const from = reverse ? edge.to : edge.from, to = reverse ? edge.from : edge.to;
    if (from === pending[i] && !visited.has(to)) { visited.add(to); pending.push(to); }
  }
  return visited;
}
function canVisitRequired(start:string,model:{requiredStates:string[];terminalStates:string[];allowedTransitions:{from:string;to:string}[]}) {
  const bit=(status:string)=>{const index=model.requiredStates.indexOf(status);return index<0 ? 0 : 1<<index;};
  const full=(1<<model.requiredStates.length)-1,pending=[{status:start,mask:bit(start)}],seen=new Set<string>();
  for(let i=0;i<pending.length;i++) {
    const {status,mask}=pending[i],key=`${status}:${mask}`;
    if(seen.has(key)) continue;seen.add(key);
    if(mask===full && model.terminalStates.includes(status)) return true;
    for(const edge of model.allowedTransitions) if(edge.from===status) pending.push({status:edge.to,mask:mask|bit(edge.to)});
  }
  return false;
}
export const processConformanceExpectationSchema = z.object({
  objectType: z.enum(["issue", "project"]), initialStates: states.min(1), terminalStates: states.min(1), requiredStates: states,
  allowedTransitions: z.array(z.object({ from: state, to: state }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  const allowed = new Set<string>(NATIVE_PROCESS_STATES[value.objectType]);
  const mentioned = [...value.initialStates, ...value.terminalStates, ...value.requiredStates, ...value.allowedTransitions.flatMap(edge => [edge.from, edge.to])];
  if (mentioned.some(status => !allowed.has(status))) ctx.addIssue({ code: "custom", message: "Model states must belong to the native object type" });
  const terminal = new Set(value.objectType === "issue" ? ["done", "cancelled"] : ["completed", "cancelled"]);
  if (value.terminalStates.some(status => !terminal.has(status))) ctx.addIssue({ code: "custom", message: "Expected terminal states must be native completion or cancellation states" });
  if ([value.initialStates, value.terminalStates, value.requiredStates].some(items => new Set(items).size !== items.length)
    || new Set(value.allowedTransitions.map(edge => JSON.stringify(edge))).size !== value.allowedTransitions.length)
    ctx.addIssue({ code: "custom", message: "Typed expectations cannot repeat states or edges" });
  if (value.allowedTransitions.some(edge => edge.from === edge.to)) ctx.addIssue({ code: "custom", message: "Metadata and repeated status observations are not state transitions" });
  const forward = reachable(value.initialStates, value.allowedTransitions), backward = reachable(value.terminalStates, value.allowedTransitions, true);
  if (value.initialStates.some(status => !backward.has(status)) || value.terminalStates.some(status => !forward.has(status))
    || value.requiredStates.some(status => !forward.has(status) || !backward.has(status)) || value.initialStates.some(status=>!canVisitRequired(status,value)))
    ctx.addIssue({ code: "custom", message: "Expected starts, terminals and required states need an explicit reachable status path" });
});
export const processConformanceSchema = z.object({
  kind: z.literal("explicit_definition"), expectations: z.array(processConformanceExpectationSchema).min(1).max(2),
}).strict();
export type ProcessConformanceExpectation = z.infer<typeof processConformanceExpectationSchema>;
export const PROCESS_CONFORMANCE_VIOLATIONS = ["initial_state_not_expected", "terminal_state_not_expected", "transition_not_expected", "required_state_missing"] as const;
export interface NativeProcessConformanceSummary {
  target: "explicit_published_process_definition"; targetVersionId: string; modelHash: string;
  evaluatedObjectCount: number; conformingObjectCount: number; deviatingObjectCount: number;
  violationCounts: Record<typeof PROCESS_CONFORMANCE_VIOLATIONS[number], number>;
  coverage: "qualified_primary_object_lifecycle_in_observed_window";
}
