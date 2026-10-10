import { useEffect, useRef, useState } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "../lib/router";
import { useAccountIdentity } from "../api/companies-query";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { ExperienceReadError } from "../components/ExperienceReadError";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import {
  customerFeedbackApi,
  isRejectedFeedbackRequest,
} from "../api/customer-feedback";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import type { CustomerFeedback } from "@paperclipai/shared";
function Response({
  item,
  companyId,
  principal,
  active,
  id,
}: {
  item: CustomerFeedback | null;
  companyId: string;
  principal: string;
  active: boolean;
  id: string;
}) {
  const { t } = useTranslation("experience"),
    client = useQueryClient();
  const [body, setBody] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID());
  const attempted = useRef<{
    body: string;
    expectedVersion: number;
    idempotencyKey: string;
  } | null>(null);
  const send = useMutation({
    mutationKey: ["customer-feedback", companyId, principal, id, "reply"],
    gcTime: 0,
    mutationFn: () => {
      if (!active || !item) throw new Error("Feedback context changed");
      attempted.current ??= {
        body,
        expectedVersion: item.version,
        idempotencyKey: key,
      };
      return customerFeedbackApi.followUp(
        companyId,
        principal,
        item.id,
        attempted.current,
      );
    },
    retry: false,
    onError: (error) => {
      if (isRejectedFeedbackRequest(error)) {
        attempted.current = null;
        setKey(crypto.randomUUID());
        void client.invalidateQueries({
          queryKey: ["customer-feedback", companyId, principal],
        });
      }
    },
    onSuccess: () => {
      attempted.current = null;
      setBody("");
      setKey(crypto.randomUUID());
      void client.invalidateQueries({
        queryKey: ["customer-feedback", companyId, principal],
      });
    },
  });
  const error = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (
      send.isError &&
      active &&
      !document.activeElement?.closest('[role="dialog"]')
    )
      error.current?.focus();
  }, [send.isError, active]);
  // Keep the original request in this scoped component during read rechecks,
  // without retaining its private text in the DOM. A changed native status
  // may acknowledge that it applied; replay still uses the exact original key.
  if (!active || !item || (item.status !== "NEEDS_INFO" && !attempted.current))
    return null;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <label className="block space-y-2">
        <span>{t("feedback.response")}</span>
        <Textarea
          maxLength={10000}
          required
          disabled={send.isPending || !!attempted.current}
          value={body}
          onChange={(event) => {
            if (attempted.current) return;
            attempted.current = null;
            setBody(event.target.value);
            setKey(crypto.randomUUID());
            send.reset();
          }}
        />
      </label>
      {send.isError && (
        <p ref={error} tabIndex={-1} role="alert">
          {t(attempted.current ? "feedback.replyUnknown" : "feedback.failed")}
        </p>
      )}
      <Button
        type="submit"
        className="min-h-11"
        disabled={send.isPending || !body.trim()}
      >
        {t("feedback.send")}
      </Button>
    </form>
  );
}
export function MyFeedback() {
  const client = useQueryClient();
  const { t } = useTranslation("experience"),
    { selectedCompanyId } = useCompany(),
    identity = useAccountIdentity(),
    [params, setParams] = useSearchParams();
  const { enabled } = useV9FeatureEnabled("customer_feedback_v9");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const selected = params.get("feedbackId");
  const allowed = !!selectedCompanyId && identity.settled && !!principal;
  const scope = `${selectedCompanyId ?? ""}:${principal ?? "unresolved"}`;
  const [revision, setRevision] = useState({ scope, epoch: 0 });
  const epoch = revision.scope === scope ? revision.epoch : 0;
  const prefix = ["customer-feedback", selectedCompanyId, principal];
  useCompanyLiveEvent((event) => {
    if (event.companyId !== selectedCompanyId) return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.type !== "analytical.context.access_lost" &&
      !(
        event.type === "activity.logged" &&
        (/customer_feedback|permission|membership|privacy|erased|deleted|withdraw/i.test(
          action,
        ) ||
          event.payload.entityType === "company_membership")
      )
    )
      return;
    setRevision((previous) => ({
      scope,
      epoch: (previous.scope === scope ? previous.epoch : 0) + 1,
    }));
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  const query = useInfiniteQuery({
    queryKey: [...prefix, "list", epoch],
    queryFn: ({ signal, pageParam }) =>
      customerFeedbackApi.list(
        selectedCompanyId!,
        principal!,
        signal,
        pageParam ?? undefined,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === 25 ? last.at(-1)!.id : undefined,
    enabled: allowed,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const detail = useQuery({
    queryKey: [
      "customer-feedback",
      selectedCompanyId,
      principal,
      "detail",
      selected,
      epoch,
    ],
    queryFn: ({ signal }) =>
      customerFeedbackApi.get(
        selectedCompanyId!,
        principal!,
        selected!,
        signal,
      ),
    enabled: allowed && !!selected,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const failed =
    query.isError || (!!selected && detail.isError) || identity.failed;
  const loading =
    !allowed ||
    query.isPending ||
    query.isFetching ||
    (!!selected && (detail.isPending || detail.isFetching));
  const current = !loading && !failed && detail.isSuccess ? detail.data : null;
  const heading = useExperienceHeading(scope, loading, failed);
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t("feedback.history")}
      </h1>
      {!enabled && <p role="status">{t("feedback.submissionsPaused")}</p>}
      {failed && (
        <ExperienceReadError
          message={t("feedback.historyFailed")}
          retry={() => {
            if (identity.failed || !principal) {
              void client.refetchQueries({ queryKey: ["auth", "session"] });
              return;
            }
            void query.refetch();
            if (selected) void detail.refetch();
          }}
        />
      )}
      {loading && !failed ? (
        <p role="status">{t("loading")}</p>
      ) : !failed && query.isSuccess && !query.data.pages[0]?.length ? (
        <p>{t("feedback.empty")}</p>
      ) : null}
      {!loading &&
        !failed &&
        query.isSuccess &&
        query.data.pages.flat().map((item) => (
          <Button
            key={item.id}
            variant="outline"
            className="flex min-h-11 w-full flex-wrap justify-between gap-3"
            onClick={() => setParams({ feedbackId: item.id })}
          >
            <span>{item.feedbackId}</span>
            <span>{t(`feedback.statuses.${item.status}`)}</span>
          </Button>
        ))}
      {!loading && !failed && query.hasNextPage && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("feedback.older")}
        </Button>
      )}
      {current && (
        <article className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="text-lg font-semibold">{current.feedbackId}</h2>
          <p>
            {t(`feedback.categories.${current.category}`)} ·{" "}
            {new Date(current.createdAt).toLocaleDateString()} ·{" "}
            {t(`feedback.statuses.${current.status}`)}
          </p>
          <p className="whitespace-pre-wrap break-words">{current.body}</p>
          {current.goal && (
            <p className="whitespace-pre-wrap break-words">{current.goal}</p>
          )}
          {current.messages.map((message) => (
            <div
              key={message.id}
              className="rounded-md border border-border p-3"
            >
              <p className="text-sm text-muted-foreground">
                {t(
                  message.kind === "product_message"
                    ? "feedback.productTeam"
                    : "feedback.yourResponse",
                )}
              </p>
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
            </div>
          ))}
        </article>
      )}
      {selected && principal && (
        <Response
          key={`${scope}:${selected}`}
          item={current}
          active={!!current}
          id={selected}
          companyId={selectedCompanyId}
          principal={principal}
        />
      )}
    </div>
  );
}
