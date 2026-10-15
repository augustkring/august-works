// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToastActions, useToastState } from "./ToastContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("ToastContext", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("bounds a long-session burst and cleans up every remaining timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const root = createRoot(container);
    let actions!: ReturnType<typeof useToastActions>;
    function Probe() {
      actions = useToastActions();
      return <div>{useToastState().map(toast => toast.title).join(",")}</div>;
    }
    act(() => root.render(<ToastProvider><Probe /></ToastProvider>));
    act(() => {
      for (let index = 0; index < 10000; index++) {
        actions.pushToast({ title: `Result ${index}`, dedupeKey: `event-${index}` });
      }
    });
    expect(vi.getTimerCount()).toBe(5);
    expect(container.textContent).toBe("Result 9999,Result 9998,Result 9997,Result 9996,Result 9995");
    act(() => {
      expect(actions.pushToast({ title: "Duplicate", dedupeKey: "event-9999" })).toBeNull();
      // Capacity eviction allows old presentation keys again; it cannot block
      // new results or grow memory in proportion to an unbounded event stream.
      expect(actions.pushToast({ title: "Old result", dedupeKey: "event-0" })).not.toBeNull();
    });
    expect(vi.getTimerCount()).toBe(5);
    act(() => vi.advanceTimersByTime(60000));
    expect(container.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    act(() => actions.pushToast({ title: "After idle" }));
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not rerender action-only consumers when toast state changes", () => {
    const root = createRoot(container);
    let actionOnlyRenderCount = 0;
    let pushToastRef: ((input: { title: string }) => string | null) | null = null;
    let clearToastsRef: (() => void) | null = null;

    function ActionOnlyConsumer() {
      actionOnlyRenderCount += 1;
      const { pushToast, clearToasts } = useToastActions();
      pushToastRef = pushToast;
      clearToastsRef = clearToasts;
      return null;
    }

    function ToastCount() {
      const toasts = useToastState();
      return <div data-testid="toast-count">{String(toasts.length)}</div>;
    }

    act(() => {
      root.render(
        <ToastProvider>
          <ActionOnlyConsumer />
          <ToastCount />
        </ToastProvider>,
      );
    });

    expect(actionOnlyRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="toast-count"]')?.textContent).toBe("0");

    act(() => {
      pushToastRef?.({ title: "Saved" });
    });

    expect(actionOnlyRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="toast-count"]')?.textContent).toBe("1");

    act(() => {
      clearToastsRef?.();
    });

    expect(actionOnlyRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="toast-count"]')?.textContent).toBe("0");

    act(() => {
      root.unmount();
    });
  });
});
