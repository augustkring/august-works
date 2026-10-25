import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { isSaasDeployment } from "../deployment-profile.js";
import { and, eq, inArray, is, isNull, sql, type SQL } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import {
  agents,
  agentApiKeys,
  agentExecutionManifests,
  authUsers,
  authSessions,
  boardApiKeys,
  accountDeletionOperations,
  companyMemberships,
  heartbeatRuns,
  instanceUserRoles,
  issueComments,
  issueAccessGrants,
  issuePrivacySources,
  issues,
  workflowRuns,
  workflowRevisions,
  workflows,
  routineRuns,
  routineRevisions,
  routines,
  principalPermissionGrants,
  projects,
  projectAccessMembers,
  userInboxAgentPolicies,
} from "@paperclipai/db";
import type {
  AgentApiKeyScope,
  InboxAgentPolicyMode,
  PermissionKey,
  PrincipalType,
  SkillTestAgentKeyScope,
  TaskBridgeAgentKeyScope,
} from "@paperclipai/shared";
import { agentApiKeyScopeSchema, LOW_TRUST_REVIEW_PRESET, extractAgentMentionIds, type LowTrustBoundary } from "@paperclipai/shared";
import {
  LOW_TRUST_ISSUE_ANCESTRY_MAX_DEPTH,
  isIssueWithinLowTrustBoundary,
  resolveCoreTrustPreset,
  type TrustPresetResolution,
} from "./trust-preset-resolver.js";
import { conflict, forbidden, HttpError, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { normalizeAgentPermissions } from "./agent-permissions.js";
import { grantsForHumanRole, normalizeHumanRole } from "./company-member-roles.js";
import { nativeMemoryCapturePrincipalCondition } from "./memory/memory-privacy.js";
import { assertRoutineSourceAccess } from "./routine-source-authority.js";

/** Current native role evidence. The optional lock is owned by an enclosing
 * mutation transaction; a role copied into an actor is never this evidence. */
export async function hasCurrentInstanceAdminRole(db: Db | DbTransaction, userId: string | null | undefined, shareLock = false): Promise<boolean> {
  if (!userId) return false;
  const query = db.select({ id: instanceUserRoles.id }).from(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")));
  const rows = await (shareLock ? query.for("share") : query);
  return rows.length > 0;
}

export type AuthorizationActor =
  {
    type: "board" | "agent" | "none";
    userId?: string | null;
    sessionId?: string | null;
    companyIds?: string[];
    memberships?: Array<{ companyId: string; membershipRole?: string | null; status?: string }>;
    onBehalfOfMemberships?: Array<{ companyId: string; membershipRole?: string | null; status?: string }>;
    isInstanceAdmin?: boolean;
    ignoreInstanceAdmin?: boolean;
    agentId?: string | null;
    companyId?: string | null;
    keyId?: string | null;
    /** Fingerprint retained by the original credential verifier, never client input. */
    authenticatedKeyHash?: string | null;
    authenticatedCredentialExpiresAt?: number | null;
    keyScope?: AgentApiKeyScope | null;
    runId?: string | null;
    onBehalfOfUserId?: string | null;
    source?:
      | "local_implicit"
      | "session"
      | "board_key"
      | "agent_key"
      | "agent_jwt"
      | "cloud_tenant"
      | "cloud_control"
      | "none";
  };

export type AuthorizationAction =
  | PermissionKey
  | "agent_config:read"
  | "agent_config:update"
  | "skill_config:update"
  | "agent:read"
  | "agent:wake"
  | "company_scope:read"
  | "decision_queue:manage"
  | "decision_queue:read"
  | "decision_triage:manage"
  | "issue:comment"
  | "issue:mutate"
  | "issue:read"
  | "project:read"
  | "runtime:manage"
  | "secrets:read"
  | "secrets:propose";

export type AuthorizationResource =
  | { type: "company"; companyId: string }
  | { type: "agent"; companyId: string; agentId?: string | null }
  | { type: "project"; companyId: string; projectId?: string | null }
  | {
      type: "issue";
      companyId: string;
      issueId?: string | null;
      projectId?: string | null;
      parentIssueId?: string | null;
      assigneeAgentId?: string | null;
      assigneeUserId?: string | null;
      originKind?: string | null;
      originId?: string | null;
      status?: string | null;
    };

export type AuthorizationDecision = {
  allowed: boolean;
  action: AuthorizationAction;
  explanation: string;
  inboxPolicyMode?: InboxAgentPolicyMode | "grant_override";
  code?: "RESPONSIBLE_USER_UNAUTHORIZED" | "RESPONSIBLE_USER_UNAVAILABLE";
  reason:
    | "allow_low_trust_boundary"
    | "allow_local_board"
    | "allow_instance_admin"
    | "allow_explicit_grant"
    | "allow_role_default"
    | "allow_user_inbox_policy"
    | "allow_direct_change"
    | "allow_consented_change"
    | "allow_legacy_agent_creator"
    | "allow_issue_mention_grant"
    | "allow_direct_parent_report"
    | "allow_visible_issue_write"
    | "allow_self"
    | "allow_company_agent"
    | "allow_company_member"
    | "allow_simple_company_member"
    | "allow_manager_chain"
    | "inbox_target_user_unresolved"
    | "inbox_management_disabled"
    | "inbox_agent_not_allowed"
    | "deny_unauthenticated"
    | "deny_company_boundary"
    | "deny_missing_membership"
    | "deny_missing_grant"
    | "deny_missing_consent"
    | "deny_no_grant"
    | "deny_policy_restricted"
    | "deny_low_trust_boundary"
    | "deny_scope"
    | "deny_issue_private"
    | "deny_project_private"
    | "deny_unsupported_action";
  grant?: {
    principalType: PrincipalType;
    principalId: string;
    permissionKey: PermissionKey;
    scope: Record<string, unknown> | null;
  };
};

type PrincipalGrantDecision = AuthorizationDecision & {
  grant?: NonNullable<AuthorizationDecision["grant"]>;
};

function companyIdForResource(resource: AuthorizationResource) {
  return resource.companyId;
}

function permissionForAction(action: AuthorizationAction): PermissionKey | null {
  if (action === "agent_config:read" || action === "agent_config:update" || action === "skill_config:update") {
    return null;
  }
  if (
    action === "agent:read" ||
    action === "agent:wake" ||
    action === "company_scope:read" ||
    action === "decision_queue:manage" ||
    action === "decision_queue:read" ||
    action === "decision_triage:manage" ||
    action === "issue:read" ||
    action === "project:read" ||
    action === "runtime:manage" ||
    action === "secrets:read" ||
    action === "secrets:propose"
  ) {
    return null;
  }
  if (action === "issue:comment" || action === "issue:mutate") return null;
  return action;
}

function canCreateAgentsLegacy(agent: { role: string; permissions: unknown }) {
  if (agent.role === "ceo") return true;
  // Raw agent rows may predate permission normalization; apply the same
  // defaults the agent service applies on read so enforcement matches what
  // the API reports.
  return normalizeAgentPermissions(agent.permissions).canCreateAgents;
}

function scopeValueList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function prefixedScopeValues(grantScope: Record<string, unknown>, prefix: string) {
  return scopeValueList(grantScope.allow)
    .filter((rule) => rule.startsWith(prefix))
    .map((rule) => rule.slice(prefix.length))
    .filter((value) => value.length > 0);
}

function scopeValuesForKeys(grantScope: Record<string, unknown>, keys: string[]) {
  return keys.flatMap((key) => scopeValueList(grantScope[key]));
}

function scopeIncludesId(ids: string[], id: string | null | undefined) {
  return Boolean(id && ids.includes(id));
}

function isSimpleAssignableAgentStatus(status: string | null | undefined) {
  return status !== "pending_approval" && status !== "terminated";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectIsEmpty(value: Record<string, unknown>) {
  return Object.keys(value).length === 0;
}

function readPolicyObject(container: unknown, key: string): Record<string, unknown> | null {
  if (!isPlainRecord(container)) return null;
  const value = container[key];
  return isPlainRecord(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type AssignmentPolicyEffect =
  | { kind: "none" }
  | { kind: "restricted"; explanation: string }
  | { kind: "blocked"; explanation: string }
  | { kind: "unknown"; explanation: string };

type AgentHierarchyRow = { id: string; reportsTo: string | null };
type LowTrustBoundaryWithCompany = LowTrustBoundary & { companyId: string };
type AgentAuthorizationRow = {
  id: string;
  companyId: string;
  role: string;
  status: string;
  reportsTo: string | null;
  permissions: Record<string, unknown> | null | undefined;
};
type ProjectAuthorizationRow = {
  id: string;
  companyId: string;
  executionWorkspacePolicy: unknown;
  visibility: string;
};
type IssueAuthorizationRow = {
  id: string;
  companyId: string;
  projectId: string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  checkoutRunId: string | null;
  status: string;
  executionPolicy: unknown;
  originKind: string | null;
  originId: string | null;
  visibility: string;
  privacyRootIssueId: string | null;
  privacyParentIssueId: string | null;
  responsibleUserId: string | null;
  createdByUserId: string | null;
  hiddenAt: Date | null;
};

function evaluateAuthorizationPolicyForAssignment(
  policy: Record<string, unknown> | null | undefined,
  label: string,
): AssignmentPolicyEffect {
  if (!policy || objectIsEmpty(policy)) return { kind: "none" };

  const agentVisibility = readPolicyObject(policy, "agentVisibility");
  const assignmentPolicy = readPolicyObject(policy, "assignmentPolicy");
  const protectedAgent = readPolicyObject(policy, "protectedAgent");
  const knownTopLevelKeys = new Set([
    "agentVisibility",
    "assignmentPolicy",
    "protectedAgent",
    "managedBy",
  ]);
  const hasUnknownTopLevelKey = Object.keys(policy).some((key) => !knownTopLevelKeys.has(key));
  const hasKnownPolicySection = Boolean(agentVisibility || assignmentPolicy || protectedAgent);
  if (hasUnknownTopLevelKey || !hasKnownPolicySection) {
    return {
      kind: "unknown",
      explanation: `${label} has authorization policy data that core cannot evaluate for task assignment.`,
    };
  }

  const visibilityMode = readString(agentVisibility?.mode);
  if (visibilityMode && visibilityMode !== "discoverable" && visibilityMode !== "private") {
    return {
      kind: "unknown",
      explanation: `${label} has an unsupported agent visibility policy mode.`,
    };
  }

  const assignmentMode = readString(assignmentPolicy?.mode);
  if (assignmentMode && assignmentMode !== "company_default" && assignmentMode !== "protected") {
    return {
      kind: "unknown",
      explanation: `${label} has an unsupported assignment policy mode.`,
    };
  }

  // `requiresApproval` and `protectedAgentRequiresApproval` are legacy aliases.
  // They never had an approval workflow behind them, so preserve their hard-block
  // behavior without continuing to promise an approval step that does not exist.
  const blockAssignment =
    readBoolean(protectedAgent?.blockAssignment) === true ||
    readBoolean(protectedAgent?.requiresApproval) === true ||
    readBoolean(assignmentPolicy?.protectedAgentRequiresApproval) === true;
  if (blockAssignment) {
    return {
      kind: "blocked",
      explanation:
        `${label} assignment is blocked by protected-agent policy. ` +
        "A company administrator can remove the assignment block, then retry.",
    };
  }

  if (
    visibilityMode === "private" ||
    readBoolean(agentVisibility?.hiddenFromDefaultDirectory) === true
  ) {
    return {
      kind: "restricted",
      explanation: `${label} is private and cannot use simple company-wide task assignment.`,
    };
  }

  if (assignmentMode === "protected") {
    return {
      kind: "restricted",
      explanation: `${label} is protected and requires an explicit assignment grant.`,
    };
  }

  return { kind: "none" };
}

function agentIsInSubtree(
  agentsById: Map<string, AgentHierarchyRow>,
  rootAgentId: string,
  targetAgentId: string,
) {
  if (rootAgentId === targetAgentId) return true;

  let cursor: string | null = targetAgentId;
  for (let depth = 0; cursor && depth < 50; depth += 1) {
    const current = agentsById.get(cursor);
    if (!current) return false;
    if (current.reportsTo === rootAgentId) return true;
    cursor = current.reportsTo;
  }
  return false;
}

async function loadCompanyAgentHierarchy(db: Db | DbTransaction, companyId: string) {
  const rows = await db
    .select({ id: agents.id, reportsTo: agents.reportsTo })
    .from(agents)
    .where(eq(agents.companyId, companyId));
  return new Map(rows.map((agent) => [agent.id, agent]));
}

async function isAgentInSubtree(
  db: Db | DbTransaction,
  companyId: string,
  rootAgentId: string,
  targetAgentId: string,
) {
  return agentIsInSubtree(
    await loadCompanyAgentHierarchy(db, companyId),
    rootAgentId,
    targetAgentId,
  );
}

async function scopeAllows(
  db: Db | DbTransaction,
  companyId: string,
  grantScope: Record<string, unknown> | null,
  requestedScope: Record<string, unknown> | null | undefined,
  options: { requireStructuredScope?: boolean } = {},
) {
  if (!grantScope || Object.keys(grantScope).length === 0) return !options.requireStructuredScope;
  if (!requestedScope) return false;

  const targetAssigneeAgentId =
    typeof requestedScope.assigneeAgentId === "string"
      ? requestedScope.assigneeAgentId
      : typeof requestedScope.targetAgentId === "string"
        ? requestedScope.targetAgentId
        : null;
  const requestedProjectId = typeof requestedScope.projectId === "string" ? requestedScope.projectId : null;
  const requestedUserId = typeof requestedScope.userId === "string" ? requestedScope.userId : null;
  let constrained = false;

  const projectIds = [
    ...scopeValueList(grantScope.projectId),
    ...scopeValueList(grantScope.projectIds),
    ...prefixedScopeValues(grantScope, "project:"),
  ];
  if (projectIds.length > 0) {
    constrained = true;
    if (!scopeIncludesId(projectIds, requestedProjectId)) return false;
  }

  const targetAgentIds = [
    ...scopeValuesForKeys(grantScope, [
      "agentId",
      "agentIds",
      "assigneeAgentId",
      "assigneeAgentIds",
      "targetAgentId",
      "targetAgentIds",
    ]),
    ...prefixedScopeValues(grantScope, "agent:"),
  ];
  if (targetAgentIds.length > 0) {
    constrained = true;
    if (!scopeIncludesId(targetAgentIds, targetAssigneeAgentId)) return false;
  }

  const targetUserIds = scopeValuesForKeys(grantScope, ["userId", "userIds"]);
  if (targetUserIds.length > 0) {
    constrained = true;
    if (!scopeIncludesId(targetUserIds, requestedUserId)) return false;
  }

  const subtreeRootAgentIds = [
    ...scopeValuesForKeys(grantScope, [
      "managerAgentId",
      "managerAgentIds",
      "managedSubtreeAgentId",
      "managedSubtreeAgentIds",
      "subtreeAgentId",
      "subtreeAgentIds",
      "subtreeRootAgentId",
      "subtreeRootAgentIds",
    ]),
    ...prefixedScopeValues(grantScope, "subtree:"),
  ];
  if (subtreeRootAgentIds.length > 0) {
    constrained = true;
    if (!targetAssigneeAgentId) return false;
    const agentsById = await loadCompanyAgentHierarchy(db, companyId);
    let matchesSubtree = false;
    for (const rootAgentId of subtreeRootAgentIds) {
      if (agentIsInSubtree(agentsById, rootAgentId, targetAssigneeAgentId)) {
        matchesSubtree = true;
        break;
      }
    }
    if (!matchesSubtree) return false;
  }

  // Unknown metadata keys do not constrain the grant. Recognized constraints
  // return false above when they fail to match the requested assignment scope.
  return !constrained ? true : constrained;
}

function allow(input: Omit<AuthorizationDecision, "allowed">): AuthorizationDecision {
  return { ...input, allowed: true };
}

function deny(input: Omit<AuthorizationDecision, "allowed">): AuthorizationDecision {
  return { ...input, allowed: false };
}

type ResponsibleUserSnapshot = {
  userId: string;
  companyId: string;
  userExists: boolean;
  activeMembership: { companyId: string; membershipRole?: string | null; status?: string } | null;
};

export type IssuePrivacyRow = { id: string; companyId: string };
export type ProjectPrivacyRow = { id: string; companyId: string };
const privacyUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A private ACL narrows current authority; retained actor claims never supply it. */
function privatePrincipalCurrent(actor: AuthorizationActor, company: SQL): SQL<boolean> {
  const userId = actor.type === "board" ? actor.userId : actor.onBehalfOfUserId;
  if (!userId || actor.type === "none" || actor.source === "local_implicit") return sql<boolean>`false`;
  const expiresAt = actor.authenticatedCredentialExpiresAt;
  if (expiresAt != null && (!Number.isFinite(expiresAt) || expiresAt <= 0)) return sql<boolean>`false`;
  // Evaluate verified credential lifetime when SQL executes, after earlier waits.
  // Credential-free internal actors retain their original canonical policy.
  const lifetime = expiresAt == null ? sql`true` : sql`extract(epoch from clock_timestamp())*1000<${expiresAt}`;
  const session = actor.type === "board" && actor.source === "session" && actor.sessionId != null
    ? sql`exists(select 1 from ${authSessions} s where s.id=${actor.sessionId}
        and s.user_id=${userId} and s.expires_at>clock_timestamp())`
    : sql`true`;
  const human = sql<boolean>`exists (select 1 from ${authUsers} u join ${companyMemberships} m
    on m.principal_id=u.id and m.principal_type='user' and m.company_id=${company} and m.status='active'
    where u.id=${userId} and ${lifetime} and ${session})`;
  if (actor.type === "board") {
    if (actor.source !== "board_key") return human;
    if (!actor.keyId || !privacyUuid.test(actor.keyId) || !actor.authenticatedKeyHash) return sql<boolean>`false`;
    return sql<boolean>`(${human} and exists(select 1 from ${boardApiKeys} k
      where k.id=${actor.keyId} and k.user_id=${userId} and k.key_hash=${actor.authenticatedKeyHash}
        and k.revoked_at is null and (k.expires_at is null or k.expires_at>clock_timestamp())))`;
  }
  if (!actor.agentId || !privacyUuid.test(actor.agentId)) return sql<boolean>`false`;
  const run = actor.runId && privacyUuid.test(actor.runId)
    ? sql`(exists(select 1 from ${heartbeatRuns} r where r.id=${actor.runId} and r.company_id=${company}
        and r.agent_id=${actor.agentId} and r.responsible_user_id=${userId} and r.status='running') or
        ${nativeMemoryCapturePrincipalCondition(actor,company)})`
    : sql`false`;
  const key = actor.keyId && privacyUuid.test(actor.keyId)
    ? sql`exists(select 1 from ${agentApiKeys} k where k.id=${actor.keyId} and k.company_id=${company}
        and k.agent_id=${actor.agentId} and k.responsible_user_id=${userId} and k.revoked_at is null
        and ${actor.authenticatedKeyHash != null ? sql`k.key_hash=${actor.authenticatedKeyHash}` : sql`true`})`
    : sql`false`;
  return sql<boolean>`(${human} and exists(select 1 from ${agents} a where a.id=${actor.agentId}
    and a.company_id=${company} and a.status not in ('paused','terminated','pending_approval','error')) and
    ${actor.runId ? run : key} and ${actor.keyId ? key : sql`true`})`;
}

function projectPrincipalAccess(actor: AuthorizationActor, project: SQL, company: SQL): SQL<boolean> {
  const subjectType = actor.type === "board" ? "user" : "agent";
  const subjectId = actor.type === "board" ? actor.userId : actor.agentId;
  if (!subjectId || actor.type === "none") return sql<boolean>`false`;
  const own = sql`exists(select 1 from ${projectAccessMembers} m where m.company_id=${company}
    and m.project_id=${project} and m.subject_type=${subjectType} and m.subject_id=${subjectId})`;
  const human = actor.type === "agent" && actor.onBehalfOfUserId
    ? sql`exists(select 1 from ${projectAccessMembers} m where m.company_id=${company}
        and m.project_id=${project} and m.subject_type='user' and m.subject_id=${actor.onBehalfOfUserId})`
    : sql`true`;
  return sql<boolean>`(${privatePrincipalCurrent(actor, company)} and ${own} and ${human})`;
}

/** Downward grants do not grant access to ancestors or siblings. */
function issuePrincipalAccess(actor: AuthorizationActor, issue: SQL, company: SQL): SQL<boolean> {
  const principal = (type: "user" | "agent", id: string | null | undefined) => !id ? sql`false` : sql`exists (
    with recursive acl_ancestors as (
      select p.id,p.privacy_parent_issue_id,p.responsible_user_id,p.created_by_user_id,p.assignee_user_id,p.assignee_agent_id,p.project_id,0 as depth
      from issues p where p.id=${issue} and p.company_id=${company}
      union
      select p.id,p.privacy_parent_issue_id,p.responsible_user_id,p.created_by_user_id,p.assignee_user_id,p.assignee_agent_id,p.project_id,c.depth+1
      from issues p join acl_ancestors c on p.id=c.privacy_parent_issue_id where p.company_id=${company} and c.depth<64
    ) select 1 from acl_ancestors n where
      ${type === "user" ? sql`(n.responsible_user_id=${id} or n.created_by_user_id=${id} or n.assignee_user_id=${id})` : sql`n.assignee_agent_id=${id}`}
      or exists(select 1 from ${issueAccessGrants} g where g.company_id=${company} and g.issue_id=n.id
        and g.subject_type=${type} and g.subject_id=${id} and g.revoked_at is null)
      or exists(select 1 from ${projectAccessMembers} m join projects p on p.id=m.project_id and p.company_id=m.company_id and p.visibility='private'
        where m.company_id=${company} and m.project_id=n.project_id and m.subject_type=${type} and m.subject_id=${id})
  )`;
  const own = actor.type === "board" ? principal("user", actor.userId)
    : actor.type === "agent" ? principal("agent", actor.agentId) : sql`false`;
  const human = actor.type === "agent" ? principal("user", actor.onBehalfOfUserId) : sql`true`;
  return sql<boolean>`(${privatePrincipalCurrent(actor, company)} and ${own} and ${human})`;
}

/** Privacy narrowing only. The caller still applies company/action authorization. */
export async function projectReadSqlCondition(_db: Db | DbTransaction, actor: AuthorizationActor): Promise<SQL<boolean>> {
  return taskSourcePrivacySqlCondition(_db, "project", sql`${projects.id}`, sql`${projects.companyId}`, actor);
}

/** All retained Task sources survive ordinary moves and source erasure. Nodes
 * and each node's actual enumerated edges have separate 256-entry budgets;
 * repeated refs cannot hide incomplete work behind a small unique population.
 * Cycles, missing/foreign sources and either overflow deny. */
export async function issueReadSqlCondition(_db: Db | DbTransaction, actor: AuthorizationActor): Promise<SQL<boolean>> {
  return taskSourcePrivacySqlCondition(_db, "issue", sql`${issues.id}`, sql`${issues.companyId}`, actor);
}

/** Same retained-source SQL for the exact typed Workflow Run. A predicate
 * captured inside the native callback still depends on its transaction-local
 * token when executed, so the capability cannot escape callback lifetime. */
export async function workflowRunReadSqlCondition(_db: Db | DbTransaction, actor: AuthorizationActor): Promise<SQL<boolean>> {
  return taskSourcePrivacySqlCondition(_db, "workflow_run", sql`${workflowRuns.id}`, sql`${workflowRuns.companyId}`, actor);
}

/** Every native read uses the same persisted Task binding, including recursive
 * list/count source checks. A display key cannot replace a missing UUID. */
function heartbeatRunTaskBindingCondition(row: SQL): SQL<boolean> {
  const context = sql`coalesce(${row}.context_snapshot,'{}'::jsonb)`;
  return sql<boolean>`(jsonb_typeof(${context})='object' and (
    (${row}.scope_kind='company' and ${row}.issue_id is null and ${row}.native_issue_id is null
      and not (${context} ? 'issueId' or ${context} ? 'taskId' or ${context} ? 'taskKey'))
    or (${row}.scope_kind='issue'
      and (${context}->>'issueId' is null or ${context}->>'issueId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      and (${context}->>'taskId' is null or ${context}->>'taskId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      and (select count(distinct ref.id) from (values (${row}.issue_id),(${row}.native_issue_id),
        (case when ${context}->>'issueId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then (${context}->>'issueId')::uuid end),
        (case when ${context}->>'taskId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then (${context}->>'taskId')::uuid end)) ref(id))=1)
  ))`;
}

/** A pipeline Routine source is admitted only by its exact, live pipeline
 * execution ledger and the source Task set captured before dispatch. */
function pipelineAutomationRoutineSourceCondition(company: SQL): SQL<boolean> {
  const payload = sql`rr.trigger_payload`;
  const taskIds = sql`case when jsonb_typeof(${payload}->'contextPack'->'taskSourceIssueIds')='array'
    then ${payload}->'contextPack'->'taskSourceIssueIds' else '[]'::jsonb end`;
  const outputItems = sql`case when jsonb_typeof(${payload}->'contextPack'->'outputSummaries'->'items')='array'
    then ${payload}->'contextPack'->'outputSummaries'->'items' else '[]'::jsonb end`;
  const producerRunIds = sql`case when jsonb_typeof(${payload}->'contextPack'->'case'->'producerRunIds')='array'
    then ${payload}->'contextPack'->'case'->'producerRunIds' else '[]'::jsonb end`;
  const producerUserIds = sql`case when jsonb_typeof(${payload}->'contextPack'->'case'->'producerUserIds')='array'
    then ${payload}->'contextPack'->'case'->'producerUserIds' else '[]'::jsonb end`;
  const capturedAt = sql`case when ${payload}->'contextPack'->'case'->>'capturedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    then (${payload}->'contextPack'->'case'->>'capturedAt')::timestamptz else 'epoch'::timestamptz end`;
  return sql<boolean>`(
    jsonb_typeof(${payload})='object'
    and jsonb_typeof(${payload}->'contextPack')='object'
    and jsonb_typeof(${payload}->'automation')='object'
    and ${payload}->'pipeline'->>'id'=${payload}->'contextPack'->'pipeline'->>'id'
    and ${payload}->'pipeline'->>'id'=p.origin_id
    and ${payload}->'case'->>'id'=${payload}->'contextPack'->'case'->>'id'
    and ${payload}->'stage'->>'id'=${payload}->'contextPack'->'stage'->>'id'
    and ${payload}->>'triggeringEventId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and ${payload}->'automation'->>'automationExecutionId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and jsonb_typeof(${payload}->'contextPack'->'taskSourceIssueIds')='array'
    and jsonb_array_length(${taskIds})<=256
    and jsonb_typeof(${payload}->'contextPack'->'outputSummaries'->'items')='array'
    and jsonb_array_length(${outputItems})<=5
    and jsonb_array_length(${outputItems})=(select count(distinct output.item->>'id')
      from jsonb_array_elements(${outputItems}) output(item))
    and ${payload}->'contextPack'->'case'->>'capturedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    and jsonb_typeof(${payload}->'contextPack'->'case'->'producerRunIds')='array'
    and jsonb_array_length(${producerRunIds})<=256
    and jsonb_array_length(${producerRunIds})=(select count(distinct source.id) from jsonb_array_elements_text(${producerRunIds}) source(id))
    and jsonb_typeof(${payload}->'contextPack'->'case'->'producerUserIds')='array'
    and jsonb_array_length(${producerUserIds})<=256
    and jsonb_array_length(${producerUserIds})=(select count(distinct source.id) from jsonb_array_elements_text(${producerUserIds}) source(id))
    and not exists(select 1 from jsonb_array_elements_text(${producerRunIds}) source(id)
      where source.id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    and not exists(select 1 from jsonb_array_elements_text(${taskIds}) source(id)
      where source.id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    and exists(select 1 from pipeline_automation_executions e
      join pipeline_cases c on c.id=e.case_id and c.company_id=e.company_id
      join pipeline_stages s on s.id=case when ${payload}->'contextPack'->'stage'->>'id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        then (${payload}->'contextPack'->'stage'->>'id')::uuid end and s.pipeline_id=c.pipeline_id
      join pipeline_case_events ev on ev.id=case when ${payload}->>'triggeringEventId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        then (${payload}->>'triggeringEventId')::uuid end and ev.case_id=c.id and ev.company_id=c.company_id
      where e.id=case when ${payload}->'automation'->>'automationExecutionId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then (${payload}->'automation'->>'automationExecutionId')::uuid end
        and e.company_id=${company} and e.routine_id=rr.routine_id and e.target_kind='routine'
        and e.target_ref=rr.routine_id and e.case_id=c.id and c.pipeline_id::text=p.origin_id
        and c.retired_at is null and c.hidden_from_board_at is null
        and e.automation_id=${payload}->'automation'->>'automationId'
        and e.generation::text=${payload}->'automation'->>'generation'
        and e.triggering_event_id=case when ${payload}->>'triggeringEventId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then (${payload}->>'triggeringEventId')::uuid end
        and ${payload}->'contextPack'->'case'->>'sourceUserId' is not distinct from c.created_by_user_id
        and ${payload}->'contextPack'->'case'->>'sourceAgentId' is not distinct from c.created_by_agent_id::text
        and ${payload}->'contextPack'->'case'->>'sourceRunId' is not distinct from c.origin_run_id::text
        and ((c.created_by_user_id is not null and c.created_by_agent_id is null and c.origin_run_id is null)
          or (c.created_by_user_id is null and c.created_by_agent_id is not null and c.origin_run_id is not null
              and exists(select 1 from heartbeat_runs producer_run
                where producer_run.id=c.origin_run_id and producer_run.company_id=c.company_id
                  and producer_run.agent_id=c.created_by_agent_id)))
        and (select count(distinct source.id) from jsonb_array_elements_text(${producerRunIds}) source(id))
          =(select count(distinct expected.id) from (select c.origin_run_id::text as id where c.origin_run_id is not null
              union all select ev.run_id::text from pipeline_case_events ev where ev.company_id=c.company_id and ev.case_id=c.id
                and ev.type='updated' and ev.payload->>'materialChanged'='true' and ev.actor_type='agent'
                and ev.run_id is not null and ev.created_at<=${capturedAt}) expected)
        and not exists(select 1 from jsonb_array_elements_text(${producerRunIds}) source(id)
          where not (source.id=c.origin_run_id::text or exists(select 1 from pipeline_case_events ev
            where ev.company_id=c.company_id and ev.case_id=c.id and ev.type='updated'
              and ev.payload->>'materialChanged'='true' and ev.actor_type='agent' and ev.run_id::text=source.id
              and ev.created_at<=${capturedAt})))
        and (select count(distinct source.id) from jsonb_array_elements_text(${producerUserIds}) source(id))
          =(select count(distinct expected.id) from (select c.created_by_user_id as id where c.created_by_user_id is not null
              union all select ev.actor_user_id from pipeline_case_events ev where ev.company_id=c.company_id and ev.case_id=c.id
                and ev.type='updated' and ev.payload->>'materialChanged'='true' and ev.actor_type='user'
                and ev.actor_user_id is not null and ev.created_at<=${capturedAt}) expected)
        and not exists(select 1 from jsonb_array_elements_text(${producerUserIds}) source(id)
          where not (source.id=c.created_by_user_id or exists(select 1 from pipeline_case_events ev
            where ev.company_id=c.company_id and ev.case_id=c.id and ev.type='updated'
              and ev.payload->>'materialChanged'='true' and ev.actor_type='user' and ev.actor_user_id=source.id
              and ev.created_at<=${capturedAt})))
        and not exists(select 1 from pipeline_case_events ev where ev.company_id=c.company_id and ev.case_id=c.id
          and ev.type='updated' and ev.payload->>'materialChanged'='true' and ev.actor_type='system' and ev.created_at<=${capturedAt})
        and (select count(distinct source.id) from jsonb_array_elements_text(${taskIds}) source(id))
          =(select count(distinct link.issue_id) from pipeline_case_issue_links link
            where link.company_id=e.company_id and link.case_id=c.id and link.created_at<=e.created_at)
        and not exists(select 1 from pipeline_case_issue_links link where link.company_id=e.company_id
          and link.case_id=c.id and link.created_at<=e.created_at
          and not exists(select 1 from jsonb_array_elements_text(${taskIds}) source(id) where source.id=link.issue_id::text))
        and not exists(select 1 from jsonb_array_elements_text(${taskIds}) source(id)
          where not exists(select 1 from pipeline_case_issue_links link
            join issues source_issue on source_issue.company_id=link.company_id and source_issue.id=link.issue_id
            where link.company_id=e.company_id and link.case_id=c.id and link.created_at<=e.created_at
              and link.issue_id::text=source.id and source_issue.hidden_at is null
              and source_issue.cancelled_at is null and source_issue.status<>'cancelled'))
        and not exists(select 1 from jsonb_array_elements(${outputItems}) output(item) where not (
          output.item->'sourceIssue'->>'id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          and exists(select 1 from jsonb_array_elements_text(${taskIds}) source(id)
            where source.id=output.item->'sourceIssue'->>'id')
          and case output.item->>'kind'
            when 'document' then output.item->>'id' ~* '^document:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              and output.item->>'revisionId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              and exists(select 1 from issue_documents link
                join documents d on d.company_id=link.company_id and d.id=link.document_id
                join issues source_issue on source_issue.company_id=link.company_id and source_issue.id=link.issue_id
                join document_revisions rev on rev.company_id=d.company_id and rev.document_id=d.id
                  and rev.id=case when output.item->>'revisionId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                    then (output.item->>'revisionId')::uuid end
                where link.company_id=e.company_id
                  and link.issue_id=case when output.item->'sourceIssue'->>'id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                    then (output.item->'sourceIssue'->>'id')::uuid end
                  and link.document_id=case when output.item->>'id' ~* '^document:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                    then substring(output.item->>'id' from 10)::uuid end
                  and link.key=output.item->>'key'
                  and coalesce(d.source_trust,source_issue.source_trust,'null'::jsonb)
                    is not distinct from coalesce(output.item->'sourceTrust','null'::jsonb))
            when 'work_product' then output.item->>'id' ~* '^work_product:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              and exists(select 1 from issue_work_products wp
                join issues source_issue on source_issue.company_id=wp.company_id and source_issue.id=wp.issue_id
                where wp.company_id=e.company_id
                and wp.id=case when output.item->>'id' ~* '^work_product:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                  then substring(output.item->>'id' from 14)::uuid end
                and wp.issue_id=case when output.item->'sourceIssue'->>'id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                  then (output.item->'sourceIssue'->>'id')::uuid end
                and wp.type=output.item->>'key' and wp.title=output.item->>'title'
                and coalesce(wp.source_trust,source_issue.source_trust,'null'::jsonb)
                  is not distinct from coalesce(output.item->'sourceTrust','null'::jsonb))
            when 'attachment' then output.item->>'id' ~* '^attachment:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              and exists(select 1 from issue_attachments attachment
                join assets asset on asset.company_id=attachment.company_id and asset.id=attachment.asset_id
                join issues source_issue on source_issue.company_id=attachment.company_id and source_issue.id=attachment.issue_id
                where attachment.company_id=e.company_id
                  and attachment.id=case when output.item->>'id' ~* '^attachment:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                    then substring(output.item->>'id' from 12)::uuid end
                  and attachment.issue_id=case when output.item->'sourceIssue'->>'id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                    then (output.item->'sourceIssue'->>'id')::uuid end
                  and asset.original_filename is not distinct from nullif(output.item->>'key',output.item->>'contentType')
                  and coalesce(source_issue.source_trust,'null'::jsonb)
                    is not distinct from coalesce(output.item->'sourceTrust','null'::jsonb))
            else false
          end
        )))
  )`;
}

/** One native Task/Project source graph; this never authorizes a company action.
 * Private Routine sources enter through the exact callback-local native owner.
 * Empty stored arrays are relational facts only,
 * never complete-input receipts or publication authority. */
function taskSourcePrivacySqlCondition(db: Db | DbTransaction, kind: "issue" | "project" | "run" | "workflow_run" | "routine_run", id: SQL, company: SQL, actor: AuthorizationActor): SQL<boolean> {
  const routineScope = nativeRoutineReadScopes.get(db as object);
  const routineCapabilityActive = routineScope?.active && routineScope.companyId && routineScope.routineActorKey === routineActorKey(actor);
  const workflowScope = nativeWorkflowReadScopes.get(db as object);
  const workflowCapabilityActive = !!workflowScope?.active && !!workflowScope.companyId &&
    workflowScope.workflowActorKey === workflowActorKey(actor);
  const conversationRoutine = routineCapabilityActive
    ? sql`(p.origin_kind='manual' or (p.origin_kind='conversation_draft'
      and current_setting('paperclip.native_routine_actor_hash',true)=${routineActorHash(actor)}
      and current_setting('paperclip.native_routine_scope_token',true)=${routineScope.routineScopeToken ?? ""}
      and rr.id=any(string_to_array(nullif(current_setting('paperclip.native_routine_source_ids',true),''),',')::uuid[])) or
      (p.origin_kind='pipeline_automation' and ${pipelineAutomationRoutineSourceCondition(company)}
        and current_setting('paperclip.native_routine_actor_hash',true)=${routineActorHash(actor)}
        and current_setting('paperclip.native_routine_scope_token',true)=${routineScope.routineScopeToken ?? ""}
        and rr.id=any(string_to_array(nullif(current_setting('paperclip.native_routine_source_ids',true),''),',')::uuid[])))`
    : sql`(p.origin_kind='manual' or (p.origin_kind='pipeline_automation'
      and ${pipelineAutomationRoutineSourceCondition(company)}))`;
  const contextRoots = sql`
    select 'issue'::text as kind,case when c.agent_id=r.agent_id then c.issue_id end as id
      where c.issue_id is not null or c.agent_id<>r.agent_id
    union all select 'project',c.project_id where c.project_id is not null
    union all select 'issue',case when item.source_ref ~* '^issue://[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then substring(item.source_ref from 9)::uuid end
      from context_manifest_items item where item.company_id=c.company_id and item.manifest_id=c.id
        and item.source_provider='august_works_tasks'`;
  const humanId = actor.type === "board" ? actor.userId : actor.onBehalfOfUserId;
  const conversationIdentity = sql`(${privatePrincipalCurrent(actor, company)} and i.conversation_user_id=${humanId ?? null}
    and ${actor.type === "board" ? sql`true` : actor.type === "agent" && actor.agentId ? sql`i.conversation_agent_id=${actor.agentId}` : sql`false`})`;
  const workflowRunScope = workflowCapabilityActive
    ? sql`current_setting('paperclip.native_workflow_actor_hash',true)=${workflowActorHash(actor)}
        and current_setting('paperclip.native_workflow_scope_token',true)=${workflowScope.workflowScopeToken ?? ""}
        and exists(select 1 from workflow_runs scoped_wr where scoped_wr.id=n.id and scoped_wr.company_id=${company}
          and scoped_wr.id=any(string_to_array(nullif(current_setting('paperclip.native_workflow_run_ids',true),''),',')::uuid[]))`
    : sql`false`;
  const edges = sql`        select 'issue'::text as kind,i.privacy_parent_issue_id as id from issues i
          where n.kind='issue' and i.id=n.id and i.company_id=${company} and i.privacy_parent_issue_id is not null
        union all select 'issue',i.privacy_root_issue_id from issues i
          where n.kind='issue' and i.id=n.id and i.company_id=${company} and i.privacy_root_issue_id is not null and i.privacy_root_issue_id<>i.id
        union all select 'project',i.project_id from issues i
          where n.kind='issue' and i.id=n.id and i.company_id=${company} and i.project_id is not null
        union all select case i.origin_kind when 'workflow_task' then 'workflow_run'
            when 'routine_execution' then 'routine_run' else 'run' end,
          case when i.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            and (i.origin_kind not in ('workflow_task','routine_execution') or
              (i.origin_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and case i.origin_kind
                when 'workflow_task' then exists(select 1 from workflow_runs wr where wr.company_id=i.company_id
                  and wr.id=case when i.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then i.origin_run_id::uuid end
                  and wr.workflow_id=case when i.origin_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then i.origin_id::uuid end)
                else exists(select 1 from routine_runs rr where rr.company_id=i.company_id
                  and rr.id=case when i.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then i.origin_run_id::uuid end
                  and rr.routine_id=case when i.origin_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then i.origin_id::uuid end) end))
            then i.origin_run_id::uuid end
          from issues i where n.kind='issue' and i.id=n.id and i.company_id=${company}
            and (i.origin_run_id is not null or i.origin_kind in ('workflow_task','routine_execution'))
            and (i.origin_kind in ('workflow_task','routine_execution') or not exists(
              select 1 from ${heartbeatRuns} own_run where own_run.company_id=i.company_id
                and own_run.id::text=i.origin_run_id and coalesce(own_run.issue_id,own_run.native_issue_id)=i.id))
        union all select 'project',w.project_id from workflow_runs wr
          join workflows w on w.id=wr.workflow_id and w.company_id=wr.company_id
          where n.kind='workflow_run' and wr.id=n.id and wr.company_id=${company} and w.project_id is not null
        union all select ref.kind,case when ref.id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then ref.id::uuid end
          from routine_runs rr join routine_revisions v on v.id=rr.routine_revision_id
            and v.routine_id=rr.routine_id and v.company_id=rr.company_id
          cross join lateral (values ('project',v.snapshot->'routine'->>'projectId'),
            ('issue',v.snapshot->'routine'->>'parentIssueId')) ref(kind,id)
          where n.kind='routine_run' and rr.id=n.id and rr.company_id=${company} and ref.id is not null
        union all select 'issue',source.id::uuid from routine_runs rr
          cross join lateral jsonb_array_elements_text(case
            when jsonb_typeof(rr.trigger_payload->'contextPack'->'taskSourceIssueIds')='array'
              then rr.trigger_payload->'contextPack'->'taskSourceIssueIds' else '[]'::jsonb end) source(id)
          where n.kind='routine_run' and rr.id=n.id and rr.company_id=${company}
            and rr.trigger_payload->'automation'->>'automationExecutionId' is not null
            and source.id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        union all select 'run',case when source.id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            then source.id::uuid end
          from routine_runs rr join routines p on p.id=rr.routine_id and p.company_id=rr.company_id
          cross join lateral jsonb_array_elements_text(case
            when jsonb_typeof(rr.trigger_payload->'contextPack'->'case'->'producerRunIds')='array'
              then rr.trigger_payload->'contextPack'->'case'->'producerRunIds' else '[]'::jsonb end) source(id)
          where n.kind='routine_run' and rr.id=n.id and rr.company_id=${company}
            and rr.trigger_payload->'automation'->>'automationExecutionId' is not null
            and ${pipelineAutomationRoutineSourceCondition(sql`${company}::uuid`)}
        union all select 'issue',source.id from projects p cross join lateral unnest(p.source_issue_ids) source(id)
          where n.kind='project' and p.id=n.id and p.company_id=${company}
        union all select 'project',source.id from projects p cross join lateral unnest(p.source_project_ids) source(id)
          where n.kind='project' and p.id=n.id and p.company_id=${company}
        union all select case when s.source_kind='run' and i.payload_source_protocol_version=1
            and i.payload_source_snapshot_invalidated=false
            and i.payload_source_snapshot->'owner'->>'kind'='issue'
            and i.payload_source_snapshot->'owner'->>'id'=i.id::text
            and i.payload_source_snapshot->'policy'->'runIds' ? s.source_id::text
            then 'retained_run' else s.source_kind end,s.source_id from ${issuePrivacySources} s
          join issues i on i.company_id=s.company_id and i.id=s.issue_id
          where n.kind='issue' and s.issue_id=n.id and s.company_id=${company}
        union all select 'issue',ref.id from ${heartbeatRuns} r cross join lateral (
          select r.issue_id as id where r.issue_id is not null
          union all select r.native_issue_id where r.native_issue_id is not null
          union all select case when r.context_snapshot->>'issueId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            then (r.context_snapshot->>'issueId')::uuid end where r.context_snapshot ? 'issueId'
          union all select case when r.context_snapshot->>'taskId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            then (r.context_snapshot->>'taskId')::uuid end where r.context_snapshot ? 'taskId'
          union all select null::uuid where r.scope_kind='issue' and r.issue_id is null and r.native_issue_id is null
            and not coalesce(r.context_snapshot ? 'issueId',false) and not coalesce(r.context_snapshot ? 'taskId',false)
        ) ref where n.kind in ('run','retained_run') and r.id=n.id and r.company_id=${company}
        union all select root.kind,root.id from ${heartbeatRuns} r
          join context_manifests c on c.company_id=r.company_id and c.run_id=r.id
          cross join lateral (${contextRoots}) root
          where r.company_id=${company} and ((n.kind='run' and r.id=n.id)
            or (n.kind='issue' and coalesce(r.issue_id,r.native_issue_id)=n.id
              and (root.id is null or root.kind<>'issue' or root.id<>n.id)))
`;
  const enumeratedEdges = sql`select * from (${edges}) native_edges limit 257`;
  return sql<boolean>`(
    with recursive privacy_nodes(kind,id) as (
      select ${kind}::text,${id}
      union
      select edge.kind,edge.id from privacy_nodes n cross join lateral (${enumeratedEdges}) edge
    ), bounded as materialized (select * from privacy_nodes limit 257)
    select case when (select count(*) from bounded)>256 then false else not exists (
      with recursive source_edges as materialized (
        select n.kind,n.id,edge.kind as source_kind,edge.id as source_id
        from bounded n cross join lateral (${enumeratedEdges}) edge
      ), reachable(kind,id,source_kind,source_id) as (
        select kind,id,source_kind,source_id from source_edges
        union
        select r.kind,r.id,e.source_kind,e.source_id from reachable r
          join source_edges e on e.kind=r.source_kind and e.id=r.source_id
      )
      select 1 from source_edges group by kind,id having count(*)>256
      union all
      select 1 from reachable where kind=source_kind and id=source_id
      union all
      select 1 from bounded n where
        n.kind not in ('issue','project','run','retained_run','workflow_run','routine_run')
        or (n.kind='issue' and not exists(select 1 from issues i where i.id=n.id and i.company_id=${company}
          and i.conversation_retired_at is null and ((i.conversation_agent_id is null and i.conversation_user_id is null)
            or ${conversationIdentity})
          and (i.visibility='open' or ${issuePrincipalAccess(actor, sql`i.id`, sql`${company}`)})))
        or (n.kind='project' and not exists(select 1 from projects p where p.id=n.id and p.company_id=${company}
          and p.source_provenance_qualified and (p.visibility='open' or ${projectPrincipalAccess(actor, sql`p.id`, sql`${company}`)})))
          or (n.kind in ('run','retained_run') and not exists(select 1 from ${heartbeatRuns} r where r.id=n.id and r.company_id=${company}
          and ${heartbeatRunTaskBindingCondition(sql`r`)}))
        -- Selected private Memory can narrow a derivative's audience, even when
        -- the producer's original Task is public. This is a necessary denial,
        -- not a complete Memory provenance receipt or a positive access grant.
        or (n.kind='run' and exists(select 1 from context_manifests c
          join context_manifest_memory_roots root on root.company_id=c.company_id and root.manifest_id=c.id
          left join memory_records m on m.company_id=root.company_id and m.id=root.memory_record_id
          where c.company_id=${company} and c.run_id=n.id and (m.id is null
            or (m.scope_type='agent' and m.private_owner_user_id is null)
            or (m.private_owner_user_id is not null and
              (m.private_owner_user_id is distinct from ${humanId ?? null} or not ${privatePrincipalCurrent(actor, company)}))
            or (m.scope_type='agent' and ${actor.type === "agent"
              ? sql`(m.owner_agent_id::text is distinct from ${actor.agentId ?? null} or m.scope_id is distinct from ${actor.agentId ?? null})`
              : sql`false`}))))
        or (n.kind='workflow_run' and not exists(select 1 from workflow_runs wr
          join workflows w on w.id=wr.workflow_id and w.company_id=wr.company_id
          join workflow_revisions v on v.id=wr.workflow_revision_id and v.workflow_id=wr.workflow_id and v.company_id=wr.company_id
          where wr.id=n.id and wr.company_id=${company}
            and ((w.authoring_source_run_ids='[]'::jsonb and wr.authoring_source_workflow_ids='[]'::jsonb
              and wr.memory_record_ids='[]'::jsonb and not exists(select 1 from workflow_step_runs step
                where step.company_id=wr.company_id and step.workflow_run_id=wr.id and step.memory_record_ids is distinct from '[]'::jsonb)
              and not exists(select 1 from learning_retained_assets lra
                join learning_domain_candidates ldc on ldc.company_id=lra.company_id and ldc.id=lra.candidate_link_id
                join learning_hypotheses lh on lh.company_id=ldc.company_id and lh.id=ldc.hypothesis_id
                join learning_cycles lc on lc.company_id=lh.company_id and lc.id=lh.cycle_id
                where lra.company_id=wr.company_id and lra.asset_type='workflow_revision' and lra.asset_id=wr.workflow_revision_id)
              and not exists(select 1 from workflow_step_runs source_step
                join learning_retained_assets lra on lra.company_id=source_step.company_id
                  and lra.asset_type='automation_artifact_version' and lra.asset_id=source_step.automation_artifact_version_id
                join learning_domain_candidates ldc on ldc.company_id=lra.company_id and ldc.id=lra.candidate_link_id
                join learning_hypotheses lh on lh.company_id=ldc.company_id and lh.id=ldc.hypothesis_id
                join learning_cycles lc on lc.company_id=lh.company_id and lc.id=lh.cycle_id
                where source_step.company_id=wr.company_id and source_step.workflow_run_id=wr.id))
              or ${workflowRunScope})
            and not aw_workflow_authoring_source_erased(w.company_id,w.id)
            and not aw_workflow_run_authoring_source_erased(wr.company_id,wr.id)))
        or (n.kind='routine_run' and not exists(select 1 from routine_runs rr
          join routines p on p.id=rr.routine_id and p.company_id=rr.company_id
          join routine_revisions v on v.id=rr.routine_revision_id and v.routine_id=rr.routine_id and v.company_id=rr.company_id
          where rr.id=n.id and rr.company_id=${company} and ${conversationRoutine}
            and v.snapshot->'version'='1'::jsonb
            and lower(v.snapshot->'routine'->>'id')=rr.routine_id::text
            and lower(v.snapshot->'routine'->>'companyId')=rr.company_id::text
            and v.snapshot->'routine' ? 'projectId' and v.snapshot->'routine' ? 'parentIssueId'
            and not aw_conversation_routine_source_erased(p.company_id,p.id)))
    ) end
  )`;
}

export async function canActorReadIssuePrivacy(db: Db | DbTransaction, actor: AuthorizationActor, issue: IssuePrivacyRow): Promise<boolean> {
  const taskPrivacyBatch = nativeTaskPrivacyBatches.get(db as object);
  if (taskPrivacyBatch?.active && taskPrivacyBatch.companyId === issue.companyId && taskPrivacyBatch.actorKey === routineActorKey(actor)) {
    return taskPrivacyBatch.issues.get(issue.id) ?? false;
  }
  const activeRoutineScope = nativeRoutineReadScopes.get(db as object);
  if (!activeRoutineScope?.active && actor.type !== "none" && actor.source !== "local_implicit") {
    const [sourceRows] = await db.execute<{ ids: string[]; overflow: boolean }>(sql`
      with recursive issue_chain(id) as (
        select ${issue.id}::uuid
        union
        select parent.id from issue_chain c cross join lateral (
          select coalesce(i.privacy_parent_issue_id,i.parent_id) as id from issues i
            where i.id=c.id and i.company_id=${issue.companyId} and coalesce(i.privacy_parent_issue_id,i.parent_id) is not null
          union select i.privacy_root_issue_id from issues i where i.id=c.id and i.company_id=${issue.companyId}
            and i.privacy_root_issue_id is not null and i.privacy_root_issue_id<>i.id
          union select s.source_id from issue_privacy_sources s where s.issue_id=c.id and s.company_id=${issue.companyId}
            and s.source_kind='issue'
        ) parent
      ), bounded_nodes as materialized (select id from issue_chain limit 257), routine_ids as (
        select i.origin_run_id::uuid as id from bounded_nodes c join issues i on i.id=c.id and i.company_id=${issue.companyId}
          where i.origin_kind='routine_execution' and i.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        union select s.source_id from bounded_nodes c join issue_privacy_sources s on s.issue_id=c.id and s.company_id=${issue.companyId}
          where s.source_kind='routine_run'
      ), bounded as materialized (select distinct id from routine_ids limit 257)
      select coalesce(array_agg(id::text) filter(where id is not null),array[]::text[]) as ids,
        ((select count(*) from bounded_nodes)>256 or (select count(*) from bounded)>256) as overflow from bounded
    `);
    const routineIds = sourceRows?.ids ?? [];
    if (sourceRows?.overflow) return false;
    if (routineIds.length) {
      if (is(db, PgTransaction)) {
        return authorizationService(db).withReadRoutineSources(issue.companyId, actor, routineIds, async () =>
          canActorReadIssuePrivacy(db, actor, issue));
      }
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as DbTransaction;
        return authorizationService(tx).withReadRoutineSources(issue.companyId, actor, routineIds, async () =>
          canActorReadIssuePrivacy(tx, actor, issue));
      });
    }
  }
  return (await db.select({ id: issues.id }).from(issues).where(and(eq(issues.id, issue.id), eq(issues.companyId, issue.companyId), await issueReadSqlCondition(db, actor))).limit(1)).length > 0;
}
/** Typed Task execution owners are distinct namespaces from heartbeat runs.
 * Workflow and Routine payload reads enter their original native authoring
 * owners before the shared retained-source SQL checks run. */
export async function canActorReadTypedTaskSourcePrivacy(db: Db | DbTransaction, actor: AuthorizationActor,
  source: { sourceKind: "workflow_run" | "routine_run"; id: string; companyId: string }): Promise<boolean> {
  const table = source.sourceKind === "workflow_run" ? workflowRuns : routineRuns;
  if (source.sourceKind === "workflow_run" && !nativeWorkflowReadScopes.get(db as object)?.active
    && actor.type !== "none" && actor.source !== "local_implicit") {
    if (is(db, PgTransaction)) return authorizationService(db).withReadWorkflowSources(source.companyId, actor, [source.id], async () =>
      canActorReadTypedTaskSourcePrivacy(db, actor, source));
    return db.transaction(async rawTx => {
      const tx = rawTx as unknown as DbTransaction;
      return authorizationService(tx).withReadWorkflowSources(source.companyId, actor, [source.id], async () =>
        canActorReadTypedTaskSourcePrivacy(tx, actor, source));
    });
  }
  if (source.sourceKind === "routine_run" && !nativeRoutineReadScopes.get(db as object)?.active
    && actor.type !== "none" && actor.source !== "local_implicit") {
    if (is(db, PgTransaction)) return authorizationService(db).withReadRoutineSources(source.companyId, actor, [source.id], async () =>
      canActorReadTypedTaskSourcePrivacy(db, actor, source));
    return db.transaction(async rawTx => {
      const tx = rawTx as unknown as DbTransaction;
      return authorizationService(tx).withReadRoutineSources(source.companyId, actor, [source.id], async () =>
        canActorReadTypedTaskSourcePrivacy(tx, actor, source));
    });
  }
  const sourceCondition = await taskSourcePrivacySqlCondition(db, source.sourceKind, sql`${table.id}`, sql`${table.companyId}`, actor);
  const rows = await db.select({ id: table.id }).from(table).where(and(eq(table.id, source.id), eq(table.companyId, source.companyId), sourceCondition)).limit(1);
  return rows.length > 0;
}
export async function canActorReadProjectPrivacy(db: Db | DbTransaction, actor: AuthorizationActor, project: ProjectPrivacyRow) {
  const taskPrivacyBatch = nativeTaskPrivacyBatches.get(db as object);
  if (taskPrivacyBatch?.active && taskPrivacyBatch.companyId === project.companyId && taskPrivacyBatch.actorKey === routineActorKey(actor)) {
    return taskPrivacyBatch.projects.get(project.id) ?? false;
  }
  return (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, project.id), eq(projects.companyId, project.companyId), await projectReadSqlCondition(db, actor))).limit(1)).length > 0;
}

