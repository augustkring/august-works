import { describe, it, expect } from "vitest";
import {
  SPECIALIST_KEYS,
  SPECIALIST_CANDIDATES,
  specialistCompletionContract,
  specialistReleaseCandidate,
  specialistEvaluationSchema,
  orchestrationCompletionSchema,
  internalSourceReviewRelease,
  BLENTERA_MANAGED_STARTER_PROFILE,
  managedCustomerStarterReleaseCandidate,
} from "@paperclipai/shared";
import {
  packageReleaseBlockers,
  packageChangeIsMaterial,
} from "../services/agent-packages/package-policy.js";
import { randomUUID } from "node:crypto";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
const ref = {
  uri: "https://qualification.test.invalid/qualification/fixture",
  sha256: "a".repeat(64),
};
const evidence = {
  sbom: ref,
  provenance: ref,
  signature: null,
  scan: ref,
  evaluations: ref,
  protectedHoldout: ref,
  sandboxQualification: null,
  releaseAuthorization: ref,
  unresolvedCritical: [],
  evaluatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
const components = ["role_pack", "skill", "playbook", "eval_suite"].map(
  (type) => ({
    key: type,
    type,
    sourceVersion: "1",
    contentHash: "a".repeat(64),
    source: ref,
    required: true,
  }),
) as Parameters<typeof specialistReleaseCandidate>[1]["components"];
describe("first-party specialist candidate release boundaries", () => {
  for (const key of SPECIALIST_KEYS) {
    it(`${key} uses native draft-only authority and independently reviewable case contracts`, () => {
      const release = specialistReleaseCandidate(key, {
        sourceRevision: "a".repeat(40),
        version: "1.0.0",
        components: components.map((c) =>
          c.type === "eval_suite"
            ? {
                ...c,
                contentHash: nativeSha256(
                  SPECIALIST_CANDIDATES[key].cases.map((s) => ({
                    caseKey: s.key,
                    contract: specialistCompletionContract(key, s.key),
                  })),
                ),
              }
            : c,
        ),
        releaseEvidence: evidence,
      });
      expect(release.manifest.actionClasses).toEqual(["internal_draft"]);
      expect(release.manifest.requiredKnowledge).toEqual([]);
      expect(release.manifest.requiredConnections).toEqual([]);
      expect(release.manifest.humanApproval).toBe("before_material_action");
      expect(release.manifest.verification).toBe("independent_native");
      expect(release.manifest.prohibitedUses).toContain(
        "Changing access or company policy",
      );
      for (const scenario of SPECIALIST_CANDIDATES[key].cases) {
        const contract = orchestrationCompletionSchema.parse(
          specialistCompletionContract(key, scenario.key),
        );
        expect(contract.businessInvariants).toEqual([...scenario.invariants]);
        expect(contract.prohibitedOutcomes).toContain(
          "Self-certification of completed work",
        );
      }
      expect(packageReleaseBlockers(release)).toContain(
        "Customer release requires separate customerDemand evidence",
      );
      expect(
        packageReleaseBlockers({
          ...release,
          releaseEvidence: { ...evidence, customerDemand: ref },
        }),
      ).toEqual([]);
      expect(
        packageChangeIsMaterial(release, {
          ...release,
          manifest: {
            ...release.manifest,
            requiredKnowledge: ["company.brand"],
          },
        }),
      ).toBe(true);
    });
  }
  it("rejects specialist releases without a native Skill, Playbook or eval pin", () => {
    for (const removed of ["role_pack", "skill", "playbook", "eval_suite"])
      expect(() =>
        specialistReleaseCandidate("aw-growth-specialist", {
          sourceRevision: "a".repeat(40),
          version: "1.0.0",
          components: components.filter((c) => c.type !== removed),
          releaseEvidence: evidence,
        }),
      ).toThrow();
  });
  it("does not retroactively require customer demand for the internal protocol fixture", () => {
    const release = internalSourceReviewRelease({
      sourceRevision: "a".repeat(40),
      roleComponent: components[0]!,
      releaseEvidence: evidence,
    });
    expect(packageReleaseBlockers(release)).toEqual([]);
  });
  it("builds the versioned managed starter as a bounded candidate and keeps release qualification closed", () => {
    const specialistCaseSuite = nativeSha256(SPECIALIST_CANDIDATES[BLENTERA_MANAGED_STARTER_PROFILE.packageKey].cases.map((scenario) => ({
      caseKey: scenario.key,
      contract: specialistCompletionContract(BLENTERA_MANAGED_STARTER_PROFILE.packageKey, scenario.key),
    })));
    const starterComponents = components.map((component) => component.type === "eval_suite"
      ? { ...component, key: BLENTERA_MANAGED_STARTER_PROFILE.evaluation.suiteComponentKey,
          sourceVersion: BLENTERA_MANAGED_STARTER_PROFILE.evaluation.suiteVersion, contentHash: specialistCaseSuite }
      : component);
    const release = managedCustomerStarterReleaseCandidate({
      sourceRevision: "c".repeat(40),
      components: starterComponents,
      releaseEvidence: { ...evidence, customerDemand: null },
    });
    expect(BLENTERA_MANAGED_STARTER_PROFILE).toMatchObject({
      profileKey: "v10-managed-customer-starter", version: "1.0.0", packageKey: "blentera-meeting-notes-starter",
      evaluation: { suiteComponentKey: "starter-evaluations", suiteVersion: "1.0.0",
        judgments: [
          "source_fidelity: every factual statement is supported by the supplied meeting notes or marked as uncertain",
          "commitment_status: distinguish proposed follow-ups from commitments the participants explicitly agreed",
          "owner_and_deadline: do not invent an owner or deadline; leave unknown fields explicit for Human review",
        ] },
      authority: { maximumRisk: "C1", actionClasses: ["internal_draft"], externalCommunication: false, toolsGranted: false },
      sourceScope: { maximumCharacters: null, testedInputLimitsRequiredBeforeRelease: true, activationIntentCharacters: 4000, retainedMemory: false },
      defaults: { enabledConnections: [], externalActions: false, automaticScheduling: false },
      execution: { currentV9ActivationOwnerMaximumModelCostMinor: 0, exactCurrentWorkerModelQualificationRequired: true },
    });
    expect(release).toMatchObject({ packageKey: "blentera-meeting-notes-starter", name: "Meeting follow-up drafts", version: "1.0.0", manifest: {
      audience: "customer", maximumRisk: "C1", actionClasses: ["internal_draft"],
      purpose: BLENTERA_MANAGED_STARTER_PROFILE.intent,
      onboardingQuestions: [
        "Which meeting notes should become an internal follow-up draft?",
        "Which people or dates should remain explicit placeholders for your review?",
      ],
      requiredKnowledge: [], requiredConnections: [], optionalConnections: [],
      memoryPolicy: "no_persistent_memory", runtimeProviders: ["paperclip_native"],
    } });
    expect(packageReleaseBlockers(release)).toContain("Customer release requires separate customerDemand evidence");
    expect(release.manifest.commercialProductKey).toBe("agent_package_chief_of_staff");
    expect(release.components.find((component) => component.key === BLENTERA_MANAGED_STARTER_PROFILE.evaluation.suiteComponentKey)?.contentHash)
      .toBe(specialistCaseSuite);
    expect(SPECIALIST_CANDIDATES[BLENTERA_MANAGED_STARTER_PROFILE.packageKey].cases.map((scenario) => scenario.invariants[0]))
      .toEqual([...BLENTERA_MANAGED_STARTER_PROFILE.evaluation.judgments]);
    expect(release.packageKey).not.toBe("aw-chief-of-staff");
    expect(packageReleaseBlockers(release)).not.toContain("Specialist release must pin the declared native case-contract suite");
  });
  it("cannot count one review as multiple representative cases", () => {
    const id = randomUUID();
    expect(
      specialistEvaluationSchema.safeParse({
        installationId: randomUUID(),
        cases: [
          { caseKey: "synthesis", verificationRunId: id },
          { caseKey: "validation", verificationRunId: id },
        ],
      }).success,
    ).toBe(false);
    expect(() =>
      specialistCompletionContract("aw-research-specialist", "made-up-success"),
    ).toThrow();
  });
});
