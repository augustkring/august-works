import { z } from "zod";

export const ROLE_PACK_ITEM_TYPES = ["required_skill", "recommended_skill", "required_playbook", "recommended_playbook", "required_policy", "capability_expectation", "resolver_rule"] as const;
export const RUNTIME_POLICY_KEYS = ["approval_before_side_effects", "budget_hard_stop", "source_provenance", "verify_critical_changes", "security_review", "production_rollout_rollback"] as const;
export const rolePackItemSchema = z.object({
  type: z.enum(ROLE_PACK_ITEM_TYPES), ref: z.string().trim().min(1).max(300),
  versionId: z.string().uuid().nullable().default(null),
  operation: z.enum(["add", "remove"]).default("add"),
  loadPoint: z.enum(["always", "task_relevant", "on_demand"]).default("task_relevant"),
  triggerTerms: z.array(z.string().trim().min(1).max(100)).max(32).default([]),
  excludeTerms: z.array(z.string().trim().min(1).max(100)).max(32).default([]),
}).strict().superRefine((item, ctx) => {
  if (item.type === "required_policy" && !(RUNTIME_POLICY_KEYS as readonly string[]).includes(item.ref)) ctx.addIssue({ code: "custom", message: "Unknown typed execution policy", path: ["ref"] });
  if (item.operation === "remove" && !["recommended_skill", "recommended_playbook", "resolver_rule"].includes(item.type)) ctx.addIssue({ code: "custom", message: "Only recommended items or resolver hints may be removed" });
});
export type RolePackItem = z.infer<typeof rolePackItemSchema>;
export const rolePackVersionInputSchema = z.object({
  items: z.array(rolePackItemSchema).max(100), summary: z.string().max(4000).default(""),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.items.map((item) => `${item.type}:${item.ref}`)).size !== value.items.length) ctx.addIssue({ code: "custom", message: "Role Pack items must have unique type/reference pairs" });
});
export const createRolePackSchema = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/), name: z.string().trim().min(1).max(200), description: z.string().max(4000).default("") }).strict();
export const assignRolePackSchema = z.object({ scopeType: z.enum(["company", "org_unit", "agent"]), scopeId: z.string().uuid(), rolePackId: z.string().uuid(), versionPolicy: z.enum(["follow_published", "pinned"]).default("follow_published"), pinnedVersionId: z.string().uuid().nullable().default(null) }).strict().superRefine((value, ctx) => {
  if ((value.versionPolicy === "pinned") !== Boolean(value.pinnedVersionId)) ctx.addIssue({ code: "custom", message: "A pinned assignment requires exactly one pinned version" });
});
export const publishRolePackSchema = z.object({ expectedPublishedVersionId: z.string().uuid().nullable() }).strict();

export const SYSTEM_ROLE_PACK_VERSION = "aw-role-packs-v5.3";
export const SYSTEM_SKILL_TRIGGER_TERMS: Record<string, readonly string[]> = {
  "business-design": ["business model", "business plan", "pricing", "revenue", "forretningsmodel"],
  "market-validation": ["market validation", "customer research", "pretotyping", "validate demand", "markedsvalidering"],
  "task-planning": ["plan", "roadmap", "milestone", "dependency", "dependencies", "schedule", "planlægning"],
  "engineering-planning": ["implementation plan", "engineering plan", "technical plan", "migration", "release plan"],
  "software-architecture": ["architecture", "system design", "architectural", "arkitektur"],
  "security-engineering": ["security", "authentication", "authorization", "credential", "credentials", "permissions", "sikkerhed"],
  "engineering-workflow": ["commit", "pull request", "branch", "release", "configuration management"],
  "delegation-review": ["delegate", "delegation", "review implementation", "review code", "review pull request"],
  "backend-services": ["backend", "service", "endpoint", "server", "worker"],
  "code-quality": ["implement", "implementation", "refactor", "code", "bug", "fix"],
  "api-contract": ["api", "endpoint", "contract", "integration", "schema"],
  "database-change-safety": ["database", "migration", "sql", "postgres", "drizzle", "datamigration"],
  "testing-verification": ["test", "tests", "testing", "verify", "verification", "regression"],
  "web-frontend": ["frontend", "react", "browser", "component", "css", "web"],
  "ui-design": ["ui", "interface", "layout", "visual design", "design system"],
  "accessibility": ["accessibility", "keyboard", "screen reader", "aria", "wcag", "tilgængelighed"],
  "ux-design": ["ux", "user experience", "user flow", "usability", "brugeroplevelse"],
  "universal-design-principles": ["design", "typography", "contrast", "layout", "affordance"],
  "marketing-measurement": ["attribution", "conversion", "conversions", "analytics", "measurement", "campaign"],
  "brand-positioning": ["brand", "positioning", "branding", "messaging"],
  "requirements-engineering": ["requirements", "specification", "acceptance criteria", "domain model", "krav"],
  "reliability-engineering": ["reliability", "incident", "observability", "availability", "recovery", "sre"],
  "devops-release": ["deploy", "deployment", "release", "ci", "cd", "pipeline", "supply chain"],
  "cost-engineering": ["cost", "budget", "performance", "scalability", "capacity", "omkostninger"],
};
const requirements = {
  ceo: ["business-design", "market-validation", "task-planning"],
  cto: ["engineering-planning", "task-planning", "software-architecture", "security-engineering", "engineering-workflow", "delegation-review"],
  backend_engineer: ["backend-services", "code-quality", "api-contract", "database-change-safety", "testing-verification"],
  frontend_engineer: ["web-frontend", "ui-design", "accessibility", "testing-verification"],
  designer: ["ux-design", "ui-design", "universal-design-principles"],
  growth: ["market-validation", "marketing-measurement", "brand-positioning"],
  research: ["requirements-engineering", "market-validation"],
  ops: ["reliability-engineering", "devops-release", "security-engineering"],
  finance: ["business-design", "cost-engineering"],
} as const;
export const SYSTEM_ROLE_PACKS = Object.entries(requirements).map(([key, required]) => ({
  key, name: key.replaceAll("_", " "), version: SYSTEM_ROLE_PACK_VERSION,
  items: [
    ...required.map((ref) => rolePackItemSchema.parse({ type: "required_skill", ref, triggerTerms: SYSTEM_SKILL_TRIGGER_TERMS[ref] ?? [] })),
    ...RUNTIME_POLICY_KEYS.map((ref) => rolePackItemSchema.parse({ type: "required_policy", ref, loadPoint: "always" })),
  ],
}));

/** Stable overlays add requirements; only optional entries can be removed. */
export function mergeRolePackItems(layers: readonly (readonly RolePackItem[])[]): RolePackItem[] {
  const items = new Map<string, RolePackItem>();
  for (const layer of layers) for (const raw of layer) {
    const item = rolePackItemSchema.parse(raw), key = `${item.type}:${item.ref}`;
    if (item.operation === "remove") items.delete(key);
    else {
      const existing = items.get(key);
      if (existing?.versionId && item.versionId && existing.versionId !== item.versionId) throw new Error(`Conflicting pinned Role Pack requirement: ${key}`);
      items.set(key, existing ? { ...existing, ...item, versionId: item.versionId ?? existing.versionId, loadPoint: existing.loadPoint === "always" ? "always" : item.loadPoint } : item);
    }
  }
  return [...items.values()].sort((a, b) => `${a.type}:${a.ref}`.localeCompare(`${b.type}:${b.ref}`));
}
