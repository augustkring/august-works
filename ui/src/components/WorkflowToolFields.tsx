import type { WorkflowToolField } from "@paperclipai/shared";
import { useTranslation } from "../i18n";
import { Input } from "./ui/input";

export type WorkflowToolFormValues = Record<string, { include: boolean; value: string }>;
export function workflowToolFormInitial(fields: WorkflowToolField[], input: Record<string, unknown> = {}): WorkflowToolFormValues {
  return Object.fromEntries(fields.map(field => [field.name, { include: field.required || Object.hasOwn(input, field.name),
    value: Object.hasOwn(input, field.name) ? String(input[field.name]) : "" }]));
}
export function workflowToolFormInput(fields: WorkflowToolField[], values: WorkflowToolFormValues) {
  return Object.fromEntries(fields.filter(field => values[field.name]?.include).map(field => {
    const value = values[field.name].value;
    return [field.name, field.type === "string" ? value : field.type === "boolean" ? value === "true" ? true : value === "false" ? false : NaN : value.trim() ? Number(value) : NaN];
  })) as Record<string, string | number | boolean>;
}
/** Explicit current fields shared by composition and selected-step editing.
 * The caller owns Source fencing, validation, request recovery and save. */
export function WorkflowToolFields({ idPrefix, fields, values, errors, onChange }: {
  idPrefix: string; fields: WorkflowToolField[]; values: WorkflowToolFormValues;
  errors: Partial<Record<string, string>>; onChange: (values: WorkflowToolFormValues) => void;
}) {
  const { t } = useTranslation("experience"), group = `${idPrefix}-toolInputs`;
  const selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline focus-visible:outline-ring";
  return <fieldset id={group} tabIndex={-1} aria-labelledby={`${group}-label`} aria-invalid={!!errors.toolInputs}
    aria-describedby={errors.toolInputs ? `${group}-error` : undefined} className="space-y-4">
    <legend id={`${group}-label`} className="font-medium">{t("workflowDraftFlow.tool.inputs")}</legend>
    {errors.toolInputs && <p id={`${group}-error`} className="text-sm text-destructive">{errors.toolInputs}</p>}
    {fields.map(field => {
      const key = `tool_${field.name}`, id = `${idPrefix}-${key}`, value = values[field.name] ?? { include: field.required, value: "" };
      const update = (patch: Partial<typeof value>) => onChange({ ...values, [field.name]: { ...value, ...patch } });
      const props = { id, "aria-labelledby": `${id}-label`, "aria-invalid": !!errors[key],
        "aria-describedby": [errors[key] ? `${id}-error` : null, field.help ? `${id}-help` : null].filter(Boolean).join(" ") || undefined };
      return <div key={field.name} className="space-y-2">
        {!field.required && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={value.include} onChange={event => update({ include: event.target.checked })} /><span>{t("workflowDraftFlow.tool.include", { name: field.label })}</span></label>}
        <label className="block space-y-2"><span id={`${id}-label`}>{field.label}</span>
          {field.options || field.type === "boolean" ? <select {...props} className={selectClass} disabled={!value.include} required={field.required} value={value.value} onChange={event => update({ value: event.target.value })}>
            <option value="">{t("workflowDraftFlow.tool.valuePlaceholder")}</option>
            {(field.options ?? [true, false]).map(option => <option key={String(option)} value={String(option)}>{typeof option === "boolean" ? t(option ? "workflowDraftStep.condition.true" : "workflowDraftStep.condition.false") : String(option)}</option>)}
          </select> : <Input {...props} className="min-h-11" disabled={!value.include} required={field.required} type={field.type === "string" ? "text" : "number"}
            step={field.type === "integer" ? 1 : "any"} min={field.minimum ?? undefined} max={field.maximum ?? undefined} maxLength={Math.min(field.maxLength ?? 4000, 4000)} value={value.value} onChange={event => update({ value: event.target.value })} />}
        </label>{errors[key] && <p id={`${id}-error`} className="text-sm text-destructive">{errors[key]}</p>}{field.help && <p id={`${id}-help`} className="text-sm text-muted-foreground">{field.help}</p>}
      </div>;
    })}
  </fieldset>;
}
