import type { WorkflowDetail } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { ExperienceOverloadError } from "./projection.js";

/** The complete current binding includes timestamps and bounded private
 * material. Return only a digest; it is neither an API field nor a grant. */
export function workflowReviewBinding(detail: WorkflowDetail) {
  const encoded = JSON.stringify(detail);
  if (Buffer.byteLength(encoded, "utf8") > 262144)
    throw new ExperienceOverloadError("Complete workflow review exceeds its material budget");
  // Native canonical hashing treats Date objects as generic objects. Normalize
  // this read's timestamps to their actual JSON values before binding them.
  return nativeSha256(JSON.parse(encoded));
}
