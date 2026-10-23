import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  contextManifestItems,
  contextManifests,
  heartbeatRuns,
  issues,
  issuePrivacySources,
  projects,
  contextManifestMemoryRoots,
  memoryRecords,
  memoryModels,
  memoryObservations,
} from "@paperclipai/db";
import type {
  ContextAuthorityDecision,
  EvidenceItem,
} from "@paperclipai/shared";
import { conflict, forbidden, unprocessable } from "../../errors.js";
import { learningAssetRoots,retainLearnedAssetsInContext } from "../learning/learning-assets.js";
import { memoryPayloadVisible, canActorReadMemorySources } from "../memory/memory-privacy.js";
import { modelLineage, observationLineage } from "../memory/derived-memory.js";
import { lockIssuePrivacyTree } from "../issues.js";
import {authorizationService,canActorReadHeartbeatRunPrivacy,canActorReadIssuePrivacy,canActorReadProjectPrivacy,type AuthorizationActor} from "../authorization.js";

type JsonScalar = string | number | boolean | null;
type CanonicalJson = JsonScalar | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalJson(value: unknown, path = "$"): CanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unprocessable("Context policy snapshot contains a non-finite number", { path });
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unprocessable("Context policy snapshot must be JSON-compatible", { path });
    }
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalJson(entry, `${path}.${key}`);
    }
    return result;
  }
  throw unprocessable("Context policy snapshot must be JSON-compatible", { path });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashContextQuery(query: string): string {
  return sha256(query);
}

export function hashContextPolicySnapshot(snapshot: unknown): string {
  return sha256(JSON.stringify(canonicalJson(snapshot)));
}

export function hashEvidenceContent(evidence: EvidenceItem): string {
  return sha256(
    JSON.stringify({
      title: evidence.title,
      excerpt: evidence.excerpt,
    }),
  );
}

export interface ContextManifestSelectedEvidence {
  decision: ContextAuthorityDecision;
  selectionReason?: string;
  retrievalScore?: number | null;
}

export interface CreateContextManifestInput {
  companyId: string;
  runId?: string | null;
  agentId: string;
  issueId?: string | null;
  projectId?: string | null;
  responsibleUserId?: string | null;
  query: string;
  policySnapshot: unknown;
  selected: ContextManifestSelectedEvidence[];
}

async function assertManifestReferences(db: Db, input: CreateContextManifestInput) {
  const [agent, run, issue, project] = await Promise.all([
    db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)))
      .then((rows) => rows[0] ?? null),
    input.runId
      ? db
          .select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, responsibleUserId:heartbeatRuns.responsibleUserId,issueId:heartbeatRuns.issueId })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, input.companyId),
              eq(heartbeatRuns.id, input.runId),
            ),
          )
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.issueId
      ? db
          .select({ id: issues.id, projectId: issues.projectId })
          .from(issues)
          .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.projectId
      ? db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.companyId, input.companyId), eq(projects.id, input.projectId)))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  if (!agent) throw forbidden("Context manifest agent is outside the company boundary");
  if (input.runId && !run) {
    throw forbidden("Context manifest run is outside the company boundary");
  }
  if (run && run.agentId !== input.agentId) {
    throw forbidden("Context manifest run does not belong to the selected agent");
  }
  if (input.issueId && !issue) {
    throw forbidden("Context manifest issue is outside the company boundary");
  }
  if (input.projectId && !project) {
    throw forbidden("Context manifest project is outside the company boundary");
  }
  if (issue?.projectId && input.projectId && issue.projectId !== input.projectId) {
    throw unprocessable("Context manifest issue and project do not match");
  }

  const crossCompanyEvidence = input.selected.find(
    ({ decision }) => decision.evidence.companyId !== input.companyId,
  );
  if (crossCompanyEvidence) {
    throw forbidden("Context manifest evidence crossed the company boundary");
  }

  for (const item of input.selected) {
    const score = item.retrievalScore;
    if (
      score !== undefined &&
      score !== null &&
      (!Number.isFinite(score))
    ) {
      throw unprocessable("Context manifest retrieval score must be finite");
    }
    const reason = item.selectionReason ?? item.decision.reason;
    if (!reason.trim() || reason.length > 500) {
      throw unprocessable("Context manifest selection reason is invalid");
    }
  }
  return run;
}

