import type { ExperienceCard as CardModel } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { useTranslation } from "react-i18next";
/** Text and typed links only; models cannot supply HTML, handlers or arbitrary React. */
export function ExperienceCard({
  card,
  headingLevel = 3,
}: {
  card: CardModel;
  headingLevel?: 2 | 3;
}) {
  const { t } = useTranslation("experience");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article
      className="space-y-2 rounded-lg border border-border bg-card p-4"
      aria-label={card.title}
    >
      <Heading className="font-medium text-foreground">{card.title}</Heading>
      {card.whyYou && <p className="text-sm text-foreground">{card.whyYou}</p>}
      {card.consequence && (
        <p className="text-sm text-muted-foreground">{card.consequence}</p>
      )}
      {card.evidence.length > 0 && (
        <ul className="text-sm text-muted-foreground">
          {card.evidence.map((item, i) => (
            <li key={i}>
              {card.source.domain === "task"
                ? t(`taskStatus.${item}`, { defaultValue: item })
                : item}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {card.actions
          .filter((action) => action.operation === "open")
          .map((action) => (
            <Link
              key={action.id}
              to={action.href}
              className="inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-ring"
            >
              {action.labelKey
                ? t(`cardAction.${action.labelKey}`)
                : action.label}
            </Link>
          ))}
      </div>
      {card.freshness !== "fresh" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("refreshRequired")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("checkedAt", {
          time: new Date(card.source.observedAt).toLocaleTimeString(),
        })}
      </p>
    </article>
  );
}
