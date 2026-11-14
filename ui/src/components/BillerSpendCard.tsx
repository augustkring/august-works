import { useCostFormatting } from "../hooks/useCostFormatting";
import { useTranslation } from "../i18n";
import { useMemo } from "react";
import type { CostByBiller, CostByProviderModel } from "@paperclipai/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { QuotaBar } from "./QuotaBar";
import { billingTypeDisplayName, formatTokens, providerDisplayName } from "@/lib/utils";

interface BillerSpendCardProps {
  row: CostByBiller;
  weekSpendCents: number;
  weekUnpricedEventCount: number;
  budgetMonthlyCents: number;
  totalCompanySpendCents: number;
  providerRows: CostByProviderModel[];
}

export function BillerSpendCard({
  row,
  weekSpendCents,
  weekUnpricedEventCount,
  budgetMonthlyCents,
  totalCompanySpendCents,
  providerRows,
}: BillerSpendCardProps) {
  const formatCost = useCostFormatting();
  const { t } = useTranslation("experience");
  const providerBreakdown = useMemo(() => {
    const map = new Map<string, { provider: string; costCents: number; unpricedEventCount: number; inputTokens: number; outputTokens: number }>();
    for (const entry of providerRows) {
      const current = map.get(entry.provider) ?? {
        provider: entry.provider,
        costCents: 0,
        unpricedEventCount: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      current.costCents += entry.costCents;
      current.unpricedEventCount += entry.unpricedEventCount ?? 0;
      current.inputTokens += entry.inputTokens + entry.cachedInputTokens;
      current.outputTokens += entry.outputTokens;
      map.set(entry.provider, current);
    }
    return Array.from(map.values()).sort((a, b) => b.costCents - a.costCents);
  }, [providerRows]);

  const billingTypeBreakdown = useMemo(() => {
    const map = new Map<string, { costCents: number; unpricedEventCount: number }>();
    for (const entry of providerRows) {
      const current = map.get(entry.billingType) ?? { costCents: 0, unpricedEventCount: 0 };
      current.costCents += entry.costCents;
      current.unpricedEventCount += entry.unpricedEventCount ?? 0;
      map.set(entry.billingType, current);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].costCents - a[1].costCents);
  }, [providerRows]);

  const providerBudgetShare =
    budgetMonthlyCents > 0 && totalCompanySpendCents > 0
      ? (row.costCents / totalCompanySpendCents) * budgetMonthlyCents
      : budgetMonthlyCents;
  const budgetPct =
    providerBudgetShare > 0
      ? Math.min(100, (row.costCents / providerBudgetShare) * 100)
      : 0;

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-0 gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold">
              {providerDisplayName(row.biller)}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              <span className="font-mono">{formatTokens(row.inputTokens + row.cachedInputTokens)}</span> in
              {" · "}
              <span className="font-mono">{formatTokens(row.outputTokens)}</span> out
              {" · "}
              {row.providerCount} provider{row.providerCount === 1 ? "" : "s"}
              {" · "}
              {row.modelCount} model{row.modelCount === 1 ? "" : "s"}
            </CardDescription>
          </div>
          <span className="text-xl font-bold tabular-nums shrink-0">
            {formatCost(row.costCents, row.unpricedEventCount)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-3 space-y-4">
        {budgetMonthlyCents > 0 && (row.unpricedEventCount ?? 0) === 0 && (
          <QuotaBar
            label="Period spend"
            percentUsed={budgetPct}
            leftLabel={formatCost(row.costCents, row.unpricedEventCount)}
            rightLabel={`${Math.round(budgetPct)}% of allocation`}
          />
        )}

        <div className="text-xs text-muted-foreground">
          {row.apiRunCount > 0 ? `${row.apiRunCount} metered run${row.apiRunCount === 1 ? "" : "s"}` : "0 metered runs"}
          {" · "}
          {row.subscriptionRunCount > 0
            ? `${row.subscriptionRunCount} subscription run${row.subscriptionRunCount === 1 ? "" : "s"}`
            : "0 subscription runs"}
          {" · "}
          {t("costPricing.recordedWeekSpend", { amount: formatCost(weekSpendCents, weekUnpricedEventCount) })}
        </div>

        {billingTypeBreakdown.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Billing types
              </p>
              <div className="space-y-1.5">
                {billingTypeBreakdown.map(([billingType, coverage]) => (
                  <div key={billingType} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{billingTypeDisplayName(billingType as any)}</span>
                    <span className="font-medium tabular-nums">{formatCost(coverage.costCents, coverage.unpricedEventCount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {providerBreakdown.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Upstream providers
              </p>
              <div className="space-y-1.5">
                {providerBreakdown.map((entry) => (
                  <div key={entry.provider} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{providerDisplayName(entry.provider)}</span>
                    <div className="text-right tabular-nums">
                      <div className="font-medium">{formatCost(entry.costCents, entry.unpricedEventCount)}</div>
                      <div className="text-muted-foreground">
                        {formatTokens(entry.inputTokens + entry.outputTokens)} tok
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
