import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memoryApi } from "@/api/memory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "@/lib/router";

export function MemoryMaintenanceControls({ companyId }: { companyId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [operation, setOperation] = useState<"dedupe" | "compaction" | "reflection" | "index_refresh">("dedupe");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonContent, setLessonContent] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const access = useQuery({ queryKey: ["memory-retention", companyId], queryFn: () => memoryApi.retentionPolicy(companyId) });
  const jobs = useQuery({ queryKey: ["memory-jobs", companyId], queryFn: () => memoryApi.jobs(companyId), enabled: open && access.data?.canManage === true, refetchInterval: open ? 3_000 : false });
  const records = useQuery({ queryKey: ["memory-maintenance-records", companyId], queryFn: () => memoryApi.listRecords(companyId, { reviewState: "accepted", limit: 100 }), enabled: open && access.data?.canManage === true });
  const enqueue = useMutation({ mutationFn: () => memoryApi.enqueueMaintenance(companyId, { operationType: operation, recordIds: selected, ...(operation === "reflection" ? { proposedLesson: { title: lessonTitle, content: lessonContent } } : {}) }, requestKey),
    onSuccess: () => { setRequestKey(crypto.randomUUID()); void client.invalidateQueries({ queryKey: ["memory-jobs", companyId] }); } });
  if (!access.data?.canManage) return null;
  const error = jobs.error ?? records.error ?? enqueue.error;
  return <details className="rounded-lg border border-border p-3" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Memory maintenance</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Choose accepted shared records. Dedupe preserves one identical claim and its evidence. Compaction creates a pending candidate from reviewed summaries. PostgreSQL maintains search entries on every write; index refresh checks the index and updates statistics.</p>
      <label className="block space-y-1 text-xs">Operation<select value={operation} disabled={enqueue.isPending}
        className="w-full rounded-md border border-input bg-background p-2" onChange={(event) => { setOperation(event.target.value as typeof operation); setRequestKey(crypto.randomUUID()); }}>
        <option value="dedupe">Consolidate exact duplicates</option><option value="compaction">Propose compact summaries</option><option value="reflection">Propose a lesson for review</option><option value="index_refresh">Refresh native search index</option>
      </select></label>
      {operation === "reflection" && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Describe the lesson supported by the selected records. The worker creates a pending candidate for separate human review.</p>
        <label className="block space-y-1 text-xs">Proposed lesson title<input value={lessonTitle} maxLength={180} disabled={enqueue.isPending} className="w-full rounded-md border border-input bg-background p-2" onChange={(event) => { setLessonTitle(event.target.value); setRequestKey(crypto.randomUUID()); }} /></label>
        <label className="block space-y-1 text-xs">Proposed lesson<textarea value={lessonContent} maxLength={16_000} rows={4} disabled={enqueue.isPending} className="w-full rounded-md border border-input bg-background p-2" onChange={(event) => { setLessonContent(event.target.value); setRequestKey(crypto.randomUUID()); }} /></label>
      </div>}
      <fieldset className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3"><legend className="px-1 text-xs">Source records ({selected.length}/64)</legend>
        {records.isLoading ? <p role="status" className="text-xs">Loading accepted records…</p> : records.data?.filter((item) => item.retentionState === "active" && !item.revokedAt && !item.supersededByRecordId).map((record) => <label key={record.id} className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={selected.includes(record.id)} disabled={enqueue.isPending || (!selected.includes(record.id) && selected.length >= 64)}
            onChange={(event) => { setSelected((current) => event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id)); setRequestKey(crypto.randomUUID()); }} />
          <span>{record.title ?? record.summary ?? record.content.slice(0, 120)}</span>
        </label>)}
      </fieldset>
      {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
      {enqueue.data && <p role="status" className="text-xs">Maintenance queued. Results appear below when the worker finishes.</p>}
      <div className="flex justify-end"><Button size="sm" disabled={enqueue.isPending || !selected.length || (["compaction", "reflection"].includes(operation) && selected.length < 2) || (operation === "reflection" && (!lessonTitle.trim() || !lessonContent.trim()))} onClick={() => enqueue.mutate()}>{enqueue.isPending ? "Queuing…" : "Queue maintenance"}</Button></div>
      <ul className="space-y-2">{jobs.data?.map((job) => <li key={job.id} className="space-y-1 border-t border-border pt-2 text-xs">
        <div className="flex items-center justify-between gap-2"><span>{job.operationType.replaceAll("_", " ")} · attempt {job.attemptNumber}</span><Badge variant="outline">{job.status}</Badge></div>
        {job.errorCode && <p className="text-destructive">{job.errorCode.replaceAll("_", " ")}</p>}
        {job.result && <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(job.result, null, 2)}</pre>}
        {typeof job.result?.proposedRecordId === "string" && <Button size="sm" variant="outline" onClick={() => navigate(`/memory/${job.result!.proposedRecordId}`)}>Review compact candidate</Button>}
      </li>)}</ul>
    </div>
  </details>;
}
