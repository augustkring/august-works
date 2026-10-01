import type {
  OptimizerCompilerDependencyManifest,
  OptimizerCompilerGeneratedTestSpec,
  OptimizerCompilerInput,
  OptimizerCompilerResult,
  OptimizerSideEffectRisk,
  WorkflowRiskClass,
  WorkflowSideEffectClass,
  WorkflowNodeV1,
  WorkflowEdgeV1,
} from "@paperclipai/shared";

import {
  AutomationArtifactDeclarativeError,
  validateAutomationArtifactDeclarativeSource,
} from "../automation-artifacts/automation-artifact-declarative.js";

const RISK_ORDER: Record<WorkflowRiskClass, number> = {
  C0: 0,
  C1: 1,
  C2: 2,
  C3: 3,
  C4: 4,
};

const HIGH_EFFECTS = new Set<WorkflowSideEffectClass>([
  "destructive",
  "external_communication",
  "financial",
  "privileged",
]);

function requiredRiskForSuggestion(risk: OptimizerSideEffectRisk): WorkflowRiskClass {
  switch (risk) {
    case "low":
      return "C0";
    case "medium":
      return "C2";
    case "high":
      return "C3";
  }
}

function effectRisk(effect: WorkflowSideEffectClass): OptimizerSideEffectRisk {
  if (HIGH_EFFECTS.has(effect)) return "high";
  if (effect === "write") return "medium";
  return "low";
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function dependencyManifest(
  requiredCapabilityRefs: string[],
): OptimizerCompilerDependencyManifest {
  return {
    capabilityRefs: requiredCapabilityRefs,
    packages: [],
  };
}

function testSpec(
  input: OptimizerCompilerInput,
  requiredCapabilityRefs: string[],
): OptimizerCompilerGeneratedTestSpec {
  return {
    schema: "optimizer.compiler.test_spec.v1",
    suggestionId: input.suggestion.id,
    traceSamples: input.traceSamples.map((sample) => ({ ...sample })),
    businessInvariants: input.businessInvariants.map((invariant) => ({
      ...invariant,
    })),
    requiredCapabilityRefs,
  };
}

function baseResult(
  input: OptimizerCompilerInput,
  requiredCapabilityRefs: string[],
): Pick<
  OptimizerCompilerResult,
  | "dependencyManifest"
  | "generatedTestSpec"
  | "knownAssumptions"
  | "unsupportedCases"
  | "fallbackConditions"
> {
  return {
    dependencyManifest: dependencyManifest(requiredCapabilityRefs),
    generatedTestSpec: testSpec(input, requiredCapabilityRefs),
    knownAssumptions: [
      `workflow_revision:${input.suggestion.workflowRevisionId}`,
      `candidate_span:${input.suggestion.stepOrdinals.join(",")}`,
      "compiler_uses_observed_or_explicit_implementation_only",
      "historical_trace_samples_contain_shapes_and_outcomes_not_raw_values",
    ],
    unsupportedCases: [
      "unseen_input_shape",
      "unseen_output_shape",
      "business_invariant_outside_declared_set",
    ],
    fallbackConditions: [
      "input_schema_mismatch",
      "output_schema_mismatch",
      "business_invariant_failure",
      ...requiredCapabilityRefs.map((ref) => `capability_unavailable:${ref}`),
    ],
  };
}

function unsupported(
  input: OptimizerCompilerInput,
  requiredCapabilityRefs: string[],
  reasonCode: string,
  extraUnsupported: string[] = [],
): OptimizerCompilerResult {
  const base = baseResult(input, requiredCapabilityRefs);
  return {
    status: "unsupported",
    reasonCode,
    candidate: null,
    ...base,
    unsupportedCases: [...base.unsupportedCases, ...extraUnsupported],
  };
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort();
}

function sameStringMultiset(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedStrings(left);
  const b = sortedStrings(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function uuidConfigValue(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const value = config[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
    trimmed,
  )
    ? trimmed
    : null;
}

function subgraphCapabilityRefs(
  nodes: WorkflowNodeV1[],
): string[] {
  const refs: string[] = [];
  for (const node of nodes) {
    const config =
      node.config && typeof node.config === "object" && !Array.isArray(node.config)
        ? (node.config as Record<string, unknown>)
        : {};
    if (node.type === "connector.action") {
      const id = uuidConfigValue(config, "toolCatalogEntryId");
      if (!id) return ["__invalid_connector_capability__"];
      refs.push(`tool:${id}`);
      continue;
    }
    if (node.type.startsWith("agent.")) {
      const id = uuidConfigValue(config, "agentId");
      if (!id) return ["__invalid_agent_capability__"];
      refs.push(`agent:${id}`);
    }
  }
  return uniqueStrings(refs);
}

function subgraphIsClosed(
  nodes: WorkflowNodeV1[],
  edges: WorkflowEdgeV1[],
): boolean {
  const ids = new Set(nodes.map((node) => node.id));
  return edges.every((edge) => ids.has(edge.source) && ids.has(edge.target));
}

export function compileOptimizerCandidate(
  input: OptimizerCompilerInput,
): OptimizerCompilerResult {
  const requiredCapabilityRefs = uniqueStrings(input.suggestion.capabilityRefs);
  const allowedCapabilityRefs = new Set(input.allowedCapabilityRefs);
  const denied = requiredCapabilityRefs.filter(
    (capability) => !allowedCapabilityRefs.has(capability),
  );
  if (denied.length > 0) {
    return unsupported(
      input,
      requiredCapabilityRefs,
      "optimizer_compiler_capability_not_allowed",
      denied.map((capability) => `capability_not_allowed:${capability}`),
    );
  }

  if (
    effectRisk(input.sideEffectClass) !== input.suggestion.sideEffectRisk ||
    RISK_ORDER[input.riskClass] <
      RISK_ORDER[requiredRiskForSuggestion(input.suggestion.sideEffectRisk)]
  ) {
    return unsupported(
      input,
      requiredCapabilityRefs,
      "optimizer_compiler_risk_classification_mismatch",
    );
  }

  if (input.traceSamples.length === 0) {
    return unsupported(
      input,
      requiredCapabilityRefs,
      "optimizer_compiler_trace_samples_required",
    );
  }

  const observedRunIds = new Set(input.suggestion.observedRunIds);
  const unknownRun = input.traceSamples.find(
    (sample) => !observedRunIds.has(sample.runId),
  );
  if (unknownRun) {
    return unsupported(
      input,
      requiredCapabilityRefs,
      "optimizer_compiler_trace_sample_not_observed",
      [`unobserved_run:${unknownRun.runId}`],
    );
  }

  const workflowId = input.suggestion.workflowId;
  if (!workflowId) {
    return unsupported(
      input,
      requiredCapabilityRefs,
      "optimizer_compiler_workflow_provenance_required",
    );
  }

  const common = baseResult(input, requiredCapabilityRefs);
  const implementation = input.observedImplementation;
  if (!implementation) {
    return unsupported(
      input,
      requiredCapabilityRefs,
      "optimizer_compiler_observed_implementation_required",
    );
  }

  if (
    input.suggestion.candidateType === "expression" ||
    input.suggestion.candidateType === "transform"
  ) {
    if (implementation.kind !== input.suggestion.candidateType) {
      return unsupported(
        input,
        requiredCapabilityRefs,
        "optimizer_compiler_implementation_kind_mismatch",
      );
    }
    try {
      validateAutomationArtifactDeclarativeSource(
        input.suggestion.candidateType,
        implementation.sourceCode,
      );
    } catch (error) {
      if (error instanceof AutomationArtifactDeclarativeError) {
        return unsupported(
          input,
          requiredCapabilityRefs,
          "optimizer_compiler_observed_source_invalid",
          [error.code],
        );
      }
      throw error;
    }

    return {
      status: "compiled",
      reasonCode: "optimizer_compiler_artifact_compiled",
      candidate: {
        kind: "artifact",
        artifact: {
          name: `Optimizer ${input.suggestion.candidateType} ${input.suggestion.signatureHash.slice(0, 8)}`,
          description:
            "Deterministic candidate compiled from an evidence-bound optimizer suggestion.",
          kind: input.suggestion.candidateType,
          language: null,
          inputSchema: input.inputSchema,
          outputSchema: input.outputSchema,
          riskClass: input.riskClass,
          sideEffectClass: input.sideEffectClass,
          createdByOptimizerSuggestionId: input.suggestion.id,
          originWorkflowId: workflowId,
          originNodeId: null,
          sourceCode: implementation.sourceCode,
          dependencyManifest: common.dependencyManifest,
          testSpec: common.generatedTestSpec,
        },
      },
      ...common,
    };
  }

  if (
    input.suggestion.candidateType === "tool_chain" ||
    input.suggestion.candidateType === "subworkflow"
  ) {
    const workflowRevisionId = input.suggestion.workflowRevisionId;
    if (!workflowRevisionId) {
      return unsupported(
        input,
        requiredCapabilityRefs,
        "optimizer_compiler_workflow_revision_provenance_required",
      );
    }
    if (
      implementation.kind !== "subgraph" ||
      !sameNumbers(implementation.stepOrdinals, input.suggestion.stepOrdinals) ||
      implementation.nodes.length !== input.suggestion.operationTypes.length ||
      !sameStringMultiset(
        implementation.nodes.map((node) => node.type),
        input.suggestion.operationTypes,
      ) ||
      !subgraphIsClosed(implementation.nodes, implementation.edges)
    ) {
      return unsupported(
        input,
        requiredCapabilityRefs,
        "optimizer_compiler_subgraph_span_mismatch",
      );
    }

    const implementationCapabilityRefs = subgraphCapabilityRefs(
      implementation.nodes,
    );
    if (
      implementationCapabilityRefs.some((ref) => ref.startsWith("__invalid_")) ||
      !sameStringMultiset(
        implementationCapabilityRefs,
        requiredCapabilityRefs,
      )
    ) {
      return unsupported(
        input,
        requiredCapabilityRefs,
        "optimizer_compiler_subgraph_capability_mismatch",
        implementationCapabilityRefs
          .filter((ref) => !requiredCapabilityRefs.includes(ref))
          .map((ref) => `unexpected_subgraph_capability:${ref}`),
      );
    }

    return {
      status: "compiled",
      reasonCode: "optimizer_compiler_subgraph_compiled",
      candidate: {
        kind: "subgraph",
        subgraph: {
          workflowId,
          workflowRevisionId,
          stepOrdinals: [...input.suggestion.stepOrdinals],
          nodes: implementation.nodes.map((node) => structuredClone(node)),
          edges: implementation.edges.map((edge) => structuredClone(edge)),
          inputSchema: structuredClone(input.inputSchema),
          outputSchema: structuredClone(input.outputSchema),
          riskClass: input.riskClass,
          sideEffectClass: input.sideEffectClass,
        },
      },
      ...common,
    };
  }

  if (
    input.suggestion.candidateType === "typescript" ||
    input.suggestion.candidateType === "python"
  ) {
    if (
      implementation.kind !== "generated_code" ||
      implementation.language !== input.suggestion.candidateType
    ) {
      return unsupported(
        input,
        requiredCapabilityRefs,
        "optimizer_compiler_generated_source_required",
        ["generated_code_must_be_explicitly_supplied"],
      );
    }
    if (
      input.suggestion.candidateType === "typescript" &&
      (input.sideEffectClass !== "pure" ||
        !["C0", "C1"].includes(input.riskClass))
    ) {
      return unsupported(
        input,
        requiredCapabilityRefs,
        "optimizer_compiler_generated_code_pilot_denied",
      );
    }

    return {
      status: "compiled",
      reasonCode: "optimizer_compiler_generated_artifact_compiled",
      candidate: {
        kind: "artifact",
        artifact: {
          name: `Optimizer ${input.suggestion.candidateType} ${input.suggestion.signatureHash.slice(0, 8)}`,
          description:
            "Generated-code candidate awaiting artifact validation, replay, and shadow gates.",
          kind: input.suggestion.candidateType,
          language: implementation.language,
          inputSchema: input.inputSchema,
          outputSchema: input.outputSchema,
          riskClass: input.riskClass,
          sideEffectClass: input.sideEffectClass,
          createdByOptimizerSuggestionId: input.suggestion.id,
          originWorkflowId: workflowId,
          originNodeId: null,
          sourceCode: implementation.sourceCode,
          dependencyManifest: common.dependencyManifest,
          testSpec: common.generatedTestSpec,
        },
      },
      ...common,
      unsupportedCases: [
        ...common.unsupportedCases,
        "runtime_requires_artifact_security_qualification",
      ],
      fallbackConditions: [
        ...common.fallbackConditions,
        "runtime_unavailable",
        "security_gate_failure",
      ],
    };
  }

  return unsupported(
    input,
    requiredCapabilityRefs,
    "optimizer_compiler_candidate_type_unsupported",
  );
}
