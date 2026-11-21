import { useCallback } from "react";
import { useTranslation } from "../i18n";
import { formatCents } from "../lib/utils";

/** Recorded amounts exclude unpriced usage, so zero does not mean free. */
export function useCostFormatting() {
  const { t } = useTranslation("experience");
  return useCallback((cents: number, unpricedEventCount = 0): string => unpricedEventCount > 0
    ? t(cents === 0 ? "costPricing.unknown" : "costPricing.partial", { amount: formatCents(cents), count: unpricedEventCount })
    : formatCents(cents), [t]);
}
