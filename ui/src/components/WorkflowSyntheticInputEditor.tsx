import { useTranslation } from "../i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import type { WorkflowSyntheticInput } from "@paperclipai/shared";
import { useLayoutEffect, useRef } from "react";

export type SyntheticInputRow = { id: string; path: string; valueType: "string" | "number" | "boolean" | "null"; value: string };
export const syntheticInputRows = (rows: SyntheticInputRow[]): WorkflowSyntheticInput => rows.map(row => ({ path: row.path.split("\n"),
  value: row.valueType === "null" ? null : row.valueType === "boolean" ? row.value === "true" : row.valueType === "number" ? row.value.trim() ? Number(row.value) : NaN : row.value }));
export function WorkflowSyntheticInputEditor({ rows, change, disabled, errors }: {
  rows: SyntheticInputRow[]; change: (rows: SyntheticInputRow[]) => void; disabled: boolean; errors: Record<string, string>;
}) {
  const { t } = useTranslation("experience"), selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline focus-visible:outline-ring";
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => { if (pendingFocus.current) { document.getElementById(`test-input-${pendingFocus.current}-path`)?.focus(); pendingFocus.current = null; } }, [rows]);
  const update = (id: string, patch: Partial<SyntheticInputRow>) => change(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  return <section className="space-y-4" aria-labelledby="workflow-test-input-title"><h3 id="workflow-test-input-title" className="font-medium">{t("workflowTestInputs.heading")}</h3>
    <p className="text-sm text-muted-foreground">{t("workflowTestInputs.boundary")}</p>
    {rows.map((row, index) => {
      const base = `test-input-${row.id}`, props = (field: "path" | "value") => ({ id: `${base}-${field}`, "aria-labelledby": `${base}-${field}-label`,
        "aria-invalid": !!errors[`${index}.${field}`], "aria-describedby": errors[`${index}.${field}`] ? `${base}-${field}-error` : undefined });
      const error = (field: "path" | "value") => errors[`${index}.${field}`] ? <p id={`${base}-${field}-error`} className="text-sm text-destructive">{errors[`${index}.${field}`]}</p> : null;
      return <fieldset key={row.id} disabled={disabled} className="space-y-3 rounded-md border border-border p-3"><legend className="px-1">{t("workflowTestInputs.row", { number: index + 1 })}</legend>
        <label className="block space-y-2"><span id={`${base}-path-label`}>{t("workflowTestInputs.path")}</span><Textarea {...props("path")} required value={row.path} onChange={event => update(row.id, { path: event.target.value })} />{error("path")}</label>
        <label className="block space-y-2"><span id={row.valueType === "null" ? `${base}-value-label` : undefined}>{t("workflowTestInputs.valueType")}</span>
          <select {...row.valueType === "null" ? props("value") : {}} className={selectClass} value={row.valueType} onChange={event => update(row.id, { valueType: event.target.value as SyntheticInputRow["valueType"], value: event.target.value === "boolean" ? "true" : "" })}>
            {["string", "number", "boolean", "null"].map(value => <option key={value} value={value}>{t(`workflowDraftStep.condition.types.${value}`)}</option>)}
          </select></label>
        {row.valueType !== "null" && <label className="block space-y-2"><span id={`${base}-value-label`}>{t("workflowTestInputs.value")}</span>
          {row.valueType === "boolean" ? <select {...props("value")} className={selectClass} value={row.value} onChange={event => update(row.id, { value: event.target.value })}><option value="true">{t("workflowDraftStep.condition.true")}</option><option value="false">{t("workflowDraftStep.condition.false")}</option></select>
            : <Input {...props("value")} className="min-h-11" type={row.valueType === "number" ? "number" : "text"} step="any" maxLength={1000} value={row.value} onChange={event => update(row.id, { value: event.target.value })} />}{error("value")}</label>}
        {row.valueType === "null" && error("value")}
        <Button type="button" variant="outline" className="min-h-11" onClick={() => change(rows.filter(value => value.id !== row.id))}>{t("workflowTestInputs.remove", { number: index + 1 })}</Button>
      </fieldset>;
    })}
    <Button type="button" variant="outline" className="min-h-11" disabled={disabled || rows.length >= 20} onClick={() => { const id = crypto.randomUUID(); pendingFocus.current = id; change([...rows, { id, path: "", valueType: "string", value: "" }]); }}>{t("workflowTestInputs.add")}</Button>
  </section>;
}
