import { useEffect, useState } from "react";
import type { BusinessMetricTargetComparison as Comparison, BusinessMetricResult } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatNumber } from "@/lib/utils";
const labels: Record<Comparison["status"], string> = { met: "Commitment met at observation time", not_met: "Commitment not met at observation time", period_in_progress: "Period in progress", unknown: "Unknown", needs_review: "Commitment needs review" };
export function BusinessMetricTargetComparison({ comparison, observation }: { comparison: Comparison; observation: BusinessMetricResult | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const remaining = observation ? Date.parse(observation.expiresAt) - Date.now() : 0;
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [observation, now]);
  const expired = observation && Math.max(now, Date.now()) >= Date.parse(observation.expiresAt);
  return <section className="space-y-2" aria-label="Commitment comparison">
    <h3 className="font-medium">Approved commitment comparison</h3><Badge variant="outline">{expired ? "Expired comparison" : labels[comparison.status]}</Badge>
    <p className="font-mono">{comparison.value === null ? "Unknown" : typeof comparison.value === "boolean" ? String(comparison.value) : formatNumber(comparison.value)}</p>
    {comparison.reason && <p>{comparison.reason === "current_observation_is_not_a_forecast" ? "The period is open. This current observation does not predict the final result." : comparison.reason === "empty_denominator" ? "No objects meet the denominator definition. The ratio is unknown." : comparison.reason.replaceAll("_", " ")}</p>}
    <p>Observed at {formatDateTime(comparison.asOf)}.{observation && ` Fresh until ${formatDateTime(observation.expiresAt)}.`}</p>
    {expired && <p role="status">Observe and compare again before using this historical comparison as current evidence.</p>}
    <p className="text-muted-foreground">This compares the defined measurement with a human commitment. It does not establish that a Goal or Project caused the result.</p>
  </section>;
}
