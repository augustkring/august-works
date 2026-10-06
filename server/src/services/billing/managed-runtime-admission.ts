import { and, eq, or } from "drizzle-orm";
import {
  runtimeCells,
  agentPresenceRuntimeBindings,
  type Db,
} from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { runtimeCommercialReason } from "../runtime/commercial.js";

/** The actual company/presence/cell generation resolves commercial scope.
 * Model-supplied URLs or a claimed BYO label cannot bypass managed capacity. */
export async function assertManagedRuntimeCommercialAuthority(
  db: Db,
  companyId: string,
  agentId: string,
) {
  const [binding] = await db
    .select()
    .from(agentPresenceRuntimeBindings)
    .where(
      and(
        eq(agentPresenceRuntimeBindings.companyId, companyId),
        eq(agentPresenceRuntimeBindings.agentId, agentId),
      ),
    )
    .limit(1);
  if (!binding) return;
  const profile =
    /^aw:cell:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):generation:([1-9][0-9]*)$/i.exec(
      binding.providerProfileRef,
    );
  const [cell] = await db
    .select()
    .from(runtimeCells)
    .where(
      and(
        eq(runtimeCells.companyId, companyId),
        profile
          ? or(
              eq(runtimeCells.id, profile[1]!),
              eq(runtimeCells.providerBindingId, binding.providerBindingId),
            )
          : eq(runtimeCells.providerBindingId, binding.providerBindingId),
      ),
    )
    .limit(1);
  if (!cell && !profile) return;
  if (
    !cell ||
    cell.deletedAt ||
    cell.providerBindingId !== binding.providerBindingId ||
    binding.providerProfileRef !==
      `aw:cell:${cell.id}:generation:${cell.generation}` ||
    cell.status !== "HEALTHY" ||
    cell.suspendedReason ||
    (await runtimeCommercialReason(db, cell, new Date()))
  )
    throw forbidden(
      "This managed runtime needs current commercial capacity and healthy runtime authority",
      { code: "MANAGED_RUNTIME_CAPACITY_REQUIRED" },
    );
}
