import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@/i18n";
import { saasApi } from "../api/saas";
import { ApiError } from "../api/client";
import { Button } from "./ui/button";

/** The private HttpOnly receipt cookie grants only this operation's status. */
export function PersonalAccountDeletionReceipt({ requested }: { requested: boolean }) {
  const { t, i18n } = useTranslation("experience");
  const instance = useId();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const receipt = useQuery({
    queryKey: ["personal-account-deletion-receipt", instance],
    queryFn: ({ signal }) => saasApi.accountDeletionReceipt(signal),
    retry: false, gcTime: 0, staleTime: 0,
    refetchInterval: query => query.state.status === "success" && query.state.data?.status !== "completed" ? 15_000 : false,
  });
  if (!requested && !receipt.isSuccess) return null;
  const missing = receipt.error instanceof ApiError && receipt.error.status === 404;
  const download = () => {
    if (!receipt.isSuccess || receipt.isFetching) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify({ savedAt: new Date().toISOString(), receipt: receipt.data }, null, 2)],
        { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = "personal-account-deletion-receipt.json"; anchor.click();
      setDownloadFailed(false);
    } catch { setDownloadFailed(true); }
    finally { if (url) URL.revokeObjectURL(url); }
  };
  return <section className="saas-section" aria-labelledby={instance} aria-busy={receipt.isFetching}>
    <h2 id={instance} className="saas-subtitle">{t("authFlow.receipt.heading")}</h2>
    {receipt.isFetching ? <p role="status" className="saas-muted">{t("authFlow.receipt.loading")}</p> :
      receipt.isSuccess ? <>
        <p role="status">{t(`authFlow.receipt.status.${receipt.data.status}`)}</p>
        <p className="saas-muted">{t("authFlow.receipt.scope")}</p>
        <p className="saas-machine">{t("authFlow.receipt.requestId", { id: receipt.data.id })}</p>
        <p className="saas-muted">{t("authFlow.receipt.requestedAt", { date: new Date(receipt.data.createdAt).toLocaleString(i18n.resolvedLanguage) })}</p>
        {receipt.data.completedAt && <p className="saas-muted">{t("authFlow.receipt.completedAt", { date: new Date(receipt.data.completedAt).toLocaleString(i18n.resolvedLanguage) })}</p>}
        <Button type="button" variant="outline" onClick={download}>{t("authFlow.receipt.download")}</Button>
        {downloadFailed && <p role="alert">{t("authFlow.receipt.downloadFailed")}</p>}
      </> : <p role="alert" className="saas-muted">{t(missing ? "authFlow.receipt.unavailable" : "authFlow.receipt.failed")}</p>}
    {!receipt.isFetching && receipt.data?.status !== "completed" && <Button type="button" variant="outline" onClick={() => { void receipt.refetch(); }}>{t("account.retry")}</Button>}
  </section>;
}
