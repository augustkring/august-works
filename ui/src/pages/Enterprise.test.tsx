// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
import { Enterprise } from "./Enterprise";
import { enterpriseApi } from "@/api/enterprise";
const fixture = vi.hoisted(() => ({
  company: "11111111-1111-4111-8111-111111111111",
  user: "owner-one",
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: fixture.company }),
}));
vi.mock("@/api/companies-query", () => ({
  useAccountIdentity: () => ({ userId: fixture.user }),
}));
vi.mock("@/api/secrets", () => ({
  secretsApi: { list: vi.fn(async () => []) },
}));
vi.mock("@/api/access", () => ({
  accessApi: {
    listMembers: vi.fn(async () => ({
      members: [
        {
          id: "member",
          principalId: "native-owner",
          status: "active",
          membershipRole: "owner",
          user: { name: "Existing owner", email: "owner@test.invalid" },
        },
      ],
    })),
  },
}));
vi.mock("@/lib/router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/api/enterprise", () => ({
  enterpriseApi: {
    identity: vi.fn(async () => ({
      version: 1,
      status: "qualified",
      scimRequired: true,
      scimConfigured: false,
      scimCredentialId: null,
      configuration: {
        protocol: "saml",
        issuer: "https://idp.test.invalid",
        domain: "test.invalid",
        entryPoint: "https://idp.test.invalid/sso",
        certificate: "fixture",
      },
      operatingEnvelope: {
        awProcessingRegions: ["dk-cph1"],
        providers: [],
        limitations: [],
      },
      qualification: null,
    })),
    bindings: vi.fn(async () => []),
    configure: vi.fn(),
    bind: vi.fn(),
    suspend: vi.fn(),
    revokeBinding: vi.fn(),
    rotateScim: vi.fn(async () => ({
      credentialId: "fixture-id",
      token: "only-display-to-current-account",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })),
  },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());
it("uses native member choices, prevents owner SCIM lifecycle and clears one-time tokens after account changes", async () => {
  const container = document.createElement("div"),
    root = createRoot(container),
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Enterprise />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  try {
    await render();
    expect(enterpriseApi.identity).toHaveBeenCalledWith(
      fixture.company,
      fixture.user,
    );
    const picker = [...container.querySelectorAll("select")].find((s) =>
      s.textContent?.includes("Existing owner"),
    )!;
    await act(async () => {
      picker.value = "native-owner";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const lifecycle = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((i) => i.parentElement?.textContent?.includes("Allow SCIM"))!;
    expect(lifecycle.disabled).toBe(true);
    expect(enterpriseApi.bind).not.toHaveBeenCalled();
    const rotate = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Rotate SCIM credential",
    )!;
    await act(async () => rotate.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(enterpriseApi.rotateScim).toHaveBeenCalledWith(
      fixture.company,
      fixture.user,
      1,
      null,
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="New SCIM credential"]',
      )?.value,
    ).toBe("only-display-to-current-account");
    for (const m of client.getMutationCache().getAll())
      expect(JSON.stringify(m.state.data)).not.toContain(
        "only-display-to-current-account",
      );
    fixture.user = "owner-two";
    await render();
    expect(
      container.querySelector('input[aria-label="New SCIM credential"]'),
    ).toBeNull();
    expect(enterpriseApi.identity).toHaveBeenCalledWith(
      fixture.company,
      "owner-two",
    );
  } finally {
    await act(async () => root.unmount());
    client.clear();
    fixture.user = "owner-one";
  }
});
