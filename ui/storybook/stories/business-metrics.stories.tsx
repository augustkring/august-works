import type { Meta, StoryObj } from "@storybook/react-vite";
import type { BusinessMetricDefinition, BusinessMetricResult } from "@paperclipai/shared";
import { BusinessMetricObservation } from "@/components/BusinessMetricObservation";
const definition: BusinessMetricDefinition = {
  name: "Created task completion", description: "Share of created tasks currently done",
  businessQuestion: "What share of our task population is complete?", decisionUse: "Review the backlog",
  populationDescription: "Company tasks created in the selected UTC window", inclusions: ["Created tasks"], exclusions: [],
  authorityMode: "aw_native", valueType: "ratio", unit: "ratio", currency: null, grain: "issue", timeGrain: "window", timezone: "UTC",
  timeSemantics: "created_in_window_current_state", dimensions: ["status", "project"],
  calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: ["done"], projectId: null }, denominator: { entity: "issue", statuses: ["todo", "done"], projectId: null } },
  ownerUserId: "reviewer", reviewFrequencyDays: 30, freshnessSeconds: 3600, missingPolicy: "explicit_unknown",
  goodhartRisk: "Completed task count does not establish valuable outcomes", purpose: "management_intelligence", sensitivity: "internal",
  governanceObligationRefs: ["11111111-1111-4111-8111-111111111111"], retentionDays: 30,
};
const result: BusinessMetricResult = {
  id: "11111111-1111-4111-8111-111111111111", companyId: "11111111-1111-4111-8111-111111111111", metricId: "11111111-1111-4111-8111-111111111111",
  versionId: "22222222-2222-4222-8222-222222222222", from: "2026-09-01T00:00:00Z", until: "2026-10-01T00:00:00Z",
  asOf: "2026-10-06T12:00:00Z", expiresAt: "2099-01-01T00:00:00Z", status: "observed", value: 0.5, reason: null,
  groups: [{ dimensions: { status: "done" }, value: 1, numerator: 20, denominator: 20 }, { dimensions: { status: "todo" }, value: 0, numerator: 0, denominator: 20 }],
  definitionHash: "a".repeat(64), inputHash: "b".repeat(64), engineVersion: "aw-native-metric/v1", lineageManifestId: "33333333-3333-4333-8333-333333333333", sourceWatermark: "2026-10-06T11:45:00Z",
};
const meta = { title: "Business intelligence/Metric observation", component: BusinessMetricObservation, args: { definition, result } } satisfies Meta<typeof BusinessMetricObservation>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Observed: Story = {};
export const UndefinedDenominator: Story = { args: { result: { ...result, status: "undefined", value: null, reason: "empty_denominator", groups: [], sourceWatermark: "empty_population" } } };
export const ZeroCount: Story = { args: { definition: { ...definition, valueType: "count", unit: "objects", calculation: { kind: "native_count", population: { entity: "issue", statuses: ["todo", "done"], projectId: null } } }, result: { ...result, value: 0, groups: [], sourceWatermark: "empty_population" } } };

export const Expired: Story = { args: { result: { ...result, expiresAt: "2025-01-01T00:00:00Z" } } };
