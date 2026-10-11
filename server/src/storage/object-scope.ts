import { createHash } from "node:crypto";
import type { StorageService } from "./types.js";

/** Private identity of the configured object namespace, never credentials.
 * Replacing the physical resource behind an unchanged locator still requires
 * the original operating migration/restore owner; a hash cannot certify it. */
export function storageScopeIdentity(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(["aw-storage-scope-v1", ...parts])).digest("hex");
}

export function storageScopeMatches(storage: Pick<StorageService, "scopeId">, original: string | null | undefined): boolean {
  return typeof original === "string" && /^[a-f0-9]{64}$/.test(original) && storage.scopeId === original;
}
