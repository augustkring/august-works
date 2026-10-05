import type { RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  agents,
  approvals,
  decisions,
  goals,
  companySecrets,
  companySecretProviderConfigs,
  executionWorkspaces,
  authUsers,
  companyDeletionOperations,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";
import type { EntitlementKey } from "@paperclipai/shared";
import type { SaasPlatform } from "../services/saas/platform.js";
import { assertCompanyAccess } from "../routes/authz.js";
import { conflict, forbidden, unauthorized } from "../errors.js";

/** Authorization precedes commercial decisions. Export, billing recovery and account security remain available. */
export function saasCommercialGuard(
  db: Db,
  platform: SaasPlatform,
): RequestHandler {
  return async (req, _res, next) => {
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit")
        throw unauthorized("Authenticated SaaS membership required");
      Object.assign(req.actor, {
        isInstanceAdmin: false,
        ignoreInstanceAdmin: true,
      });
    }
    if (/^\/admin(?:\/|$)/.test(req.path))
      throw forbidden("Use the scoped SaaS operator tools", {
        code: "SAAS_GLOBAL_ADMIN_DISABLED",
      });

    if (
      typeof req.query.expectedUserId === "string" &&
      req.actor.type === "board" &&
      req.query.expectedUserId !== req.actor.userId
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    if (
      /^\/adapters(?:\/|$)/.test(req.path) &&
      !["GET", "HEAD"].includes(req.method)
    )
      throw forbidden("Adapter code is managed by the hosting operator", {
        code: "SAAS_CODE_INSTALL_DISABLED",
      });
    if (
      typeof req.body?.adapterType === "string" &&
      !["openclaw_gateway", "hermes_gateway", "http", "cursor_cloud"].includes(
        req.body.adapterType,
      )
    )
      throw forbidden("SaaS agents require a remote provider", {
        code: "SAAS_LOCAL_EXECUTION_DISABLED",
      });
    if (
      /\/(?:claude-login|codex-login|login-sessions|instructions-bundle|instructions-files)(?:\/|$)/.test(
        req.path,
      )
    )
      throw forbidden("Local agent tools are unavailable in SaaS", {
        code: "SAAS_LOCAL_EXECUTION_DISABLED",
      });
    const adapterPath = req.path.match(/\/adapters\/([^/]+)\//);
    if (
      adapterPath &&
      !["openclaw_gateway", "hermes_gateway", "http", "cursor_cloud"].includes(
        adapterPath[1]!,
      )
    )
      throw forbidden("SaaS agents require a remote provider", {
        code: "SAAS_LOCAL_EXECUTION_DISABLED",
      });
    // These routes operate on the control VM filesystem or launch control-plane plugin code.
    if (
      /^\/(?:plugins|execution-workspaces)(?:\/|$)/.test(req.path) ||
      /\/(?:workspace-files|workspace-file|file-resources|local-folders|runtime-commands|login-handoff)(?:\/|$)/.test(
        req.path,
      )
    )
      throw forbidden("This local tool is unavailable in SaaS", {
        code: "SAAS_LOCAL_EXECUTION_DISABLED",
      });
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (
      req.method === "PUT" &&
      /^\/companies\/[a-f0-9-]{36}\/runtime-cells\/[a-f0-9-]{36}\/backup-policy$/.test(
        req.path,
      ) &&
      req.body?.enabled === false
    )
      return next();
    if (req.method === "POST" && /^\/companies(?:\/import)?$/.test(req.path))
      throw forbidden("Create SaaS companies through server onboarding", {
        code: "SAAS_ONBOARDING_REQUIRED",
      });
    if (
      req.method === "DELETE" &&
      /^\/companies\/[a-f0-9-]{36}$/.test(req.path)
    )
      return next();
    if (
      req.method === "DELETE" &&
      /^\/attachments\/[a-f0-9-]{36}$/.test(req.path)
    )
      return next();
    const match = req.path.match(
      /^\/companies\/([a-f0-9-]{36})(?:\/([^/]+))?/i,
    );
    let companyId = match?.[1];
    const domain = match?.[2];
    if (
      domain === "runtime-cells" &&
      /^\/companies\/[a-f0-9-]{36}\/runtime-cells\/[a-f0-9-]{36}\/operations$/i.test(
        req.path,
      ) &&
      ["stop", "delete", "backup", "rotate_gateway"].includes(req.body?.action)
    )
      return next();
    if (
      match &&
      [
        "billing",
        "onboarding",
        "usage",
        "export",
        "portability",
        "deletion",
        "support",
        "support-sessions",
        "notifications",
      ].includes(domain ?? "")
    )
      return next();
    if (!companyId) {
      const resource = req.path.match(
        /^\/(agents|issues|projects|approvals|decisions|goals|secrets|secret-provider-configs|execution-workspaces)\/([a-f0-9-]{36})(?:\/|$)/i,
      );
      if (!resource) return next();
      const allowed =
        req.actor.type === "agent"
          ? [req.actor.companyId].filter((id): id is string => Boolean(id))
          : (req.actor.companyIds ?? []);
      if (!allowed.length) throw forbidden("Company membership required");
      const tables = {
        agents,
        issues,
        projects,
        approvals,
        decisions,
        goals,
        secrets: companySecrets,
        "secret-provider-configs": companySecretProviderConfigs,
        "execution-workspaces": executionWorkspaces,
      };
      const table = tables[resource[1] as keyof typeof tables];
      const [row] = await db
        .select({ companyId: table.companyId })
        .from(table)
        .where(
          and(eq(table.id, resource[2]!), inArray(table.companyId, allowed)),
        )
        .limit(1);
      if (!row) return next();
      companyId = row.companyId;
    }
    if (!companyId) throw forbidden("Company membership required");
    assertCompanyAccess(req, companyId);
    // Security and privacy actions preserve recovery access. Domain routes still enforce their permissions.
    if (
      (req.method === "DELETE" &&
        /\/(?:secrets|secret-provider-configs|memory\/records)\//.test(
          req.path,
        )) ||
      /\/(?:source-deletions|deletion-ledger\/restore|retention-policy)(?:\/|$)/.test(
        req.path,
      ) ||
      /^\/agents\/[a-f0-9-]{36}\/(?:pause|cancel)(?:\/|$)/i.test(req.path)
    )
      return next();
    const [deletion] = await db
      .select({ id: companyDeletionOperations.id })
      .from(companyDeletionOperations)
      .where(eq(companyDeletionOperations.companyId, companyId))
      .limit(1);
    if (deletion)
      throw forbidden("Company offboarding is in progress", {
        code: "COMPANY_DELETION_PENDING",
      });
    if (
      req.actor.type === "board" &&
      req.actor.userId &&
      (await platform.enabled("email_verification_required_v6"))
    ) {
      const [actor] = await db
        .select({ verified: authUsers.emailVerified })
        .from(authUsers)
        .where(eq(authUsers.id, req.actor.userId))
        .limit(1);
      if (!actor?.verified)
        throw forbidden("Verified email required", {
          code: "EMAIL_VERIFICATION_REQUIRED",
        });
    }
    if (!(await platform.enabled("billing_entitlements_v6")))
      throw forbidden("Commercial admission is temporarily unavailable", {
        code: "COMMERCIAL_ADMISSION_DISABLED",
      });
    const key: EntitlementKey =
      domain === "workflows" || domain === "workflow-runs"
        ? "workflows.use"
        : domain === "memory"
          ? "memory.use"
          : domain === "portfolio"
            ? "portfolio.use"
            : domain === "agents" && req.method === "POST"
              ? "agents.create"
              : "platform.access";
    await platform.entitlements.require(companyId, "platform.access");
    if (key !== "platform.access")
      await platform.entitlements.require(companyId, key);
    next();
  };
}
