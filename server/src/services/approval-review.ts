import type { approvals } from "@paperclipai/db";
import { nativeSha256 } from "./native-runtime/canonical.js";

/** A private material binding, never a permission or an execution receipt. */
export function approvalReviewHash(value: Pick<typeof approvals.$inferSelect, "id" | "companyId" | "type" | "status" | "payload" | "updatedAt">) {
  return nativeSha256({ id: value.id, companyId: value.companyId, type: value.type,
    status: value.status, payload: value.payload, updatedAt: value.updatedAt.toISOString() });
}
