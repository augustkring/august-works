import type { Db } from "@paperclipai/db";
import type {
  AssembleContextInput,
  ContextAssemblyResult,
} from "./context-engine.js";
import { contextEngineService } from "./context-engine.js";
import type { NativeBootstrapContextWitness } from "./native-bootstrap-context-witness.js";

export interface FreshNativeGovernedContextInput {
  enabled: boolean;
  foundationEnabled: boolean;
  sourceScope?: "task_only";
  companyId: string;
  agentId: string;
  responsibleUserId?: string | null;
  runId: string;
  issueId: string;
  projectId?: string | null;
  issueTitle: string;
  issueDescription?: string | null;
  immediateRequest?: string | null;
}

export type ContextAssemble = (
  input: AssembleContextInput,
) => Promise<ContextAssemblyResult>;

function buildNativeContextQuery(input: FreshNativeGovernedContextInput) {
  return [
    input.immediateRequest?.trim() || null,
    input.issueTitle.trim(),
    input.issueDescription?.trim() || null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .slice(0, 500);
}

/**
 * Assemble governed context only for a fresh native execution input.
 *
 * Callers must not invoke this when recovering a persisted native execution
 * input; that input is the durable admission boundary for the run.
 */
export async function assembleFreshNativeGovernedContext(
  db: Db,
  input: FreshNativeGovernedContextInput,
  options: { assemble?: ContextAssemble } = {},
): Promise<{ markdown: string; manifest: ContextAssemblyResult["packet"]["manifest"]; sourceWitness?: NativeBootstrapContextWitness } | null> {
  if (!input.enabled) return null;

  const query = buildNativeContextQuery(input);
  if (!query) return null;

  const owner = contextEngineService(db);
  const assemble = options.assemble ?? owner.assembleNativeBootstrap;
  const result = await assemble({
    companyId: input.companyId,
    agentId: input.agentId,
    authorizationActor: { type: "agent", source: "none", companyId: input.companyId,
      agentId: input.agentId, runId: input.runId, onBehalfOfUserId: input.responsibleUserId ?? null },
    responsibleUserId: input.responsibleUserId ?? null,
    enforceResponsibleUserIntersection: true,
    runId: input.runId,
    issueId: input.issueId,
    projectId: input.projectId ?? null,
    query,
    intent: "native_task_execution",
    includeFoundation: input.foundationEnabled,
    ...(input.sourceScope === "task_only" ? { sourceScope: input.sourceScope } : {}),
    sensitivityCeiling: "internal",
  });

  const markdown = result.markdown;
  return markdown.trim().length > 0 ? { markdown, manifest: result.packet.manifest,
    ...(result.nativeBootstrapWitness ? { sourceWitness: result.nativeBootstrapWitness } : {}) } : null;
}
