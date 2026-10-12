import { z } from "zod";
export const selectedApprovedMemorySchema = z.strictObject({ recordId: z.uuid(), version: z.iso.datetime(),
  title: z.string().min(1).max(500), bodyHash: z.string().regex(/^[a-f0-9]{64}$/), sensitivity: z.enum(["public", "internal"]),
  expiresAt: z.iso.datetime(), validFrom: z.iso.datetime().nullable(), validUntil: z.iso.datetime().nullable() });
