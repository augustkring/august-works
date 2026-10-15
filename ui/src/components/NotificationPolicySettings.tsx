import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  notificationPolicySchema,
  v9FeatureEnabled,
  type NotificationPolicy,
  type SaasNotificationPreference,
} from "@paperclipai/shared";
import { saasApi } from "../api/saas";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useV9AccountScope } from "../hooks/useV9AccountScope";
import { useCompany } from "../context/CompanyContext";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
};
export function NotificationPolicySettings({
  item,
  companyId,
  principal,
  onSaved,
  sourceReady,
  sourceQueryKey,
}: {
  item: SaasNotificationPreference;
  companyId: string;
  principal: string;
  onSaved: () => void;
  sourceReady: boolean;
  sourceQueryKey: readonly [string, string, number];
}) {
  const { t } = useTranslation("experience");
  const scope = useV9AccountScope(principal);
  const client = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const flags = useQuery({ queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(), refetchOnMount: false });
  const readReady = scope.ready && sourceReady && selectedCompanyId === companyId && flags.isSuccess && !flags.isFetching;
  const current = useRef({ readReady, companyId, source: sourceQueryKey.join(":"), accountEpoch: scope.epoch, epoch: 0 });
  if (current.current.readReady !== readReady || current.current.companyId !== companyId ||
    current.current.source !== sourceQueryKey.join(":") || current.current.accountEpoch !== scope.epoch)
    current.current = { readReady, companyId, source: sourceQueryKey.join(":"), accountEpoch: scope.epoch, epoch: current.current.epoch + 1 };
  const canRead = () => {
    const source = client.getQueryState(sourceQueryKey);
    const settings = client.getQueryState(queryKeys.instance.experimentalSettings);
    return current.current.readReady && current.current.companyId === companyId && scope.canUse("notifications") &&
      source?.status === "success" && source.fetchStatus === "idle" && !source.isInvalidated &&
      settings?.status === "success" && settings.fetchStatus === "idle" && !settings.isInvalidated;
  };
  const canWrite = () => {
    const settings = client.getQueryData<Awaited<ReturnType<typeof instanceSettingsApi.getExperimental>>>(queryKeys.instance.experimentalSettings);
    return canRead() && !!settings && v9FeatureEnabled(settings, "notification_policy_v9");
  };
  const id = useId();
  const [showValidation, setShowValidation] = useState(false);
  const [cadence, setCadence] = useState<NotificationPolicy["cadence"]>(
    item.policy?.cadence ?? "immediate",
  );
  const [timezone, setTimezone] = useState(
    item.policy?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [quiet, setQuiet] = useState(!!item.policy?.quietHours),
    [start, setStart] = useState(
      time(item.policy?.quietHours?.startMinute ?? 22 * 60),
    ),
    [end, setEnd] = useState(
      time(item.policy?.quietHours?.endMinute ?? 8 * 60),
    ),
    [digest, setDigest] = useState(time(item.policy?.digestMinute ?? 9 * 60));
  const parsed = notificationPolicySchema.safeParse({
    version: 1,
    cadence,
    timezone:
      cadence === "in_app_only"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : timezone,
    quietHours:
      cadence !== "in_app_only" && quiet
        ? { startMinute: minute(start), endMinute: minute(end) }
        : null,
    digestMinute:
      cadence === "digest"
        ? minute(digest)
        : (item.policy?.digestMinute ?? 9 * 60),
  });
  const invalid = (field: string) =>
    !parsed.success &&
    parsed.error.issues.some((issue) => issue.path[0] === field);
  const timezoneError = showValidation && invalid("timezone");
  const quietError = showValidation && invalid("quietHours");
  const digestError = showValidation && invalid("digestMinute");
  const save = useMutation({
    mutationFn: async () => {
      if (!canWrite()) throw new Error("Current preference access is unresolved");
      const epoch = current.current.epoch, accountEpoch = scope.epoch;
      await saasApi.updateNotificationPreference(companyId, principal, {
        category: item.category,
        emailEnabled: item.emailEnabled,
        policy: notificationPolicySchema.parse(parsed.data),
      });
      return { epoch, accountEpoch };
    },
    retry: false,
    onSuccess: ({ epoch, accountEpoch }) => {
      if (canWrite() && current.current.epoch === epoch && scope.isCurrent(accountEpoch, "notifications")) onSaved();
    },
  });
  const clear = () => save.reset();
  if (!readReady || !canRead()) return null;
  const writable = canWrite();
  const locked = save.isPending || !writable;
  if (item.category === "security")
    return (
      <p className="text-sm text-muted-foreground">
        {t("notifications.mandatory")}
      </p>
    );
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setShowValidation(true);
        if (!parsed.success) {
          const name = invalid("timezone")
            ? "timezone"
            : invalid("quietHours")
              ? "quiet-start"
              : "digest";
          (
            event.currentTarget.elements.namedItem(name) as HTMLElement | null
          )?.focus();
          return;
        }
        if (canWrite()) save.mutate();
      }}
    >
      <h3 className="font-medium">
        {t(`notifications.category.${item.category}`)}
      </h3>
      <label className="block space-y-2">
        <span>{t("notifications.cadence")}</span>
        <select
          className="min-h-11 w-full rounded-md border border-input bg-background px-3"
          value={cadence}
          disabled={locked}
          onChange={(event) => {
            setCadence(event.target.value as NotificationPolicy["cadence"]);
            clear();
          }}
        >
          {(["immediate", "digest", "in_app_only"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`notifications.delivery.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {cadence !== "in_app_only" ? (
        <>
          <label className="block space-y-2">
            <span>{t("notifications.timezone")}</span>
            <Input
              className="min-h-11"
              name="timezone"
              aria-invalid={timezoneError || undefined}
              aria-describedby={
                timezoneError ? `${id}-timezone-error` : undefined
              }
              value={timezone}
              maxLength={100}
              disabled={locked}
              onChange={(event) => {
                setTimezone(event.target.value);
                clear();
              }}
            />
            {timezoneError ? (
              <span
                id={`${id}-timezone-error`}
                className="block text-sm"
                role="alert"
              >
                {t("notifications.invalidTimezone")}
              </span>
            ) : null}
          </label>
          <label className="inline-flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={quiet}
              disabled={locked}
              onChange={(event) => {
                setQuiet(event.target.checked);
                clear();
              }}
            />
            {t("notifications.quiet")}
          </label>
          {quiet ? (
            <div className="flex flex-wrap gap-3">
              <label className="block space-y-2">
                <span>{t("notifications.start")}</span>
                <Input
                  className="min-h-11"
                  name="quiet-start"
                  aria-invalid={quietError || undefined}
                  aria-describedby={
                    quietError ? `${id}-quiet-error` : undefined
                  }
                  type="time"
                  value={start}
                  disabled={locked}
                  onChange={(event) => {
                    setStart(event.target.value);
                    clear();
                  }}
                />
              </label>
              <label className="block space-y-2">
                <span>{t("notifications.end")}</span>
                <Input
                  className="min-h-11"
                  name="quiet-end"
                  aria-invalid={quietError || undefined}
                  aria-describedby={
                    quietError ? `${id}-quiet-error` : undefined
                  }
                  type="time"
                  value={end}
                  disabled={locked}
                  onChange={(event) => {
                    setEnd(event.target.value);
                    clear();
                  }}
                />
              </label>
              {quietError ? (
                <p id={`${id}-quiet-error`} className="text-sm" role="alert">
                  {t("notifications.invalidQuiet")}
                </p>
              ) : null}
            </div>
          ) : null}
          {cadence === "digest" ? (
            <label className="block space-y-2">
              <span>{t("notifications.digestTime")}</span>
              <Input
                className="min-h-11"
                name="digest"
                aria-invalid={digestError || undefined}
                aria-describedby={
                  digestError ? `${id}-digest-error` : undefined
                }
                type="time"
                value={digest}
                disabled={locked}
                onChange={(event) => {
                  setDigest(event.target.value);
                  clear();
                }}
              />
              {digestError ? (
                <span
                  id={`${id}-digest-error`}
                  className="block text-sm"
                  role="alert"
                >
                  {t("notifications.invalidDigest")}
                </span>
              ) : null}
            </label>
          ) : null}
        </>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {t("notifications.summary")}
      </p>
      {!writable ? <p role="status">{t("account.policyUnavailable")}</p> : null}
      {save.isError ? <p role="alert">{t("notifications.failed")}</p> : null}
      {save.isSuccess && save.data.epoch === current.current.epoch && scope.isCurrent(save.data.accountEpoch, "notifications") ? <p role="status">{t("notifications.saved")}</p> : null}
      <Button className="min-h-11" disabled={locked}>
        {t("notifications.save")}
      </Button>
    </form>
  );
}