/** Original persisted run binding, never caller-supplied scope or context facts.
 * This narrows payload visibility; company/action and V8 copy checks still apply. */
export async function canActorReadHeartbeatRunPrivacy(db: Db | DbTransaction, actor: AuthorizationActor, source: { id: string; companyId: string }): Promise<boolean> {
  return (await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, source.id), eq(heartbeatRuns.companyId, source.companyId),
    await heartbeatRunReadSqlCondition(db, actor),
  )).limit(1)).length > 0;
}

/** Same persisted native run closure for pre-limit projections and direct reads. */
export async function heartbeatRunReadSqlCondition(_db: Db | DbTransaction, actor: AuthorizationActor): Promise<SQL<boolean>> {
  return taskSourcePrivacySqlCondition(_db, "run", sql`${heartbeatRuns.id}`, sql`${heartbeatRuns.companyId}`, actor);
}

export function responsibleUserAuthzShadowMode() {
  const mode = process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE?.trim().toLowerCase();
  const shadow = process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_SHADOW?.trim().toLowerCase();
  return mode === "shadow" || shadow === "1" || shadow === "true" || shadow === "yes";
}

function activeResponsibleUserCanAuthorizeIssueAction(
  action: AuthorizationAction,
  membership: ResponsibleUserSnapshot["activeMembership"],
) {
  return Boolean(
    membership &&
    membership.status === "active" &&
    membership.membershipRole !== "viewer" &&
    (action === "issue:comment" || action === "issue:mutate")
  );
}

