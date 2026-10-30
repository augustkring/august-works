import { z } from "zod";

const sidebarOrderedIdSchema = z.string().guid();

export const sidebarOrderPreferenceSchema = z.object({
  orderedIds: z.array(sidebarOrderedIdSchema),
  updatedAt: z.coerce.date().nullable(),
});

export const upsertSidebarOrderPreferenceSchema = z.object({
  orderedIds: z.array(sidebarOrderedIdSchema),
});

export const preferredCoworkerPreferenceSchema = z.object({
  agentId: sidebarOrderedIdSchema.nullable(),
  updatedAt: z.coerce.date().nullable(),
});

export const setPreferredCoworkerPreferenceSchema = z.strictObject({
  agentId: sidebarOrderedIdSchema.nullable(),
});

export type UpsertSidebarOrderPreference = z.infer<typeof upsertSidebarOrderPreferenceSchema>;
export type SetPreferredCoworkerPreference = z.infer<typeof setPreferredCoworkerPreferenceSchema>;
