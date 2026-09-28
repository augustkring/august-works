import { and, asc, eq, ilike, ne, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  toolApplications,
  toolCatalogEntries,
  toolConnections,
} from "@paperclipai/db";
import {
  workflowCapabilitySearchQuerySchema,
  type WorkflowCapabilityCandidate,
  type WorkflowCapabilityKind,
  type WorkflowCapabilitySearchQuery,
  type WorkflowNodeDefinitionDescriptor,
  type WorkflowRiskClass,
  type WorkflowSideEffectClass,
} from "@paperclipai/shared";
import { projectedConnectionToolInputSchema } from "../tool-access.js";
import { workflowNodeDefinitions } from "./workflow-node-registry.js";

const CORE_CAPABILITY_TYPES = new Set([
  "core.manual_trigger",
  "core.transform",
  "core.condition",
  "work.create_task",
  "human.approval",
]);

const AGENT_AVAILABLE_STATUSES = new Set(["active", "idle", "running"]);

function coreConfigTemplate(type: string): Record<string, unknown> {
  switch (type) {
    case "core.manual_trigger":
      return {};
    case "core.transform":
      return { mapping: { value: "{{input.value}}" } };
    case "core.condition":
      return { expression: "true" };
    case "work.create_task":
      return { title: "New task" };
    case "human.approval":
      return {
        summary: "Approval required",
        consequence: "Review this step before the workflow continues.",
      };
    default:
      return {};
  }
}

function toolRiskClass(risk: string): WorkflowRiskClass {
  if (["critical", "high", "destructive"].includes(risk)) return "C3";
  if (["medium", "write"].includes(risk)) return "C2";
  return "C1";
}

function toolSideEffect(input: {
  isDestructive: boolean;
  isWrite: boolean;
}): WorkflowSideEffectClass {
  if (input.isDestructive) return "destructive";
  if (input.isWrite) return "write";
  return "read";
}

function toolAvailability(input: {
  applicationStatus: string | null;
  connectionStatus: string;
  enabled: boolean;
  healthStatus: string;
}) {
  if (input.applicationStatus && input.applicationStatus !== "active") {
    return { status: "unavailable" as const, reason: "application_inactive" };
  }
  if (input.connectionStatus !== "active" || !input.enabled) {
    return { status: "unavailable" as const, reason: "connection_inactive" };
  }
  if (["failed", "error", "missing_secret"].includes(input.healthStatus)) {
    return { status: "unavailable" as const, reason: `connection_${input.healthStatus}` };
  }
  if (["degraded", "unknown", "unchecked"].includes(input.healthStatus)) {
    return { status: "degraded" as const, reason: `connection_${input.healthStatus}` };
  }
  return { status: "available" as const, reason: null };
}

function agentAvailability(status: string) {
  if (AGENT_AVAILABLE_STATUSES.has(status)) {
    return { status: "available" as const, reason: null };
  }
  if (status === "error") {
    return { status: "degraded" as const, reason: "agent_error" };
  }
  return { status: "unavailable" as const, reason: `agent_${status}` };
}

function searchable(candidate: WorkflowCapabilityCandidate) {
  return [
    candidate.title,
    candidate.description ?? "",
    candidate.nodeType,
    candidate.source.applicationName ?? "",
    candidate.source.connectionName ?? "",
    candidate.source.toolName ?? "",
    candidate.source.agentRole ?? "",
    candidate.source.adapterType ?? "",
  ].join(" ").toLocaleLowerCase();
}

function capabilityScore(
  candidate: WorkflowCapabilityCandidate,
  query: string,
): number {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    if (candidate.kind === "core_node") return 30;
    if (candidate.availability.status === "available") return 20;
    if (candidate.availability.status === "degraded") return 10;
    return 1;
  }

  const title = candidate.title.toLocaleLowerCase();
  const haystack = searchable(candidate);
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (!terms.every((term) => haystack.includes(term))) return 0;

  let score = 20 + terms.length;
  if (title === normalized) score += 100;
  else if (title.startsWith(normalized)) score += 75;
  else if (title.includes(normalized)) score += 50;
  if (candidate.availability.status === "available") score += 5;
  if (candidate.availability.status === "unavailable") score -= 5;
  return score;
}

function kindOrder(kind: WorkflowCapabilityKind) {
  switch (kind) {
    case "core_node": return 0;
    case "connected_tool": return 1;
    case "agent": return 2;
  }
}

