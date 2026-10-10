import { z } from "zod";
import {
  canonicalExperienceSourceSchema,
  type ExperienceCard,
  type ExperienceModel,
} from "./experience.js";

export const EXPERIENCE_CARD_TOOL = "aw_experience_card";
/** Exact native MCP qualification only; suffix/prefix matching is forbidden. */
export const EXPERIENCE_CARD_TOOL_NAMES = [EXPERIENCE_CARD_TOOL, "mcp__paperclip__aw_experience_card"] as const;
export function isExperienceCardToolName(name: unknown): name is typeof EXPERIENCE_CARD_TOOL_NAMES[number] {
  return EXPERIENCE_CARD_TOOL_NAMES.some(value => name === value);
}

/** A renderer request identifies a current Native view; tool prose is never a view or grant. */
export const EXPERIENCE_TOOL_COMPONENTS = {
  TaskCard: ["progress", "status"],
  ResultCard: ["result"],
  ApprovalCard: ["approval"],
  DecisionCard: ["decision"],
  QuestionForm: ["question"],
  AgentStatusCard: ["agent"],
  ConnectionRequestCard: ["connection"],
  PermissionPreviewCard: ["permission"],
  WorkflowDraftCard: ["workflow"],
  FoundationChangeCard: ["draft"],
  PackageHireCard: ["confirmation"],
  ReadinessBlockerCard: ["warning"],
  MetricInsightCard: ["insight"],
  ProcessFindingCard: ["insight"],
  ScenarioComparisonCard: ["insight"],
  ExperimentResultCard: ["insight"],
  MaintenanceReceiptCard: ["maintenance", "receipt"],
  IncidentCard: ["recovery"],
} as const satisfies Record<string, readonly ExperienceCard["kind"][]>;
export type ExperienceToolComponent = keyof typeof EXPERIENCE_TOOL_COMPONENTS;
export const experienceToolCardRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    component: z.enum(
      Object.keys(EXPERIENCE_TOOL_COMPONENTS) as [
        ExperienceToolComponent,
        ...ExperienceToolComponent[],
      ],
    ),
    companyId: z.uuid(),
    cardId: z.string().min(1).max(2000),
    source: canonicalExperienceSourceSchema.omit({ observedAt: true }),
  })
  .superRefine((value, ctx) => {
    if (value.source.companyId !== value.companyId)
      ctx.addIssue({
        code: "custom",
        message: "Card reference cannot cross companies",
        path: ["source"],
      });
  });
export type ExperienceToolCardRequest = z.infer<
  typeof experienceToolCardRequestSchema
>;

/** Bounded JSON only. Reject prototype/control keys before schema parsing. */
export function parseExperienceToolCardRequest(
  wire: unknown,
): ExperienceToolCardRequest {
  if (typeof wire === "string") {
    if (new TextEncoder().encode(wire).length > 8192)
      throw new Error("Card request unavailable");
    wire = JSON.parse(wire);
  }
  let nodes = 0;
  function visit(value: unknown, depth = 0): void {
    if (++nodes > 64 || depth > 4) throw new Error("Card request unavailable");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number"
    )
      return;
    if (typeof value !== "object" || Array.isArray(value))
      throw new Error("Card request unavailable");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error("Card request unavailable");
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        !Object.hasOwn(descriptor, "value")
      )
        throw new Error("Card request unavailable");
      visit(descriptor.value, depth + 1);
    }
  }
  visit(wire);
  const request = experienceToolCardRequestSchema.parse(wire);
  if (new TextEncoder().encode(JSON.stringify(request)).length > 8192)
    throw new Error("Card request unavailable");
  return request;
}

/** Exact current version, unique source, fresh view and matching catalog type. No executable effects. */
export function resolveExperienceToolCard(
  request: ExperienceToolCardRequest,
  current: ExperienceModel,
): ExperienceCard {
  if (request.companyId !== current.companyId)
    throw new Error("Card unavailable");
  const cards = [
    ...current.needsYou,
    ...current.inProgress,
    ...current.done,
    ...current.watch,
  ].filter((card) => card.id === request.cardId);
  if (cards.length !== 1) throw new Error("Card unavailable");
  const card = cards[0];
  if (
    card.freshness !== "fresh" ||
    card.source.companyId !== request.companyId ||
    card.source.domain !== request.source.domain ||
    card.source.resourceId !== request.source.resourceId ||
    card.source.version !== request.source.version ||
    !(
      EXPERIENCE_TOOL_COMPONENTS[request.component] as readonly string[]
    ).includes(card.kind) ||
    card.actions.some((action) => action.operation !== "open")
  )
    throw new Error("Card unavailable");
  return card;
}