function activeResponsibleUserCanAuthorizeAgentGrantedSkillChange(
  action: AuthorizationAction,
  membership: ResponsibleUserSnapshot["activeMembership"],
  agentDecision: AuthorizationDecision,
  actorAgentId: string | null | undefined,
) {
  return Boolean(
    action === "skill_config:update" &&
    membership &&
    membership.status === "active" &&
    membership.membershipRole !== "viewer" &&
    agentDecision.allowed &&
    (agentDecision.reason === "allow_direct_change" || agentDecision.reason === "allow_consented_change") &&
    agentDecision.grant?.principalType === "agent" &&
    agentDecision.grant.principalId === actorAgentId &&
    (agentDecision.grant.permissionKey === "skills:create" ||
      agentDecision.grant.permissionKey === "skills:suggest-changes"),
  );
}

function scopeBoolean(scope: Record<string, unknown> | null | undefined, key: string) {
  return scope?.[key] === true;
}

export function authorizationDeniedDetails(decision: AuthorizationDecision) {
  return {
    ...(decision.code ? { code: decision.code } : {}),
    reason: decision.reason,
  };
}

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function authorizationService(db: Db | DbTransaction) {
  return createAuthorizationService(db);
}

type ReadSourceDecisionInput = {
  actor: AuthorizationActor;
  action: AuthorizationAction;
  resource: AuthorizationResource;
  scope?: Record<string, unknown> | null;
  enforceResponsibleUserIntersection?: boolean;
};
export type NativeContextInspectionOwner = { decide(input: ReadSourceDecisionInput): Promise<AuthorizationDecision> };
type ReadSourceOwner = NativeContextInspectionOwner & {
  assertTaskPrivacyBatch(actor: AuthorizationActor, issueIds: string[], projectIds: string[], deadline?:number): Promise<void>;
  readRoutineSources?(runIds: string[], actor: AuthorizationActor): Promise<string[]>;
  readWorkflowSources?(runIds: string[], actor: AuthorizationActor, mode?: "strict" | "task_candidates"): Promise<string[]>;
};
type ReadScopePurpose = "task_sources" | "company_search" | "context_inspection" | "routine_sources" | "workflow_sources" | "workflow_task_candidates";
type ReadSourceRows = {
  companyId: string;
  agentId: string | null;
  issues: Map<string, IssueAuthorizationRow | null>;
  projects: Map<string, ProjectAuthorizationRow | null>;
  active: boolean;
  credentialExpiresAt: number | null;
  credentialUserId: string | null;
  purpose: ReadScopePurpose;
  routineRunIds?: Set<string>;
  routineActorKey?: string;
  routineActor?: AuthorizationActor;
  routineAgentIds?: Set<string>;
  routineScopeToken?: string;
  workflowRunIds?: Set<string>;
  workflowSourceCheckRunIds?: Set<string>;
  workflowReadableRunIds?: Set<string>;
  workflowActorKey?: string;
  workflowScopeToken?: string;
};
type NativeTaskPrivacyBatch = {
  active: boolean;
  companyId: string;
  actorKey: string;
  issues: Map<string, boolean>;
  projects: Map<string, boolean>;
  decisionMemo: NativeTaskDecisionMemo;
};
type NativeTaskDecisionMemo = {
  agents: Map<string, Promise<AgentAuthorizationRow | null>>;
  memberships: Map<string, Promise<typeof companyMemberships.$inferSelect | null>>;
  grants: Map<string, Promise<typeof principalPermissionGrants.$inferSelect | null>>;
  responsibleUsers: Map<string, Promise<ResponsibleUserSnapshot>>;
  runPolicies: Map<string, Promise<{ companyId: string; executionPolicy: Record<string, unknown> } | null>>;
  instanceAdmins: Map<string, Promise<boolean>>;
  readActorEvidence: Map<string, Promise<{ agent: AgentAuthorizationRow | null; run: { companyId: string; executionPolicy: Record<string, unknown> } | null }>>;
};
const nativeRoutineReadScopes = new WeakMap<object, ReadSourceRows>();
const nativeWorkflowReadScopes = new WeakMap<object, ReadSourceRows>();
const nativeTaskPrivacyBatches = new WeakMap<object, NativeTaskPrivacyBatch>();
function createNativeTaskDecisionMemo(): NativeTaskDecisionMemo {
  return { agents: new Map(), memberships: new Map(), grants: new Map(), responsibleUsers: new Map(), runPolicies: new Map(), instanceAdmins: new Map(), readActorEvidence: new Map() };
}
function routineActorKey(actor: AuthorizationActor) {
  return JSON.stringify(actor);
}
function routineActorHash(actor: AuthorizationActor) {
  return createHash("sha256").update(routineActorKey(actor)).digest("hex");
}
function workflowActorKey(actor: AuthorizationActor) {
  const { isInstanceAdmin: _instanceAdminProjection, ignoreInstanceAdmin: _ignoreInstanceAdminProjection, ...identity } = actor;
  return JSON.stringify(identity);
}
function workflowActorHash(actor: AuthorizationActor) { return createHash("sha256").update(workflowActorKey(actor)).digest("hex"); }
function isWithholdableWorkflowTaskCandidate(error: unknown) {
  if (!(error instanceof HttpError) || ![403, 404, 409, 422].includes(error.status)) return false;
  const details = error.details;
  if (details && typeof details === "object" && "code" in details &&
    (details.code === "workflow_source_review_cyclic" || details.code === "workflow_source_review_budget_exceeded")) return false;
  // These are scope-wide failures, never evidence that this one candidate is
  // unreadable. In particular, do not convert an incomplete batch review into
  // a successful partial list/count.
  return !/(budget|cyclic|review.*exceed|exceed.*review)/i.test(error.message);
}
const issueReadColumns = {
  id: issues.id, companyId: issues.companyId, projectId: issues.projectId, parentId: issues.parentId,
  assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId, checkoutRunId: issues.checkoutRunId,
  status: issues.status, executionPolicy: issues.executionPolicy, originKind: issues.originKind, originId: issues.originId,
  visibility: issues.visibility, privacyRootIssueId: issues.privacyRootIssueId, privacyParentIssueId: issues.privacyParentIssueId,
  responsibleUserId: issues.responsibleUserId, createdByUserId: issues.createdByUserId,
  hiddenAt: issues.hiddenAt,
};
const projectReadColumns = { id: projects.id, companyId: projects.companyId, executionWorkspacePolicy: projects.executionWorkspacePolicy, visibility: projects.visibility };

/** Pins the native Board principal and verified credential on the caller's
 * physical transaction. This is no company grant; callers retain their own
 * canonical resource policy and check the deadline before returning data. */
export async function pinCurrentBoardActor(db: Db | DbTransaction, actor: AuthorizationActor) {
  if (!is(db, PgTransaction)) throw new Error("Current Board authority requires a native transaction");
  if (actor.type !== "board" || !actor.userId || actor.source === "local_implicit") return null;
  let credentialExpiresAt = actor.authenticatedCredentialExpiresAt ?? null;
  if (credentialExpiresAt !== null && (!Number.isFinite(credentialExpiresAt) || credentialExpiresAt <= Date.now())) return null;
  const [user] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, actor.userId)).for("share", { noWait: true });
  if (!user) return null;
  if (actor.source === "session" && actor.sessionId != null) {
    const [session] = await db.select({ userId: authSessions.userId, expiresAt: authSessions.expiresAt })
      .from(authSessions).where(eq(authSessions.id, actor.sessionId)).for("share", { noWait: true });
    if (!session || session.userId !== actor.userId || session.expiresAt.getTime() <= Date.now()) return null;
    credentialExpiresAt = Math.min(credentialExpiresAt ?? Infinity, session.expiresAt.getTime());
  }
  if (actor.source === "board_key") {
    if (!actor.keyId) return null;
    const [key] = await db.select().from(boardApiKeys).where(eq(boardApiKeys.id, actor.keyId)).for("share", { noWait: true });
    if (!key || key.keyHash !== actor.authenticatedKeyHash || key.userId !== actor.userId || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) return null;
    if (key.expiresAt) credentialExpiresAt = Math.min(credentialExpiresAt ?? Infinity, key.expiresAt.getTime());
  }
  // Native instance roles are read by isInstanceAdmin below. A DTO bit is
  // never a pinned role, including cloud tenant actors.
  if (credentialExpiresAt !== null && credentialExpiresAt <= Date.now()) return null;
  return { actor: { ...actor, isInstanceAdmin: false }, credentialExpiresAt };
}

