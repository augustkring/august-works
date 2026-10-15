import { expect, it } from "vitest";
import { experienceObservationSurface } from "./experience-observation-surface";
it("classifies actual company routes without retaining their private IDs or URL", () => {
  for (const [path, expected] of [["/ACME/dashboard", "home"], ["/ACME/needs-you", "needs_you"],
    ["/ACME/agents/PRIVATE-ID/maintenance", "maintenance_history"], ["/ACME/memory/maintenance", "maintenance_history"],
    ["/ACME/workflows/PRIVATE-ID/draft", "workflow"], ["/ACME/my-feedback", "support"], ["/ACME/issues/PRIVATE-ID", "other"]])
    expect(experienceObservationSurface(path!, "ACME")).toBe(expected);
  for (const path of ["/auth", "/OTHER/dashboard", "/saas/activation/3", "/ACME"])
    expect(experienceObservationSurface(path, "ACME")).toBeNull();
});
