import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { businessMetricDefinitionSchema } from "@paperclipai/shared";
import { BusinessMetricTargets } from "@/components/BusinessMetricTargets";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { BusinessMetricTargetComparison, BusinessMetricResult } from "@paperclipai/shared";
import { BusinessMetricTargetComparison as TargetComparison } from "@/components/BusinessMetricTargetComparison";
const comparison: BusinessMetricTargetComparison = { targetId: "target", targetVersionId: "version", observationId: "observation", status: "met", value: 0.8, reason: null, asOf: "2026-10-06T12:00:00Z" };
const observation: BusinessMetricResult = { id: "observation", companyId: "company", metricId: "metric", versionId: "metric-version", from: "2026-09-01T00:00:00Z", until: "2026-10-01T00:00:00Z", asOf: comparison.asOf, expiresAt: "2099-01-01T00:00:00Z", status: "observed", value: 0.8, reason: null, groups: [], inputHash: "a".repeat(64), definitionHash: "b".repeat(64), engineVersion: "native/v1", lineageManifestId: "lineage", sourceWatermark: comparison.asOf };
const meta = { title: "Business intelligence/Commitment comparison", component: TargetComparison, args: { comparison, observation } } satisfies Meta<typeof TargetComparison>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Met: Story = {};
export const OpenPeriod: Story = { args: { comparison: { ...comparison, status: "period_in_progress", reason: "current_observation_is_not_a_forecast" } } };
export const Unknown: Story = { args: { comparison: { ...comparison, status: "unknown", value: null, reason: "empty_denominator" }, observation: { ...observation, status: "undefined", value: null, reason: "empty_denominator" } } };
export const Expired: Story = { args: { observation: { ...observation, expiresAt: "2026-01-01T00:00:00Z" } } };

// Native query fixtures keep the operator story independent of a live company.
// Browser QA aborts API requests; these stories never qualify mutations.
const companyId = "11111111-1111-4111-8111-111111111111";
const metricId = "22222222-2222-4222-8222-222222222222";
const metricVersionId = "33333333-3333-4333-8333-333333333333";
const metricDefinition = businessMetricDefinitionSchema.parse({ name: "Created task completion", description: "Current completion of company tasks", businessQuestion: "What share of the population is complete?", decisionUse: "Review operations", populationDescription: "Company tasks created in the selected window", inclusions: ["Created tasks"], exclusions: [], authorityMode: "aw_native", valueType: "ratio", unit: "ratio", currency: null, grain: "issue", timeGrain: "window", timezone: "UTC", timeSemantics: "created_in_window_current_state", dimensions: [], calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: ["done"], projectId: null }, denominator: { entity: "issue", statuses: ["todo", "done"], projectId: null } }, ownerUserId: "reviewer", reviewFrequencyDays: 30, freshnessSeconds: 3600, missingPolicy: "explicit_unknown", goodhartRisk: "Completion does not establish useful outcomes", purpose: "management_intelligence", sensitivity: "internal", governanceObligationRefs: [companyId], retentionDays: 30 });
function OperatorFixture() {
  const [client] = useState(() => {
    const query = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } } });
    query.setQueryData(["business-metric-targets", companyId, "reviewer"], { pages: [{ items: [], nextCursor: null }], pageParams: [undefined] });
    query.setQueryData(["target-scope-goals", companyId, "reviewer"], [{ id: "44444444-4444-4444-8444-444444444444", companyId, title: "Improve delivery outcomes" }]);
    query.setQueryData(["target-scope-projects", companyId, "reviewer"], [{ id: "55555555-5555-4555-8555-555555555555", companyId, name: "Operations improvement" }]);
    return query;
  });
  return <QueryClientProvider client={client}><BusinessMetricTargets companyId={companyId} userId="reviewer" metric={{ id: metricId, companyId, key: "completion", revision: 2, status: "published", publishedVersionId: metricVersionId, createdAt: comparison.asOf, updatedAt: comparison.asOf }} metricVersion={{ id: metricVersionId, companyId, metricId, revision: 1, definition: metricDefinition, contentHash: "a".repeat(64), createdAt: comparison.asOf }} /></QueryClientProvider>;
}
export const Operator: Story = { render: () => <OperatorFixture /> };
