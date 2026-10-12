import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { agentAuthoringBlockerKey } from "@/lib/agent-authoring-copy";
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
import { useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { Link, useNavigate, useParams, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentDraftPreparation } from "@/components/AgentDraftPreparation";
import { AgentDraftRuntime } from "@/components/AgentDraftRuntime";
import { AgentDraftPublication } from "@/components/AgentDraftPublication";
import { AgentDraftSafeTest } from "@/components/AgentDraftSafeTest";
import { AgentDraftReview } from "@/components/AgentDraftReview";

const labels: Record<(typeof CUSTOM_AGENT_STEPS)[number], string> = {
  outcome: "customAgent.stepOutcome",
  identity: "customAgent.stepIdentity",
  instructions: "customAgent.stepInstructions",
  knowledge: "customAgent.stepKnowledge",
  tools: "customAgent.stepTools",
  authority: "customAgent.stepAuthority",
  memory: "customAgent.stepMemory",
  collaboration: "customAgent.stepCollaboration",
  runtime: "customAgent.stepRuntime",
  test: "customAgent.stepTest",
  review: "customAgent.stepReview",
  publish: "customAgent.stepPublish",
  monitor: "customAgent.stepMonitor",
};
const operationLabels: Record<
  AgentAuthoringContent["capabilities"][number]["operation"],
  string
> = {
  read_approved_knowledge: "customAgent.readKnowledge",
  create_internal_draft: "customAgent.createInternalDrafts",
  create_task: "customAgent.createTasks",
  external_send: "customAgent.sendExternally",
  spend: "customAgent.spendMoney",
  change_permissions: "customAgent.changePermissions",
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
  const { t } = useTranslation("experience");
  const navigate = useNavigate(),
    [search] = useSearchParams(),
    alive = useRef(true);
  const attempt = useRef<{ requestId: string; agentId: string | null } | null>(
    null,
  );
  const client = useQueryClient();
  const authority = useV9AuthoringAuthority(company, principal);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const securityEpoch = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const drafts = useInfiniteQuery({
    queryKey: ["agent-authoring", company, principal, "list", authority.epoch],
    queryFn: ({ signal, pageParam }) =>
      authority.read(() => agentAuthoringApi.list(
        company,
        principal,
        signal,
        pageParam ?? undefined,
      )),
    enabled: authority.readReady,
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
          queryKey: ["agent-authoring", company, principal, "list", authority.epoch],
          exact: true,
        })
        .then(() => {
          if (alive.current && epoch === securityEpoch.current)
            setCheckingAccess(false);
        });
    }
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!authority.canWrite() || client.getQueryState([
        "agent-authoring", company, principal, "list", authority.epoch,
      ])?.fetchStatus === "fetching") throw new Error("Current authoring access is unresolved");
      attempt.current ??= {
        requestId: crypto.randomUUID(),
        agentId: search.get("agentId"),
      };
      const epoch = securityEpoch.current;
      const pending = attempt.current;
      const draft = await authority.write(() => agentAuthoringApi.create(company, principal, pending));
      if (epoch !== securityEpoch.current) throw new Error("Draft creation needs current confirmation");
      return draft;
    },
    onSuccess: (draft) => {
      if (alive.current && authority.confirmed(draft)) navigate(draft.kind === "hire" ? `/agents/hire/drafts/${draft.id}/${draft.step}` : `/agents/custom/${draft.id}/${draft.step}`);
    },
  });
  if (!authority.readReady) return <p role={authority.failed ? "alert" : "status"}>{t("customAgent.checkingSavedAccess")}</p>;
  if (drafts.isFetching && !drafts.isFetchingNextPage) return <p role="status">{t("customAgent.loadingDrafts")}</p>;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        to="/advanced"
        className="inline-flex min-h-11 items-center underline"
      >{t("customAgent.advanced")}</Link>
      <h1 className="text-2xl font-semibold">{t("customAgent.title")}</h1>
      <p>{t("customAgent.intro")}</p>
      <p className="text-muted-foreground">{t("customAgent.draftBoundary")}</p>
      {enabled ? (
        <Button
          className="min-h-11"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending
            ? t("customAgent.creating")
            : create.isError
              ? t("customAgent.retryCreate")
              : search.get("agentId")
                ? t("customAgent.createRevision")
                : t("customAgent.startDraft")}
        </Button>
      ) : (
        <p role="status">{t("customAgent.newUnavailable")}</p>
      )}
      {create.isError && (
        <p role="alert">{t("customAgent.createUnknown")}</p>
      )}
      <section aria-labelledby="saved-drafts">
        <h2 id="saved-drafts" className="text-lg font-semibold">{t("customAgent.savedDrafts")}</h2>
        {(drafts.isPending || checkingAccess) && (
          <p role="status">{t("customAgent.loadingDrafts")}</p>
        )}
        {drafts.isError && (
          <>
            <p role="alert">{t("customAgent.draftsLoadFailed")}</p>
            <Button className="min-h-11" onClick={() => void drafts.refetch()}>{t("customAgent.tryAgain")}</Button>
          </>
        )}
        {!checkingAccess &&
          drafts.data?.pages[0]?.items.length === 0 &&
          !drafts.hasNextPage && <p>{t("customAgent.noDrafts")}</p>}
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
                    {t("customAgent.savedVersion", { name: draft.name || t("customAgent.untitled"), version: draft.version })}
                  </Link>
                </li>
              ))}
        </ul>
        {!checkingAccess && drafts.hasNextPage && (
          <Button
            className="min-h-11"
            disabled={drafts.isFetchingNextPage}
            onClick={() => void drafts.fetchNextPage()}
          >{t("customAgent.loadOlder")}</Button>
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
  const { t } = useTranslation("experience");
  const navigate = useNavigate(),
    { screen } = useParams(),
    client = useQueryClient();
  const scenarioFieldId = useId();
  const authority = useV9AuthoringAuthority(company, principal);
  const parsed = customAgentStepSchema.safeParse(screen),
    step = parsed.success ? parsed.data : "outcome";
  const alive = useRef(true),
    heading = useRef<HTMLHeadingElement>(null),
    securityPending = useRef(false),
    securityEpoch = useRef(0);
  const [content, setContent] = useState<AgentAuthoringContent | null>(null),
    [receipt, setReceipt] = useState<AgentAuthoringDraftView | null>(null);
  const [validationFields, setValidationFields] = useState<string[]>([]);
  const validationSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (validationFields.length > 0) validationSummary.current?.focus();
  }, [validationFields]);
  function validationProps(key: string) {
    const invalid = validationFields.includes(key) || validationFields.includes("customAgent.draftDetails");
    return { "aria-invalid": invalid || undefined, "aria-describedby": invalid ? "custom-agent-validation" : undefined };
  }
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
  const draft = useQuery({
    queryKey: ["agent-authoring", company, principal, id, authority.epoch],
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.get(company, principal, id, signal)),
    enabled: authority.readReady,
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
        event.payload.entityId === (receipt?.agentId ?? receipt?.preparation?.agentId)
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
            queryKey: ["agent-authoring", company, principal, id, authority.epoch],
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
  const viewReady = authority.readReady && draft.isSuccess && !draft.isFetching &&
    Boolean(receipt && content) && !accessLost && !reauthorizing;
  useEffect(() => {
    if (viewReady) heading.current?.focus();
  }, [step, viewReady]);
  const options = useQuery({
    queryKey: [
      "agent-authoring-options",
      company,
      principal,
      receipt?.agentId ?? receipt?.preparation?.agentId ?? null,
      authority.epoch,
    ],
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.options(
        company,
        principal,
        receipt?.agentId ?? receipt?.preparation?.agentId ?? null,
        signal,
      )),
    enabled: authority.readReady && draft.isSuccess && !draft.isFetching && Boolean(receipt),
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
      authority.epoch,
    ],
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.review(company, principal, id, signal)),
    enabled: Boolean(
      authority.readReady && draft.isSuccess && !draft.isFetching && receipt?.content &&
        ["test", "review", "publish", "monitor"].includes(step),
    ),
    gcTime: 0,
    retry: false,
  });
  const save = useMutation({
    mutationFn: async (pending: NonNullable<typeof attempt.current>) => {
      if (securityPending.current || client.getQueryState([
        "agent-authoring", company, principal, id, authority.epoch,
      ])?.fetchStatus === "fetching") throw new Error("Current draft access is unresolved");
      const epoch = securityEpoch.current;
      const row = await authority.write(() => agentAuthoringApi.save(company, principal, id, pending.input));
      if (securityPending.current || epoch !== securityEpoch.current)
        throw new Error("Draft save needs current confirmation");
      return row;
    },
    onSuccess: (row, pending) => {
      if (!alive.current || securityPending.current || !authority.confirmed(row)) return;
      attempt.current = null;
      setReceipt(row);
      setContent(row.content);
      setSaved(true);
      client.setQueryData(["agent-authoring", company, principal, id, authority.epoch], row);
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
    mutationFn: async () => {
      if (!authority.canRead() || securityPending.current || client.getQueryState([
        "agent-authoring", company, principal, id, authority.epoch,
      ])?.fetchStatus === "fetching") throw new Error("Current authoring access is unresolved");
      discardAttempt.current ??= {
        requestId: crypto.randomUUID(),
        expectedVersion: receipt!.version,
      };
      const pending = discardAttempt.current, epoch = securityEpoch.current;
      const row = await authority.discard(() => agentAuthoringApi.discard(
        company,
        principal,
        id,
        pending,
      ));
      if (securityPending.current || epoch !== securityEpoch.current)
        throw new Error("Draft discard needs current confirmation");
      return row;
    },
    onSuccess: (row) => {
      if (alive.current && authority.confirmed(row)) navigate("/agents/custom");
    },
    onError: (error) => {
      if (alive.current && error instanceof ApiError && [401, 403].includes(error.status)) {
        setAccessLost(true); setContent(null); setReceipt(null);
      }
    },
  });
  function persist(destination: string, nextStep = step) {
    if (!authority.canWrite() || securityPending.current || !content || !receipt) return;
    const parsed = agentAuthoringContentSchema.safeParse(structuredClone(content));
    if (!parsed.success) {
      const fields: Record<string, string> = {
        outcome: "customAgent.responsibility", ownerUserId: "customAgent.accountableOwner",
        name: "customAgent.agentName", description: "customAgent.customerDescription",
        internalDescription: "customAgent.internalDescription", instructions: "customAgent.stepInstructions",
        knowledgeDocumentIds: "customAgent.sources", capabilities: "customAgent.stepAuthority",
        memory: "customAgent.stepMemory", collaboration: "customAgent.stepCollaboration",
        runtimeBindingId: "customAgent.runtimeSelection", scenarios: "customAgent.scenario",
      };
      setValidationFields([...new Set(parsed.error.issues.map((issue) =>
        fields[String(issue.path[0])] ?? "customAgent.draftDetails"))]);
      return;
    }
    setValidationFields([]);
    attempt.current ??= {
      input: {
        requestId: crypto.randomUUID(),
        expectedVersion: receipt.version,
        step: nextStep,
        content: parsed.data,
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
    setValidationFields([]);
  }
  const locked =
    !enabled || !authority.writeReady ||
    save.isPending ||
    Boolean(attempt.current) ||
    discard.isPending ||
    Boolean(discardAttempt.current);
  if (accessLost)
    return (
      <div className="space-y-4 p-6">
        <p role="alert">{t("customAgent.accessChanged")}</p>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/agents/custom"
        >{t("customAgent.yourDrafts")}</Link>
      </div>
    );
  if (reauthorizing || !authority.readReady)
    return <p role="status">{t("customAgent.checkingDraftAccess")}</p>;
  if (draft.isPending || draft.isFetching)
    return <p role="status">{t("customAgent.loadingDraft")}</p>;
  if (draft.isError)
    return (
      <div className="space-y-4 p-6">
        <p role="alert">{t("customAgent.loadFailed")}</p>
        <Button className="min-h-11" onClick={() => void draft.refetch()}>{t("customAgent.tryAgain")}</Button>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/agents/custom"
        >{t("customAgent.yourDrafts")}</Link>
      </div>
    );
  if (receipt?.kind === "hire") return <p>{t("customAgent.hireSetup")} {" "}<Link className="inline-flex min-h-11 items-center underline" to={`/agents/hire/drafts/${receipt.id}/${receipt.step}`}>{t("customAgent.openSavedSetup")}</Link></p>;
  if (!receipt?.content || !content)
    return (
      <div className="space-y-4 p-6">
        <h1>{t("customAgent.discarded")}</h1>
        <p>{t("customAgent.contentRemoved")}</p>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/agents/custom"
        >{t("customAgent.yourDrafts")}</Link>
      </div>
    );
  const index = CUSTOM_AGENT_STEPS.indexOf(step),
    next = CUSTOM_AGENT_STEPS[index + 1];
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/agents/custom"
      >{t("customAgent.yourDrafts")}</Link>
      <p className="text-sm text-muted-foreground">
        {t("customAgent.progress", { version: receipt.version, step: index + 1, total: CUSTOM_AGENT_STEPS.length })}
      </p>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t(labels[step])}
      </h1>
      <p>{t("customAgent.untilPublication")}</p>
      {!enabled && (
        <p role="status">{t("customAgent.unavailable")}</p>
      )}
      {receipt.agentId && (
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={`/agents/${receipt.agentId}`}
        >{t("customAgent.currentAgent")}</Link>
      )}
      <nav
        aria-label={t("customAgent.sections")}
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
            {t(labels[item])}
          </Button>
        ))}
      </nav>
      <fieldset disabled={locked} className="space-y-4">
        {step === "outcome" && (
          <>
            <label className="block space-y-2">{t("customAgent.responsibilityQuestion")}<Textarea
                {...validationProps("customAgent.responsibility")}
                value={content.outcome}
                maxLength={2000}
                onChange={(e) => change("outcome", e.target.value)}
              />
            </label>
            <label className="block space-y-2">{t("customAgent.accountableOwner")}<select
                className="min-h-11 w-full rounded-md border bg-background p-2"
                {...validationProps("customAgent.accountableOwner")}
                value={content.ownerUserId}
                onChange={(e) => change("ownerUserId", e.target.value)}
              >
                <option value="">{t("customAgent.chooseOwner")}</option>
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
                    ? t("customAgent.agentName")
                    : key === "description"
                      ? t("customAgent.customerDescription")
                      : t("customAgent.internalDescription")}
                  <Input
                    className="min-h-11"
                    {...validationProps(key === "name" ? "customAgent.agentName" : key === "description" ? "customAgent.customerDescription" : "customAgent.internalDescription")}
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
                    purpose: t("customAgent.purpose"),
                    responsibilities: t("customAgent.responsibilities"),
                    prohibited: t("customAgent.prohibited"),
                    missingInformation:
                      t("customAgent.missingInformation"),
                    escalation: t("customAgent.escalation"),
                    communication: t("customAgent.communication"),
                  }[key]
                }
                <Textarea
                  {...validationProps("customAgent.stepInstructions")}
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
            <p>{t("customAgent.sourceBoundary")}</p>
            {options.data?.knowledge.length === 0 && (
              <p>{t("customAgent.noSources")}</p>
            )}
            {options.data?.knowledge.map((source) => (
              <label
                key={source.id}
                className="flex min-h-11 items-center gap-3"
              >
                <input
                  type="checkbox"
                  {...validationProps("customAgent.sources")}
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
                {t("customAgent.sourceVersion", { title: source.title, sensitivity: source.sensitivity })}
              </label>
            ))}
            <Link
              className="inline-flex min-h-11 items-center underline"
              to="/foundation"
            >{t("customAgent.reviewKnowledge")}</Link>
          </>
        )}
        {(step === "tools" || step === "authority") && (
          <>
            <p>{t("customAgent.capabilityBoundary")}</p>
            {Object.entries(operationLabels).map(([raw, label]) => {
              const operation = raw as keyof typeof operationLabels,
                selected =
                  content.capabilities.find(
                    (item) => item.operation === operation,
                  )?.autonomy ?? "not_allowed";
              return (
                <label key={operation} className="block space-y-2">
                  {t(label)}
                  <select
                    className="min-h-11 w-full rounded-md border bg-background p-2"
                    {...validationProps("customAgent.stepAuthority")}
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
                    <option value="not_allowed">{t("customAgent.notAllowed")}</option>
                    {operation !== "change_permissions" && (
                      <option value="ask_first">{t("customAgent.asksBefore")}</option>
                    )}
                    {[
                      "read_approved_knowledge",
                      "create_internal_draft",
                      "create_task",
                    ].includes(operation) && (
                      <option value="automatic">{t("customAgent.automatic")}</option>
                    )}
                  </select>
                </label>
              );
            })}
          </>
        )}
        {step === "memory" && (
          <>
            <label className="block space-y-2">{t("customAgent.memoryPreference")}<select
                className="min-h-11 w-full rounded-md border bg-background p-2"
                {...validationProps("customAgent.stepMemory")}
                value={content.memory}
                onChange={(e) =>
                  change(
                    "memory",
                    e.target.value as AgentAuthoringContent["memory"],
                  )
                }
              >
                <option value="none">{t("customAgent.noPersonalization")}</option>
                <option value="approved_work_preferences">{t("customAgent.rememberPreferences")}</option>
                <option value="approved_company_knowledge">{t("customAgent.companyKnowledge")}</option>
              </select>
            </label>
            <p>{t("customAgent.memoryBoundary")}</p>
          </>
        )}
        {step === "collaboration" && (
          <p>{t("customAgent.delegationBoundary")}</p>
        )}
        {step === "runtime" && (
          <>
            <AgentDraftPreparation key={`${receipt.id}:${receipt.version}`} company={company} principal={principal} draft={receipt}
              enabled={viewReady && enabled && !save.isPending && !discard.isPending && JSON.stringify(content) === JSON.stringify(receipt.content)}
              canUseAuthority={() => alive.current && authority.canRead() && !securityPending.current && !reauthorizing &&
                client.getQueryState(["agent-authoring", company, principal, id, authority.epoch])?.fetchStatus === "idle"}
              onConfirmed={value => { if (!alive.current || !authority.canRead() || securityPending.current) return;
                client.setQueryData(["agent-authoring", company, principal, id, authority.epoch], value); setReceipt(value); setContent(value.content); }} />
            <AgentDraftRuntime company={company} principal={principal} draft={receipt} enabled={viewReady}
              selectedRuntimeBindingId={content.runtimeBindingId} selectionEnabled={!locked}
              onSelectRuntime={bindingId => {
                if (!viewReady || locked || !authority.canWrite() || securityPending.current ||
                  client.getQueryState(["agent-authoring", company, principal, id, authority.epoch])?.fetchStatus !== "idle") return;
                change("runtimeBindingId", bindingId);
              }}
              canUseAuthority={() => alive.current && authority.canRead() && !securityPending.current && !reauthorizing} />
            <p>{t("customAgent.runtimeBoundary")}</p>
            <label className="block space-y-2">{t("customAgent.runtimeSelection")}<select
                className="min-h-11 w-full rounded-md border bg-background p-2"
                {...validationProps("customAgent.runtimeSelection")}
                value={content.runtimeBindingId ?? ""}
                onChange={(e) =>
                  change("runtimeBindingId", e.target.value || null)
                }
              >
                <option value="">{t("customAgent.chooseRuntime")}</option>
                {options.data?.runtimes.map((runtime) => (
                  <option key={runtime.id} value={runtime.id}>{t("customAgent.currentRuntime")}</option>
                ))}
              </select>
            </label>
            {options.data?.runtimes.length === 0 && (
              <p>{t("customAgent.noRuntime")}</p>
            )}
          </>
        )}
        {step === "test" && (
          <>
            {(content.scenarios.length ? content.scenarios : [""]).map((scenario, index) => (
              <div key={index} className="space-y-2">
                <label className="block" htmlFor={`${scenarioFieldId}-${index}`}>
                  {index === 0 ? t("customAgent.scenario") : t("agentDraftReview.scenarioNumber", { number: index + 1 })}
                </label>
                  <Textarea id={`${scenarioFieldId}-${index}`} {...validationProps("customAgent.scenario")} value={scenario} maxLength={2000}
                    onChange={event => {
                      const scenarios = [...content.scenarios];
                      scenarios[index] = event.target.value;
                      change("scenarios", scenarios.length === 1 && !scenarios[0] ? [] : scenarios);
                    }} />
                {content.scenarios.length > 1 && <Button className="min-h-11" variant="outline" type="button"
                  onClick={() => change("scenarios", content.scenarios.filter((_, position) => position !== index))}>
                  {t("agentDraftReview.removeScenario", { number: index + 1 })}
                </Button>}
              </div>
            ))}
            <Button className="min-h-11" variant="outline" type="button" disabled={content.scenarios.length >= 10}
              onClick={() => change("scenarios", [...(content.scenarios.length ? content.scenarios : [""]), ""])}>
              {t("agentDraftReview.addScenario")}
            </Button>
            <AgentDraftSafeTest key={`test:${receipt.id}:${receipt.version}`} company={company} principal={principal} draft={receipt}
              enabled={viewReady && enabled && !save.isPending && !discard.isPending && JSON.stringify(content) === JSON.stringify(receipt.content)}
              canUseAuthority={() => alive.current && authority.canRead() && !securityPending.current && !reauthorizing &&
                client.getQueryState(["agent-authoring", company, principal, id, authority.epoch])?.fetchStatus === "idle"} />
          </>
        )}
        {step === "review" && (
          <>
            <h2 className="text-lg font-semibold">{t("customAgent.checkAgent")}</h2>
            <AgentDraftReview draft={receipt} options={options.isSuccess && !options.isFetching ? options.data : null}
              unsavedChanges={JSON.stringify(content) !== JSON.stringify(receipt.content)}
              baselineCurrent={review.isSuccess && !review.isFetching && review.data.version === receipt.version ? review.data.baselineCurrent : null} />
          </>
        )}
        {step === "publish" && (
          <>
            <AgentDraftPublication key={`publication:${receipt.id}`} company={company} principal={principal} draft={receipt}
              options={options.isSuccess && !options.isFetching ? options.data : null}
              enabled={viewReady && enabled && !save.isPending && !discard.isPending && JSON.stringify(content) === JSON.stringify(receipt.content)}
              canUseAuthority={() => alive.current && authority.canRead() && !securityPending.current && !reauthorizing &&
                client.getQueryState(["agent-authoring", company, principal, id, authority.epoch])?.fetchStatus === "idle"} />
          </>
        )}
        {step === "monitor" && (
          <p>{t("customAgent.monitorBoundary")}</p>
        )}
      </fieldset>
      {options.isError && (
        <>
          <p role="alert">{t("customAgent.resourcesFailed")}</p>
          <Button className="min-h-11" onClick={() => void options.refetch()}>{t("customAgent.retryResources")}</Button>
        </>
      )}
      {review.isPending && review.fetchStatus === "fetching" && (
        <p role="status">{t("customAgent.checkingSaved")}</p>
      )}
      {review.isError && (
        <>
          <p role="alert">{t("customAgent.readinessFailed")}</p>
          <Button className="min-h-11" onClick={() => void review.refetch()}>{t("customAgent.retryReadiness")}</Button>
        </>
      )}
      {review.data && (
        <section aria-label={t("customAgent.readiness")} className="space-y-2">
          <h2 className="text-lg font-semibold">{t("customAgent.blockers")}</h2>
          {review.data.test.status === "qualified" ? <p role="status">{t("agentSafeTest.allScenariosVerified")}</p> : null}
          <ul className="list-disc space-y-2 pl-5">
            {review.data.blockers.map((blocker) => (
              <li key={blocker.code}>{t(agentAuthoringBlockerKey(blocker.code))}</li>
            ))}
          </ul>
        </section>
      )}
      {validationFields.length > 0 && (
        <p id="custom-agent-validation" ref={validationSummary} tabIndex={-1} role="alert">{t("customAgent.invalidFields", { fields: validationFields.map((key) => t(key)).join(", ") })}</p>
      )}
      {saved && (
        <p role="status">{t("customAgent.saved")}</p>
      )}
      {save.isError && (
        <div role="alert" className="space-y-2">
          {attempt.current ? (
            <>
              <p>{t("customAgent.saveUnknown")}</p>
              <Button
                className="min-h-11"
                disabled={save.isPending}
                onClick={() => attempt.current && save.mutate(attempt.current)}
              >{t("customAgent.retrySave")}</Button>
              {save.error instanceof ApiError && save.error.status === 409 && (
                <>
                  <p>{t("customAgent.reloadWarning")}</p>
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
                  >{t("customAgent.reload")}</Button>
                </>
              )}
            </>
          ) : (
            <p>{t("customAgent.saveFailed")}</p>
          )}
        </div>
      )}
      {discard.isError && (
        <div role="alert">
          <p>{t("customAgent.discardUnknown")}</p>
          <Button className="min-h-11" onClick={() => discard.mutate()}>{t("customAgent.retryDiscard")}</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11"
          disabled={locked}
          onClick={() => persist("/agents/custom")}
        >{t("customAgent.saveExit")}</Button>
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
          >{t("customAgent.back")}</Button>
        )}
        <Button
          variant="outline"
          className="min-h-11"
          disabled={
            !authority.readReady || save.isPending || Boolean(attempt.current) || discard.isPending
          }
          onClick={() => discard.mutate()}
        >{t("customAgent.discard")}</Button>
        </div>
        {next && (
          <Button
            className="min-h-11"
            disabled={locked}
            onClick={() => persist(`/agents/custom/${id}/${next}`, next)}
          >{t("customAgent.continue")}</Button>
        )}
      </div>
    </div>
  );
}

export function CustomAgent() {
  const { t } = useTranslation("experience");
  const { selectedCompanyId: company } = useCompany(),
    { userId: principal } = useV9CurrentAccount(),
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
      <p role="status">{t("customAgent.accountRequired")}</p>
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
