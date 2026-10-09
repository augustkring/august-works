// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationPolicySettings } from "./NotificationPolicySettings";
import { saasApi } from "../api/saas";
import { i18n } from "../i18n";

let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

it("explains invalid delivery times, focuses the field, and saves in-app delivery without hidden invalid fields", async () => {
  await i18n.changeLanguage("en");
  const saved = vi.fn();
  const update = vi
    .spyOn(saasApi, "updateNotificationPreference")
    .mockResolvedValue({
      category: "work_update",
      emailEnabled: true,
    });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NotificationPolicySettings
          item={{ category: "work_update", emailEnabled: true }}
          companyId="10000000-0000-4000-8000-000000000001"
          principal="member"
          onSaved={saved}
        />
      </QueryClientProvider>,
    ),
  );
  const timezone = host.querySelector<HTMLInputElement>(
    'input[name="timezone"]',
  )!;
  const setValue = (element: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => setValue(timezone, "not-a-timezone"));
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(update).not.toHaveBeenCalled();
  expect(timezone.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(timezone);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    "Enter a valid timezone",
  );
  const describedBy = timezone.getAttribute("aria-describedby")!;
  expect(document.getElementById(describedBy)).not.toBeNull();
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "in_app_only";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(update).toHaveBeenCalledWith(
    "10000000-0000-4000-8000-000000000001",
    "member",
    expect.objectContaining({
      policy: expect.objectContaining({
        cadence: "in_app_only",
        quietHours: null,
      }),
    }),
  );
});
