import { useTranslation } from "react-i18next";
import type { ActivationCommand, ActivationView } from "@paperclipai/shared";
import { Button } from "./ui/button";
import { Link } from "../lib/router";

export function ActivationFirstValue({
  value,
  canRecord,
  onRecord,
}: {
  value: ActivationView["firstValue"];
  canRecord: boolean;
  onRecord: (
    candidate: Pick<
      Extract<ActivationCommand, { operation: "record_verified_result" }>,
      "installationId" | "verificationRunId"
    >,
  ) => void;
}) {
  const { t } = useTranslation("experience");
  if (!value || (value.status === "not_recorded" && !value.candidates.length))
    return <p role="status">{t("activation.firstValuePending")}</p>;
  if (value.status === "withdrawn")
    return <p role="alert">{t("activation.firstValueWithdrawn")}</p>;
  if (value.status === "verified" && value.result) {
    return (
      <section
        aria-label={t("activation.verifiedResult")}
        className="space-y-3"
      >
        <h2 className="text-lg font-semibold">
          {t("activation.verifiedResult")}
        </h2>
        <Link to={`/issues/${value.result.issueId}`} className="underline">
          {value.result.title}
        </Link>
        <p>{t("activation.independentReview")}</p>
        <p>{t("activation.resultLimit")}</p>
      </section>
    );
  }
  return (
    <section
      aria-label={t("activation.chooseVerifiedResult")}
      className="space-y-3"
    >
      <h2 className="text-lg font-semibold">
        {t("activation.chooseVerifiedResult")}
      </h2>
      <p>{t("activation.resultLimit")}</p>
      {value.candidates.map((candidate) => (
        <article
          key={`${candidate.installationId}:${candidate.verificationRunId}`}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <h3 className="font-medium">{candidate.title}</h3>
          <Link to={`/issues/${candidate.issueId}`} className="underline">
            {t("activation.inspectResult")}
          </Link>
          <Button
            className="min-h-11"
            disabled={!canRecord}
            onClick={() =>
              onRecord({
                installationId: candidate.installationId,
                verificationRunId: candidate.verificationRunId,
              })
            }
          >
            {t("activation.useVerifiedResult")}
          </Button>
        </article>
      ))}
      {value.hasMore ? <p>{t("activation.moreVerifiedResults")}</p> : null}
    </section>
  );
}
