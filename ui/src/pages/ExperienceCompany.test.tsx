// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  COMPANY_EXPERIENCE_SECTIONS,
  type CompanyExperience,
} from "@paperclipai/shared";
import { api } from "../api/client";
import { ExperienceCompany } from "./ExperienceCompany";
import "../i18n";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let company = id(1),
  user = "member";
let live: (event: {
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
}) => void;
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: company,
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    settled: true,
    failed: false,
    localImplicit: false,
    userId: user,
  }),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (listener: typeof live) => {
    live = listener;
  },
}));
vi.mock("./CompanySettings", () => ({ CompanySettings: () => null }));
function data(companyId = company): CompanyExperience {
  return {
    companyId,
    observedAt: new Date().toISOString(),
    sections: COMPANY_EXPERIENCE_SECTIONS.map((section) => ({
      id: section,
      entries:
        section === "general"
          ? [{ id: "company_identity", href: "/company/settings/general" }]
          : section === "people_access"
            ? [{ id: "members", href: "/company/settings/members" }]
            : section === "apps_data"
              ? [{ id: "connections", href: "/apps" }]
              : [],
    })),
  };
}
let root: Root, container: HTMLDivElement, client: QueryClient;
const view = () => (
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <ExperienceCompany />
    </MemoryRouter>
  </QueryClientProvider>
);
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(view()));
}
async function search(value: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
  company = id(1);
  user = "member";
});
it("searches authorized customer labels, purposes and old aliases with category and restricted-access context", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(data());
  await mount();
  await vi.waitFor(() =>
    expect(container.querySelectorAll("section")).toHaveLength(10),
  );
  expect(container.querySelectorAll("a")).toHaveLength(3);
  expect(document.activeElement).toBe(container.querySelector("h1"));
  await search("team invites");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.textContent).toContain("Members and invitations");
  expect(container.textContent).toContain(
    "Invite teammates and review membership",
  );
  expect(container.textContent).toContain("Restricted access");
  expect(container.textContent).toContain("1 setting matches");
  expect(container.querySelectorAll("section")).toHaveLength(10);
  await search("not an available setting");
  expect(container.querySelectorAll("a")).toHaveLength(0);
  expect(container.textContent).toContain("0 settings match");
  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
});
it.each(["company", "account"])(
  "clears search and changes the private request namespace when %s changes",
  async (kind) => {
    const get = vi.spyOn(api, "get").mockImplementation(async () => data());
    await mount();
    await vi.waitFor(() =>
      expect(container.querySelector("input")).not.toBeNull(),
    );
    await search("PRIVATE-OLD-SEARCH");
    if (kind === "company") company = id(2);
    else user = "new-account";
    await act(async () => root.render(view()));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(container.querySelector("input")?.value).toBe(""),
    );
    expect(get.mock.calls[1][0]).toContain(
      `/companies/${company}/experience/company?expectedUserId=${user}`,
    );
    expect(container.querySelectorAll("a")).toHaveLength(3);
  },
);
it.each(["permission.revoked", "analytical.context.access_lost"])(
  "hides old controls for %s and rejects a late prior response",
  async (kind) => {
    let resolveOld!: (v: CompanyExperience) => void,
      rejectNew!: (e: Error) => void;
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValueOnce(data())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectNew = reject;
          }),
      );
    await mount();
    await vi.waitFor(() =>
      expect(container.querySelectorAll("a")).toHaveLength(3),
    );
    await act(async () =>
      live({
        companyId: company,
        type: "activity.logged",
        payload: { action: "permission.changed" },
      }),
    );
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(container.querySelectorAll("a")).toHaveLength(0);
    await act(async () =>
      live({
        companyId: company,
        type:
          kind === "permission.revoked"
            ? "activity.logged"
            : "analytical.context.access_lost",
        payload: { action: kind },
      }),
    );
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    await act(async () => resolveOld(data()));
    expect(container.querySelectorAll("a")).toHaveLength(0);
    await act(async () => rejectNew(new Error("SECRET-ERROR")));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(container.textContent).not.toContain("SECRET-ERROR");
    expect(document.activeElement).toBe(
      container.querySelector('[role="alert"]'),
    );
  },
);
it("rejects a foreign-company response before exposing any controls", async () => {
  vi.spyOn(api, "get").mockResolvedValue(data(id(99)));
  await mount();
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(container.querySelectorAll("a")).toHaveLength(0);
  expect(container.textContent).not.toContain("Company context changed");
});
