import { and, eq, sql } from "drizzle-orm";
import {
  agentPackages,
  agentPackageVersions,
  companyAgentPackageInstallations,
  verificationRuns,
  type Db,
} from "@paperclipai/db";
import {
  SPECIALIST_KEYS,
  SPECIALIST_CANDIDATES,
  specialistCompletionContract,
  specialistEvaluationSchema,
  type SpecialistKey,
  type SpecialistEvaluationReport,
} from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import {
  assertV7Authorization,
  assertV7Enabled,
  v7HumanActorId,
} from "../v7-authorization.js";
import { verificationService } from "../supervision/verification-service.js";
import { withV7ActivityTransaction } from "../v7-mutations.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { notFound } from "../../errors.js";

/** A current evidence projection, not a second completion or qualification store. */
export async function evaluateSpecialistPackage(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  raw: unknown,
): Promise<SpecialistEvaluationReport> {
  v7HumanActorId(actor);
  const input = specialistEvaluationSchema.parse(raw);
  return withV7ActivityTransaction(db, async (tx) => {
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    await assertV7Enabled(tx, "agent_packages_v7");
    await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    const [subject] = await tx
      .select({
        installation: companyAgentPackageInstallations,
        package: agentPackages,
        version: agentPackageVersions,
      })
      .from(companyAgentPackageInstallations)
      .innerJoin(
        agentPackages,
        eq(agentPackages.id, companyAgentPackageInstallations.packageId),
      )
      .innerJoin(
        agentPackageVersions,
        eq(
          agentPackageVersions.id,
          companyAgentPackageInstallations.installedVersionId,
        ),
      )
      .where(
        and(
          eq(companyAgentPackageInstallations.companyId, companyId),
          eq(companyAgentPackageInstallations.id, input.installationId),
        ),
      )
      .for("share");
    if (
      !subject ||
      !SPECIALIST_KEYS.includes(subject.package.key as SpecialistKey)
    )
      throw notFound("Specialist installation not found");
    const installation = subject.installation,
      key = subject.package.key as SpecialistKey;
    await assertV7Authorization(tx, actor, companyId, "agents:configure", {
      type: "agent",
      companyId,
      agentId: installation.agentId,
    });
    const [authority] = await tx.execute(
      sql`select aw_v7_package_installation_current(i) as current from company_agent_package_installations i where company_id=${companyId}::uuid and id=${installation.id}::uuid`,
    );
    const cases: SpecialistEvaluationReport["cases"] = [];
    for (const scenario of SPECIALIST_CANDIDATES[key].cases) {
      const supplied = input.cases.find((c) => c.caseKey === scenario.key),
        reasons: string[] = [];
      if (!supplied) {
        cases.push({
          caseKey: scenario.key,
          verificationRunId: null,
          status: "blocked",
          reasons: ["Native case review is missing"],
          resultHash: null,
        });
        continue;
      }
      const [review] = await tx
        .select()
        .from(verificationRuns)
        .where(
          and(
            eq(verificationRuns.companyId, companyId),
            eq(verificationRuns.id, supplied.verificationRunId),
          ),
        )
        .for("share");
      if (!review || review.erasedAt)
        throw notFound("Retained native verification not found");
      // The native packet rechecks Task/source access and all current output pins.
      const packet = await verificationService(tx).currentPacket(
        actor,
        companyId,
        review.planId,
        review.workerId,
      );
      const contract = specialistCompletionContract(key, scenario.key);
      if (
        packet.contract.objective !== contract.objective ||
        [
          "businessInvariants",
          "evidenceRequirements",
          "prohibitedOutcomes",
        ].some((field) =>
          (contract[field as keyof typeof contract] as string[]).some(
            (rule) =>
              !(
                packet.contract[field as keyof typeof contract] as string[]
              ).includes(rule),
          ),
        )
      )
        reasons.push(
          "Review does not cover the declared specialist case contract",
        );
      if (
        !packet.contract.requiredOutputs.some((o) => o.key === "review_draft")
      )
        reasons.push(
          "Required review draft is absent from the completion contract",
        );
      if (
        review.result !== "pass" ||
        review.resultHash !== packet.resultHash ||
        packet.deterministicFailures.length ||
        review.failedInvariants.length ||
        review.uncertainties.length
      )
        reasons.push("Independent review or current evidence does not pass");
      const [attempt] = await tx.execute(
        sql`select exists(select 1 from orchestration_worker_attempts a join heartbeat_runs r on r.company_id=a.company_id and r.agent_id=a.agent_id and r.id=a.run_id where a.company_id=${companyId}::uuid and a.plan_id=${review.planId}::uuid and (${review.workerId}::uuid is null or a.worker_id=${review.workerId}::uuid) and a.agent_id=${installation.agentId}::uuid and a.status='succeeded' and r.status='succeeded' and r.context_snapshot->>'agentPackageInstallationId'=${installation.id} and r.context_snapshot->>'agentPackageActivationHash'=${installation.activationHash ?? ""}) as current`,
      );
      if (authority?.current !== true || attempt?.current !== true)
        reasons.push(
          "Review is not tied to this current package activation and actual successful run",
        );
      cases.push({
        caseKey: scenario.key,
        verificationRunId: review.id,
        status: reasons.length ? "blocked" : "pass",
        reasons,
        resultHash: packet.resultHash,
      });
    }
    if (
      input.cases.some(
        (c) =>
          !SPECIALIST_CANDIDATES[key].cases.some((s) => s.key === c.caseKey),
      )
    )
      throw notFound("Specialist evaluation case not found");
    const report = {
      schema: "aw.specialist.native_evaluation.v1" as const,
      companyId,
      installationId: installation.id,
      packageKey: key,
      packageVersionId: subject.version.id,
      evaluatedAt: new Date().toISOString(),
      cases,
      allCasesPassed: cases.every((c) => c.status === "pass"),
      qualification: "current_native_human_reviews_only" as const,
      limitations: [
        "This projection does not establish customer demand, protected holdout coverage, model portability, cost or physical runtime qualification.",
        "It does not publish, activate or independently change Task completion.",
      ],
    };
    return { ...report, reportHash: nativeSha256(report) };
  });
}
