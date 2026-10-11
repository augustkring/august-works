import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackImagesApi } from "./feedback-images";
import { api } from "./client";
const company = "10000000-0000-4000-8000-000000000001", feedback = "20000000-0000-4000-8000-000000000001";
const image = { id: "30000000-0000-4000-8000-000000000001", companyId: company, feedbackId: feedback,
  status: "ready" as const, mediaType: "image/png" as const, byteSize: 3, createdAt: "2026-10-11T00:00:00Z", deletedAt: null };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("scoped selected image client", () => {
  it("sends only the explicitly selected bytes under a generic filename and immutable request key", async () => {
    const post = vi.spyOn(api, "postForm").mockResolvedValue(image), key = "40000000-0000-4000-8000-000000000001";
    const selected = new File(["png"], "private-local-name.png", { type: "image/png" });
    expect(await feedbackImagesApi.upload(company, "private principal", feedback, key, selected)).toEqual(image);
    const [path, body, options] = post.mock.calls[0]!;
    expect(new URL(path, "https://fixture.invalid").searchParams.get("expectedUserId")).toBe("private principal");
    expect([...(body as FormData).keys()]).toEqual(["file"]);
    const sent = (body as FormData).get("file") as File; expect(sent.name).toBe("image.png"); expect(await sent.text()).toBe("png");
    expect(options?.headers).toEqual({ "X-AW-Feedback-Request-Key": key });
  });
  it("separates operator and submitter read purposes and refuses foreign response metadata", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([image]);
    expect(await feedbackImagesApi.list(company, "operator", feedback, undefined, true)).toEqual([image]);
    expect(get.mock.calls[0]![0]).toContain(`/internal/customer-feedback/${company}/${feedback}/images`);
    expect(get.mock.calls[0]![1]?.cache).toBe("no-store");
    get.mockResolvedValue([{ ...image, companyId: feedback }]);
    await expect(feedbackImagesApi.list(company, "member", feedback)).rejects.toThrow(/context/);
  });
  it("reads bounded protected bytes without persisting a binary or using an object URL", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: {
      "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    } })); vi.stubGlobal("fetch", fetch);
    const blob = await feedbackImagesApi.read(company, "member", feedback, image);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it("refuses oversized, partial or unprotected responses and late cancelled reads", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const [body, headers] of [[new Uint8Array([1, 2, 3, 4]), { "Cache-Control": "private, no-store" }],
      [new Uint8Array([1]), { "Cache-Control": "private, no-store" }],
      [new Uint8Array([1, 2, 3]), { "Cache-Control": "public" }]] as const) {
      fetch.mockResolvedValueOnce(new Response(body, { headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", ...headers } }));
      await expect(feedbackImagesApi.read(company, "member", feedback, image)).rejects.toThrow(/response/);
    }
    const controller = new AbortController();
    fetch.mockImplementationOnce(async () => { controller.abort(); return new Response(new Uint8Array([1, 2, 3]), { headers: {
      "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    } }); });
    await expect(feedbackImagesApi.read(company, "member", feedback, image, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
