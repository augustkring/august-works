import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UpdatePlaybookMetadataInput } from "@paperclipai/shared";
import type { PlaybookDetail } from "@/api/v5";
import { accessApi } from "@/api/access";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { V5Error } from "./V5Gate";

export function PlaybookMetadata({ companyId, playbook, busy, onSave }: { companyId: string; playbook: PlaybookDetail; busy: boolean; onSave: (input: UpdatePlaybookMetadataInput) => void }) {
  const [category, setCategory] = useState(playbook.category), [sensitivity, setSensitivity] = useState(playbook.sensitivity as UpdatePlaybookMetadataInput["sensitivity"]), [ownerUserId, setOwnerUserId] = useState(playbook.ownerUserId ?? ""), [ownerAgentId, setOwnerAgentId] = useState(playbook.ownerAgentId ?? ""), [frequency, setFrequency] = useState(playbook.reviewFrequencyDays), [rationale, setRationale] = useState("");
  const users = useQuery({ queryKey: ["v5-playbook-owners", companyId], queryFn: () => accessApi.listUserDirectory(companyId) });
  const agents = useQuery({ queryKey: ["v5-playbook-owner-agents", companyId], queryFn: () => agentsApi.list(companyId) });
  return <details className="space-y-3 rounded-md border p-4"><summary className="cursor-pointer font-medium">Owner, classification and review schedule</summary>
    <V5Error error={users.error ?? agents.error} />
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); onSave({ expectedUpdatedAt: playbook.updatedAt, category, sensitivity, ownerUserId: ownerUserId || null, ownerAgentId: ownerAgentId || null, reviewFrequencyDays: frequency, rationale }); }}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="block">Category</span><Input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={100} required /></label>
        <label className="space-y-1 text-sm"><span className="block">Classification</span><select className="w-full rounded-md border bg-background p-2" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as typeof sensitivity)}>{["public", "internal", "confidential", "restricted"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="block">Human owner</span><select className="w-full rounded-md border bg-background p-2" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}><option value="">Unassigned</option>{users.data?.users.map((user) => <option key={user.principalId} value={user.principalId}>{user.user?.name ?? user.user?.email ?? "Company member"}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="block">Local agent steward</span><select className="w-full rounded-md border bg-background p-2" value={ownerAgentId} onChange={(event) => setOwnerAgentId(event.target.value)}><option value="">Unassigned</option>{agents.data?.filter((agent) => agent.status !== "terminated").map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="block">Review interval in days</span><Input type="number" min={1} max={3650} value={frequency} onChange={(event) => setFrequency(Number(event.target.value))} required /></label>
      </div>
      <p className="text-sm text-muted-foreground">A classification change requires permission to manage access and a new canonical review. Linked Skills retain their strongest classification and must be revalidated.</p>
      <label className="block space-y-1 text-sm"><span>Reason for metadata change</span><Textarea value={rationale} onChange={(event) => setRationale(event.target.value)} minLength={20} maxLength={4000} required /></label>
      <div className="flex justify-end"><Button disabled={busy || playbook.status === "archived" || rationale.trim().length < 20}>Save metadata</Button></div>
    </form>
  </details>;
}
