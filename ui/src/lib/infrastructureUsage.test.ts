import { describe, expect, it } from "vitest";
import { formatInfrastructureUsage, formatStorageBytes } from "./infrastructureUsage";

describe("customer infrastructure units", () => {
  it("converts exact duration and byte-time to hours and the selected calendar month", () => {
    expect(formatInfrastructureUsage({meterKey:"runtime.shared_millisecond",quantity:"5400000"},"2026-10-01").value).toBe("1.50 hours");
    for(const [month,days] of [["2026-02-01",28],["2028-02-01",29],["2026-10-01",31]] as const) {
      const quantity=1000000000n*BigInt(days)*86400000n;
      expect(formatInfrastructureUsage({meterKey:"storage.byte_millisecond",quantity:quantity.toString()},month).value).toBe("1.00 GB-month");
    }
  });
  it("preserves quantities larger than JavaScript number precision",()=>{
    expect(formatStorageBytes("9007199254740993000000")).toBe("9007199254.74 TB");
    expect(formatStorageBytes("1073741824")).toBe("1.07 GB");
    expect(formatStorageBytes("0")).toBe("0 B");
  });
});
