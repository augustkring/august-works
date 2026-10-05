import { z } from "zod";
import {
  runtimeGenerationSchema,
  runtimeHostProofSchema,
} from "./runtime-host-contracts.js";
const channelId = z.string().uuid();
export const runtimeRelayMessageSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("hello"), proof: runtimeHostProofSchema })
    .strict(),
  z
    .object({
      type: z.literal("open"),
      channelId,
      cellId: z.string().uuid(),
      companyId: z.string().uuid(),
      generation: runtimeGenerationSchema,
    })
    .strict(),
  z.object({ type: z.literal("opened"), channelId }).strict(),
  z
    .object({
      type: z.literal("data"),
      channelId,
      text: z.string().max(1024 * 1024),
    })
    .strict(),
  z.object({ type: z.literal("close"), channelId }).strict(),
]);
