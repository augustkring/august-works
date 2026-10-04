import { z } from "zod";
import { AGENT_ROLES } from "./constants.js";

export const agentIdentityStatusSchema = z.enum(["active", "paused", "archived"]);
export const createAgentIdentitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  homeCompanyId: z.string().uuid(),
  description: z.string().max(4000).nullable().optional(),
  baseProfile: z.object({ persona: z.string().max(8000).optional() }).strict().optional(),
}).strict();
export const updateAgentIdentitySchema = createAgentIdentitySchema.omit({ homeCompanyId: true }).partial().extend({
  status: agentIdentityStatusSchema.optional(),
}).strict();
export const rehomeAgentIdentitySchema = z.object({ homeCompanyId: z.string().uuid() }).strict();
export const addAgentPresenceSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(AGENT_ROLES).default("general"),
}).strict();

export interface AgentIdentity {
  id: string;
  name: string;
  homeCompanyId: string;
  status: z.infer<typeof agentIdentityStatusSchema>;
  baseProfile: Record<string, unknown>;
  appearance: Record<string, unknown> | null;
  description: string | null;
  providerPreference: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateAgentIdentityInput = z.input<typeof createAgentIdentitySchema>;
export type AddAgentPresenceInput = z.input<typeof addAgentPresenceSchema>;
