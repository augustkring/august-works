/** Bounded, read-only member continuity preview. It uses the existing native
 * responsibility readers for current visibility/version checks; this module
 * never returns resource or credential identifiers and never blocks removal. */
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  agentApiKeys, aiUseCases, approvals, billingAccountCompanies, billingAccounts,
  authUsers, businessExperimentVersions, businessExperiments, businessMetricVersions, businessMetrics,
  companies, companyAgentPackageInstallations, companyMemberships, connectionGrants,
  decisions, issues, routines, toolApplications, toolConnections, toolPolicies,
  supportCases, workflowRuns, workflows, type Db,
} from "@paperclipai/db";
import type { AuthorizationActor, AuthorizationAction } from "../../authorization.js";
import { authorizationService } from "../../authorization.js";
import { agentService } from "../../agents.js";
import { toolAccessService } from "../../tool-access.js";
import { nativeSha256 } from "../../native-runtime/canonical.js";
import { forbidden, notFound } from "../../../errors.js";
import { nativeResponsibilityMetadataSources, responsibilitySourceVersion } from "./native-metadata-sources.js";
import { bindNativeResponsibilityReaders } from "./native-reader-ports.js";
import { bindKnownNativeResponsibilityPorts } from "./native-reader-adapters.js";
import { responsibilityPolicySubject, canSubjectPerformNativeRead } from "./native-subject-policy.js";
import type { ResponsibilityScanKind } from "./responsibility-scan.js";

const PAGE_LIMIT = 40;
const TOTAL_READ_LIMIT = 120;
type PreflightClass = "MUST_REASSIGN" | "CAN_FALL_BACK_TO_AUTHORIZED_GROUP" |
  "CAN_BE_UNOWNED_TEMPORARILY" | "MUST_REVOKE";
type Candidate = { kind: ResponsibilityScanKind; id: string; version: string };
type VisibleItem = { kind: ResponsibilityScanKind | "credentials"; classification: PreflightClass; count: number; sourceVersion: string; freshness: "current" };
export type MemberContinuityPreflight = {
  generatedAt: string;
  freshness: "current" | "unknown";
  coverage: "currently_authorized_subset";
  items: VisibleItem[];
};

const actionAllowed = async (db: Db, userId: string, companyId: string, action: AuthorizationAction) =>
  canSubjectPerformNativeRead({ db, companyId, userId, action, resource: { type: "company", companyId } });

async function currentHumanMember(db: Db, companyId: string, membershipId: string, userId: string) {
  const [member] = await db.select({ principalId: companyMemberships.principalId })
    .from(companyMemberships).innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, membershipId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId),
      eq(companyMemberships.status, "active"), eq(authUsers.emailVerified, true))).limit(1);
  return Boolean(member);
}

async function currentViewerAuthority(db: Db, companyId: string, userId: string) {
  return await currentHumanMemberByUserId(db, companyId, userId) &&
    await actionAllowed(db, userId, companyId, "company_scope:read") &&
    await actionAllowed(db, userId, companyId, "users:manage_permissions");
}

async function currentHumanMemberByUserId(db: Db, companyId: string, userId: string) {
  const [member] = await db.select({ id: companyMemberships.id }).from(companyMemberships)
    .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"),
      eq(authUsers.emailVerified, true))).limit(1);
  return Boolean(member);
}

function sourceVersion(kind: ResponsibilityScanKind, id: string, updatedAt: Date) {
  return responsibilitySourceVersion(kind, id, updatedAt);
}

/** The route has already checked the target membership and caller permission.
 * Bounds prevent the ordinary removal UI from becoming a long inventory job;
 * an unknown freshness bit is deliberately global and has no kind/count data. */
