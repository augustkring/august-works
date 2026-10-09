import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { governanceObligations, type Db } from "@paperclipai/db";
import { governanceObligationSchema, type BusinessMetricDefinition, type GovernanceObligation } from "@paperclipai/shared";
import { conflict } from "../errors.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import {assertMemorySourcesRetained} from "./memory/memory-privacy.js";

/** Reuse the canonical governance owner. Ordinary legal evidence is insufficient
 * to approve an analytical population or purpose. */
type PurposeProfile = NonNullable<GovernanceObligation["analyticalPurpose"]>;
export type AnalyticalPurposeDefinition = Pick<BusinessMetricDefinition, "governanceObligationRefs" | "sensitivity" | "retentionDays"> & { purpose: PurposeProfile["purpose"] };
export async function currentAnalyticalPurpose(tx: Db, companyId: string, definition: AnalyticalPurposeDefinition, capability: PurposeProfile["capabilities"][number], now = new Date()) {
  const refs = [...new Set(definition.governanceObligationRefs)];
  const rows = await tx.select().from(governanceObligations).where(and(eq(governanceObligations.companyId, companyId), inArray(governanceObligations.id, refs))).for("share");
  if (rows.length !== refs.length) throw conflict("Current company analytical purpose evidence is required");
  await assertMemorySourcesRetained(tx,companyId,refs.map(id=>({sourceProvider:"august_works_analytical_input",sourceRef:`governance_obligation://${id}`})));
  let approved = false;
  for (const row of rows) {
    const parsed = governanceObligationSchema.safeParse(row.obligation);
    if (!parsed.success || nativeSha256(parsed.data) !== row.obligationHash
      || parsed.data.applicabilityState !== "applicable" || new Date(parsed.data.effectiveFrom) > now
      || (parsed.data.effectiveUntil !== null && new Date(parsed.data.effectiveUntil) <= now)
      || row.nextReviewAt <= now || new Date(parsed.data.nextReviewAt) <= now)
      throw conflict("Analytical purpose evidence is unavailable, expired or requires review");
    const [latest] = await tx.select({ id: governanceObligations.id }).from(governanceObligations).where(and(
      eq(governanceObligations.companyId, companyId),
      sql`${governanceObligations.obligation}->>'framework' = ${parsed.data.framework}`,
      sql`${governanceObligations.obligation}->>'authority' = ${parsed.data.authority}`,
      sql`${governanceObligations.obligation}->>'citation' = ${parsed.data.citation}`,
      sql`${governanceObligations.obligation}->>'jurisdictionOrScope' = ${parsed.data.jurisdictionOrScope}`,
    )).orderBy(desc(governanceObligations.createdAt), desc(governanceObligations.id)).limit(1).for("share");
    if (latest?.id !== row.id) throw conflict("Analytical purpose evidence was superseded; publish a definition with current evidence");
    const purpose = parsed.data.analyticalPurpose;
    if (purpose && (purpose.status !== "approved" || purpose.purpose !== definition.purpose || !purpose.capabilities.includes(capability)
      || !purpose.permittedSensitivity.includes(definition.sensitivity) || definition.retentionDays > purpose.maxRetentionDays))
      throw conflict("Analytical use exceeds its approved purpose and capability");
    if (purpose && parsed.data.framework === "company_policy") approved = true;
  }
  if (!approved) throw conflict("An approved company analytical purpose is required; legal evidence alone is insufficient");
  return rows;
}
