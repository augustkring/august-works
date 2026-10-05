CREATE TABLE "auth_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"company_id" uuid,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_security_events_action_ck" CHECK ("auth_security_events"."action" in ('verification_requested','email_verified','password_reset_requested','password_reset_completed','sessions_revoked','invite_accepted'))
);
--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD COLUMN "payload_key_id" text DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "payload_key_id" text DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_security_events" ADD CONSTRAINT "auth_security_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_security_events_user_idx" ON "auth_security_events" USING btree ("user_id","created_at");