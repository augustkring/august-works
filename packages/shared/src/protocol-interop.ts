import { z } from "zod";
import {
  experienceCardSchema,
  experienceModelSchema,
  type ExperienceCard,
  type ExperienceModel,
} from "./experience.js";

/** Optional, offline presentation experiments; never an authorization source. */
export const EXPERIENCE_INTEROP_MAX_BYTES = 64 * 1024;
export const EXPERIENCE_AG_UI_EVENT = "august_works.experience.snapshot.v9";
export const EXPERIENCE_A2UI_CATALOG = "blentera.com:aw-experience-v9-readonly";
const surfaceIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const experienceAgUiEventSchema = z.strictObject({
  type: z.literal("CUSTOM"),
  name: z.literal(EXPERIENCE_AG_UI_EVENT),
  value: experienceModelSchema,
});
export const experienceA2UiComponentSchema = z.strictObject({
  id: z.literal("root"),
  component: z.literal("AWExperienceCard"),
  card: experienceCardSchema,
});
const a2uiMessagesSchema = z.tuple([
  z.strictObject({
    version: z.literal("v0.9"),
    createSurface: z.strictObject({
      surfaceId: surfaceIdSchema,
      catalogId: z.literal(EXPERIENCE_A2UI_CATALOG),
    }),
  }),
  z.strictObject({
    version: z.literal("v0.9"),
    updateComponents: z.strictObject({
      surfaceId: surfaceIdSchema,
      components: z.tuple([experienceA2UiComponentSchema]),
    }),
  }),
]);

function refuse(): never {
  // No peer content, parser diagnostics or private DTO in returned errors.
  throw new Error("Current experience view unavailable");
}
function readWire(wire: unknown): unknown {
  // Do not invoke an untrusted object's getters, toJSON or coercion methods.
  if (
    typeof wire !== "string" ||
    wire.length > EXPERIENCE_INTEROP_MAX_BYTES ||
    new TextEncoder().encode(wire).byteLength > EXPERIENCE_INTEROP_MAX_BYTES
  )
    refuse();
  return JSON.parse(wire, (key, value: unknown) => {
    if (["__proto__", "constructor", "prototype"].includes(key)) refuse();
    return value;
  });
}
function writeWire(value: unknown): string {
  const wire = JSON.stringify(value);
  if (new TextEncoder().encode(wire).byteLength > EXPERIENCE_INTEROP_MAX_BYTES)
    refuse();
  return wire;
}
function readonlyCard(card: ExperienceCard, companyId: string): void {
  if (
    card.source.companyId !== companyId ||
    card.actions.some((action) => action.operation !== "open")
  )
    refuse();
}
function readonlyModel(model: ExperienceModel, companyId: string): void {
  if (model.companyId !== companyId) refuse();
  for (const card of [
    ...model.needsYou,
    ...model.inProgress,
    ...model.done,
    ...model.watch,
  ])
    readonlyCard(card, companyId);
}

export function encodeExperienceAgUi(
  currentNative: ExperienceModel,
  companyId: string,
): string {
  try {
    const model = experienceModelSchema.parse(currentNative);
    readonlyModel(model, companyId);
    return writeWire({
      type: "CUSTOM",
      name: EXPERIENCE_AG_UI_EVENT,
      value: model,
    });
  } catch {
    return refuse();
  }
}

/** Caller must independently read current authorized Native state for this epoch. */
export function decodeExperienceAgUi(
  wire: unknown,
  currentNative: ExperienceModel,
  companyId: string,
): ExperienceModel {
  try {
    const model = experienceModelSchema.parse(currentNative);
    readonlyModel(model, companyId);
    const event = experienceAgUiEventSchema.parse(readWire(wire));
    if (JSON.stringify(event.value) !== JSON.stringify(model)) refuse();
    // Return the separately admitted Native copy, never the peer object.
    return model;
  } catch {
    return refuse();
  }
}

export function encodeExperienceA2Ui(
  currentNative: ExperienceCard,
  companyId: string,
  surfaceId: string,
): string {
  try {
    const card = experienceCardSchema.parse(currentNative);
    readonlyCard(card, companyId);
    surfaceIdSchema.parse(surfaceId);
    return writeWire([
      {
        version: "v0.9",
        createSurface: { surfaceId, catalogId: EXPERIENCE_A2UI_CATALOG },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId,
          components: [{ id: "root", component: "AWExperienceCard", card }],
        },
      },
    ]);
  } catch {
    return refuse();
  }
}

export function decodeExperienceA2Ui(
  wire: unknown,
  currentNative: ExperienceCard,
  companyId: string,
  surfaceId: string,
): ExperienceCard {
  try {
    const card = experienceCardSchema.parse(currentNative);
    readonlyCard(card, companyId);
    surfaceIdSchema.parse(surfaceId);
    const [create, update] = a2uiMessagesSchema.parse(readWire(wire));
    if (
      create.createSurface.surfaceId !== surfaceId ||
      update.updateComponents.surfaceId !== surfaceId ||
      JSON.stringify(update.updateComponents.components[0].card) !==
        JSON.stringify(card)
    )
      refuse();
    return card;
  } catch {
    return refuse();
  }
}
