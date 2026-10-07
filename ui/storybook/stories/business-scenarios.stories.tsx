import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BusinessScenarioWorkspace } from "@/pages/BusinessScenarios";
import { BusinessScenarioResult } from "@/components/BusinessScenarioResult";
import { scenarioFixture, scenarioArtifactFixture } from "./business-scenario-fixtures";
function Workspace({ published = false, monteCarlo = false, artifactMode = false }: { published?: boolean; monteCarlo?: boolean; artifactMode?: boolean }) {
  const [client] = useState(() => {
    const f = artifactMode ? scenarioArtifactFixture(published) : scenarioFixture(published, monteCarlo);
    const query = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }), key = ["business-scenarios", f.companyId, f.userId];
    query.setQueryData(key, { pages: [{ items: [{ scenario: f.scenario, version: f.version }], nextCursor: null, coverage: "bounded_current_authorized_page" }], pageParams: [undefined] });
    query.setQueryData([...key, "detail", f.scenario.id], { scenario: f.scenario, versions: [f.version] });
    query.setQueryData([...key, "runs", f.scenario.id], { pages: [{ items: [f.run], nextCursor: null, coverage: "bounded_current_authorized_page" }], pageParams: [undefined] });
    query.setQueryData([...key, "run", f.scenario.id, f.run.id], f.run);
    query.setQueryData(["scenario-definition-sources", f.companyId, f.userId, "purpose"], [f.policy]);
    const source = ["scenario-source", f.companyId, f.userId];
    query.setQueryData([...source, "metrics"], { pages: [{ items: [f.metric], nextCursor: null }], pageParams: [undefined] });
    query.setQueryData([...source, "metric", f.metric.id], { metric: f.metric, versions: [f.metricVersion] });
    query.setQueryData([...source, "observations", f.metric.id], { pages: [{ items: f.observations, nextCursor: null, coverage: "bounded_current_authorized_page" }], pageParams: [undefined] });
    if (artifactMode) {
      const a = scenarioArtifactFixture(published), artifactKey = ["scenario-definition-sources", f.companyId, f.userId, "artifact"];
      query.setQueryData([...artifactKey, "list"], [a.artifact]);
      query.setQueryData([...artifactKey, a.artifact.id], { artifact: a.artifact, latestVersion: a.artifactVersion });
    }
    return query;
  });
  const f = scenarioFixture();
  return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><BusinessScenarioWorkspace companyId={f.companyId} userId={f.userId} /></div></QueryClientProvider>;
}
function Result({ state }: { state: "deterministic" | "monte_carlo" | "stale" | "unstable" | "data_not_ready" | "expired" }) {
  const { run } = scenarioFixture(true, state === "monte_carlo" || state === "unstable");
  const artifact = state === "stale" ? { ...run, currentQualification: "needs_revalidation" as const } : state === "expired" ? { ...run, expiresAt: "2000-01-01T00:00:00Z" } : state === "data_not_ready" ? { ...run, result: { ...run.result, status: "data_not_ready" as const, reasons: ["scenario_zero_denominator"], cases: [] } } : state === "unstable" ? { ...run, result: { ...run.result, status: "inconclusive" as const, reasons: ["scenario_declared_sample_stability_not_met"], cases: run.result.cases.map(item => ({ ...item, outputs: item.outputs.map(output => ({ ...output, simulation: null })) })), uncertainty: { ...run.result.uncertainty, qualification: "unstable" as const, unstableOutputs: [{ caseKey: "base", outputKey: "capacity", maximumDifference: 0.4, tolerance: 0.2 }] } } } : run;
  return <div className="mx-auto w-full max-w-3xl"><BusinessScenarioResult artifact={artifact} /></div>;
}
// Cached synthetic presentation fixtures. Browser QA blocks every API call;
// these stories do not qualify native source access, execution or calibration.
const meta: Meta = { title: "Business Intelligence/Business scenarios", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;
export const Deterministic: Story = { render: () => <Result state="deterministic" /> };
export const MonteCarlo: Story = { render: () => <Result state="monte_carlo" /> };
export const Stale: Story = { render: () => <Result state="stale" /> };
export const Unstable: Story = { render: () => <Result state="unstable" /> };
export const DataNotReady: Story = { render: () => <Result state="data_not_ready" /> };
export const Expired: Story = { render: () => <Result state="expired" /> };
export const Draft: Story = { render: () => <Workspace /> };
export const Published: Story = { render: () => <Workspace published monteCarlo /> };

export const ArtifactDraft: Story = { render: () => <Workspace artifactMode /> };
export const ArtifactResult: Story = { render: () => <div className="mx-auto w-full max-w-3xl"><BusinessScenarioResult artifact={scenarioArtifactFixture(true).run} /></div> };
