import { useTranslation } from "react-i18next";
import type { HireAgentCapability } from "@paperclipai/shared";

/** Declared package requirements, never effective access or execution evidence. */
export function HireDeclaredAccess({
  capability,
}: {
  capability: HireAgentCapability | null;
}) {
  const { t } = useTranslation("experience");
  const declared = capability?.declaredAccess;
  return (
    <section aria-label={t("hireDeclared.title")} className="space-y-3">
      <h2 className="text-lg font-semibold">{t("hireDeclared.title")}</h2>
      <p>{t("hireDeclared.boundary")}</p>
      {!declared ? (
        <p role="status">{t("hireDeclared.unavailable")}</p>
      ) : (
        <>
          <dl className="space-y-2">
            <div>
              <dt className="font-medium">{t("hireDeclared.risk")}</dt>
              <dd>{t(`hireDeclared.riskLevel.${declared.maximumRisk}`)}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("hireDeclared.memory")}</dt>
              <dd>{t(`hireDeclared.memoryPolicy.${declared.memoryPolicy}`)}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("hireDeclared.environment")}</dt>
              <dd>{t(`hireDeclared.sandbox.${declared.sandboxAssurance}`)}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("hireDeclared.runtime")}</dt>
              <dd>
                {declared.runtimeProviders
                  .map((provider) => t(`hireDeclared.provider.${provider}`))
                  .join(", ")}
              </dd>
            </div>
          </dl>
          <p>{t("hireDeclared.approval")}</p>
          <p>{t("hireDeclared.verification")}</p>
          <div>
            <h3 className="font-medium">{t("hireDeclared.optionalApps")}</h3>
            {declared.optionalConnections.length ? (
              <ul className="list-inside list-disc">
                {declared.optionalConnections.map((name, index) => (
                  <li key={index}>{name}</li>
                ))}
              </ul>
            ) : (
              <p>{t("hireDeclared.noOptionalApps")}</p>
            )}
          </div>
          <p role="status">{t("hireDeclared.scopesUnavailable")}</p>
        </>
      )}
    </section>
  );
}
