import {useEffect,useState} from "react";
import type {BusinessForecastArtifactView} from "@paperclipai/shared";
import {Badge} from "@/components/ui/badge";
import {formatNumber} from "@/lib/utils";
const date=(value:string)=>`${new Date(value).toLocaleString(undefined,{timeZone:"UTC"})} UTC`;
const number=(value:number|null)=>value===null?"Unavailable":formatNumber(value);
export function BusinessForecastResult({artifact}:{artifact:BusinessForecastArtifactView}) {
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
 if(Date.parse(artifact.expiresAt)<=Math.max(now,Date.now())) return <p role="status">This forecast evidence has expired. Recheck retained observations before using it.</p>;
 const result=artifact.result;
 return <section aria-label={artifact.kind==="backtest"?"Native forecast backtest":"Native business forecast"} className="min-w-0 space-y-4">
  <div className="flex flex-wrap gap-2"><h3 className="font-semibold">{artifact.kind==="backtest"?"Backtest evidence":"Forecast result"}</h3><Badge variant="outline">{artifact.currentQualification.replaceAll("_"," ")}</Badge></div>
  <p className="text-sm">Recorded calculation: {result.status.replaceAll("_"," ")} · cutoff {date(artifact.cutoff)}</p>
  {artifact.reviewReason&&<p role="status">{artifact.reviewReason}</p>}
  {result.reasons.map(reason=><p key={reason}>{reason.replaceAll("_"," ")}</p>)}
  {result.selectedReason&&<p>{result.selectedReason}</p>}
  <p className="text-sm text-muted-foreground">Prediction intervals: unavailable. {result.uncertainty.reason}</p>
  {!!result.points.length&&<div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left font-medium">Recorded point forecasts · {result.unit??"unknown unit"}</caption><thead><tr className="text-left"><th scope="col" className="p-2">Period (UTC)</th><th scope="col" className="p-2">Point estimate</th><th scope="col" className="p-2">Interval</th></tr></thead><tbody>{result.points.map(point=><tr key={point.from}><th scope="row" className="p-2 text-left font-normal">{point.from.slice(0,10)} to {point.until.slice(0,10)}</th><td className="p-2 font-mono">{number(point.value)}</td><td className="p-2">Unavailable</td></tr>)}</tbody></table></div>}
  {!!result.comparisons.length&&<div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left font-medium">Time-safe rolling-origin comparisons</caption><thead><tr className="text-left">{["Model","MAE","Bias","WAPE","MASE"].map(label=><th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{result.comparisons.map((item,index)=><tr key={index}><th scope="row" className="p-2 text-left font-normal">{item.model.kind.replaceAll("_"," ")}{item.model.kind==="seasonal_naive"?` · ${item.model.seasonLength} periods`:item.model.kind==="moving_average"?` · ${item.model.window} periods`:""}</th><td className="p-2 font-mono">{number(item.loss.mae)}</td><td className="p-2 font-mono">{number(item.loss.bias)}</td><td className="p-2 font-mono">{number(item.loss.wape)}</td><td className="p-2 font-mono">{number(item.loss.mase)}</td></tr>)}</tbody></table></div>}
  <p className="text-sm text-muted-foreground">Null scaled errors indicate unavailable denominators; they are not perfect scores. These forecasts inform human review and do not change a target, budget, roadmap or native Decision.</p>
  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{result.limitations.map((text,index)=><li key={index}>{text}</li>)}</ul>
  <details><summary className="cursor-pointer">Inspect forecast provenance and temporal folds</summary><div className="space-y-3 pt-3 text-sm"><p>Captured {date(artifact.createdAt)} · retained until {date(artifact.expiresAt)}</p><p className="break-all">Native definition {artifact.versionId} · {result.definitionHash}</p><p className="break-all">Input {result.inputHash} · result {artifact.contentHash}</p><p>{result.engineVersion} · {artifact.series.length} native observations</p>{result.backtests.map(fold=><div key={fold.origin}><p>Origin {fold.origin} · training available {date(fold.trainingCutoff)} · {fold.trainingObservationIds.length} training observations · {fold.gapPeriods} gap periods</p><p>{fold.testObservationIds.length} later test observations</p></div>)}</div></details>
 </section>;
}
