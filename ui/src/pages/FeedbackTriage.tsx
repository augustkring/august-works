import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  feedbackInternalListSchema,
  feedbackInternalDetailSchema,
  feedbackInternalStateSchema,
  feedbackTriageSchema,
} from "@paperclipai/shared";
import { useAccountIdentity } from "../api/companies-query";
import { api } from "../api/client";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";

function Queue({
  companyId,
  principal,
}: {
  companyId: string;
  principal: string;
}) {
  const { t } = useTranslation("experience"),
    client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null),
    [state, setState] =
      useState<(typeof feedbackInternalStateSchema.options)[number]>(
        "UNDER_REVIEW",
      );
  const [customerMessage, setCustomerMessage] = useState(""),
    [internalNote, setInternalNote] = useState(""),
    [linkType, setLinkType] = useState<"issue" | "duplicate">("issue"),
    [linkId, setLinkId] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const attempted = useRef<{
    id: string;
    input: ReturnType<typeof feedbackTriageSchema.parse>;
  } | null>(null);
  const path = `/internal/customer-feedback/${companyId}?expectedUserId=${encodeURIComponent(principal)}`;
  const query = useInfiniteQuery({
    queryKey: ["feedback-triage", principal, companyId],
    queryFn: async ({ signal, pageParam }) =>
      feedbackInternalListSchema.parse(
        await api.get(path + (pageParam ? `&before=${pageParam}` : ""), {
          signal,
          cache: "no-store",
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === 25 ? last.at(-1)!.id : undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const detail = useInfiniteQuery({
    queryKey: ["feedback-triage", principal, companyId, "detail", selected],
    queryFn: async ({ signal, pageParam }) =>
      feedbackInternalDetailSchema.parse(
        await api.get(
          `/internal/customer-feedback/${companyId}/${selected}?expectedUserId=${encodeURIComponent(principal)}` +
            (pageParam ? `&beforeEvent=${pageParam}` : ""),
          { signal, cache: "no-store" },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextEventCursor ?? undefined,
    enabled: !!selected && query.isSuccess,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const current =
    query.isSuccess && detail.isSuccess ? detail.data.pages[0] : null;
  const save = useMutation({
    mutationFn: async () => {
      attempted.current ??= {
        id: selected!,
        input: feedbackTriageSchema.parse({
          idempotencyKey: key,
          expectedVersion: current!.version,
          internalState: state,
          customerMessage,
          internalNote,
          ...(linkId ? { link: { type: linkType, id: linkId } } : {}),
        }),
      };
      return api.post(
        `/internal/customer-feedback/${companyId}/${attempted.current.id}/triage?expectedUserId=${encodeURIComponent(principal)}`,
        attempted.current.input,
      );
    },
    retry: false,
    onSuccess: () => {
      attempted.current = null;
      void client.invalidateQueries({
        queryKey: ["feedback-triage", principal, companyId],
      });
      setSelected(null);
      setCustomerMessage("");
      setInternalNote("");
      setLinkId("");
      setKey(crypto.randomUUID());
    },
  });
  function edit(change: () => void) {
    attempted.current = null;
    change();
    setKey(crypto.randomUUID());
    save.reset();
  }
  if (query.isError)
    return (
      <div role="alert">
        <p>{t("feedback.triageDenied")}</p>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => void query.refetch()}
        >
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (query.isLoading) return <p role="status">{t("loading")}</p>;
  return (
    <div className="space-y-6">
      {!query.data?.pages[0]?.length && <p>{t("feedback.triageEmpty")}</p>}
      {query.data?.pages.flat().map((item) => (
        <Button
          key={item.id}
          variant="outline"
          className="min-h-11"
          onClick={() => {
            attempted.current = null;
            setSelected(item.id);
            setState(item.internalState);
            setCustomerMessage("");
            setInternalNote("");
            setLinkId("");
            setKey(crypto.randomUUID());
            save.reset();
          }}
        >
          {item.feedbackId} · {item.internalState}
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
      {selected && detail.isLoading && <p role="status">{t("loading")}</p>}
      {detail.isError && (
        <div role="alert">
          <p>{t("feedback.triageHistoryFailed")}</p>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => void detail.refetch()}
          >
            {t("tryAgain")}
          </Button>
        </div>
      )}
      {current && (
        <form
          className="space-y-4 rounded-lg border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <h2 className="text-lg font-semibold">{current.feedbackId}</h2>
          <p className="whitespace-pre-wrap break-words">{current.body}</p>
          <p className="whitespace-pre-wrap break-words">{current.goal}</p>
          <section
            className="space-y-3"
            aria-label={t("feedback.triageHistory")}
          >
            <h3 className="font-semibold">{t("feedback.triageHistory")}</h3>
            {detail.hasNextPage && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={detail.isFetchingNextPage}
                onClick={() => void detail.fetchNextPage()}
              >
                {t("feedback.olderMessages")}
              </Button>
            )}
            {detail.data?.pages
              .slice()
              .reverse()
              .flatMap((page) => page.events)
              .map((event) => (
                <article
                  key={event.id}
                  className="space-y-2 rounded-md border border-border p-3"
                >
                  <p className="text-sm text-muted-foreground">
                    {t(
                      event.kind === "customer_follow_up"
                        ? "feedback.customerResponse"
                        : "feedback.productTeam",
                    )}{" "}
                    ·{" "}
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                  </p>
                  {event.body && (
                    <p className="whitespace-pre-wrap break-words">
                      {event.body}
                    </p>
                  )}
                  {event.internalNote && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {t("feedback.internalNote")}
                      </p>
                      <p className="whitespace-pre-wrap break-words">
                        {event.internalNote}
                      </p>
                    </div>
                  )}
                  {event.linkId && (
                    <p className="break-words text-sm">
                      {t(
                        event.linkType === "issue"
                          ? "feedback.linkIssue"
                          : "feedback.linkDuplicate",
                      )}
                      : {event.linkId}
                    </p>
                  )}
                </article>
              ))}
            {!detail.data?.pages[0]?.events.length && (
              <p>{t("feedback.noMessages")}</p>
            )}
          </section>
          <label className="block space-y-2">
            <span>{t("feedback.triageState")}</span>
            <select
              className="min-h-11 rounded-md border border-input bg-background px-3"
              disabled={save.isPending}
              value={state}
              onChange={(event) =>
                edit(() =>
                  setState(
                    feedbackInternalStateSchema.parse(event.target.value),
                  ),
                )
              }
            >
              {feedbackInternalStateSchema.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-2">
            <span>{t("feedback.customerMessage")}</span>
            <Textarea
              maxLength={10000}
              required={state === "NEEDS_INFO"}
              disabled={save.isPending}
              value={customerMessage}
              onChange={(event) =>
                edit(() => setCustomerMessage(event.target.value))
              }
            />
          </label>
          <label className="block space-y-2">
            <span>{t("feedback.internalNote")}</span>
            <Textarea
              maxLength={10000}
              disabled={save.isPending}
              value={internalNote}
              onChange={(event) =>
                edit(() => setInternalNote(event.target.value))
              }
            />
          </label>
          <label className="block space-y-2">
            <span>{t("feedback.linkType")}</span>
            <select
              className="min-h-11 rounded-md border border-input bg-background px-3"
              disabled={save.isPending}
              value={linkType}
              onChange={(event) =>
                edit(() =>
                  setLinkType(event.target.value as "issue" | "duplicate"),
                )
              }
            >
              <option value="issue">{t("feedback.linkIssue")}</option>
              <option value="duplicate">{t("feedback.linkDuplicate")}</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span>{t("feedback.linkId")}</span>
            <input
              className="min-h-11 w-full rounded-md border border-input bg-background px-3"
              disabled={save.isPending}
              value={linkId}
              onChange={(event) => edit(() => setLinkId(event.target.value))}
            />
          </label>
          {save.isError && <p role="alert">{t("feedback.triageFailed")}</p>}
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={save.isPending}
              onClick={() => setSelected(null)}
            >
              {t("feedback.cancel")}
            </Button>
            <Button
              type="submit"
              className="min-h-11"
              disabled={save.isPending}
            >
              {t("feedback.applyTriage")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
export function FeedbackTriage() {
  const { t } = useTranslation("experience"),
    identity = useAccountIdentity();
  const [companyInput, setCompanyInput] = useState(""),
    [companyId, setCompanyId] = useState<string | null>(null);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{t("feedback.triageTitle")}</h1>
      <p>{t("feedback.triagePurpose")}</p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/saas/operations"
      >
        {t("feedback.operations")}
      </Link>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setCompanyId(companyInput);
        }}
      >
        <label className="block space-y-2">
          <span>{t("feedback.companyId")}</span>
          <input
            required
            pattern="[0-9a-fA-F-]{36}"
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={companyInput}
            onChange={(event) => setCompanyInput(event.target.value)}
          />
        </label>
        <Button
          className="min-h-11"
          disabled={!identity.settled || !identity.userId}
        >
          {t("feedback.openQueue")}
        </Button>
      </form>
      {identity.failed && <p role="alert">{t("feedback.triageDenied")}</p>}
      {identity.settled && identity.userId && companyId && (
        <Queue
          key={`${identity.userId}:${companyId}`}
          companyId={companyId}
          principal={identity.userId}
        />
      )}
    </main>
  );
}
