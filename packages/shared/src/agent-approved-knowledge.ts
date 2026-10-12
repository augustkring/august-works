import { z } from "zod";

/** Body-free identity of the current selected approved Foundation revisions. */
export const selectedApprovedKnowledgeSchema = z.strictObject({
  foundationDocumentId: z.uuid(), documentId: z.uuid(), revisionId: z.uuid(), revisionNumber: z.number().int().positive(),
  title: z.string().min(1).max(500), bodyHash: z.string().regex(/^[a-f0-9]{64}$/), sensitivity: z.enum(["public", "internal"]),
  validFrom: z.iso.datetime().nullable(), validUntil: z.iso.datetime().nullable(),
});
export type SelectedApprovedKnowledge = z.infer<typeof selectedApprovedKnowledgeSchema>;
