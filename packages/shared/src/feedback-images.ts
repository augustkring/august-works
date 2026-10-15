import { z } from "zod";

export const feedbackImageMediaTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
/** No original filename, storage key, scanner output or author identity. */
export const feedbackImageSchema = z.strictObject({
  id: z.uuid(),
  feedbackId: z.uuid(),
  companyId: z.uuid(),
  status: z.enum(["scanning", "storing", "ready", "deleting", "deleted", "failed"]),
  mediaType: feedbackImageMediaTypeSchema,
  byteSize: z.number().int().min(1).max(10485760).nullable(),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
}).superRefine((image, context) => {
  if ((image.status === "deleted") !== (image.deletedAt !== null) ||
      (["ready", "deleting"].includes(image.status) && image.byteSize === null))
    context.addIssue({ code: "custom", message: "Image receipt does not match its native state" });
});
export const feedbackImagesSchema = z.array(feedbackImageSchema).max(3).superRefine((images, context) => {
  if (new Set(images.map(image => image.id)).size !== images.length || images.some(image =>
    image.status === "deleted" || image.status === "failed" || image.companyId !== images[0]?.companyId ||
    image.feedbackId !== images[0]?.feedbackId))
    context.addIssue({ code: "custom", message: "Image list must match one original feedback owner" });
});
export type FeedbackImage = z.infer<typeof feedbackImageSchema>;
