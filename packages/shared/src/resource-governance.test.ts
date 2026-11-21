import { describe, expect, it } from "vitest";
import { instanceGeneralSettingsSchema } from "./validators/instance.js";
import { resourceGovernancePolicySchema } from "./resource-governance.js";
const companyId = "10000000-0000-4000-8000-000000000101";
const policy = () => ({ version: 1, pools: [{ resource: "durable_execution", unit: "active_work_item", hardLimit: 3,
  softLimit: 2, onSoftLimit: "observe", onHardLimit: "defer", exceptionOwner: "Hosting operator",
  companies: [{ companyId, hardLimit: 1, priority: 4, fairnessClass: "interactive" }] }], rates: [] });
describe("explicit measured resource policy", () => {
  it("supplies no quota or weight when the operator has configured none", () => {
    expect(instanceGeneralSettingsSchema.parse({})).not.toHaveProperty("resourceGovernance");
  });
  it("retains explicit operator values and normalizes exact company identity", () => {
    const value = policy(); value.pools[0].companies[0].companyId = companyId.toUpperCase();
    expect(resourceGovernancePolicySchema.parse(value)).toEqual(policy());
  });
  it.each(["unit", "action", "duplicate_pool", "duplicate_company", "soft", "coerced", "unknown", "missing_priority"])("rejects ambiguous policy: %s", mode => {
    const value: any = policy();
    if (mode === "unit") value.pools[0].unit = "cpu";
    if (mode === "action") value.pools[0].onHardLimit = "execute";
    if (mode === "duplicate_pool") value.pools.push(value.pools[0]);
    if (mode === "duplicate_company") value.pools[0].companies.push(value.pools[0].companies[0]);
    if (mode === "soft") value.pools[0].softLimit = 4;
    if (mode === "coerced") value.pools[0].hardLimit = "3";
    if (mode === "unknown") value.pools[0].paidBypass = true;
    if (mode === "missing_priority") delete value.pools[0].companies[0].priority;
    expect(resourceGovernancePolicySchema.safeParse(value).success).toBe(false);
  });
  it("keeps analytical lifetime distinct and rejects rate counter overflow", () => {
    const value: any = policy(); value.pools = [{ ...value.pools[0], resource: "analytical_request", unit: "admitted_request", onHardLimit: "reject" }];
    expect(resourceGovernancePolicySchema.safeParse(value).success).toBe(true);
    value.rates = [{ resource: "gateway_request", scope: "company", companyId, hardLimit: 2147483647, burst: 1,
      windowMs: 1000, onHardLimit: "reject", exceptionOwner: "Operator" }];
    expect(resourceGovernancePolicySchema.safeParse(value).success).toBe(false);
  });
});
