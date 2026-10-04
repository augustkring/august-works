import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import type { CrossCompanyPolicy } from "@paperclipai/shared";
import { companies } from "./companies.js";

export const companyCrossCompanyPolicies = pgTable("company_cross_company_policies", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  policy: jsonb("policy").$type<CrossCompanyPolicy>().notNull().default({ allowRead: false, allowContribute: false, allowAct: false, allowedSensitivities: ["public", "internal"] }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
