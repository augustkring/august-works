import { z } from "zod";

export const COMPANY_RELATIONSHIP_TYPES = ["portfolio_company", "subsidiary", "parent", "partner", "client", "service_provider", "other"] as const;
export const ORG_UNIT_TYPES = ["department", "team", "function", "leadership", "squad", "other"] as const;
export const createCompanyRelationshipSchema = z.object({
  targetCompanyId: z.string().uuid(),
  relationshipType: z.enum(COMPANY_RELATIONSHIP_TYPES),
}).strict();
export const transitionCompanyRelationshipSchema = z.object({ action: z.enum(["accept", "reject", "revoke"]) }).strict();
export const createOrgUnitSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  type: z.enum(ORG_UNIT_TYPES).default("team"),
  parentId: z.string().uuid().nullable().default(null),
  leadUserId: z.string().min(1).max(200).nullable().default(null),
  leadAgentId: z.string().uuid().nullable().default(null),
}).strict();
export const updateOrgUnitSchema = createOrgUnitSchema.partial().extend({ status: z.enum(["active", "archived"]).optional() }).strict();
export const setOrgUnitMembershipSchema = z.object({
  principalType: z.enum(["user", "agent"]),
  principalId: z.string().min(1).max(200),
  role: z.enum(["lead", "member"]).default("member"),
  status: z.enum(["active", "archived"]).default("active"),
}).strict();

export interface CompanyRelationship {
  id: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  relationshipType: (typeof COMPANY_RELATIONSHIP_TYPES)[number];
  status: "proposed" | "active" | "rejected" | "revoked";
  createdByUserId: string;
  acceptedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface OrgUnit {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  type: (typeof ORG_UNIT_TYPES)[number];
  parentId: string | null;
  leadUserId: string | null;
  leadAgentId: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}
