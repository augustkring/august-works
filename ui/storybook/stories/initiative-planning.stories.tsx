import { useCallback, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { InitiativePlanningControls } from "@/components/InitiativePlanningControls";
import { initiativePlanningFixture } from "./initiative-planning-fixtures";
function Workspace({ stale = false, disabled = false, reviewed = false }: { stale?: boolean; disabled?: boolean; reviewed?: boolean }) {
  const f = initiativePlanningFixture(stale), [id, setId] = useState("");
  const onSources = useCallback(() => {}, []), onLost = useCallback(() => {}, []);
  const [client] = useState(() => {
    const q = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }), key = ["cross-project-planning", f.companyId, f.userId];
    if (reviewed) { f.detail.status = "under_review"; f.detail.revision = 2; f.controls.items[0] = { id: f.id, status: "under_review", revision: 2 }; }
    q.setQueryData([...key, "initiative-controls"], { pages: [f.controls], pageParams: [undefined] }); q.setQueryData([...key, "initiative-detail", f.id], f.detail);
    return q;
  });
  return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><InitiativePlanningControls companyId={f.companyId} userId={f.userId} enabled={!disabled} lost={false} id={id} onSelect={setId} onAuthorityLost={onLost} onSourceProjects={onSources} projectLabels={Object.fromEntries(f.sources.map(source => [source.projectId, source.projectName]))} taskLabels={Object.fromEntries(f.sources.flatMap(source => source.tasks.map(task => [task.id, `${source.projectName} · ${task.title}`])))} now={Date.now()} /></div></QueryClientProvider>;
}
// Private cached presentation fixtures. These stories never qualify native authority.
const meta: Meta = { title: "Business Intelligence/Initiative planning", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;
export const Current: Story = { render: () => <Workspace /> };
export const Reviewed: Story = { render: () => <Workspace reviewed /> };
export const Retained: Story = { render: () => <Workspace stale /> };
export const Disabled: Story = { render: () => <Workspace disabled /> };
