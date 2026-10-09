import type { Db } from "@paperclipai/db";
import {
  COMPANY_EXPERIENCE_SECTIONS,
  companyExperienceSchema,
  v6FeatureEnabled,
  v7FeatureEnabled,
  v9FeatureEnabled,
  type CompanyExperience,
} from "@paperclipai/shared";
import {
  authorizationService,
  type AuthorizationAction,
  type AuthorizationActor,
} from "../authorization.js";
import { experienceService } from "./service.js";
import { instanceSettingsService } from "../instance-settings.js";
import { withExperienceAdmission } from "./admission.js";
import { forbidden, notFound } from "../../errors.js";
export async function companyExperience(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  signal?: AbortSignal,
) {
  return withExperienceAdmission(
    async (signal) => {
      const flags = await instanceSettingsService(db).getExperimental();
      if (!v9FeatureEnabled(flags, "progressive_shell_v9"))
        throw notFound("Company navigation is not enabled");
      const context = await experienceService(db).context(actor, companyId);
      if (
        !context.availableProfiles.includes("admin") &&
        !context.availableProfiles.includes("security_admin")
      )
        throw forbidden("Company administration access is required");
      const sections: CompanyExperience["sections"] =
        COMPANY_EXPERIENCE_SECTIONS.map((id) => ({ id, entries: [] }));
      type Entry = {
        section: (typeof COMPANY_EXPERIENCE_SECTIONS)[number];
        id: string;
        href: string;
        permission: AuthorizationAction;
        enabled?: boolean;
      };
      const entries: Entry[] = [
        {
          section: "general",
          id: "company_identity",
          href: "/company/settings/general",
          permission: "users:invite",
        },
        {
          section: "people_access",
          id: "members",
          href: "/company/settings/members",
          permission: "users:invite",
        },
        {
          section: "people_access",
          id: "roles",
          href: "/company/settings/members",
          permission: "users:manage_permissions",
        },
        {
          section: "people_access",
          id: "enterprise_identity",
          href: "/company/settings/enterprise",
          permission: "users:manage_permissions",
          enabled: v7FeatureEnabled(flags, "enterprise_identity_v7"),
        },
        {
          section: "agents_ai",
          id: "agents",
          href: "/agents",
          permission: "agents:configure",
        },
        {
          section: "apps_data",
          id: "connections",
          href: "/apps",
          permission: "tools:manage_connections",
        },
        {
          section: "apps_data",
          id: "company_context",
          href: "/foundation",
          permission: "foundation:read",
          enabled: flags.enableFoundationV1,
        },
        {
          section: "governance_compliance",
          id: "governed_use_cases",
          href: "/ai-governance",
          permission: "users:manage_permissions",
          enabled: v7FeatureEnabled(flags, "ai_use_cases_v7"),
        },
        {
          section: "governance_compliance",
          id: "workflows",
          href: "/workflows",
          permission: "workflows:publish",
          enabled: flags.enableWorkflowsV1,
        },
        {
          section: "security",
          id: "account_security",
          href: "/company/settings/security",
          permission: "users:manage_permissions",
        },
        {
          section: "security",
          id: "support_access",
          href: "/company/settings/support",
          permission: "users:manage_permissions",
          enabled: v6FeatureEnabled(flags, "admin_support_v6"),
        },
        {
          section: "security",
          id: "company_secrets",
          href: "/company/settings/secrets",
          permission: "secrets:read",
        },
        {
          section: "data_privacy",
          id: "export",
          href: "/company/export",
          permission: "users:manage_permissions",
        },
        {
          section: "data_privacy",
          id: "deletion",
          href: "/company/settings/deletion",
          permission: "users:manage_permissions",
          enabled: v6FeatureEnabled(flags, "company_deletion_v6"),
        },
        {
          section: "audit_evidence",
          id: "activity",
          href: "/activity",
          permission: "tools:view_audit",
        },
        {
          section: "audit_evidence",
          id: "security_events",
          href: "/company/settings/security-events",
          permission: "users:manage_permissions",
          enabled: v7FeatureEnabled(flags, "security_event_export_v7"),
        },
        {
          section: "billing_capacity",
          id: "billing",
          href: "/company/settings/billing",
          permission: "billing:view",
          enabled: v6FeatureEnabled(flags, "billing_v6"),
        },
        {
          section: "billing_capacity",
          id: "capacity",
          href: "/company/settings/runtime",
          permission: "runtime:manage",
          enabled: v6FeatureEnabled(flags, "hosted_openclaw_v6"),
        },
        {
          section: "advanced_developer",
          id: "advanced",
          href: "/advanced",
          permission: "tools:admin",
        },
      ];
      const auth = authorizationService(db),
        checked = new Map<AuthorizationAction, boolean>();
      for (const entry of entries) {
        signal.throwIfAborted();
        if (entry.enabled === false) continue;
        if (!checked.has(entry.permission))
          checked.set(
            entry.permission,
            (
              await auth.decide({
                actor,
                action: entry.permission,
                resource: { type: "company", companyId },
              })
            ).allowed,
          );
        if (checked.get(entry.permission))
          sections
            .find((s) => s.id === entry.section)!
            .entries.push({ id: entry.id, href: entry.href });
      }
      await experienceService(db).context(actor, companyId);
      signal.throwIfAborted();
      return companyExperienceSchema.parse({
        companyId,
        observedAt: new Date().toISOString(),
        sections,
      });
    },
    { signal },
  );
}
