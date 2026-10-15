import type { ExperienceObservation } from "@paperclipai/shared";
import { getCompanyPathSegments } from "./shell-navigation";

/** Classify locally, then discard the route. Neither path nor query enters
 * the observation schema, a queued payload or client persistence. */
export function experienceObservationSurface(pathname: string, companyPrefix: string | undefined): ExperienceObservation["surface"] | null {
  const segments = getCompanyPathSegments(pathname, companyPrefix), root = segments[0];
  if (!root) return null;
  if (["dashboard", "overview", "home"].includes(root)) return "home";
  if (root === "needs-you") return "needs_you";
  if (root === "agents" && segments.includes("maintenance") || root === "memory" && segments[1] === "maintenance") return "maintenance_history";
  if (root === "agents") return "agents";
  if (root === "workflows") return "workflow";
  if (root === "support" || root === "my-feedback") return "support";
  return "other";
}
