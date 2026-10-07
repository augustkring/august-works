import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ManagementReviewWorkspace } from "@/pages/ManagementReviews";
import { ManagementReviewResult } from "@/components/ManagementReviewResult";
import { managementFixture } from "./management-review-fixtures";
function Workspace({ stale = false, published = false, disabled = false }: { stale?: boolean; published?: boolean; disabled?: boolean }) {
  const f = managementFixture(stale, published), [client] = useState(() => { const q = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
    q.setQueryData(["management-review-controls", f.companyId, f.userId], { pages: [f.controls], pageParams: [undefined] }); q.setQueryData(["management-reviews", f.companyId, f.userId, "detail", f.id], f.review); q.setQueryData(["management-definition-sources", f.companyId, f.userId, "purpose"], [f.policy]); q.setQueryData(["strategy-sources", f.companyId, f.userId, "goals"], [f.goal]); return q;
  });
  return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><ManagementReviewWorkspace companyId={f.companyId} userId={f.userId} enabled={!disabled} /></div></QueryClientProvider>;
}
function Predictive() {
  const f = managementFixture(), source = { key: "forecast", source: { kind: "analytical" as const, reference: { type: "forecast_run" as const, id: "00000000-0000-4000-8000-000000002304", specId: "00000000-0000-4000-8000-000000002305", versionId: "00000000-0000-4000-8000-000000002306", pointIndex: 0 } }, sourceHash: "e".repeat(64), capturedAt: f.review.createdAt, expiresAt: f.review.expiresAt, grade: "predictive" as const, facts: { predictedValue: 42, intervalLower: null, intervalUpper: null }, limitations: ["Synthetic cached forecast presentation; prediction is not a measured result. Intervals are unavailable."] };
  f.review.sources.push(source); f.review.packet.claims.push({ key: "claim_forecast", sourceKeys: [source.key], grade: source.grade, facts: source.facts, limitations: source.limitations });
  return <div className="mx-auto w-full max-w-3xl"><ManagementReviewResult review={f.review} /></div>;
}
const meta: Meta = { title: "Business Intelligence/Management reviews", parameters: { layout: "padded" } }; export default meta; type Story = StoryObj;
// Cached synthetic presentation; browser checks abort every API request.
export const Current: Story = { render: () => <Workspace /> };
export const Retained: Story = { render: () => <Workspace stale /> };
export const Published: Story = { render: () => <Workspace published /> };
export const Disabled: Story = { render: () => <Workspace disabled /> };
export const Prediction: Story = { render: () => <Predictive /> };
