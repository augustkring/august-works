/** Read the preference at the action boundary, including changes made while
 * this page stays mounted. CSS cannot override an explicit JS smooth request. */
export function preferredScrollBehavior(requested: ScrollBehavior = "smooth"): ScrollBehavior {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "auto";
  return requested;
}
