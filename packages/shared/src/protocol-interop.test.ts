import { describe, expect, it } from "vitest";
import {
  decodeExperienceA2Ui,
  decodeExperienceAgUi,
  encodeExperienceA2Ui,
  encodeExperienceAgUi,
  EXPERIENCE_INTEROP_MAX_BYTES,
} from "./protocol-interop.js";
import type { ExperienceCard, ExperienceModel } from "./experience.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const otherCompany = "00000000-0000-4000-8000-000000000002";
const source = {
  companyId,
  domain: "task" as const,
  resourceId: "task",
  version: "1",
  observedAt: "2026-10-10T06:00:00.000Z",
};
const card: ExperienceCard = {
  id: "card",
  kind: "decision",
  title: "Review task",
  whyYou: null,
  consequence: "Open the original task",
  source,
  freshness: "fresh",
  evidence: [],
  actions: [
    {
      id: "view",
      label: "View task",
      operation: "open",
      href: "/issues/task",
      criticality: "C0",
      source,
      requiresCurrentAuthorization: true,
    },
  ],
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
const message = "Current experience view unavailable";

describe("optional read-only protocol seams", () => {
  it("round-trips admitted Native snapshots without trusting or mutating peer objects", () => {
    const wire = encodeExperienceAgUi(model, companyId);
    expect(decodeExperienceAgUi(wire, model, companyId)).toEqual(model);
    expect(decodeExperienceAgUi(wire, model, companyId)).not.toBe(model);
    const a2ui = encodeExperienceA2Ui(card, companyId, "current-card");
    expect(decodeExperienceA2Ui(a2ui, card, companyId, "current-card")).toEqual(
      card,
    );
  });
  it.each(["title", "evidence", "source", "actions", "freshness"])(
    "refuses a peer-modified %s even when its Native DTO is valid",
    (field) => {
      const modified = structuredClone(card);
      if (field === "title") modified.title = "Forged approval";
      if (field === "evidence") modified.evidence = ["verified"];
      if (field === "source") modified.source.version = "2";
      if (field === "actions") modified.actions[0].href = "/issues/other";
      if (field === "freshness") modified.freshness = "stale";
      const wire = encodeExperienceA2Ui(modified, companyId, "current-card");
      expect(() =>
        decodeExperienceA2Ui(wire, card, companyId, "current-card"),
      ).toThrow(message);
      const event = encodeExperienceAgUi(
        { ...model, needsYou: [modified] },
        companyId,
      );
      expect(() => decodeExperienceAgUi(event, model, companyId)).toThrow(
        message,
      );
    },
  );
  it("withdraws old protocol state after a Native version, profile or company change", () => {
    const wire = encodeExperienceAgUi(model, companyId);
    expect(() =>
      decodeExperienceAgUi(wire, { ...model, profile: "admin" }, companyId),
    ).toThrow(message);
    expect(() =>
      decodeExperienceAgUi(
        wire,
        { ...model, generatedAt: "2026-10-10T06:01:00.000Z" },
        companyId,
      ),
    ).toThrow(message);
    expect(() => decodeExperienceAgUi(wire, model, otherCompany)).toThrow(
      message,
    );
    expect(() => encodeExperienceAgUi(model, otherCompany)).toThrow(message);
    expect(() =>
      encodeExperienceA2Ui(card, otherCompany, "current-card"),
    ).toThrow(message);
  });
  it("refuses all effectful operations instead of filtering or dispatching them", () => {
    for (const operation of [
      "approve",
      "reject",
      "answer",
      "reconnect",
      "retry",
      "snooze",
      "dismiss",
      "stop",
      "publish",
    ] as const) {
      const material = {
        ...card,
        actions: [{ ...card.actions[0], operation }],
      };
      expect(() =>
        encodeExperienceA2Ui(material, companyId, "current-card"),
      ).toThrow(message);
      expect(() =>
        encodeExperienceAgUi({ ...model, needsYou: [material] }, companyId),
      ).toThrow(message);
    }
  });
  it.each(["rawEvent", "metadata", "timestamp", "handler", "__proto__"])(
    "refuses unknown AG-UI %s without exposing its content",
    (key) => {
      const event = JSON.parse(encodeExperienceAgUi(model, companyId));
      Object.defineProperty(event, key, {
        value: "private-secret",
        enumerable: true,
      });
      expect(() =>
        decodeExperienceAgUi(JSON.stringify(event), model, companyId),
      ).toThrow(message);
    },
  );
  it.each(["RUN_FINISHED", "TOOL_CALL_START", "TEXT_MESSAGE_CONTENT"])(
    "refuses %s as experience evidence",
    (type) => {
      expect(() =>
        decodeExperienceAgUi(
          JSON.stringify({ type, name: "anything", value: model }),
          model,
          companyId,
        ),
      ).toThrow(message);
    },
  );
  it("refuses unknown A2UI versions, catalogs, surfaces, components, ordering and updates", () => {
    const baseline = JSON.parse(
      encodeExperienceA2Ui(card, companyId, "current-card"),
    );
    const variants = [
      [baseline[1], baseline[0]],
      [
        baseline[0],
        baseline[1],
        { version: "v0.9", deleteSurface: { surfaceId: "current-card" } },
      ],
      [{ ...baseline[0], version: "v1" }, baseline[1]],
      [
        {
          ...baseline[0],
          createSurface: { ...baseline[0].createSurface, catalogId: "unknown" },
        },
        baseline[1],
      ],
      [
        baseline[0],
        {
          version: "v0.9",
          updateDataModel: {
            surfaceId: "current-card",
            value: { call: "approve" },
          },
        },
      ],
      [
        baseline[0],
        {
          ...baseline[1],
          updateComponents: {
            ...baseline[1].updateComponents,
            components: [
              ...baseline[1].updateComponents.components,
              ...baseline[1].updateComponents.components,
            ],
          },
        },
      ],
    ];
    for (const value of variants)
      expect(() =>
        decodeExperienceA2Ui(
          JSON.stringify(value),
          card,
          companyId,
          "current-card",
        ),
      ).toThrow(message);
    expect(() =>
      decodeExperienceA2Ui(
        JSON.stringify(baseline),
        card,
        companyId,
        "other-surface",
      ),
    ).toThrow(message);
    const dynamic = structuredClone(baseline);
    dynamic[1].updateComponents.components[0].card.title = {
      call: "sendPrivateData",
    };
    expect(() =>
      decodeExperienceA2Ui(
        JSON.stringify(dynamic),
        card,
        companyId,
        "current-card",
      ),
    ).toThrow(message);
  });
  it("rejects invalid/oversized JSON and never coerces hostile objects", () => {
    const hostile = {
      toJSON() {
        throw new Error("private-secret");
      },
      toString() {
        throw new Error("private-secret");
      },
    };
    for (const value of [
      hostile,
      null,
      "private-secret",
      "{",
      " ".repeat(EXPERIENCE_INTEROP_MAX_BYTES + 1),
      JSON.stringify("å".repeat(EXPERIENCE_INTEROP_MAX_BYTES / 2)),
    ]) {
      expect(() => decodeExperienceAgUi(value, model, companyId)).toThrow(
        message,
      );
      expect(() =>
        decodeExperienceA2Ui(value, card, companyId, "current-card"),
      ).toThrow(message);
    }
    const hugeCard = { ...card, evidence: Array(8).fill("å".repeat(2000)) };
    const hugeModel = { ...model, needsYou: Array(25).fill(hugeCard) };
    expect(() => encodeExperienceAgUi(hugeModel, companyId)).toThrow(message);
  });
});
