import { describe, expect, it } from "vitest";
import type {
  UseCasePurpose,
  OversightProfile,
  UseCaseAssessment,
} from "@paperclipai/shared";
import {
  classifyGovernanceChange,
  useCaseDeploymentBlockers,
} from "../services/ai-governance/governance-policy.js";
import { purpose, oversight, reviews } from "./helpers/governance-fixture.js";
describe("authoritative deployment-purpose gates", () => {
  it("distinguishes exact purpose, operator-role and regulatory material changes", () => {
    const before = purpose();
    expect(classifyGovernanceChange(before, purpose()).classification).toBe(
      "no_material_governance_change",
    );
    const changed = purpose();
    changed.intendedPurpose = "Prepare outbound business campaigns";
    expect(classifyGovernanceChange(before, changed).classification).toBe(
      "operator_role_reassessment_required",
    );
    changed.peopleDomain = "hiring";
    expect(classifyGovernanceChange(before, changed).classification).toBe(
      "regulatory_reclassification_required",
    );
  });
  it.each([
    "employment",
    "worker_monitoring",
    "hiring",
    "person_decision",
    "emotion_inference",
    "social_scoring",
    "sensitive_trait_inference",
  ] as const)(
    "does not unlock %s from a generic human assessment",
    (peopleDomain) => {
      expect(
        useCaseDeploymentBlockers(
          { ...purpose(), peopleDomain },
          oversight,
          reviews(),
        ),
      ).toContain("specialized_people_domain_overlay_not_qualified");
    },
  );
  it("requires current review, meaningful oversight and every version-bound framework", () => {
    expect(
      useCaseDeploymentBlockers(
        purpose(),
        oversight,
        reviews(),
        new Date("2026-10-05"),
      ),
    ).toEqual([]);
    expect(
      useCaseDeploymentBlockers(
        purpose(),
        oversight,
        [],
        new Date("2026-10-05"),
      ),
    ).toHaveLength(3);
    expect(
      useCaseDeploymentBlockers(
        purpose(),
        { ...oversight, mode: "monitor_only" },
        reviews(),
      ),
    ).toContain("material_action_requires_human_review");
    expect(
      useCaseDeploymentBlockers(
        purpose(),
        oversight,
        reviews(),
        new Date("2027-01-01"),
      ),
    ).toContain("purpose_review_due");
  });
  it("does not override a high-risk or prohibited assessment with a later generic safe label", () => {
    const evidence = reviews();
    evidence.push({ ...evidence[0]!, classification: "high_risk" });
    expect(useCaseDeploymentBlockers(purpose(), oversight, evidence)).toContain(
      "deployment_classification_requires_qualified_overlay",
    );
  });
});
