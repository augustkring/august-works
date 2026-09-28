import { PERMISSION_KEYS } from "@paperclipai/shared";
import type { HumanCompanyMembershipRole } from "@paperclipai/shared";

const HUMAN_COMPANY_MEMBERSHIP_ROLES: HumanCompanyMembershipRole[] = [
  "owner",
  "admin",
  "operator",
  "viewer",
];

export function normalizeHumanRole(
  value: unknown,
  fallback: HumanCompanyMembershipRole = "operator"
): HumanCompanyMembershipRole {
  if (value === "member") return "operator";
  return HUMAN_COMPANY_MEMBERSHIP_ROLES.includes(value as HumanCompanyMembershipRole)
    ? (value as HumanCompanyMembershipRole)
    : fallback;
}

export function grantsForHumanRole(
  role: HumanCompanyMembershipRole
): Array<{
  permissionKey: (typeof PERMISSION_KEYS)[number];
  scope: Record<string, unknown> | null;
}> {
  switch (role) {
    case "owner":
      return [
        { permissionKey: "agents:create", scope: null },
        { permissionKey: "agents:configure", scope: null },
        { permissionKey: "skills:create", scope: null },
        { permissionKey: "environments:manage", scope: null },
        { permissionKey: "users:invite", scope: null },
        { permissionKey: "users:manage_permissions", scope: null },
        { permissionKey: "tasks:assign", scope: null },
        { permissionKey: "joins:approve", scope: null },
        { permissionKey: "tools:manage_connections", scope: null },
        { permissionKey: "tools:manage_runtime", scope: null },
        { permissionKey: "tools:use", scope: null },
        { permissionKey: "tools:admin", scope: null },
        { permissionKey: "foundation:read", scope: null },
        { permissionKey: "foundation:propose", scope: null },
        { permissionKey: "foundation:edit", scope: null },
        { permissionKey: "foundation:approve", scope: null },
        { permissionKey: "workflows:read", scope: null },
        { permissionKey: "workflows:edit", scope: null },
        { permissionKey: "workflows:publish", scope: null },
        { permissionKey: "workflows:run", scope: null },
      ];
    case "admin":
      return [
        { permissionKey: "agents:create", scope: null },
        { permissionKey: "agents:configure", scope: null },
        { permissionKey: "skills:create", scope: null },
        { permissionKey: "environments:manage", scope: null },
        { permissionKey: "users:invite", scope: null },
        { permissionKey: "tasks:assign", scope: null },
        { permissionKey: "joins:approve", scope: null },
        { permissionKey: "tools:manage_connections", scope: null },
        { permissionKey: "tools:manage_runtime", scope: null },
        { permissionKey: "tools:use", scope: null },
        { permissionKey: "tools:admin", scope: null },
        { permissionKey: "foundation:read", scope: null },
        { permissionKey: "foundation:propose", scope: null },
        { permissionKey: "foundation:edit", scope: null },
        { permissionKey: "foundation:approve", scope: null },
        { permissionKey: "workflows:read", scope: null },
        { permissionKey: "workflows:edit", scope: null },
        { permissionKey: "workflows:publish", scope: null },
        { permissionKey: "workflows:run", scope: null },
      ];
    case "operator":
      return [
        { permissionKey: "tasks:assign", scope: null },
        { permissionKey: "foundation:read", scope: null },
        { permissionKey: "foundation:propose", scope: null },
        { permissionKey: "foundation:edit", scope: null },
        { permissionKey: "workflows:read", scope: null },
        { permissionKey: "workflows:edit", scope: null },
        { permissionKey: "workflows:run", scope: null },
      ];
    case "viewer":
      return [
        { permissionKey: "foundation:read", scope: null },
        { permissionKey: "workflows:read", scope: null },
      ];
  }
}

export function resolveHumanInviteRole(
  defaultsPayload: Record<string, unknown> | null | undefined
): HumanCompanyMembershipRole {
  if (!defaultsPayload || typeof defaultsPayload !== "object") return "operator";
  const scoped = defaultsPayload.human;
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    return "operator";
  }
  return normalizeHumanRole((scoped as Record<string, unknown>).role, "operator");
}
