import { EXPERIENCE_CARD_TOOL_NAMES } from "@paperclipai/shared";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  fromThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ExperienceToolUI } from "./ExperienceToolUI";
import "../i18n";
const companyId = "10000000-0000-4000-8000-000000000001";
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: companyId }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: "member",
    localImplicit: false,
    settled: true,
    failed: false,
  }),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: () => {},
}));
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({
    enabled: true,
    query: {
      isSuccess: true,
      isPending: false,
      isFetching: false,
      isError: false,
    },
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const source = {
  companyId,
  domain: "task" as const,
  resourceId: "AW-1",
  version: "1",
  observedAt: "2026-10-10T10:00:00.000Z",
};
const wire = {
  schemaVersion: 1,
  component: "TaskCard",
  companyId,
  cardId: "card",
  source: { companyId, domain: "task", resourceId: "AW-1", version: "1" },
};
const makeMessage = (toolName: string, request: typeof wire | {
  schemaVersion: number; component: string; companyId: string; cardId: string;
  source: { companyId: string; domain: string; resourceId: string; version: string };
} = wire) => fromThreadMessageLike({
  id: "native-tool-display-fixture",
  role: "assistant",
  createdAt: new Date(source.observedAt),
  content: [
    {
      type: "tool-call",
      toolCallId: "display",
      toolName,
      args: request,
      argsText: JSON.stringify(request),
      result: {
        title: "PRIVATE INVENTED SUCCESS",
        html: "<script>sendSecrets()</script>",
      },
    },
  ],
  status: { type: "complete", reason: "stop" },
  metadata: { custom: {} },
}, "native-tool-display-fixture", { type: "complete", reason: "stop" });
let message = makeMessage("aw_experience_card");
function Message() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Content />
    </MessagePrimitive.Root>
  );
}
function Conversation() {
  const runtime = useExternalStoreRuntime({
    messages: [message],
    isRunning: false,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ExperienceToolUI />
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages components={{ AssistantMessage: Message, UserMessage: Message }} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
it.each(EXPERIENCE_CARD_TOOL_NAMES)("registers %s with the installed real assistant-ui runtime and resolves the Native view instead of the tool result", async (toolName) => {
  message = makeMessage(toolName);
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValue({
      companyId,
      profile: "member",
      generatedAt: source.observedAt,
      dependencies: [],
      needsYou: [],
      inProgress: [
        {
          id: "card",
          kind: "progress",
          title: "CURRENT NATIVE TASK",
          whyYou: null,
          consequence: null,
          source,
          freshness: "fresh",
          evidence: [],
          actions: [],
        },
      ],
      done: [],
      watch: [],
    });
  const post = vi.spyOn(api, "post");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Conversation />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() =>
    expect(container.querySelector("article")?.textContent).toContain(
      "CURRENT NATIVE TASK",
    ),
  );
  expect(get).toHaveBeenCalled();
  expect(container.textContent).not.toContain("INVENTED");
  expect(container.querySelector("script")).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it.each(EXPERIENCE_CARD_TOOL_NAMES)("renders %s insight references with actual assistant-ui and an independently admitted Native read", async toolName => {
  const resourceId = "review:10000000-0000-4000-8000-000000000002", version = "a".repeat(64);
  const insightSource = { companyId, domain: "insight", resourceId, version, observedAt: source.observedAt };
  const request = { schemaVersion: 1, component: "ResultCard", companyId, cardId: `insight:${resourceId}`,
    source: { companyId, domain: "insight", resourceId, version } };
  message = makeMessage(toolName, request);
  const get = vi.spyOn(api, "get").mockImplementation(async path => path.includes("/insight-card?") ? {
    id: request.cardId, kind: "result", title: "CURRENT NATIVE REVIEW", source: insightSource,
    freshness: "fresh", displayExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    whyYou: null, consequence: "Native read-only evidence", evidence: ["native_historical_review"],
    actions: [{ id: "inspect", label: "Inspect", operation: "open", href: "/management-reviews", criticality: "C2", source: insightSource, requiresCurrentAuthorization: true }],
  } : { companyId, profile: "manager", generatedAt: source.observedAt, dependencies: [], needsYou: [], inProgress: [], done: [], watch: [] });
  const post = vi.spyOn(api, "post");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><Conversation /></MemoryRouter></QueryClientProvider>));
  await vi.waitFor(() => expect(container.querySelector("article")?.textContent).toContain("CURRENT NATIVE REVIEW"));
  expect(get.mock.calls.some(([path]) => path.includes("/insight-card?") && path.includes("expectedUserId=member"))).toBe(true);
  expect(container.textContent).not.toContain("INVENTED"); expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/management-reviews"); expect(post).not.toHaveBeenCalled();
});
