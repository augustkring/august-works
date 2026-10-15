import { useId, type ReactNode } from "react";
import { useTranslation } from "@/i18n";

/** The same bounded, already-authorized values as the visual chart. No export,
 * new query, stored preference or independent interpretation of the source. */
export function ActivityDataTable({ title, columns, rows }: {
  title: string;
  columns: { key: string; label?: string }[];
  rows: { date: string; values: ReactNode[] }[];
}) {
  const { t } = useTranslation("experience");
  const caption = useId();
  const name = t(`activityCharts.title.${title}`);
  return <details className="mt-3">
    <summary className="min-h-11 cursor-pointer py-2 text-sm underline">
      {t("activityCharts.viewData", { chart: name })}
    </summary>
    <div role="region" aria-labelledby={caption} tabIndex={0}
      className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring">
      <table className="w-full text-left text-xs tabular-nums">
        <caption id={caption} className="py-2 text-left font-medium">{name}</caption>
        <thead><tr>
          <th scope="col" className="p-2">{t("activityCharts.columns.date")}</th>
          {columns.map(column => <th key={column.key} scope="col" className="p-2">
            {t(`activityCharts.columns.${column.key}`, { defaultValue: column.label ?? column.key })}
          </th>)}
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.date} className="border-t border-border">
          <th scope="row" className="p-2 font-medium"><time dateTime={row.date}>{row.date}</time></th>
          {row.values.map((value, index) => <td key={columns[index]!.key} className="p-2">
            {value ?? t("activityCharts.noRuns")}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}
