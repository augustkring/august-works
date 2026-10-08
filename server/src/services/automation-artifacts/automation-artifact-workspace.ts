import { assertLearningAssetCurrent } from "../learning/learning-assets.js";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { automationArtifacts, automationArtifactVersions, type Db } from "@paperclipai/db";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { conflict, forbidden } from "../../errors.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertRuntimeStorageDirectories, removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import { learningActorFromPrincipal } from "../learning/learning-analytical-sources.js";
import { executeAutomationArtifactTypeScriptSandbox } from "./automation-artifact-code-runtime.js";
import type { AutomationArtifactMutationActor } from "./automation-artifact-service.js";

type Owner = { companyId: string; versionId: string; expectedStatus?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function artifactWorkspaceDirectory(owner: Owner) {
  if (![owner.companyId, owner.versionId].every(id => uuid.test(id))) throw new Error("Invalid native Artifact workspace owner");
  return path.join(resolvePaperclipInstanceRoot(), "artifact-runtime-workspaces", owner.companyId.toLowerCase(), owner.versionId.toLowerCase());
}
async function clearWorkspace(owner: Owner) {
  const directory = artifactWorkspaceDirectory(owner);
  try {
    await assertRuntimeStorageDirectories(directory, resolvePaperclipInstanceRoot());
    await removeRuntimeStorageTree(directory);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function erased(db: Db, owner: Owner) {
  const [row] = await db.execute<{ erased: boolean }>(sql`select not exists(select 1 from automation_artifact_versions v
    where v.company_id=${owner.companyId}::uuid and v.id=${owner.versionId}::uuid)
    or aw_learning_asset_erased(${owner.companyId}::uuid,'automation_artifact_version',${owner.versionId}::uuid)
    or exists(select 1 from automation_artifact_versions v where v.company_id=${owner.companyId}::uuid and v.id=${owner.versionId}::uuid
      and aw_optimizer_artifact_erased(v.company_id,v.artifact_id)) as erased`);
  return row?.erased === true;
}

/** The immutable native version owns both the original code and its temporary
 * copy. No caller-supplied path or additional filesystem inventory is needed. */
export async function executeNativeArtifactCode(db: Db, owner: Owner, actor: AutomationArtifactMutationActor,
  input: Omit<Parameters<typeof executeAutomationArtifactTypeScriptSandbox>[0], "workspaceDirectory">,
  requireActive = true) {
  artifactWorkspaceDirectory(owner);
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    // ponytail: serialize code copies with the existing company privacy owner;
    // use a version lock only after the Source owners support finer concurrency.
    await lockAnalyticalCompany(tx, owner.companyId); await lockMemoryPrivacy(tx, owner.companyId);
    if (await erased(tx, owner)) throw forbidden("Artifact Source is unavailable", { code: "analytical_source_access_lost" });
    const checkSource = () => assertLearningAssetCurrent(tx, owner.companyId, "automation_artifact_version", owner.versionId,
      actor.sourceActor ?? learningActorFromPrincipal(owner.companyId, actor.principal, actor.runId));
    await checkSource();
    const [version] = await tx.select().from(automationArtifactVersions).where(and(
      eq(automationArtifactVersions.companyId, owner.companyId), eq(automationArtifactVersions.id, owner.versionId)));
    const [root] = version ? await tx.select().from(automationArtifacts).where(and(
      eq(automationArtifacts.companyId, owner.companyId), eq(automationArtifacts.id, version.artifactId))).for("share") : [];
    if (!version || !root || root.kind !== "typescript" || root.archivedAt || root.latestVersionId !== version.id ||
      requireActive && root.status !== "active" || owner.expectedStatus && root.status !== owner.expectedStatus || version.sourceCode !== input.sourceCode ||
      !isDeepStrictEqual(version.dependencyManifest, input.dependencyManifest)) {
      throw conflict("Native Artifact sandbox Source binding changed", { code: "automation_artifact_pointer_invalid" });
    }
    // A crashed process can leave this exact version's prior workspace behind.
    // Its original Source owner also queues cleanup on C7/version deletion.
    await clearWorkspace(owner);
    const directory = artifactWorkspaceDirectory(owner);
    await assertRuntimeStorageDirectories(directory, resolvePaperclipInstanceRoot(), true);
    await fs.chmod(directory, 0o700);
    try {
      const result = await executeAutomationArtifactTypeScriptSandbox({ ...input, workspaceDirectory: directory });
      await checkSource();
      return result;
    }
    finally { await clearWorkspace(owner); }
  });
}

export async function eraseArtifactWorkspace(db: Db, owner: Owner) {
  artifactWorkspaceDirectory(owner);
  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, owner.companyId); await lockMemoryPrivacy(tx, owner.companyId);
    if (!await erased(tx, owner)) throw new Error("Native Artifact workspace has no Source erasure receipt");
    await clearWorkspace(owner);
  });
}
