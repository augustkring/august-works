import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createManagementReviewTaskSchema, type ManagementReviewView } from "@paperclipai/shared";
import { managementReviewsApi } from "@/api/management-reviews";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
export function ManagementReviewTaskForm({ review, userId, onAuthorityLost }: { review: ManagementReviewView; userId: string | null; onAuthorityLost: () => void }) {
  const [editing, setEditing] = useState(false), [itemKey, setItemKey] = useState(""), [title, setTitle] = useState(""), [description, setDescription] = useState(""), [priority, setPriority] = useState("medium"), [ack, setAck] = useState(false), [requestKey, setRequestKey] = useState(() => crypto.randomUUID()), [issueId, setIssueId] = useState("");
  useEffect(() => { setEditing(false); setItemKey(""); setTitle(""); setDescription(""); setAck(false); setIssueId(""); setRequestKey(crypto.randomUUID()); }, [review.id, review.packet.contentHash]);
  const parsed = createManagementReviewTaskSchema.safeParse({ expectedContentHash: review.packet.contentHash, itemKey, idempotencyKey: requestKey, title, description, priority, humanReviewAcknowledged: ack });
  const save = useMutation({ mutationFn: () => managementReviewsApi.createTask(review.companyId, review.id, createManagementReviewTaskSchema.parse(parsed.data), userId), onSuccess: result => { setIssueId(result.issueId); setEditing(false); setTitle(""); setDescription(""); setAck(false); setRequestKey(crypto.randomUUID()); }, onError: onAuthorityLost });
  if (review.status !== "published" || review.currentQualification !== "current" || Date.parse(review.expiresAt) <= Date.now()) return null;
  const items = review.packet.agenda.filter(item => item.category !== "NO_ACTION");
  if (!items.length) return null;
  return <section aria-label="Native Human review follow-up" className="min-w-0 space-y-3 rounded-md border p-4"><h2 className="font-semibold">Native Human follow-up</h2><p>Review the cited agenda and write an explicit Task. The native Task retains a review reference; its assignment and execution use the existing Task workflow.</p>
    {issueId && <p role="status">Task created. <Link className="underline" to={`/issues/${issueId}`}>Open native follow-up Task</Link></p>}
    {!editing && <Button variant="outline" onClick={() => { setIssueId(""); setAck(false); setEditing(true); }}>Prepare native follow-up Task</Button>}
    {editing && <form aria-label="Cited native Task follow-up" className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); if (parsed.success && !save.isPending) save.mutate(); }}><fieldset disabled={save.isPending} className="min-w-0 space-y-3"><legend>Explicit Human Task proposal</legend>
      <label className="block space-y-2">Original agenda item<select aria-label="Task original agenda item" className={selectStyle} value={itemKey} onChange={event => { setItemKey(event.target.value); setAck(false); setRequestKey(crypto.randomUUID()); }}><option value="">Choose a cited Human agenda item</option>{items.map(item => <option key={item.key} value={item.key}>{item.key} · {item.category.replaceAll("_", " ")}</option>)}</select></label>
      <label className="block space-y-2">Task title<Input aria-label="Review follow-up Task title" value={title} required minLength={3} maxLength={200} onChange={event => { setTitle(event.target.value); setAck(false); }} /></label>
      <label className="block space-y-2">Human Task description<Textarea aria-label="Review follow-up Task description" value={description} required minLength={10} maxLength={4000} onChange={event => { setDescription(event.target.value); setAck(false); }} /></label>
      <label className="block space-y-2">Task priority<select aria-label="Review follow-up Task priority" className={selectStyle} value={priority} onChange={event => { setPriority(event.target.value); setAck(false); }}>{["low", "medium", "high", "critical"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />I reviewed this exact published packet and propose this native Task. Creating it does not verify an intervention or outcome.</label>
    </fieldset><div className="flex flex-wrap gap-2"><Button type="submit" disabled={!parsed.success || save.isPending}>Create reviewed native Task</Button><Button type="button" variant="ghost" disabled={save.isPending} onClick={() => { setEditing(false); setTitle(""); setDescription(""); setAck(false); }}>Cancel Task follow-up</Button></div></form>}
  </section>;
}
