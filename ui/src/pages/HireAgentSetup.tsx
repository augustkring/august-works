import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HIRE_AGENT_STEPS,
  hireAgentStepSchema,
  agentAuthoringContentSchema,
  type AgentAuthoringContent,
  type AgentAuthoringDraftView,
  type AgentDraftSave,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { ApiError } from "@/api/client";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { Link, useNavigate, useParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const labels = {
  hire_access: "Owner & knowledge",
  hire_authority: "Authority preview",
  hire_test: "Representative test",
  hire_review: "Review setup",
  hire_receipt: "Agent receipt",
} as const;
const operationNames: Record<
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

export function HireAgentSetup({
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
    client = useQueryClient(),
    { screen } = useParams();
  const alive = useRef(true),
    heading = useRef<HTMLHeadingElement>(null);
  const securityEpoch = useRef(0),
    checking = useRef(false);
  const [checkingAccess, setCheckingAccess] = useState(false),
    [accessLost, setAccessLost] = useState(false);
  const [receipt, setReceipt] = useState<AgentAuthoringDraftView | null>(null);
  const [content, setContent] = useState<AgentAuthoringContent | null>(null);
  const [notice, setNotice] = useState("");
  const attempt = useRef<{ input: AgentDraftSave; destination: string } | null>(
    null,
  );
  const discardAttempt = useRef<{
    requestId: string;
    expectedVersion: number;
  } | null>(null);
  const key = ["agent-authoring", company, principal, id];
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const draft = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      agentAuthoringApi.get(company, principal, id, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (draft.data && !receipt && !accessLost) {
      setReceipt(draft.data);
      setContent(draft.data.content);
    }
  }, [draft.data, receipt, accessLost]);
  const parsedStep = hireAgentStepSchema.safeParse(screen ?? receipt?.step);
  const step = parsedStep.success ? parsedStep.data : "hire_access";
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const options = useQuery({
    queryKey: ["agent-authoring-options", company, principal, null],
    queryFn: ({ signal }) =>
      agentAuthoringApi.options(company, principal, null, signal),
    enabled: Boolean(receipt) && !accessLost,
    retry: false,
    gcTime: 0,
  });
  const capability = useQuery({
    queryKey: ["hire-agent-capability", company, principal, id],
    queryFn: ({ signal }) =>
      agentAuthoringApi.hireCapability(company, principal, id, signal),
    enabled: receipt?.kind === "hire" && !accessLost,
    retry: false,
    gcTime: 0,
  });
  const review = useQuery({
    queryKey: ["hire-agent-review", company, principal, id, receipt?.version],
    queryFn: ({ signal }) =>
      agentAuthoringApi.review(company, principal, id, signal),
    enabled:
      Boolean(receipt?.content) &&
      !accessLost &&
      ["hire_test", "hire_review", "hire_receipt"].includes(step),
    retry: false,
    gcTime: 0,
  });

  function suppress() {
    setAccessLost(true);
    setReceipt(null);
    setContent(null);
    attempt.current = null;
    discardAttempt.current = null;
    for (const prefix of [
      "agent-authoring",
      "agent-authoring-options",
      "hire-agent-capability",
      "hire-agent-review",
    ])
      client
        .getQueryCache()
        .findAll({ queryKey: [prefix, company, principal] })
        .forEach((query) => query.reset());
  }
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (action.startsWith("agent_package.")) {
      void capability.refetch();
      void review.refetch();
      return;
    }
    if (
      event.payload.entityType !== "company_membership" &&
      !action.startsWith("resource_membership.") &&
      !action.includes("permission") &&
      !action.includes("erased") &&
      !action.endsWith("deleted")
    )
      return;
    checking.current = true;
    setCheckingAccess(true);
    const epoch = ++securityEpoch.current;
    void draft.refetch().then(async (result) => {
      if (!alive.current || epoch !== securityEpoch.current) return;
      if (result.isError) suppress();
      else {
        await Promise.all([
          client.resetQueries({
            queryKey: ["agent-authoring-options", company, principal],
          }),
          client.resetQueries({
            queryKey: ["hire-agent-capability", company, principal, id],
          }),
          client.resetQueries({
            queryKey: ["hire-agent-review", company, principal, id],
          }),
        ]);
        if (!alive.current || epoch !== securityEpoch.current) return;
        checking.current = false;
      }
      setCheckingAccess(false);
    });
  });
  const save = useMutation({
    mutationFn: async (pending: NonNullable<typeof attempt.current>) => {
      const epoch = securityEpoch.current;
      return {
        next: await agentAuthoringApi.save(
          company,
          principal,
          id,
          pending.input,
        ),
        pending,
        epoch,
      };
    },
    onSuccess: ({ next, pending, epoch }) => {
      if (!alive.current) return;
      if (checking.current || epoch !== securityEpoch.current) {
        setNotice(
          "Access changed while this setup was saving. Recheck the same save request before continuing.",
        );
        return;
      }
      setReceipt(next);
      setContent(next.content);
      client.setQueryData(key, next);
      attempt.current = null;
      setNotice("");
      navigate(pending.destination);
    },
    onError: (error) => {
      if (!alive.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        suppress();
        return;
      }
      if (error instanceof ApiError && [400, 422].includes(error.status))
        attempt.current = null;
      setNotice(
        error instanceof ApiError && error.status === 409
          ? "The saved setup changed. Reload it before making a new change; this replaces unsaved edits."
          : error instanceof ApiError && [400, 422].includes(error.status)
            ? "This setup could not be saved. Review its owner, knowledge and current capability, then try again."
            : "The save was not acknowledged. Retry the same save to check its saved result.",
      );
    },
  });
  function persist(destination: string, nextStep = step) {
    if (!receipt || !content || !enabled || checking.current) return;
    const parsed = agentAuthoringContentSchema.safeParse(content);
    if (!parsed.success) {
      setNotice(parsed.error.issues[0]?.message ?? "Review the setup fields.");
      return;
    }
    attempt.current ??= {
      input: {
        requestId: crypto.randomUUID(),
        expectedVersion: receipt.version,
        step: nextStep,
        content: structuredClone(parsed.data),
      },
      destination,
    };
    save.mutate(attempt.current);
  }
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
      if (alive.current) navigate("/agents/hire");
    },
    onError: (error) => {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        suppress();
      else
        setNotice(
          error instanceof ApiError && error.status === 409
            ? "The saved setup changed. Reload it before discarding; this replaces unsaved edits."
            : "Discard was not acknowledged. Retry the same discard request to check its result.",
        );
    },
  });
  async function reload() {
    const epoch = securityEpoch.current;
    const result = await draft.refetch();
    if (!alive.current || checking.current || epoch !== securityEpoch.current)
      return;
    if (result.isError || !result.data) {
      suppress();
      return;
    }
    setReceipt(result.data);
    setContent(result.data.content);
    attempt.current = null;
    discardAttempt.current = null;
    setNotice("");
    save.reset();
    discard.reset();
  }
  if (accessLost)
    return (
      <p role="alert">
        This saved setup is no longer available to your current account.
      </p>
    );
  if (checkingAccess)
    return <p role="status">Checking current access to your setup…</p>;
  if (draft.isPending && !receipt)
    return <p role="status">Loading saved setup…</p>;
  if (draft.isError && !receipt)
    return (
      <div role="alert">
        <p>The setup could not be loaded. Check your current company access.</p>
        <Button className="min-h-11" onClick={() => void draft.refetch()}>
          Try again
        </Button>
      </div>
    );
  if (receipt?.kind !== "hire")
    return (
      <p>
        This is a custom agent draft.{" "}
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={`/agents/custom/${id}`}
        >
          Open custom agent draft
        </Link>
      </p>
    );
  if (!content || !receipt.content)
    return (
      <p role="status">This setup was discarded. No agent was activated.</p>
    );
  const frozen =
    Boolean(attempt.current) ||
    save.isPending ||
    discard.isPending ||
    Boolean(discardAttempt.current);
  const index = HIRE_AGENT_STEPS.indexOf(step),
    next = HIRE_AGENT_STEPS[index + 1];
  const scopeName = options.data?.owners.find(
    (owner) => owner.id === content.ownerUserId,
  )?.name;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/agents/hire"
      >
        Hire agent
      </Link>
      <p className="text-sm text-muted-foreground">
        Saved setup v{receipt.version} · {receipt.package?.version}
      </p>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {labels[step]}
      </h1>
      <p>
        {content.name} — {content.outcome}
      </p>
      <p>
        This is an unpublished setup. It has not given an agent company access
        or started work.
      </p>
      {!enabled && (
        <p role="status">
          New setup changes are unavailable. You can still read or discard this
          saved setup.
        </p>
      )}
      {notice && (
        <div role="alert" className="space-y-2">
          <p>{notice}</p>
          {attempt.current && (
            <Button
              className="min-h-11"
              disabled={!enabled || save.isPending || discard.isPending}
              onClick={() => save.mutate(attempt.current!)}
            >
              Retry the same save
            </Button>
          )}
          {((save.error instanceof ApiError && save.error.status === 409) ||
            (discard.error instanceof ApiError &&
              discard.error.status === 409)) && (
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => void reload()}
            >
              Reload saved setup — replaces unsaved edits
            </Button>
          )}
        </div>
      )}
      <nav aria-label="Agent setup sections" className="flex flex-wrap gap-2">
        {HIRE_AGENT_STEPS.map((item) => (
          <Button
            key={item}
            className="min-h-11"
            variant={item === step ? "secondary" : "ghost"}
            aria-current={item === step ? "step" : undefined}
            disabled={!enabled || frozen}
            onClick={() => persist(`/agents/hire/drafts/${id}/${item}`, item)}
          >
            {labels[item]}
          </Button>
        ))}
      </nav>
      {capability.isPending && (
        <p role="status">Loading the selected capability…</p>
      )}
      {capability.isError && (
        <div role="alert">
          <p>The selected capability could not be checked.</p>
          <Button
            className="min-h-11"
            onClick={() => void capability.refetch()}
          >
            Check capability again
          </Button>
        </div>
      )}
      {capability.data && !capability.data.available && (
        <p role="alert">
          This capability version is no longer available for new setup changes.
          Your saved setup remains readable.
        </p>
      )}
      {step === "hire_access" && (
        <fieldset disabled={!enabled || frozen} className="space-y-4">
          <legend className="text-lg font-semibold">
            Confirm responsibility and knowledge
          </legend>
          <label className="block space-y-2">
            Responsibility
            <Textarea
              maxLength={2000}
              value={content.outcome}
              onChange={(event) =>
                setContent({ ...content, outcome: event.target.value })
              }
            />
          </label>
          <label className="block space-y-2">
            Agent name
            <Input
              className="min-h-11"
              maxLength={200}
              value={content.name}
              onChange={(event) =>
                setContent({ ...content, name: event.target.value })
              }
            />
          </label>
          <label className="block space-y-2">
            Accountable owner
            <select
              className="saas-input min-h-11"
              value={content.ownerUserId}
              onChange={(event) =>
                setContent({ ...content, ownerUserId: event.target.value })
              }
            >
              <option value="">Choose a current company member</option>
              {options.data?.owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          {options.isPending && (
            <p role="status">
              Loading available owners and approved knowledge…
            </p>
          )}
          {options.isError && (
            <p role="alert">
              Owners and approved knowledge could not be loaded. Try again
              before continuing.
            </p>
          )}
          {capability.data && (
            <p>
              Required knowledge:{" "}
              {capability.data.requiredKnowledge.join(", ") ||
                "No required sources declared."}
            </p>
          )}
          <p>Select only approved knowledge needed for this responsibility.</p>
          {options.data?.knowledge.map((source) => (
            <label key={source.id} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={content.knowledgeDocumentIds.includes(source.id)}
                onChange={(event) =>
                  setContent({
                    ...content,
                    knowledgeDocumentIds: event.target.checked
                      ? [...content.knowledgeDocumentIds, source.id]
                      : content.knowledgeDocumentIds.filter(
                          (value) => value !== source.id,
                        ),
                  })
                }
              />
              <span>
                {source.title} · Read scope · {source.sensitivity}
              </span>
            </label>
          ))}
          {options.isSuccess && options.data.knowledge.length === 0 && (
            <p>No approved knowledge sources are available to your account.</p>
          )}
          {capability.data && (
            <p>
              Required connected apps:{" "}
              {capability.data.requiredConnections.join(", ") ||
                "None declared."}{" "}
              Access has not yet been assessed for this setup.
            </p>
          )}
        </fieldset>
      )}
      {step === "hire_authority" && (
        <section className="space-y-4" aria-labelledby="hire-authority">
          <h2 id="hire-authority" className="text-lg font-semibold">
            Proposed authority
          </h2>
          <p>
            These are the selected capability's declared limits. Current company
            policy and access must also allow any action before use.
          </p>
          <table className="w-full text-left">
            <caption className="text-left">
              Capability and approval requirements
            </caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Behavior</th>
              </tr>
            </thead>
            <tbody>
              {content.capabilities.map((item) => (
                <tr key={item.operation}>
                  <th scope="row" className="py-2">
                    {operationNames[item.operation]}
                  </th>
                  <td>
                    {item.autonomy === "automatic"
                      ? "Automatic when authorized"
                      : item.autonomy === "ask_first"
                        ? "Ask first"
                        : "Not allowed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Permission changes are never self-granted. External sends and
            spending are unavailable unless declared above, and always require
            approval.
          </p>
          <p>
            Works in the company app. No external delivery channel has been
            selected.
          </p>
        </section>
      )}
      {step === "hire_test" && (
        <section className="space-y-3" aria-labelledby="hire-test">
          <h2 id="hire-test" className="text-lg font-semibold">
            Expected and actual outcome
          </h2>
          <p>Expected: {receipt.content.outcome}</p>
          <p role="status">
            Testing is unavailable for this setup. No representative result has
            been produced or verified.
          </p>
        </section>
      )}
      {step === "hire_review" && (
        <section className="space-y-3" aria-labelledby="hire-review">
          <h2 id="hire-review" className="text-lg font-semibold">
            Saved setup
          </h2>
          <p>Owner: {scopeName ?? "Current owner could not be confirmed"}</p>
          <p>
            Knowledge scope:{" "}
            {receipt.content.knowledgeDocumentIds.length === 0
              ? "No knowledge selected"
              : receipt.content.knowledgeDocumentIds
                  .map(
                    (source) =>
                      options.data?.knowledge.find((item) => item.id === source)
                        ?.title ?? "Source unavailable",
                  )
                  .join(", ")}
          </p>
          <p>
            App/data access has not been assessed. Company app only; no external
            audience selected.
          </p>
          <p>
            Human approval is required before material actions. No agent access
            has been granted.
          </p>
        </section>
      )}
      {step === "hire_receipt" && (
        <section className="space-y-3" aria-labelledby="hire-receipt">
          <h2 id="hire-receipt" className="text-lg font-semibold">
            No active agent receipt
          </h2>
          <p>No agent has been activated. This remains a saved setup.</p>
        </section>
      )}
      {["hire_test", "hire_review", "hire_receipt"].includes(step) && (
        <section className="space-y-2" aria-labelledby="hire-blockers">
          <h2 id="hire-blockers" className="text-lg font-semibold">
            Before this agent can start
          </h2>
          {review.isPending && <p role="status">Checking the saved setup…</p>}
          {review.isError && (
            <p role="alert">The saved setup could not be checked. Try again.</p>
          )}
          {review.data && (
            <ul>
              {review.data.blockers.map((blocker) => (
                <li key={blocker.code}>{blocker.message}</li>
              ))}
            </ul>
          )}
          {review.isError && (
            <Button className="min-h-11" onClick={() => void review.refetch()}>
              Check setup again
            </Button>
          )}
        </section>
      )}
      <div className="flex items-center justify-between gap-4">
        <Button
          className="min-h-11"
          variant="outline"
          disabled={!enabled || frozen}
          onClick={() => persist("/agents/hire")}
        >
          Save & exit
        </Button>
        {step === "hire_review" ? (
          <Button className="min-h-11" disabled>
            Hire agent
          </Button>
        ) : next ? (
          <Button
            className="min-h-11"
            disabled={
              !enabled ||
              frozen ||
              capability.data?.available !== true ||
              options.isError ||
              options.isPending ||
              step === "hire_test"
            }
            onClick={() => persist(`/agents/hire/drafts/${id}/${next}`, next)}
          >
            Continue
          </Button>
        ) : (
          <Link
            className="inline-flex min-h-11 items-center underline"
            to="/agents/hire"
          >
            Back to agents
          </Link>
        )}
      </div>
      <Button
        className="min-h-11"
        variant="outline"
        disabled={
          save.isPending || Boolean(attempt.current) || discard.isPending
        }
        onClick={() => discard.mutate()}
      >
        {discard.isError ? "Retry the same discard" : "Discard setup"}
      </Button>
    </main>
  );
}
