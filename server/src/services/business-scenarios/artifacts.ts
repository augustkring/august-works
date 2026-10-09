import type { Db } from "@paperclipai/db";
import { matchesBusinessScenarioArtifactSchema, type BusinessScenarioDefinition, type BusinessScenarioCapturedInput, type BusinessScenarioUnit } from "@paperclipai/shared";
import { conflict, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { automationArtifactRuntimeService } from "../automation-artifacts/automation-artifact-runtime.js";
import type { AutomationArtifactMutationActor } from "../automation-artifacts/automation-artifact-service.js";

function artifactActor(actor: AuthorizationActor): AutomationArtifactMutationActor {
  const userId = v7HumanActorId(actor);
  // This is the same local-board principal as the canonical artifact routes,
  // after scenario and workflow company permissions have both been admitted.
  return actor.type === "board" && actor.source === "local_implicit"
    ? { principal: { type: "system", service: "local-board" } }
    : { principal: { type: "user", userId } };
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
/** Units are explicitly declared, hash-bound native artifact schema annotations.
 * They are not proof of scientific validity or empirical business calibration. */
export function assertScenarioArtifactSchema(schema: Record<string, unknown>, units: Record<string, BusinessScenarioUnit>) {
  if (!matchesBusinessScenarioArtifactSchema(schema, units)) {
    throw conflict("Artifact input/output schema must exactly bind numeric names and declared scenario units", { code: "scenario_artifact_unit_contract_required" });
  }
}
export async function inspectScenarioArtifact(
  tx: Db, companyId: string, actor: AuthorizationActor, definition: BusinessScenarioDefinition, requireCurrent: boolean,
) {
  if (definition.calculationType !== "validated_automation_artifact") return null;
  const ref = definition.calculationRef!;
  await assertV7Authorization(tx, actor, companyId, "workflows:read");
  const admitted = await automationArtifactRuntimeService(tx).inspectPinnedBinding(companyId, ref.artifactId, ref.versionId, artifactActor(actor), requireCurrent);
  const binding = admitted.binding;
  if (binding.contentHash !== ref.contentHash || binding.sideEffectClass !== "pure" || !["C0", "C1"].includes(binding.riskClass)
    || !["expression", "transform", "typescript"].includes(binding.kind) || admitted.optimizerDerived) {
    throw conflict("Scenario requires an exact pure C0/C1 artifact with qualified source ownership", { code: "scenario_artifact_binding_not_admitted" });
  }
  assertScenarioArtifactSchema(binding.inputSchema, Object.fromEntries([...definition.inputs, ...definition.assumptions].map(input => [input.key, input.unit])));
  assertScenarioArtifactSchema(binding.outputSchema, Object.fromEntries(definition.outputs.map(output => [output.key, output.unit])));
  return admitted;
}
/** Actual execution goes through the canonical runtime gates and sandbox.
 * Only authorized captured numbers and human assumption numbers are supplied. */
export async function executeScenarioArtifact(
  tx: Db, companyId: string, actor: AuthorizationActor, definition: BusinessScenarioDefinition,
  captured: BusinessScenarioCapturedInput[], deadline: number,
) {
  const ref = definition.calculationRef!;
  const runtime = automationArtifactRuntimeService(tx);
  const cases: Record<string, Record<string, number>> = Object.create(null);
  for (const scenarioCase of definition.cases) {
    const remaining = deadline - performance.now();
    if (remaining < 100) throw unprocessable("Scenario artifact exceeds its bounded execution budget");
    const values = Object.fromEntries([...captured.map(input => [input.key, input.value]), ...definition.assumptions.map(input => [input.key, input.nominal])]);
    for (const change of scenarioCase.changes) values[change.assumptionKey] = change.value;
    const executed = await runtime.execute(companyId, ref.artifactId, ref.versionId, values, artifactActor(actor), { timeoutMs: Math.min(1500, Math.floor(remaining)), deterministic: true });
    if (executed.binding.contentHash !== ref.contentHash) throw conflict("Scenario artifact binding changed during execution");
    const output = object(executed.output);
    if (!output || Object.keys(output).length !== definition.outputs.length || definition.outputs.some(item => !Object.hasOwn(output, item.key) || typeof output[item.key] !== "number" || !Number.isFinite(output[item.key]))) {
      throw unprocessable("Scenario artifact did not return every exact finite numeric output", { code: "scenario_artifact_output_contract_mismatch" });
    }
    cases[scenarioCase.key] = output as Record<string, number>;
  }
  return { binding: ref, cases };
}
