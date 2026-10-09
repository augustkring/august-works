import type { BusinessMetricDefinition, BusinessMetricResult } from "@paperclipai/shared";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatNumber } from "@/lib/utils";
/** The same semantic observation surface is used in the operator page and
 * visual QA. A null value never renders as zero or a success status. */
export function BusinessMetricObservation({ result, definition }: { result: BusinessMetricResult; definition: BusinessMetricDefinition }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const remaining = Date.parse(result.expiresAt) - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [result.expiresAt, now]);
  const expired = Math.max(now, Date.now()) >= Date.parse(result.expiresAt);
  return <section className="space-y-4" aria-label="Metric observation">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{definition.name}</h2><Badge variant="outline">{expired ? "Expired observation" : result.status === "undefined" ? "Undefined" : result.status === "observed" ? "Observed" : "Unavailable"}</Badge></div>
    {expired && <p role="status">This historical observation has expired. Observe the population again before using it as current evidence.</p>}
    <p className="text-2xl font-mono">{result.value === null ? "Unknown" : formatNumber(result.value)} <span className="text-sm">{definition.unit}</span></p>
    {result.reason && <p>{result.reason === "empty_denominator" ? "No objects meet the denominator definition in this window. A ratio cannot be calculated." : result.reason.replaceAll("_", " ")}</p>}
    <dl className="grid gap-2 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Population</dt><dd>{definition.populationDescription}</dd></div>
      <div><dt className="text-muted-foreground">Authority</dt><dd>{definition.authorityMode.replaceAll("_", " ")}</dd></div>
      <div><dt className="text-muted-foreground">Window</dt><dd className="font-mono">{result.from} ≤ created time &lt; {result.until}</dd></div>
      <div><dt className="text-muted-foreground">Observed at</dt><dd className="font-mono">{formatDateTime(result.asOf)}</dd></div>
      <div><dt className="text-muted-foreground">Fresh until</dt><dd className="font-mono">{formatDateTime(result.expiresAt)}</dd></div>
      <div><dt className="text-muted-foreground">Source watermark</dt><dd className="font-mono break-all">{result.sourceWatermark === "empty_population" ? "Empty population" : result.sourceWatermark}</dd></div>
    </dl>
    <p className="text-muted-foreground">{definition.timeSemantics === "created_in_window_current_state" ? "Status reflects the current state at observation time. This result does not reconstruct past task or project status." : "Time semantics are defined by the external authority."}</p>
    {result.groups.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left font-medium">Population breakdown</caption><thead><tr className="text-left"><th scope="col" className="p-2">Group</th><th scope="col" className="p-2">Value</th><th scope="col" className="p-2">Numerator</th><th scope="col" className="p-2">Denominator</th></tr></thead><tbody>{result.groups.map((group, index) => <tr key={index}><th scope="row" className="p-2 text-left font-normal">{Object.entries(group.dimensions).map(([key, value]) => `${key}: ${value ?? "Unassigned"}`).join(" · ")}</th><td className="p-2 font-mono">{group.value === null ? "Unknown" : formatNumber(group.value)}</td><td className="p-2 font-mono">{group.numerator === undefined ? "—" : formatNumber(group.numerator)}</td><td className="p-2 font-mono">{group.denominator === undefined ? "—" : formatNumber(group.denominator)}</td></tr>)}</tbody></table></div>}
    <details className="space-y-2"><summary className="cursor-pointer">Inspect definition and source references</summary><dl className="space-y-2 font-mono text-sm break-all"><div><dt>Definition version</dt><dd>{result.versionId}</dd></div><div><dt>Definition hash</dt><dd>{result.definitionHash}</dd></div><div><dt>Input hash</dt><dd>{result.inputHash}</dd></div><div><dt>Lineage manifest</dt><dd>{result.lineageManifestId}</dd></div></dl></details>
  </section>;
}
