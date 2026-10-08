import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CrossProjectPlanningWorkspace } from "@/pages/CrossProjectPlanning";
import { jointPlanningFixture } from "./cross-project-planning-fixtures";
function Workspace({ stale = false, disabled = false }: { stale?: boolean; disabled?: boolean }) {
  const f = jointPlanningFixture(stale), [client] = useState(() => {
    const q = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }), key = ["cross-project-planning", f.companyId, f.userId];
    q.setQueryData([...key, "controls"], { pages: [f.controls], pageParams: [undefined] });
    q.setQueryData([...key, "choices", ""], f.options);
    q.setQueryData([...key, "detail", f.id], f.detail);
    for (const source of f.sources) q.setQueryData([...key, "source", source.projectId], source);
    q.setQueryData(["planning-definition-sources", f.companyId, f.userId, "purpose"], [f.policy]);
    return q;
  });
  return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><CrossProjectPlanningWorkspace companyId={f.companyId} userId={f.userId} enabled={!disabled} /></div></QueryClientProvider>;
}
// Cached synthetic presentation. Browser qualification aborts all API requests.
const meta: Meta = { title: "Business Intelligence/Cross-project planning", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;
export const Current: Story = { render: () => <Workspace /> };
export const Retained: Story = { render: () => <Workspace stale /> };
export const Disabled: Story = { render: () => <Workspace disabled /> };