async function requireActiveWorkflowBaselineMembership(db: Db | DbTransaction, companyId: string, actor: AuthorizationActor) {
  if (actor.type === "none") return;
  if (actor.type === "board" && actor.source === "local_implicit") return;
  if (actor.type === "agent") {
    const responsibleUserId = actor.onBehalfOfUserId?.trim();
    if (!responsibleUserId) throw forbidden("Current Workflow baseline Human authority is unavailable.");
    const [user] = await db.select({ id: authUsers.id }).from(authUsers).where(and(
      eq(authUsers.id, responsibleUserId), sql`not exists(select 1 from ${accountDeletionOperations} d where d.user_id=${authUsers.id})`,
    )).for("share", { noWait: true });
    const [humanMembership] = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, responsibleUserId), eq(companyMemberships.status, "active"),
    )).for("share", { noWait: true });
    if (!user || !humanMembership) throw forbidden("Current Workflow baseline Human authority is unavailable.");
  }
  const principalType = actor.type === "board" ? "user" : actor.type === "agent" ? "agent" : null;
  const principalId = actor.type === "board" ? actor.userId : actor.type === "agent" ? actor.agentId : null;
  if (!principalType || !principalId) throw forbidden("Current Workflow baseline membership is unavailable.");
  const [membership] = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, principalType),
    eq(companyMemberships.principalId, principalId), eq(companyMemberships.status, "active"),
  )).for("share", { noWait: true });
  if (!membership) throw forbidden("Current Workflow baseline membership is unavailable.");
}

