CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" bigint NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text,
	CONSTRAINT "passkey_counter_check" CHECK ("passkey"."counter" between 0 and 4294967295)
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "two_factor_failed_verification_count_check" CHECK ("two_factor"."failed_verification_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "authentication_method" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "authenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "authenticator_version" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "authenticator_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phishing_resistant_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_user_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_uq" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_uq" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_authentication_proof_check" CHECK (
    ("session"."authentication_method" is null and "session"."authenticated_at" is null and "session"."authenticator_version" is null)
    or ("session"."authentication_method" is not null and "session"."authenticator_version" is not null
      and "session"."authentication_method" in ('password','totp','backup_code','passkey')
      and "session"."authenticated_at" is not null and "session"."authenticator_version" >= 0)
  );--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_authenticator_version_check" CHECK ("user"."authenticator_version" >= 0);