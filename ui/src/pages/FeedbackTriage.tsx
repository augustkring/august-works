import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  feedbackInternalListSchema,
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
  const query = useQuery({
    queryKey: ["feedback-triage", principal, companyId],
    queryFn: async ({ signal }) =>
      feedbackInternalListSchema.parse(
        await api.get(path, { signal, cache: "no-store" }),
      ),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const current = query.isSuccess
    ? query.data.find((item) => item.id === selected)
    : null;
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
      {!query.data?.length && <p>{t("feedback.triageEmpty")}</p>}
      {query.data?.map((item) => (
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
