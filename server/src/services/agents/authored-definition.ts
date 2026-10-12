import { and, eq } from "drizzle-orm";
import { agentConfigRevisions, agents, type Db } from "@paperclipai/db";
import { AUTHORED_AGENT_DEFINITION_KEY, agentAuthoringContentSchema,
  authoredAgentDefinitionSchema, authoredAgentMappingBlockers, type AgentAuthoringContent } from "@paperclipai/shared";
import type { AgentExecutionManifest, AuthoredAgentDefinition } from "@paperclipai/shared";
import { sanitizeRecord } from "../../redaction.js";
import { conflict } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { authoringCandidateInstructions } from "./authoring-test-candidate.js";

export type AuthoredRuntimeAgent = { id: string; companyId: string; runtimeConfig?: unknown };
function config(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function hasAuthoredAgentDefinition(agent: AuthoredRuntimeAgent) {
  return Object.prototype.hasOwnProperty.call(config(agent.runtimeConfig), AUTHORED_AGENT_DEFINITION_KEY);
}
export function compileAuthoredAgentDefinition(content: AgentAuthoringContent, revisionId: string, candidateHash: string, procedureSnapshotHash?: string,
  publication?: { version: number; provenance: NonNullable<AuthoredAgentDefinition["publication"]> }) {
  const saved = agentAuthoringContentSchema.parse(content);
  const blockers = authoredAgentMappingBlockers(saved);
  if (blockers.length) throw conflict("The selected behavior needs its native policy mapping", { code: "authored_policy_mapping_required", blockers });
  const definition = authoredAgentDefinitionSchema.parse({ schema: "paperclip.agent-authored-definition.v1", revisionId, candidateHash,
    definitionHash: nativeSha256(saved), content: saved, ...(procedureSnapshotHash ? { procedureSnapshotHash } : {}),
    ...(publication ? { version: publication.version, publication: publication.provenance } : {}) });
  if (nativeSha256(sanitizeRecord({ [AUTHORED_AGENT_DEFINITION_KEY]: definition })) !== nativeSha256({ [AUTHORED_AGENT_DEFINITION_KEY]: definition }))
    throw conflict("Remove credential-shaped values before publishing this Agent", { code: "authored_definition_redaction_required" });
  return definition;
}

/** Resolve the exact Original revision. Never fall back to a mutable host file,
 * a draft, or another Agent's configuration when the version is unavailable. */
export async function readAuthoredAgentDefinition(db: Db | undefined, agent: AuthoredRuntimeAgent) {
  if (!hasAuthoredAgentDefinition(agent)) return null;
  if (!db) throw conflict("The canonical configuration revision owner is required");
  const parsed = authoredAgentDefinitionSchema.safeParse(config(agent.runtimeConfig)[AUTHORED_AGENT_DEFINITION_KEY]);
  if (!parsed.success) throw conflict("The authored Agent version is invalid");
  const definition = parsed.data;
  const [revision] = await db.select().from(agentConfigRevisions).where(and(
    eq(agentConfigRevisions.companyId, agent.companyId), eq(agentConfigRevisions.agentId, agent.id),
    eq(agentConfigRevisions.id, definition.revisionId), eq(agentConfigRevisions.source, "agent_authoring_publish")));
  const recorded = config(revision?.afterConfig.runtimeConfig)[AUTHORED_AGENT_DEFINITION_KEY];
  if (!revision || nativeSha256(recorded) !== nativeSha256(definition) ||
      definition.definitionHash !== nativeSha256(definition.content) || authoredAgentMappingBlockers(definition.content).length)
    throw conflict("The exact authored Agent revision is unavailable or changed");
  return definition;
}

/** A retained runtime must consume the current Original version, including
 * when its caller still holds a snapshot from before the first publication. */
export async function assertAuthoredAgentSnapshotCurrent(db: Db, agent: AuthoredRuntimeAgent) {
  const [current] = await db.select({ id: agents.id, companyId: agents.companyId, runtimeConfig: agents.runtimeConfig })
    .from(agents).where(and(eq(agents.companyId, agent.companyId), eq(agents.id, agent.id)));
  if (!current || nativeSha256(config(current.runtimeConfig)[AUTHORED_AGENT_DEFINITION_KEY] ?? null) !==
      nativeSha256(config(agent.runtimeConfig)[AUTHORED_AGENT_DEFINITION_KEY] ?? null))
    throw conflict("The retained runtime's Agent version changed", { code: "authored_agent_version_changed" });
  return readAuthoredAgentDefinition(db, current);
}

/** The worker inventory is an exact version pin, not permission to substitute
 * a newer definition with the same procedures. */
export async function assertAuthoredAgentManifestCurrent(db: Db, agent: AuthoredRuntimeAgent,
  pin: AgentExecutionManifest["agentDefinitionVersion"]) {
  const current = await assertAuthoredAgentSnapshotCurrent(db, agent);
  const expected = current ? { revisionId: current.revisionId, definitionHash: current.definitionHash,
    ...(current.procedureSnapshotHash ? { procedureSnapshotHash: current.procedureSnapshotHash } : {}),
    ...(current.version ? { version: current.version } : {}) } : null;
  if (nativeSha256(pin ?? null) !== nativeSha256(expected))
    throw conflict("The worker inventory's Agent version changed", { code: "authored_agent_version_changed" });
}
export function authoredAgentInstructionText(content: AgentAuthoringContent) {
  return `# Agent: ${content.name}\n\n${authoringCandidateInstructions(content)}\n`;
}
export function assertAuthoredAgentInstructionsWritable(agent: AuthoredRuntimeAgent) {
  if (hasAuthoredAgentDefinition(agent)) throw conflict("Edit and publish a draft to change this identified Agent version", { code: "authored_agent_version_readonly" });
}
