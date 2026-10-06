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
