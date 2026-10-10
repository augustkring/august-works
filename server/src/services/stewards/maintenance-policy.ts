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
  maximumConfiguredChangesPerResourcePerDay: 3,
  maximumConfiguredChangesPerCompanyPerDay: 10,
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
/** These budgets cover configured changes. Failed-attempt/unknown-outcome admission
 * and external repairs require their own durable native contracts before automation. */
export function packageMaintenanceRecurrenceAllows(
  resourceConfigured: number,
  companyConfigured: number,
) {
  return (
    Number.isSafeInteger(resourceConfigured) &&
    resourceConfigured >= 0 &&
    Number.isSafeInteger(companyConfigured) &&
    companyConfigured >= resourceConfigured &&
    resourceConfigured <
      PACKAGE_MAINTENANCE_LIMITS.maximumConfiguredChangesPerResourcePerDay &&
    companyConfigured <
      PACKAGE_MAINTENANCE_LIMITS.maximumConfiguredChangesPerCompanyPerDay
  );
}
