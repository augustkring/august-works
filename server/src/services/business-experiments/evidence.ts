import { and, eq, inArray } from "drizzle-orm";
import { analyticalLineageEdges, type Db } from "@paperclipai/db";
import type { DecisionEvidenceReference } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { admitBusinessExperiment, lockBusinessExperimentRoot, inspectBusinessExperimentVersion } from "./service.js";
import { experimentBudget, nativeExperimentUnit, type ExperimentEdge } from "./receipts.js";
import { experimentAnalysisView } from "./results.js";

/** Internal evidence bridge: replay the native owner's exact signed result and
 * inherit every subject, recorded ancestry and final-capture source. Never
 * accept caller measurements or convert the proxy into a verified task outcome. */
export async function inspectBusinessExperimentEvidence(tx: Db, companyId: string, actor: AuthorizationActor,
  ref: Extract<DecisionEvidenceReference, { type: "experiment_analysis" }>, requireCurrent: boolean, deadline: number) {
  await admitBusinessExperiment(tx, companyId, actor);
  const root = await lockBusinessExperimentRoot(tx, companyId, ref.experimentId);
  const pin = await inspectBusinessExperimentVersion(tx, root, actor, ref.versionId, requireCurrent, deadline);
  const { analysis, interpretation, completion } = pin.receipts;
  if (!analysis || !interpretation || !completion || analysis.id !== ref.id || interpretation.id !== ref.interpretationId || interpretation.analysisId !== analysis.id)
    throw notFound("Exact human-interpreted native experiment evidence is unavailable");
  if (root.currentVersionId !== ref.versionId || !["decided", "inconclusive", "invalid"].includes(root.state))
    throw conflict("Experiment evidence requires its retained terminal human interpretation");
  const manifestIds = [...new Set([pin.value.lineageManifestId, ...pin.receipts.assignments.map(a => a.lineageManifestId), ...pin.receipts.outcomes.map(o => o.lineageManifestId)])];
  const edges = new Map<string, ExperimentEdge>();
  function inherit(e:ExperimentEdge){
    const key=`${e.inputType}:${e.inputRef}`,old=edges.get(key);
    if(old&&old.inputHash!==e.inputHash)throw conflict("Experiment evidence source pins disagree");
    edges.set(key,{inputType:e.inputType,inputRef:e.inputRef,inputHash:e.inputHash,relationship:e.relationship});
    if(edges.size>20_065)throw unprocessable("Experiment evidence exceeds the downstream native source budget");
  }
  // Each manifest was independently checked by the source owner above. Batch
  // only the downstream inheritance; duplicates do not discard source hashes.
  for (let offset = 0; offset < manifestIds.length; offset += 100) {
    experimentBudget(deadline);
    const inherited = await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), inArray(analyticalLineageEdges.manifestId, manifestIds.slice(offset, offset + 100)))).limit(26_201);
    if (inherited.length > 26_200) throw unprocessable("Experiment evidence lineage batch exceeds its bounded source budget");
    for (const e of inherited) inherit(e);
  }
  const recordedEdges=[...edges.values()].sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  // A new consumer also owns the current ancestry at its own capture time.
  // Retained assignment/final-capture receipts stay byte-for-byte unchanged.
  for(const assignment of pin.receipts.assignments){
    experimentBudget(deadline);
    const current=await nativeExperimentUnit(tx,companyId,actor,pin.value,assignment.unitId);
    for(const edge of current.edges)inherit(edge);
  }
  const view = experimentAnalysisView(analysis, completion, pin.source.current);
  const sourceHash = nativeSha256({ analysisHash: analysis.receiptHash, interpretationHash: interpretation.receiptHash });
  experimentBudget(deadline);
  return { definition: pin.value.definition, expiresAt: pin.value.expiresAt, analysis, interpretation, view, sourceHash,
    recordedEdges, edges: [...edges.values()].sort((a,b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`)) };
}
