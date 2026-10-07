import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { analyticalLineageManifests, type Db } from "@paperclipai/db";
import { businessEventExportSchema, v7FeatureEnabled, v8FeatureEnabled, type BusinessEventExport, type BusinessEventExportManifest } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV7Authorization, v7HumanActorId } from "./v7-authorization.js";
import { instanceSettingsService } from "./instance-settings.js";
import { currentAnalyticalPurpose } from "./analytical-purpose.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "./v7-mutations.js";
import { businessEventService } from "./business-events.js";
import { retainNativeEventLineage } from "./business-event-lineage.js";
import { BUSINESS_EVENT_EXPORTER_VERSION, OCEL_VERSION, businessEventsToJsonl, businessEventsToOcel2, businessEventsToOcel2Sqlite } from "./business-event-export-formats.js";

export function businessEventExportService(db: Db) {
  return {
    async exportPage(companyId: string, actor: AuthorizationActor, raw: BusinessEventExport) {
      const input = businessEventExportSchema.parse(raw); const human = v7HumanActorId(actor);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await tx.execute(sql`set local statement_timeout='8s'`);
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        await assertV7Authorization(tx, actor, companyId, "audit:view_agent_actions");
        const flags = await instanceSettingsService(tx).getExperimental();
        if (!v8FeatureEnabled(flags, "business_events_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7")
          || (input.format !== "native_jsonl" && !v8FeatureEnabled(flags, "process_ocel_export_v8"))) throw notFound("Governed event export is not enabled");
        const purpose = { governanceObligationRefs: input.governanceObligationRefs, retentionDays: input.retentionDays,
          purpose: "process_intelligence" as const, sensitivity: "internal" as const };
        const policies = await currentAnalyticalPurpose(tx, companyId, purpose, "process");
        const page = await businessEventService(tx).list(companyId, actor, { from: input.from, until: input.until, limit: input.limit, cursor: input.cursor });
        const ocel = businessEventsToOcel2(page.items);
        const payload = input.format === "native_jsonl" ? businessEventsToJsonl(page.items)
          : input.format === "ocel_2_json" ? Buffer.from(JSON.stringify(ocel),"utf8") : await businessEventsToOcel2Sqlite(page.items);
        const now = new Date();
        const expiresAt = new Date(Math.min(now.getTime()+input.retentionDays*86400000, ...page.items.map(event => Date.parse(event.expiresAt))));
        if (expiresAt <= now) throw conflict("An event expired during export; refresh its current source");
        // Recheck the requested policy at the completed artifact's time boundary.
        await currentAnalyticalPurpose(tx, companyId, purpose, "process", now);
        const id = randomUUID(), lineageManifestId = randomUUID();
        const inputHash = nativeSha256(page.items);
        const sourceWatermark = page.nextCursor ? `${page.nextCursor.at}:${page.nextCursor.id}` : page.items.at(-1)?.occurredAt ?? "empty_authorized_page";
        await tx.insert(analyticalLineageManifests).values({ id: lineageManifestId, companyId, analysisType: "business_event_export", analysisRef: id,
          engineVersion: BUSINESS_EVENT_EXPORTER_VERSION, inputHash, definitionHash: nativeSha256({ purpose, format: input.format, exporter: BUSINESS_EVENT_EXPORTER_VERSION }),
          requestedBy: human, sourceWatermark, sourceCount: page.items.length, parameters: input, createdAt: now, expiresAt });
        await retainNativeEventLineage(tx, companyId, lineageManifestId, page.items, policies);
        const manifest: BusinessEventExportManifest = { id, companyId, format: input.format,
          formatVersion: input.format === "native_jsonl" ? "aw-business-events-jsonl-v2" : OCEL_VERSION,
          exporterVersion: BUSINESS_EVENT_EXPORTER_VERSION, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
          payloadHash: createHash("sha256").update(payload).digest("hex"), inputHash, lineageManifestId,
          eventCount: page.items.length, objectCount: ocel.objects.length, coverage: "bounded_current_authorized_page",
          nextCursor: page.nextCursor, window: { from: input.from, until: input.until }, privacy: "current_business_objects_no_person_attributes" };
        await logActivity(tx, { companyId, actorType: "user", actorId: human, action: "business_event.page_exported", entityType: "business_event_export", entityId: id,
          details: { lineageManifestId, format: input.format, payloadHash: manifest.payloadHash, coverage: manifest.coverage } },publications);
        return { manifest, payloadBase64: payload.toString("base64"),
          mimeType: input.format === "native_jsonl" ? "application/x-ndjson" : input.format === "ocel_2_json" ? "application/json" : "application/vnd.sqlite3",
          fileName: `business-events-${id}.${input.format === "native_jsonl" ? "jsonl" : input.format === "ocel_2_json" ? "jsonocel" : "sqlite"}` };
      });
    },
  };
}
