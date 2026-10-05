export function formatStorageBytes(value: string) {
  const bytes = BigInt(value);
  if (bytes < 1000n) return bytes.toString() + " B";
  const units = [[1000000000000n, "TB"], [1000000000n, "GB"], [1000000n, "MB"], [1000n, "kB"]] as const;
  const [divisor, unit] = units.find(([divisor]) => bytes >= divisor)!;
  const hundredths = bytes * 100n / divisor;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")} ${unit}`;
}

export function formatInfrastructureUsage(
  meter: { meterKey: string; quantity: string },
  periodStart: string,
) {
  const quantity = BigInt(meter.quantity);
  function decimal(divisor: bigint) {
    const hundredths = (quantity * 100n) / divisor;
    return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`;
  }
  const names: Record<string, string> = {
    "runtime.shared_millisecond": "Managed runtime",
    "runtime.dedicated_gateway_millisecond": "Dedicated agent Gateway",
    "runtime.dedicated_vm_millisecond": "Dedicated virtual machine",
  };
  if (names[meter.meterKey])
    return {
      label: names[meter.meterKey],
      value: decimal(3600000n) + " hours",
    };
  if (meter.meterKey === "storage.byte_millisecond") {
    const start = new Date(periodStart),
      monthStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
      monthEnd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
    return {
      label: "Application storage",
      value: decimal(1000000000n * BigInt(monthEnd - monthStart)) + " GB-month",
    };
  }
  return {
    label: "Infrastructure consumption",
    value: quantity.toString() + " units",
  };
}
