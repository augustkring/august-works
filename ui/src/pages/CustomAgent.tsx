import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CUSTOM_AGENT_STEPS,
  agentAuthoringContentSchema,
  customAgentStepSchema,
  v9FeatureEnabled,
  type AgentAuthoringContent,
  type AgentDraftSave,
  type AgentAuthoringDraftView,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { ApiError } from "@/api/client";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useAccountIdentity } from "@/api/companies-query";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { Link, useNavigate, useParams, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const labels: Record<(typeof CUSTOM_AGENT_STEPS)[number], string> = {
  outcome: "Outcome & owner",
  identity: "Identity",
  instructions: "Instructions",
  knowledge: "Knowledge",
  tools: "Tools & apps",
  authority: "Authority",
  memory: "Memory",
  collaboration: "Collaboration",
  runtime: "Runtime",
  test: "Test",
  review: "Review changes",
  publish: "Publish",
  monitor: "Monitor & improve",
};
const operationLabels: Record<
  AgentAuthoringContent["capabilities"][number]["operation"],
  string
> = {
  read_approved_knowledge: "Read approved knowledge",
  create_internal_draft: "Create internal drafts",
  create_task: "Create tasks",
  external_send: "Send externally",
  spend: "Spend money",
  change_permissions: "Change permissions",
};

function DraftStart({
  company,
  principal,
  enabled,
}: {
  company: string;
  principal: string;
  enabled: boolean;
}) {
  const navigate = useNavigate(),
    [search] = useSearchParams(),
    alive = useRef(true);
  const attempt = useRef<{ requestId: string; agentId: string | null } | null>(
    null,
  );
  const client = useQueryClient();
  const [checkingAccess, setCheckingAccess] = useState(false);
  const securityEpoch = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const drafts = useInfiniteQuery({
    queryKey: ["agent-authoring", company, principal, "list"],
    queryFn: ({ signal, pageParam }) =>
      agentAuthoringApi.list(
        company,
        principal,
        signal,
        pageParam ?? undefined,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    gcTime: 0,
    retry: false,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.payload.entityType === "company_membership" ||
      event.payload.entityType === "agent" ||
      action.startsWith("resource_membership.") ||
      action.includes("erased") ||
      action.endsWith("deleted") ||
      action.includes("permission")
    ) {
      // Hide private titles while the native owner checks current access again.
      setCheckingAccess(true);
      const epoch = ++securityEpoch.current;
      void client
        .resetQueries({
          queryKey: ["agent-authoring", company, principal, "list"],
          exact: true,
        })
        .then(() => {
          if (alive.current && epoch === securityEpoch.current)
            setCheckingAccess(false);
        });
    }
  });
  const create = useMutation({
    mutationFn: () => {
      attempt.current ??= {
        requestId: crypto.randomUUID(),
        agentId: search.get("agentId"),
      };
      return agentAuthoringApi.create(company, principal, attempt.current);
    },
    onSuccess: (draft) => {
      if (alive.current) navigate(draft.kind === "hire" ? `/agents/hire/drafts/${draft.id}/${draft.step}` : `/agents/custom/${draft.id}/${draft.step}`);
    },
  });
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        to="/advanced"
        className="inline-flex min-h-11 items-center underline"
      >
        Advanced
      </Link>
      <h1 className="text-2xl font-semibold">Create custom agent</h1>
      <p>
        Define its responsibility, limits and accountable owner. Save a draft
        and return when you are ready to review it.
      </p>
      <p className="text-muted-foreground">
        Saved drafts do not change the active agent. Representative testing and
        publishing are not qualified yet.
      </p>
      {enabled ? (
        <Button
          className="min-h-11"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending
            ? "Creating draft…"
            : create.isError
              ? "Retry the same draft request"
              : search.get("agentId")
                ? "Create revision draft"
                : "Start a draft"}
        </Button>
      ) : (
        <p role="status">
          New authoring is unavailable. You can still read an existing draft.
        </p>
      )}
      {create.isError && (
        <p role="alert">
          The draft request was not acknowledged. Retry to check whether it was
          already saved.
        </p>
      )}
      <section aria-labelledby="saved-drafts">
        <h2 id="saved-drafts" className="text-lg font-semibold">
          Your saved drafts
        </h2>
        {(drafts.isPending || checkingAccess) && (
          <p role="status">Loading saved drafts…</p>
        )}
        {drafts.isError && (
          <>
            <p role="alert">Saved drafts could not be loaded.</p>
            <Button className="min-h-11" onClick={() => void drafts.refetch()}>
              Try again
            </Button>
          </>
        )}
        {!checkingAccess &&
          drafts.data?.pages[0]?.items.length === 0 &&
          !drafts.hasNextPage && <p>No saved drafts yet.</p>}
        <ul>
          {!checkingAccess &&
            drafts.data?.pages
              .flatMap((page) => page.items)
              .map((draft) => (
                <li key={draft.id}>
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    to={draft.kind === "hire" ? `/agents/hire/drafts/${draft.id}/${draft.step}` : `/agents/custom/${draft.id}/${draft.step}`}
                  >
                    {draft.name || "Untitled agent"} · Draft v{draft.version}
                  </Link>
                </li>
              ))}
        </ul>
        {!checkingAccess && drafts.hasNextPage && (
          <Button
            className="min-h-11"
            disabled={drafts.isFetchingNextPage}
            onClick={() => void drafts.fetchNextPage()}
          >
            Load older drafts
          </Button>
        )}
      </section>
    </div>
  );
}

