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
  it("validates the supporting native maintenance history contract without substituting it for the 70 launch surfaces", () => {
    const parsed = experienceScreenContractSchema.parse(
      JSON.parse(
        readFileSync(
          resolve(root, "doc/experience/v9/contracts/maintenance-history.json"),
          "utf8",
        ),
      ),
    );
    expect(parsed.screenId).toBe("MAINTENANCE-HISTORY");
    expect(parsed.journeyId).toBe("maintenance");
    expect(manifest.screens).toHaveLength(70);
  });
  it("validates native V6 support history as a supporting contract without replacing launch acceptance", () => {
    const parsed = experienceScreenContractSchema.parse(
      JSON.parse(
        readFileSync(
          resolve(root, "doc/experience/v9/contracts/support-access.json"),
          "utf8",
        ),
      ),
    );
    expect(parsed.screenId).toBe("SUPPORT-ACCESS");
    expect(parsed.journeyId).toBe("support");
    expect(manifest.screens).toHaveLength(70);
  });
  it("validates original Native support controls as a supporting contract without replacing launch acceptance", () => {
    const parsed = experienceScreenContractSchema.parse(
      JSON.parse(
        readFileSync(
          resolve(
            root,
            "doc/experience/v9/contracts/native-support-controls.json",
          ),
          "utf8",
        ),
      ),
    );
    expect(parsed.screenId).toBe("NATIVE-SUPPORT-CONTROLS");
    expect(parsed.journeyId).toBe("support");
    expect(manifest.screens).toHaveLength(70);
  });
  it("validates personal Native account recovery without substituting it for launch acceptance", () => {
    const parsed = experienceScreenContractSchema.parse(JSON.parse(readFileSync(resolve(root, "doc/experience/v9/contracts/account-security.json"), "utf8")));
    expect(parsed.screenId).toBe("NATIVE-ACCOUNT-SECURITY");
    expect(parsed.journeyId).toBe("account");
    expect(manifest.screens).toHaveLength(70);
  });
  it("never substitutes pending implementation or evidence with a source paragraph", () => {
    for (const screen of manifest.screens)
      if (screen.implementationStatus === "implemented")
        expect(screen.contractPath).toBeTruthy();
  });
});