export function contextManifestService(db: Db) {
  return {
    create: async (input: CreateContextManifestInput) => {
      const queryHash = hashContextQuery(input.query);
      const policySnapshotHash = hashContextPolicySnapshot(input.policySnapshot);

      return db.transaction(async (tx) => {
        await lockIssuePrivacyTree(tx,input.companyId);
        const sourceDb = tx as unknown as Db;
        const run = await assertManifestReferences(sourceDb, input);
        if (!run?.responsibleUserId || (input.responsibleUserId && input.responsibleUserId !== run.responsibleUserId))
          throw forbidden("Context requires its actual accountable run");
        if(input.issueId && input.issueId!==run.issueId)
          throw forbidden("Context task does not match its actual run");
        const issueId=run.issueId;
        const sourceActor:AuthorizationActor={type:"agent",source:"agent_jwt",companyId:input.companyId,agentId:input.agentId,runId:run.id,onBehalfOfUserId:run.responsibleUserId};
        // Retrieval may have waited while membership or sharing changed. The
        // original privacy transaction owns admission of the retained copy.
        const assertScopePrivacy = async () => {
          const [currentRun]=await sourceDb.select({id:heartbeatRuns.id}).from(heartbeatRuns).where(and(
            eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.id,run.id),
            eq(heartbeatRuns.agentId,input.agentId),eq(heartbeatRuns.responsibleUserId,run.responsibleUserId!),
          ));
          if(!currentRun)throw forbidden("Context accountable run changed during assembly");
          const admission = await authorizationService(sourceDb).decide({actor:sourceActor,action:"company_scope:read",
            resource:{type:"company",companyId:input.companyId},enforceResponsibleUserIntersection:true});
          if (!admission.allowed) throw forbidden("Context source access is unavailable");
          if ((issueId && !await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:issueId}))
            || (input.runId && !await canActorReadHeartbeatRunPrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:input.runId}))
            || (input.projectId && !await canActorReadProjectPrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:input.projectId})))
            throw forbidden("Context source access is unavailable");
        };
        await assertScopePrivacy();
        const selectedTaskIds: string[] = [];
        const selectedPayloadSnapshots = new Map<string, typeof issues.$inferSelect["payloadSourceSnapshot"]>();
        const sourceKey = (provider: string, ref: string) => `${provider}:${ref.toLowerCase()}`;
        for (const {decision} of input.selected) {
          const evidence = decision.evidence;
          if (evidence.sourceProvider !== "august_works_tasks") continue;
          const ref = /^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(evidence.sourceRef);
          if (!ref) throw forbidden("Context source access is unavailable");
          const [current] = await tx.select({updatedAt:issues.updatedAt,payloadSourceSnapshot:issues.payloadSourceSnapshot}).from(issues)
            .where(and(eq(issues.companyId,input.companyId),eq(issues.id,ref[1]!))).for("share");
          if (!current || !await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id:ref[1]!}))
            throw forbidden("Context source access is unavailable");
          if (current.updatedAt.toISOString() !== evidence.sourceVersion)
            throw conflict("Context task changed during assembly");
          selectedTaskIds.push(ref[1]!);
          selectedPayloadSnapshots.set(sourceKey(evidence.sourceProvider,evidence.sourceRef),current.payloadSourceSnapshot);
        }
        // A later selected row may have waited after an earlier source passed.
        await assertScopePrivacy();
        for (const id of selectedTaskIds)
          if (!await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id}))
            throw forbidden("Context source access is unavailable");
        // Retain copied Task roots at the original destination Task owner.
        // Removing a Context manifest later cannot release these dependencies.
        const copiedTaskIds=selectedTaskIds.filter(id=>id!==issueId);
        if(issueId && copiedTaskIds.length)await tx.insert(issuePrivacySources).values(copiedTaskIds.map(sourceId=>({
          companyId:input.companyId,issueId,sourceKind:"issue" as const,sourceId,
        }))).onConflictDoNothing();
        const [manifest] = await tx
          .insert(contextManifests)
          .values({
            companyId: input.companyId,
            runId: input.runId ?? null,
            agentId: input.agentId,
            issueId,
            projectId: input.projectId ?? null,
            queryHash,
            policySnapshotHash,
          })
          .returning();

        const values = input.selected.map((selected, rank) => {
          const evidence = selected.decision.evidence;
          return {
            companyId: input.companyId,
            manifestId: manifest!.id,
            sourceClass: evidence.sourceClass,
            sourceProvider: evidence.sourceProvider,
            sourceRef: evidence.sourceRef,
            sourceVersion: evidence.sourceVersion,
            contentHash: hashEvidenceContent(evidence),
            authorityDomain: evidence.authorityDomain,
            trustLevel: evidence.trustLevel,
            sensitivity: evidence.sensitivity,
            rank,
            selectionReason: selected.selectionReason ?? selected.decision.reason,
            retrievalScore: selected.retrievalScore ?? null,
          };
        });

        const learnedRoots = new Map<string, string>();
        const learnedAssets:{type:string;id:string}[]=[];
        const purpose = input.policySnapshot && typeof input.policySnapshot === "object" && "intent" in input.policySnapshot && typeof input.policySnapshot.intent === "string" ? input.policySnapshot.intent : "general_work";
        for (const { decision } of input.selected) {
          const evidence = decision.evidence;
          if (evidence.sourceProvider !== "august_works_foundation") continue;
          const ref = /^foundation:\/\/[a-f0-9-]{36}\/([a-f0-9-]{36})\/(?:\d+|whole)$/i.exec(evidence.sourceRef);
          if (!ref || evidence.sourceVersion !== ref[1]) throw unprocessable("Foundation Context requires its pinned canonical revision");
          learnedAssets.push({type:"document_revision",id:ref[1]!});
          for (const root of await learningAssetRoots(tx as unknown as Db, input.companyId, "document_revision", ref[1]!, purpose,sourceActor,"task")) {
            if (learnedRoots.has(root.id) && learnedRoots.get(root.id) !== root.expectedVersion) throw conflict("Learned Context roots have conflicting versions");
            learnedRoots.set(root.id, root.expectedVersion);
          }
        }
        // Native references and lineage owners define the complete source set.
        // Provider metadata is descriptive; it cannot shrink retained roots.
        const expectedRoots=new Map(learnedRoots);
        for(const {decision} of input.selected){
          const item=decision.evidence;
          if(item.sourceProvider==="august_works_memory"){
            const ref=/^memory:\/\/record\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
            if(!ref)throw forbidden("Context requires its canonical Memory reference");
            if(!item.sourceVersion || expectedRoots.has(ref[1]!) && expectedRoots.get(ref[1]!)!==item.sourceVersion)
              throw conflict("Context Memory source versions conflict");
            expectedRoots.set(ref[1]!,item.sourceVersion);
          }else if(item.sourceProvider==="august_works_derived_memory"){
            const ref=/^memory:\/\/(memory_model|memory_observation)\/([a-f0-9-]{36})$/i.exec(item.sourceRef);
            if(!ref)throw unprocessable("Derived Context requires its native observation/model reference");
            const roots=await (async()=>{
              if(ref[1]==="memory_model"){
                const [row]=await tx.select().from(memoryModels).where(and(eq(memoryModels.companyId,input.companyId),eq(memoryModels.id,ref[2]!))).for("share");
                if(!row || row.erasedAt || row.status!=="active" || String(row.version)!==item.sourceVersion)
                  throw conflict("Derived Context review changed during assembly");
                return (await modelLineage(sourceDb,sourceActor,row)).roots;
              }
              const [row]=await tx.select().from(memoryObservations).where(and(eq(memoryObservations.companyId,input.companyId),eq(memoryObservations.id,ref[2]!))).for("share");
              if(!row || row.erasedAt || row.status!=="accepted" || String(row.version)!==item.sourceVersion)
                throw conflict("Derived Context review changed during assembly");
              return (await observationLineage(sourceDb,sourceActor,row)).roots;
            })();
            for(const root of roots){
              const version=root.updatedAt.toISOString();
              if(expectedRoots.has(root.id) && expectedRoots.get(root.id)!==version)
                throw conflict("Context Memory source versions conflict");
              expectedRoots.set(root.id,version);
            }
          }
        }
        const rootIds=[...expectedRoots.keys()];
        if(rootIds.length>256)throw forbidden("Complete Context Memory roots exceed their source budget");
        if (rootIds.length) {
          const roots = await tx.select({ id: memoryRecords.id, updatedAt: memoryRecords.updatedAt,scopeType:memoryRecords.scopeType,ownerAgentId:memoryRecords.ownerAgentId,payloadSourceSnapshot:memoryRecords.payloadSourceSnapshot }).from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId), inArray(memoryRecords.id, rootIds), memoryPayloadVisible())).for("share");
          if (roots.length !== rootIds.length) throw forbidden("Context Memory roots cross a company boundary");
          for(const root of roots){
            if(root.scopeType==="agent" && root.ownerAgentId!==input.agentId)
              throw forbidden("Context private Memory belongs to another agent");
            if(!await canActorReadMemorySources(sourceDb,input.companyId,sourceActor,root.id))throw forbidden("Context Memory source access is unavailable");
          }
          if(roots.some(root=>expectedRoots.get(root.id)!==root.updatedAt.toISOString()))
            throw conflict("Context Memory roots changed during assembly");
          // Freeze the selected body's closure under the same version/share
          // pin, including learned/derived roots. NULL history stays unknown.
          for (const root of roots) selectedPayloadSnapshots.set(sourceKey("august_works_memory",`memory://record/${root.id}`),root.payloadSourceSnapshot);
          await tx.insert(contextManifestMemoryRoots).values(roots.map((root) => ({ companyId: input.companyId, manifestId: manifest!.id,
            memoryRecordId: root.id, sourceVersion: root.updatedAt.toISOString(), payloadSourceSnapshot: root.payloadSourceSnapshot })));
        }

        await retainLearnedAssetsInContext(tx as unknown as Db,input.companyId,sourceActor,manifest!.id,learnedAssets);

        // Insert immutable items after the selected Task and Memory bodies
        // have been pinned. Caller evidence metadata never supplies snapshots.
        const items = values.length > 0
          ? await tx.insert(contextManifestItems).values(values.map(value => ({ ...value,
              payloadSourceSnapshot: selectedPayloadSnapshots.get(sourceKey(value.sourceProvider,value.sourceRef)) ?? null,
            }))).returning()
          : [];

        await assertScopePrivacy();
        for (const id of selectedTaskIds)
          if (!await canActorReadIssuePrivacy(sourceDb,sourceActor,{companyId:input.companyId,id}))
            throw forbidden("Context source access is unavailable");
        for(const id of rootIds)
          if(!await canActorReadMemorySources(sourceDb,input.companyId,sourceActor,id))
            throw forbidden("Context Memory source access changed during assembly");

        return { manifest: manifest!, items };
      });
    },
  };
}
