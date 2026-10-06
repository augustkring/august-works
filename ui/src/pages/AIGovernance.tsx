import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PEOPLE_DOMAINS,
  GOVERNANCE_FRAMEWORKS,
  v7FeatureEnabled,
  createUseCaseSchema,
  updateUseCaseSchema,
  useCaseAssessmentSchema,
  type UseCasePurpose,
  type UseCaseAssessment,
} from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { GovernanceObligations } from "@/components/GovernanceObligations";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
const lines = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
const emptyPurpose = (): UseCasePurpose => ({
  name: "",
  description: "",
  intendedPurpose: "",
  prohibitedUses: [
    "Employee scoring, emotion inference and automatic person decisions",
  ],
  affectedPersonCategories: [],
  dataCategories: [],
  specialCategoryDataExpected: false,
  peopleDomain: "none",
  customerFacing: false,
  externalCommunication: false,
  makesRecommendationsAboutPeople: false,
  makesDecisionsAboutPeople: false,
  materialLegalOrSimilarEffect: false,
  foreseeableMisuse: [],
  providerInstructionsRefs: [],
  providerRoleFacts: {
    madeAvailableBy: "",
    trademarkOwner: "",
    purposeDefinedBy: "",
    integratedBy: "",
    rebranded: false,
    substantiallyModified: false,
    contractualCooperationRefs: [],
  },
  criticality: "medium",
  riskClass: "C0",
  oversightProfileId: "",
  retentionPurpose: "",
  retentionDays: 30,
  nextReviewAt: new Date(Date.now() + 90 * 86400000).toISOString(),
});
const emptyReview = (): UseCaseAssessment => ({
  expectedVersion: 1,
  framework: "eu_ai_act",
  frameworkVersionOrDate: "",
  classification: "uncertain",
  applicableRequirements: [],
  facts: "",
  evidenceRefs: [],
  assessmentMethod: "",
  reviewRequired: true,
  reviewerAttestation: "",
  friaApplicability: "review_required",
  friaApplicabilityReason: "",
});
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function AIGovernance() {
  const identity = useAccountIdentity();
  const userId = identity.userId ?? undefined;
  const { selectedCompanyId: companyId } = useCompany(),
    cache = useQueryClient(),
    { setBreadcrumbs } = useBreadcrumbs();
  const [selectedId, setSelectedId] = useState(""),
    [draft, setDraft] = useState(emptyPurpose),
    [key, setKey] = useState(""),
    [rationale, setRationale] = useState(""),
    [review, setReview] = useState(emptyReview),
    [issueId, setIssueId] = useState("");
  useEffect(() => {
    setBreadcrumbs([{ label: "AI Governance" }]);
  }, [setBreadcrumbs]);
  useEffect(() => {
    setSelectedId("");
    setDraft(emptyPurpose());
    setKey("");
    setRationale("");
    setReview(emptyReview());
    setIssueId("");
  }, [companyId, userId]);
  const settings = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const evidenceEnabled = v7FeatureEnabled(
    settings.data ?? {},
    "governance_evidence_v7",
  );
  const cases = useQuery({
    queryKey: ["ai-use-cases", companyId, userId],
    queryFn: () => aiGovernanceApi.list(companyId!, userId),
    enabled: !!companyId && !!userId,
  });
  const profiles = useQuery({
    queryKey: ["ai-oversight-profiles", companyId, userId],
    queryFn: () => aiGovernanceApi.profiles(companyId!, userId),
    enabled: !!companyId && !!userId,
  });
  const detail = useQuery({
    queryKey: ["ai-use-case", companyId, userId, selectedId],
    queryFn: () => aiGovernanceApi.detail(companyId!, selectedId, userId),
    enabled: !!companyId && !!userId && !!selectedId,
  });
  const tasks = useQuery({
    queryKey: ["ai-use-case-tasks", companyId, userId],
    queryFn: () => aiGovernanceApi.targets(companyId!, userId),
    enabled: !!companyId && !!userId,
  });
  const selected = cases.data?.find((row) => row.id === selectedId);
  useEffect(() => {
    if (selected) setDraft(selected.purpose);
  }, [selected?.id, selected?.purposeHash]);
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => {
      const requestedCompany = companyId;
      await operation();
      return requestedCompany;
    },
    onSuccess: (requestedCompany) => {
      void cache.invalidateQueries({
        queryKey: ["ai-use-cases", requestedCompany],
      });
      void cache.invalidateQueries({
        queryKey: ["ai-use-case", requestedCompany],
      });
      void cache.invalidateQueries({
        queryKey: ["ai-oversight-profiles", requestedCompany],
      });
    },
  });
  const set = <K extends keyof UseCasePurpose>(
    field: K,
    value: UseCasePurpose[K],
  ) => setDraft((current) => ({ ...current, [field]: value }));
  const reviewSet = <K extends keyof UseCaseAssessment>(
    field: K,
    value: UseCaseAssessment[K],
  ) => setReview((current) => ({ ...current, [field]: value }));
  const text = (
    label: string,
    field: "name" | "description" | "intendedPurpose" | "retentionPurpose",
  ) => (
    <Field label={label}>
      <Textarea
        value={draft[field]}
        onChange={(event) => set(field, event.target.value)}
        maxLength={4000}
      />
    </Field>
  );
  const list = (
    label: string,
    field:
      | "prohibitedUses"
      | "affectedPersonCategories"
      | "dataCategories"
      | "foreseeableMisuse"
      | "providerInstructionsRefs",
  ) => (
    <Field label={`${label} (one per line)`}>
      <Textarea
        value={draft[field].join("\n")}
        onChange={(event) => set(field, lines(event.target.value))}
      />
    </Field>
  );
  if (!identity.settled || !userId)
    return <p>Sign in to review AI governance.</p>;
  if (!companyId) return <p>Select a company to review its AI use cases.</p>;
  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">AI Governance</h1>
      <p className="text-muted-foreground">
        Record intended purpose, accountable review and human oversight.
        Approval reviews a purpose; deployment still needs current permissions,
        verification and runtime qualification.
      </p>
      {(cases.error || profiles.error || mutation.error) && (
        <p role="alert">
          {(cases.error ?? profiles.error ?? mutation.error)?.message}
        </p>
      )}
      <Field label="Use case">
        <select
          className="rounded-md border bg-background p-2"
          value={selectedId}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setRationale("");
            setReview(emptyReview());
            if (!event.target.value) setDraft(emptyPurpose());
          }}
        >
          <option value="">Register a new use case</option>
          {cases.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.purpose.name} · {row.status}
            </option>
          ))}
        </select>
      </Field>
      {selected && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{selected.status}</Badge>
          <Badge variant="outline">
            Purpose version {selected.purposeVersion}
          </Badge>
          <Badge variant="outline">{selected.purpose.riskClass}</Badge>
        </div>
      )}
      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="font-semibold">Intended purpose</h2>
        {!selected && (
          <Field label="Use-case key">
            <Input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="campaign-analysis"
            />
          </Field>
        )}
        {text("Name", "name")}
        {text("Description", "description")}
        {text("Allowed intended purpose", "intendedPurpose")}
        {list("Prohibited uses", "prohibitedUses")}
        {list("Affected person categories", "affectedPersonCategories")}
        {list("Data categories", "dataCategories")}
        {list("Foreseeable misuse", "foreseeableMisuse")}
        {list("Provider instruction references", "providerInstructionsRefs")}
        <Field label="People inference or decision domain">
          <select
            className="rounded-md border bg-background p-2"
            value={draft.peopleDomain}
            onChange={(event) =>
              set(
                "peopleDomain",
                event.target.value as UseCasePurpose["peopleDomain"],
              )
            }
          >
            {PEOPLE_DOMAINS.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        {(
          [
            ["specialCategoryDataExpected", "Special-category data expected"],
            ["customerFacing", "Customer-facing use"],
            ["externalCommunication", "External communication"],
            [
              "makesRecommendationsAboutPeople",
              "Makes recommendations about people",
            ],
            ["makesDecisionsAboutPeople", "Makes decisions about people"],
            [
              "materialLegalOrSimilarEffect",
              "Material legal or similar effect",
            ],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft[field]}
              onChange={(event) => set(field, event.target.checked)}
            />
            {label}
          </label>
        ))}
        <Field label="Risk class">
          <select
            className="rounded-md border bg-background p-2"
            value={draft.riskClass}
            onChange={(event) =>
              set(
                "riskClass",
                event.target.value as UseCasePurpose["riskClass"],
              )
            }
          >
            {["C0", "C1", "C2", "C3", "C4"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="System criticality">
          <select
            className="rounded-md border bg-background p-2"
            value={draft.criticality}
            onChange={(event) =>
              set(
                "criticality",
                event.target.value as UseCasePurpose["criticality"],
              )
            }
          >
            {["low", "medium", "high", "critical"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <h3 className="font-medium">Value-chain facts</h3>
        {(
          [
            ["madeAvailableBy", "Who makes the system available?"],
            ["trademarkOwner", "Whose name or trademark is used?"],
            ["purposeDefinedBy", "Who defines intended purpose?"],
            ["integratedBy", "Who integrates or customizes it?"],
          ] as const
        ).map(([field, label]) => (
          <Field key={field} label={label}>
            <Input
              value={draft.providerRoleFacts[field]}
              onChange={(event) =>
                set("providerRoleFacts", {
                  ...draft.providerRoleFacts,
                  [field]: event.target.value,
                })
              }
            />
          </Field>
        ))}
        {(
          [
            ["rebranded", "System is rebranded"],
            ["substantiallyModified", "System is substantially modified"],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.providerRoleFacts[field]}
              onChange={(event) =>
                set("providerRoleFacts", {
                  ...draft.providerRoleFacts,
                  [field]: event.target.checked,
                })
              }
            />
            {label}
          </label>
        ))}
        <Field label="Contractual cooperation references (one per line)">
          <Textarea
            value={draft.providerRoleFacts.contractualCooperationRefs.join(
              "\n",
            )}
            onChange={(event) =>
              set("providerRoleFacts", {
                ...draft.providerRoleFacts,
                contractualCooperationRefs: lines(event.target.value),
              })
            }
          />
        </Field>
        <Field label="Human oversight profile">
          <select
            className="rounded-md border bg-background p-2"
            value={draft.oversightProfileId}
            onChange={(event) => set("oversightProfileId", event.target.value)}
          >
            <option value="">Choose an active profile</option>
            {profiles.data
              ?.filter((row) => row.status === "active")
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.profile.name} · {row.profile.mode.replaceAll("_", " ")}
                </option>
              ))}
          </select>
        </Field>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate(() =>
              aiGovernanceApi.oversight(
                companyId,
                {
                  name: "Mandatory human decisions",
                  riskClass: "C3",
                  mode: "mandatory_human_decision",
                  requiredReviewActions: [
                    "Review every material action and independently verify completion",
                  ],
                  escalationRoles: ["owner", "admin"],
                  responseDeadlineSeconds: 3600,
                  overrideAllowed: false,
                  stopAuthority: ["owner", "admin"],
                },
                userId,
              ),
            )
          }
        >
          Create a mandatory human decision profile
        </Button>
        {text("Retention purpose", "retentionPurpose")}
        <Field label="Retention days">
          <Input
            type="number"
            min={1}
            max={3650}
            value={draft.retentionDays}
            onChange={(event) =>
              set("retentionDays", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Next review date (UTC)">
          <Input
            type="date"
            value={draft.nextReviewAt.slice(0, 10)}
            onChange={(event) => {
              if (event.target.value)
                set("nextReviewAt", `${event.target.value}T00:00:00.000Z`);
            }}
          />
        </Field>
        <Field label="Reason for change or decision">
          <Textarea
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            minLength={10}
            maxLength={4000}
          />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedId("");
              setDraft(emptyPurpose());
              setRationale("");
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !(selected
                ? updateUseCaseSchema.safeParse({
                    expectedVersion: selected.version,
                    purpose: draft,
                    changeReason: rationale,
                  }).success
                : createUseCaseSchema.safeParse({ key, purpose: draft })
                    .success)
            }
            onClick={() =>
              mutation.mutate(() =>
                selected
                  ? aiGovernanceApi.update(selected, draft, rationale, userId)
                  : aiGovernanceApi.create(companyId, key, draft, userId),
              )
            }
          >
            {selected ? "Save new purpose version" : "Register draft"}
          </Button>
        </div>
      </section>
      {selected && (
        <section className="space-y-4 rounded-lg border p-4">
          <h2 className="font-semibold">Accountable assessment</h2>
          <p className="text-muted-foreground">
            Record reviewed deployment facts and external references.
            Specialized people decisions remain unavailable in the general
            runtime.
          </p>
          <Field label="Framework">
            <select
              className="rounded-md border bg-background p-2"
              value={review.framework}
              onChange={(event) =>
                reviewSet(
                  "framework",
                  event.target.value as UseCaseAssessment["framework"],
                )
              }
            >
              {GOVERNANCE_FRAMEWORKS.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Framework version or date">
            <Input
              value={review.frameworkVersionOrDate}
              onChange={(event) =>
                reviewSet("frameworkVersionOrDate", event.target.value)
              }
            />
          </Field>
          <Field label="Classification">
            <select
              className="rounded-md border bg-background p-2"
              value={review.classification}
              onChange={(event) =>
                reviewSet(
                  "classification",
                  event.target.value as UseCaseAssessment["classification"],
                )
              }
            >
              {[
                "uncertain",
                "reviewed",
                "not_applicable",
                "limited_risk",
                "high_risk",
                "prohibited",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          {(
            [
              ["facts", "Actual deployment facts"],
              ["assessmentMethod", "Assessment method"],
              ["reviewerAttestation", "Reviewer attestation"],
              ["friaApplicabilityReason", "FRIA applicability reasoning"],
            ] as const
          ).map(([field, label]) => (
            <Field key={field} label={label}>
              <Textarea
                value={review[field]}
                onChange={(event) => reviewSet(field, event.target.value)}
                minLength={10}
                maxLength={4000}
              />
            </Field>
          ))}
          <Field label="Applicable requirements (one per line)">
            <Textarea
              value={review.applicableRequirements.join("\n")}
              onChange={(event) =>
                reviewSet("applicableRequirements", lines(event.target.value))
              }
            />
          </Field>
          <Field label="Evidence references (one per line)">
            <Textarea
              value={review.evidenceRefs.join("\n")}
              onChange={(event) =>
                reviewSet("evidenceRefs", lines(event.target.value))
              }
            />
          </Field>
          <Field label="FRIA applicability">
            <select
              className="rounded-md border bg-background p-2"
              value={review.friaApplicability}
              onChange={(event) =>
                reviewSet(
                  "friaApplicability",
                  event.target.value as UseCaseAssessment["friaApplicability"],
                )
              }
            >
              {["yes", "no", "uncertain", "review_required"].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={review.reviewRequired}
              onChange={(event) =>
                reviewSet("reviewRequired", event.target.checked)
              }
            />
            Further accountable review required
          </label>
          <Button
            disabled={
              mutation.isPending ||
              !useCaseAssessmentSchema.safeParse(review).success
            }
            onClick={() =>
              mutation.mutate(() =>
                aiGovernanceApi.assess(selected, review, userId),
              )
            }
          >
            Record assessment for this purpose version
          </Button>
          <div className="flex flex-wrap gap-2">
            {(["approve", "suspend", "retire"] as const).map((action) => (
              <Button
                key={action}
                variant={action === "approve" ? "default" : "outline"}
                disabled={
                  mutation.isPending ||
                  rationale.trim().length < 10 ||
                  selected.status === "retired"
                }
                onClick={() =>
                  mutation.mutate(() =>
                    aiGovernanceApi.decide(selected, action, rationale, userId),
                  )
                }
              >
                {action === "approve"
                  ? "Approve reviewed purpose"
                  : action === "suspend"
                    ? "Suspend use case"
                    : "Retire use case"}
              </Button>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <section className="space-y-4 rounded-lg border p-4">
          <h2 className="font-semibold">Deployment and evidence</h2>
          <p className="text-muted-foreground">
            C2 and C3 work needs a matching orchestration plan with independent
            verification. A revised or suspended deployment cannot reuse its old
            approval.
          </p>
          <Field label="Owned native Task">
            <select
              className="rounded-md border bg-background p-2"
              value={issueId}
              onChange={(event) => setIssueId(event.target.value)}
            >
              <option value="">Choose an assigned Task</option>
              {tasks.data
                ?.filter((task) => !!task.assigneeAgentId)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.identifier} · {task.title}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            disabled={
              mutation.isPending || selected.status !== "approved" || !issueId
            }
            onClick={() => {
              const task = tasks.data?.find((row) => row.id === issueId);
              if (task?.assigneeAgentId)
                mutation.mutate(() =>
                  aiGovernanceApi.bind(
                    selected,
                    task.id,
                    task.assigneeAgentId!,
                    userId,
                  ),
                );
            }}
          >
            Bind current purpose to Task
          </Button>
          {evidenceEnabled && (
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate(async () => {
                  const pack = await aiGovernanceApi.evidencePack(
                    selected.companyId,
                    selected.id,
                    userId,
                  );
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(pack, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  try {
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `ai-governance-${selected.key}-v${selected.purposeVersion}.json`;
                    anchor.click();
                  } finally {
                    URL.revokeObjectURL(url);
                  }
                })
              }
            >
              Export current evidence pack
            </Button>
          )}
          {detail.error && <p role="alert">{detail.error.message}</p>}
          {detail.data?.assessments.map((record) => (
            <p key={record.id}>
              {record.assessment.framework.replaceAll("_", " ")} ·{" "}
              {record.assessment.classification.replaceAll("_", " ")} · purpose
              version {record.purposeVersion}
            </p>
          ))}
          {detail.data?.deployments.map((deployment) => (
            <p key={deployment.id}>
              <Link
                className="text-primary underline"
                to={`/issues/${deployment.issueId}`}
              >
                Open governed Task
              </Link>{" "}
              · {deployment.status.replaceAll("_", " ")} · purpose version{" "}
              {deployment.purposeVersion}
            </p>
          ))}
          {detail.data?.stopRequests.map((request) => (
            <p key={request.id}>
              {request.status === "delivered"
                ? "Stop request delivered to the runtime controller"
                : request.attempts >= 5
                  ? "Stop delivery needs operator attention"
                  : "Stop request queued"}
            </p>
          ))}
        </section>
      )}
      {evidenceEnabled && (
        <GovernanceObligations
          key={`${companyId}:${userId}`}
          companyId={companyId}
          userId={userId}
        />
      )}
    </main>
  );
}
