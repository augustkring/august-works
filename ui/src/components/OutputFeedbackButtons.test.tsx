// @vitest-environment jsdom
import { act, cloneElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { OutputFeedbackButtons } from "./OutputFeedbackButtons";
import { IssueChatFeedbackButtons } from "./AgentBubbleActionRow";

const feedbackState = vi.hoisted(() => ({ enabled: false, isSuccess: true }));
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({
    enabled: feedbackState.enabled,
    query: { isSuccess: feedbackState.isSuccess },
  }),
}));
vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: { getGeneral: vi.fn() },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let client: QueryClient | undefined;

async function mount(element: ReactElement, general?: Record<string, unknown>) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryDefaults(queryKeys.instance.generalSettings, { staleTime: Infinity });
  if (general) client.setQueryData(queryKeys.instance.generalSettings, general);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await rerender(element);
}

async function rerender(element: ReactElement) {
  await act(async () => {
    root!.render(<QueryClientProvider client={client!}>{cloneElement(element)}</QueryClientProvider>);
  });
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
    await Promise.resolve();
  });
}

async function enterNote(value: string) {
  const textarea = document.querySelector("textarea");
  expect(textarea).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  client?.clear();
  root = undefined;
  container = undefined;
  client = undefined;
  feedbackState.enabled = false;
  feedbackState.isSuccess = true;
  vi.clearAllMocks();
});

describe("feedback sharing policy", () => {
  it("keeps compact votes and notes local while settings are loading", async () => {
    vi.mocked(instanceSettingsApi.getGeneral).mockReturnValue(new Promise(() => {}));
    const onVote = vi.fn(async () => {});
    await mount(
      <IssueChatFeedbackButtons
        activeVote={null}
        sharingPreference="allowed"
        termsUrl={null}
        onVote={onVote}
      />,
    );

    await clickButton("Needs work");
    expect(onVote).toHaveBeenNthCalledWith(1, "down", { allowSharing: false });
    expect(document.body.textContent).not.toContain("Save your feedback sharing preference");

    await enterNote("Needs a clearer explanation");
    await clickButton("Save note");
    expect(onVote).toHaveBeenNthCalledWith(2, "down", {
      allowSharing: false,
      reason: "Needs a clearer explanation",
    });
  });

  it("converts a pending compact prompt to local on latch and preserves legacy consent", async () => {
    const onVote = vi.fn(async () => {});
    const legacyGeneral = { feedbackDataSharingPreference: "prompt" };
    const component = <IssueChatFeedbackButtons activeVote={null} sharingPreference="prompt" termsUrl={null} onVote={onVote} />;
    await mount(component, legacyGeneral);

    await clickButton("Helpful");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Save your feedback sharing preference"));
    await act(async () => {
      client!.setQueryData(queryKeys.instance.generalSettings, {
        ...legacyGeneral,
        outputFeedbackPolicyVersion: "aw-v9-local-v1",
      });
    });
    await vi.waitFor(() => expect(onVote).toHaveBeenLastCalledWith("up", { allowSharing: false }));
    expect(document.body.textContent).not.toContain("Save your feedback sharing preference");

    await act(async () => client!.setQueryData(queryKeys.instance.generalSettings, legacyGeneral));
    expect(document.body.textContent).not.toContain("Save your feedback sharing preference");

    feedbackState.isSuccess = false;
    await rerender(component);
    await clickButton("Helpful");
    await vi.waitFor(() => expect(onVote).toHaveBeenLastCalledWith("up", { allowSharing: false }));
    expect(document.body.textContent).not.toContain("Save your feedback sharing preference");

    feedbackState.isSuccess = true;
    await rerender(component);
    await clickButton("Helpful");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Save your feedback sharing preference"));
    await clickButton("Always allow");
    expect(onVote).toHaveBeenLastCalledWith("up", { allowSharing: true });
  });

  it("does not restore a pending output-feedback prompt after the local policy latches", async () => {
    const onVote = vi.fn(async () => {});
    const legacyGeneral = { feedbackDataSharingPreference: "prompt" };
    await mount(
      <OutputFeedbackButtons
        activeVote={null}
        sharingPreference="prompt"
        onVote={onVote}
      />,
      legacyGeneral,
    );

    await clickButton("Helpful");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Save your feedback sharing preference"));
    await act(async () => {
      client!.setQueryData(queryKeys.instance.generalSettings, {
        ...legacyGeneral,
        outputFeedbackPolicyVersion: "aw-v9-local-v1",
      });
    });
    await vi.waitFor(() => expect(onVote).toHaveBeenLastCalledWith("up", { allowSharing: false }));
    expect(document.body.textContent).not.toContain("Save your feedback sharing preference");

    await act(async () => client!.setQueryData(queryKeys.instance.generalSettings, legacyGeneral));
    expect(document.body.textContent).not.toContain("Save your feedback sharing preference");
  });
});
