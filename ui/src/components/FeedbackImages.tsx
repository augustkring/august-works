import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { FeedbackImage } from "@paperclipai/shared";
import type { V9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { feedbackImagesApi } from "../api/feedback-images";
import { Button } from "./ui/button";

function ProtectedImage({ image, companyId, principal, feedbackId, authority, internal, current }: {
  image: FeedbackImage; companyId: string; principal: string; feedbackId: string;
  authority: V9PrivateReadAuthority; internal: boolean; current: () => boolean;
}) {
  const { t } = useTranslation("experience");
  const [preview, setPreview] = useState<{ url: string; epoch: number } | null>(null);
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const owned = useRef<string | null>(null), request = useRef<AbortController | null>(null), alive = useRef(false);
  const context = useRef({ epoch: authority.epoch, current });
  context.current = { epoch: authority.epoch, current };
  const allowed = () => alive.current && authority.canRead() && context.current.current();
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; request.current?.abort(); request.current = null;
      if (owned.current) URL.revokeObjectURL(owned.current); owned.current = null;
    };
  }, [authority.epoch]);
  return <li className="space-y-2">
    <p className="text-sm">{t("feedback.images.stored")}</p>
    {preview && preview.epoch === authority.epoch && current() && <img className="max-h-80 max-w-full rounded-md object-contain"
      src={preview.url} alt={t("feedback.images.storedPreview")} />}
    <Button type="button" variant="outline" className="min-h-11" disabled={pending || !current()}
      onClick={async () => {
        if (!allowed() || request.current) return;
        const epoch = context.current.epoch, controller = new AbortController(); request.current = controller;
        setPending(true); setFailed(false);
        try {
          const blob = await authority.read(() => feedbackImagesApi.read(companyId, principal, feedbackId, image, controller.signal, internal));
          if (!allowed() || context.current.epoch !== epoch || controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          if (owned.current) URL.revokeObjectURL(owned.current);
          owned.current = url; setPreview({ url, epoch });
        } catch {
          if (allowed() && context.current.epoch === epoch && !controller.signal.aborted) setFailed(true);
        } finally {
          if (request.current === controller) request.current = null;
          if (alive.current && context.current.epoch === epoch) setPending(false);
        }
      }}>{t(pending ? "loading" : "feedback.images.view")}</Button>
    {failed && current() && <p role="alert">{t("feedback.images.readFailed")}</p>}
  </li>;
}

/** Separate original customer/operator API purposes. Binary responses remain
 * in component memory, with owned Blob URLs revoked on hide/owner change. */
export function FeedbackImages({ companyId, principal, feedbackId, authority, active, readEpoch = 0, internal = false }: {
  companyId: string; principal: string; feedbackId: string; authority: V9PrivateReadAuthority;
  active: boolean; readEpoch?: number; internal?: boolean;
}) {
  const { t } = useTranslation("experience"), client = useQueryClient();
  const key = ["feedback-images", internal ? "operator" : "submitter", companyId, principal, feedbackId, authority.epoch, readEpoch];
  const query = useQuery({ queryKey: key, enabled: active && authority.readReady, retry: false, staleTime: 0, gcTime: 0,
    queryFn: ({ signal }) => authority.read(() => feedbackImagesApi.list(companyId, principal, feedbackId, signal, internal)) });
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(changed), [client]);
  const state = useSyncExternalStore(subscribe, () => client.getQueryState<FeedbackImage[]>(key), () => undefined);
  const current = () => {
    const now = client.getQueryState<FeedbackImage[]>(key);
    return active && authority.canRead() && now?.status === "success" && now.fetchStatus === "idle" && !now.isInvalidated;
  };
  if (!active || !authority.readReady) return null;
  if (query.isError) return <section className="space-y-2" aria-label={t("feedback.images.title")}>
    <p role="alert">{t("feedback.images.readFailed")}</p>
    <Button type="button" variant="outline" className="min-h-11" onClick={() => { if (authority.canRead()) void query.refetch(); }}>{t("tryAgain")}</Button>
  </section>;
  if (state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated)
    return <section aria-label={t("feedback.images.title")} aria-busy="true"><p>{t("loading")}</p></section>;
  if (!state.data?.length) return null;
  return <section className="space-y-3" aria-label={t("feedback.images.title")}>
    <h3 className="font-medium">{t("feedback.images.title")}</h3>
    <ul className="space-y-3">{state.data.map(image => image.status === "ready"
      ? <ProtectedImage key={`${image.id}:${authority.epoch}`} {...{ image, companyId, principal, feedbackId, authority, internal, current }} />
      : <li key={image.id}>{t("feedback.images.unconfirmed")}</li>)}</ul>
    {state.data.some(image => image.status !== "ready") && <Button type="button" variant="outline" className="min-h-11"
      onClick={() => { if (current()) void query.refetch(); }}>{t("feedback.images.check")}</Button>}
  </section>;
}
