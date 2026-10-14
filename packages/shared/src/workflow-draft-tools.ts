import { z } from "zod";

const key = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,159}$/).refine(value => !["__proto__", "constructor", "prototype"].includes(value) && !/password|secret|token|api_?key|credential|authorization/i.test(value));
export const workflowToolArgumentSchema = z.union([z.string().max(4000), z.number().finite(), z.boolean()]);
export const workflowToolArgumentsSchema = z.record(key, workflowToolArgumentSchema).superRefine((value, ctx) => {
  if (Object.keys(value).length > 20 || new TextEncoder().encode(JSON.stringify(value)).byteLength > 8192)
    ctx.addIssue({ code: "custom", message: "Use at most 20 fields and 8192 bytes" });
});
export const workflowToolFieldSchema = z.strictObject({ name: key, label: z.string().min(1).max(200), help: z.string().max(600).nullable(),
  type: z.enum(["string", "number", "integer", "boolean"]), required: z.boolean(), options: z.array(workflowToolArgumentSchema).max(20).nullable(),
  minLength: z.number().int().nonnegative().nullable(), maxLength: z.number().int().nonnegative().nullable(), minimum: z.number().finite().nullable(), maximum: z.number().finite().nullable(),
});
export const workflowDraftToolChoiceSchema = z.strictObject({ entryId: z.uuid(), connectionId: z.uuid(), connectionName: z.string().min(1).max(200),
  name: z.string().min(1).max(200), versionHash: z.string().min(1).max(200), schemaHash: z.string().min(1).max(200), inputSchemaHash: z.string().regex(/^[a-f0-9]{64}$/),
  fields: z.array(workflowToolFieldSchema).max(20), effect: z.enum(["pure", "read", "write", "destructive", "external_communication", "financial", "privileged"]),
  access: z.enum(["permission_required", "execution_check"]),
});
export type WorkflowToolField = z.infer<typeof workflowToolFieldSchema>;
export type WorkflowDraftToolChoice = z.infer<typeof workflowDraftToolChoiceSchema>;

/** Only a fully representable scalar object. Hidden defaults, references,
 * credential fields, nested/conditional schemas stay with Original Advanced. */
export function workflowToolFields(schema: unknown): WorkflowToolField[] | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  try { if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > 32768) return null; } catch { return null; }
  const root = schema as Record<string, unknown>;
  if (Object.keys(root).some(name => !["$schema", "type", "title", "description", "properties", "required", "additionalProperties"].includes(name)) ||
    root.type !== "object" || root.additionalProperties !== undefined && typeof root.additionalProperties !== "boolean" ||
    root.required !== undefined && (!Array.isArray(root.required) || root.required.some(value => typeof value !== "string"))) return null;
  const properties = root.properties ?? {};
  if (!properties || typeof properties !== "object" || Array.isArray(properties) || Object.keys(properties).length > 20) return null;
  const required = root.required as string[] | undefined;
  if (required?.some(name => !Object.hasOwn(properties, name)) || required && new Set(required).size !== required.length) return null;
  const fields: WorkflowToolField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const field = raw as Record<string, unknown>;
    if (Object.keys(field).some(name => !["type", "title", "description", "enum", "minLength", "maxLength", "minimum", "maximum"].includes(name))) return null;
    const parsed = workflowToolFieldSchema.safeParse({ name, label: field.title ?? name, help: field.description ?? null,
      type: field.type, required: required?.includes(name) ?? false, options: field.enum ?? null,
      minLength: field.minLength ?? null, maxLength: field.maxLength ?? null, minimum: field.minimum ?? null, maximum: field.maximum ?? null });
    if (!parsed.success) return null;
    const value = parsed.data;
    if (value.type === "boolean" && (value.minimum !== null || value.maximum !== null) || value.minLength !== null && value.minLength > 4000 ||
      value.minLength !== null && value.maxLength !== null && value.minLength > value.maxLength || value.minimum !== null && value.maximum !== null && value.minimum > value.maximum) return null;
    if (value.type === "string" ? value.minimum !== null || value.maximum !== null : value.minLength !== null || value.maxLength !== null) return null;
    if (value.options && (!value.options.length || value.options.some(option => value.type === "string" ? typeof option !== "string"
      : value.type === "boolean" ? typeof option !== "boolean" : typeof option !== "number" || value.type === "integer" && !Number.isSafeInteger(option)))) return null;
    fields.push(value);
  }
  return fields;
}

export function workflowToolArgumentErrors(fields: WorkflowToolField[], values: Record<string, unknown>): string[] {
  const errors = Object.keys(values).filter(name => !fields.some(field => field.name === name));
  for (const field of fields) {
    if (!Object.hasOwn(values, field.name)) { if (field.required) errors.push(field.name); continue; }
    const value = values[field.name];
    if (field.type === "string" ? typeof value !== "string" || value.length > 4000 ||
        field.minLength !== null && [...value].length < field.minLength || field.maxLength !== null && [...value].length > field.maxLength
      : field.type === "boolean" ? typeof value !== "boolean"
        : typeof value !== "number" || !Number.isFinite(value) || field.type === "integer" && !Number.isSafeInteger(value) ||
          field.minimum !== null && value < field.minimum || field.maximum !== null && value > field.maximum) errors.push(field.name);
    else if (field.options && !field.options.some(option => Object.is(option, value))) errors.push(field.name);
  }
  return [...new Set(errors)];
}
