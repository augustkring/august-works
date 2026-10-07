import { useState } from "react";
import { NATIVE_PROCESS_STATES, type ProcessConformanceExpectation } from "@paperclipai/shared";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

type State=ProcessConformanceExpectation["initialStates"][number];
export function ProcessConformanceEditor({model,onChange}:{model:ProcessConformanceExpectation;onChange:(model:ProcessConformanceExpectation)=>void}) {
  const states=NATIVE_PROCESS_STATES[model.objectType],perspective=model.objectType==="issue" ? "Tasks" : "Projects";
  const [from,setFrom]=useState<State>(states[0]),[to,setTo]=useState<State>(states[1]);
  const exists=model.allowedTransitions.some(edge=>edge.from===from && edge.to===to);
  return <fieldset className="space-y-4 rounded-md border border-border p-4">
    <legend className="px-1 font-medium">{perspective} · explicit conformance expectation</legend>
    <p className="text-sm text-muted-foreground">Choose expected starts, permitted completion or cancellation states, required visits and allowed transitions. This proposal becomes the comparison model only after human publication.</p>
    {(["initialStates","terminalStates","requiredStates"] as const).map(field=><fieldset key={field} className="space-y-2">
      <legend className="font-medium">{field==="initialStates" ? "Expected initial states" : field==="terminalStates" ? "Expected terminal states" : "Required states to visit"}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-3">{states.filter(status=>field!=="terminalStates" || ["done","completed","cancelled"].includes(status)).map(status=><label key={status} className="flex items-center gap-2">
        <Checkbox aria-label={`${perspective} ${field==="initialStates" ? "expected start" : field==="terminalStates" ? "expected terminal" : "required visit"} ${status.replaceAll("_"," ")}`} checked={model[field].includes(status)} onCheckedChange={checked=>onChange({...model,[field]:checked===true ? [...model[field],status] : model[field].filter(value=>value!==status)})} />
        <span>{status.replaceAll("_"," ")}</span>
      </label>)}</div>
    </fieldset>)}
    <fieldset className="space-y-3"><legend className="font-medium">Allowed state transitions</legend>
      <div className="grid gap-3 sm:grid-cols-3">{(["from","to"] as const).map(field=><label key={field} className="min-w-0 space-y-2">{field==="from" ? "From state" : "To state"}
        <select aria-label={`${perspective} transition ${field}`} className="w-full rounded-md border border-input bg-background p-2" value={field==="from" ? from : to} onChange={event=>(field==="from" ? setFrom : setTo)(event.target.value as State)}>
          {states.map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
        </select>
      </label>)}<Button type="button" className="self-end" variant="outline" disabled={from===to || exists || model.allowedTransitions.length>=100} onClick={()=>onChange({...model,allowedTransitions:[...model.allowedTransitions,{from,to}]})}>Add {perspective.toLowerCase()} transition</Button></div>
      <ul className="space-y-2">{model.allowedTransitions.map((edge,index)=><li key={`${edge.from}:${edge.to}`} className="flex flex-wrap items-center justify-between gap-2">
        <span>{edge.from.replaceAll("_"," ")} → {edge.to.replaceAll("_"," ")}</span><Button type="button" size="sm" variant="outline" aria-label={`Remove ${perspective} ${edge.from} to ${edge.to}`} onClick={()=>onChange({...model,allowedTransitions:model.allowedTransitions.filter((_,i)=>i!==index)})}>Remove</Button>
      </li>)}</ul>
    </fieldset>
  </fieldset>;
}
