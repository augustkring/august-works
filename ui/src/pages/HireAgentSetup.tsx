import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
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
import { HireDeclaredAccess } from "@/components/HireDeclaredAccess";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";

const labels = {
  hire_access: "hireSetup.stepAccess",
  hire_authority: "hireSetup.stepAuthority",
  hire_test: "hireSetup.stepTest",
  hire_review: "hireSetup.stepReview",
  hire_receipt: "hireSetup.stepReceipt",
} as const;
const operationNames: Record<
  AgentAuthoringContent["capabilities"][number]["operation"],
  string
> = {
  read_approved_knowledge: "hireSetup.readKnowledge",
  create_internal_draft: "hireSetup.createDraft",
  create_task: "hireSetup.createTask",
  external_send: "hireSetup.sendExternal",
  spend: "hireSetup.spend",
  change_permissions: "hireSetup.changePermissions",
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
  const { t } = useTranslation("experience");
  const navigate = useNavigate(),
    client = useQueryClient(),
    { screen } = useParams();
  const authority = useV9AuthoringAuthority(company, principal);
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
  const key = ["agent-authoring", company, principal, id, authority.epoch];
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const draft = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.get(company, principal, id, signal)),
    enabled: authority.readReady,
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
  const viewReady = authority.readReady && draft.isSuccess && !draft.isFetching &&
    Boolean(receipt && content) && !accessLost && !checkingAccess;
  useEffect(() => {
    if (viewReady) heading.current?.focus();
  }, [step, viewReady]);
  const options = useQuery({
    queryKey: ["agent-authoring-options", company, principal, null, authority.epoch],
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.options(company, principal, null, signal)),
    enabled: authority.readReady && draft.isSuccess && !draft.isFetching && Boolean(receipt) && !accessLost,
    retry: false,
    gcTime: 0,
  });
  const capability = useQuery({
    queryKey: ["hire-agent-capability", company, principal, id, authority.epoch],
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.hireCapability(company, principal, id, signal)),
    enabled: authority.readReady && draft.isSuccess && !draft.isFetching && receipt?.kind === "hire" && !accessLost,
    retry: false,
    gcTime: 0,
  });
  const review = useQuery({
    queryKey: ["hire-agent-review", company, principal, id, receipt?.version, authority.epoch],
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.review(company, principal, id, signal)),
    enabled:
      authority.readReady && draft.isSuccess && !draft.isFetching && Boolean(receipt?.content) &&
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
      if (checking.current || client.getQueryState(key)?.fetchStatus === "fetching")
        throw new Error("Current setup access is unresolved");
      const epoch = securityEpoch.current;
      return {
        next: await authority.write(() => agentAuthoringApi.save(
          company,
          principal,
          id,
          pending.input,
        )),
        pending,
        epoch,
      };
    },
    onSuccess: ({ next, pending, epoch }) => {
      if (!alive.current) return;
      if (checking.current || epoch !== securityEpoch.current || !authority.confirmed(next)) {
        setNotice(
          "hireSetup.accessChanged",
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
          ? "hireSetup.saveConflict"
          : error instanceof ApiError && [400, 422].includes(error.status)
            ? "hireSetup.saveRefused"
            : "hireSetup.saveUnknown",
      );
    },
  });
  function persist(destination: string, nextStep = step) {
    if (!authority.canWrite() || !receipt || !content || !enabled || checking.current) return;
    const parsed = agentAuthoringContentSchema.safeParse(content);
    if (!parsed.success) {
      setNotice(parsed.error.issues[0]?.message ?? "hireSetup.reviewFields");
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
    mutationFn: async () => {
      if (!authority.canRead() || checking.current || client.getQueryState(key)?.fetchStatus === "fetching") throw new Error("Current hiring access is unresolved");
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
      if (checking.current || epoch !== securityEpoch.current)
        throw new Error("Setup discard needs current confirmation");
      return row;
    },
    onSuccess: (row) => {
      if (alive.current && authority.confirmed(row)) navigate("/agents/hire");
    },
    onError: (error) => {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        suppress();
      else
        setNotice(
          error instanceof ApiError && error.status === 409
            ? "hireSetup.discardConflict"
            : "hireSetup.discardUnknown",
        );
    },
  });
  async function reload() {
    const epoch = securityEpoch.current;
    const result = await draft.refetch();
    if (!alive.current || !authority.canRead() || checking.current || epoch !== securityEpoch.current)
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
      <p role="alert">{t("hireSetup.unavailable")}</p>
    );
  if (checkingAccess || !authority.readReady)
    return <p role="status">{t("hireSetup.checkingAccess")}</p>;
  if (draft.isPending || draft.isFetching)
    return <p role="status">{t("hireSetup.loading")}</p>;
  if (draft.isError)
    return (
      <div role="alert">
        <p>{t("hireSetup.loadFailed")}</p>
        <Button className="min-h-11" onClick={() => void draft.refetch()}>{t("hireSetup.tryAgain")}</Button>
      </div>
    );
  if (receipt?.kind !== "hire")
    return (
      <p>{t("hireSetup.customDraft")}{" "}
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={`/agents/custom/${id}`}
        >{t("hireSetup.openCustom")}</Link>
      </p>
    );
  if (!content || !receipt.content)
    return (
      <p role="status">{t("hireSetup.discarded")}</p>
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
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/agents/hire"
      >{t("hireSetup.hire")}</Link>
      <p className="text-sm text-muted-foreground">
        {t("hireSetup.version", { version: receipt.version, packageVersion: receipt.package?.version ?? "" })}
      </p>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t(labels[step])}
      </h1>
      <p>
        {content.name} — {content.outcome}
      </p>
      <p>{t("hireSetup.unpublished")}</p>
      {!enabled && (
        <p role="status">{t("hireSetup.changesUnavailable")}</p>
      )}
      {notice && (
        <div role="alert" className="space-y-2">
          <p>{t(notice, { defaultValue: notice })}</p>
          {attempt.current && (
            <Button
              className="min-h-11"
              disabled={!enabled || save.isPending || discard.isPending}
              onClick={() => save.mutate(attempt.current!)}
            >{t("hireSetup.retrySave")}</Button>
          )}
          {((save.error instanceof ApiError && save.error.status === 409) ||
            (discard.error instanceof ApiError &&
              discard.error.status === 409)) && (
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => void reload()}
            >{t("hireSetup.reload")}</Button>
          )}
        </div>
      )}
      <nav aria-label={t("hireSetup.sections")} className="flex flex-wrap gap-2">
        {HIRE_AGENT_STEPS.map((item) => (
          <Button
            key={item}
            className="min-h-11"
            variant={item === step ? "secondary" : "ghost"}
            aria-current={item === step ? "step" : undefined}
            disabled={!enabled || frozen}
            onClick={() => persist(`/agents/hire/drafts/${id}/${item}`, item)}
          >
            {t(labels[item])}
          </Button>
        ))}
      </nav>
      {capability.isPending && (
        <p role="status">{t("hireSetup.loadingCapability")}</p>
      )}
      {capability.isError && (
        <div role="alert">
          <p>{t("hireSetup.capabilityFailed")}</p>
          <Button
            className="min-h-11"
            onClick={() => void capability.refetch()}
          >{t("hireSetup.recheckCapability")}</Button>
        </div>
      )}
      {capability.data && !capability.data.available && (
        <p role="alert">{t("hireSetup.capabilityWithdrawn")}</p>
      )}
      {step === "hire_access" && (
        <fieldset disabled={!enabled || frozen} className="space-y-4">
          <legend className="text-lg font-semibold">{t("hireSetup.confirmResponsibility")}</legend>
          <label className="block space-y-2">{t("hireSetup.responsibility")}<Textarea
              maxLength={2000}
              value={content.outcome}
              onChange={(event) =>
                setContent({ ...content, outcome: event.target.value })
              }
            />
          </label>
          <label className="block space-y-2">{t("hireSetup.name")}<Input
              className="min-h-11"
              maxLength={200}
              value={content.name}
              onChange={(event) =>
                setContent({ ...content, name: event.target.value })
              }
            />
          </label>
          <label className="block space-y-2">{t("hireSetup.owner")}<select
              className="saas-input min-h-11"
              value={content.ownerUserId}
              onChange={(event) =>
                setContent({ ...content, ownerUserId: event.target.value })
              }
            >
              <option value="">{t("hireSetup.chooseOwner")}</option>
              {options.data?.owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          {options.isPending && (
            <p role="status">{t("hireSetup.loadingOptions")}</p>
          )}
          {options.isError && (
            <p role="alert">{t("hireSetup.optionsFailed")}</p>
          )}
          {capability.data && (
            <p>{t("hireSetup.requiredKnowledge")}{" "}{" "}
              {capability.data.requiredKnowledge.join(", ") ||
                t("hireSetup.noRequiredKnowledge")}
            </p>
          )}
          <p>{t("hireSetup.selectKnowledge")}</p>
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
                {source.title}{" "}{t("hireSetup.readScope")}{" "}{source.sensitivity}
              </span>
            </label>
          ))}
          {options.isSuccess && options.data.knowledge.length === 0 && (
            <p>{t("hireSetup.noKnowledge")}</p>
          )}
          {capability.data && (
            <p>{t("hireSetup.requiredApps")}{" "}{" "}
              {capability.data.requiredConnections.join(", ") ||
                t("hireSetup.noneDeclared")}{" "}{t("hireSetup.accessUnchecked")}</p>
          )}
        </fieldset>
      )}
      {step === "hire_authority" && (
        <section className="space-y-4" aria-labelledby="hire-authority">
          <h2 id="hire-authority" className="text-lg font-semibold">{t("hireSetup.authority")}</h2>
          <p>{t("hireSetup.authorityBoundary")}</p>
          <table className="w-full text-left">
            <caption className="text-left">{t("hireSetup.requirements")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("hireSetup.capability")}</th>
                <th scope="col">{t("hireSetup.behavior")}</th>
              </tr>
            </thead>
            <tbody>
              {content.capabilities.map((item) => (
                <tr key={item.operation}>
                  <th scope="row" className="py-2">
                    {t(operationNames[item.operation])}
                  </th>
                  <td>
                    {item.autonomy === "automatic"
                      ? t("hireSetup.automatic")
                      : item.autonomy === "ask_first"
                        ? t("hireSetup.askFirst")
                        : t("hireSetup.notAllowed")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{t("hireSetup.materialApproval")}</p>
          <p>{t("hireSetup.companyApp")}</p>
          <HireDeclaredAccess
            capability={
              capability.isSuccess && !capability.isFetching
                ? capability.data
                : null
            }
          />
        </section>
      )}
      {step === "hire_test" && (
        <section className="space-y-3" aria-labelledby="hire-test">
          <h2 id="hire-test" className="text-lg font-semibold">{t("hireSetup.expectedActual")}</h2>
          <p>{t("hireSetup.expected")}{" "}{receipt.content.outcome}</p>
          <p role="status">{t("hireSetup.testUnavailable")}</p>
        </section>
      )}
      {step === "hire_review" && (
        <section className="space-y-3" aria-labelledby="hire-review">
          <h2 id="hire-review" className="text-lg font-semibold">{t("hireSetup.saved")}</h2>
          <p>{t("hireSetup.ownerLabel")}{" "}{scopeName ?? t("hireSetup.ownerUnconfirmed")}</p>
          <p>{t("hireSetup.knowledgeScope")}{" "}{" "}
            {receipt.content.knowledgeDocumentIds.length === 0
              ? t("hireSetup.noneSelected")
              : receipt.content.knowledgeDocumentIds
                  .map(
                    (source) =>
                      options.data?.knowledge.find((item) => item.id === source)
                        ?.title ?? t("hireSetup.sourceUnavailable"),
                  )
                  .join(", ")}
          </p>
          <p>{t("hireSetup.reviewAccess")}</p>
          <p>{t("hireSetup.reviewApproval")}</p>
        </section>
      )}
      {step === "hire_receipt" && (
        <section className="space-y-3" aria-labelledby="hire-receipt">
          <h2 id="hire-receipt" className="text-lg font-semibold">{t("hireSetup.noReceipt")}</h2>
          <p>{t("hireSetup.notActivated")}</p>
        </section>
      )}
      {["hire_test", "hire_review", "hire_receipt"].includes(step) && (
        <section className="space-y-2" aria-labelledby="hire-blockers">
          <h2 id="hire-blockers" className="text-lg font-semibold">{t("hireSetup.beforeStart")}</h2>
          {review.isPending && <p role="status">{t("hireSetup.checkingSetup")}</p>}
          {review.isError && (
            <p role="alert">{t("hireSetup.reviewFailed")}</p>
          )}
          {review.data && (
            <ul>
              {review.data.blockers.map((blocker) => (
                <li key={blocker.code}>{blocker.message}</li>
              ))}
            </ul>
          )}
          {review.isError && (
            <Button className="min-h-11" onClick={() => void review.refetch()}>{t("hireSetup.recheckSetup")}</Button>
          )}
        </section>
      )}
      <div className="flex items-center justify-between gap-4">
        <Button
          className="min-h-11"
          variant="outline"
          disabled={!enabled || frozen}
          onClick={() => persist("/agents/hire")}
        >{t("hireSetup.saveExit")}</Button>
        {step === "hire_review" ? (
          <Button className="min-h-11" disabled>{t("hireSetup.hire")}</Button>
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
          >{t("hireSetup.continue")}</Button>
        ) : (
          <Link
            className="inline-flex min-h-11 items-center underline"
            to="/agents/hire"
          >{t("hireSetup.back")}</Link>
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
        {discard.isError ? t("hireSetup.retryDiscard") : t("hireSetup.discard")}
      </Button>
    </div>
  );
}
