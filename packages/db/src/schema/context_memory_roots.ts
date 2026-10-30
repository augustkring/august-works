import type { NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { pgTable, uuid, text, jsonb, unique, foreignKey, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { contextManifests } from "./context_manifests.js";
// Source UUID/version survives erasure; the owning manifest still cascades.
export const contextManifestMemoryRoots = pgTable("context_manifest_memory_roots", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), manifestId: uuid("manifest_id").notNull(),
  memoryRecordId: uuid("memory_record_id").notNull(), sourceVersion: text("source_version").notNull(),
  // Exact then-selected body closure; NULL historical roots remain unknown.
  payloadSourceSnapshot: jsonb("payload_source_snapshot").$type<NativePayloadSourceSnapshot | null>(),
}, (t) => ({ rootUq: unique("context_memory_roots_manifest_record_uq").on(t.manifestId, t.memoryRecordId),
  manifestFk: foreignKey({ name: "context_memory_roots_manifest_fk", columns: [t.companyId, t.manifestId], foreignColumns: [contextManifests.companyId, contextManifests.id] }).onDelete("cascade"),
  sourceIdx: index("context_memory_roots_company_record_idx").on(t.companyId, t.memoryRecordId),
}));
