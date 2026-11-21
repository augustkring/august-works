/** PRIVATE Resource 0565 candidate. Adapter contract is deliberately native:
 * each domain implements the current read/auth/source proof and effective
 * owner/fallback decision using its real owner service. This assembler cannot
 * infer provenance, inspect owner IDs, or grant authorization. */
import { nativeSha256 } from "../../native-runtime/canonical.js";
import type { ExperienceCard } from "@paperclipai/shared";
import type { AuthorizationActor } from "../../authorization.js";
import { readResponsibilityPointersForResolution } from "./responsibility-scan-store.js";
import type { ResponsibilityScanKind } from "./responsibility-scan.js";
import type { Db } from "@paperclipai/db";
import { HttpError } from "../../../errors.js";

export type CurrentNativeResponsibility =
  | { state: "hidden" | "missing" | "stale" }
  | { state: "visible"; currentSourceVersion: string; coveredByAuthorizedHumanOrNativeGroup: boolean;
      classification?: "MUST_REASSIGN" | "CAN_FALL_BACK_TO_AUTHORIZED_GROUP" | "CAN_BE_UNOWNED_TEMPORARILY" };
export type NativeResponsibilityReader = {
  kind: ResponsibilityScanKind;
  /** Must call the real native source get/read and action policy under `actor`,
   * validate current source version, active membership and native owner or
   * explicit group fallback. Return no owner ID, title, payload, or permission. */
  inspectCurrent(actor: AuthorizationActor, companyId: string, resourceId: string): Promise<CurrentNativeResponsibility>;
  title: string;
  href: string;
};
export type ResponsibilitySubset = { needsYou: ExperienceCard[]; coverage: "currently_authorized_subset" };
const BATCH = 40;
const requiredKinds: readonly ResponsibilityScanKind[] = [
  "agent", "deployment", "workflow", "workflow_run", "routine", "connector", "metric", "experiment",
  "decision", "approval", "ai_use_case", "tool_policy", "skill_policy", "billing", "support_case",
  "security_contact", "support_incident_contact",
];

/**
 * Only candidate pointers from the latest complete scan are considered. SQL
 * caps each kind at 40 IDs. Each ID gets a fresh native current read before it
 * can affect a visible card. There is no raw row count, overflow flag, cursor,
 * hasMore, source-kind, or card for unreadable/missing/stale sources.
 */
export async function readAuthorizedResponsibilitySubset(input: {
  db: Db;
  actor: AuthorizationActor;
  companyId: string;
  signal: AbortSignal;
  mayReviewCompanyResponsibility: (actor: AuthorizationActor, companyId: string) => Promise<boolean>;
  nativeReaders: readonly NativeResponsibilityReader[];
  now?: () => Date;
}): Promise<ResponsibilitySubset> {
  const empty: ResponsibilitySubset = { needsYou: [], coverage: "currently_authorized_subset" };
  if (input.actor.type !== "board" || !input.actor.userId || input.actor.source === "local_implicit" ||
      !await input.mayReviewCompanyResponsibility(input.actor, input.companyId)) return empty;
  if (input.nativeReaders.length !== requiredKinds.length ||
      new Set(input.nativeReaders.map(reader => reader.kind)).size !== requiredKinds.length ||
      requiredKinds.some(kind => !input.nativeReaders.some(reader => reader.kind === kind))) throw new Error("responsibility_native_reader_set_incomplete");
  const pointers = await readResponsibilityPointersForResolution(input.db, input.companyId, (input.now ?? (() => new Date()))());
  const visible = new Map<ResponsibilityScanKind, Array<{ id: string; version: string;
    classification: "MUST_REASSIGN" | "CAN_FALL_BACK_TO_AUTHORIZED_GROUP" }>>();
  const readers = new Map(input.nativeReaders.map(reader => [reader.kind, reader]));
  for (const pointer of pointers) {
    input.signal.throwIfAborted();
    const reader = readers.get(pointer.resource_kind)!;
    let result: CurrentNativeResponsibility;
    try { result = await reader.inspectCurrent(input.actor, input.companyId, pointer.resource_id); }
    catch (error) {
      if (error instanceof HttpError && [403, 404].includes(error.status)) continue;
      throw error;
    }
    if (result.state !== "visible" || result.currentSourceVersion !== pointer.source_version || result.coveredByAuthorizedHumanOrNativeGroup) continue;
    const classification = result.classification ?? "MUST_REASSIGN";
    if (classification === "CAN_BE_UNOWNED_TEMPORARILY") continue;
    const rows = visible.get(pointer.resource_kind) ?? [];
    rows.push({ id: pointer.resource_id, version: result.currentSourceVersion, classification });
    visible.set(pointer.resource_kind, rows);
  }
  const needsYou: ExperienceCard[] = [];
  for (const kind of requiredKinds) {
    const rows = visible.get(kind) ?? [];
    if (!rows.length) continue;
    const reader = readers.get(kind)!;
    const source = { domain: "company_responsibility" as const, companyId: input.companyId,
      resourceId: kind, version: nativeSha256(rows.map(row => [row.id, row.version]).sort()),
      observedAt: (input.now ?? (() => new Date()))().toISOString() };
    const classification = rows.some(row => row.classification === "MUST_REASSIGN") ? "MUST_REASSIGN" : "CAN_FALL_BACK_TO_AUTHORIZED_GROUP";
    needsYou.push({ id: `company-responsibility:${input.companyId}:${kind}`, kind: "recovery", source, freshness: "fresh",
      title: classification === "MUST_REASSIGN" ? `Reassign ${reader.title.toLowerCase()} responsibility` : `Review ${reader.title.toLowerCase()} coverage`,
      whyYou: "You can manage company access. This card covers only the resources you can currently read.",
      consequence: `${classification === "MUST_REASSIGN" ? "Assign a current responsible Human" : "Use the existing authorized group"} for ${rows.length} currently readable ${reader.title.toLowerCase()} ${rows.length === 1 ? "through" : "through"} its native owner flow. This does not grant access.`,
      evidence: [`company_responsibility_${classification}`, kind],
      actions: [{ id: "review-native-owner", label: classification === "MUST_REASSIGN" ? "Reassign responsibility" : `Review ${reader.title.toLowerCase()}`, labelKey: "review",
        operation: "open", href: reader.href, criticality: "C3", source, requiresCurrentAuthorization: true }] });
  }
  input.signal.throwIfAborted();
  if (!await input.mayReviewCompanyResponsibility(input.actor, input.companyId)) return empty;
  return { needsYou, coverage: "currently_authorized_subset" };
}

export const RESPONSIBILITY_POINTERS_PER_KIND_MAX = BATCH;