export async function readMemberContinuityPreflight(input: {
  db: Db;
  actor: AuthorizationActor;
  companyId: string;
  memberId: string;
  operatorUserIds?: readonly string[];
  now?: Date;
}): Promise<MemberContinuityPreflight> {
  const { db, actor, companyId, memberId } = input;
  const now = input.now ?? new Date();
  if (actor.type !== "board" || !actor.userId || actor.source !== "session") {
    throw forbidden("A current Human session is required for member continuity preview.");
  }
  if (!await currentViewerAuthority(db, companyId, actor.userId)) {
    throw forbidden("Current company member-management permission is required.");
  }
  const [member] = await db.select({ principalId: companyMemberships.principalId })
    .from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, memberId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.status, "active"))).limit(1);
  if (!member || !await currentHumanMember(db, companyId, memberId, member.principalId))
    throw notFound("Active verified Human member not found");
  const userId = member.principalId;
  const [company] = await db.select({ id: companies.id, defaultResponsibleUserId: companies.defaultResponsibleUserId,
    securityContactUserId: companies.securityContactUserId, supportIncidentContactUserId: companies.supportIncidentContactUserId,
    updatedAt: companies.updatedAt }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw notFound("Company not found");

  const candidates: Candidate[] = [];
  // The viewer-bound candidate queries are intentionally only an authorized
  // subset. Never let hidden row counts, scan caps, or ACL-denied reads change
  // a caller-visible freshness/overflow bit. Per-item versions below remain
  // current when the native reader proves them; the overall inventory is
  // conservatively incomplete for every caller.
  const add = (kind: ResponsibilityScanKind, rows: readonly { id: string; updatedAt: Date }[]) => {
    for (const row of rows.slice(0, PAGE_LIMIT)) candidates.push({ kind, id: row.id, version: sourceVersion(kind, row.id, row.updatedAt) });
  };
  const addVersions = (kind: ResponsibilityScanKind, rows: readonly { id: string; sourceVersion: string }[]) => {
    for (const row of rows.slice(0, PAGE_LIMIT)) candidates.push({ kind, id: row.id, version: row.sourceVersion });
  };

  // Native ownership columns and current native statuses identify direct-owner
  // candidates. IDs remain local and each candidate is rechecked below.
  add("routine", await db.select({ id: routines.id, updatedAt: routines.updatedAt }).from(routines).where(and(
    eq(routines.companyId, companyId), eq(routines.responsibleUserId, userId), inArray(routines.status, ["active", "paused"]),
  )).orderBy(routines.id).limit(PAGE_LIMIT + 1));
  add("workflow_run", await db.select({ id: workflowRuns.id, updatedAt: workflowRuns.updatedAt }).from(workflowRuns).where(and(
    eq(workflowRuns.companyId, companyId), eq(workflowRuns.responsibleUserId, userId),
    inArray(workflowRuns.status, ["queued", "running", "waiting", "recovering", "cancelling"]),
  )).orderBy(workflowRuns.id).limit(PAGE_LIMIT + 1));
  add("connector", await db.select({ id: toolConnections.id, updatedAt: toolConnections.updatedAt }).from(toolConnections)
    .innerJoin(toolApplications, and(eq(toolApplications.companyId, toolConnections.companyId), eq(toolApplications.id, toolConnections.applicationId)))
    .where(and(eq(toolConnections.companyId, companyId), eq(toolApplications.ownerUserId, userId), eq(toolConnections.status, "active"),
      eq(toolConnections.enabled, true))).orderBy(toolConnections.id).limit(PAGE_LIMIT + 1));
  add("metric", await db.select({ id: businessMetrics.id, updatedAt: businessMetrics.updatedAt }).from(businessMetrics)
    .innerJoin(businessMetricVersions, and(eq(businessMetricVersions.companyId, businessMetrics.companyId),
      eq(businessMetricVersions.metricId, businessMetrics.id), eq(businessMetricVersions.id, businessMetrics.publishedVersionId)))
    .where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.status, "published"),
      sql`${businessMetricVersions.definition}->>'ownerUserId' = ${userId}`)).orderBy(businessMetrics.id).limit(PAGE_LIMIT + 1));
  add("experiment", await db.select({ id: businessExperiments.id, updatedAt: businessExperiments.updatedAt }).from(businessExperiments)
    .innerJoin(businessExperimentVersions, and(eq(businessExperimentVersions.companyId, businessExperiments.companyId),
      eq(businessExperimentVersions.experimentId, businessExperiments.id), eq(businessExperimentVersions.id, businessExperiments.currentVersionId)))
    .where(and(eq(businessExperiments.companyId, companyId), inArray(businessExperiments.state,
      ["in_review", "ready", "running", "paused", "analyzing"]),
      sql`${businessExperimentVersions.definition}->>'ownerUserId' = ${userId}`)).orderBy(businessExperiments.id).limit(PAGE_LIMIT + 1));
  add("decision", await db.select({ id: decisions.id, updatedAt: decisions.updatedAt }).from(decisions)
    .innerJoin(issues, and(eq(issues.companyId, decisions.companyId), eq(issues.id, decisions.originIssueId)))
    .where(and(eq(decisions.companyId, companyId), eq(decisions.status, "open"), gt(decisions.expiresAt, now),
      eq(issues.responsibleUserId, userId))).orderBy(decisions.id).limit(PAGE_LIMIT + 1));
  add("ai_use_case", await db.select({ id: aiUseCases.id, updatedAt: aiUseCases.updatedAt }).from(aiUseCases).where(and(
    eq(aiUseCases.companyId, companyId), eq(aiUseCases.ownerUserId, userId), sql`${aiUseCases.status} <> 'retired'`,
  )).orderBy(aiUseCases.id).limit(PAGE_LIMIT + 1));
  add("deployment", await db.select({ id: companyAgentPackageInstallations.id, updatedAt: companyAgentPackageInstallations.updatedAt })
    .from(companyAgentPackageInstallations).innerJoin(aiUseCases, and(eq(aiUseCases.companyId, companyAgentPackageInstallations.companyId),
      eq(aiUseCases.id, companyAgentPackageInstallations.aiUseCaseId)))
    .where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(aiUseCases.ownerUserId, userId),
      inArray(companyAgentPackageInstallations.status, ["active", "readiness_blocked", "degraded", "needs_update"])))
    .orderBy(companyAgentPackageInstallations.id).limit(PAGE_LIMIT + 1));
  add("billing", await db.select({ id: billingAccounts.id, updatedAt: billingAccounts.updatedAt }).from(billingAccountCompanies)
    .innerJoin(billingAccounts, and(eq(billingAccounts.id, billingAccountCompanies.billingAccountId), eq(billingAccounts.payerUserId, userId)))
    .where(and(eq(billingAccountCompanies.companyId, companyId), eq(billingAccountCompanies.status, "active"),
      eq(billingAccounts.status, "active"), isNull(billingAccounts.closedAt))).orderBy(billingAccounts.id).limit(PAGE_LIMIT + 1));
  // A case opener is only a requester, never a responder. This candidate is
  // retained solely so the native customer getter can either prove the viewer
  // may see it and the configured operator group can continue, or hide it.
  add("support_case", await db.select({ id: supportCases.id, updatedAt: supportCases.updatedAt }).from(supportCases).where(and(
    eq(supportCases.companyId, companyId), eq(supportCases.openedByUserId, userId),
    inArray(supportCases.customerStatus, ["RECEIVED", "INVESTIGATING", "WORKING_ON_IT", "WAITING_FOR_YOU"]),
  )).orderBy(supportCases.id).limit(PAGE_LIMIT + 1));
  if (company.securityContactUserId === userId) add("security_contact", [{ id: companyId, updatedAt: company.updatedAt }]);
  if (company.supportIncidentContactUserId === userId) add("support_incident_contact", [{ id: companyId, updatedAt: company.updatedAt }]);

  // Some native responsibilities have no individual owner column: the
  // configured company default is their canonical current responsible Human.
  // Reuse 0565's metadata pages and native getters; never report page overflow
  // or an inaccessible source kind to the caller.
  if (company.defaultResponsibleUserId === userId) {
    const defaultKinds: ResponsibilityScanKind[] = ["agent", "workflow", "approval", "tool_policy", "skill_policy"];
    const sources = nativeResponsibilityMetadataSources(db);
    for (const kind of defaultKinds) {
      const source = sources.find(item => item.kind === kind);
      if (!source) continue;
      try {
        const page = await source.readPage(companyId, null, PAGE_LIMIT);
        addVersions(kind, page.pointers.map(pointer => ({ id: pointer.id, sourceVersion: pointer.sourceVersion })));
      } catch { /* The constant incomplete result already covers source failure. */ }
    }
  }

  // Do not return candidates from a direct ownership query until the real
  // viewer can currently read each object through its existing native service.
  const nativeReaders = bindNativeResponsibilityReaders(bindKnownNativeResponsibilityPorts(db, input.operatorUserIds ?? []));
  const policyViewer = responsibilityPolicySubject(actor.userId);
  const readerByKind = new Map<ResponsibilityScanKind, (typeof nativeReaders)[number]>();
  for (const reader of nativeReaders) readerByKind.set(reader.kind, reader);
  const visible = new Map<ResponsibilityScanKind, Array<[string, string, PreflightClass]>>();
  const seen = new Set<string>();
  let inspected = 0;
  for (const candidate of candidates) {
    const identity = `${candidate.kind}\0${candidate.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (inspected++ >= TOTAL_READ_LIMIT) break;
    try {
      const reader = readerByKind.get(candidate.kind);
      if (!reader) continue;
      const current = await reader.inspectCurrent(policyViewer, companyId, candidate.id);
      if (current.state !== "visible") continue;
      if (current.currentSourceVersion !== candidate.version) continue;
      const classification: PreflightClass = current.classification === "CAN_BE_UNOWNED_TEMPORARILY"
        ? "CAN_BE_UNOWNED_TEMPORARILY" : current.classification === "CAN_FALL_BACK_TO_AUTHORIZED_GROUP"
          ? "CAN_FALL_BACK_TO_AUTHORIZED_GROUP" : "MUST_REASSIGN";
      const rows = visible.get(candidate.kind) ?? [];
      rows.push([candidate.id, current.currentSourceVersion, classification]);
      visible.set(candidate.kind, rows);
    } catch { /* A failed or denied native getter adds no visible evidence. */ }
  }

  const items: VisibleItem[] = [];
  for (const [kind, rows] of visible) {
    const byClass = new Map<PreflightClass, Array<[string, string]>>();
    for (const [id, version, classification] of rows) {
      const bucket = byClass.get(classification) ?? [];
      bucket.push([id, version]); byClass.set(classification, bucket);
    }
    for (const [classification, entries] of byClass) {
      items.push({ kind, classification, count: entries.length,
        sourceVersion: nativeSha256(entries.sort(([a], [b]) => a.localeCompare(b))), freshness: "current" });
    }
  }

  // Company-scoped credentials receive MUST_REVOKE only when the viewer also
  // holds the corresponding native management permission. Never return key,
  // grant, secret, or agent identifiers.
  const credentialFingerprints: string[] = [];
  try {
    const keyRows = await db.select({ id: agentApiKeys.id, agentId: agentApiKeys.agentId, createdAt: agentApiKeys.createdAt })
      .from(agentApiKeys).where(and(eq(agentApiKeys.companyId, companyId), eq(agentApiKeys.responsibleUserId, userId), isNull(agentApiKeys.revokedAt)))
      .orderBy(asc(agentApiKeys.id)).limit(PAGE_LIMIT + 1);
    for (const key of keyRows.slice(0, PAGE_LIMIT)) {
      const [currentKey] = await db.select({ createdAt: agentApiKeys.createdAt }).from(agentApiKeys)
        .where(and(eq(agentApiKeys.companyId, companyId), eq(agentApiKeys.id, key.id),
          eq(agentApiKeys.responsibleUserId, userId), isNull(agentApiKeys.revokedAt))).limit(1);
      if (!currentKey || currentKey.createdAt.getTime() !== key.createdAt.getTime() ||
        !await authorizationService(db).decide({ actor: policyViewer, action: "agents:configure",
        resource: { type: "agent", companyId, agentId: key.agentId } }).then(decision => decision.allowed)) continue;
      const current = await agentService(db).getById(key.agentId);
      if (!current || current.companyId !== companyId) continue;
      credentialFingerprints.push(nativeSha256(["agent_api_key", key.id, key.createdAt.toISOString()]));
    }
    if (await actionAllowed(db, actor.userId, companyId, "tools:manage_connections")) {
      const grants = await db.select({ id: connectionGrants.id, connectionId: connectionGrants.connectionId,
        updatedAt: connectionGrants.updatedAt }).from(connectionGrants)
        .where(and(eq(connectionGrants.companyId, companyId), eq(connectionGrants.kind, "user"),
          eq(connectionGrants.subjectUserId, userId), eq(connectionGrants.status, "active")))
        .orderBy(asc(connectionGrants.id)).limit(PAGE_LIMIT + 1);

      for (const grant of grants.slice(0, PAGE_LIMIT)) {
        if (!await actionAllowed(db, actor.userId, companyId, "tools:manage_connections")) break;
        try { await toolAccessService(db).getConnection(grant.connectionId, companyId, actor.userId); }
        catch { continue; }
        const [current] = await db.select({ updatedAt: connectionGrants.updatedAt }).from(connectionGrants).where(and(
          eq(connectionGrants.companyId, companyId), eq(connectionGrants.id, grant.id), eq(connectionGrants.kind, "user"),
          eq(connectionGrants.subjectUserId, userId), eq(connectionGrants.status, "active"),
        )).limit(1);
        if (current?.updatedAt.getTime() === grant.updatedAt.getTime())
          credentialFingerprints.push(nativeSha256(["connection_grant", grant.id, current.updatedAt.toISOString()]));
      }
    }
  } catch {
    // A failed credential source contributes no visible evidence.
  }
  if (credentialFingerprints.length) items.push({ kind: "credentials", classification: "MUST_REVOKE",
    count: credentialFingerprints.length, sourceVersion: nativeSha256(credentialFingerprints.sort()), freshness: "current" });
  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.classification.localeCompare(b.classification));
  // The session and same-company Human permission are current at response
  // time too. A mid-read revocation yields no partial preview.
  if (!await currentHumanMember(db, companyId, memberId, userId)) throw notFound("Active verified Human member not found");
  if (!await currentViewerAuthority(db, companyId, actor.userId))
    throw forbidden("Current company member-management permission is required.");
  return { generatedAt: now.toISOString(), freshness: "unknown",
    coverage: "currently_authorized_subset", items };
}
