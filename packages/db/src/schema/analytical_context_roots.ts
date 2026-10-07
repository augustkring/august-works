import {sql} from "drizzle-orm";
import {check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,unique,uuid} from "drizzle-orm/pg-core";
import type {AnalyticalContextAuthorityPin} from "@paperclipai/shared";
import {memoryRecords} from "./memory.js";
import {analyticalLineageManifests} from "./analytical_lineage.js";

/** Retention provenance only. These roots are never verified Task evidence. */
export const analyticalContextRoots=pgTable("analytical_context_roots",{
 companyId:uuid("company_id").notNull(),memoryRecordId:uuid("memory_record_id").primaryKey(),
 sourceCount:integer("source_count").notNull(),contentHash:text("content_hash").notNull(),
 authorityPins:jsonb("authority_pins").$type<AnalyticalContextAuthorityPin[]>().notNull().default([]),
 deletionKey:text("deletion_key").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),
 expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
},t=>({tenantUq:unique("analytical_context_roots_tenant_uq").on(t.companyId,t.memoryRecordId),
 memoryFk:foreignKey({name:"analytical_context_roots_memory_fk",columns:[t.companyId,t.memoryRecordId],foreignColumns:[memoryRecords.companyId,memoryRecords.id]}).onDelete("cascade"),
 validity:check("analytical_context_roots_validity",sql`${t.sourceCount} between 1 and 26200 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.deletionKey} ~ '^[0-9a-f]{64}$' and ${t.expiresAt}>${t.createdAt}`),
 expiryIdx:index("analytical_context_roots_expiry_idx").on(t.companyId,t.expiresAt),
}));
export const analyticalContextDependencies=pgTable("analytical_context_dependencies",{
 companyId:uuid("company_id").notNull(),memoryRecordId:uuid("memory_record_id").notNull(),sourceManifestId:uuid("source_manifest_id").notNull(),
},t=>({dependencyUq:unique("analytical_context_dependencies_uq").on(t.memoryRecordId,t.sourceManifestId),
 rootFk:foreignKey({name:"analytical_context_dependencies_root_fk",columns:[t.companyId,t.memoryRecordId],foreignColumns:[analyticalContextRoots.companyId,analyticalContextRoots.memoryRecordId]}).onDelete("cascade"),
 sourceFk:foreignKey({name:"analytical_context_dependencies_source_fk",columns:[t.companyId,t.sourceManifestId],foreignColumns:[analyticalLineageManifests.companyId,analyticalLineageManifests.id]}).onDelete("cascade"),
 sourceIdx:index("analytical_context_dependencies_source_idx").on(t.companyId,t.sourceManifestId),
}));
