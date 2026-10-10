import {
  decodeExperienceA2Ui,
  type ExperienceCard as CardModel,
} from "@paperclipai/shared";
import { useTranslation } from "react-i18next";
import { ExperienceCard } from "./ExperienceCard";

/** Optional offline experiment. Not mounted in the production application. */
export function ReadonlyA2UiExperienceCard({
  wire,
  currentNative,
  companyId,
  surfaceId,
}: {
  wire: unknown;
  currentNative: CardModel;
  companyId: string;
  surfaceId: string;
}) {
  const { t } = useTranslation("experience");
  let card: CardModel;
  try {
    card = decodeExperienceA2Ui(wire, currentNative, companyId, surfaceId);
  } catch {
    return (
      <p role="alert" className="text-sm text-foreground">
        {t("interopUnavailable")}
      </p>
    );
  }
  return <ExperienceCard card={card} />;
}