// Only this native owner can construct the private row context. Caller DTOs
// cannot supply row facts, policies, authorization results or a read capability.
function createAuthorizationService(db: Db | DbTransaction, readSources?: ReadSourceRows, sourceAuthorityPins = false) {
  const taskDecisionMemo = () => sourceAuthorityPins ? nativeTaskPrivacyBatches.get(db as object)?.decisionMemo : undefined;
  function memoized<T>(cache: Map<string, Promise<T>> | undefined, key: string, load: () => Promise<T>): Promise<T> {
    if (!cache) return load();
    let pending = cache.get(key);
    if (!pending) {
      pending = load();
      cache.set(key, pending);
    }
    return pending;
  }
  async function withReadScope<T>(companyId: string, issueIds: string[], projectIds: string[], purpose: ReadScopePurpose,
    read: (owner: ReadSourceOwner) => Promise<T>, agentId: string | null = null, preflightActor?: AuthorizationActor): Promise<T> {
    const locked = is(db, PgTransaction);
    const requestedIssues = [...new Set(issueIds)], requestedProjects = [...new Set(projectIds)];
    if (requestedIssues.length + requestedProjects.length > 20065) throw new Error("Native Source row transport exceeds its complete-population bound");
    const context: ReadSourceRows = {
      companyId, agentId, active: true, credentialExpiresAt: null, credentialUserId: null, purpose,
      // Context inspection pins the original Human and current role before
      // reading any Task/Project Source row. Other scopes retain their historic order.
      issues: new Map(locked && purpose !== "context_inspection" ? requestedIssues.map(id => [id, null]) : []),
      projects: new Map(locked && purpose !== "context_inspection" ? requestedProjects.map(id => [id, null]) : []),
    };
    if (purpose === "routine_sources") context.routineScopeToken = randomUUID();
    if (purpose === "workflow_sources" || purpose === "workflow_task_candidates") context.workflowScopeToken = randomUUID();
    const owner: ReadSourceOwner = createAuthorizationService(db, context);
    owner.readRoutineSources = async (runIds, actor) => {
      if (purpose !== "routine_sources" || !locked || !context.active || context.companyId !== companyId)
        throw forbidden("Private Routine reads require their original native source scope.");
      if (actor.type === "none" || actor.source === "local_implicit")
        throw forbidden("A current accountable Routine reader is required.");
      if (runIds.length > 256 || new Set(runIds).size !== runIds.length || runIds.some(id => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
        throw forbidden("The native Routine source population is incomplete.");
      await db.execute(sql`select set_config('paperclip.native_routine_source_ids', '', true),
        set_config('paperclip.native_routine_actor_hash', ${routineActorHash(actor)}, true),
        set_config('paperclip.native_routine_scope_token', ${context.routineScopeToken ?? ""}, true)`);
      const sourceActor = actor.type === "board" && actor.source === "session" && !actor.sessionId
        ? null : await pinReadSourceActor(actor, companyId);
      const company = sourceActor ? await owner.decide({ actor: sourceActor, action: "company_scope:read",
        resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true })
        : { allowed: false } as AuthorizationDecision;
      const authorized = new Set<string>();
      context.routineAgentIds ??= new Set<string>();
      if (!company.allowed) {
        context.routineRunIds = authorized;
        context.routineActorKey = routineActorKey(actor);
        return [];
      }
      for (const runId of runIds) {
        const [run] = await db.select({ id: routineRuns.id, routineId: routineRuns.routineId,
          revisionId: routineRuns.routineRevisionId, triggerPayload: routineRuns.triggerPayload }).from(routineRuns).where(and(
            eq(routineRuns.id, runId), eq(routineRuns.companyId, companyId))).for("share", { noWait: true });
        if (!run) continue;
        const [routine] = await db.select({ id: routines.id, companyId: routines.companyId, originKind: routines.originKind,
          originId: routines.originId, createdByAgentId: routines.createdByAgentId, responsibleUserId: routines.responsibleUserId })
          .from(routines).where(and(eq(routines.id, run.routineId), eq(routines.companyId, companyId))).for("share", { noWait: true });
        if (!routine || !run.revisionId) continue;
        const [revision] = await db.select({ id: routineRevisions.id }).from(routineRevisions).where(and(
          eq(routineRevisions.id, run.revisionId), eq(routineRevisions.routineId, routine.id),
          eq(routineRevisions.companyId, companyId))).for("share", { noWait: true });
        if (!revision) continue;
        if (routine.originKind === "pipeline_automation") {
          const [source] = await db.execute<{ valid: boolean }>(sql`
            select ${pipelineAutomationRoutineSourceCondition(sql`${companyId}::uuid`)} as valid
            from routine_runs rr join routines p on p.id=rr.routine_id and p.company_id=rr.company_id
            where rr.id=${runId} and rr.company_id=${companyId}
          `);
          if (source?.valid !== true) continue;
          const payload = run.triggerPayload;
          const contextPack = payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).contextPack : null;
          const taskSourceIssueIds = contextPack && typeof contextPack === "object" && !Array.isArray(contextPack)
            ? (contextPack as Record<string, unknown>).taskSourceIssueIds : null;
          if (!Array.isArray(taskSourceIssueIds) || taskSourceIssueIds.length > 256 || taskSourceIssueIds.some(id =>
            typeof id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) continue;
          let readable = true;
          for (const issueId of taskSourceIssueIds as string[]) {
            const [sourceIssue] = await db.select(issueReadColumns).from(issues).where(and(
              eq(issues.id, issueId), eq(issues.companyId, companyId))).for("share", { noWait: true });
            if (!sourceIssue) { readable = false; break; }
            context.issues.set(sourceIssue.id, sourceIssue);
            if (sourceIssue.projectId && !context.projects.has(sourceIssue.projectId)) {
              const [project] = await db.select(projectReadColumns).from(projects).where(and(
                eq(projects.id, sourceIssue.projectId), eq(projects.companyId, companyId))).for("share", { noWait: true });
              context.projects.set(sourceIssue.projectId, project ?? null);
            }
            const decision = await owner.decide({ actor: sourceActor!, action: "issue:read",
              resource: { type: "issue", companyId, issueId: sourceIssue.id, projectId: sourceIssue.projectId,
                parentIssueId: sourceIssue.parentId, status: sourceIssue.status,
                assigneeAgentId: sourceIssue.assigneeAgentId, assigneeUserId: sourceIssue.assigneeUserId },
              enforceResponsibleUserIntersection: true });
            if (!decision.allowed) { readable = false; break; }
          }
          const caseContext = contextPack && typeof contextPack === "object" && !Array.isArray(contextPack)
            ? (contextPack as Record<string, unknown>).case : null;
          const caseRecord = caseContext && typeof caseContext === "object" && !Array.isArray(caseContext)
            ? caseContext as Record<string, unknown> : null;
          const producerRunIds = caseRecord?.producerRunIds;
          const producerUserIds = caseRecord?.producerUserIds;
          if (!Array.isArray(producerRunIds) || producerRunIds.length > 256 || !Array.isArray(producerUserIds) ||
            producerUserIds.length > 256) readable = false;
          if (readable) for (const sourceRunId of producerRunIds as unknown[]) {
            if (typeof sourceRunId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sourceRunId) ||
              !await canActorReadHeartbeatRunPrivacy(db, sourceActor!, { id: sourceRunId, companyId })) {
              readable = false; break;
            }
          }
          if (readable && (producerUserIds as unknown[]).some(sourceUserId => typeof sourceUserId !== "string" || sourceUserId.length === 0))
            readable = false;
          if (readable) authorized.add(runId);
          continue;
        }
        if (routine.originKind === "conversation_draft") {
          if (!routine.originId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(routine.originId)) continue;
          const [authoringRun] = await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId,
            userId: heartbeatRuns.responsibleUserId, issueId: heartbeatRuns.nativeIssueId,
            snapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(and(
              eq(heartbeatRuns.id, routine.originId), eq(heartbeatRuns.companyId, companyId))).for("share", { noWait: true });
          const conversationId = authoringRun?.issueId ?? authoringRun?.snapshot?.issueId ?? authoringRun?.snapshot?.taskId;
          if (!authoringRun || authoringRun.agentId !== routine.createdByAgentId ||
            authoringRun.userId !== routine.responsibleUserId || typeof conversationId !== "string" ||
            !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conversationId)) continue;
          const [conversation] = await db.select(issueReadColumns).from(issues).where(and(
            eq(issues.id, conversationId), eq(issues.companyId, companyId))).for("share", { noWait: true });
          if (!conversation) continue;
          context.issues.set(conversation.id, conversation);
          if (conversation.projectId && !context.projects.has(conversation.projectId)) {
            const [project] = await db.select(projectReadColumns).from(projects).where(and(
              eq(projects.id, conversation.projectId), eq(projects.companyId, companyId))).for("share", { noWait: true });
            context.projects.set(conversation.projectId, project ?? null);
          }
          context.routineAgentIds.add(authoringRun.agentId);
          const agentDecision = await owner.decide({ actor: sourceActor!, action: "agent:read",
            resource: { type: "agent", companyId, agentId: authoringRun.agentId }, enforceResponsibleUserIntersection: true });
          const issueDecision = await owner.decide({ actor: sourceActor!, action: "issue:read",
            resource: { type: "issue", companyId, issueId: conversation.id, projectId: conversation.projectId,
              parentIssueId: conversation.parentId, status: conversation.status,
              assigneeAgentId: conversation.assigneeAgentId, assigneeUserId: conversation.assigneeUserId },
            enforceResponsibleUserIntersection: true });
          if (!agentDecision.allowed || !issueDecision.allowed) continue;
        }
        try {
          await assertRoutineSourceAccess(db, { id: routine.id, companyId: routine.companyId, originKind: routine.originKind,
            originId: routine.originId, createdByAgentId: routine.createdByAgentId, responsibleUserId: routine.responsibleUserId }, sourceActor!);
        } catch (error) {
          if (error instanceof HttpError && (error.status === 403 || error.status === 404)) continue;
          throw error;
        }
        if (routine.originKind === "conversation_draft") authorized.add(runId);
      }
      context.routineRunIds = authorized;
      context.routineActorKey = routineActorKey(actor);
      context.routineActor = actor;
      await db.execute(sql`select set_config('paperclip.native_routine_source_ids', ${[...authorized].join(",")}, true)`);
      return [...authorized];
    };
    owner.readWorkflowSources = async (runIds, actor, mode = "strict") => {
      const taskCandidates = purpose === "workflow_task_candidates" && mode === "task_candidates";
      if ((purpose !== "workflow_sources" && !taskCandidates) || !locked || !context.active || context.companyId !== companyId || !context.workflowScopeToken)
        throw forbidden("Private Workflow reads require their original native source scope.");
      if (runIds.length > 256 || new Set(runIds).size !== runIds.length ||
        runIds.some(id => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
        throw forbidden("The native Workflow source population is incomplete.");
      await db.execute(sql`select set_config('paperclip.native_workflow_run_ids', '', true),
        set_config('paperclip.native_workflow_actor_hash', ${workflowActorHash(actor)}, true),
        set_config('paperclip.native_workflow_scope_token', ${context.workflowScopeToken}, true)`);
      const sourceActor = actor.type === "none" ? actor : await pinReadSourceActor(actor, companyId);
      if (!sourceActor) throw forbidden("The current Workflow reader is unavailable.");
      context.credentialUserId = sourceActor.type === "board" ? sourceActor.userId ?? null
        : sourceActor.type === "agent" ? sourceActor.onBehalfOfUserId ?? null : null;
      context.workflowActorKey = workflowActorKey(actor);
      const company = sourceActor.type === "none" ? null
        : await owner.decide({ actor: sourceActor, action: "company_scope:read",
          resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
      const { assertWorkflowRunPayloadSourceAccess, withWorkflowAuthoringSourceReview } = await import("./workflows/workflow-authoring-sources.js");
      if (!company?.allowed) {
        await requireActiveWorkflowBaselineMembership(db, companyId, sourceActor);
        const readable = new Set<string>();
        const reviewStartedAt = performance.now();
        await withWorkflowAuthoringSourceReview(async () => {
          for (const runId of runIds) {
            const publicBaseline = await canActorReadTypedTaskSourcePrivacy(db as unknown as Db, { type: "none" },
              { sourceKind: "workflow_run", id: runId, companyId });
            if (!publicBaseline) {
              if (taskCandidates) continue;
              throw forbidden("Current Workflow source access is unavailable.", { code: "analytical_source_access_lost" });
            }
            try {
              await assertWorkflowRunPayloadSourceAccess(db as unknown as Db, companyId, runId, sourceActor);
              readable.add(runId);
            } catch (error) {
              if (taskCandidates && isWithholdableWorkflowTaskCandidate(error)) continue;
              throw error;
            }
          }
        });
        if (taskCandidates && performance.now() - reviewStartedAt > 8_000)
          throw forbidden("Complete Workflow candidate source review exceeded its budget.", { code: "workflow_source_review_budget_exceeded" });
        context.workflowRunIds = new Set();
        context.workflowSourceCheckRunIds = new Set(runIds);
        context.workflowReadableRunIds = taskCandidates ? readable : new Set(runIds);
        await db.execute(sql`select set_config('paperclip.native_workflow_run_ids', '', true)`);
        return [...(context.workflowReadableRunIds ?? [])].sort();
      }
      const authorized = new Set<string>();
      const reviewStartedAt = performance.now();
      await withWorkflowAuthoringSourceReview(async () => {
        for (const runId of runIds) {
          try {
            await assertWorkflowRunPayloadSourceAccess(db as unknown as Db, companyId, runId, sourceActor, "task");
            authorized.add(runId);
          } catch (error) {
            if (taskCandidates && isWithholdableWorkflowTaskCandidate(error)) continue;
            throw error;
          }
        }
      });
      if (taskCandidates && performance.now() - reviewStartedAt > 8_000)
        throw forbidden("Complete Workflow candidate source review exceeded its budget.", { code: "workflow_source_review_budget_exceeded" });
      context.workflowRunIds = authorized;
      context.workflowSourceCheckRunIds = new Set(runIds);
      context.workflowReadableRunIds = new Set(authorized);
      await db.execute(sql`select set_config('paperclip.native_workflow_run_ids', ${[...authorized].sort().join(",")}, true)`);
      return [...authorized];
    };
    if (purpose === "context_inspection") {
      if (!locked || !preflightActor || preflightActor.type !== "board") throw forbidden("Human Context inspection requires its original native actor.");
      const company = await owner.decide({ actor: preflightActor, action: "company_scope:read",
        resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
      const agent = await owner.decide({ actor: preflightActor, action: "agent:read",
        resource: { type: "agent", companyId, agentId: agentId! }, enforceResponsibleUserIntersection: true });
      if (!company.allowed || !agent.allowed) throw forbidden("Human Context inspection authority is unavailable");
    }
    const issueRows = locked && requestedIssues.length ? await db.select(issueReadColumns).from(issues)
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, requestedIssues))).for("share") : [];
    const projectRefs = [...new Set([...requestedProjects, ...issueRows.map(row => row.projectId).filter((id): id is string => id !== null)])];
    if (requestedIssues.length + projectRefs.length > 20065) throw new Error("Native Source row transport exceeds its complete-population bound");
    const projectRows = locked && projectRefs.length ? await db.select(projectReadColumns).from(projects)
      .where(and(eq(projects.companyId, companyId), inArray(projects.id, projectRefs))).for("share") : [];
    // Outside a real transaction, keep the original per-call reads. An
    // autocommit FOR SHARE cannot qualify reusable current Source facts.
    if (locked) {
      for (const id of requestedIssues) if (!context.issues.has(id)) context.issues.set(id, null);
      for (const id of projectRefs) if (!context.projects.has(id)) context.projects.set(id, null);
    }
    for (const row of issueRows) context.issues.set(row.id, row);
    for (const row of projectRows) context.projects.set(row.id, row);
    try {
      if (purpose === "routine_sources") nativeRoutineReadScopes.set(db as object, context);
      if (purpose === "workflow_sources" || purpose === "workflow_task_candidates") nativeWorkflowReadScopes.set(db as object, context);
      const result = await read(owner);
      if (purpose === "routine_sources" && context.routineActor) {
        const before = [...(context.routineRunIds ?? [])].sort();
        const after = await owner.readRoutineSources(before, context.routineActor);
        if (before.length !== after.length || before.some((id, index) => id !== after[index]))
          throw forbidden("Current Routine source authority changed during the read.");
      }
      if (purpose === "workflow_sources" && context.workflowActorKey) {
        const candidates = [...(context.workflowSourceCheckRunIds ?? context.workflowRunIds ?? [])].sort();
        const before = [...(context.workflowReadableRunIds ?? context.workflowRunIds ?? [])].sort();
        const after = await owner.readWorkflowSources!(candidates, preflightActor!);
        const sortedAfter = [...after].sort();
        if (before.length !== sortedAfter.length || before.some((id, index) => id !== sortedAfter[index]))
          throw forbidden("Current Workflow source authority changed during the read.");
      }
      if (purpose === "workflow_task_candidates" && context.workflowActorKey) {
        const candidates = [...(context.workflowSourceCheckRunIds ?? [])].sort();
        const before = [...(context.workflowReadableRunIds ?? [])].sort();
        const after = await owner.readWorkflowSources!(candidates, preflightActor!, "task_candidates");
        const sortedAfter = [...after].sort();
        if (before.length !== sortedAfter.length || before.some((id, index) => id !== sortedAfter[index]))
          throw forbidden("Current Workflow source authority changed during the read.");
      }
      if (context.credentialExpiresAt !== null || context.credentialUserId !== null) {
        const deadlineCurrent = context.credentialExpiresAt === null ? sql`true`
          : sql`clock_timestamp() < to_timestamp(${context.credentialExpiresAt} / 1000.0)`;
        const principalAvailable = context.credentialUserId === null ? sql`true`
          : sql`not exists(select 1 from ${accountDeletionOperations} where user_id=${context.credentialUserId})`;
        const [credential] = await db.execute<{ current: boolean }>(sql`
          select (${deadlineCurrent} and ${principalAvailable}) as current
        `);
        if (!credential?.current) throw forbidden("Native Source credential is no longer available.");
      }
      return result;
    }
    finally {
      if (purpose === "routine_sources") {
        try { await db.execute(sql`select set_config('paperclip.native_routine_source_ids', '', true),
          set_config('paperclip.native_routine_actor_hash', '', true),
          set_config('paperclip.native_routine_scope_token', '', true)`); }
        finally {
          context.active = false;
          if (nativeRoutineReadScopes.get(db as object) === context) nativeRoutineReadScopes.delete(db as object);
        }
      } else if (purpose === "workflow_sources" || purpose === "workflow_task_candidates") {
        try { await db.execute(sql`select set_config('paperclip.native_workflow_run_ids', '', true),
          set_config('paperclip.native_workflow_actor_hash', '', true),
          set_config('paperclip.native_workflow_scope_token', '', true)`); }
        finally {
          context.active = false;
          if (nativeWorkflowReadScopes.get(db as object) === context) nativeWorkflowReadScopes.delete(db as object);
        }
      } else {
        context.active = false;
        if (nativeRoutineReadScopes.get(db as object) === context) nativeRoutineReadScopes.delete(db as object);
      }
    }
  }
  async function withReadSources<T>(companyId: string, issueIds: string[], projectIds: string[], read: (owner: ReadSourceOwner) => Promise<T>) {
    return withReadScope(companyId, issueIds, projectIds, "task_sources", read);
  }
  async function assertTaskPrivacyBatch(actor: AuthorizationActor, issueIds: string[], projectIds: string[], deadline?:number) {
    const checkDeadline=()=>{if(deadline!==undefined&&performance.now()>deadline)throw unprocessable("Forecast exceeds the native source time budget");};
    checkDeadline();
    if (!readSources || !is(db, PgTransaction) || !readSources.active || readSources.purpose !== "task_sources")
      throw forbidden("Batched Task privacy checks require their active native source scope.");
    const companyId = readSources.companyId;
    const idsValid = (ids: string[]) => ids.length <= 20065 && new Set(ids).size === ids.length && ids.every(id =>
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id));
    const exactProjectIds = [...new Set([...projectIds, ...issueIds.map(id => readSources.issues.get(id)?.projectId).filter((id): id is string => id !== null && id !== undefined)])];
    if (!idsValid(issueIds) || !idsValid(projectIds) || issueIds.some(id => !readSources.issues.has(id) || !readSources.issues.get(id)) ||
      !idsValid(exactProjectIds) || exactProjectIds.some(id => !readSources.projects.has(id) || !readSources.projects.get(id)))
      throw forbidden("Batched Task privacy input is not the complete captured native population.");

    const valuesFor = (ids: string[]) => sql.join(ids.map(id => sql`(${id}::uuid)`), sql`, `);
    checkDeadline();
    const issueCondition = await issueReadSqlCondition(db, actor);
    const projectCondition = await projectReadSqlCondition(db, actor);
    checkDeadline();
    const evaluate = async () => {
      const issuesById = new Map<string, boolean>();
      const projectsById = new Map<string, boolean>();
      // Keep every exact per-root predicate and its independent 256-node/edge
      // bound. Batching only removes client/server round trips; it never
      // aggregates a filtered subset or omits a root from the decision.
      for (let offset = 0; offset < issueIds.length; offset += 512) {
        checkDeadline();
        const ids = issueIds.slice(offset, offset + 512);
        const roots = valuesFor(ids);
        const rows = await db.execute<{ id: string; allowed: boolean }>(sql`
          select selected.id::text as id, (${issueCondition}) as allowed
          from (values ${roots}) as selected(id)
          join issues on issues.id=selected.id and issues.company_id=${companyId}
        `);
        for (const row of rows) if (ids.includes(row.id)) issuesById.set(row.id, row.allowed === true);
        for (const id of ids) {
          if (issuesById.get(id) === true) continue;
          // A private Routine edge requires its original canonical owner. The
          // ordinary batched predicate intentionally has no Routine grant;
          // only rows it withholds enter this exact per-source fallback.
          const issue = readSources.issues.get(id);
          if (issue && await canActorReadIssuePrivacy(db, actor, { id, companyId })) issuesById.set(id, true);
        }
        checkDeadline();
      }
      for (let offset = 0; offset < exactProjectIds.length; offset += 512) {
        checkDeadline();
        const ids = exactProjectIds.slice(offset, offset + 512);
        const roots = valuesFor(ids);
        const rows = await db.execute<{ id: string; allowed: boolean }>(sql`
          select selected.id::text as id, (${projectCondition}) as allowed
          from (values ${roots}) as selected(id)
          join projects on projects.id=selected.id and projects.company_id=${companyId}
        `);
        for (const row of rows) if (ids.includes(row.id)) projectsById.set(row.id, row.allowed === true);
        checkDeadline();
      }
      return { issues: issuesById, projects: projectsById };
    };

    // This private provisional map exists only while this closed owner method
    // evaluates the canonical action/policy for every exact source. It is not
    // passed to caller code or returned as an access grant. The complete
    // retained-source privacy predicate runs once, after every base decision,
    // and must pass before this owner returns.
    const batch: NativeTaskPrivacyBatch = {
      active: true,
      companyId,
      actorKey: routineActorKey(actor),
      decisionMemo: createNativeTaskDecisionMemo(),
      issues: new Map(issueIds.map(id => [id, true])),
      projects: new Map(exactProjectIds.map(id => [id, true])),
    };
    nativeTaskPrivacyBatches.set(db as object, batch);
    try {
      const companyWideBoardReader=actor.type==="board"&&!actor.keyId&&!actor.authenticatedKeyHash&&(actor.source==="session"||actor.source==="cloud_tenant");
      if(companyWideBoardReader) {
        // Board action authority is company-membership based; Task and Project
        // visibility is still evaluated separately for every exact root by the
        // canonical SQL predicates below. Avoid re-reading the same Human
        // membership/session for thousands of sources in this closed scope.
        for(const id of issueIds) if(readSources.issues.get(id)!.hiddenAt) throw forbidden("A hidden Task cannot contribute to a metric.");
        const firstIssue=issueIds[0]&&readSources.issues.get(issueIds[0]);
        if(firstIssue) {
          const decision=await decide({actor,action:"issue:read",enforceResponsibleUserIntersection:true,resource:{type:"issue",companyId,issueId:firstIssue.id,projectId:firstIssue.projectId,parentIssueId:firstIssue.parentId,assigneeAgentId:firstIssue.assigneeAgentId,assigneeUserId:firstIssue.assigneeUserId,status:firstIssue.status,originKind:firstIssue.originKind,originId:firstIssue.originId}});
          if(!decision.allowed) throw forbidden("A Task source is outside the current authorization boundary.");
        }
        const firstProject=exactProjectIds[0];
        if(firstProject) {
          const decision=await decide({actor,action:"project:read",enforceResponsibleUserIntersection:true,resource:{type:"project",companyId,projectId:firstProject}});
          if(!decision.allowed) throw forbidden("A Project source is outside the current authorization boundary.");
        }
        checkDeadline();
      } else {
        const checks = [
          ...issueIds.map(id => async () => {
            const issue = readSources.issues.get(id)!;
            if (issue.hiddenAt) throw forbidden("A hidden Task cannot contribute to a metric.");
            const decision = await decide({ actor, action: "issue:read", enforceResponsibleUserIntersection: true, resource: {
              type: "issue", companyId, issueId: id, projectId: issue.projectId, parentIssueId: issue.parentId,
              assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId, status: issue.status,
              originKind: issue.originKind, originId: issue.originId,
            } });
            if (!decision.allowed) throw forbidden("A Task source is outside the current authorization boundary.");
          }),
          ...exactProjectIds.map(id => async () => {
            const decision = await decide({ actor, action: "project:read", enforceResponsibleUserIntersection: true,
              resource: { type: "project", companyId, projectId: id } });
            if (!decision.allowed) throw forbidden("A Project source is outside the current authorization boundary.");
          }),
        ];
        for (let offset = 0; offset < checks.length; offset += 32) {
          const decisions = await Promise.allSettled(checks.slice(offset, offset + 32).map(check => check()));
          for (const decision of decisions) if (decision.status === "rejected") throw decision.reason;
          checkDeadline();
        }
      }
    } finally {
      batch.active = false;
      nativeTaskPrivacyBatches.delete(db as object);
    }
    const final = await evaluate();
    checkDeadline();
    if (issueIds.some(id => final.issues.get(id) !== true) || exactProjectIds.some(id => final.projects.get(id) !== true))
      throw forbidden("Task source privacy changed during the complete read.");
  }
  async function withReadCompany<T>(companyId: string, read: (owner: ReadSourceOwner) => Promise<T>) {
    if (!is(db, PgTransaction)) throw forbidden("Company search requires a native read transaction.");
    return withReadScope(companyId, [], [], "company_search", read);
  }
  async function withReadRoutineSources<T>(companyId: string, actor: AuthorizationActor, runIds: string[],
    read: (owner: ReadSourceOwner) => Promise<T>) {
    if (!is(db, PgTransaction)) throw forbidden("Private Routine reads require a native transaction.");
    if (nativeRoutineReadScopes.get(db as object)?.active) throw forbidden("Nested Routine source scopes are unavailable.");
    return withReadScope(companyId, [], [], "routine_sources", async owner => {
      if (!owner.readRoutineSources) throw forbidden("Private Routine reader is unavailable.");
      await owner.readRoutineSources(runIds, actor);
      return read(owner);
    }, null, actor);
  }
  async function withReadWorkflowSources<T>(companyId: string, actor: AuthorizationActor, runIds: string[],
    read: (owner: ReadSourceOwner) => Promise<T>) {
    if (!is(db, PgTransaction)) throw forbidden("Private Workflow reads require a native transaction.");
    const existing = nativeWorkflowReadScopes.get(db as object);
    if (existing?.active) {
      if (existing.companyId !== companyId || existing.workflowActorKey !== workflowActorKey(actor))
        throw forbidden("Nested Workflow source authority changed.");
      const owner: ReadSourceOwner = createAuthorizationService(db, existing);
      owner.readWorkflowSources = async (ids, currentActor) => {
        if (!existing.active || currentActor.type === "none" || !existing.workflowScopeToken)
          throw forbidden("Nested Workflow source authority is unavailable.");
        const candidates = new Set(existing.workflowSourceCheckRunIds ?? existing.workflowRunIds ?? []);
        const currentlyReadable = existing.workflowReadableRunIds ?? existing.workflowRunIds ?? new Set<string>();
        const combined = [...new Set([...currentlyReadable, ...ids])].sort();
        if (!combined.length || combined.length > 256) throw forbidden("The complete nested Workflow source population exceeds its bound.");
        await db.execute(sql`select set_config('paperclip.native_workflow_run_ids', '', true),
          set_config('paperclip.native_workflow_actor_hash', ${workflowActorHash(currentActor)}, true),
          set_config('paperclip.native_workflow_scope_token', ${existing.workflowScopeToken}, true)`);
        const sourceActor = await pinReadSourceActor(currentActor, companyId);
        if (!sourceActor) throw forbidden("The nested Workflow reader is unavailable.");
        const company = await owner.decide({ actor: sourceActor, action: "company_scope:read",
          resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
        const { assertWorkflowRunPayloadSourceAccess, withWorkflowAuthoringSourceReview } = await import("./workflows/workflow-authoring-sources.js");
        if (!company.allowed) {
          await requireActiveWorkflowBaselineMembership(db, companyId, sourceActor);
          await withWorkflowAuthoringSourceReview(async () => {
            for (const runId of combined) {
              const publicBaseline = await canActorReadTypedTaskSourcePrivacy(db as unknown as Db, { type: "none" },
                { sourceKind: "workflow_run", id: runId, companyId });
              if (!publicBaseline) throw forbidden("Current Workflow source access is unavailable.", { code: "analytical_source_access_lost" });
              await assertWorkflowRunPayloadSourceAccess(db as unknown as Db, companyId, runId, sourceActor, "task");
            }
          });
          existing.workflowRunIds = new Set();
          combined.forEach(id => candidates.add(id));
          existing.workflowSourceCheckRunIds = candidates;
          existing.workflowReadableRunIds = new Set(combined);
          existing.credentialUserId = sourceActor.type === "board" ? sourceActor.userId ?? null
            : sourceActor.type === "agent" ? sourceActor.onBehalfOfUserId ?? null : null;
          await db.execute(sql`select set_config('paperclip.native_workflow_run_ids', '', true)`);
          return combined;
        }
        await withWorkflowAuthoringSourceReview(async () => {
          for (const id of combined) await assertWorkflowRunPayloadSourceAccess(db as unknown as Db, companyId, id, sourceActor, "task");
        });
        existing.workflowRunIds = new Set(combined);
        combined.forEach(id => candidates.add(id));
        existing.workflowSourceCheckRunIds = candidates;
        existing.workflowReadableRunIds = new Set(combined);
        existing.credentialUserId = sourceActor.type === "board" ? sourceActor.userId ?? null
          : sourceActor.type === "agent" ? sourceActor.onBehalfOfUserId ?? null : null;
        await db.execute(sql`select set_config('paperclip.native_workflow_run_ids', ${combined.join(",")}, true)`);
        return combined;
      };
      await owner.readWorkflowSources(runIds, actor);
      return read(owner);
    }
    if (nativeRoutineReadScopes.get(db as object)?.active)
      throw forbidden("Nested Workflow and Routine source scopes are unavailable.");
    if (!runIds.length || runIds.length > 256 || new Set(runIds).size !== runIds.length ||
      runIds.some(id => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
      throw forbidden("The native Workflow source population is incomplete.");
    return withReadScope(companyId, [], [], "workflow_sources", async owner => {
      if (!owner.readWorkflowSources) throw forbidden("Private Workflow reader is unavailable.");
      await owner.readWorkflowSources(runIds, actor);
      return read(owner);
    }, null, actor);
  }
  /** Route-only candidate filtering: unlike explicit Workflow source reads,
   * inaccessible candidate Runs are withheld individually before list/count
   * limits. The complete candidate population is rechecked before return. */
  async function withReadWorkflowTaskCandidates<T>(companyId: string, actor: AuthorizationActor, runIds: string[],
    read: (owner: ReadSourceOwner) => Promise<T>) {
    if (!is(db, PgTransaction)) throw forbidden("Workflow Task candidate reads require a native transaction.");
    if (nativeWorkflowReadScopes.get(db as object)?.active || nativeRoutineReadScopes.get(db as object)?.active)
      throw forbidden("Nested Workflow Task candidate scopes are unavailable.");
    if (runIds.length > 256 || new Set(runIds).size !== runIds.length ||
      runIds.some(id => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
      throw forbidden("The native Workflow Task candidate population is incomplete.");
    return withReadScope(companyId, [], [], "workflow_task_candidates", async owner => {
      if (!owner.readWorkflowSources) throw forbidden("Private Workflow Task candidate reader is unavailable.");
      await owner.readWorkflowSources(runIds, actor, "task_candidates");
      return read(owner);
    }, null, actor);
  }
  async function withReadContextInspection<T>(companyId: string, agentId: string, issueIds: string[], projectIds: string[],
    actor: AuthorizationActor, read: (owner: ReadSourceOwner) => Promise<T>) {
    if (!is(db, PgTransaction)) throw forbidden("Human Context inspection requires a native read transaction.");
    return withReadScope(companyId, issueIds, projectIds, "context_inspection", async owner => {
      const company = await owner.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId },
        enforceResponsibleUserIntersection: true });
      const agent = await owner.decide({ actor, action: "agent:read", resource: { type: "agent", companyId, agentId },
        enforceResponsibleUserIntersection: true });
      if (!company.allowed || !agent.allowed) throw forbidden("Human Context inspection authority is unavailable");
      return read(owner);
    }, agentId, actor);
  }
  function prepareSourceInstanceAdminRead() {
    return db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(
      eq(instanceUserRoles.userId, sql.placeholder("userId")),
      eq(instanceUserRoles.role, "instance_admin"),
    )).prepare("aw_native_source_instance_role_read");
  }
  let sourceInstanceAdminRead: ReturnType<typeof prepareSourceInstanceAdminRead> | undefined;
  async function isInstanceAdmin(userId: string | null | undefined): Promise<boolean> {
    if (sourceAuthorityPins && userId) {
      return memoized(taskDecisionMemo()?.instanceAdmins, userId, async () => {
        const rows = await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(
          eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin"),
        )).for("share", { noWait: true });
        return rows.length > 0;
      });
    }
    if (readSources && userId) {
      sourceInstanceAdminRead ??= prepareSourceInstanceAdminRead();
      return (await sourceInstanceAdminRead.execute({ userId })).length > 0;
    }
    return hasCurrentInstanceAdminRole(db, userId);
  }

  function prepareSourceMembershipRead() {
    return db.select().from(companyMemberships).where(and(
      eq(companyMemberships.companyId, sql.placeholder("companyId")),
      eq(companyMemberships.principalType, sql.placeholder("principalType")),
      eq(companyMemberships.principalId, sql.placeholder("principalId")),
      eq(companyMemberships.status, "active"),
    )).prepare("aw_native_source_membership_read");
  }
  let sourceMembershipRead: ReturnType<typeof prepareSourceMembershipRead> | undefined;

  async function getActiveMembership(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
  ) {
    if (sourceAuthorityPins) {
      return memoized(taskDecisionMemo()?.memberships, `${companyId}:${principalType}:${principalId}`, async () => {
        const [row] = await db.select().from(companyMemberships).where(and(
          eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, principalType),
          eq(companyMemberships.principalId, principalId), eq(companyMemberships.status, "active"),
        )).for("share", { noWait: true });
        return row ?? null;
      });
    }
    if (readSources) {
      sourceMembershipRead ??= prepareSourceMembershipRead();
      const rows = await sourceMembershipRead.execute({ companyId, principalType, principalId });
      return rows[0] ?? null;
    }
    return db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, principalType),
          eq(companyMemberships.principalId, principalId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function loadResponsibleUserSnapshot(companyId: string, userId: string): Promise<ResponsibleUserSnapshot> {
    if (sourceAuthorityPins) {
      return memoized(taskDecisionMemo()?.responsibleUsers, `${companyId}:${userId}`, async () => {
        const [user] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, userId)).for("share", { noWait: true });
        const membership = user ? await getActiveMembership(companyId, "user", userId) : null;
        return { userId, companyId, userExists: Boolean(user), activeMembership: membership };
      });
    }
    const [user, membership] = await Promise.all([
      db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .then((rows) => rows[0] ?? null),
      db
        .select({
          companyId: companyMemberships.companyId,
          membershipRole: companyMemberships.membershipRole,
          status: companyMemberships.status,
        })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .then((rows) => rows[0] ?? null),
    ]);
    return {
      userId,
      companyId,
      userExists: Boolean(user),
      activeMembership: user ? membership : null,
    };
  }

  async function findGrant(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
  ) {
    if (sourceAuthorityPins) return memoized(taskDecisionMemo()?.grants, `${companyId}:${principalType}:${principalId}:${permissionKey}`, async () => {
      const [row] = await db.select().from(principalPermissionGrants).where(and(
        eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, principalType),
        eq(principalPermissionGrants.principalId, principalId), eq(principalPermissionGrants.permissionKey, permissionKey),
      )).for("share", { noWait: true });
      return row ?? null;
    });
    const query = db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ),
      );
    const rows = await (sourceAuthorityPins ? query.for("share", { noWait: true }) : query);
    return rows[0] ?? null;
  }

  async function decidePrincipalGrant(input: {
    companyId: string;
    principalType: PrincipalType;
    principalId: string;
    action: AuthorizationAction;
    permissionKey: PermissionKey;
    scope?: Record<string, unknown> | null;
  }): Promise<PrincipalGrantDecision> {
    const membership = await getActiveMembership(input.companyId, input.principalType, input.principalId);
    if (!membership) {
      return deny({
        action: input.action,
        reason: "deny_missing_membership",
        explanation: `${input.principalType} principal ${input.principalId} is not an active member of company ${input.companyId}.`,
      });
    }

    const grant = await findGrant(input.companyId, input.principalType, input.principalId, input.permissionKey);
    if (!grant) {
      if (
        input.principalType === "user"
        && input.permissionKey.startsWith("tools:")
        && (membership.membershipRole === "owner" || membership.membershipRole === "admin")
        && grantsForHumanRole(normalizeHumanRole(membership.membershipRole, "operator"))
          .some((defaultGrant) => defaultGrant.permissionKey === input.permissionKey)
      ) {
        return allow({
          action: input.action,
          reason: "allow_role_default",
          explanation: `Allowed by the ${membership.membershipRole ?? "operator"} membership role.`,
        });
      }
      return deny({
        action: input.action,
        reason: "deny_missing_grant",
        explanation: `Missing permission: ${input.permissionKey}.`,
      });
    }

    if (
      !(await scopeAllows(db, input.companyId, grant.scope, input.scope, {
        requireStructuredScope: input.permissionKey === "tasks:assign_scope",
      }))
    ) {
      return deny({
        action: input.action,
        reason: "deny_scope",
        explanation: `Permission ${input.permissionKey} does not cover the requested scope.`,
        grant: {
          principalType: input.principalType,
          principalId: input.principalId,
          permissionKey: input.permissionKey,
          scope: grant.scope ?? null,
        },
      });
    }

    return allow({
      action: input.action,
      reason: "allow_explicit_grant",
      explanation: `Allowed by explicit grant ${input.permissionKey}.`,
      grant: {
        principalType: input.principalType,
        principalId: input.principalId,
        permissionKey: input.permissionKey,
        scope: grant.scope ?? null,
      },
    });
  }

  async function loadAgent(agentId: string): Promise<AgentAuthorizationRow | null> {
    if (sourceAuthorityPins) return memoized(taskDecisionMemo()?.agents, agentId, async () => {
      const [row] = await db.select({
        id: agents.id,
        companyId: agents.companyId,
        role: agents.role,
        status: agents.status,
        reportsTo: agents.reportsTo,
        permissions: agents.permissions,
      }).from(agents).where(eq(agents.id, agentId)).for("share", { noWait: true });
      return row ?? null;
    });
    const query = db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        role: agents.role,
        status: agents.status,
        reportsTo: agents.reportsTo,
        permissions: agents.permissions,
      })
      .from(agents)
      .where(eq(agents.id, agentId));
    const rows = await (sourceAuthorityPins ? query.for("share", { noWait: true }) : query);
    return rows[0] ?? null;
  }

  // Reuse compiled SQL only. Every Source executes fresh current reads; no
  // actor, run, membership or permission result is cached or share-locked.
  function prepareReadActorEvidence() {
    return db.select({
      agent: {
        id: agents.id, companyId: agents.companyId, role: agents.role,
        status: agents.status, reportsTo: agents.reportsTo, permissions: agents.permissions,
      },
      run: { companyId: heartbeatRuns.companyId, contextSnapshot: heartbeatRuns.contextSnapshot },
    }).from(agents).leftJoin(heartbeatRuns, and(
      eq(heartbeatRuns.id, sql.placeholder("runId")),
      eq(heartbeatRuns.companyId, sql.placeholder("companyId")),
      eq(heartbeatRuns.agentId, agents.id),
    )).where(eq(agents.id, sql.placeholder("agentId"))).prepare("aw_native_source_actor_read");
  }
  let readActorQuery: ReturnType<typeof prepareReadActorEvidence> | undefined;
  async function loadReadActorEvidence(actor: AuthorizationActor, companyId: string) {
    if (sourceAuthorityPins) return memoized(taskDecisionMemo()?.readActorEvidence,
      `${companyId}:${actor.agentId ?? ""}:${actor.runId ?? ""}`, async () => ({
        agent: await loadAgent(actor.agentId!), run: await loadRunPolicy(actor.runId, companyId, actor.agentId!),
      }));
    readActorQuery ??= prepareReadActorEvidence();
    const [row] = await readActorQuery.execute({ runId: actor.runId!, companyId, agentId: actor.agentId! });
    const context = isPlainRecord(row?.run?.contextSnapshot) ? row.run.contextSnapshot : null;
    return {
      agent: row?.agent ?? null,
      run: isPlainRecord(context?.executionPolicy)
        ? { companyId: row!.run!.companyId, executionPolicy: context.executionPolicy }
        : null,
    };
  }

  async function loadProject(projectId: string): Promise<ProjectAuthorizationRow | null> {
    if (readSources?.projects.has(projectId)) return readSources.projects.get(projectId) ?? null;
    return db
      .select({
        id: projects.id,
        companyId: projects.companyId,
        executionWorkspacePolicy: projects.executionWorkspacePolicy,
        visibility: projects.visibility,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .then((rows) => rows[0] ?? null);
  }

  async function loadIssue(issueId: string): Promise<IssueAuthorizationRow | null> {
    if (readSources?.issues.has(issueId)) return readSources.issues.get(issueId) ?? null;
    return db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        projectId: issues.projectId,
        parentId: issues.parentId,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeUserId: issues.assigneeUserId,
        checkoutRunId: issues.checkoutRunId,
        status: issues.status,
        executionPolicy: issues.executionPolicy,
        originKind: issues.originKind,
        originId: issues.originId,
        hiddenAt: issues.hiddenAt,
        visibility: issues.visibility,
        privacyRootIssueId: issues.privacyRootIssueId,
        privacyParentIssueId: issues.privacyParentIssueId,
        responsibleUserId: issues.responsibleUserId,
        createdByUserId: issues.createdByUserId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
  }

  async function loadRunPolicy(runId: string | null | undefined, companyId: string, agentId: string) {
    if (!runId) return null;
    if (sourceAuthorityPins) return memoized(taskDecisionMemo()?.runPolicies, `${companyId}:${agentId}:${runId}`, async () => {
      const [row] = await db.select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).for("share", { noWait: true });
      if (!row || row.companyId !== companyId || row.agentId !== agentId) return null;
      const context = isPlainRecord(row.contextSnapshot) ? row.contextSnapshot : null;
      return isPlainRecord(context?.executionPolicy)
        ? { companyId: row.companyId, executionPolicy: context.executionPolicy }
        : null;
    });
    const query = db
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId));
    const [row] = await (sourceAuthorityPins ? query.for("share", { noWait: true }) : query);
    if (!row || row.companyId !== companyId || row.agentId !== agentId) return null;
    const context = isPlainRecord(row.contextSnapshot) ? row.contextSnapshot : null;
    return isPlainRecord(context?.executionPolicy)
      ? { companyId: row.companyId, executionPolicy: context.executionPolicy }
      : null;
  }

  async function loadRunIssueId(runId: string | null | undefined, companyId: string, agentId: string) {
    if (!runId) return null;
    const row = await db
      .select({
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (!row || row.companyId !== companyId || row.agentId !== agentId) return null;
    const context = isPlainRecord(row.contextSnapshot) ? row.contextSnapshot : null;
    const issueId = typeof context?.issueId === "string"
      ? context.issueId.trim()
      : typeof context?.taskId === "string"
        ? context.taskId.trim()
        : "";
    return issueId || null;
  }

  async function isDirectParentReportTarget(input: {
    actor: AuthorizationActor;
    actorAgentId: string;
    companyId: string;
    resource: AuthorizationResource;
  }) {
    if (input.resource.type !== "issue" || !input.resource.issueId) return false;
    const runIssueId = await loadRunIssueId(input.actor.runId, input.companyId, input.actorAgentId);
    if (!runIssueId || runIssueId === input.resource.issueId) return false;
    const runIssue = await loadIssue(runIssueId);
    return Boolean(
      runIssue &&
      runIssue.companyId === input.companyId &&
      runIssue.assigneeAgentId === input.actorAgentId &&
      runIssue.checkoutRunId === input.actor.runId &&
      runIssue.parentId === input.resource.issueId,
    );
  }

  async function loadProjectAuthorizationPolicy(companyId: string, projectId: string) {
    if (readSources?.companyId === companyId && readSources.projects.has(projectId)) return readPolicyObject(readSources.projects.get(projectId)?.executionWorkspacePolicy, "authorizationPolicy");
    const row = await db
      .select({ executionWorkspacePolicy: projects.executionWorkspacePolicy })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    return readPolicyObject(row?.executionWorkspacePolicy, "authorizationPolicy");
  }

  async function loadIssueAuthorizationPolicy(companyId: string, issueId: string) {
    if (readSources?.companyId === companyId && readSources.issues.has(issueId)) return readPolicyObject(readSources.issues.get(issueId)?.executionPolicy, "authorizationPolicy");
    const row = await db
      .select({ executionPolicy: issues.executionPolicy })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    return readPolicyObject(row?.executionPolicy, "authorizationPolicy");
  }

  async function loadResourceContext(resource: AuthorizationResource) {
    const issue = resource.type === "issue" && resource.issueId ? await loadIssue(resource.issueId) : null;
    const projectId =
      resource.type === "issue"
        ? issue?.projectId ?? resource.projectId ?? null
        : resource.type === "project"
          ? resource.projectId ?? null
          : null;
    const project = projectId ? await loadProject(projectId) : null;
    return { issue, project };
  }

  async function resolveActorTrust(input: {
    actorAgent: AgentAuthorizationRow;
    actor: AuthorizationActor;
    companyId: string;
    resource: AuthorizationResource;
    readActorEvidence?: Awaited<ReturnType<typeof loadReadActorEvidence>>;
  }): Promise<TrustPresetResolution> {
    const { issue, project } = await loadResourceContext(input.resource);
    const run = input.readActorEvidence
      ? input.readActorEvidence.run
      : await loadRunPolicy(input.actor.runId, input.companyId, input.actorAgent.id);
    return resolveCoreTrustPreset({
      companyId: input.companyId,
      agent: input.actorAgent,
      project,
      issue,
      run,
    });
  }

  async function issueIdIsDescendantOf(issueId: string, rootIssueId: string, companyId: string) {
    const rows = await db.execute(sql`
      WITH RECURSIVE ancestors(id, parent_id, depth) AS (
        SELECT id, parent_id, 0
        FROM issues
        WHERE company_id = ${companyId}
          AND id = ${issueId}
        UNION ALL
        SELECT parent.id, parent.parent_id, ancestors.depth + 1
        FROM issues parent
        JOIN ancestors ON parent.id = ancestors.parent_id
        WHERE parent.company_id = ${companyId}
          AND ancestors.depth < ${LOW_TRUST_ISSUE_ANCESTRY_MAX_DEPTH - 1}
      )
      SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = ${rootIssueId}) AS is_descendant
    `);
    const first = Array.isArray(rows) ? rows[0] : null;
    return Boolean(
      first &&
        typeof first === "object" &&
        (first as Record<string, unknown>).is_descendant === true,
    );
  }

  async function issueResourceWithinLowTrustBoundary(
    boundary: LowTrustBoundaryWithCompany,
    resource: Extract<AuthorizationResource, { type: "issue" }>,
  ) {
    const issue = resource.issueId ? await loadIssue(resource.issueId) : null;
    const candidate = {
      companyId: resource.companyId,
      id: issue?.id ?? resource.issueId ?? null,
      projectId: issue?.projectId ?? resource.projectId ?? null,
    };
    if (isIssueWithinLowTrustBoundary(boundary, candidate)) return true;
    if (candidate.id && boundary.rootIssueId) {
      return issueIdIsDescendantOf(candidate.id, boundary.rootIssueId, boundary.companyId);
    }
    if (!resource.parentIssueId) return false;
    const parent = await loadIssue(resource.parentIssueId);
    if (!parent) return false;
    if (
      isIssueWithinLowTrustBoundary(boundary, {
        companyId: parent.companyId,
        id: parent.id,
        projectId: parent.projectId,
      })
    ) {
      return true;
    }
    return boundary.rootIssueId
      ? issueIdIsDescendantOf(parent.id, boundary.rootIssueId, boundary.companyId)
      : false;
  }

  async function projectWithinLowTrustBoundary(
    boundary: LowTrustBoundaryWithCompany,
    projectId: string | null | undefined,
  ) {
    if (!projectId) return false;
    if (boundary.projectIds?.includes(projectId)) return true;
    if (!boundary.rootIssueId) return false;
    const rootIssue = await loadIssue(boundary.rootIssueId);
    return rootIssue?.companyId === boundary.companyId && rootIssue.projectId === projectId;
  }

  function agentWithinLowTrustBoundary(
    boundary: LowTrustBoundaryWithCompany,
    actorAgentId: string,
    targetAgentId: string | null | undefined,
  ) {
    if (!targetAgentId) return false;
    return targetAgentId === actorAgentId || Boolean(boundary.allowedAgentIds?.includes(targetAgentId));
  }

  async function decideLowTrustAccess(input: {
    actorAgentId: string;
    action: AuthorizationAction;
    resource: AuthorizationResource;
    resolution: TrustPresetResolution;
    directParentReportTarget: boolean;
  }): Promise<AuthorizationDecision | null> {
    if (input.resolution.kind === "standard") return null;
    if (input.resolution.kind === "denied") {
      return deny({
        action: input.action,
        reason: "deny_policy_restricted",
        explanation: input.resolution.detail,
      });
    }

    const boundary = input.resolution.boundary;
    const lowTrustDeny = (explanation: string) =>
      deny({
        action: input.action,
        reason: "deny_low_trust_boundary",
        explanation,
      });
    const lowTrustAllow = (explanation: string) =>
      allow({
        action: input.action,
        reason: "allow_low_trust_boundary",
        explanation,
      });

    if (
      input.action === "company_scope:read" ||
      // Agent creation is a company-wide privileged action. The default-on
      // canCreateAgents flag must never reach the legacy creator allow when
      // the effective execution context (agent, project, issue, or run
      // policy) resolves to low trust.
      input.action === "agents:create" ||
      input.action === "decision_queue:manage" ||
      input.action === "decision_queue:read" ||
      input.action === "decision_triage:manage" ||
      input.action === "agent_config:read" ||
      input.action === "agent_config:update" ||
      input.action === "skill_config:update" ||
      input.action === "inbox:manage" ||
      input.action === "runtime:manage" ||
      input.action === "secrets:read" ||
      input.action === "secrets:propose"
    ) {
      return lowTrustDeny(
        `${LOW_TRUST_REVIEW_PRESET} agents cannot use company-wide or privileged ${input.action} APIs by default.`,
      );
    }

    if (input.action === "agent:read" || input.action === "agent:wake") {
      if (input.resource.type !== "agent") {
        return lowTrustDeny("Low-trust agent action is missing an agent resource.");
      }
      return agentWithinLowTrustBoundary(boundary, input.actorAgentId, input.resource.agentId)
        ? lowTrustAllow("Allowed inside the low-trust agent boundary.")
        : lowTrustDeny("Agent is outside this low-trust boundary.");
    }

    if (input.action === "project:read") {
      const projectId =
        input.resource.type === "issue"
          ? input.resource.projectId
          : input.resource.type === "project"
            ? input.resource.projectId
            : null;
      return await projectWithinLowTrustBoundary(boundary, projectId)
        ? lowTrustAllow("Allowed inside the low-trust project boundary.")
        : lowTrustDeny("Project is outside this low-trust boundary.");
    }

    if (input.action === "issue:comment" || input.action === "issue:read" || input.action === "issue:mutate") {
      if (input.resource.type !== "issue") {
        return lowTrustDeny("Low-trust issue access is missing an issue resource.");
      }
      if (input.action === "issue:comment" && input.directParentReportTarget) {
        if (
          input.resource.issueId &&
          await agentHasMentionGrantOnIssue({
            action: input.action,
            companyId: boundary.companyId,
            issueId: input.resource.issueId,
            issueAssigneeAgentId: input.resource.assigneeAgentId ?? null,
            actorAgentId: input.actorAgentId,
          })
        ) {
          return allowIssueMentionGrant(input.action);
        }
        return lowTrustDeny("Direct-parent report comments are disabled for low-trust review runs.");
      }
      if (await issueResourceWithinLowTrustBoundary(boundary, input.resource)) {
        return lowTrustAllow("Allowed inside the low-trust issue boundary.");
      }
      if (
        input.action !== "issue:mutate" &&
        input.resource.issueId &&
        await agentHasMentionGrantOnIssue({
          action: input.action,
          companyId: boundary.companyId,
          issueId: input.resource.issueId,
          issueAssigneeAgentId: input.resource.assigneeAgentId ?? null,
          actorAgentId: input.actorAgentId,
        })
      ) {
        return allowIssueMentionGrant(input.action);
      }
      return lowTrustDeny("Issue is outside this low-trust boundary.");
    }

    if (input.action === "tasks:assign") {
      if (input.resource.type !== "issue") {
        return lowTrustDeny("Low-trust task assignment is missing an issue resource.");
      }
      if (!(await issueResourceWithinLowTrustBoundary(boundary, input.resource))) {
        return lowTrustDeny("Task target is outside this low-trust boundary.");
      }
      if (input.resource.assigneeUserId) {
        return lowTrustDeny("Low-trust agents cannot assign work to board users.");
      }
      if (
        input.resource.assigneeAgentId &&
        !agentWithinLowTrustBoundary(boundary, input.actorAgentId, input.resource.assigneeAgentId)
      ) {
        return lowTrustDeny("Assignee agent is outside this low-trust boundary.");
      }
      return null;
    }

    return null;
  }

  function taskBridgeScopeIds(
    scope: TaskBridgeAgentKeyScope,
    singularKey: "projectId" | "parentIssueId",
    pluralKey: "projectIds" | "parentIssueIds",
  ) {
    return [
      ...(typeof scope[singularKey] === "string" ? [scope[singularKey]] : []),
      ...(Array.isArray(scope[pluralKey]) ? scope[pluralKey] : []),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
  }

  async function parentIssueMatchesTaskBridgeBoundary(
    parentIssueId: string | null | undefined,
    companyId: string,
    allowedParentIssueIds: string[],
  ) {
    if (!parentIssueId || allowedParentIssueIds.length === 0) return false;
    if (allowedParentIssueIds.includes(parentIssueId)) return true;
    for (const rootIssueId of allowedParentIssueIds) {
      if (await issueIdIsDescendantOf(parentIssueId, rootIssueId, companyId)) return true;
    }
    return false;
  }

  async function issueMatchesTaskBridgeCreateBoundary(
    scope: TaskBridgeAgentKeyScope,
    resource: Extract<AuthorizationResource, { type: "issue" }>,
  ) {
    const allowedProjectIds = taskBridgeScopeIds(scope, "projectId", "projectIds");
    const allowedParentIssueIds = taskBridgeScopeIds(scope, "parentIssueId", "parentIssueIds");
    if (resource.projectId && allowedProjectIds.includes(resource.projectId)) return true;
    if (await parentIssueMatchesTaskBridgeBoundary(resource.parentIssueId, resource.companyId, allowedParentIssueIds)) {
      return true;
    }
    if (resource.parentIssueId && allowedProjectIds.length > 0) {
      const parent = await loadIssue(resource.parentIssueId);
      if (parent?.companyId === resource.companyId && parent.projectId && allowedProjectIds.includes(parent.projectId)) {
        return true;
      }
    }
    return false;
  }

  async function issueMatchesTaskBridgeWriteBoundary(input: {
    actorAgentId: string;
    keyId: string;
    resource: Extract<AuthorizationResource, { type: "issue" }>;
  }) {
    const issue = input.resource.issueId ? await loadIssue(input.resource.issueId) : null;
    const assigneeAgentId = issue?.assigneeAgentId ?? input.resource.assigneeAgentId ?? null;
    if (assigneeAgentId === input.actorAgentId) return true;
    const originKind = issue?.originKind ?? input.resource.originKind ?? null;
    const originId = issue?.originId ?? input.resource.originId ?? null;
    return originKind === "task_bridge" && originId === input.keyId;
  }

  async function decideTaskBridgeAccess(input: {
    actorAgentId: string;
    action: AuthorizationAction;
    resource: AuthorizationResource;
    scope: TaskBridgeAgentKeyScope;
    keyId: string;
  }): Promise<AuthorizationDecision | null> {
    const denyBridge = (explanation: string) =>
      deny({
        action: input.action,
        reason: "deny_scope",
        explanation,
      });
    const allowBridge = (explanation: string) =>
      allow({
        action: input.action,
        reason: "allow_explicit_grant",
        explanation,
      });

    if (
      input.action === "company_scope:read" ||
      input.action === "decision_queue:manage" ||
      input.action === "decision_queue:read" ||
      input.action === "decision_triage:manage" ||
      input.action === "agent:read" ||
      input.action === "agent:wake" ||
      input.action === "project:read" ||
      input.action === "runtime:manage" ||
      input.action === "secrets:read" ||
      input.action === "secrets:propose"
    ) {
      return denyBridge("Task bridge keys cannot use company-wide, peer-agent, project, runtime, or secret APIs.");
    }

    if (input.action === "tasks:assign") {
      if (input.resource.type !== "issue") {
        return denyBridge("Task bridge assignment requires an issue resource.");
      }
      if (!(await issueMatchesTaskBridgeCreateBoundary(input.scope, input.resource))) {
        return denyBridge("Task bridge key is outside its approved parent or project boundary.");
      }
      if (input.resource.assigneeUserId) {
        return denyBridge("Task bridge keys cannot assign work to board users.");
      }
      const allowedAssigneeAgentIds = input.scope.allowedAssigneeAgentIds ?? [];
      if (
        input.resource.assigneeAgentId &&
        input.resource.assigneeAgentId !== input.actorAgentId &&
        !allowedAssigneeAgentIds.includes(input.resource.assigneeAgentId)
      ) {
        return denyBridge("Task bridge key cannot assign work to that agent.");
      }
      return allowBridge("Allowed by task bridge create boundary.");
    }

    if (input.action === "issue:read" || input.action === "issue:comment" || input.action === "issue:mutate") {
      if (input.resource.type !== "issue") {
        return denyBridge("Task bridge issue access requires an issue resource.");
      }
      return await issueMatchesTaskBridgeWriteBoundary({
        actorAgentId: input.actorAgentId,
        keyId: input.keyId,
        resource: input.resource,
      })
        ? allowBridge("Allowed for bridge-created or assigned issue.")
        : denyBridge("Task bridge key can only access assigned or bridge-created issues.");
    }

    return denyBridge("Task bridge key cannot use this API action.");
  }

  function decideSkillTestAccess(input: {
    action: AuthorizationAction;
    resource: AuthorizationResource;
    scope: SkillTestAgentKeyScope;
  }): AuthorizationDecision | null {
    const denySkillTest = (explanation: string) =>
      deny({
        action: input.action,
        reason: "deny_scope",
        explanation,
      });
    const allowSkillTest = (explanation: string) =>
      allow({
        action: input.action,
        reason: "allow_explicit_grant",
        explanation,
      });

    if (
      input.action === "company_scope:read" ||
      input.action === "decision_queue:manage" ||
      input.action === "decision_queue:read" ||
      input.action === "decision_triage:manage" ||
      input.action === "agent:read" ||
      input.action === "agent:wake" ||
      input.action === "project:read" ||
      input.action === "runtime:manage" ||
      input.action === "secrets:read" ||
      input.action === "secrets:propose" ||
      input.action === "tasks:assign"
    ) {
      return denySkillTest("Skill-test run tokens cannot use company-wide, peer-agent, project, runtime, secret, or task-create APIs.");
    }

    if (input.action === "issue:read" || input.action === "issue:comment" || input.action === "issue:mutate") {
      if (input.resource.type !== "issue") {
        return denySkillTest("Skill-test issue access requires an issue resource.");
      }
      return input.resource.issueId === input.scope.issueId
        ? allowSkillTest("Allowed for the scoped skill-test issue.")
        : denySkillTest("Skill-test run token can only access its own harness issue.");
    }

    return denySkillTest("Skill-test run token cannot use this API action.");
  }

  async function assignmentTargetIsInCompany(resource: AuthorizationResource) {
    if (resource.type !== "issue") return true;
    if (resource.assigneeAgentId) {
      const target = await loadAgent(resource.assigneeAgentId);
      return Boolean(
        target &&
        target.companyId === resource.companyId &&
        isSimpleAssignableAgentStatus(target.status),
      );
    }
    if (resource.assigneeUserId) {
      return Boolean(await getActiveMembership(resource.companyId, "user", resource.assigneeUserId));
    }
    return true;
  }

  async function assignmentPolicyEffect(resource: AuthorizationResource): Promise<AssignmentPolicyEffect> {
    if (resource.type !== "issue") return { kind: "none" };

    const checks: Array<Promise<AssignmentPolicyEffect>> = [];
    if (resource.assigneeAgentId) {
      checks.push(
        loadAgent(resource.assigneeAgentId).then((agent) =>
          evaluateAuthorizationPolicyForAssignment(
            readPolicyObject(agent?.permissions, "authorizationPolicy"),
            "Target agent",
          ),
        ),
      );
    }
    if (resource.projectId) {
      checks.push(
        loadProjectAuthorizationPolicy(resource.companyId, resource.projectId).then((policy) =>
          evaluateAuthorizationPolicyForAssignment(policy, "Target project"),
        ),
      );
    }
    if (resource.issueId) {
      checks.push(
        loadIssueAuthorizationPolicy(resource.companyId, resource.issueId).then((policy) =>
          evaluateAuthorizationPolicyForAssignment(policy, "Target issue"),
        ),
      );
    }
    if (resource.parentIssueId && resource.parentIssueId !== resource.issueId) {
      checks.push(
        loadIssueAuthorizationPolicy(resource.companyId, resource.parentIssueId).then((policy) =>
          evaluateAuthorizationPolicyForAssignment(policy, "Parent issue"),
        ),
      );
    }
    if (checks.length === 0) return { kind: "none" };

    const effects = await Promise.all(checks);
    return (
      effects.find((effect) => effect.kind === "unknown") ??
      effects.find((effect) => effect.kind === "blocked") ??
      effects.find((effect) => effect.kind === "restricted") ??
      { kind: "none" }
    );
  }

  async function isManagerOf(companyId: string, managerAgentId: string, assigneeAgentId: string) {
    return isAgentInSubtree(db, companyId, managerAgentId, assigneeAgentId);
  }

  function commentAuthorCanGrantIssueMention(input: {
    mentionedAgentId: string;
    issueAssigneeAgentId: string | null;
    authorAgentId: string | null;
    authorUserId: string | null;
    activeAuthorUserIds: Set<string>;
  }) {
    if (input.authorAgentId) {
      if (input.authorAgentId === input.mentionedAgentId) return false;
      return input.issueAssigneeAgentId === input.authorAgentId;
    }
    if (input.authorUserId) {
      return input.activeAuthorUserIds.has(input.authorUserId);
    }
    return false;
  }

  async function agentHasMentionGrantOnIssue(input: {
    action: AuthorizationAction;
    companyId: string;
    issueId: string;
    issueAssigneeAgentId: string | null;
    actorAgentId: string;
  }) {
    const rows = await db
      .select({
        id: issueComments.id,
        body: issueComments.body,
        authorAgentId: issueComments.authorAgentId,
        authorUserId: issueComments.authorUserId,
      })
      .from(issueComments)
      .where(and(
        eq(issueComments.companyId, input.companyId),
        eq(issueComments.issueId, input.issueId),
        isNull(issueComments.deletedAt),
        sql`${issueComments.body} LIKE ${"%agent://" + input.actorAgentId + "%"}`,
      ));

    const mentionRows = rows.filter((row) => extractAgentMentionIds(row.body).includes(input.actorAgentId));
    const authorUserIds = [...new Set(mentionRows.flatMap((row) => row.authorUserId ? [row.authorUserId] : []))];
    const activeAuthorUserIds = new Set(
      authorUserIds.length === 0
        ? []
        : await db
          .select({ principalId: companyMemberships.principalId })
          .from(companyMemberships)
          .where(and(
            eq(companyMemberships.companyId, input.companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.status, "active"),
            inArray(companyMemberships.principalId, authorUserIds),
          ))
          .then((memberships) => memberships.map((membership) => membership.principalId)),
    );

    for (const row of mentionRows) {
      const authorCanGrant = commentAuthorCanGrantIssueMention({
        mentionedAgentId: input.actorAgentId,
        issueAssigneeAgentId: input.issueAssigneeAgentId,
        authorAgentId: row.authorAgentId,
        authorUserId: row.authorUserId,
        activeAuthorUserIds,
      });
      if (authorCanGrant) {
        logger.info({
          actorAgentId: input.actorAgentId,
          issueId: input.issueId,
          companyId: input.companyId,
          commentId: row.id,
          grantedAction: input.action,
          grant: "issue_mention_comment",
        }, "authorized issue mention-scoped comment grant");
        return true;
      }
    }
    return false;
  }

  function allowIssueMentionGrant(action: AuthorizationAction): AuthorizationDecision {
    return allow({
      action,
      reason: "allow_issue_mention_grant",
      explanation: "Allowed by a mention-scoped issue comment grant.",
    });
  }

  async function decideBase(input: {
    actor: AuthorizationActor;
    action: AuthorizationAction;
    resource: AuthorizationResource;
    scope?: Record<string, unknown> | null;
  }): Promise<AuthorizationDecision> {
    const permissionKey = permissionForAction(input.action);
    const companyId = companyIdForResource(input.resource);

    /**
     * Shared default-open decision for issue write-influence channels.
     *
     * Keep visibility structurally upstream of every standard-trust write so
     * future visibility scoping can be implemented in issue:read without
     * recreating per-action scope checks. The responsible-user ceiling remains
     * in decide(), after this base decision.
     */
    async function decideVisibleIssueWrite(): Promise<AuthorizationDecision> {
      let visibilityResource: AuthorizationResource = input.resource;

      // New-child assignment decisions identify the issue being influenced by
      // parentIssueId. Resolve that parent into the same resource shape used by
      // issue:read so child-create and assign share the visibility hook.
      if (
        input.resource.type === "issue" &&
        !input.resource.issueId &&
        input.resource.parentIssueId
      ) {
        const parent = await loadIssue(input.resource.parentIssueId);
        if (!parent || parent.companyId !== companyId) {
          return deny({
            action: input.action,
            reason: "deny_company_boundary",
            explanation: "The issue write target is not visible in this company.",
          });
        }
        visibilityResource = {
          type: "issue",
          companyId: parent.companyId,
          issueId: parent.id,
          projectId: parent.projectId,
          parentIssueId: parent.parentId,
          assigneeAgentId: parent.assigneeAgentId,
          assigneeUserId: parent.assigneeUserId,
          originKind: parent.originKind,
          originId: parent.originId,
          status: parent.status,
        };
      }

      const visibilityDecision = visibilityResource.type === "issue" && visibilityResource.issueId
        ? await decideBase({
            actor: input.actor,
            action: "issue:read",
            resource: visibilityResource,
            scope: input.scope,
          })
        : await decideBase({
            actor: input.actor,
            action: "company_scope:read",
            resource: { type: "company", companyId },
            scope: input.scope,
          });

      if (!visibilityDecision.allowed) {
        return {
          ...visibilityDecision,
          action: input.action,
          explanation: `Issue write denied because the target is not visible: ${visibilityDecision.explanation}`,
        };
      }

      return allow({
        action: input.action,
        reason: "allow_visible_issue_write",
        explanation: "Allowed by the shared default-open visible-issue write rule.",
      });
    }

    async function decideWithTaskAssignmentGrants(
      principalType: PrincipalType,
      principalId: string,
    ): Promise<AuthorizationDecision> {
      const broadDecision = await decidePrincipalGrant({
        companyId,
        principalType,
        principalId,
        action: input.action,
        permissionKey: "tasks:assign",
        scope: input.scope,
      });
      if (broadDecision.allowed || broadDecision.reason === "deny_missing_membership") return broadDecision;
      const scopedDecision = await decidePrincipalGrant({
        companyId,
        principalType,
        principalId,
        action: input.action,
        permissionKey: "tasks:assign_scope",
        scope: input.scope,
      });
      if (scopedDecision.allowed || broadDecision.reason === "deny_missing_grant") return scopedDecision;
      return broadDecision;
    }

    async function decideWithAgentConfigReadGrant(
      principalType: PrincipalType,
      principalId: string,
    ): Promise<AuthorizationDecision> {
      const configureDecision = await decidePrincipalGrant({
        companyId,
        principalType,
        principalId,
        action: input.action,
        permissionKey: "agents:configure",
        scope: input.scope,
      });
      if (configureDecision.allowed || configureDecision.reason === "deny_missing_membership") {
        return configureDecision;
      }

      const suggestDecision = await decidePrincipalGrant({
        companyId,
        principalType,
        principalId,
        action: input.action,
        permissionKey: "agents:suggest-changes",
        scope: input.scope,
      });
      if (suggestDecision.allowed || suggestDecision.reason === "deny_missing_grant") {
        return suggestDecision;
      }
      return configureDecision;
    }

    async function decideWithProtectedChangeGrants(
      principalType: PrincipalType,
      principalId: string,
      keys: { direct: PermissionKey; suggest: PermissionKey },
    ): Promise<AuthorizationDecision> {
      const directDecision = await decidePrincipalGrant({
        companyId,
        principalType,
        principalId,
        action: input.action,
        permissionKey: keys.direct,
        scope: input.scope,
      });
      if (directDecision.allowed) {
        return allow({
          action: input.action,
          reason: "allow_direct_change",
          explanation: `Allowed by direct change permission ${keys.direct}.`,
          grant: directDecision.grant,
        });
      }
      if (directDecision.reason === "deny_missing_membership") return directDecision;

      const suggestDecision = await decidePrincipalGrant({
        companyId,
        principalType,
        principalId,
        action: input.action,
        permissionKey: keys.suggest,
        scope: input.scope,
      });
      if (suggestDecision.allowed) {
        if (scopeBoolean(input.scope, "consentedChange")) {
          return allow({
            action: input.action,
            reason: "allow_consented_change",
            explanation: `Allowed by suggest permission ${keys.suggest} after accepted change consent.`,
            grant: suggestDecision.grant,
          });
        }
        return deny({
          action: input.action,
          reason: "deny_missing_consent",
          explanation: `Permission ${keys.suggest} requires accepted change consent before applying this mutation.`,
          grant: suggestDecision.grant,
        });
      }
      if (suggestDecision.reason === "deny_missing_membership") return suggestDecision;
      if (directDecision.reason === "deny_scope") return directDecision;
      if (suggestDecision.reason === "deny_scope") return suggestDecision;

      return deny({
        action: input.action,
        reason: "deny_no_grant",
        explanation: `Missing permission: ${keys.direct} or ${keys.suggest}.`,
      });
    }

    async function denyForAssignmentPolicyIfNeeded(
      policyEffect: AssignmentPolicyEffect,
    ): Promise<AuthorizationDecision | null> {
      if (policyEffect.kind === "none" || policyEffect.kind === "restricted") return null;
      return deny({
        action: input.action,
        reason: "deny_policy_restricted",
        explanation: policyEffect.explanation,
      });
    }

    function denyRestrictedAssignmentPolicy(policyEffect: AssignmentPolicyEffect): AuthorizationDecision {
      return deny({
        action: input.action,
        reason: "deny_policy_restricted",
        explanation:
          policyEffect.kind === "restricted"
            ? policyEffect.explanation
            : "Restrictive authorization policy blocks simple company-wide task assignment.",
      });
    }

    if (input.actor.type === "none") {
      return deny({
        action: input.action,
        reason: "deny_unauthenticated",
        explanation: "Authentication required.",
      });
    }

    if (input.actor.type === "board") {
      let taskAssignmentPolicyEffect: AssignmentPolicyEffect | null = null;
      if (input.actor.source === "local_implicit") {
        if (isSaasDeployment()) return deny({
          action: input.action,
          reason: "deny_unauthenticated",
          explanation: "SaaS requires authenticated company authority.",
        });
        return allow({
          action: input.action,
          reason: "allow_local_board",
          explanation: "Allowed because the actor is the local implicit board.",
        });
      }
      // A cloud_tenant actor's computed `isInstanceAdmin` flag is trusted: it
      // can only be set by the attested trusted-header resolver (stack owner +
      // `enableOwnerInstanceAdmin`). The `instance_user_roles` DB lookup stays
      // excluded for cloud_tenant actors, so a stale or hand-inserted
      // instance_admin row left behind by deployments that ran the
      // pre-hardening cloud_tenant path still elevates nothing.
      if (
        !isSaasDeployment() &&
        !input.actor.ignoreInstanceAdmin &&
        (input.actor.isInstanceAdmin ||
          (input.actor.source !== "cloud_tenant" && await isInstanceAdmin(input.actor.userId)))
      ) {
        return allow({
          action: input.action,
          reason: "allow_instance_admin",
          explanation: "Allowed because the actor is an instance admin.",
        });
      }
      // What instance-admin elevation used to give cloud tenant users is
      // replaced by company-scoped visibility: an active membership in the
      // resource company grants the same read surface a same-company agent
      // gets, and non-viewer members may mutate issues inside their company.
      // Cross-company access stays denied.
      if (input.actor.source === "cloud_tenant" && input.actor.userId) {
        const membership = await getActiveMembership(companyId, "user", input.actor.userId);
        if (membership) {
          if (
            input.action === "agent:read" ||
            input.action === "company_scope:read" ||
            input.action === "decision_queue:read" ||
            input.action === "issue:read" ||
            input.action === "project:read"
          ) {
            return allow({
              action: input.action,
              reason: "allow_company_member",
              explanation: "Allowed by active cloud tenant company membership.",
            });
          }
          if (
            (
              input.action === "issue:comment" ||
              input.action === "issue:mutate" ||
              input.action === "decision_queue:manage" ||
              input.action === "decision_triage:manage"
            ) &&
            membership.membershipRole !== "viewer"
          ) {
            return allow({
              action: input.action,
              reason: "allow_company_member",
              explanation: "Allowed by active cloud tenant company membership.",
            });
          }
        }
      }
      if (!input.actor.userId) {
        return deny({
          action: input.action,
          reason: "deny_unauthenticated",
          explanation: "Board user id is required.",
        });
      }
      if (input.action === "tasks:assign") {
        if (!(await assignmentTargetIsInCompany(input.resource))) {
          return deny({
            action: input.action,
            reason: "deny_company_boundary",
            explanation: "Task assignment target agent is not active in the target company.",
          });
        }
        const policyEffect = await assignmentPolicyEffect(input.resource);
        taskAssignmentPolicyEffect = policyEffect;
        const policyDeny = await denyForAssignmentPolicyIfNeeded(policyEffect);
        if (policyDeny) return policyDeny;
        const membership = await getActiveMembership(companyId, "user", input.actor.userId);
        if (policyEffect.kind === "none" && membership && membership.membershipRole !== "viewer") {
          return allow({
            action: input.action,
            reason: "allow_simple_company_member",
            explanation: "Allowed by simple mode company-wide task assignment default.",
          });
        }
      }
      if (input.action === "agent_config:read") {
        return decideWithAgentConfigReadGrant("user", input.actor.userId);
      }
      if (input.action === "agent_config:update") {
        return decideWithProtectedChangeGrants("user", input.actor.userId, {
          direct: "agents:configure",
          suggest: "agents:suggest-changes",
        });
      }
      if (input.action === "skill_config:update") {
        return decideWithProtectedChangeGrants("user", input.actor.userId, {
          direct: "skills:create",
          suggest: "skills:suggest-changes",
        });
      }
      if (!permissionKey) {
        if (input.action === "issue:comment" || input.action === "issue:mutate") {
          if (
            input.resource.type !== "issue" ||
            !input.resource.issueId ||
            typeof input.resource.status !== "string" ||
            input.resource.assigneeAgentId === undefined ||
            input.resource.assigneeUserId === undefined
          ) {
            return deny({
              action: input.action,
              reason: "deny_unsupported_action",
              explanation: `No board permission mapping exists for ${input.action}.`,
            });
          }
          const membership = await getActiveMembership(companyId, "user", input.actor.userId);
          if (membership && membership.membershipRole !== "viewer") {
            return allow({
              action: input.action,
              reason: "allow_simple_company_member",
              explanation: "Allowed by standard same-company board membership issue mutation.",
            });
          }
          if (membership) {
            return deny({
              action: input.action,
              reason: "deny_missing_grant",
              explanation: `Viewer membership does not grant ${input.action}.`,
            });
          }
          return deny({
            action: input.action,
            reason: "deny_missing_membership",
            explanation: `user principal ${input.actor.userId} is not an active member of company ${companyId}.`,
          });
        }
        if (
          input.action === "agent:read" ||
          input.action === "agent:wake" ||
          input.action === "company_scope:read" ||
          input.action === "decision_queue:manage" ||
          input.action === "decision_queue:read" ||
          input.action === "decision_triage:manage" ||
          input.action === "issue:read" ||
          input.action === "project:read" ||
          input.action === "runtime:manage" ||
          input.action === "secrets:read" ||
          input.action === "secrets:propose"
        ) {
          const membership = await getActiveMembership(companyId, "user", input.actor.userId);
          // Mirroring the tasks:assign carve-out above, viewers keep the
          // read-only visibility actions but not the privileged ones.
          const requiresNonViewer =
            input.action === "agent:wake" ||
            input.action === "runtime:manage" ||
            input.action === "secrets:read" ||
            input.action === "decision_queue:manage" ||
            input.action === "decision_triage:manage";
          if (membership && (!requiresNonViewer || membership.membershipRole !== "viewer")) {
            return allow({
              action: input.action,
              reason: "allow_simple_company_member",
              explanation: "Allowed by standard same-company board membership visibility.",
            });
          }
          if (membership) {
            return deny({
              action: input.action,
              reason: "deny_missing_grant",
              explanation: `Viewer membership does not grant ${input.action}.`,
            });
          }
          return deny({
            action: input.action,
            reason: "deny_missing_membership",
            explanation: `user principal ${input.actor.userId} is not an active member of company ${companyId}.`,
          });
        }
        return deny({
          action: input.action,
          reason: "deny_unsupported_action",
          explanation: `No board permission mapping exists for ${input.action}.`,
        });
      }
      if (input.action === "tasks:assign") {
        const grantDecision = await decideWithTaskAssignmentGrants("user", input.actor.userId);
        if (grantDecision.allowed) return grantDecision;
        const policyEffect = taskAssignmentPolicyEffect ?? await assignmentPolicyEffect(input.resource);
        if (policyEffect.kind === "restricted") return denyRestrictedAssignmentPolicy(policyEffect);
        return grantDecision;
      }
      return decidePrincipalGrant({
        companyId,
        principalType: "user",
        principalId: input.actor.userId,
        action: input.action,
        permissionKey,
        scope: input.scope,
      });
    }

    const actorAgentId = input.actor.agentId ?? null;
    if (!actorAgentId) {
      return deny({
        action: input.action,
        reason: "deny_unauthenticated",
        explanation: "Agent authentication required.",
      });
    }
    if (input.actor.companyId !== companyId) {
      return deny({
        action: input.action,
        reason: "deny_company_boundary",
        explanation: "Agent key cannot access another company.",
      });
    }

    const readActorEvidence = readSources && input.actor.runId
      ? await loadReadActorEvidence(input.actor, companyId)
      : undefined;
    const actorAgent = readActorEvidence ? readActorEvidence.agent : await loadAgent(actorAgentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      return deny({
        action: input.action,
        reason: "deny_company_boundary",
        explanation: "Actor agent was not found in the target company.",
      });
    }

    if (input.actor.keyScope?.kind === "skill_test") {
      const skillTestDecision = decideSkillTestAccess({
        action: input.action,
        resource: input.resource,
        scope: input.actor.keyScope,
      });
      if (skillTestDecision) return skillTestDecision;
    }

    if (input.actor.keyScope?.kind === "task_bridge") {
      const keyId = input.actor.keyId ?? null;
      if (!keyId) {
        return deny({
          action: input.action,
          reason: "deny_scope",
          explanation: "Task bridge key context is missing.",
        });
      }
      const taskBridgeDecision = await decideTaskBridgeAccess({
        actorAgentId,
        action: input.action,
        resource: input.resource,
        scope: input.actor.keyScope,
        keyId,
      });
      if (taskBridgeDecision) return taskBridgeDecision;
    }

    const trustResolution = await resolveActorTrust({
      actorAgent,
      actor: input.actor,
      companyId,
      resource: input.resource,
      readActorEvidence,
    });
    const directParentReportTarget =
      input.action === "issue:comment" &&
      await isDirectParentReportTarget({
        actor: input.actor,
        actorAgentId,
        companyId,
        resource: input.resource,
      });
    const lowTrustDecision = await decideLowTrustAccess({
      actorAgentId,
      action: input.action,
      resource: input.resource,
      resolution: trustResolution,
      directParentReportTarget,
    });
    if (lowTrustDecision) {
      if (!lowTrustDecision.allowed) return lowTrustDecision;
      if (
        input.action === "agent:read" ||
        input.action === "agent:wake" ||
        input.action === "company_scope:read" ||
        input.action === "decision_queue:read" ||
        input.action === "issue:comment" ||
        input.action === "issue:read" ||
        input.action === "project:read" ||
        input.action === "runtime:manage" ||
        input.action === "secrets:read" ||
        input.action === "secrets:propose"
      ) {
        return lowTrustDecision;
      }
    }

    const visibleIssueWriteDecision =
      trustResolution.kind === "standard" &&
      (input.action === "issue:comment" || input.action === "issue:mutate")
        ? await decideVisibleIssueWrite()
        : null;
    if (visibleIssueWriteDecision && !visibleIssueWriteDecision.allowed) {
      return visibleIssueWriteDecision;
    }

    if (
      trustResolution.kind === "standard" &&
      input.action === "issue:comment" &&
      directParentReportTarget
    ) {
      return allow({
        action: input.action,
        reason: "allow_direct_parent_report",
        explanation: "Allowed because the target is the current run issue's direct parent under the standard trust preset.",
      });
    }


    if (input.action === "inbox:manage") {
      if (!isSimpleAssignableAgentStatus(actorAgent.status)) {
        return deny({
          action: input.action,
          reason: "deny_missing_membership",
          explanation: "Actor agent is not active in the target company.",
        });
      }
      const responsibleUserId = input.actor.onBehalfOfUserId?.trim() || null;
      const explicitTargetUserId = typeof input.scope?.userId === "string"
        ? input.scope.userId.trim() || null
        : null;
      const targetUserId = explicitTargetUserId ?? responsibleUserId;
      if (!targetUserId) {
        return deny({
          action: input.action,
          reason: "inbox_target_user_unresolved",
          explanation: "Inbox target user could not be resolved from the request or responsible-user context.",
        });
      }

      const targetSnapshot = await loadResponsibleUserSnapshot(companyId, targetUserId);
      if (!targetSnapshot.userExists || !targetSnapshot.activeMembership) {
        return deny({
          action: input.action,
          reason: "deny_missing_membership",
          explanation: `Inbox target user ${targetUserId} is not an active member of company ${companyId}.`,
        });
      }

      const policy = await db
        .select({
          mode: userInboxAgentPolicies.mode,
          allowedAgentIds: userInboxAgentPolicies.allowedAgentIds,
        })
        .from(userInboxAgentPolicies)
        .where(
          and(
            eq(userInboxAgentPolicies.companyId, companyId),
            eq(userInboxAgentPolicies.userId, targetUserId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (targetUserId !== responsibleUserId) {
        // A scoped grant remains an administrative override, including over a
        // disabled user policy. Otherwise, a materialized target-user policy is
        // explicit consent for agents selected in the profile control. The
        // implicit default-open policy remains responsible-user-only so an
        // absent row never becomes a company-wide cross-user grant.
        const grant = await findGrant(companyId, "agent", actorAgentId, "inbox:manage");
        if (grant && (await scopeAllows(db, companyId, grant.scope, { userId: targetUserId }))) {
          return allow({
            action: input.action,
            reason: "allow_explicit_grant",
            explanation: "Allowed by explicit grant inbox:manage.",
            inboxPolicyMode: "grant_override",
            grant: {
              principalType: "agent",
              principalId: actorAgentId,
              permissionKey: "inbox:manage",
              scope: grant.scope ?? null,
            },
          });
        }

        if (policy?.mode === "disabled") {
          return deny({
            action: input.action,
            reason: "inbox_management_disabled",
            explanation: `Inbox management is disabled for user ${targetUserId}.`,
          });
        }
        if (policy?.mode === "allowlist" && !policy.allowedAgentIds.includes(actorAgentId)) {
          return deny({
            action: input.action,
            reason: "inbox_agent_not_allowed",
            explanation: `Agent ${actorAgentId} is not allowed to manage user ${targetUserId}'s inbox.`,
          });
        }
        if (policy?.mode === "open" || policy?.mode === "allowlist") {
          return allow({
            action: input.action,
            reason: "allow_user_inbox_policy",
            inboxPolicyMode: policy.mode,
            explanation: policy.mode === "allowlist"
              ? "Allowed by the target user's inbox agent allowlist."
              : "Allowed by the target user's saved open inbox policy.",
          });
        }

        if (grant) {
          return deny({
            action: input.action,
            reason: "deny_scope",
            explanation: "Permission inbox:manage does not cover the requested user.",
            grant: {
              principalType: "agent",
              principalId: actorAgentId,
              permissionKey: "inbox:manage",
              scope: grant.scope ?? null,
            },
          });
        }
        return deny({
          action: input.action,
          reason: "deny_missing_grant",
          explanation: "Missing permission: inbox:manage.",
        });
      }

      if (policy?.mode === "disabled") {
        return deny({
          action: input.action,
          reason: "inbox_management_disabled",
          explanation: `Inbox management is disabled for user ${targetUserId}.`,
        });
      }
      if (policy?.mode === "allowlist" && !policy.allowedAgentIds.includes(actorAgentId)) {
        return deny({
          action: input.action,
          reason: "inbox_agent_not_allowed",
          explanation: `Agent ${actorAgentId} is not allowed to manage user ${targetUserId}'s inbox.`,
        });
      }

      return allow({
        action: input.action,
        reason: "allow_self",
        inboxPolicyMode: policy?.mode ?? "open",
        explanation: policy?.mode === "allowlist"
          ? "Allowed by the responsible user's inbox agent allowlist."
          : "Allowed by the responsible user's default-open inbox policy.",
      });
    }

    if (
      input.action === "agent:read" ||
      input.action === "company_scope:read" ||
      input.action === "decision_queue:read" ||
      input.action === "issue:read" ||
      input.action === "project:read" ||
      input.action === "runtime:manage" ||
      input.action === "secrets:read" ||
      input.action === "secrets:propose"
    ) {
      return allow({
        action: input.action,
        reason: "allow_company_agent",
        explanation: "Allowed by standard same-company agent visibility.",
      });
    }

    if (input.action === "decision_queue:manage" || input.action === "decision_triage:manage") {
      if (!isSimpleAssignableAgentStatus(actorAgent.status)) {
        return deny({
          action: input.action,
          reason: "deny_missing_membership",
          explanation: "Actor agent is not active in the target company.",
        });
      }
      return allow({
        action: input.action,
        reason: "allow_company_agent",
        explanation: "Allowed for an active standard-scope company agent.",
      });
    }

    if (input.action === "agent:wake" && input.resource.type === "agent" && input.resource.agentId === actorAgentId) {
      return allow({
        action: input.action,
        reason: "allow_self",
        explanation: "Allowed because the actor is waking itself.",
      });
    }

    if (input.action === "tasks:assign") {
      if (!isSimpleAssignableAgentStatus(actorAgent.status)) {
        return deny({
          action: input.action,
          reason: "deny_missing_membership",
          explanation: "Actor agent is not active for simple mode task assignment.",
        });
      }
      if (!(await assignmentTargetIsInCompany(input.resource))) {
        return deny({
          action: input.action,
          reason: "deny_company_boundary",
          explanation: "Task assignment target agent is not active in the target company.",
        });
      }
      const policyEffect = await assignmentPolicyEffect(input.resource);
      const policyDeny = await denyForAssignmentPolicyIfNeeded(policyEffect);
      if (policyDeny) return policyDeny;
      if (policyEffect.kind === "restricted") {
        const grantDecision = await decideWithTaskAssignmentGrants("agent", actorAgentId);
        if (grantDecision.allowed) return grantDecision;
        return denyRestrictedAssignmentPolicy(policyEffect);
      }
      if (trustResolution.kind === "standard") return decideVisibleIssueWrite();
      return allow({
        action: input.action,
        reason: "allow_simple_company_member",
        explanation: "Allowed by the existing bounded task assignment rule.",
      });
    }

    if (input.action === "issue:comment" || input.action === "issue:mutate") {
      const resource = input.resource.type === "issue" ? input.resource : null;
      if (resource?.assigneeAgentId === actorAgentId) {
        return allow({
          action: input.action,
          reason: "allow_self",
          explanation: "Allowed because the actor owns the assigned issue.",
        });
      }
      if (!resource?.assigneeAgentId) {
        return allow({
          action: input.action,
          reason: "allow_company_agent",
          explanation: "Allowed because the issue has no agent assignee.",
        });
      }
      if (
        input.action === "issue:comment" &&
        resource?.issueId &&
        await agentHasMentionGrantOnIssue({
          action: input.action,
          companyId,
          issueId: resource.issueId,
          issueAssigneeAgentId: resource.assigneeAgentId ?? null,
          actorAgentId,
        })
      ) {
        return allowIssueMentionGrant(input.action);
      }
      if (visibleIssueWriteDecision) return visibleIssueWriteDecision;
    }
    if (
      input.action === "agent_config:update" &&
      input.resource.type === "agent" &&
      input.resource.agentId === actorAgentId &&
      !scopeBoolean(input.scope, "requiresChangeGrant")
    ) {
      return allow({
        action: input.action,
        reason: "allow_self",
        explanation: "Allowed because the actor is updating its own agent configuration.",
      });
    }

    if (input.action === "agent_config:read") {
      if (input.resource.type === "agent" && input.resource.agentId === actorAgentId) {
        return allow({
          action: input.action,
          reason: "allow_self",
          explanation: "Allowed because the actor is reading its own agent configuration.",
        });
      }
      return decideWithAgentConfigReadGrant("agent", actorAgentId);
    }

    if (input.action === "agent_config:update") {
      return decideWithProtectedChangeGrants("agent", actorAgentId, {
        direct: "agents:configure",
        suggest: "agents:suggest-changes",
      });
    }

    if (input.action === "skill_config:update") {
      return decideWithProtectedChangeGrants("agent", actorAgentId, {
        direct: "skills:create",
        suggest: "skills:suggest-changes",
      });
    }

    if (permissionKey) {
      const grantDecision = await decidePrincipalGrant({
        companyId,
        principalType: "agent",
        principalId: actorAgentId,
        action: input.action,
        permissionKey,
        scope: input.scope,
      });
      if (grantDecision.allowed) return grantDecision;
    }

    if (input.action === "agents:create" && canCreateAgentsLegacy(actorAgent)) {
      return allow({
        action: input.action,
        reason: "allow_legacy_agent_creator",
        explanation: "Allowed by legacy agent creator authority.",
      });
    }

    // Active-checkout management deliberately does not ride on
    // canCreateAgents: that flag is default-on for standard-trust agents, and
    // coupling would let any peer write over another agent's checked-out
    // issue. CEOs, explicit grants, and the manager chain remain the paths.
    if (input.action === "tasks:manage_active_checkouts" && actorAgent.role === "ceo") {
      return allow({
        action: input.action,
        reason: "allow_legacy_agent_creator",
        explanation: "Allowed by legacy agent creator authority.",
      });
    }

    if (
      input.action === "tasks:manage_active_checkouts" &&
      input.resource.type === "issue" &&
      input.resource.assigneeAgentId &&
      await isManagerOf(companyId, actorAgentId, input.resource.assigneeAgentId)
    ) {
      return allow({
        action: input.action,
        reason: "allow_manager_chain",
        explanation: "Allowed because the actor manages the issue assignee in the reporting chain.",
      });
    }

    return deny({
      action: input.action,
      reason: "deny_missing_grant",
      explanation: permissionKey
        ? `Missing permission: ${permissionKey}.`
        : `No agent permission mapping exists for ${input.action}.`,
    });
  }

  async function applyResponsibleUserIntersection(
    input: {
      actor: AuthorizationActor;
      action: AuthorizationAction;
      resource: AuthorizationResource;
      scope?: Record<string, unknown> | null;
      enforceResponsibleUserIntersection?: boolean;
    },
    agentDecision: AuthorizationDecision,
  ): Promise<AuthorizationDecision> {
    const responsibleUserId = input.actor.onBehalfOfUserId?.trim();
    if (
      input.actor.type !== "agent" ||
      input.action === "inbox:manage" ||
      !responsibleUserId ||
      !agentDecision.allowed
    ) {
      return agentDecision;
    }

    const companyId = companyIdForResource(input.resource);
    // Repeated decisions can follow row/operation lock waits on the same actor.
    // Only current native account and membership rows supply Human authority.
    const snapshot = await loadResponsibleUserSnapshot(companyId, responsibleUserId);
    const denyCode: AuthorizationDecision["code"] =
      snapshot.userExists && snapshot.activeMembership
        ? "RESPONSIBLE_USER_UNAUTHORIZED"
        : "RESPONSIBLE_USER_UNAVAILABLE";

    if (
      activeResponsibleUserCanAuthorizeAgentGrantedSkillChange(
        input.action,
        snapshot.activeMembership,
        agentDecision,
        input.actor.agentId,
      )
    ) {
      // Skill mutations are governed by the agent's explicit skill-change
      // grant. The responsible-user intersection still requires an active
      // non-viewer user, but does not require duplicating that grant on the
      // responsible user's board account for standard heartbeat JWTs.
      return agentDecision;
    }

    const userDecision = snapshot.userExists && snapshot.activeMembership
      ? await decideBase({
          ...input,
          actor: {
            type: "board",
            userId: responsibleUserId,
            companyIds: [companyId],
            memberships: [snapshot.activeMembership],
            isInstanceAdmin: false,
            ignoreInstanceAdmin: true,
            source: "session",
          },
        })
      : deny({
          action: input.action,
          reason: "deny_missing_membership",
          explanation: `Responsible user ${responsibleUserId} is unavailable for company ${companyId}.`,
        });

    if (
      !userDecision.allowed &&
      userDecision.reason === "deny_unsupported_action" &&
      activeResponsibleUserCanAuthorizeIssueAction(input.action, snapshot.activeMembership)
    ) {
      return agentDecision;
    }

    if (userDecision.allowed) return agentDecision;

    const denied = deny({
      action: input.action,
      reason: userDecision.reason,
      code: denyCode,
      explanation:
        denyCode === "RESPONSIBLE_USER_UNAVAILABLE"
          ? `Responsible user ${responsibleUserId} is unavailable for company ${companyId}.`
          : `Responsible user ${responsibleUserId} is not authorized for ${input.action}: ${userDecision.explanation}`,
      grant: userDecision.grant,
    });

    logger.warn({
      authzMode: !input.enforceResponsibleUserIntersection && responsibleUserAuthzShadowMode() ? "shadow" : "enforce",
      code: denied.code,
      reason: userDecision.reason,
      action: input.action,
      resourceType: input.resource.type,
      companyId,
      actorAgentId: input.actor.agentId ?? null,
      responsibleUserId,
    }, "responsible-user authorization intersection denied");

    return !input.enforceResponsibleUserIntersection && responsibleUserAuthzShadowMode() ? agentDecision : denied;
  }

  // This path is created only by the same-company native Source callback.
  // Row locks qualify the original canonical loaders; they do not grant access.
  // NOWAIT avoids reversing account erasure / Agent lifecycle lock ordering.
  async function pinReadSourceActor(actor: AuthorizationActor, companyId: string): Promise<AuthorizationActor | null> {
    const expiresAt = actor.authenticatedCredentialExpiresAt;
    if (expiresAt != null) {
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
      if (readSources) readSources.credentialExpiresAt = Math.min(readSources.credentialExpiresAt ?? Infinity, expiresAt);
    }
    if (actor.type === "board" && actor.source === "local_implicit") return actor;
    if (actor.type === "board") {
      const current = await pinCurrentBoardActor(db, actor);
      if (!current) return null;
      if (current.credentialExpiresAt !== null && readSources)
        readSources.credentialExpiresAt = Math.min(readSources.credentialExpiresAt ?? Infinity, current.credentialExpiresAt);
      return current.actor;
    }
    if (actor.type !== "agent" || !actor.agentId || actor.companyId !== companyId || !actor.onBehalfOfUserId?.trim()) return null;
    const agent = await loadAgent(actor.agentId);
    if (!agent || agent.companyId !== companyId) return null;
    if (actor.runId) {
      const [run] = await db.select({ companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId, responsibleUserId: heartbeatRuns.responsibleUserId })
        .from(heartbeatRuns).where(eq(heartbeatRuns.id, actor.runId)).for("share", { noWait: true });
      if (!run || run.companyId !== companyId || run.agentId !== actor.agentId || run.responsibleUserId !== actor.onBehalfOfUserId) return null;
    }
    let keyScope = actor.keyScope;
    if (actor.keyId) {
      const [key] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, actor.keyId)).for("share", { noWait: true });
      if (!key || key.keyHash !== actor.authenticatedKeyHash || key.companyId !== companyId || key.agentId !== actor.agentId || key.revokedAt || key.responsibleUserId !== actor.onBehalfOfUserId) return null;
      const parsed = agentApiKeyScopeSchema.safeParse(key.scopeConfig ?? { kind: "standard" });
      if (!parsed.success) return null;
      // Keep the original authenticated request ceiling after Source row waits;
      // a newly broader persisted credential cannot widen this request.
      if (keyScope != null && !isDeepStrictEqual(agentApiKeyScopeSchema.parse(keyScope), parsed.data)) return null;
      keyScope = parsed.data;
    } else if (actor.source === "agent_key" || !actor.runId) return null;
    if (keyScope != null) {
      const parsed = agentApiKeyScopeSchema.safeParse(keyScope);
      if (!parsed.success) return null;
      keyScope = parsed.data;
    }
    return { ...actor, keyScope };
  }

  async function decide(input: {
    actor: AuthorizationActor;
    action: AuthorizationAction;
    resource: AuthorizationResource;
    scope?: Record<string, unknown> | null;
    enforceResponsibleUserIntersection?: boolean;
  }): Promise<AuthorizationDecision> {
    if (readSources) {
      if (!readSources.active) throw new Error("Native Source read scope has ended");
      const foundationRead = input.action === "foundation:read" && input.resource.type === "company" && is(db, PgTransaction)
        && (!input.scope || Object.keys(input.scope).length === 0);
      const companySearchRead = readSources.purpose === "company_search" && input.action === "company_scope:read"
        && input.resource.type === "company" && (!input.scope || Object.keys(input.scope).length === 0);
      const contextInspectionRead = readSources.purpose === "context_inspection" && (
        input.action === "company_scope:read" && input.resource.type === "company" && (!input.scope || Object.keys(input.scope).length === 0)
        || input.action === "agent:read" && input.resource.type === "agent" && input.resource.agentId === readSources.agentId
        || input.action === "issue:read" || input.action === "project:read" || foundationRead
      );
      const routineSourceRead = readSources.purpose === "routine_sources" && input.action === "company_scope:read"
        && input.resource.type === "company" && (!input.scope || Object.keys(input.scope).length === 0);
      const workflowSourceRead = (readSources.purpose === "workflow_sources" || readSources.purpose === "workflow_task_candidates") && input.action === "company_scope:read"
        && input.resource.type === "company" && (!input.scope || Object.keys(input.scope).length === 0);
      const routineAgentRead = readSources.purpose === "routine_sources" && input.action === "agent:read"
        && input.resource.type === "agent" && Boolean(input.resource.agentId && readSources.routineAgentIds?.has(input.resource.agentId));
      const routineIssueRead = readSources.purpose === "routine_sources" && input.action === "issue:read"
        && input.resource.type === "issue" && Boolean(input.resource.issueId && readSources.issues.has(input.resource.issueId));
      const readScopeAllows = readSources.purpose === "company_search" ? companySearchRead
        : readSources.purpose === "context_inspection" ? contextInspectionRead
          : readSources.purpose === "routine_sources" ? routineSourceRead || routineAgentRead || routineIssueRead
            : readSources.purpose === "workflow_sources" || readSources.purpose === "workflow_task_candidates" ? workflowSourceRead
            : (["issue:read", "project:read"].includes(input.action) || foundationRead);
      if (companyIdForResource(input.resource) !== readSources.companyId || !readScopeAllows) {
        return deny({ action: input.action, reason: "deny_scope", explanation: "This native Source row scope admits same-company reads only." });
      }
    }
    if (input.actor.type === "agent" && input.actor.keyScope != null && !agentApiKeyScopeSchema.safeParse(input.actor.keyScope).success) {
      return deny({ action: input.action, reason: "deny_scope", explanation: "Agent credential scope is unavailable." });
    }
    if (readSources && is(db, PgTransaction)) {
      if (input.action === "issue:read") {
        const row = input.resource.type === "issue" && input.resource.issueId
          ? readSources.issues.get(input.resource.issueId) : null;
        if (!row || (row.projectId && !readSources.projects.get(row.projectId)))
          return deny({ action: input.action, reason: "deny_scope", explanation: "Task is outside the captured native Source rows." });
      }
      if (input.action === "project:read" && (input.resource.type !== "project" || !input.resource.projectId
        || !readSources.projects.get(input.resource.projectId)))
        return deny({ action: input.action, reason: "deny_scope", explanation: "Project is outside the captured native Source rows." });
      if (!sourceAuthorityPins) {
        try { return await createAuthorizationService(db, readSources, true).decide(input); }
        catch (error) {
          let cause: unknown = error;
          for (let depth = 0; cause && typeof cause === "object" && depth < 8; depth++, cause = (cause as { cause?: unknown }).cause) {
            if ((cause as { code?: unknown }).code === "55P03") throw conflict("Native Source authority is busy.", { code: "native_source_authority_busy" });
          }
          throw error;
        }
      }
      // Credential-free server actors keep their original canonical policy.
      // A source label alone does not prove an HTTP credential was verified.
      const credential = input.actor.keyId != null || input.actor.authenticatedKeyHash != null
        || input.actor.authenticatedCredentialExpiresAt != null || input.actor.sessionId != null || input.actor.source === "board_key";
      if (input.action === "foundation:read" || readSources.purpose === "company_search" || readSources.purpose === "workflow_sources"
        || readSources.purpose === "workflow_task_candidates" || credential) {
        const actor = await pinReadSourceActor(input.actor, readSources.companyId);
        if (!actor) return deny({ action: input.action, reason: "deny_unauthenticated", explanation: "Current native Source principal is unavailable." });
        readSources.credentialUserId = actor.type === "board" ? actor.userId ?? null
          : actor.type === "agent" ? actor.onBehalfOfUserId ?? null : null;
        input = { ...input, actor, enforceResponsibleUserIntersection: true };
      }
    }
    // A V5 run remains subject to strict human intersection even during a
    // rollout rollback or while legacy authorization runs in shadow mode.
    if (!input.enforceResponsibleUserIntersection && responsibleUserAuthzShadowMode()
      && input.actor.type === "agent" && input.actor.runId && input.actor.agentId) {
      const [manifest] = await db.select({ id: agentExecutionManifests.id }).from(agentExecutionManifests)
        .where(and(eq(agentExecutionManifests.runId, input.actor.runId), eq(agentExecutionManifests.companyId, input.resource.companyId!), eq(agentExecutionManifests.agentId, input.actor.agentId))).limit(1);
      if (manifest) input = { ...input, enforceResponsibleUserIntersection: true };
    }
    const agentDecision = await decideBase(input);
    let decision = await applyResponsibleUserIntersection(input, agentDecision);
    if (decision.allowed && input.resource.type === "issue") {
      const issueId = input.resource.issueId ?? input.resource.parentIssueId;
      if (issueId && !(await canActorReadIssuePrivacy(db, input.actor, { id: issueId, companyId: input.resource.companyId }))) {
        decision = deny({ action: input.action, reason: "deny_issue_private", explanation: "Task source access is unavailable." });
      }
      if (decision.allowed && input.resource.projectId && !input.resource.issueId &&
        !(await canActorReadProjectPrivacy(db, input.actor, { id: input.resource.projectId, companyId: input.resource.companyId }))) {
        decision = deny({ action: input.action, reason: "deny_project_private", explanation: "Project source access is unavailable." });
      }
    }
    if (decision.allowed && input.action === "project:read" && input.resource.type === "project" && input.resource.projectId &&
      !(await canActorReadProjectPrivacy(db, input.actor, { id: input.resource.projectId, companyId: input.resource.companyId }))) {
      decision = deny({ action: input.action, reason: "deny_project_private", explanation: "Project source access is unavailable." });
    }
    if (readSources && !readSources.active) throw new Error("Native Source read scope has ended");
    return decision;
  }

  return {
    decide,
    decidePrincipalGrant,
    withReadSources,
    assertTaskPrivacyBatch,
    withReadCompany,
    withReadRoutineSources,
    withReadWorkflowSources,
    withReadWorkflowTaskCandidates,
    withReadContextInspection,
  };
}
