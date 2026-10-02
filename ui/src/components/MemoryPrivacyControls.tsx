import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memoryApi } from "@/api/memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function MemoryPrivacyControls({ companyId, recordId, onDeleted }: {
  companyId: string; recordId?: string; onDeleted?: () => void;
}) {
  const client = useQueryClient();
  const [forgetOpen, setForgetOpen] = useState(false);
  const [days, setDays] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const policy = useQuery({ queryKey: ["memory", companyId, "retention-policy"],
    queryFn: () => memoryApi.retentionPolicy(companyId) });
  const action = useMutation({
    mutationFn: async (kind: "export" | "forget" | "retention") => {
      if (kind === "export") {
        const data = await memoryApi.exportMemory(companyId);
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url; link.download = "memory-export.json"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return kind;
      }
      if (kind === "forget") {
        if (!recordId) throw new Error("Select a memory record first.");
        await memoryApi.forget(companyId, recordId);
        return kind;
      }
      const raw = days ?? (policy.data?.maxAgeDays?.toString() ?? "");
      const value = raw.trim() ? Number(raw) : null;
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 3650)) throw new Error("Choose a maximum age between 1 and 3650 days.");
      await memoryApi.setRetentionPolicy(companyId, value);
      return kind;
    },
    onSuccess: async (kind) => {
      // Navigate before refetching the erased detail: its 404 unmounts this control.
      if (kind === "forget") { setForgetOpen(false); onDeleted?.(); }
      await client.invalidateQueries({ queryKey: ["memory", companyId] });
      setNotice(kind === "export" ? "Shared memory export downloaded." : kind === "forget" ? "Memory content and its derived records were deleted." : "Retention policy saved.");
    },
  });
  const error = action.error ?? policy.error;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate("export")}>Export shared memory</Button>
      {recordId ? <Button variant="outline" disabled={action.isPending} onClick={() => setForgetOpen(true)}>Forget permanently</Button> : null}
    </div>
    {!recordId && policy.data?.canManage ? <details>
      <summary className="cursor-pointer text-sm font-medium">Retention policy</summary>
      <div className="space-y-3 pt-3">
        <label className="block space-y-1 text-sm">Maximum age in days
          <Input type="number" min={1} max={3650} value={days ?? policy.data.maxAgeDays?.toString() ?? ""}
            disabled={action.isPending} onChange={(event) => setDays(event.target.value)} /></label>
        <p className="text-xs text-muted-foreground">This policy also applies to existing shared and private memory. Scheduled maintenance permanently deletes expired content. Leave blank to use individual expiry dates.</p>
        <Button disabled={action.isPending} onClick={() => action.mutate("retention")}>Apply retention policy</Button>
      </div>
    </details> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "Privacy operation failed."}</p> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    <Dialog open={forgetOpen} onOpenChange={setForgetOpen}>
      <DialogContent><DialogHeader><DialogTitle>Forget memory permanently</DialogTitle>
        <DialogDescription>This deletes the content, citations and derived correction or sharing records. It cannot be undone. A content-free deletion marker prevents old operations from restoring it.</DialogDescription>
      </DialogHeader><DialogFooter><Button variant="outline" disabled={action.isPending} onClick={() => setForgetOpen(false)}>Cancel</Button>
        <Button variant="destructive" disabled={action.isPending} onClick={() => action.mutate("forget")}>Delete content permanently</Button>
      </DialogFooter></DialogContent>
    </Dialog>
  </div>;
}
