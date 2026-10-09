import { useRef, useState } from "react";
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
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { customerFeedbackApi } from "../api/customer-feedback";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import type { CustomerFeedback } from "@paperclipai/shared";
function Response({
  item,
  companyId,
  principal,
}: {
  item: CustomerFeedback;
  companyId: string;
  principal: string;
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
    mutationFn: () => {
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
    onSuccess: () => {
      attempted.current = null;
      setBody("");
      setKey(crypto.randomUUID());
      void client.invalidateQueries({
        queryKey: ["customer-feedback", companyId, principal],
      });
    },
  });
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
          disabled={send.isPending}
          value={body}
          onChange={(event) => {
            attempted.current = null;
            setBody(event.target.value);
            setKey(crypto.randomUUID());
            send.reset();
          }}
        />
      </label>
      {send.isError && <p role="alert">{t("feedback.failed")}</p>}
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
  const query = useInfiniteQuery({
    queryKey: ["customer-feedback", selectedCompanyId, principal, "list"],
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
  if (!selectedCompanyId) return <p>{t("selectCompany")}</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("feedback.history")}</h1>
      {!enabled && <p role="status">{t("feedback.submissionsPaused")}</p>}
      {(query.isError || detail.isError || identity.failed) && (
        <div role="alert">
          <p>{t("feedback.historyFailed")}</p>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              if (identity.failed || !principal) {
                void client.refetchQueries({ queryKey: ["auth", "session"] });
                return;
              }
              void query.refetch();
              if (selected) void detail.refetch();
            }}
          >
            {t("tryAgain")}
          </Button>
        </div>
      )}
      {!identity.settled || query.isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : query.isSuccess && !query.data.pages[0]?.length ? (
        <p>{t("feedback.empty")}</p>
      ) : null}
      {query.isSuccess &&
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
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("feedback.older")}
        </Button>
      )}
      {detail.isSuccess && detail.data && (
        <article className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="text-lg font-semibold">{detail.data.feedbackId}</h2>
          <p>
            {t(`feedback.categories.${detail.data.category}`)} ·{" "}
            {new Date(detail.data.createdAt).toLocaleDateString()} ·{" "}
            {t(`feedback.statuses.${detail.data.status}`)}
          </p>
          <p className="whitespace-pre-wrap break-words">{detail.data.body}</p>
          {detail.data.goal && (
            <p className="whitespace-pre-wrap break-words">
              {detail.data.goal}
            </p>
          )}
          {detail.data.messages.map((message) => (
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
          {detail.data.status === "NEEDS_INFO" && principal && (
            <Response
              key={`${selectedCompanyId}:${principal}:${detail.data.id}`}
              item={detail.data}
              companyId={selectedCompanyId}
              principal={principal}
            />
          )}
        </article>
      )}
    </div>
  );
}
