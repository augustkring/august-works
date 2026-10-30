import type { AgentAppearance } from "../agent-appearance.js";
import type { BillingType, CostStatus } from "../constants.js";

export interface CostEvent {
  id: string;
  companyId: string;
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  goalId: string | null;
  heartbeatRunId: string | null;
  billingCode: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  costStatus: CostStatus;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  occurredAt: Date;
  createdAt: Date;
}

export interface CostSummary {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  companyId: string;
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
  /** Successful heartbeat runs whose finish time falls in the selected range. */
  successfulRunCount: number;
  /** Successful runs with at least one linked provider cost event. */
  successfulRunsWithCostEvents: number;
  /** Successful runs with no linked provider cost event; prevents a zero from implying complete metering. */
  successfulRunsWithoutCostEvents: number;
  /** Sum of existing provider cost events linked to successful runs in the selected range. */
  successfulRunProviderCostCents: number;
  successfulRunEstimatedEventCount: number;
  successfulRunUnpricedEventCount: number;
  /** Mean linked provider cost per successful run, unavailable when the cohort is incomplete. */
  providerCostPerSuccessfulRunCents: number | null;
  /** These amounts summarize stored cost events only; they do not prove event capture is complete. */
  providerCostPerSuccessfulRunCoverage: "recorded_events_only";
  providerCostPerSuccessfulRunStatus: "reported_events" | "estimated_events" | "incomplete_events" | "no_successful_runs";
}

export interface IssueCostSummary {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  issueId: string;
  issueCount: number;
  includeDescendants: boolean;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** number of distinct heartbeat runs aggregated across the issue tree */
  runCount: number;
  /** sum of wall-clock duration of each run in the tree (ms);
   * still-running runs contribute (now - startedAt) so this ticks up live */
  runtimeMs: number;
}

export interface CostByAgent {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  agentId: string;
  agentName: string | null;
  agentAppearance?: AgentAppearance | null;
  avatarUrl?: string;
  agentStatus: string | null;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByProviderModel {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByBiller {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  biller: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
  providerCount: number;
  modelCount: number;
}

/** per-agent breakdown by provider + model, for identifying token-hungry agents */
export interface CostByAgentModel {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  agentId: string;
  agentName: string | null;
  agentAppearance?: AgentAppearance | null;
  avatarUrl?: string;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** spend per provider for a fixed rolling time window */
export interface CostWindowSpendRow {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  provider: string;
  biller: string;
  /** duration label, e.g. "5h", "24h", "7d" */
  window: string;
  /** rolling window duration in hours */
  windowHours: number;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** cost attributed to a project via heartbeat run → activity log → issue → project chain */
export interface CostByProject {
  /** Usage events without a reported price; excluded from the recorded amount. */
  unpricedEventCount?: number;
  projectId: string | null;
  projectName: string | null;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}
