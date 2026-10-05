import { and, desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  humanOversightProfiles,
  governanceObligations,
  type Db,
} from "@paperclipai/db";
import type { GovernanceEvidencePack } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Enabled } from "../v7-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { aiGovernanceService } from "./governance-service.js";
import { conflict } from "../../errors.js";

/** Rebuilt on every export from canonical state. The pack confers no authority.
 * Exporting Task metadata does not confer access to private Memory or credentials. */
export async function governanceEvidencePack(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  useCaseId: string,
): Promise<GovernanceEvidencePack> {
  await assertV7Enabled(db, "governance_evidence_v7");
  return db.transaction(async (tx) => {
    // One consistent snapshot; Task access is checked individually by get().
    await tx.execute(
      sql`set transaction isolation level repeatable read, read only`,
    );
    const detail = await aiGovernanceService(tx as unknown as Db).get(
      actor,
      companyId,
      useCaseId,
    );
    const [oversight] = await tx
      .select()
      .from(humanOversightProfiles)
      .where(
        and(
          eq(humanOversightProfiles.companyId, companyId),
          eq(
            humanOversightProfiles.id,
            detail.useCase.purpose.oversightProfileId,
          ),
        ),
      );
    if (!oversight)
      throw conflict("The intended-purpose oversight record is unavailable");
    const inventory: GovernanceEvidencePack["inventory"] = [];
    const readiness: GovernanceEvidencePack["readiness"] = [];
    for (const deployment of detail.deployments) {
      const [row] = await tx.execute(sql`select jsonb_build_object(
        'deploymentId',d.id,'issueId',d.issue_id,'agentId',d.agent_id,
        'adapterType',a.adapter_type,'providerType',p.provider_type,'providerStatus',p.status,
        'runtimeProfileRef',r.provider_profile_ref,'configurationHash',r.qualified_configuration_hash,
        'modelProvider',c.model_provider,'modelId',c.model_id,'imageDigest',c.active_image_digest,
        'sandboxBackend',s.backend,'sandboxProfile',s.profile,'sandboxStatus',s.status,
        'boundaryPolicyHash',s.boundary_policy_hash,
        'packages',coalesce((select jsonb_agg(jsonb_build_object('installationId',pi.id,'versionId',pi.installed_version_id,'releaseHash',pv.content_hash,'status',pi.status,'currentAuthority',aw_v7_package_installation_current(pi),'releaseEvidence',pv.release->'releaseEvidence')) from company_agent_package_installations pi join agent_package_versions pv on pv.id=pi.installed_version_id where pi.company_id=d.company_id and pi.agent_id=d.agent_id),'[]'::jsonb),
        'currentAuthority',aw_v7_governance_deployment_current(d)
      ) as inventory from ai_use_case_deployments d
      join agents a on a.company_id=d.company_id and a.id=d.agent_id
      left join agent_presence_runtime_bindings r on r.company_id=a.company_id and r.agent_id=a.id
      left join agent_provider_bindings p on p.id=r.provider_binding_id
      left join runtime_cells c on c.company_id=r.company_id and c.provider_binding_id=p.id
      left join runtime_sandbox_bindings s on s.company_id=c.company_id and s.runtime_cell_id=c.id and s.cell_generation=c.generation::text
      where d.company_id=${companyId}::uuid and d.id=${deployment.id}::uuid`);
      if (row?.inventory)
        inventory.push(
          row.inventory as GovernanceEvidencePack["inventory"][number],
        );
      const assessments = await tx.execute(sql`select jsonb_build_object(
        'id',id,'issueId',subject_id,'agentId',agent_id,'actionClass',action_class,
        'status',status,'assessedAt',assessed_at,'expiresAt',expires_at
      ) as assessment from readiness_assessments where company_id=${companyId}::uuid
      and subject_type='task' and subject_id=${deployment.issueId}::uuid and agent_id=${deployment.agentId}::uuid
      order by assessed_at desc,id limit 10`);
      for (const item of assessments)
        if (item.assessment)
          readiness.push(
            item.assessment as GovernanceEvidencePack["readiness"][number],
          );
    }
    const obligations = await tx
      .select()
      .from(governanceObligations)
      .where(eq(governanceObligations.companyId, companyId))
      .orderBy(desc(governanceObligations.createdAt))
      .limit(100);
    const auditRefs = await tx
      .select({
        id: activityLog.id,
        action: activityLog.action,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "ai_use_case"),
          eq(activityLog.entityId, useCaseId),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(100);
    const content = JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        companyId,
        generatedAt: new Date().toISOString(),
        coverage: "bounded_authorized_projection",
        detail,
        oversight: {
          id: oversight.id,
          companyId,
          profile: oversight.profile,
          profileHash: oversight.profileHash,
          status: oversight.status,
        },
        inventory,
        readiness,
        obligations,
        auditRefs,
        limitations: [
          "This projection is evidence for accountable review; it does not certify legal compliance or physical runtime isolation.",
          "History, assessments, deployments and audit references are bounded; independently authorized source inspection remains required.",
          "Personal-data categories, retention purpose and provider references are the current accountable owner's declarations in the intended-purpose record.",
          "Private Memory, source bodies, credential material and connection configuration are excluded from this export.",
          "Readiness records are historical observations, not a grant of current execution authority or a substitute for independent outcome verification.",
          "Stop delivery acknowledges a cancellation request; physical stopping requires canonical runtime evidence.",
          "Package release references describe recorded publisher evidence; subprocessor contracts and actual protected-host qualification require independent current evidence.",
        ],
      }),
    ) as Omit<GovernanceEvidencePack, "packHash">;
    return { ...content, packHash: nativeSha256(content) };
  });
}
