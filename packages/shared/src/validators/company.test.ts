import { describe, expect, it } from "vitest";
import {
  createCompanySchema,
  updateCompanyBrandingSchema,
  updateCompanySchema,
} from "./company.js";
import { portabilityCompanyManifestEntrySchema } from "./company-portability.js";

describe("company schemas without the retired settings", () => {
  it("accepts supported company locale and strict IANA timezone defaults", () => {
    expect(updateCompanySchema.parse({ locale: "da", timezone: "Europe/Copenhagen" })).toMatchObject({
      locale: "da",
      timezone: "Europe/Copenhagen",
    });
  });

  it.each(["Mars/Olympus", "", "Not_A_Timezone", "+01:00"])("rejects invalid company timezone %s", (timezone) => {
    expect(updateCompanySchema.safeParse({ timezone }).success).toBe(false);
  });

  it("rejects locales not shipped by the app", () => {
    expect(updateCompanySchema.safeParse({ locale: "fr" }).success).toBe(false);
  });

  it("strips brandColor and attachmentMaxBytes from a create payload", () => {
    const parsed = createCompanySchema.parse({
      name: "Acme",
      brandColor: "#123456",
      attachmentMaxBytes: 25_000_000,
    });

    expect(parsed).not.toHaveProperty("brandColor");
    expect(parsed).not.toHaveProperty("attachmentMaxBytes");
    expect(parsed.name).toBe("Acme");
  });

  it.each(["brandColor", "attachmentMaxBytes"])("rejects the retired update field %s", (key) => {
    const result = updateCompanySchema.safeParse({
      description: "Updated",
      [key]: key === "brandColor" ? "#123456" : 25_000_000,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({
      code: "unrecognized_keys", keys: [key],
    }));
  });

  it("accepts an update containing only supported company fields", () => {
    expect(updateCompanySchema.parse({ description: "Updated" })).toEqual({ description: "Updated" });
  });

  it("rejects brandColor on the strict branding schema", () => {
    const result = updateCompanyBrandingSchema.safeParse({
      name: "Acme",
      brandColor: "#123456",
    });

    expect(result.success).toBe(false);
  });

  it("still accepts the remaining branding fields", () => {
    const result = updateCompanyBrandingSchema.safeParse({
      name: "Acme",
      description: null,
      logoAssetId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.success).toBe(true);
  });

  it("requires at least one branding field", () => {
    expect(updateCompanyBrandingSchema.safeParse({}).success).toBe(false);
  });
});

describe("portability company manifest tolerance", () => {
  it("accepts a legacy manifest entry carrying the retired keys and ignores them", () => {
    const parsed = portabilityCompanyManifestEntrySchema.parse({
      path: "company.md",
      name: "Acme",
      description: null,
      brandColor: "#5c5fff",
      logoPath: null,
      attachmentMaxBytes: 25_000_000,
      requireBoardApprovalForNewAgents: false,
    });

    expect(parsed).not.toHaveProperty("brandColor");
    expect(parsed).not.toHaveProperty("attachmentMaxBytes");
    expect(parsed.name).toBe("Acme");
    expect(parsed).toMatchObject({ locale: "en", timezone: "UTC" });
  });

  it("validates portable company locale and IANA timezone values", () => {
    expect(portabilityCompanyManifestEntrySchema.parse({
      path: "COMPANY.md",
      name: "Acme",
      description: null,
      logoPath: null,
      locale: "da",
      timezone: "Europe/Copenhagen",
      requireBoardApprovalForNewAgents: false,
    })).toMatchObject({ locale: "da", timezone: "Europe/Copenhagen" });
    expect(portabilityCompanyManifestEntrySchema.safeParse({
      path: "COMPANY.md",
      name: "Acme",
      description: null,
      logoPath: null,
      locale: "da",
      timezone: "+01:00",
      requireBoardApprovalForNewAgents: false,
    }).success).toBe(false);
  });
});
