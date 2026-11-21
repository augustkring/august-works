import {Ajv2020} from "ajv/dist/2020.js";
import {expect,it} from "vitest";
import {MANAGEMENT_ANALYTICAL_TOOL_DEFINITIONS} from "./management-analytical-tools.js";

it("compiles management tools with the actual OpenCode MCP schema dialect and rejects injected authority",()=>{
  const ajv=new Ajv2020({allErrors:true,strict:false});
  const validators=new Map(MANAGEMENT_ANALYTICAL_TOOL_DEFINITIONS.map(tool=>[tool.name,ajv.compile(tool.inputSchema)]));
  const validate=validators.get("query_business_metric");
  if(!validate)throw new Error("Metric query schema missing");
  const query={metricId:"00000000-0000-4000-8000-000000000001",versionId:"00000000-0000-4000-8000-000000000002",
    from:"2026-10-01T00:00:00.000Z",until:"2026-10-02T00:00:00.000Z",dimensions:[],maxRows:100};
  expect(validate(query)).toBe(true);
  expect(validate({...query,responsibleUserId:"untrusted-input"})).toBe(false);
  expect(validate({...query,maxRows:10001})).toBe(false);
});
