import { feedbackImageSchema, feedbackImagesSchema, feedbackImageMediaTypeSchema, type FeedbackImage } from "@paperclipai/shared";
import { api, ApiError } from "./client";
const MAX_BYTES = 10 * 1024 * 1024;
const id = (value: string) => feedbackImageSchema.shape.id.parse(value).toLowerCase();
const path = (company: string, feedback: string) => `/companies/${id(company)}/customer-feedback/${id(feedback)}/images`;
const operatorPath = (company: string, feedback: string) => `/internal/customer-feedback/${id(company)}/${id(feedback)}/images`;
const account = (principal: string) => `?expectedUserId=${encodeURIComponent(principal)}`;
function receipt(raw: unknown, company: string, feedback: string, image?: string) {
  const value = feedbackImageSchema.parse(raw);
  if (value.companyId !== id(company) || value.feedbackId !== id(feedback) || (image && value.id !== id(image)))
    throw Error("Image context changed");
  return value;
}
export const feedbackImagesApi = {
  async list(company: string, principal: string, feedback: string, signal?: AbortSignal, internal = false) {
    const value = feedbackImagesSchema.parse(await api.get((internal ? operatorPath : path)(company, feedback) + account(principal), { signal, cache: "no-store" }));
    signal?.throwIfAborted();
    for (const image of value) receipt(image, company, feedback);
    return value;
  },
  async request(company: string, principal: string, feedback: string, requestKey: string, signal?: AbortSignal) {
    const value = await api.get(`${path(company, feedback)}/requests/${id(requestKey)}${account(principal)}`, { signal, cache: "no-store" });
    signal?.throwIfAborted();
    return value === null ? null : receipt(value, company, feedback);
  },
  async upload(company: string, principal: string, feedback: string, requestKey: string, file: File) {
    const type = feedbackImageMediaTypeSchema.parse(file.type);
    if (!file.size || file.size > MAX_BYTES) throw Error("Image size is invalid");
    // Original local names never enter the multipart request, object key or
    // receipt. Selection previews still display the name to its sender.
    const body = new FormData(); body.append("file", file, `image.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`);
    return receipt(await api.postForm(path(company, feedback) + account(principal), body,
      { headers: { "X-AW-Feedback-Request-Key": id(requestKey) } }), company, feedback);
  },
  async remove(company: string, principal: string, feedback: string, image: string) {
    return receipt(await api.delete(`${path(company, feedback)}/${id(image)}${account(principal)}`), company, feedback, image);
  },
  async read(company: string, principal: string, feedback: string, image: FeedbackImage, signal?: AbortSignal, internal = false) {
    receipt(image, company, feedback, image.id);
    signal?.throwIfAborted();
    if (image.status !== "ready" || image.byteSize === null) throw Error("Image is not ready");
    const response = await fetch(`/api${(internal ? operatorPath : path)(company, feedback)}/${id(image.id)}${account(principal)}`,
      { credentials: "include", cache: "no-store", signal });
    if (!response.ok) throw new ApiError("Protected image could not be read", response.status, null);
    const type = feedbackImageMediaTypeSchema.parse(response.headers.get("Content-Type")?.split(";")[0]);
    const cache = response.headers.get("Cache-Control")?.split(",").map(value => value.trim().toLowerCase());
    if (type !== image.mediaType || !response.body || response.headers.get("X-Content-Type-Options") !== "nosniff" ||
        !cache?.includes("private") || !cache.includes("no-store"))
      throw Error("Protected image response is invalid");
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length;
        if (length > MAX_BYTES || length > image.byteSize) throw Error("Protected image response is oversized");
        chunks.push(new Uint8Array(next.value));
      }
      if (length !== image.byteSize) throw Error("Protected image response is incomplete");
      signal?.throwIfAborted();
      return new Blob(chunks, { type });
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  },
};
