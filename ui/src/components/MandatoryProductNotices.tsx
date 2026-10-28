import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TrustAcceptanceNoticeProjection } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownBody } from "@/components/MarkdownBody";
import { productNoticesApi } from "@/api/product-notices";

function MandatoryTrustNotice({ notice, userId }: { notice: TrustAcceptanceNoticeProjection; userId: string }) {
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const content = useQuery({
    queryKey: ["mandatory-trust-document-content", notice.id, notice.completion.documentRevisionId, notice.completion.version, userId],
    queryFn: ({ signal }) => productNoticesApi.content(notice, userId, signal),
    staleTime: 0,
    retry: false,
  });
  const exactContent = content.data?.document.id === notice.completion.registryEntryId &&
    content.data.document.version === notice.completion.version &&
    content.data.document.documentRevisionId === notice.completion.documentRevisionId ? content.data : null;

  async function complete() {
    if (!exactContent || !notice.canComplete || saving) return;
    setSaving(true);
    setError(null);
    try {
      await productNoticesApi.complete(notice, userId);
      await client.invalidateQueries({ queryKey: ["mandatory-trust-acceptance-notices", notice.affectedCompanyId, userId] });
      await client.invalidateQueries({ queryKey: ["trust-documents", notice.affectedCompanyId, userId] });
    } catch {
      setError(t("announcement.mandatory.acceptFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card role="alert" aria-labelledby={`mandatory-notice-${notice.id}`} className="border-amber-600/50 bg-amber-50/50 dark:bg-amber-950/20">
      <CardHeader className="pb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">{t("announcement.mandatory.eyebrow")}</p>
        <CardTitle id={`mandatory-notice-${notice.id}`} className="text-base">{notice.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{notice.summary}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {content.isPending && <p role="status" className="text-sm text-muted-foreground">{t("announcement.mandatory.loading")}</p>}
        {content.isError && <p role="alert" className="text-sm text-destructive">{t("announcement.mandatory.contentUnavailable")}</p>}
        {exactContent && <div className="max-h-96 overflow-y-auto rounded-md border bg-background p-3" aria-label={t("announcement.mandatory.documentContent")}>
          <MarkdownBody>{exactContent.body}</MarkdownBody>
        </div>}
        <p className="text-xs text-muted-foreground">{t("announcement.mandatory.version", { version: notice.completion.version })}</p>
        <Button type="button" onClick={() => void complete()} disabled={!exactContent || !notice.canComplete || saving}>
          {saving ? t("announcement.mandatory.completing") : notice.completion.owner === "trust_document_acceptance"
            ? t("announcement.mandatory.accept") : notice.completion.owner === "trust_document_notice_read"
              ? t("announcement.mandatory.markRead") : t("announcement.mandatory.adminAcknowledge")}
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function MandatoryProductNotices({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const { t } = useTranslation("experience");
  const query = useQuery({
    queryKey: ["mandatory-trust-acceptance-notices", companyId, userId],
    queryFn: ({ signal }) => productNoticesApi.actionRequired(companyId!, userId!, signal),
    enabled: Boolean(companyId && userId),
    retry: false,
    refetchInterval: 60_000,
  });
  if (!companyId || !userId || query.data?.notices.length === 0) return null;
  if (query.isError) return <aside role="alert" className="border-t bg-amber-50/50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">{t("announcement.mandatory.unavailable")}</aside>;
  const notices = query.data?.notices ?? [];
  return <aside aria-label={t("announcement.mandatory.landmark")} className="space-y-2 border-t bg-background p-2 md:px-3">
    {notices.map(notice => <MandatoryTrustNotice key={notice.id} notice={notice} userId={userId} />)}
  </aside>;
}
