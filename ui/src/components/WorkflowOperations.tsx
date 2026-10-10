import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { WorkflowExperience } from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { Button } from "./ui/button";
import { Link } from "../lib/router";

/** Mounted only inside a current authorized parent read; no retained fallback. */
export function WorkflowOperations({
  company,
  principal,
  detail,
  refresh,
}: {
  company: string;
  principal: string;
  detail: WorkflowExperience;
  refresh: () => void;
}) {
  const { t, i18n } = useTranslation("experience");
  const query = useQuery({
    queryKey: [
      "workflow-operations",
      company,
      principal,
      detail.id,
      detail.updatedAt,
    ],
    queryFn: async ({ signal }) => {
      const result = await workflowsApi.operations(
        company,
        principal,
        detail.id,
        signal,
      );
      if (
        result.updatedAt !== detail.updatedAt ||
        result.publishedRevisionId !== (detail.active?.id ?? null) ||
        result.status !== detail.status
      )
        throw new Error(
          "Workflow overview changed; refresh the current workflow",
        );
      return result;
    },
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));
  const data =
    !query.isPending && !query.isFetching && !query.isError
      ? query.data
      : undefined;
  return (
    <section
      aria-labelledby="workflow-operations"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h2 id="workflow-operations" className="text-lg font-medium">
        {t("workflowOperationsTitle")}
      </h2>
      {query.isError ? (
        <div role="alert" className="space-y-3">
          <p>{t("workflowOperationsFailed")}</p>
          <Button className="min-h-11" onClick={refresh}>
            {t("tryAgain")}
          </Button>
        </div>
      ) : !data ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {data.blockers.runs.length > 0 && (
            <p role="status">{t("workflowNeedsAttention")}</p>
          )}
          <h3 className="font-medium">{t("workflowNextTrigger")}</h3>
          <p>
            {data.nextTrigger.state === "scheduled"
              ? t("workflowTriggerScheduled", { at: date(data.nextTrigger.at) })
              : t(`workflowTrigger.${data.nextTrigger.state}`)}
          </p>
          {data.nextTrigger.state === "scheduled" && (
            <p className="text-sm text-muted-foreground">
              {t("workflowTriggerBoundary")}
            </p>
          )}
          <h3 className="font-medium">{t("workflowOpenBlockers")}</h3>
          {data.blockers.runs.length === 0 ? (
            <p>{t("workflowNoBlockers")}</p>
          ) : (
            <ul className="space-y-2">
              {data.blockers.runs.map((run) => (
                <li key={run.id}>
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    to={`/workflows/${detail.id}/runs/${run.id}`}
                  >
                    {t(`workflowRunStatus.${run.status}`)} ·{" "}
                    {date(run.createdAt)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.blockers.hasMore && <p>{t("workflowMoreBlockers")}</p>}
          <h3 className="font-medium">{t("workflowRecentRuns")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("workflowRecentBoundary")}
          </p>
          {data.recent.runs.length === 0 ? (
            <p>{t("workflowNoRecentRuns")}</p>
          ) : (
            <ol className="space-y-2">
              {data.recent.runs.map((run) => (
                <li key={run.id}>
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    to={`/workflows/${detail.id}/runs/${run.id}`}
                  >
                    {t(`workflowRunStatus.${run.status}`)} ·{" "}
                    {date(run.createdAt)}
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {data.recent.hasMore && <p>{t("workflowMoreRecentRuns")}</p>}
          <Button className="min-h-11" variant="outline" onClick={refresh}>
            {t("workflowRunRefresh")}
          </Button>
        </>
      )}
    </section>
  );
}
