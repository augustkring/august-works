import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { automationArtifactGateReportSchema, matchesBusinessScenarioArtifactSchema, type BusinessScenarioDefinition } from "@paperclipai/shared";
import { automationArtifactsApi } from "@/api/automationArtifacts";
import { Button } from "@/components/ui/button";
type Ref = BusinessScenarioDefinition["calculationRef"];
/** Human chooses an already active canonical artifact; this control cannot
 * create code, mark gates passed, or supply analytical output facts. */
export function BusinessScenarioArtifactPicker({ companyId, userId, definition, onChange, onValidityChange }: {
  companyId: string; userId: string | null; definition: BusinessScenarioDefinition;
  onChange: (ref: Ref) => void; onValidityChange: (valid: boolean) => void;
}) {
  const ref = definition.calculationRef, key = ["scenario-definition-sources", companyId, userId, "artifact"];
  const list = useQuery({ queryKey: [...key, "list"], queryFn: () => automationArtifactsApi.list(companyId, userId), refetchInterval: 30000 });
  const detail = useQuery({ queryKey: [...key, ref?.artifactId], queryFn: () => automationArtifactsApi.get(companyId, ref!.artifactId, userId), enabled: !!ref, refetchInterval: 30000 });
  const pending = list.isFetching || list.isError || list.isPending || !!ref && (detail.isFetching || detail.isError || detail.isPending);
  const artifact = !pending ? detail.data?.artifact : undefined, version = !pending ? detail.data?.latestVersion : undefined;
  const gates = version ? [version.validationReport, version.securityReport].map(value => automationArtifactGateReportSchema.safeParse(value)) : [];
  const valid = !!ref && !!artifact && !!version && artifact.companyId === companyId && artifact.id === ref.artifactId
    && !artifact.archivedAt && artifact.status === "active" && artifact.latestVersionId === version.id && version.id === ref.versionId
    && version.companyId === companyId && version.artifactId === artifact.id && version.contentHash === ref.contentHash
    && artifact.sideEffectClass === "pure" && ["C0", "C1"].includes(artifact.riskClass) && ["expression", "transform", "typescript"].includes(artifact.kind)
    && !artifact.createdByOptimizerSuggestionId && gates.length === 2 && gates.every((gate, index) => gate.success && gate.data.kind === (index ? "security" : "validation") && gate.data.status === "passed" && gate.data.contentHash === version.contentHash)
    && matchesBusinessScenarioArtifactSchema(version.inputSchema, Object.fromEntries([...definition.inputs, ...definition.assumptions].map(item => [item.key, item.unit])))
    && matchesBusinessScenarioArtifactSchema(version.outputSchema, Object.fromEntries(definition.outputs.map(item => [item.key, item.unit])));
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);
  return <section aria-label="Validated scenario calculation artifact" className="min-w-0 space-y-3">
    <label className="block space-y-2">Calculation artifact<select aria-label="Validated calculation artifact" className="w-full min-w-0 rounded-md border border-input bg-background p-2" value={ref?.artifactId ?? ""} onChange={event => {
      const item = list.data?.find(value => value.id === event.target.value);
      onValidityChange(false);
      // Selection initially carries an unqualified placeholder hash. Explicit
      // current-version review below supplies the canonical native hash.
      onChange(item?.latestVersionId ? { artifactId: item.id, versionId: item.latestVersionId, contentHash: "0".repeat(64) } : undefined);
    }}><option value="">Choose an existing active pure artifact</option>{!list.isFetching && !list.isError && list.data?.filter(item => item.companyId === companyId && item.status === "active" && !item.archivedAt && !item.createdByOptimizerSuggestionId && item.sideEffectClass === "pure" && ["C0", "C1"].includes(item.riskClass) && ["expression", "transform", "typescript"].includes(item.kind)).map(item => <option key={item.id} value={item.id}>{item.name} · {item.kind}</option>)}</select></label>
    {pending && <p role="status">Rechecking artifact authority and exact unit contracts…</p>}
    {artifact && version && <div className="space-y-2"><p>{artifact.name} · version {version.versionNumber} · {artifact.status}</p><p className="break-all text-sm">Content {version.contentHash}</p>{ref?.versionId !== version.id || ref.contentHash !== version.contentHash ? <Button type="button" variant="outline" onClick={() => onChange({ artifactId: artifact.id, versionId: version.id, contentHash: version.contentHash })}>Use this reviewed artifact version</Button> : null}</div>}
    {!pending && !valid && <p role="status">Review the exact active version, passed validation/security gates, numeric input/output names and their declared units before saving.</p>}
    <p className="text-sm text-muted-foreground">The artifact's declared units must match every source, assumption and output. Validation does not establish business calibration. Generated code also requires the existing enabled sandbox at run time.</p>
  </section>;
}
