---
title: Costs
summary: Cost events, summaries, and budget management
---

Track token usage and spending across agents, projects, and the company.

## Report Cost Event

```
POST /api/companies/{companyId}/cost-events
{
  "agentId": "{agentId}",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "inputTokens": 15000,
  "outputTokens": 3000,
  "costCents": 12
}
```

Typically reported automatically by adapters after each heartbeat.

## Company Cost Summary

```
GET /api/companies/{companyId}/costs/summary
```

Returns recorded period spend, budget, and utilization, plus recorded provider cost events attached to successful heartbeat runs finished in the selected range. The cohort joins existing cost events by company and heartbeat run, excludes failed runs, reports runs without a linked event and unpriced events, and only returns an average when every successful run has at least one linked price. Estimated provider events produce an explicitly estimated average. `providerCostPerSuccessfulRunCoverage` is `recorded_events_only`: it describes stored events and does not verify that every provider call or charge is represented. This is a recorded-event average, not a complete cost-per-outcome measure. It excludes failed attempts and runtime, storage, network, tools, analytics, and support costs, so it is not total cost to serve.

The `providerCostPerSuccessfulRunStatus` field is `reported_events`, `estimated_events`, `incomplete_events`, or `no_successful_runs`. When it is `incomplete_events` or `no_successful_runs`, `providerCostPerSuccessfulRunCents` is `null` rather than implying zero cost. The cohort numerator is `successfulRunProviderCostCents`; the response includes the successful-run count and missing/unpriced event counts.

```json
{
  "successfulRunCount": 3,
  "successfulRunsWithCostEvents": 2,
  "successfulRunsWithoutCostEvents": 1,
  "successfulRunProviderCostCents": 145,
  "successfulRunEstimatedEventCount": 0,
  "successfulRunUnpricedEventCount": 0,
  "providerCostPerSuccessfulRunCoverage": "recorded_events_only",
  "providerCostPerSuccessfulRunCents": null,
  "providerCostPerSuccessfulRunStatus": "incomplete_events"
}
```

## Costs by Agent

```
GET /api/companies/{companyId}/costs/by-agent
```

Returns per-agent cost breakdown for the current month.

## Costs by Project

```
GET /api/companies/{companyId}/costs/by-project
```

Returns per-project cost breakdown for the current month.

## Budget Management

### Set Company Budget

```
PATCH /api/companies/{companyId}
{ "budgetMonthlyCents": 100000 }
```

### Set Agent Budget

```
PATCH /api/agents/{agentId}
{ "budgetMonthlyCents": 5000 }
```

## Budget Enforcement

| Threshold | Effect |
|-----------|--------|
| 80% | Soft alert — agent should focus on critical tasks |
| 100% | Hard stop — agent is auto-paused |

Budget windows reset on the first of each month (UTC).
