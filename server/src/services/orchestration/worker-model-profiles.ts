import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";
import { forbidden } from "../../errors.js";
import {
  modelQualificationProfileSchema,
  checkModelQualificationProvider,
  assertModelQualificationMetadata,
} from "./read-only-model-profiles.js";

/** Price/token qualification is separate from independent judge calibration.
 * Both server text and fixed-origin managed Messages transports are admitted;
 * no arbitrary CLI provider or direct provider egress is qualified. */
export const workerModelProfileSchema = modelQualificationProfileSchema
  .extend({
    workerAgentId: z.string().uuid(),
    transport: z.enum(["server-text-only-v1", "server-anthropic-messages-v1"]),
    providerBindingId: z.string().uuid(),
    providerSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    providerProfileRef: z.string().min(1).max(200),
    qualifiedConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((profile, context) => {
    checkModelQualificationProvider(profile, context);
    const expectedContract = profile.transport === "server-text-only-v1"
      ? "anthropic-text-messages-2023-06-01"
      : "anthropic-messages-tools-2023-06-01";
    if (profile.contract !== expectedContract)
      context.addIssue({ code: "custom", message: "Worker model transport and price qualification contract disagree" });
  });
export type WorkerModelProfile = z.infer<typeof workerModelProfileSchema>;

/** The current canonical configuration selects one installed qualification.
 * An unselected alternative never becomes a default or supplies another
 * presence's credential, price or qualification. */
export function selectWorkerModelProfile(profiles: readonly WorkerModelProfile[], input: {
  companyId: string; agentId: string; profileId?: string; configurationHash?: string; sourceSha: string; protectedEvidenceOrigin: string;
}) {
  if (input.profileId === undefined && input.configurationHash === undefined)
    throw forbidden("The exact installed worker model qualification is required");
  const matches = profiles.filter(p => p.companyId === input.companyId && p.workerAgentId === input.agentId &&
    (input.profileId === undefined || p.id === input.profileId) &&
    (input.configurationHash === undefined || p.qualifiedConfigurationHash === input.configurationHash));
  if (matches.length !== 1) throw forbidden("The exact installed worker model qualification is required");
  return assertWorkerModelProfileCurrent(matches[0]!, input.sourceSha, input.protectedEvidenceOrigin);
}

export function assertWorkerModelProfileCurrent(
  raw: WorkerModelProfile,
  sourceSha: string,
  protectedOrigin: string,
) {
  const p = workerModelProfileSchema.parse(raw);
  assertModelQualificationMetadata(p, sourceSha, protectedOrigin);
  return p;
}

export function loadWorkerModelProfiles(
  path: string | undefined,
  expectedSha256: string | undefined,
): WorkerModelProfile[] {
  if (!path && !expectedSha256) return [];
  if (
    !path?.startsWith("/") ||
    !expectedSha256 ||
    !/^[a-f0-9]{64}$/.test(expectedSha256)
  )
    throw new Error("worker_model_profile_pin_required");
  const real = realpathSync(path),
    stat = statSync(real);
  if (
    !stat.isFile() ||
    stat.size > 1048576 ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    throw new Error("worker_model_profile_file_not_private");
  const bytes = readFileSync(real);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
    throw new Error("worker_model_profile_digest_changed");
  let data: unknown;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("worker_model_profile_json_invalid");
  }
  const profiles = z.array(workerModelProfileSchema).max(100).parse(data);
  if (
    new Set(profiles.map((p) => `${p.companyId}:${p.workerAgentId}:${p.qualifiedConfigurationHash}`)).size !==
      profiles.length ||
    new Set(profiles.map((p) => p.id)).size !== profiles.length
  )
    throw new Error("worker_model_profiles_ambiguous");
  return profiles;
}
