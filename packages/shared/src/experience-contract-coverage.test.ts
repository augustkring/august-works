import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { experienceScreenContractSchema } from "./experience.js";
const root = resolve(import.meta.dirname, "../../.."),
  manifest = JSON.parse(
    readFileSync(resolve(root, "doc/experience/v9/coverage.json"), "utf8"),
  );
describe("Resolved V9 screen contracts", () => {
  for (const screen of manifest.screens.filter(
    (screen: { contractPath?: string }) => screen.contractPath,
  )) {
    it(`${screen.screenId} matches the shared executable schema and coverage identity`, () => {
      const parsed = experienceScreenContractSchema.parse(
        JSON.parse(readFileSync(resolve(root, screen.contractPath), "utf8")),
      );
      expect(parsed.screenId).toBe(screen.screenId);
      expect(parsed.journeyId).toBe(screen.journeyId);
      expect(parsed.actions.primary.operation).not.toContain("TODO");
    });
  }
  it("never substitutes pending implementation or evidence with a source paragraph", () => {
    for (const screen of manifest.screens)
      if (screen.implementationStatus === "implemented")
        expect(screen.contractPath).toBeTruthy();
  });
});
