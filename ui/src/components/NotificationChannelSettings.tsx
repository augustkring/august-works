import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationChannelCategory, NotificationChannelPreferenceView, NotificationChannelUpdate,
  NotificationChannelPreferenceReceipt } from "@paperclipai/shared";
import { saasApi } from "@/api/saas";
import { useV9AccountScope } from "@/hooks/useV9AccountScope";
import { useV9FeatureEnabled } from "@/hooks/useV9FeatureEnabled";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useTranslation } from "@/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";

type Props = { companyId: string; principal: string; category: NotificationChannelCategory;
  sourceReady: boolean; sourceQueryKey: readonly [string, string, number] };
const targetKey = (target: { identityLinkId: string; conversationId: string }) => `${target.identityLinkId}:${target.conversationId}`;
export function NotificationChannelSettings(props: Props) {
  const feature = useV9FeatureEnabled("notification_channels_v9"), [seen, setSeen] = useState(false);
  useEffect(() => { if (feature.enabled) setSeen(true); }, [feature.enabled]);
  if ((!seen && !feature.enabled) || !props.companyId) return null;
  return <ChannelScope key={`${props.companyId}:${props.principal}:${props.category}`} {...props} feature={feature} />;
}
function ChannelScope({ companyId, principal, category, sourceReady, sourceQueryKey, feature }: Props & {
  feature: ReturnType<typeof useV9FeatureEnabled>;
}) {
  const { t, i18n } = useTranslation("experience"), label = useId(), client = useQueryClient();
  const scope = useV9AccountScope(principal);
  const { selectedCompanyId } = useCompany();
  const ready = scope.ready && sourceReady && selectedCompanyId === companyId &&
    feature.query.isSuccess && !feature.query.isFetching;
  const context = useRef({ ready, accountEpoch: scope.epoch, epoch: 0 });
  if (context.current.ready !== ready || context.current.accountEpoch !== scope.epoch)
    context.current = { ready, accountEpoch: scope.epoch, epoch: context.current.epoch + 1 };
  const epoch = context.current.epoch;
  const key = ["notification-channel-policy", companyId, principal, category, epoch];
  const alive = useRef(true), attempt = useRef<NotificationChannelUpdate | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [choice, setChoice] = useState("default"), [choiceHash, setChoiceHash] = useState<string | null>(null);
  const [deliveryLocale, setDeliveryLocale] = useState<"en" | "da">("en");
  const [baseline, setBaseline] = useState<NotificationChannelPreferenceView | null>(null);
  const [unknown, setUnknown] = useState(false), [failure, setFailure] = useState(false);
  const [receipt, setReceipt] = useState<NotificationChannelPreferenceReceipt | null>(null);
  const canRead = () => {
    const parent = client.getQueryState(sourceQueryKey), flags = client.getQueryState(queryKeys.instance.experimentalSettings);
    return alive.current && context.current.ready && context.current.epoch === epoch && scope.canUse("notifications") &&
      parent?.status === "success" && parent.fetchStatus === "idle" && !parent.isInvalidated &&
      flags?.status === "success" && flags.fetchStatus === "idle" && !flags.isInvalidated;
  };
  const read = useQuery({ queryKey: key, enabled: ready, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => scope.read(async () => {
      if (!canRead()) throw new Error("Current notification policy is unavailable");
      const value = await saasApi.notificationChannelPreference(companyId, principal, category, signal);
      if (!canRead()) throw new Error("Current notification policy changed");
      return value;
    }, "notifications") });
  function adopt(value: NotificationChannelPreferenceView, clearReceipt = true) {
    setBaseline(value); setDeliveryLocale(value.version === 0 && i18n.resolvedLanguage === "da" ? "da" : value.deliveryLocale); setChoice(value.channel === "default" ? "default" : value.target ? targetKey(value.target) : "unavailable");
    setChoiceHash(value.target?.targetHash ?? null); if (clearReceipt) setReceipt(null); setFailure(false);
  }
  useEffect(() => {
    if (read.data && !read.isFetching && !baseline && canRead() && (!receipt || read.data.version >= receipt.version)) adopt(read.data, false);
  }, [read.data, read.isFetching, baseline, epoch, receipt]);
  useCompanyLiveEvent(event => {
    if (event.companyId !== companyId || event.type !== "activity.logged") return;
    const action = typeof event.payload.action === "string" ? event.payload.action : "";
    if (["user", "company_membership", "resource_membership", "tool_connection", "chat_endpoint", "chat_identity_link"].includes(String(event.payload.entityType)) ||
      /erased|deleted|revoked|permission|notifications\./.test(action)) void client.resetQueries({ queryKey: key, exact: true });
  });
  const visible = ready && read.isSuccess && !read.isFetching && canRead();
  const selected = visible ? read.data.targets.find(target => targetKey(target) === choice) : undefined;
  const sameSource = visible && baseline?.baselineHash === read.data.baselineHash &&
    (choice === "default" || selected?.targetHash === choiceHash);
  function accept(value: NotificationChannelPreferenceReceipt) {
    if (!canRead()) return;
    setReceipt(value); attempt.current = null; setUnknown(false); setFailure(false); setBaseline(null);
    void read.refetch();
  }
  const save = useMutation({ retry: false, mutationFn: async () => {
    if (!canRead() || !visible || read.isFetching) throw new Error("Current notification policy is unavailable");
    if (!attempt.current) {
      if (!sameSource || !baseline || choice !== "default" && (!feature.enabled || !selected)) throw new Error("Review the current destination");
      attempt.current = Object.freeze({ requestId: crypto.randomUUID(), expectedVersion: baseline.version,
        expectedBaselineHash: baseline.baselineHash, deliveryLocale,
        choice: Object.freeze(choice === "default" ? { channel: "default" as const } : {
          channel: selected!.provider, identityLinkId: selected!.identityLinkId,
          conversationId: selected!.conversationId, expectedTargetHash: selected!.targetHash,
        }) });
    }
    const pending = attempt.current, currentEpoch = context.current.epoch;
    const value = await saasApi.updateNotificationChannel(companyId, principal, category, pending);
    if (!canRead() || currentEpoch !== context.current.epoch) throw new Error("Notification preference needs current confirmation");
    return value;
  }, onSuccess: accept, onError: () => { if (alive.current) { setUnknown(!!attempt.current); setFailure(true); } } });
  const check = useMutation({ retry: false, mutationFn: async () => {
    if (!canRead() || !attempt.current) throw new Error("The Original preference request is unavailable");
    const pending = attempt.current, currentEpoch = context.current.epoch;
    const value = await saasApi.notificationChannelReceipt(companyId, principal, category, pending.requestId);
    if (value && (value.version !== pending.expectedVersion + 1 || value.channel !== pending.choice.channel))
      throw new Error("The Original preference receipt does not confirm this save");
    if (!canRead() || currentEpoch !== context.current.epoch) throw new Error("Notification preference needs current confirmation");
    return value;
  }, onSuccess: value => { if (value) accept(value); else if (canRead()) { setUnknown(true); setFailure(true); } },
  onError: () => { if (alive.current) setFailure(true); } });
  const pending = save.isPending || check.isPending;
  return <section aria-labelledby={label} className="space-y-3">
    <h4 id={label} className="font-medium">{t("notificationChannels.heading", { category: t(`notifications.category.${category}`) })}</h4>
    {!visible ? <><p role={read.isError ? "alert" : "status"}>{t(read.isError ? "notificationChannels.unavailable" : "notificationChannels.loading")}</p>
      {read.isError && ready ? <Button variant="outline" className="min-h-11" onClick={() => { void read.refetch(); }}>{t("tryAgain")}</Button> : null}</> : <>
      <p>{t("notificationChannels.boundary")}</p>
      {read.data.availability === "unavailable" ? <p role="status">{t("notificationChannels.destinationUnavailable")}</p> : null}
      {!sameSource && baseline && !unknown ? <p role="status">{t("notificationChannels.changed")} <Button variant="outline" className="min-h-11"
        onClick={() => adopt(read.data)}>{t("notificationChannels.reviewCurrent")}</Button></p> : null}
      <label className="block space-y-2"><span>{t("notificationChannels.destination")}</span>
        <select className="min-h-11 w-full rounded-md border border-input bg-background px-3" value={choice}
          disabled={pending || unknown || !baseline} onChange={event => {
            const value = event.target.value, target = read.data.targets.find(item => targetKey(item) === value);
            setChoice(value); setChoiceHash(target?.targetHash ?? null); setReceipt(null); setFailure(false);
          }}>
          {choice === "unavailable" ? <option value="unavailable" disabled>{t("notificationChannels.destinationUnavailable")}</option> : null}
          <option value="default">{t("notificationChannels.default")}</option>
          {read.data.targets.map(target => <option key={targetKey(target)} value={targetKey(target)}>{target.label}</option>)}
        </select>
      </label>
      <label className="block space-y-2"><span>{t("notificationChannels.language")}</span>
        <select className="min-h-11 w-full rounded-md border border-input bg-background px-3" value={deliveryLocale}
          disabled={pending || unknown || choice === "default" || choice === "unavailable"}
          onChange={event => { setDeliveryLocale(event.target.value === "da" ? "da" : "en"); setReceipt(null); }}>
          <option value="en">English</option><option value="da">Dansk</option>
        </select>
      </label>
      {read.data.targetsLimited ? <p>{t("notificationChannels.limited")}</p> : null}
      {!read.data.targets.length ? <p>{t("notificationChannels.noDestination")}</p> : null}
      {receipt ? <p role="status">{t("notificationChannels.saved", { version: receipt.version })}</p> : null}
      {failure ? <p role="alert">{t(unknown ? "notificationChannels.unknown" : "notificationChannels.failed")}</p> : null}
      <div className="flex flex-wrap justify-end gap-3">
        {unknown ? <><Button variant="outline" className="min-h-11" disabled={pending} onClick={() => check.mutate()}>{t("notificationChannels.checkOriginal")}</Button>
          <Button className="min-h-11" disabled={pending} onClick={() => save.mutate()}>{t("notificationChannels.retrySame")}</Button></>
          : <Button className="min-h-11" disabled={pending || !sameSource || choice !== "default" && !feature.enabled}
            onClick={() => save.mutate()}>{t("notificationChannels.save")}</Button>}
      </div>
    </>}
  </section>;
}
