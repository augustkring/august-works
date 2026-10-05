// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { WorkSignals } from "./WorkSignals";
import { workSignalsApi } from "@/api/work-signals";
const fixture = vi.hoisted(() => ({ company: "11111111-1111-4111-8111-111111111111", task: "22222222-2222-4222-8222-222222222222", breadcrumbs: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.company }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@/api/work-signals", () => ({ workSignalsApi: { list: vi.fn(async () => []), decide: vi.fn() } }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: vi.fn(async () => []) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.clearAllMocks(); });
it("offers only a separate date proposal for an explicit shared source, and never completion or assignment", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const base = { companyId: fixture.company, issueId: fixture.task, targetIssueId: null, sourceDeliveryId: null, status: "candidate", version: 1, confidence: "explicit", proposalId: null, interactionId: null, createdAt: "2026-10-05T00:00:00.000Z", expiresAt: "2026-10-12T00:00:00.000Z" };
  client.setQueryData(["work-signals", fixture.company], [
    { ...base, id: "public", signalType: "deadline_change", sensitivity: "internal", facts: { date: "2026-12-04", reason: "explicit_calendar_date" } },
    { ...base, id: "private", signalType: "deadline_change", sensitivity: "restricted", facts: { date: "2026-12-05", reason: "explicit_calendar_date" } },
    { ...base, id: "done", signalType: "completion_claim", sensitivity: "internal", facts: { reason: "participant_completion_claim" } },
  ]);
  client.setQueryData(["work-signal-targets", fixture.company], []);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<QueryClientProvider client={client}><WorkSignals /></QueryClientProvider>));
  const sections = Array.from(container.querySelectorAll("section"));
  expect(sections[0]?.textContent).toContain("Propose date in Roadmap"); expect(sections[1]?.textContent).not.toContain("Propose date in Roadmap"); expect(sections[2]?.textContent).not.toContain("Propose date in Roadmap");
  expect(container.textContent).not.toContain("Mark complete"); expect(workSignalsApi.decide).not.toHaveBeenCalled();
});
