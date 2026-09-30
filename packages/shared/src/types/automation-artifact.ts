import type {
  WorkflowJsonSchema,
  WorkflowRiskClass,
  WorkflowSideEffectClass,
} from "./workflow.js";

export const AUTOMATION_ARTIFACT_KINDS = [
  "expression",
  "transform",
  "typescript",
  "python",
  "tool_chain",
  "subworkflow",
] as const;
export type AutomationArtifactKind =
  (typeof AUTOMATION_ARTIFACT_KINDS)[number];

export const AUTOMATION_ARTIFACT_LANGUAGES = [
  "typescript",
  "python",
] as const;
export type AutomationArtifactLanguage =
  (typeof AUTOMATION_ARTIFACT_LANGUAGES)[number];

export const AUTOMATION_ARTIFACT_STATUSES = [
  "candidate",
  "testing",
  "shadow",
  "active",
  "deprecated",
  "revoked",
  "failed",
] as const;
export type AutomationArtifactStatus =
  (typeof AUTOMATION_ARTIFACT_STATUSES)[number];

export interface AutomationArtifact {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  kind: AutomationArtifactKind;
  language: AutomationArtifactLanguage | null;
  inputSchema: WorkflowJsonSchema;
  outputSchema: WorkflowJsonSchema;
  riskClass: WorkflowRiskClass;
  sideEffectClass: WorkflowSideEffectClass;
  status: AutomationArtifactStatus;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdByOptimizerSuggestionId: string | null;
  originWorkflowId: string | null;
  originNodeId: string | null;
  latestVersionId: string | null;
  successCount: number;
  failureCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface AutomationArtifactVersion {
  id: string;
  companyId: string;
  artifactId: string;
  versionNumber: number;
  sourceCode: string;
  inputSchema: WorkflowJsonSchema;
  outputSchema: WorkflowJsonSchema;
  dependencyManifest: Record<string, unknown>;
  testSpec: Record<string, unknown>;
  validationReport: Record<string, unknown> | null;
  securityReport: Record<string, unknown> | null;
  contentHash: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface AutomationArtifactDetail {
  artifact: AutomationArtifact;
  latestVersion: AutomationArtifactVersion | null;
}

export interface AutomationArtifactRuntimeBinding {
  artifactId: string;
  artifactVersionId: string;
  companyId: string;
  kind: AutomationArtifactKind;
  language: AutomationArtifactLanguage | null;
  inputSchema: WorkflowJsonSchema;
  outputSchema: WorkflowJsonSchema;
  riskClass: WorkflowRiskClass;
  sideEffectClass: WorkflowSideEffectClass;
  contentHash: string;
  sourceCode: string;
  dependencyManifest: Record<string, unknown>;
}
