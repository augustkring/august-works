import { useCallback, useEffect, useState } from "react";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v7FeatureEnabled, v8FeatureEnabled, type Routine, type RoutineManagementReviewTemplate } from "@paperclipai/shared";
import { useAccountIdentity } from "@/api/companies-query";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { routinesApi } from "@/api/routines";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { ManagementReviewDefinitionForm } from "./ManagementReviewDefinitionForm";

/** The configuration has its own native revision save; it never publishes a packet. */
export function RoutineManagementReviewEditor({ routine, otherChangesPending = false }: { routine: Routine; otherChangesPending?: boolean }) {
  const { userId, settled, failed } = useAccountIdentity(), verifying = useIsFetching({ queryKey: queryKeys.auth.session }) > 0;
  const flags = useQuery({ queryKey: [...queryKeys.instance.experimentalSettings, "routine-review-template", userId], queryFn: () => instanceSettingsApi.getExperimental(), enabled: settled && !failed && !verifying, retry: false, refetchOnWindowFocus: false });
  if (failed || flags.isError) return <p role="alert">Current Human review configuration could not be verified. Reload before continuing.</p>;
  if (!settled || verifying || flags.isFetching || !flags.data) return <p role="status">Verifying current Human review configuration…</p>;
  if (!userId) return <p>Recurring review configuration requires a current Human account.</p>;
  const enabled = !flags.isError && v8FeatureEnabled(flags.data, "management_reviews_v8") && v7FeatureEnabled(flags.data, "governance_evidence_v7");
  if (!enabled) return <p role="status">Recurring management review drafts are disabled.</p>;
  return <RoutineReviewTemplateWorkspace key={`${routine.companyId}:${routine.id}:${userId}`} routine={routine} userId={userId} otherChangesPending={otherChangesPending} />;
}

export function RoutineReviewTemplateWorkspace({ routine, userId, otherChangesPending = false }: { routine: Routine; userId: string; otherChangesPending?: boolean }) {
  const cache = useQueryClient(), [editing, setEditing] = useState(false), [lost, setLost] = useState(false), [message, setMessage] = useState("");
  const loseAuthority = useCallback(() => {
    setLost(true); setEditing(false); setMessage("Current Source authority changed. Refresh before configuring a new template.");
    for (const prefix of ["management-definition-sources", "strategy-sources", "decision-evidence"]) { void cache.cancelQueries({ queryKey: [prefix, routine.companyId, userId] }); cache.removeQueries({ queryKey: [prefix, routine.companyId, userId] }); }
  }, [cache, routine.companyId, userId]);
  useEffect(() => { window.addEventListener("memory-access-changed", loseAuthority); return () => window.removeEventListener("memory-access-changed", loseAuthority); }, [loseAuthority]);
  useEffect(() => { setEditing(false); setMessage(""); }, [routine.latestRevisionId]);
  const save = useMutation({
    mutationFn: (template: RoutineManagementReviewTemplate | null) => routinesApi.update(routine.id, { baseRevisionId: routine.latestRevisionId, managementReviewTemplate: template }, userId),
    onSuccess: async (_result, template) => {
      setEditing(false); setMessage(template ? "Review template saved to this Routine revision. Configure its schedule in Triggers." : "Review drafting removed from future Routine runs.");
      await Promise.all([cache.invalidateQueries({ queryKey: queryKeys.routines.detail(routine.id) }), cache.invalidateQueries({ queryKey: queryKeys.routines.list(routine.companyId) }), cache.invalidateQueries({ queryKey: queryKeys.routines.revisions(routine.id) })]);
    },
    onError: error => { loseAuthority(); setMessage(error instanceof Error ? error.message : "The current Routine revision could not be saved. Reload before retrying."); void cache.invalidateQueries({ queryKey: queryKeys.routines.detail(routine.id) }); },
  });
  const workflow = routine.executionTargetKind === "workflow" && !!routine.executionTargetRef;
  const busy = save.isPending || otherChangesPending, blocked = busy || lost || !workflow || !routine.latestRevisionId;
  return <section aria-label="Recurring management review drafts" className="min-w-0 space-y-3 rounded-md border p-4">
    <h2 className="font-semibold">Recurring management review drafts</h2>
    <p>Use this Routine’s existing schedule to capture current evidence for daily, weekly, monthly or quarterly Human reviews. Its configured Workflow runs after draft capture. Publication stays a separate Human action.</p>
    {!workflow && <p>Choose and save a published Workflow execution target before configuring review drafts.</p>}
    {otherChangesPending && <p role="status">Save or discard the other Routine changes before configuring its review template.</p>}
    {routine.managementReviewTemplate && !editing && !lost && <p>A {routine.managementReviewTemplate.reviewType.replaceAll("_", " ")} template is configured with a rolling {routine.managementReviewTemplate.periodDays}-day review period.</p>}
    {message && <p role={lost || save.isError ? "alert" : "status"}>{message}</p>}
    {!editing && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={blocked} onClick={() => { setMessage(""); setEditing(true); }}>{routine.managementReviewTemplate ? "Edit recurring review template" : "Configure recurring review drafts"}</Button>{routine.managementReviewTemplate && <Button type="button" variant="ghost" disabled={busy || lost} onClick={() => save.mutate(null)}>Remove recurring review template</Button>}{lost && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setLost(false); setMessage(""); }}>Refresh review template authority</Button>}<Link className="text-sm underline" to={`/routines/${routine.id}/triggers`}>Configure Routine schedule</Link></div>}
    {editing && !blocked && <ManagementReviewDefinitionForm companyId={routine.companyId} userId={userId} busy={save.isPending} cadence={{ initial: routine.managementReviewTemplate ?? null, onSave: template => save.mutate(template) }} onSave={() => {}} onCancel={() => setEditing(false)} onAuthorityLost={loseAuthority} />}
  </section>;
}
