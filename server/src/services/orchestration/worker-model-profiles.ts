import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";
import {
  modelQualificationProfileSchema,
  checkModelQualificationProvider,
  assertModelQualificationMetadata,
} from "./read-only-model-profiles.js";

/** Price/token qualification is separate from independent judge calibration.
 * This profile authorizes only the fixed server text transport. It does not
 * qualify an autonomous CLI, managed session or physical sandbox. */
export const workerModelProfileSchema = modelQualificationProfileSchema
  .extend({
    workerAgentId: z.string().uuid(),
    transport: z.literal("server-text-only-v1"),
    providerBindingId: z.string().uuid(),
    providerSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    providerProfileRef: z.string().min(1).max(200),
    qualifiedConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine(checkModelQualificationProvider);
export type WorkerModelProfile = z.infer<typeof workerModelProfileSchema>;

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
    new Set(profiles.map((p) => `${p.companyId}:${p.workerAgentId}`)).size !==
      profiles.length ||
    new Set(profiles.map((p) => p.id)).size !== profiles.length
  )
    throw new Error("worker_model_profiles_ambiguous");
  return profiles;
}
