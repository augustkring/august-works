import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

const MAX_SCHEMA_BYTES = 32 * 1024;
const MAX_ERROR_ITEMS = 8;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
  allowUnionTypes: true,
  loadSchema: undefined,
});
addFormats(ajv);

const cache = new Map<string, ValidateFunction>();

export class WorkflowOutputSchemaError extends Error {
  readonly code:
    | "workflow_output_schema_invalid"
    | "workflow_output_schema_mismatch";
  readonly validationErrors: Array<{
    instancePath: string;
    keyword: string;
    message: string | null;
  }>;

  constructor(input: {
    code:
      | "workflow_output_schema_invalid"
      | "workflow_output_schema_mismatch";
    message: string;
    validationErrors?: ErrorObject[] | null;
  }) {
    super(input.message);
    this.name = "WorkflowOutputSchemaError";
    this.code = input.code;
    this.validationErrors = (input.validationErrors ?? [])
      .slice(0, MAX_ERROR_ITEMS)
      .map((error) => ({
        instancePath: error.instancePath,
        keyword: error.keyword,
        message: error.message ?? null,
      }));
  }
}

function schemaKey(schema: Record<string, unknown>): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    throw new WorkflowOutputSchemaError({
      code: "workflow_output_schema_invalid",
      message: "Workflow output schema must be JSON-serializable",
    });
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_BYTES) {
    throw new WorkflowOutputSchemaError({
      code: "workflow_output_schema_invalid",
      message: "Workflow output schema exceeds the 32 KiB limit",
    });
  }
  return serialized;
}

function assertNoRemoteRefs(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertNoRemoteRefs(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      if (!child.startsWith("#")) {
        throw new WorkflowOutputSchemaError({
          code: "workflow_output_schema_invalid",
          message: `Remote JSON Schema references are not supported at ${path}.$ref`,
        });
      }
    }
    assertNoRemoteRefs(child, `${path}.${key}`);
  }
}

function validatorFor(
  schema: Record<string, unknown>,
): ValidateFunction {
  assertNoRemoteRefs(schema);
  const key = schemaKey(schema);
  const cached = cache.get(key);
  if (cached) return cached;

  let validate: ValidateFunction;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    throw new WorkflowOutputSchemaError({
      code: "workflow_output_schema_invalid",
      message:
        error instanceof Error
          ? `Invalid workflow output schema: ${error.message}`
          : "Invalid workflow output schema",
    });
  }
  cache.set(key, validate);
  if (cache.size > 256) {
    const oldest = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
  }
  return validate;
}

export function validateWorkflowOutput(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
): void {
  if (!schema) return;
  const validate = validatorFor(schema);
  if (validate(value)) return;
  throw new WorkflowOutputSchemaError({
    code: "workflow_output_schema_mismatch",
    message: "Workflow step output does not match its expected output schema",
    validationErrors: validate.errors,
  });
}
