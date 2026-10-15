import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { z } from "zod";
import { expect, it } from "vitest";
import {
  encodeExperienceAgUi,
  encodeExperienceA2Ui,
  experienceA2UiComponentSchema,
  type ExperienceCard,
  type ExperienceModel,
} from "@paperclipai/shared";

const upstream = new URL(
  "../../../doc/experience/v9/protocol-interop/upstream/",
  import.meta.url,
);
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(name, upstream), "utf8"));
const companyId = "00000000-0000-4000-8000-000000000001";
const source = {
  domain: "task" as const,
  companyId,
  resourceId: "task",
  version: "1",
  observedAt: "2026-10-10T06:00:00.000Z",
};
const card: ExperienceCard = {
  id: "card",
  kind: "status",
  title: "Task status",
  whyYou: null,
  consequence: null,
  source,
  freshness: "fresh",
  actions: [],
  evidence: [],
};
const model: ExperienceModel = {
  companyId,
  profile: "member",
  generatedAt: source.observedAt,
  dependencies: [],
  needsYou: [card],
  inProgress: [],
  done: [],
  watch: [],
};

it("preserves exact pinned upstream files and their license provenance", () => {
  for (const file of read("manifest.json").files) {
    const bytes = readFileSync(new URL(file.file, upstream));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    expect(file.source).toContain(`/${file.commit}/`);
    expect(["MIT", "Apache-2.0"]).toContain(file.license);
  }
});

it("validates the AG-UI CUSTOM mapping against pinned official spec 1.0", () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  ajv.addSchema(read("ag-ui-1.0.schema.json"));
  const validate = ajv.compile({
    $ref: "https://ag-ui.com/spec/1.0/schema.json#/$defs/CustomEvent",
  });
  expect(validate(JSON.parse(encodeExperienceAgUi(model, companyId)))).toBe(
    true,
  );
  expect(validate({ type: "CUSTOM", value: model })).toBe(false);
  expect(validate({ type: "CUSTOM", name: "example" })).toBe(false);
});

it("validates the ordered custom A2UI catalog against pinned official v0.9 messages", () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  // Zod semantic refinements are enforced by the adapter; this schema checks
  // structural catalog compatibility, not current authority or source identity.
  ajv.addSchema({
    $id: "https://a2ui.org/specification/v0_9/catalog.json",
    $defs: {
      anyComponent: z.toJSONSchema(experienceA2UiComponentSchema, {
        unrepresentable: "any",
      }),
      theme: { type: "object", additionalProperties: false },
    },
  });
  const validate = ajv.compile(read("a2ui-v0.9.server-to-client.json"));
  for (const event of JSON.parse(
    encodeExperienceA2Ui(card, companyId, "current-card"),
  ))
    expect(validate(event)).toBe(true);
  expect(
    validate({
      version: "v1",
      createSurface: { surfaceId: "current-card", catalogId: "unknown" },
    }),
  ).toBe(false);
  expect(
    validate({
      version: "v0.9",
      updateComponents: { surfaceId: "current-card", components: [] },
    }),
  ).toBe(false);
  expect(
    validate({
      version: "v0.9",
      updateComponents: {
        surfaceId: "current-card",
        components: [{ id: "root", component: "HTML", html: "private" }],
      },
    }),
  ).toBe(false);
});
