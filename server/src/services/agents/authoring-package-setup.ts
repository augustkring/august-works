import { and, eq, sql } from "drizzle-orm";
import { activityLog, agentConfigurationDrafts, agentPackageVersions, aiUseCases, companyAgentPackageInstallations, companies, type Db } from "@paperclipai/db";
import { agentPackageSetupCommandSchema, agentPackageSetupReviewSchema, agentPackageSetupReceiptSchema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { agentAuthoringService } from "./authoring-drafts.js";
import { agentAuthoringTestService } from "./authoring-tests.js";
import { agentPackageService } from "../agent-packages/package-service.js";
import { aiGovernanceService } from "../ai-governance/governance-service.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { v7HumanActorId } from "../v7-authorization.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { conflict, forbidden, notFound } from "../../errors.js";

const action = "agent_configuration.package_setup_confirmed";
const schema = "agent-package-setup-v1";

/** Compose approved-purpose selection with the Original package activation.
 * This does not approve governance, grant access, provision a runtime or start
 * the paused Agent. Its effective version still needs its publication C3. */
export function agentAuthoringPackageSetupService(db: Db) {
  async function scope(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string) {
    const currentActor = { ...actor, ignoreInstanceAdmin: true };
    await agentAuthoringService(tx).get(currentActor, companyId, draftId);
    const [draft] = await tx.select().from(agentConfigurationDrafts).where(and(
      eq(agentConfigurationDrafts.companyId, companyId), eq(agentConfigurationDrafts.id, draftId)));
    if (!draft || draft.kind !== "hire" || !draft.preparedAgentId || !draft.packageVersionId || draft.createdByUserId !== v7HumanActorId(actor))
      throw notFound("Prepared Hire setup is unavailable");
    const [installation] = await tx.select().from(companyAgentPackageInstallations).where(and(
      eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.agentId, draft.preparedAgentId),
      eq(companyAgentPackageInstallations.installedVersionId, draft.packageVersionId)));
    if (!installation || installation.status === "uninstalled") throw notFound("Original Hire installation is unavailable");
    await agentPackageService(tx).get(currentActor, companyId, installation.id);
    const [version] = await tx.select().from(agentPackageVersions).where(eq(agentPackageVersions.id, draft.packageVersionId));
    if (!version || version.contentHash !== draft.packageContentHash) throw conflict("The selected package version changed");
    return { draft, installation, version, currentActor };
  }
  async function decision(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, purposeId: string | null) {
    const current = await scope(tx, actor, companyId, draftId);
    if (current.draft.status !== "draft") throw conflict("Review the saved Hire draft before setup");
    const purposes = (await aiGovernanceService(tx).list(current.currentActor, companyId)).filter(purpose =>
      purpose.status === "approved" && purpose.purpose.intendedPurpose === current.version.release.manifest.purpose);
    const selectedPurposeId = purposeId ?? current.installation.aiUseCaseId;
    const selected = purposes.find(purpose => purpose.id === selectedPurposeId);
    const [active] = await tx.execute<{ current: boolean }>(sql`select aw_v7_package_installation_current(i) as current
      from company_agent_package_installations i where company_id=${companyId}::uuid and id=${current.installation.id}::uuid`);
    const qualified = await agentAuthoringTestService(db).readinessInTransaction(tx, current.currentActor, companyId, draftId, current.draft.version);
    const blockers: Array<"approved_purpose_required" | "representative_test_required"> = [];
    if (!selected) blockers.push("approved_purpose_required");
    if (!qualified) blockers.push("representative_test_required");
    const values = { companyId, draftId, version: current.draft.version, agentId: current.draft.preparedAgentId!,
      installationId: current.installation.id, installationVersion: current.installation.version,
      packageName: current.version.release.name, packageVersion: current.version.version,
      intendedPurpose: current.version.release.manifest.purpose,
      purposes: purposes.map(purpose => ({ id: purpose.id, version: purpose.version, purposeVersion: purpose.purposeVersion, name: purpose.purpose.name })),
      selectedPurposeId: selected?.id ?? null, packageCurrent: active?.current === true, canConfirm: blockers.length === 0 && active?.current !== true, blockers,
      modelCalled: false as const, authorityGranted: false as const, executionStarted: false as const };
    const reviewHash = nativeSha256({ values, userId: v7HumanActorId(actor), installation: current.installation,
      selected, qualified, candidateRevision: current.draft.candidateRevision });
    return { ...current, selected, review: agentPackageSetupReviewSchema.parse({ ...values, reviewHash }) };
  }
  async function originalReceipt(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) {
    await scope(tx, actor, companyId, draftId);
    const [record] = await tx.select().from(activityLog).where(and(eq(activityLog.companyId, companyId),
      eq(activityLog.entityId, draftId), eq(activityLog.action, action), eq(activityLog.actorType, "user"),
      eq(activityLog.actorId, v7HumanActorId(actor)), sql`${activityLog.details}->>'requestId'=${requestId}`));
    if (!record || record.details?.schema !== schema) return null;
    const identity = record.details.receipt;
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw conflict("The original setup receipt is unavailable");
    // These constants describe this known confirmed operation, not mutable
    // status or caller authority. Keep sensitive-field redaction unchanged.
    return { record, receipt: agentPackageSetupReceiptSchema.parse({ ...identity,
      activatedAtConfirmation: true, authorityGranted: false, executionStarted: false }) };
  }
  return {
    review: async (actor: AuthorizationActor, companyId: string, draftId: string, purposeId: string | null = null) =>
      db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const result = (await decision(tx, actor, companyId, draftId, purposeId)).review;
        await scope(tx, actor, companyId, draftId);
        return result;
      }),
    receipt: async (actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) =>
      (await originalReceipt(db, actor, companyId, draftId, requestId))?.receipt ?? null,
    confirm: async (actor: AuthorizationActor, companyId: string, draftId: string, raw: unknown) => {
      const input = agentPackageSetupCommandSchema.parse(raw), userId = v7HumanActorId(actor);
      const requestHash = nativeSha256({ schema, companyId, draftId, userId, input });
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("update");
        if (company?.status !== "active") throw forbidden("Current active company setup is required");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent-authoring-package-setup:${input.requestId}`},0))`);
        const prior = await originalReceipt(tx, actor, companyId, draftId, input.requestId);
        if (prior) {
          if (prior.record.details?.requestHash !== requestHash) throw conflict("The original setup request has different content");
          return prior.receipt;
        }
        await tx.select({ id: agentConfigurationDrafts.id }).from(agentConfigurationDrafts)
          .where(and(eq(agentConfigurationDrafts.companyId, companyId), eq(agentConfigurationDrafts.id, draftId))).for("update");
        await tx.select({ id: aiUseCases.id }).from(aiUseCases)
          .where(and(eq(aiUseCases.companyId, companyId), eq(aiUseCases.id, input.purposeId))).for("update");
        const current = await decision(tx, actor, companyId, draftId, input.purposeId);
        const draft = current.draft;
        if (draft.version !== input.expectedVersion || current.review.reviewHash !== input.expectedReviewHash || !current.review.canConfirm || !current.selected)
          throw conflict("Review the current approved purpose and representative test before setup");
        if (draft.creationRequestId === input.requestId || draft.preparationRequestId === input.requestId ||
          draft.requestReceipts.some(receipt => receipt.requestId === input.requestId)) throw conflict("This request identity belongs to another draft command");
        if (draft.requestReceipts.length >= 32) throw conflict("Start a fresh draft before retaining another setup request");
        const packages = agentPackageService(tx);
        const updated = await packages.update(current.currentActor, companyId, current.installation.id, {
          agentId: draft.preparedAgentId, versionId: draft.packageVersionId,
          components: current.installation.components.map(({ key, resourceId, versionId }) => ({ key, resourceId, versionId })),
          aiUseCaseId: current.selected.id, updatePolicy: current.installation.updatePolicy,
          expectedVersion: current.installation.version, approveMaterialChange: true, reason: "Human confirmed this exact approved intended purpose",
        }, publications);
        const activated = await packages.decide(current.currentActor, companyId, updated.id, "activate", {
          expectedVersion: updated.version, reason: "Human confirmed the current tested Hire package setup",
        }, publications);
        if (activated.status !== "active") throw conflict("Resolve the package's current readiness before confirming setup");
        const receipt = agentPackageSetupReceiptSchema.parse({ companyId, draftId, requestId: input.requestId,
          agentId: draft.preparedAgentId, installationId: activated.id, installationVersion: activated.version,
          purposeId: current.selected.id, purposeVersion: current.selected.purposeVersion,
          activatedAtConfirmation: true, authorityGranted: false, executionStarted: false });
        const [saved] = await tx.update(agentConfigurationDrafts).set({ version: draft.version + 1, updatedAt: new Date(),
          requestReceipts: [...draft.requestReceipts, { requestId: input.requestId, hash: requestHash, version: draft.version + 1 }],
        }).where(and(eq(agentConfigurationDrafts.companyId, companyId), eq(agentConfigurationDrafts.id, draftId), eq(agentConfigurationDrafts.version, draft.version))).returning({ id: agentConfigurationDrafts.id });
        if (!saved) throw conflict("The saved Hire draft changed before setup");
        const { authorityGranted: _authority, executionStarted: _work, activatedAtConfirmation: _activation, ...identity } = receipt;
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action, entityType: "agent_configuration_draft", entityId: draftId,
          details: { schema, requestId: input.requestId, requestHash, receipt: identity } }, publications);
        return receipt;
      });
    },
  };
}
