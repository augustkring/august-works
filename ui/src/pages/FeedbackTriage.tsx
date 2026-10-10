import { useId, useRef, useState } from "react";
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
  customerFeedbackSchema,
} from "@paperclipai/shared";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { api } from "../api/client";
import { isRejectedFeedbackRequest } from "../api/customer-feedback";
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
  const authority = useV9PrivateReadAuthority(principal);
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
  const uncertain = useRef(false);
  const path = `/internal/customer-feedback/${companyId}?expectedUserId=${encodeURIComponent(principal)}`;
  const listKey = ["feedback-triage", principal, companyId, "list", authority.epoch];
  const query = useInfiniteQuery({
    queryKey: listKey,
    queryFn: async ({ signal, pageParam }) =>
      authority.read(async () => feedbackInternalListSchema.parse(
        await api.get(path + (pageParam ? `&before=${pageParam}` : ""), {
          signal,
          cache: "no-store",
        }),
      )),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === 25 ? last.at(-1)!.id : undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled: authority.readReady,
  });
  const detailKey = ["feedback-triage", principal, companyId, "detail", selected, authority.epoch];
  const detail = useInfiniteQuery({
    queryKey: detailKey,
    queryFn: ({ signal, pageParam }) => authority.read(async () => {
      const result = feedbackInternalDetailSchema.parse(
        await api.get(
          `/internal/customer-feedback/${companyId}/${selected}?expectedUserId=${encodeURIComponent(principal)}` +
            (pageParam ? `&beforeEvent=${pageParam}` : ""),
          { signal, cache: "no-store" },
        ),
      );
      if (result.companyId !== companyId || result.id !== selected)
        throw new Error("Feedback context changed");
      return result;
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextEventCursor ?? undefined,
    enabled: authority.readReady && !!selected && query.isSuccess && !query.isFetching,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const current =
    authority.readReady && query.isSuccess &&
    !query.isFetching &&
    detail.isSuccess &&
    !detail.isFetching
      ? detail.data.pages[0]
      : null;
  function canTriage() {
    const list = client.getQueryState(listKey), selectedDetail = client.getQueryState(detailKey);
    return authority.canRead() && list?.status === "success" && list.fetchStatus === "idle" && !list.isInvalidated &&
      selectedDetail?.status === "success" && selectedDetail.fetchStatus === "idle" && !selectedDetail.isInvalidated;
  }
  const save = useMutation({
    mutationKey: ["feedback-triage", principal, companyId],
    gcTime: 0,
    mutationFn: async () => {
      if (!canTriage() || !current || !selected) throw new Error("Feedback context changed");
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
      const request = attempted.current;
      const value = await authority.write(async () => customerFeedbackSchema.parse(await api.post(
        `/internal/customer-feedback/${companyId}/${request.id}/triage?expectedUserId=${encodeURIComponent(principal)}`,
        request.input,
      )));
      if (!canTriage() || value.companyId !== companyId || value.id !== request.id)
        throw new Error("Triage needs current confirmation");
      return value;
    },
    retry: false,
    onError: (error) => {
      if (!uncertain.current && canTriage() && isRejectedFeedbackRequest(error)) {
        attempted.current = null;
        setKey(crypto.randomUUID());
        void client.invalidateQueries({
          queryKey: ["feedback-triage", principal, companyId],
        });
      } else if (attempted.current) uncertain.current = true;
    },
    onSuccess: (value) => {
      if (!canTriage() || !authority.confirmed(value)) return;
      attempted.current = null;
      uncertain.current = false;
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
    if (attempted.current) return;
    attempted.current = null;
    change();
    setKey(crypto.randomUUID());
    save.reset();
  }
  if (authority.failed || query.isError)
    return (
      <div role="alert">
        <p>{t("feedback.triageDenied")}</p>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={authority.rechecking}
          onClick={() => {
            if (authority.canRead()) void query.refetch();
            else void authority.recheck().catch(() => {});
          }}
        >
          {t("tryAgain")}
        </Button>
      </div>
    );
  const inputsLocked = save.isPending || !!attempted.current;
  if (!authority.readReady || query.isPending || query.isFetching)
    return <p role="status">{t("loading")}</p>;
  return (
    <div className="space-y-6">
      {!query.data?.pages[0]?.length && <p>{t("feedback.triageEmpty")}</p>}
      {query.data?.pages.flat().map((item) => (
        <Button
          key={item.id}
          variant="outline"
          className="min-h-11"
          disabled={inputsLocked}
          onClick={() => {
            if (attempted.current) return;
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
              disabled={inputsLocked}
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
              disabled={inputsLocked}
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
              disabled={inputsLocked}
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
              disabled={inputsLocked}
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
              disabled={inputsLocked}
              value={linkId}
              onChange={(event) => edit(() => setLinkId(event.target.value))}
            />
          </label>
          {save.isError && (
            <p role="alert">
              {t(
                attempted.current
                  ? "feedback.triageUnknown"
                  : "feedback.triageFailed",
              )}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={inputsLocked}
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
  const identity = useV9CurrentAccount();
  return <ScopedFeedbackTriage key={identity.userId ?? "unresolved"} identity={identity} />;
}
function ScopedFeedbackTriage({ identity }: { identity: ReturnType<typeof useV9CurrentAccount> }) {
  const { t } = useTranslation("experience"),
    authority = useV9PrivateReadAuthority(identity.userId ?? "");
  const [companyInput, setCompanyInput] = useState(""),
    [companyId, setCompanyId] = useState<string | null>(null);
  const headingId = useId();
  const heading = useExperienceHeading(`${identity.userId ?? "unresolved"}:${companyId ?? ""}`, !authority.readReady, authority.failed);
  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 ref={heading} id={headingId} tabIndex={-1} className="text-2xl font-semibold">{t("feedback.triageTitle")}</h1>
      <p>{t("feedback.triagePurpose")}</p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/saas/operations"
      >
        {t("feedback.operations")}
      </Link>
      {authority.readReady ? <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!authority.canRead()) return;
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
      </form> : !authority.failed && <p role="status">{t("loading")}</p>}
      {identity.failed && <div role="alert" className="space-y-2">
        <p>{t("feedback.triageDenied")}</p>
        {!companyId && <Button className="min-h-11" disabled={authority.rechecking}
          onClick={() => void authority.recheck().catch(() => {})}>{t("tryAgain")}</Button>}
      </div>}
      {identity.userId && !identity.localImplicit && companyId && (
        <Queue
          key={`${identity.userId}:${companyId}`}
          companyId={companyId}
          principal={identity.userId}
        />
      )}
    </section>
  );
}