export function rankWorkflowCapabilities(
  candidates: WorkflowCapabilityCandidate[],
  input: Pick<WorkflowCapabilitySearchQuery, "q" | "limit" | "kind">,
) {
  return candidates
    .filter((candidate) => !input.kind || candidate.kind === input.kind)
    .map((candidate) => ({
      candidate,
      score: capabilityScore(candidate, input.q),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      kindOrder(left.candidate.kind) - kindOrder(right.candidate.kind) ||
      left.candidate.title.localeCompare(right.candidate.title) ||
      left.candidate.id.localeCompare(right.candidate.id),
    )
    .slice(0, input.limit)
    .map(({ candidate }) => candidate);
}

function coreCandidates(): WorkflowCapabilityCandidate[] {
  return workflowNodeDefinitions()
    .filter((definition) => CORE_CAPABILITY_TYPES.has(definition.type))
    .map((definition: WorkflowNodeDefinitionDescriptor) => ({
      id: `core:${definition.type}`,
      kind: "core_node" as const,
      title: definition.displayName,
      description: definition.description,
      nodeType: definition.type,
      configTemplate: coreConfigTemplate(definition.type),
      executionMode: "deterministic" as const,
      sideEffectClass: definition.sideEffectClass,
      riskClass: definition.riskDefault,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      requiredPermissions: definition.authorizationRequirements.map((item) => item.permission),
      availability: { status: "available" as const, reason: null },
      operationalProfile: {
        reliabilityBasis: "static_contract" as const,
        reliabilitySignal: definition.publishState,
        latencyProfile: null,
        costProfile: definition.sideEffectClass === "pure" ? "no_model_inference" : null,
      },
      publishState: definition.publishState,
      publishBlockedReason: definition.publishBlockedReason,
      source: { registryNodeType: definition.type },
    }));
}

export function workflowCapabilityResolverService(db: Db) {
  const connectorDefinition = workflowNodeDefinitions().find(
    (definition) => definition.type === "connector.action",
  );
  const agentDefinition = workflowNodeDefinitions().find(
    (definition) => definition.type === "agent.task",
  );

  return {
    search: async (
      companyId: string,
      rawInput: WorkflowCapabilitySearchQuery,
    ) => {
      const parsed = workflowCapabilitySearchQuerySchema.parse(rawInput);
      const candidateLimit = Math.max(parsed.limit * 6, 100);
      const searchTerms = parsed.q
        .toLocaleLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean);
      const toolTermPredicate = (term: string) => {
        const pattern = `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
        return or(
          ilike(toolCatalogEntries.title, pattern),
          ilike(toolCatalogEntries.name, pattern),
          ilike(toolCatalogEntries.toolName, pattern),
          ilike(toolCatalogEntries.description, pattern),
          ilike(toolConnections.name, pattern),
          ilike(toolApplications.name, pattern),
        );
      };
      const agentTermPredicate = (term: string) => {
        const pattern = `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
        return or(
          ilike(agents.name, pattern),
          ilike(agents.role, pattern),
          ilike(agents.title, pattern),
          ilike(agents.capabilities, pattern),
          ilike(agents.adapterType, pattern),
        );
      };

      const [toolRows, agentRows] = await Promise.all([
        parsed.kind === "core_node" || parsed.kind === "agent"
          ? Promise.resolve([])
          : db
          .select({
            catalogEntry: toolCatalogEntries,
            connection: toolConnections,
            applicationId: toolApplications.id,
            applicationName: toolApplications.name,
            applicationStatus: toolApplications.status,
          })
          .from(toolCatalogEntries)
          .innerJoin(
            toolConnections,
            and(
              eq(toolConnections.companyId, companyId),
              eq(toolConnections.id, toolCatalogEntries.connectionId),
              ne(toolConnections.status, "archived"),
            ),
          )
          .leftJoin(
            toolApplications,
            and(
              eq(toolApplications.companyId, companyId),
              eq(toolApplications.id, toolCatalogEntries.applicationId),
            ),
          )
          .where(
            and(
              eq(toolCatalogEntries.companyId, companyId),
              eq(toolCatalogEntries.entryKind, "tool"),
              eq(toolCatalogEntries.status, "active"),
              ...searchTerms.map(toolTermPredicate),
            ),
          )
          .orderBy(asc(toolCatalogEntries.title), asc(toolCatalogEntries.toolName))
          .limit(candidateLimit),
        parsed.kind === "core_node" || parsed.kind === "connected_tool"
          ? Promise.resolve([])
          : db
          .select({
            id: agents.id,
            name: agents.name,
            role: agents.role,
            title: agents.title,
            status: agents.status,
            capabilities: agents.capabilities,
            adapterType: agents.adapterType,
          })
          .from(agents)
          .where(
            and(
              eq(agents.companyId, companyId),
              ne(agents.status, "terminated"),
              // OpenClaw/external agents require the dedicated attenuated
              // external-agent node contract (V4 PR 27). Do not silently map
              // them onto the native Agent Task node before that boundary exists.
              ne(agents.adapterType, "openclaw_gateway"),
              ...searchTerms.map(agentTermPredicate),
            ),
          )
          .orderBy(asc(agents.name))
          .limit(candidateLimit),
      ]);

      const tools: WorkflowCapabilityCandidate[] = connectorDefinition
        ? toolRows.map(({ catalogEntry, connection, applicationId, applicationName, applicationStatus }) => {
            const availability = toolAvailability({
              applicationStatus,
              connectionStatus: connection.status,
              enabled: connection.enabled,
              healthStatus: connection.healthStatus,
            });
            return {
              id: `tool:${catalogEntry.id}`,
              kind: "connected_tool",
              title: catalogEntry.title?.trim() || catalogEntry.name || catalogEntry.toolName,
              description: catalogEntry.description,
              nodeType: "connector.action",
              configTemplate: {
                toolCatalogEntryId: catalogEntry.id,
                connectionId: connection.id,
                input: {},
              },
              executionMode: "deterministic",
              sideEffectClass: toolSideEffect(catalogEntry),
              riskClass: toolRiskClass(catalogEntry.riskLevel),
              inputSchema: projectedConnectionToolInputSchema(
                connection,
                catalogEntry.inputSchema ?? {},
                catalogEntry.toolName,
              ),
              outputSchema: catalogEntry.outputSchema ?? null,
              requiredPermissions: ["tools:use"],
              availability,
              operationalProfile: {
                reliabilityBasis: "connection_health",
                reliabilitySignal: connection.healthStatus,
                latencyProfile: null,
                costProfile: null,
              },
              publishState: connectorDefinition.publishState,
              publishBlockedReason: connectorDefinition.publishBlockedReason,
              source: {
                catalogEntryId: catalogEntry.id,
                connectionId: connection.id,
                applicationId,
                applicationName,
                connectionName: connection.name,
                toolName: catalogEntry.toolName,
              },
            };
          })
        : [];

      const agentCandidates: WorkflowCapabilityCandidate[] = agentDefinition
        ? agentRows.map((agent) => ({
            id: `agent:${agent.id}`,
            kind: "agent",
            title: agent.title?.trim() || agent.name,
            description:
              [agent.role, agent.capabilities?.trim()].filter(Boolean).join(" · ") || null,
            nodeType: "agent.task",
            configTemplate: {
              agentId: agent.id,
              objective: "Delegate this workflow step",
              waitForCompletion: true,
              expectedOutputSchema: null,
            },
            executionMode: "agent",
            sideEffectClass: agentDefinition.sideEffectClass,
            riskClass: agentDefinition.riskDefault,
            inputSchema: agentDefinition.inputSchema,
            outputSchema: agentDefinition.outputSchema,
            requiredPermissions: ["tasks:assign"],
            availability: agentAvailability(agent.status),
            operationalProfile: {
              reliabilityBasis: "agent_status",
              reliabilitySignal: agent.status,
              latencyProfile: null,
              costProfile: "model_or_agent_runtime",
            },
            publishState: agentDefinition.publishState,
            publishBlockedReason: agentDefinition.publishBlockedReason,
            source: {
              agentId: agent.id,
              adapterType: agent.adapterType,
              agentRole: agent.role,
            },
          }))
        : [];

      const core =
        parsed.kind && parsed.kind !== "core_node" ? [] : coreCandidates();
      const candidates = rankWorkflowCapabilities(
        [...core, ...tools, ...agentCandidates],
        parsed,
      );
      return { query: parsed.q, candidates };
    },
  };
}
