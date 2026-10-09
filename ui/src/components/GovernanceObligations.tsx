import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GOVERNANCE_FRAMEWORKS,
  governanceObligationSchema,
  type GovernanceObligation,
} from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const blank = (): GovernanceObligation => ({
  framework: "eu_ai_act",
  authority: "",
  citation: "",
  jurisdictionOrScope: "",
  applicabilityFacts: "",
  applicabilityState: "review_required",
  effectiveFrom: new Date().toISOString(),
  effectiveUntil: null,
  requiredControl: "",
  evidenceRequired: [],
  controlRefs: [],
  nextReviewAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  reviewTrigger: "",
  sourceVersionOrDate: "",
  sourceUrl: "",
});
export function GovernanceObligations({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  const [draft, setDraft] = useState(blank),
    cache = useQueryClient();
  const records = useQuery({
    queryKey: ["governance-obligations", companyId, userId],
    queryFn: () => aiGovernanceApi.obligations(companyId, userId),
  });
  const mutation = useMutation({
    mutationFn: () => aiGovernanceApi.obligation(companyId, draft, userId),
    onSuccess: () => {
      setDraft(blank());
      void cache.invalidateQueries({
        queryKey: ["governance-obligations", companyId, userId],
      });
    },
  });
  const set = <K extends keyof GovernanceObligation>(
    key: K,
    value: GovernanceObligation[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Reviewed obligations</h2>
      <p className="text-muted-foreground">
        Record applicability to this company with current authority and source
        references. Uncertain or overdue obligations require review before
        governed execution. A new review with the same framework, authority,
        citation and scope supersedes the previous record while preserving
        history.
      </p>
      {(records.error || mutation.error) && (
        <p role="alert">{(records.error ?? mutation.error)?.message}</p>
      )}
      {records.data?.map((row) => (
        <p key={row.id}>
          {row.obligation.authority} · {row.obligation.citation} ·{" "}
          {row.obligation.applicabilityState.replaceAll("_", " ")} · review{" "}
          {row.nextReviewAt.slice(0, 10)}
          {row.obligation.analyticalPurpose && <> · analytical purpose {row.obligation.analyticalPurpose.status} · {row.obligation.analyticalPurpose.capabilities.join(", ")}</>}
        </p>
      ))}
      <label className="block space-y-2">
        Framework
        <select
          className="block rounded-md border bg-background p-2"
          value={draft.framework}
          onChange={(event) =>
            set(
              "framework",
              event.target.value as GovernanceObligation["framework"],
            )
          }
        >
          {GOVERNANCE_FRAMEWORKS.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["authority", "Authority"],
          ["citation", "Citation"],
          ["jurisdictionOrScope", "Jurisdiction or company scope"],
          ["applicabilityFacts", "Actual applicability facts"],
          ["requiredControl", "Required control"],
          ["reviewTrigger", "Trigger for reassessment"],
          ["sourceVersionOrDate", "Source version or date"],
          ["sourceUrl", "Public HTTPS source reference"],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="block space-y-2">
          {label}
          <Textarea
            value={draft[field]}
            onChange={(event) => set(field, event.target.value)}
          />
        </label>
      ))}
      <label className="block space-y-2">
        Applicability
        <select
          className="block rounded-md border bg-background p-2"
          value={draft.applicabilityState}
          onChange={(event) =>
            set(
              "applicabilityState",
              event.target.value as GovernanceObligation["applicabilityState"],
            )
          }
        >
          {["review_required", "uncertain", "applicable", "not_applicable"].map(
            (value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ),
          )}
        </select>
      </label>
      {(
        [
          ["evidenceRequired", "Required evidence"],
          ["controlRefs", "References to existing controls"],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="block space-y-2">
          {label} (one per line)
          <Textarea
            value={draft[field].join("\n")}
            onChange={(event) =>
              set(
                field,
                event.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      ))}
      {(
        [
          ["effectiveFrom", "Effective from"],
          ["effectiveUntil", "Effective until (optional)"],
          ["nextReviewAt", "Next review"],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="block space-y-2">
          {label} (UTC)
          <Input
            type="date"
            value={draft[field]?.slice(0, 10) ?? ""}
            onChange={(event) => {
              if (event.target.value)
                set(field, `${event.target.value}T00:00:00.000Z`);
              else if (field === "effectiveUntil") set(field, null);
            }}
          />
        </label>
      ))}
      {draft.framework === "company_policy" && <fieldset className="space-y-4">
        <legend className="font-medium">Analytical purpose</legend>
        <p className="text-muted-foreground">Record the approved use of business objects for advisory analysis. Employee ranking and automated people decisions are outside this profile. Approval requires the accountable human review recorded here.</p>
        {!draft.analyticalPurpose ? <Button variant="outline" onClick={() => set("analyticalPurpose", { status: "suspended", purpose: "management_intelligence", capabilities: ["metrics"], populationUnits: "business_objects", peopleImpact: "none", decisionBoundary: "advisory_only", maxRetentionDays: 30, permittedSensitivity: ["internal"], prohibitedUses: [], approvalRationale: "" })}>Add analytical purpose</Button> : <>
          <label className="block space-y-2">Purpose status<select className="block rounded-md border bg-background p-2" value={draft.analyticalPurpose.status} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, status: event.target.value as "approved" | "suspended" })}><option value="suspended">Suspended</option><option value="approved">Approved after human review</option></select></label>
          <label className="block space-y-2">Intended analytical purpose<select className="block rounded-md border bg-background p-2" value={draft.analyticalPurpose.purpose} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, purpose: event.target.value as "management_intelligence" | "process_intelligence" })}><option value="management_intelligence">Management intelligence</option><option value="process_intelligence">Process intelligence</option></select></label>
          <fieldset className="space-y-2"><legend>Permitted capabilities</legend><div className="flex flex-wrap gap-4">{(["metrics", "strategy", "process", "forecast", "scenario", "experiment", "causal", "planning", "reviews"] as const).map(capability => <label key={capability} className="flex items-center gap-2"><input type="checkbox" checked={draft.analyticalPurpose!.capabilities.includes(capability)} onChange={() => { const current = draft.analyticalPurpose!; set("analyticalPurpose", { ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter(c => c !== capability) : [...current.capabilities, capability] }); }} />{capability}</label>)}</div></fieldset>
          <fieldset className="space-y-2"><legend>Permitted sensitivity</legend><div className="flex flex-wrap gap-4">{(["internal", "confidential"] as const).map(level => <label key={level} className="flex items-center gap-2"><input type="checkbox" checked={draft.analyticalPurpose!.permittedSensitivity.includes(level)} onChange={() => { const current = draft.analyticalPurpose!; set("analyticalPurpose", { ...current, permittedSensitivity: current.permittedSensitivity.includes(level) ? current.permittedSensitivity.filter(c => c !== level) : [...current.permittedSensitivity, level] }); }} />{level}</label>)}</div></fieldset>
          <label className="block space-y-2">Maximum analytical retention (days)<Input type="number" min={1} max={3650} value={draft.analyticalPurpose.maxRetentionDays} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, maxRetentionDays: Number(event.target.value) })} /></label>
          <label className="block space-y-2">Approval rationale<Textarea value={draft.analyticalPurpose.approvalRationale} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, approvalRationale: event.target.value })} /></label>
          <label className="block space-y-2">Prohibited uses (one per line)<Textarea value={draft.analyticalPurpose.prohibitedUses.join("\n")} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, prohibitedUses: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) })} /></label>
          <Button variant="ghost" onClick={() => set("analyticalPurpose", undefined)}>Remove analytical purpose from this review</Button>
        </>}
      </fieldset>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setDraft(blank())}>
          Cancel
        </Button>
        <Button
          disabled={
            mutation.isPending ||
            !governanceObligationSchema.safeParse(draft).success
          }
          onClick={() => mutation.mutate()}
        >
          Record accountable review
        </Button>
      </div>
    </section>
  );
}
