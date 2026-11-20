// @vitest-environment jsdom

// I18N-DA1: older customer screens must show Danish, not English, when the
// language is Danish. Each screen renders for real; only data sources and
// routing are stubbed.

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Approval, Project } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { ToastProvider } from "../context/ToastContext";
import { Approvals } from "./Approvals";
import { Projects } from "./Projects";
import { AGENT_DETAIL_NAVIGATION } from "./agent-detail-navigation";
import { workModeMetaFor } from "../lib/work-mode-meta";
import { blockedReasonLabel } from "../lib/blockedInbox";

const mockProjectsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockMembershipsApi = vi.hoisted(() => ({ listMine: vi.fn(), updateProject: vi.fn() }));
const mockApprovalsApi = vi.hoisted(() => ({ list: vi.fn(), approve: vi.fn(), reject: vi.fn() }));
const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children?: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/approvals/pending", search: "", hash: "" }),
}));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openNewProject: vi.fn() }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../api/projects", () => ({ projectsApi: mockProjectsApi }));
vi.mock("../api/resourceMemberships", () => ({ resourceMembershipsApi: mockMembershipsApi }));
vi.mock("../api/approvals", () => ({ approvalsApi: mockApprovalsApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.PointerEvent) {
  (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

function project(id: string, name: string): Project {
  return {
    id, companyId: "company-1", urlKey: id, goalId: null, goalIds: [], goals: [], name, description: null,
    status: "in_progress", leadAgentId: null, targetDate: null, color: null, icon: null, env: null,
    pauseReason: null, pausedAt: null, executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null, repoUrl: null, repoRef: null, defaultRef: null, repoName: null, localFolder: null,
      managedFolder: "/tmp/p", effectiveLocalFolder: "/tmp/p", origin: "local_folder",
    },
    workspaces: [], primaryWorkspace: null, managedByPlugin: null, archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as unknown as Project;
}

const approval = {
  id: "approval-1", companyId: "company-1", type: "hire_agent", status: "pending",
  payload: { name: "Designer", role: "designer" }, requestedByAgentId: null, requestedByUserId: "user-1",
  decisionNote: null, decidedByUserId: null, decidedAt: null,
  createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), updatedAt: new Date(),
} as unknown as Approval;

/** English strings that must not appear once the language is Danish. */
const FORBIDDEN_ENGLISH = [
  "Add Project", "My Projects", "Other Projects", "Sort:", "Approve", "Reject", "View details",
  "Pending", "No pending approvals", "1 project", "projects", "Hire Agent", "Approval request created", "ago",
];

describe("Danish customer screens (I18N-DA1)", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let previousLocale: string;

  beforeEach(async () => {
    previousLocale = i18n.language;
    await act(async () => { await i18n.changeLanguage("da"); });
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockProjectsApi.list.mockResolvedValue([project("a", "Alpha"), project("b", "Bravo")]);
    mockMembershipsApi.listMine.mockResolvedValue({
      projectMemberships: { b: "left" }, agentMemberships: {}, updatedAt: null,
    });
    mockApprovalsApi.list.mockResolvedValue([approval]);
    mockAgentsApi.list.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => { await i18n.changeLanguage(previousLocale); });
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function render(node: ReactNode) {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{node}</ToastProvider>
        </QueryClientProvider>,
      );
    });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    }
    return root;
  }

  function visibleText() {
    const attrs = Array.from(container.querySelectorAll("[aria-label],[title],[placeholder]"))
      .flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("placeholder")]);
    return [container.textContent ?? "", ...attrs].filter(Boolean).join(" | ");
  }

  function expectNoEnglish(text: string) {
    for (const english of FORBIDDEN_ENGLISH) {
      expect(text, `English text "${english}" found in Danish screen`).not.toContain(english);
    }
  }

  it("renders Projects in Danish", async () => {
    const root = await render(<Projects />);
    const text = visibleText();
    expect(text).toContain("Mine projekter");
    expect(text).toContain("Andre projekter");
    expect(text).toContain("Tilføj projekt");
    expect(text).toContain("Sortér: Navn");
    expect(text).toContain("Forlad Alpha");
    expect(text).toContain("Deltag i Bravo");
    expect(text).toContain("Tilføj Alpha til favoritter");
    expectNoEnglish(text);
    await act(async () => root.unmount());
  });

  it("renders Approvals in Danish", async () => {
    const root = await render(<Approvals />);
    const text = visibleText();
    expect(text).toContain("Afventer");
    expect(text).toContain("Ansæt agent");
    expect(text).toContain("Godkend");
    expect(text).toContain("Afvis");
    expect(text).toContain("Se detaljer");
    expect(text).toContain("Godkendelsesanmodning oprettet for 2 t. siden");
    expectNoEnglish(text);
    await act(async () => root.unmount());
  });

  it("shows Agent detail navigation and task work modes in Danish", () => {
    const labels = AGENT_DETAIL_NAVIGATION.flatMap((section) => [section.label, ...section.items.map((item) => item.label)]);
    expect(labels).toEqual(expect.arrayContaining(["Overblik", "Instruktioner", "Kompetencer", "Hemmeligheder", "Tilladelser / tillid", "API-nøgler"]));
    for (const english of ["Overview", "Instructions", "Skills", "Secrets", "Governance"]) expect(labels).not.toContain(english);
    expect(workModeMetaFor("planning").label).toBe("Plantilstand");
    expect(blockedReasonLabel("pending_board_decision")).toBe("Afventer beslutning fra Board");
  });

  it("keeps the same screens in English when the language is English", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    const root = await render(<Projects />);
    expect(visibleText()).toContain("Add Project");
    await act(async () => root.unmount());
  });
});
