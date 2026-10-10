import { z } from "zod";

/** The existing native installation owns desired state; scan observations confer no authority. */
export const packageStewardReviewSchema = z.strictObject({
  expectedInstallationVersion: z.number().int().positive(),
  expectedInstalledVersionId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  expectedReleaseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PackageStewardReview = z.infer<typeof packageStewardReviewSchema>;
export const PACKAGE_MAINTENANCE_POLICY_VERSION = "aw-v9-package-maintenance-1";
export const PACKAGE_MAINTENANCE_LIMITS = Object.freeze({
  maximumResourcesPerCompanyPerScan: 1,
  maximumResourcesPerScan: 20,
  maximumAttemptsPerResourcePerDay: 3,
  maximumAttemptsPerCompanyPerDay: 10,
  maximumTransactionSeconds: 5,
});
export function packageStewardReviewIsCurrent(
  review: PackageStewardReview,
  source: {
    version: number;
    installedVersionId: string;
    updatedAt: Date;
  },
  releaseContentHash: string,
) {
  return (
    review.expectedInstallationVersion === source.version &&
    review.expectedInstalledVersionId === source.installedVersionId &&
    review.expectedUpdatedAt === source.updatedAt.toISOString() &&
    review.expectedReleaseContentHash === releaseContentHash
  );
}
/** Durable attempt starts and legacy unlinked configured receipts consume the budget.
 * Unknown outcomes additionally block the unchanged native source without expiry. */
export function packageMaintenanceRecurrenceAllows(
  resourceAttempts: number,
  companyAttempts: number,
) {
  return (
    Number.isSafeInteger(resourceAttempts) &&
    resourceAttempts >= 0 &&
    Number.isSafeInteger(companyAttempts) &&
    companyAttempts >= resourceAttempts &&
    resourceAttempts <
      PACKAGE_MAINTENANCE_LIMITS.maximumAttemptsPerResourcePerDay &&
    companyAttempts < PACKAGE_MAINTENANCE_LIMITS.maximumAttemptsPerCompanyPerDay
  );
}
