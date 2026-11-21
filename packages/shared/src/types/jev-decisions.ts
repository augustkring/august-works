import { z } from "zod";

export const JEV_DECISION_MODEL = "typesafe/jev-1.13" as const;
export const JEV_DECISION_CHALLENGER_MODEL = "typesafe/jev-1.14" as const;
export const jevDecisionSettingsUpdateSchema = z.object({
  mode: z.enum(["off", "shadow", "suggestions"]),
  allowBackground: z.boolean().optional(),
  connectionId: z.string().uuid().nullable(),
  grantId: z.string().uuid().nullable(),
}).strict().refine(value => Boolean(value.connectionId) === Boolean(value.grantId), "A connection and grant must be selected together");
export type JevDecisionMode = "off" | "shadow" | "suggestions";
export type JevDecisionSettingsUpdate = z.infer<typeof jevDecisionSettingsUpdateSchema>;
export interface JevDecisionSettings extends Omit<JevDecisionSettingsUpdate, "allowBackground"> { allowBackground: boolean; companyId: string; updatedAt: string }
export const jevDecisionQuestionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boolean"), instructions: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ type: z.literal("choice"), instructions: z.string().trim().min(1).max(8000), criteria: z.record(z.string().min(1).max(100), z.string().min(1).max(2000)).refine(v => Object.keys(v).length >= 2 && Object.keys(v).length <= 20) }).strict(),
  z.object({ type: z.literal("score"), instructions: z.string().trim().min(1).max(8000), criteria: z.array(z.string().min(1).max(2000)).min(2).max(20) }).strict(),
]);
export const jevDecisionRequestSchema = z.object({
  state: z.union([z.string().min(1), z.record(z.string(), z.json()), z.array(z.json())]),
  questions: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), jevDecisionQuestionSchema).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 20),
}).strict();
export type JevDecisionRequest = z.infer<typeof jevDecisionRequestSchema>;
export type JevDecisionAnswer =
  | { type: "boolean"; probability: number; confidence?: number }
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "score"; score: number; probabilities?: Record<string, number>; confidence?: number };
