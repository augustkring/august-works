import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { v7FeatureEnabled, type CoreStewardSummary } from "@paperclipai/shared";
import { instanceSettingsService } from "../instance-settings.js";
import { agentPackageService } from "../agent-packages/package-service.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import {
  assertV7Authorization,
  assertV7Enabled,
  v7HumanActorId,
} from "../v7-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { logger } from "../../middleware/logger.js";
const bounded = (n: number) => Math.max(1, Math.min(100, Math.trunc(n) || 20));
/** Metadata-only invalidation of the latest native assessments. No source-body
 * retrieval, inference, approval, grants, model call or outbound notification. */
export async function maintainFoundationFindings(db: Db, limit = 20) {
  if (
    !v7FeatureEnabled(
      await instanceSettingsService(db).getExperimental(),
      "core_stewards_v7",
    )
  )
    return { findingsCreated: 0 };
  return withV7ActivityTransaction(db, async (tx, publications) => {
    await tx.execute(
      sql`select singleton_key from instance_settings where singleton_key='default' for share`,
    );
    if (
      !v7FeatureEnabled(
        await instanceSettingsService(tx).getExperimental(),
        "core_stewards_v7",
      )
    )
      return { findingsCreated: 0 };
    const rows = await tx.execute(sql`with latest as (
      select distinct on(company_id,agent_id,principal_id,subject_type,subject_id,action_class) a.* from readiness_assessments a
      order by company_id,agent_id,principal_id,subject_type,subject_id,action_class,assessed_at desc,id desc
    ), stale as (
      select a.* from latest a where (a.expires_at<=now() or exists(
        select 1 from jsonb_array_elements(a.assessment_json->'requirements') q,
          jsonb_array_elements(q->'evidenceRefs') e where e->>'sourceRef' like 'foundation://%' and not exists (
            select 1 from foundation_documents f where f.company_id=a.company_id and f.id::text=split_part(e->>'sourceRef','/',3)
            and f.status='approved' and f.approved_revision_id::text=e->>'sourceVersion'
            and (f.valid_from is null or f.valid_from<=now()) and (f.valid_until is null or f.valid_until>now())
            and (f.next_review_at is null or f.next_review_at>now())
          ))) and not exists(select 1 from knowledge_quality_findings f where f.assessment_id=a.id and f.rule_version='aw-v7-core-stewards-1')
      order by a.expires_at,a.id limit ${bounded(limit)}
    ) insert into knowledge_quality_findings(company_id,assessment_id,finding_hash,quality_dimension,requirement_key,severity,status,summary,evidence_refs_json,rule_version)
    select company_id,id,encode(sha256(convert_to(id::text||':aw-v7-core-stewards-1','UTF8')),'hex'),'freshness','system.steward.reassessment','review_required','open',
      'Readiness or its approved Foundation source requires a fresh authorized assessment.','[]'::jsonb,'aw-v7-core-stewards-1' from stale
    on conflict (assessment_id,finding_hash) do nothing returning id,company_id`);
    for (const row of rows)
      await logActivity(
        tx,
        {
          companyId: String(row.company_id),
          actorType: "system",
          actorId: "core-stewards",
          action: "readiness.reassessment_required",
          entityType: "knowledge_quality_finding",
          entityId: String(row.id),
          details: { ruleVersion: "aw-v7-core-stewards-1" },
        },
        publications,
      );
    return { findingsCreated: rows.length };
  });
}
export async function maintainPackageUpdates(db: Db, limit = 20) {
  const flags = await instanceSettingsService(db).getExperimental();
  if (
    !v7FeatureEnabled(flags, "core_stewards_v7") ||
    !v7FeatureEnabled(flags, "agent_packages_v7")
  )
    return { configured: 0, checked: 0 };
  // Immutable version ordering and SKIP LOCKED service admission; each company
  // policy is independent. No scan of private Memory or source content.
  const rows =
    await db.execute(sql`select i.id,i.company_id,v.id as next_version_id from company_agent_package_installations i
    join agent_package_versions current on current.id=i.installed_version_id
    join lateral(select v.* from agent_package_versions v where v.agent_package_id=i.agent_package_id and v.state='published'
      order by split_part(v.version,'.',1)::numeric desc,split_part(v.version,'.',2)::numeric desc,split_part(v.version,'.',3)::numeric desc limit 1) v on true
    where i.status='active' and i.update_policy='auto_low_risk' and v.id<>i.installed_version_id
      and aw_v7_package_installation_current(i) and aw_v7_package_release_current(v)
      and v.release->'manifest'=current.release->'manifest' and v.release->'components'=current.release->'components'
      and not exists(select 1 from heartbeat_runs r where r.company_id=i.company_id and r.agent_id=i.agent_id and r.status in ('queued','running','scheduled_retry'))
    order by i.updated_at,i.id limit ${bounded(limit)}`);
  let configured = 0;
  for (const row of rows) {
    try {
      if (
        (
          await agentPackageService(db).stewardUpdate(
            String(row.company_id),
            String(row.id),
            String(row.next_version_id),
          )
        ).updated
      )
        configured++;
    } catch (error) {
      logger.warn(
        { err: error, installationId: row.id },
        "Core Steward update remained closed",
      );
    }
  }
  return { configured, checked: rows.length };
}
export async function coreStewardSummary(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
): Promise<CoreStewardSummary> {
  const userId = v7HumanActorId(actor);
  await assertV7Enabled(db, "core_stewards_v7");
  await assertV7Authorization(db, actor, companyId, "company_scope:read");
  // Findings are principal-owned. No counts over another user's private roots.
  const [row] =
    await db.execute(sql`select count(*)::int as count from knowledge_quality_findings f join readiness_assessments a on a.company_id=f.company_id and a.id=f.assessment_id
    where f.company_id=${companyId}::uuid and a.principal_id=${actor.source === "local_implicit" ? "local-board" : `user:${userId}`} and f.status in ('open','acknowledged')`);
  return {
    companyId,
    asOf: new Date().toISOString(),
    ownReadinessFindings: Number(row?.count ?? 0),
    responsibilities: [
      {
        domain: "foundation",
        consumer: "native_readiness_findings",
        authority: "Findings only; human review retains canonical approval",
      },
      {
        domain: "memory",
        consumer: "native_memory_jobs",
        authority:
          "Existing retention, source privacy and explicit maintenance requests",
      },
      {
        domain: "evaluation",
        consumer: "native_package_reconciliation",
        authority:
          "Current release evidence; opted-in unchanged-content updates require activation",
      },
      {
        domain: "governance",
        consumer: "native_governance_reconciliation",
        authority: "Current intended purpose, review expiry and durable Stop",
      },
      {
        domain: "coordination",
        consumer: "native_supervision_and_followups",
        authority: "Existing bounded interventions and human review cards",
      },
    ],
  };
}
