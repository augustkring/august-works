import { Link } from "@/lib/router";
import { useTranslation } from "@/i18n";
import { Button } from "./ui/button";
import { MarkdownBody } from "./MarkdownBody";

/** The Original instructions owner supplies this read-only body. Editing
 * starts a private draft; the active version stays in place during its test. */
export function PublishedAgentInstructions({ agentId, content, checking }: {
  agentId: string; content: string | null; checking: boolean;
}) {
  const { t } = useTranslation("experience");
  return <section className="space-y-4" aria-label={t("publishedInstructions.title")}>
    <h2 className="text-lg font-semibold">{t("publishedInstructions.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("publishedInstructions.boundary")}</p>
    <Button asChild variant="outline" className="min-h-11"><Link to={`/agents/custom?agentId=${encodeURIComponent(agentId)}`}>{t("publishedInstructions.editDraft")}</Link></Button>
    {checking ? <p role="status">{t("publishedInstructions.checking")}</p> : content === null ?
      <p role="status">{t("publishedInstructions.unavailable")}</p> : <MarkdownBody className="text-sm">{content}</MarkdownBody>}
  </section>;
}
