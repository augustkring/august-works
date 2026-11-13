import { Ajv, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

// MCP tool input schemas default to JSON Schema 2020-12, but servers may
// declare draft-07 explicitly (for example zod's `target: "draft-7"`). Ajv's
// 2020 instance does not know the draft-07 meta-schema and throws while the
// bridge starts, so compile each schema with the dialect it declares. Any other
// declared dialect still fails closed in the 2020-12 compiler.
const DRAFT_07_META_SCHEMAS = new Set([
  "http://json-schema.org/draft-07/schema#",
  "http://json-schema.org/draft-07/schema",
]);

export function createToolInputSchemaCompiler(): (schema: Record<string, unknown>) => ValidateFunction {
  const draft2020 = new Ajv2020({ allErrors: true, strict: false });
  let draft07: Ajv | null = null;
  return (schema) => {
    if (typeof schema.$schema === "string" && DRAFT_07_META_SCHEMAS.has(schema.$schema)) {
      draft07 ??= new Ajv({ allErrors: true, strict: false });
      return draft07.compile(schema);
    }
    return draft2020.compile(schema);
  };
}
