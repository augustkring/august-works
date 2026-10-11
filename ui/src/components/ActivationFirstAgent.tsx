import { useTranslation } from "react-i18next";
import type { ActivationView } from "@paperclipai/shared";
import { Button } from "./ui/button";
import { Link } from "../lib/router";

/** A paused original preparation, never a provider/test/activation receipt. */
export function ActivationFirstAgent({ value, canPrepare, pending, onPrepare }: {
  value: ActivationView["firstAgent"]; canPrepare: boolean; pending: boolean; onPrepare: () => void;
}) {
  const { t } = useTranslation("experience");
  if (!value || (value.status === "not_created" && !value.canPrepare)) return null;
  return <section aria-label={t("activation.firstAgentTitle")} className="space-y-3">
    <h2 className="text-lg font-semibold">{t("activation.firstAgentTitle")}</h2>
    <p>{t("activation.firstAgentBoundary")}</p>
    {value.status === "not_created" ? <Button className="min-h-11" disabled={!canPrepare || pending}
      onClick={onPrepare}>{t("activation.prepareFirstAgent")}</Button> : <>
      <p role={value.status === "unavailable" ? "alert" : "status"}>{t(`activation.firstAgentStatus.${value.status}`)}</p>
      {value.name && <p>{value.name}</p>}
      {value.agentId && <Link className="inline-flex min-h-11 items-center underline" to={`/agents/${value.agentId}/monitor`}>
        {t("activation.openPreparedAgent")}</Link>}
    </>}
  </section>;
}