function DraftEditor({
  company,
  principal,
  id,
  enabled,
}: {
  company: string;
  principal: string;
  id: string;
  enabled: boolean;
}) {
  const navigate = useNavigate(),
    { screen } = useParams(),
    client = useQueryClient();
  const parsed = customAgentStepSchema.safeParse(screen),
    step = parsed.success ? parsed.data : "outcome";
  const alive = useRef(true),
    heading = useRef<HTMLHeadingElement>(null),
    securityPending = useRef(false),
    securityEpoch = useRef(0);
  const [content, setContent] = useState<AgentAuthoringContent | null>(null),
    [receipt, setReceipt] = useState<AgentAuthoringDraftView | null>(null);
  const [saved, setSaved] = useState(false),
    [reauthorizing, setReauthorizing] = useState(false),
    [accessLost, setAccessLost] = useState(false),
    attempt = useRef<{ input: AgentDraftSave; destination: string } | null>(
      null,
    );
  const discardAttempt = useRef<{
    requestId: string;
    expectedVersion: number;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const draft = useQuery({
    queryKey: ["agent-authoring", company, principal, id],
    queryFn: ({ signal }) =>
      agentAuthoringApi.get(company, principal, id, signal),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.payload.entityType !== "company_membership" &&
      !action.startsWith("resource_membership.") &&
      !action.includes("erased") &&
      !action.endsWith("deleted") &&
      !action.includes("permission") &&
      !(
        event.payload.entityType === "agent" &&
        event.payload.entityId === receipt?.agentId
      )
    )
      return;
    setReauthorizing(true);
    securityPending.current = true;
    const epoch = ++securityEpoch.current;
    void draft.refetch().then((result) => {
      if (!alive.current || epoch !== securityEpoch.current) return;
      if (result.isError) {
        setAccessLost(true);
        setContent(null);
        setReceipt(null);
        attempt.current = null;
        discardAttempt.current = null;
        client
          .getQueryCache()
          .find({
            queryKey: ["agent-authoring", company, principal, id],
            exact: true,
          })
          ?.reset();
      } else {
        securityPending.current = false;
      }
      setReauthorizing(false);
    });
  });
  useEffect(() => {
    if (draft.data && !receipt && !accessLost) {
      setReceipt(draft.data);
      setContent(draft.data.content);
    }
  }, [draft.data, receipt, accessLost]);
  const options = useQuery({
    queryKey: [
      "agent-authoring-options",
      company,
      principal,
      receipt?.agentId ?? null,
    ],
    queryFn: ({ signal }) =>
      agentAuthoringApi.options(
        company,
        principal,
        receipt?.agentId ?? null,
        signal,
      ),
    enabled: Boolean(receipt),
    gcTime: 0,
    retry: false,
  });
  const review = useQuery({
    queryKey: [
      "agent-authoring-review",
      company,
      principal,
      id,
      receipt?.version,
    ],
    queryFn: ({ signal }) =>
      agentAuthoringApi.review(company, principal, id, signal),
    enabled: Boolean(
      receipt?.content &&
        ["test", "review", "publish", "monitor"].includes(step),
    ),
    gcTime: 0,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (pending: NonNullable<typeof attempt.current>) =>
      agentAuthoringApi.save(company, principal, id, pending.input),
    onSuccess: (row, pending) => {
      if (!alive.current || securityPending.current) return;
      attempt.current = null;
      setReceipt(row);
      setContent(row.content);
      setSaved(true);
      client.setQueryData(["agent-authoring", company, principal, id], row);
      navigate(pending.destination);
    },
    onError: (error) => {
      if (!alive.current || !(error instanceof ApiError)) return;
      if ([400, 422].includes(error.status)) attempt.current = null;
      if ([401, 403].includes(error.status)) {
        setAccessLost(true);
        setContent(null);
        setReceipt(null);
        attempt.current = null;
      }
    },
  });
  const discard = useMutation({
    mutationFn: () => {
      discardAttempt.current ??= {
        requestId: crypto.randomUUID(),
        expectedVersion: receipt!.version,
      };
      return agentAuthoringApi.discard(
        company,
        principal,
        id,
        discardAttempt.current,
      );
    },
    onSuccess: () => {
      if (alive.current) navigate("/agents/custom");
    },
  });
  function persist(destination: string, nextStep = step) {
    if (!content || !receipt) return;
    attempt.current ??= {
      input: {
        requestId: crypto.randomUUID(),
        expectedVersion: receipt.version,
        step: nextStep,
        content: agentAuthoringContentSchema.parse(structuredClone(content)),
      },
      destination,
    };
    save.mutate(attempt.current);
  }
  function change<K extends keyof AgentAuthoringContent>(
    key: K,
    value: AgentAuthoringContent[K],
  ) {
    setContent((current) => current && { ...current, [key]: value });
    setSaved(false);
  }
  const locked =
    !enabled ||
    save.isPending ||
    Boolean(attempt.current) ||
    discard.isPending ||
    Boolean(discardAttempt.current);
  if (accessLost)
    return (
      <div className="space-y-4 p-6">
        <p role="alert">
          Access to this draft changed. Its content has been hidden.
        </p>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/agents/custom"
        >
          Your drafts
        </Link>
      </div>
    );
  if (reauthorizing)
    return <p role="status">Checking current access to this draft…</p>;
  if (draft.isPending && !receipt)
    return <p role="status">Loading your saved agent draft…</p>;
  if (draft.isError && !receipt)
    return (
      <div className="space-y-4 p-6">
        <p role="alert">
          This draft could not be loaded. Check your account and company access.
        </p>
        <Button className="min-h-11" onClick={() => void draft.refetch()}>
          Try again
        </Button>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/agents/custom"
        >
          Your drafts
        </Link>
      </div>
    );
  if (receipt?.kind === "hire") return <p>This is a Hire Agent setup. <Link className="inline-flex min-h-11 items-center underline" to={`/agents/hire/drafts/${receipt.id}/${receipt.step}`}>Open saved setup</Link></p>;
  if (!receipt?.content || !content)
    return (
      <div className="space-y-4 p-6">
        <h1>Draft discarded</h1>
        <p>The draft content has been removed.</p>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/agents/custom"
        >
          Your drafts
        </Link>
      </div>
    );
  const index = CUSTOM_AGENT_STEPS.indexOf(step),
    next = CUSTOM_AGENT_STEPS[index + 1];
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/agents/custom"
      >
        Your drafts
      </Link>
      <p className="text-sm text-muted-foreground">
        Custom agent · Draft v{receipt.version} · {index + 1} of{" "}
        {CUSTOM_AGENT_STEPS.length}
      </p>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {labels[step]}
      </h1>
      <p>
        Changes remain in this draft until an identified version is reviewed and
        published.
      </p>
      {!enabled && (
        <p role="status">
          Authoring is currently unavailable. Your saved draft is readable and
          can be discarded.
        </p>
      )}
      {receipt.agentId && (
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={`/agents/${receipt.agentId}`}
        >
          Review the current agent
        </Link>
      )}
      <nav
        aria-label="Agent authoring sections"
        className="flex flex-wrap gap-2"
      >
        {CUSTOM_AGENT_STEPS.map((item) => (
          <Button
            key={item}
            variant={item === step ? "secondary" : "ghost"}
            className="min-h-11"
            disabled={locked}
            aria-current={item === step ? "step" : undefined}
            onClick={() => persist(`/agents/custom/${id}/${item}`, item)}
          >
            {labels[item]}
          </Button>
        ))}
      </nav>
      <fieldset disabled={locked} className="space-y-4">
        {step === "outcome" && (
          <>
            <label className="block space-y-2">
              What should this agent be responsible for?
              <Textarea
                value={content.outcome}
                maxLength={2000}
                onChange={(e) => change("outcome", e.target.value)}
              />
            </label>
            <label className="block space-y-2">
              Accountable owner
              <select
                className="min-h-11 w-full rounded-md border bg-background p-2"
                value={content.ownerUserId}
                onChange={(e) => change("ownerUserId", e.target.value)}
              >
                <option value="">Choose an owner</option>
                {options.data?.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {step === "identity" && (
          <>
            {(["name", "description", "internalDescription"] as const).map(
              (key) => (
                <label key={key} className="block space-y-2">
                  {key === "name"
                    ? "Agent name"
                    : key === "description"
                      ? "Customer-facing description"
                      : "Internal description (optional)"}
                  <Input
                    className="min-h-11"
                    value={content[key]}
                    maxLength={
                      key === "name" ? 200 : key === "description" ? 1000 : 2000
                    }
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
              ),
            )}
          </>
        )}
        {step === "instructions" && (
          <>
            {(
              Object.keys(content.instructions) as Array<
                keyof AgentAuthoringContent["instructions"]
              >
            ).map((key) => (
              <label key={key} className="block space-y-2">
                {
                  {
                    purpose: "Purpose",
                    responsibilities: "Responsibilities",
                    prohibited: "What it should not do",
                    missingInformation:
                      "When information is missing or ambiguous",
                    escalation: "Escalation and handoff",
                    communication: "Communication style (optional)",
                  }[key]
                }
                <Textarea
                  value={content.instructions[key]}
                  maxLength={
                    key === "responsibilities"
                      ? 6000
                      : key === "prohibited"
                        ? 3000
                        : key === "communication"
                          ? 1000
                          : 2000
                  }
                  onChange={(e) =>
                    change("instructions", {
                      ...content.instructions,
                      [key]: e.target.value,
                    })
                  }
                />
              </label>
            ))}
          </>
        )}
        {step === "knowledge" && (
          <>
            <p>
              Choose only approved sources needed for the responsibility. This
              selection does not grant access.
            </p>
            {options.data?.knowledge.length === 0 && (
              <p>
                No approved company sources are available. Review Company
                knowledge before testing.
              </p>
            )}
            {options.data?.knowledge.map((source) => (
              <label
                key={source.id}
                className="flex min-h-11 items-center gap-3"
              >
                <input
                  type="checkbox"
                  checked={content.knowledgeDocumentIds.includes(source.id)}
                  onChange={(e) =>
                    change(
                      "knowledgeDocumentIds",
                      e.target.checked
                        ? [...content.knowledgeDocumentIds, source.id]
                        : content.knowledgeDocumentIds.filter(
                            (id) => id !== source.id,
                          ),
                    )
                  }
                />
                {source.title} · Read approved version · {source.sensitivity}
              </label>
            ))}
            <Link
              className="inline-flex min-h-11 items-center underline"
              to="/foundation"
            >
              Review company knowledge
            </Link>
          </>
        )}
        {(step === "tools" || step === "authority") && (
          <>
            <p>
              Propose a bounded capability policy. Publishing must independently
              validate each operation and its resource scope.
            </p>
            {Object.entries(operationLabels).map(([raw, label]) => {
              const operation = raw as keyof typeof operationLabels,
                selected =
                  content.capabilities.find(
                    (item) => item.operation === operation,
                  )?.autonomy ?? "not_allowed";
              return (
                <label key={operation} className="block space-y-2">
                  {label}
                  <select
                    className="min-h-11 w-full rounded-md border bg-background p-2"
                    value={selected}
                    onChange={(e) =>
                      change("capabilities", [
                        ...content.capabilities.filter(
                          (item) => item.operation !== operation,
                        ),
                        {
                          operation,
                          autonomy: e.target.value as
                            | "automatic"
                            | "ask_first"
                            | "not_allowed",
                        },
                      ])
                    }
                  >
                    <option value="not_allowed">Not allowed</option>
                    {operation !== "change_permissions" && (
                      <option value="ask_first">Asks before</option>
                    )}
                    {[
                      "read_approved_knowledge",
                      "create_internal_draft",
                      "create_task",
                    ].includes(operation) && (
                      <option value="automatic">Can do automatically</option>
                    )}
                  </select>
                </label>
              );
            })}
          </>
        )}
        {step === "memory" && (
          <>
            <label className="block space-y-2">
              Memory preference
              <select
                className="min-h-11 w-full rounded-md border bg-background p-2"
                value={content.memory}
                onChange={(e) =>
                  change(
                    "memory",
                    e.target.value as AgentAuthoringContent["memory"],
                  )
                }
              >
                <option value="none">No persistent personalization</option>
                <option value="approved_work_preferences">
                  Remember approved work preferences and context
                </option>
                <option value="approved_company_knowledge">
                  Use approved company knowledge
                </option>
              </select>
            </label>
            <p>
              These are proposed settings. Retention, correction, reset and
              deletion scope must be confirmed before publication.
            </p>
          </>
        )}
        {step === "collaboration" && (
          <p>
            No delegation is configured. Delegation remains unavailable until a
            bounded policy, cancellation and verification are qualified.
          </p>
        )}
        {step === "runtime" && (
          <>
            <p>
              A current binding does not qualify the draft's changed behavior.
              Runtime changes require fresh evaluation.
            </p>
            <label className="block space-y-2">
              Runtime selection
              <select
                className="min-h-11 w-full rounded-md border bg-background p-2"
                value={content.runtimeBindingId ?? ""}
                onChange={(e) =>
                  change("runtimeBindingId", e.target.value || null)
                }
              >
                <option value="">
                  Choose a qualified runtime before testing
                </option>
                {options.data?.runtimes.map((runtime) => (
                  <option key={runtime.id} value={runtime.id}>
                    Current agent runtime binding
                  </option>
                ))}
              </select>
            </label>
            {options.data?.runtimes.length === 0 && (
              <p>No runtime binding is available for this draft.</p>
            )}
          </>
        )}
        {step === "test" && (
          <>
            <label className="block space-y-2">
              Representative scenario
              <Textarea
                value={content.scenarios[0] ?? ""}
                maxLength={2000}
                onChange={(e) =>
                  change("scenarios", e.target.value ? [e.target.value] : [])
                }
              />
            </label>
            <p>
              No representative test has been run. Execution and independent
              result verification for this draft are not qualified yet.
            </p>
          </>
        )}
        {step === "review" && (
          <>
            <h2 className="text-lg font-semibold">Check your agent</h2>
            <dl className="space-y-2">
              <dt>Name</dt>
              <dd>{content.name || "Not set"}</dd>
              <dt>Responsibility</dt>
              <dd className="whitespace-pre-wrap">
                {content.outcome || "Not set"}
              </dd>
              <dt>Instructions</dt>
              <dd className="whitespace-pre-wrap">
                {content.instructions.responsibilities || "Not set"}
              </dd>
              <dt>Sources</dt>
              <dd>
                {content.knowledgeDocumentIds.length} approved source selections
              </dd>
              <dt>Memory</dt>
              <dd>
                {content.memory === "none"
                  ? "No persistent personalization"
                  : "Proposed approved context"}
              </dd>
              <dt>Delegation</dt>
              <dd>None</dd>
              <dt>Audience</dt>
              <dd>In-app</dd>
            </dl>
          </>
        )}
        {step === "publish" && (
          <>
            <p>
              Publish is blocked until current runtime, representative tests,
              policy mapping and human approval are qualified.
            </p>
            <Button className="min-h-11" disabled>
              Publish agent
            </Button>
          </>
        )}
        {step === "monitor" && (
          <p>
            This draft has no active version or outcomes. After qualified
            publication, monitor work and requests in the agent overview and
            Needs You.
          </p>
        )}
      </fieldset>
      {options.isError && (
        <>
          <p role="alert">
            Available owners, knowledge and runtimes could not be loaded.
          </p>
          <Button className="min-h-11" onClick={() => void options.refetch()}>
            Retry available resources
          </Button>
        </>
      )}
      {review.isPending && review.fetchStatus === "fetching" && (
        <p role="status">Checking the saved draft…</p>
      )}
      {review.isError && (
        <>
          <p role="alert">Saved draft readiness could not be checked.</p>
          <Button className="min-h-11" onClick={() => void review.refetch()}>
            Retry readiness
          </Button>
        </>
      )}
      {review.data && (
        <section aria-label="Saved draft readiness" className="space-y-2">
          <h2 className="text-lg font-semibold">Saved draft blockers</h2>
          <ul className="list-disc space-y-2 pl-5">
            {review.data.blockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
        </section>
      )}
      {saved && (
        <p role="status">Draft saved. The active agent has not changed.</p>
      )}
      {save.isError && (
        <div role="alert" className="space-y-2">
          {attempt.current ? (
            <>
              <p>
                The save was not acknowledged. Retry the same saved request
                before changing this draft.
              </p>
              <Button
                className="min-h-11"
                disabled={save.isPending}
                onClick={() => attempt.current && save.mutate(attempt.current)}
              >
                Retry the same save
              </Button>
              {save.error instanceof ApiError && save.error.status === 409 && (
                <>
                  <p>
                    The saved version may have changed. Reloading replaces your
                    unsaved edits with the saved draft.
                  </p>
                  <Button
                    className="min-h-11"
                    onClick={() =>
                      void draft.refetch().then((result) => {
                        if (alive.current && result.data && !result.isError) {
                          attempt.current = null;
                          setReceipt(result.data);
                          setContent(result.data.content);
                          save.reset();
                        }
                      })
                    }
                  >
                    Reload saved draft
                  </Button>
                </>
              )}
            </>
          ) : (
            <p>
              The draft was not saved. Check the owner, source and runtime
              selections before saving again.
            </p>
          )}
        </div>
      )}
      {discard.isError && (
        <div role="alert">
          <p>Discard was not acknowledged.</p>
          <Button className="min-h-11" onClick={() => discard.mutate()}>
            Retry the same discard
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          className="min-h-11"
          disabled={locked}
          onClick={() => persist("/agents/custom")}
        >
          Save & exit
        </Button>
        {index > 0 && (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={locked}
            onClick={() =>
              persist(
                `/agents/custom/${id}/${CUSTOM_AGENT_STEPS[index - 1]}`,
                CUSTOM_AGENT_STEPS[index - 1],
              )
            }
          >
            Back
          </Button>
        )}
        {next && (
          <Button
            className="min-h-11"
            disabled={locked}
            onClick={() => persist(`/agents/custom/${id}/${next}`, next)}
          >
            Continue
          </Button>
        )}
        <Button
          variant="outline"
          className="min-h-11"
          disabled={
            save.isPending || Boolean(attempt.current) || discard.isPending
          }
          onClick={() => discard.mutate()}
        >
          Discard draft
        </Button>
      </div>
    </div>
  );
}

export function CustomAgent() {
  const { selectedCompanyId: company } = useCompany(),
    { userId: principal } = useAccountIdentity(),
    { draftId } = useParams();
  const settings = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const enabled = Boolean(
    settings.data && v9FeatureEnabled(settings.data, "hire_agent_v9"),
  );
  if (!company || !principal)
    return (
      <p role="status">
        Choose a company and sign in with a verified account to author an agent.
      </p>
    );
  return draftId ? (
    <DraftEditor
      key={`${company}:${principal}:${draftId}`}
      company={company}
      principal={principal}
      id={draftId}
      enabled={enabled}
    />
  ) : (
    <DraftStart
      key={`${company}:${principal}`}
      company={company}
      principal={principal}
      enabled={enabled}
    />
  );
}
