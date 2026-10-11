// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackImageSelection, useSelectedFeedbackImages } from "./FeedbackImageSelection";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root | null = null, container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; container?.remove(); container = null;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(props: { enabled?: boolean; locked?: boolean } = {}) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<Harness {...props} />));
}
async function select(files: File[]) {
  const input = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function Harness({ enabled = true, locked = false }: { enabled?: boolean; locked?: boolean }) {
  const { images, change } = useSelectedFeedbackImages();
  return <FeedbackImageSelection images={images} onChange={change} enabled={enabled} locked={locked} />;
}
function urls() {
  const create = vi.fn(() => "blob:owned-selected-image"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  return { create, revoke };
}
describe("explicit local feedback images", () => {
  it("previews a selected image and releases its Blob URL on removal without any request", async () => {
    const { create, revoke } = urls(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await render();
    await select([new File(["owned-png"], "local-private-name.png", { type: "image/png" })]);
    expect(create).toHaveBeenCalledOnce();
    expect(container!.querySelector("img")!.getAttribute("src")).toBe("blob:owned-selected-image");
    const remove = container!.querySelector<HTMLButtonElement>('[aria-label="feedback.images.removeNumber"]')!;
    await act(async () => remove.click());
    expect(revoke).toHaveBeenCalledWith("blob:owned-selected-image"); expect(container!.querySelector("img")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a whole invalid, oversized or four-file selection before creating any preview URL", async () => {
    const { create } = urls(); await render();
    for (const files of [[new File(["svg"], "private.svg", { type: "image/svg+xml" })],
      [new File([new Uint8Array(10485761)], "large.png", { type: "image/png" })],
      Array.from({ length: 4 }, () => new File(["png"], "image.png", { type: "image/png" }))]) {
      await select(files);
      expect(container!.querySelector('[role="alert"]')!.textContent).toBe("feedback.images.invalid");
    }
    expect(create).not.toHaveBeenCalled();
  });
  it("releases remaining URLs on account/form unmount", async () => {
    const { revoke } = urls(); await render();
    await select([new File(["png"], "name.png", { type: "image/png" })]);
    await act(async () => root!.unmount()); root = null; expect(revoke).toHaveBeenCalledOnce();
  });
  it("disables selection while runtime admission is unavailable or the original request is locked", async () => {
    await render({ enabled: false });
    expect(container!.querySelector("button")!.hasAttribute("disabled")).toBe(true);
    expect(container!.querySelector("input")!.hasAttribute("disabled")).toBe(true);
    await act(async () => root!.render(<Harness locked />));
    expect(container!.querySelector("button")!.hasAttribute("disabled")).toBe(true);
  });
});
