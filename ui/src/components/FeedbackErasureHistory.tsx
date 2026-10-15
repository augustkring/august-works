import { useCallback, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { feedbackRetentionErasureHistorySchema, type FeedbackRetentionErasureHistory } from "@paperclipai/shared";
import { api } from "../api/client";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { Button } from "./ui/button";

export function FeedbackErasureHistory({ companyId, principal, active, onOpen }: {
  companyId: string; principal: string; active: boolean; onOpen(item: FeedbackRetentionErasureHistory[number]): void;
}) {
  const { t } = useTranslation("experience"), client = useQueryClient(), authority = useV9PrivateReadAuthority(principal);
  const [expanded, setExpanded] = useState(false);
  const key = ["feedback-erasure-history", principal, companyId, authority.epoch];
  const query = useQuery({ queryKey: key, enabled: active && expanded && authority.readReady, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      const value = feedbackRetentionErasureHistorySchema.parse(await api.get(
        `/internal/customer-feedback/${companyId}/retention-erasures?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" }));
      if (value.some(item => item.receipt.companyId !== companyId)) throw Error("Erasure history context changed");
      return value;
    }),
  });
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(changed), [client]);
  const state = useSyncExternalStore(subscribe, () => client.getQueryState<FeedbackRetentionErasureHistory>(key), () => undefined);
  function current() {
    const native = client.getQueryState(key);
    return active && expanded && authority.canRead() && native?.status === "success" && native.fetchStatus === "idle" && !native.isInvalidated;
  }
  if (!active || !authority.readReady) return null;
  return <section className="space-y-3" aria-label={t("feedback.erasure.history")}>
    <Button type="button" className="min-h-11" variant="outline" aria-expanded={expanded} onClick={() => {
      if (authority.canRead()) setExpanded(value => !value);
    }}>{t("feedback.erasure.history")}</Button>
    {expanded && (query.isError ? <><p role="alert">{t("feedback.erasure.unavailable")}</p>
      <Button type="button" className="min-h-11" variant="outline" onClick={() => { if (authority.canRead()) void query.refetch(); }}>{t("tryAgain")}</Button></>
      : !current() ? <p role="status">{t("feedback.erasure.checking")}</p>
      : <ul className="space-y-3">{state?.data?.map(item => <li key={item.receipt.id} className="space-y-2">
        <p className="break-all text-sm">{item.receipt.feedbackId}</p>
        <Button type="button" className="min-h-11 max-w-full whitespace-normal break-words text-left" variant="outline" onClick={() => {
          if (!current()) return;
          const native = client.getQueryData<FeedbackRetentionErasureHistory>(key)?.find(row => row.receipt.id === item.receipt.id);
          if (native) onOpen(native);
        }}>{t(item.receipt.target.kind === "case" ? "feedback.erasure.caseLabel" : "feedback.erasure.imageLabel")} · {t(item.receipt.status === "completed" ? "feedback.erasure.completedLabel" : "feedback.erasure.pendingLabel")} · {item.receipt.requestedAt}</Button>
      </li>)}</ul>)}
  </section>;
}
