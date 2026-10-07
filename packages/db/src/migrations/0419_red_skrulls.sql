CREATE TABLE "learning_analytical_dependencies" (
	"company_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"source_manifest_id" uuid NOT NULL,
	CONSTRAINT "learning_analytical_dependencies_uq" UNIQUE("cycle_id","source_manifest_id")
);
--> statement-breakpoint
ALTER TABLE "learning_cycles" ADD COLUMN "analytical_source_pins" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_cycles" ADD COLUMN "analytical_source_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_cycles" ADD COLUMN "analytical_source_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learning_analytical_dependencies" ADD CONSTRAINT "learning_analytical_dependencies_cycle_fk" FOREIGN KEY ("company_id","cycle_id") REFERENCES "public"."learning_cycles"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_analytical_dependencies" ADD CONSTRAINT "learning_analytical_dependencies_source_fk" FOREIGN KEY ("company_id","source_manifest_id") REFERENCES "public"."analytical_lineage_manifests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_analytical_dependencies_source_idx" ON "learning_analytical_dependencies" USING btree ("company_id","source_manifest_id");--> statement-breakpoint
ALTER TABLE "learning_cycles" ADD CONSTRAINT "learning_cycle_analytical_sources_check" CHECK (jsonb_typeof("learning_cycles"."analytical_source_pins")='array' and (("learning_cycles"."analytical_source_count"=0 and jsonb_array_length("learning_cycles"."analytical_source_pins")=0 and "learning_cycles"."analytical_source_expires_at" is null) or ("learning_cycles"."analytical_source_count" between 1 and 26200 and jsonb_array_length("learning_cycles"."analytical_source_pins") between 1 and 8 and "learning_cycles"."analytical_source_expires_at" is not null)));