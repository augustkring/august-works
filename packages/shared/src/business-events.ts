import { z } from "zod";

export const BUSINESS_EVENT_PROJECTOR_VERSION = "aw-activity-v2";
export const businessEventObjectSchema = z.object({
  objectType: z.enum(["issue", "project"]),
  objectId: z.string().uuid(),
  qualifier: z.enum(["primary", "related"]),
}).strict();
export const businessEventAttributesSchema = z.object({
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled", "planned", "paused", "completed"]).optional(),
  previousStatus: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled", "planned", "paused", "completed"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
}).strict();
export const businessEventCursorSchema = z.object({
  at: z.iso.datetime(),
  id: z.string().uuid(),
}).strict();
export const businessEventPurposeSchema = z.object({
  governanceObligationRefs: z.array(z.string().uuid()).min(1).max(32),
  retentionDays: z.number().int().min(1).max(3650),
}).strict();
export const businessEventBackfillSchema = z.object({
  ...businessEventPurposeSchema.shape,
  from: z.iso.datetime(),
  until: z.iso.datetime(),
  cursor: businessEventCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(100),
}).strict().refine((v) => Date.parse(v.from) <= Date.parse(v.until), "Invalid source window")
  .refine((v) => !v.cursor || (Date.parse(v.cursor.at) >= Date.parse(v.from) && Date.parse(v.cursor.at) <= Date.parse(v.until)), "Cursor outside source window");
export const businessEventListSchema = z.object({
  from: z.iso.datetime(),
  until: z.iso.datetime(),
  cursor: businessEventCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict().refine((v) => Date.parse(v.from) <= Date.parse(v.until), "Invalid event window")
  .refine((v) => !v.cursor || (Date.parse(v.cursor.at) >= Date.parse(v.from) && Date.parse(v.cursor.at) <= Date.parse(v.until)), "Cursor outside event window");
export type BusinessEventAttributes = z.infer<typeof businessEventAttributesSchema>;
export type BusinessEventObject = z.infer<typeof businessEventObjectSchema>;
export type BusinessEventBackfill = z.infer<typeof businessEventBackfillSchema>;
export type BusinessEventList = z.infer<typeof businessEventListSchema>;
export const businessEventExportSchema = z.object({
  ...businessEventListSchema.shape,
  ...businessEventPurposeSchema.shape,
  format: z.enum(["native_jsonl", "ocel_2_json", "ocel_2_sqlite"]),
}).strict().refine(v => Date.parse(v.from) <= Date.parse(v.until), "Invalid event window")
  .refine(v => !v.cursor || (Date.parse(v.cursor.at) >= Date.parse(v.from) && Date.parse(v.cursor.at) <= Date.parse(v.until)), "Cursor outside event window");
export type BusinessEventExport = z.infer<typeof businessEventExportSchema>;
export interface BusinessEventExportManifest {
  id: string;
  companyId: string;
  format: BusinessEventExport["format"];
  formatVersion: "aw-business-events-jsonl-v2" | "OCEL 2.0";
  exporterVersion: string;
  createdAt: string;
  expiresAt: string;
  payloadHash: string;
  inputHash: string;
  lineageManifestId: string;
  eventCount: number;
  objectCount: number;
  coverage: "bounded_current_authorized_page";
  nextCursor: z.infer<typeof businessEventCursorSchema> | null;
  window: { from: string; until: string };
  privacy: "current_business_objects_no_person_attributes";
}
export interface BusinessEventBackfillResult {
  runId: string;
  projectorVersion: string;
  from: string;
  until: string;
  projected: number;
  unchanged: number;
  nextCursor: z.infer<typeof businessEventCursorSchema> | null;
  coverage: "bounded_source_window";
}

export interface BusinessEvent {
  id: string;
  companyId: string;
  eventType: string;
  activity: string;
  lifecycle: string | null;
  occurredAt: string;
  observedAt: string;
  sourceUpdatedAt: string | null;
  receivedAt: string | null;
  source: { class: "aw_native"; provider: "activity_log"; ref: string; version: string; contentHash: string };
  revision: number;
  objects: BusinessEventObject[];
  attributes: BusinessEventAttributes;
  purpose: "process_intelligence";
  sensitivity: "internal";
  trustLevel: "observed";
  supersedesEventId: string | null;
  tombstonedAt: string | null;
  governanceObligationRefs: string[];
  retentionDays: number;
  expiresAt: string;
}
