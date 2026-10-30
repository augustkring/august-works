CREATE TABLE "jev_decision_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"allow_background" boolean DEFAULT false NOT NULL,
	"connection_id" uuid,
	"grant_id" uuid,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jev_decision_settings_mode_ck" CHECK ("jev_decision_settings"."mode" in ('off','shadow','suggestions')),
	CONSTRAINT "jev_decision_settings_connection_ck" CHECK (("jev_decision_settings"."connection_id" is null) = ("jev_decision_settings"."grant_id" is null))
);
--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" DROP CONSTRAINT "orchestration_model_reservation_purpose_ck";--> statement-breakpoint
ALTER TABLE "jev_decision_settings" ADD CONSTRAINT "jev_decision_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_model_reservations" ADD CONSTRAINT "orchestration_model_reservation_purpose_ck" CHECK ("orchestration_model_reservations"."purpose" in ('worker_model','read_only_verification','read_only_trajectory','provider_conformance','agent_safe_test','decision_shadow'));