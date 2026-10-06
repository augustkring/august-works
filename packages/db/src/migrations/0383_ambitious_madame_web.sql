CREATE TABLE "business_event_objects" (
	"company_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"qualifier" text NOT NULL,
	CONSTRAINT "business_event_objects_relationship_uq" UNIQUE("company_id","event_id","object_type","object_id","qualifier"),
	CONSTRAINT "business_event_objects_type_check" CHECK ("business_event_objects"."object_type" in ('issue','project') and "business_event_objects"."qualifier" in ('primary','related'))
);
--> statement-breakpoint
CREATE TABLE "business_event_suppressions" (
	"company_id" uuid NOT NULL,
	"source_ref" uuid NOT NULL,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_event_suppressions_source_uq" UNIQUE("company_id","source_ref")
);
--> statement-breakpoint
CREATE TABLE "business_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"activity" text NOT NULL,
	"lifecycle" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"source_class" text NOT NULL,
	"source_provider" text NOT NULL,
	"source_ref" uuid NOT NULL,
	"source_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"revision" integer NOT NULL,
	"attributes_json" jsonb NOT NULL,
	"purpose" text NOT NULL,
	"sensitivity" text NOT NULL,
	"trust_level" text NOT NULL,
	"supersedes_event_id" uuid,
	"tombstoned_at" timestamp with time zone,
	CONSTRAINT "business_events_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "business_events_source_revision_uq" UNIQUE("company_id","source_provider","source_ref","revision"),
	CONSTRAINT "business_events_native_source_check" CHECK ("business_events"."source_class" = 'aw_native' and "business_events"."source_provider" = 'activity_log'),
	CONSTRAINT "business_events_source_hash_check" CHECK ("business_events"."source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "business_events_revision_check" CHECK (("business_events"."revision" = 1 and "business_events"."supersedes_event_id" is null) or ("business_events"."revision" > 1 and "business_events"."supersedes_event_id" is not null)),
	CONSTRAINT "business_events_policy_check" CHECK ("business_events"."purpose" = 'process_intelligence' and "business_events"."sensitivity" = 'internal' and "business_events"."trust_level" = 'observed'),
	CONSTRAINT "business_events_attributes_check" CHECK (jsonb_typeof("business_events"."attributes_json") = 'object' and "business_events"."attributes_json" - ARRAY['status','previousStatus','priority']::text[] = '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "business_event_objects" ADD CONSTRAINT "business_event_objects_company_event_fk" FOREIGN KEY ("company_id","event_id") REFERENCES "public"."business_events"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_event_suppressions" ADD CONSTRAINT "business_event_suppressions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_company_supersedes_fk" FOREIGN KEY ("company_id","supersedes_event_id") REFERENCES "public"."business_events"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_event_objects_company_object_idx" ON "business_event_objects" USING btree ("company_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "business_events_company_time_idx" ON "business_events" USING btree ("company_id","occurred_at","id");