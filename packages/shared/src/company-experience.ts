import { z } from "zod";
export const COMPANY_EXPERIENCE_SECTIONS = [
  "general",
  "people_access",
  "agents_ai",
  "apps_data",
  "governance_compliance",
  "security",
  "data_privacy",
  "audit_evidence",
  "billing_capacity",
  "advanced_developer",
] as const;
export const companyExperienceSchema = z
  .strictObject({
    companyId: z.uuid(),
    observedAt: z.iso.datetime(),
    sections: z
      .array(
        z.strictObject({
          id: z.enum(COMPANY_EXPERIENCE_SECTIONS),
          entries: z
            .array(
              z.strictObject({
                id: z
                  .string()
                  .regex(/^[a-z_]+$/)
                  .max(80),
                href: z
                  .string()
                  .max(200)
                  .regex(/^\/(?!\/)[a-z0-9_/-]+$/),
              }),
            )
            .max(12),
        }),
      )
      .length(10),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.sections.map((s) => s.id)).size !== 10)
      ctx.addIssue({
        code: "custom",
        message: "Company categories must remain complete and unique",
        path: ["sections"],
      });
  });
export type CompanyExperience = z.infer<typeof companyExperienceSchema>;
