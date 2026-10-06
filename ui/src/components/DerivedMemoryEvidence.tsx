import { useV7AccountScope } from "@/context/V7AccountScope";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Link } from "@/lib/router";
export function DerivedMemoryEvidence({ companyId, kind, id }: { companyId: string; kind: "observations" | "models"; id: string }) {
  const { principalId, derivedMemoryApi } = useV7AccountScope();
  const [expanded, setExpanded] = useState(false);
  const detail = useQuery({ queryKey: ["derived-evidence", companyId, principalId, kind, id], queryFn: async () => kind === "models" ? derivedMemoryApi.model(companyId, id) : derivedMemoryApi.observation(companyId, id), enabled: expanded });
  return <div className="space-y-2"><Button variant="outline" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Hide evidence" : "Inspect supporting evidence"}</Button>
    {expanded ? detail.isPending ? <p role="status">Loading current evidence…</p> : detail.isError ? <p role="alert">{detail.error instanceof Error ? detail.error.message : "Evidence is unavailable"}</p> : <ul className="space-y-2">{detail.data?.evidence.map((source, index) => <li key={index}><Link to={`/memory/${source.memoryRecordId}`}>Memory {source.memoryRecordId}</Link><p className="text-sm text-muted-foreground">Source version: {source.sourceVersion}{"relationship" in source ? ` · ${source.relationship}` : ""}</p></li>)}</ul> : null}
  </div>;
}
