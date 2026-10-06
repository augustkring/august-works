import { pgTable, uuid, text, unique, foreignKey, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { contextManifests } from "./context_manifests.js";
import { memoryRecords } from "./memory.js";
// Content-free lineage bridges ordinary and derived Context to source erasure.
export const contextManifestMemoryRoots = pgTable("context_manifest_memory_roots", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), manifestId: uuid("manifest_id").notNull(),
  memoryRecordId: uuid("memory_record_id").notNull(), sourceVersion: text("source_version").notNull(),
}, (t) => ({ rootUq: unique("context_memory_roots_manifest_record_uq").on(t.manifestId, t.memoryRecordId),
  manifestFk: foreignKey({ name: "context_memory_roots_manifest_fk", columns: [t.companyId, t.manifestId], foreignColumns: [contextManifests.companyId, contextManifests.id] }).onDelete("cascade"),
  memoryFk: foreignKey({ name: "context_memory_roots_memory_fk", columns: [t.companyId, t.memoryRecordId], foreignColumns: [memoryRecords.companyId, memoryRecords.id] }).onDelete("cascade"),
  sourceIdx: index("context_memory_roots_company_record_idx").on(t.companyId, t.memoryRecordId),
}));
