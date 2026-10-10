import { useTranslation } from "react-i18next";
import {
  parseExperienceToolCardRequest,
  resolveExperienceToolCard,
  type ExperienceToolCardRequest,
} from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useExperience } from "../hooks/useExperience";
import { ExperienceCard } from "./ExperienceCard";
import { Button } from "./ui/button";

export type ExperienceToolState = "loading" | "ready" | "error";
function CurrentCard({ request }: { request: ExperienceToolCardRequest }) {
  const { t } = useTranslation("experience");
  const { query, loading, retry } = useExperience(request.companyId);
  if (loading) return <p role="status">{t("toolCard.loading")}</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-2">
        <p>{t("toolCard.unavailable")}</p>
        <Button
          className="min-h-11"
          variant="outline"
          onClick={() => void retry()}
        >
          {t("tryAgain")}
        </Button>
      </div>
    );
  try {
    if (!query.data) throw new Error("Current card unavailable");
    return (
      <ExperienceCard card={resolveExperienceToolCard(request, query.data)} />
    );
  } catch {
    return <p role="alert">{t("toolCard.unavailable")}</p>;
  }
}

/** Agent arguments/results never supply HTML, titles, links, effects or account identity. */
export function ExperienceToolCard({
  wire,
  state,
}: {
  wire: unknown;
  state: ExperienceToolState;
}) {
  const { t } = useTranslation("experience");
  const { selectedCompanyId } = useCompany();
  const flags = useV9FeatureEnabled("action_cards_v9");
  if (state === "error" || flags.query.isError)
    return <p role="alert">{t("toolCard.unavailable")}</p>;
  if (state === "loading" || flags.query.isPending || flags.query.isFetching)
    return <p role="status">{t("toolCard.loading")}</p>;
  let request: ExperienceToolCardRequest;
  try {
    request = parseExperienceToolCardRequest(wire);
  } catch {
    return <p role="alert">{t("toolCard.unavailable")}</p>;
  }
  if (!flags.enabled || request.companyId !== selectedCompanyId)
    return <p role="alert">{t("toolCard.unavailable")}</p>;
  return (
    <CurrentCard
      key={`${selectedCompanyId}:${request.cardId}:${request.source.version}`}
      request={request}
    />
  );
}
